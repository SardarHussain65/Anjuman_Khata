-- Phase 1.7: Separate Annual Zakat Payers / Families Register (`zakat_members`)
-- Supports Ramazan annual per-person Zakat collection:
--   - Separate registration from monthly charity `profiles`
--   - Payer name, Khandan (family) name, Solo (1) or Family (N people)
--   - Admin-configured yearly fixed `per_person_amount` in `zakat_settings`
--   - Links `zakat_payments` directly to `zakat_members` (`member_id` becomes nullable)

-- =============================================================================
-- 1. Separate Zakat Members / Households table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.zakat_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_no int NOT NULL CHECK (member_no > 0),
  payer_name text NOT NULL CHECK (length(trim(payer_name)) > 0),
  khandan_name text NOT NULL DEFAULT '',
  is_family boolean NOT NULL DEFAULT false,
  family_count int NOT NULL DEFAULT 1 CHECK (family_count >= 1 AND family_count <= 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_zakat_members_updated_at ON public.zakat_members (updated_at);
CREATE INDEX IF NOT EXISTS idx_zakat_members_status ON public.zakat_members (status) WHERE deleted_at IS NULL;

-- Attach sync metadata, hard-delete protection, and audit log triggers
DROP TRIGGER IF EXISTS trg_zakat_members_sync_metadata ON public.zakat_members;
CREATE TRIGGER trg_zakat_members_sync_metadata
  BEFORE INSERT OR UPDATE ON public.zakat_members
  FOR EACH ROW EXECUTE FUNCTION public.set_sync_metadata();

DROP TRIGGER IF EXISTS trg_zakat_members_no_hard_delete ON public.zakat_members;
CREATE TRIGGER trg_zakat_members_no_hard_delete
  BEFORE DELETE ON public.zakat_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

DROP TRIGGER IF EXISTS trg_zakat_members_audit ON public.zakat_members;
CREATE TRIGGER trg_zakat_members_audit
  AFTER INSERT OR UPDATE ON public.zakat_members
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();

-- Enable RLS & least-privilege grants (read-only for anon/authenticated, write admin-only)
ALTER TABLE public.zakat_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zakat_members_select_public ON public.zakat_members;
CREATE POLICY zakat_members_select_public ON public.zakat_members
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS zakat_members_admin_insert ON public.zakat_members;
CREATE POLICY zakat_members_admin_insert ON public.zakat_members
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS zakat_members_admin_update ON public.zakat_members;
CREATE POLICY zakat_members_admin_update ON public.zakat_members
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS zakat_members_admin_delete ON public.zakat_members;
CREATE POLICY zakat_members_admin_delete ON public.zakat_members
  FOR DELETE TO authenticated USING (public.is_admin());

GRANT SELECT ON public.zakat_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zakat_members TO authenticated;
GRANT ALL ON public.zakat_members TO service_role;

-- =============================================================================
-- 2. Extend `zakat_settings` with yearly admin-set `per_person_amount`
-- =============================================================================
ALTER TABLE public.zakat_settings
  ADD COLUMN IF NOT EXISTS per_person_amount int NOT NULL DEFAULT 0 CHECK (per_person_amount >= 0);

-- =============================================================================
-- 3. Extend `zakat_payments` to support separate `zakat_members`
-- =============================================================================
ALTER TABLE public.zakat_payments
  ALTER COLUMN member_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS zakat_member_id uuid REFERENCES public.zakat_members(id),
  ADD COLUMN IF NOT EXISTS family_count_snapshot int CHECK (family_count_snapshot IS NULL OR family_count_snapshot >= 1);

CREATE INDEX IF NOT EXISTS idx_zakat_payments_zakat_member_year
  ON public.zakat_payments (zakat_member_id, year);

-- =============================================================================
-- 4. Register `zakat_members` in `pull_changes` and `push_changes`
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
    'zakat_members',
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
  v_requested := COALESCE(p_tables, v_allowed_tables);
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
GRANT EXECUTE ON FUNCTION public.pull_changes(timestamptz, text[]) TO anon, authenticated, service_role;

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
          IF v_base_version > 0 AND v_existing_version > v_base_version THEN
            v_loser := '{}'::jsonb;
            FOREACH v_field IN ARRAY v_changed_fields LOOP
              IF (v_existing ? v_field) AND ((v_existing->v_field) IS DISTINCT FROM (v_payload->v_field)) THEN
                v_loser := jsonb_set(v_loser, ARRAY[v_field], COALESCE(v_existing->v_field, 'null'::jsonb), true);
              END IF;
            END LOOP;

            IF v_loser <> '{}'::jsonb THEN
              PERFORM public.log_conflict_loser(v_table, v_record_id, v_loser, v_payload);
            END IF;
            v_status := 'merged';
          END IF;

          v_set_list := '';
          FOR v_col IN
            SELECT column_name, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = v_table
              AND column_name = ANY(v_changed_fields)
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
        END IF;

      ELSE
        RAISE EXCEPTION 'INVALID_OP: Unsupported op "%".', v_op
          USING ERRCODE = 'P0001';
      END IF;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'outbox_id', v_outbox_id,
        'table', v_table,
        'record_id', v_record_id,
        'status', v_status,
        'record', v_saved
      ));

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_err_code = RETURNED_SQLSTATE,
        v_err_msg = MESSAGE_TEXT;

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'outbox_id', v_outbox_id,
        'table', v_table,
        'record_id', v_record_id,
        'status', 'rejected',
        'error_code', CASE
          WHEN v_err_msg LIKE 'YEAR_CLOSED:%' THEN 'YEAR_CLOSED'
          WHEN v_err_msg LIKE 'REOPEN_REASON_REQUIRED:%' THEN 'REOPEN_REASON_REQUIRED'
          WHEN v_err_msg LIKE 'HARD_DELETE_FORBIDDEN:%' THEN 'HARD_DELETE_FORBIDDEN'
          WHEN v_err_code = '42501' THEN 'FORBIDDEN'
          WHEN v_err_code = '23505' THEN 'UNIQUE_VIOLATION'
          WHEN v_err_code = '23503' THEN 'FK_VIOLATION'
          WHEN v_err_code = '23514' THEN 'CHECK_VIOLATION'
          ELSE v_err_code
        END,
        'error_message', v_err_msg
      ));
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
