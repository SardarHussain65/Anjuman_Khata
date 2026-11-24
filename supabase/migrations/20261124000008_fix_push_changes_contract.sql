-- Phase 1.8: Align `push_changes()` contract after `zakat_members` addition
-- Fixes:
--   1. Restores `code` & `message` keys on rejected results (matching client & migration 04)
--   2. Restores `conflict_merged` status & structured `log_conflict_loser` metadata
--   3. Restores `AND (v_payload ? column_name)` guard on UPDATE so omitted keys never NULL out columns

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
    'zakat_members',
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
      ELSIF v_table IN ('profiles', 'member_tiers', 'zakat_members', 'zakat_assessments') THEN
        v_policy := 'mutable_field_merge';
      ELSE
        v_policy := 'server_wins';
      END IF;

      v_payload := (v_payload - v_server_managed) || jsonb_build_object('id', v_record_id);

      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', v_table)
        USING v_record_id
        INTO v_existing;

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

      ELSIF v_op IN ('update', 'soft_delete') THEN
        IF v_existing IS NULL THEN
          RAISE EXCEPTION 'RECORD_NOT_FOUND: Record % in % does not exist or is not accessible.', v_record_id, v_table
            USING ERRCODE = 'P0001';
        END IF;

        v_existing_version := (v_existing->>'version')::int;
        v_existing_deleted := (v_existing->>'deleted_at') IS NOT NULL;

        IF v_policy = 'server_wins' AND v_base_version > 0 AND v_existing_version > v_base_version THEN
          PERFORM public.log_conflict_loser(v_table, v_record_id, v_payload, v_existing);
          v_saved := v_existing;
          v_status := 'conflict_server_wins';

        ELSIF v_op = 'update' AND v_existing_deleted THEN
          PERFORM public.log_conflict_loser(v_table, v_record_id, v_payload, v_existing);
          v_saved := v_existing;
          v_status := 'conflict_server_wins';

        ELSE
          IF v_op = 'soft_delete' THEN
            v_payload := v_payload || jsonb_build_object('deleted_at', clock_timestamp());
            IF NOT ('deleted_at' = ANY(v_changed_fields)) THEN
              v_changed_fields := array_append(v_changed_fields, 'deleted_at');
            END IF;
            IF (v_payload ? 'void_reason') AND NOT ('void_reason' = ANY(v_changed_fields)) THEN
              v_changed_fields := array_append(v_changed_fields, 'void_reason');
            END IF;
          ELSIF array_length(v_changed_fields, 1) IS NULL THEN
            SELECT COALESCE(array_agg(k), ARRAY[]::text[])
            INTO v_changed_fields
            FROM jsonb_object_keys(v_payload - 'id') AS k;
          END IF;

          SELECT COALESCE(array_agg(f), ARRAY[]::text[])
          INTO v_changed_fields
          FROM unnest(v_changed_fields) AS f
          WHERE f <> 'id' AND f <> ALL(v_server_managed);

          v_status := 'accepted';
          v_loser := '{}'::jsonb;
          IF v_base_version > 0 AND v_existing_version > v_base_version THEN
            FOREACH v_field IN ARRAY v_changed_fields LOOP
              IF (v_existing ? v_field)
                 AND (v_payload ? v_field)
                 AND ((v_existing->v_field) IS DISTINCT FROM (v_payload->v_field)) THEN
                v_loser := jsonb_set(v_loser, ARRAY[v_field], COALESCE(v_existing->v_field, 'null'::jsonb), true);
              END IF;
            END LOOP;

            IF v_loser <> '{}'::jsonb THEN
              v_status := 'conflict_merged';
            END IF;
          END IF;

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
      GET STACKED DIAGNOSTICS
        v_err_code = RETURNED_SQLSTATE,
        v_err_msg = MESSAGE_TEXT;

      IF v_err_msg LIKE 'YEAR_CLOSED:%' THEN
        v_err_code := 'YEAR_CLOSED';
      ELSIF v_err_msg LIKE 'REOPEN_REASON_REQUIRED:%' THEN
        v_err_code := 'REOPEN_REASON_REQUIRED';
      ELSIF v_err_msg LIKE 'HARD_DELETE_FORBIDDEN:%' THEN
        v_err_code := 'HARD_DELETE_FORBIDDEN';
      ELSIF v_err_msg LIKE 'INVALID_ZAKAT_ASSETS:%' THEN
        v_err_code := 'INVALID_ZAKAT_ASSETS';
      ELSIF v_err_code = '42501' THEN
        v_err_code := 'FORBIDDEN';
      ELSIF v_err_code = '23505' THEN
        v_err_code := 'UNIQUE_VIOLATION';
      ELSIF v_err_code = '23503' THEN
        v_err_code := 'FK_VIOLATION';
      ELSIF v_err_code = '23514' THEN
        v_err_code := 'CHECK_VIOLATION';
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
