-- Phase 1.4: Offline-First Sync RPCs (SECURITY INVOKER so RLS applies automatically)
-- Supports registry-driven pull_changes() and batch push_changes() with:
--   - Per-mutation savepoints (rejections like YEAR_CLOSED quarantine without blocking the batch)
--   - Append-only ledger idempotent inserts + field-level merge + soft-delete-wins
--   - Mutable record base_version checks + field-level merge + loser audit logging
--   - Config tables server-wins on conflict

-- =============================================================================
-- 1. Conflict loser audit helper (admin-only, writes to server-only audit_log)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_conflict_loser(
  p_table_name text,
  p_record_id uuid,
  p_loser_data jsonb,
  p_winner_data jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: Only admins may record sync conflict audit entries.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (auth.uid(), 'CONFLICT_LOSER', p_table_name, p_record_id, p_loser_data, p_winner_data);
END;
$$;

REVOKE ALL ON FUNCTION public.log_conflict_loser(text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_conflict_loser(text, uuid, jsonb, jsonb) TO authenticated, service_role;

-- =============================================================================
-- 2. pull_changes(last_pulled_at, tables) — SECURITY INVOKER (RLS-scoped)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.pull_changes(
  p_last_pulled_at timestamptz DEFAULT NULL,
  p_tables text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_allowed_tables text[] := ARRAY[
    'org_settings',
    'tiers',
    'tier_rates',
    'fiscal_years',
    'zakat_settings',
    'profiles',
    'member_tiers',
    'contributions',
    'zakat_assessments',
    'zakat_payments'
  ];
  v_requested text[];
  v_table text;
  v_rows jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_server_time timestamptz := clock_timestamp();
  v_cutoff timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sign in required to pull changes.'
      USING ERRCODE = '42501';
  END IF;

  v_requested := COALESCE(p_tables, v_allowed_tables);
  -- 2-second lookback overlap prevents missing concurrent transactions committed during previous pull
  v_cutoff := CASE
    WHEN p_last_pulled_at IS NULL THEN NULL
    ELSE p_last_pulled_at - interval '2 seconds'
  END;

  FOREACH v_table IN ARRAY v_requested LOOP
    IF NOT (v_table = ANY(v_allowed_tables)) THEN
      RAISE EXCEPTION 'INVALID_TABLE: Table "%" is not registered for sync.', v_table
        USING ERRCODE = 'P0001';
    END IF;

    IF v_cutoff IS NULL THEN
      EXECUTE format(
        'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.updated_at ASC, t.id ASC), ''[]''::jsonb)
         FROM public.%I t',
        v_table
      ) INTO v_rows;
    ELSE
      EXECUTE format(
        'SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.updated_at ASC, t.id ASC), ''[]''::jsonb)
         FROM public.%I t
         WHERE t.updated_at > $1',
        v_table
      ) USING v_cutoff INTO v_rows;
    END IF;

    v_changes := jsonb_set(v_changes, ARRAY[v_table], v_rows, true);
  END LOOP;

  RETURN jsonb_build_object(
    'server_time', v_server_time,
    'changes', v_changes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pull_changes(timestamptz, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_changes(timestamptz, text[]) TO authenticated, service_role;

-- =============================================================================
-- 3. push_changes(mutations) — SECURITY INVOKER (RLS + Triggers + Savepoints)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.push_changes(
  p_mutations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_mut jsonb;
  v_outbox_id text;
  v_table text;
  v_op text;
  v_record_id uuid;
  v_base_version int;
  v_changed_fields text[];
  v_payload jsonb;
  v_policy text;
  v_existing jsonb;
  v_existing_version int;
  v_existing_deleted boolean;
  v_merged jsonb;
  v_loser jsonb;
  v_field text;
  v_col_list text;
  v_val_list text;
  v_set_list text;
  v_col record;
  v_saved jsonb;
  v_status text;
  v_results jsonb := '[]'::jsonb;
  v_err_code text;
  v_err_msg text;
  v_server_managed text[] := ARRAY['created_at', 'updated_at', 'updated_by', 'version'];
  v_allowed_tables text[] := ARRAY[
    'org_settings',
    'tiers',
    'tier_rates',
    'fiscal_years',
    'zakat_settings',
    'profiles',
    'member_tiers',
    'contributions',
    'zakat_assessments',
    'zakat_payments'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Sign in required to push changes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_mutations IS NULL OR jsonb_typeof(p_mutations) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: p_mutations must be a JSON array.'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_mut IN SELECT value FROM jsonb_array_elements(p_mutations) LOOP
    v_outbox_id := COALESCE(v_mut->>'outbox_id', '');
    v_table := COALESCE(v_mut->>'table', '');
    v_op := COALESCE(v_mut->>'op', '');
    v_record_id := NULLIF(v_mut->>'record_id', '')::uuid;
    v_base_version := COALESCE((v_mut->>'base_version')::int, 0);
    v_payload := COALESCE(v_mut->'payload', '{}'::jsonb);

    SELECT COALESCE(array_agg(x), ARRAY[]::text[])
    INTO v_changed_fields
    FROM jsonb_array_elements_text(COALESCE(v_mut->'changed_fields', '[]'::jsonb)) AS x;

    -- Each mutation executes in its own sub-transaction savepoint so one rejection
    -- (e.g., YEAR_CLOSED or RLS denial) quarantines cleanly without aborting the batch.
    BEGIN
      IF NOT (v_table = ANY(v_allowed_tables)) THEN
        RAISE EXCEPTION 'INVALID_TABLE: Table "%" is not allowed for sync.', v_table
          USING ERRCODE = 'P0001';
      END IF;

      IF v_record_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_RECORD_ID: record_id must be a valid UUID.'
          USING ERRCODE = 'P0001';
      END IF;

      IF v_table IN ('contributions', 'zakat_payments') THEN
        v_policy := 'ledger_field_merge';
      ELSIF v_table IN ('profiles', 'member_tiers', 'zakat_assessments') THEN
        v_policy := 'mutable_field_merge';
      ELSE
        v_policy := 'server_wins';
      END IF;

      -- Ensure payload carries record_id and strips server-managed columns
      v_payload := (v_payload - v_server_managed) || jsonb_build_object('id', v_record_id);

      -- Fetch current server record (if any) under caller's RLS
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', v_table)
        USING v_record_id
        INTO v_existing;

      -- -----------------------------------------------------------------------
      -- Case A: INSERT (idempotent on client UUID)
      -- -----------------------------------------------------------------------
      IF v_op = 'insert' THEN
        IF v_existing IS NOT NULL THEN
          v_saved := v_existing;
          v_status := 'accepted';
        ELSE
          v_col_list := '';
          v_val_list := '';
          FOR v_col IN
            SELECT column_name, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name <> ALL(v_server_managed)
              AND (v_payload ? column_name)
            ORDER BY ordinal_position
          LOOP
            IF v_col_list <> '' THEN
              v_col_list := v_col_list || ', ';
              v_val_list := v_val_list || ', ';
            END IF;
            v_col_list := v_col_list || format('%I', v_col.column_name);
            IF v_col.udt_name = 'jsonb' THEN
              v_val_list := v_val_list || format('($1->%L)', v_col.column_name);
            ELSE
              v_val_list := v_val_list || format('($1->>%L)::%s', v_col.column_name, v_col.udt_name);
            END IF;
          END LOOP;

          EXECUTE format(
            'INSERT INTO public.%I (%s) VALUES (%s) RETURNING to_jsonb(%I)',
            v_table, v_col_list, v_val_list, v_table
          ) USING v_payload INTO v_saved;
          v_status := 'accepted';
        END IF;

      -- -----------------------------------------------------------------------
      -- Case B: UPDATE / SOFT_DELETE
      -- -----------------------------------------------------------------------
      ELSIF v_op IN ('update', 'soft_delete') THEN
        IF v_existing IS NULL THEN
          RAISE EXCEPTION 'RECORD_NOT_FOUND: Record % in % does not exist or is not accessible.', v_record_id, v_table
            USING ERRCODE = 'P0001';
        END IF;

        v_existing_version := (v_existing->>'version')::int;
        v_existing_deleted := (v_existing->>'deleted_at') IS NOT NULL;

        -- Policy 1: Config tables -> Server wins on version conflict
        IF v_policy = 'server_wins' AND v_base_version > 0 AND v_existing_version > v_base_version THEN
          PERFORM public.log_conflict_loser(v_table, v_record_id, v_payload, v_existing);
          v_saved := v_existing;
          v_status := 'conflict_server_wins';

        -- Policy 2 & 3: Soft-delete always wins over concurrent edit
        ELSIF v_op = 'update' AND v_existing_deleted THEN
          PERFORM public.log_conflict_loser(v_table, v_record_id, v_payload, v_existing);
          v_saved := v_existing;
          v_status := 'conflict_server_wins';

        ELSE
          -- Determine fields to update
          IF v_op = 'soft_delete' THEN
            v_payload := v_payload || jsonb_build_object('deleted_at', clock_timestamp());
            IF NOT ('deleted_at' = ANY(v_changed_fields)) THEN
              v_changed_fields := array_append(v_changed_fields, 'deleted_at');
            END IF;
            IF (v_payload ? 'void_reason') AND NOT ('void_reason' = ANY(v_changed_fields)) THEN
              v_changed_fields := array_append(v_changed_fields, 'void_reason');
            END IF;
          ELSIF array_length(v_changed_fields, 1) IS NULL THEN
            -- Fallback if caller didn't send changed_fields: use all payload keys except id
            SELECT COALESCE(array_agg(k), ARRAY[]::text[])
            INTO v_changed_fields
            FROM jsonb_object_keys(v_payload - 'id') AS k;
          END IF;

          -- Strip server-managed columns from changed_fields
          SELECT COALESCE(array_agg(f), ARRAY[]::text[])
          INTO v_changed_fields
          FROM unnest(v_changed_fields) AS f
          WHERE f <> 'id' AND f <> ALL(v_server_managed);

          -- If concurrent edit occurred (server version > base_version), log loser snapshot of overlapping fields
          v_status := 'accepted';
          IF v_base_version > 0 AND v_existing_version > v_base_version THEN
            v_loser := '{}'::jsonb;
            FOREACH v_field IN ARRAY v_changed_fields LOOP
              IF (v_existing ? v_field) AND ((v_existing->v_field) IS DISTINCT FROM (v_payload->v_field)) THEN
                v_loser := jsonb_set(v_loser, ARRAY[v_field], COALESCE(v_existing->v_field, 'null'::jsonb), true);
              END IF;
            END LOOP;

            IF v_loser <> '{}'::jsonb THEN
              -- Later server-received write wins on overlapping fields; overwritten server values logged as loser
              v_status := 'conflict_merged';
            END IF;
          END IF;

          -- Build field-level UPDATE statement (non-overlapping server fields remain untouched!)
          v_set_list := '';
          FOR v_col IN
            SELECT column_name, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name = ANY(v_changed_fields)
              AND (v_payload ? column_name)
            ORDER BY ordinal_position
          LOOP
            IF v_set_list <> '' THEN
              v_set_list := v_set_list || ', ';
            END IF;
            IF v_col.udt_name = 'jsonb' THEN
              v_set_list := v_set_list || format('%I = ($1->%L)', v_col.column_name, v_col.column_name);
            ELSE
              v_set_list := v_set_list || format('%I = ($1->>%L)::%s', v_col.column_name, v_col.column_name, v_col.udt_name);
            END IF;
          END LOOP;

          IF v_set_list = '' THEN
            v_saved := v_existing;
          ELSE
            EXECUTE format(
              'UPDATE public.%I SET %s WHERE id = $2 RETURNING to_jsonb(%I)',
              v_table, v_set_list, v_table
            ) USING v_payload, v_record_id INTO v_saved;
          END IF;

          IF v_status = 'conflict_merged' AND v_loser IS NOT NULL AND v_loser <> '{}'::jsonb THEN
            PERFORM public.log_conflict_loser(
              v_table,
              v_record_id,
              jsonb_build_object(
                'base_version', v_base_version,
                'server_version_before_merge', v_existing_version,
                'overwritten_fields', v_loser
              ),
              v_saved
            );
          END IF;
        END IF;

      ELSE
        RAISE EXCEPTION 'INVALID_OP: Unsupported sync op "%".', v_op
          USING ERRCODE = 'P0001';
      END IF;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'outbox_id', v_outbox_id,
          'table', v_table,
          'record_id', v_record_id,
          'status', v_status,
          'record', v_saved
        )
      );

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT, v_err_code = RETURNED_SQLSTATE;
      -- Extract semantic prefix if raised by our triggers (e.g. YEAR_CLOSED, REOPEN_REASON_REQUIRED)
      IF v_err_msg LIKE 'YEAR_CLOSED:%' THEN
        v_err_code := 'YEAR_CLOSED';
      ELSIF v_err_msg LIKE 'REOPEN_REASON_REQUIRED:%' THEN
        v_err_code := 'REOPEN_REASON_REQUIRED';
      ELSIF v_err_msg LIKE 'INVALID_ZAKAT_ASSETS:%' THEN
        v_err_code := 'INVALID_ZAKAT_ASSETS';
      ELSIF v_err_code = '42501' THEN
        v_err_code := 'FORBIDDEN';
      END IF;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'outbox_id', v_outbox_id,
          'table', v_table,
          'record_id', v_record_id,
          'status', 'rejected',
          'code', v_err_code,
          'message', v_err_msg
        )
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'server_time', clock_timestamp(),
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.push_changes(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.push_changes(jsonb) TO authenticated, service_role;
