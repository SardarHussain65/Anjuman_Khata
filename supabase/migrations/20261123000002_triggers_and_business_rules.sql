-- Phase 1.2: Triggers & server-enforced business rules
-- 1. Server-stamped updated_at & monotonic version (never trust client clock)
-- 2. Hard-delete prevention (soft-delete only)
-- 3. Closed fiscal year enforcement + audited reopen reason
-- 4. Server-side Zakat integer calculation (round_half_up, zero floats)
-- 5. Audit logging on ALL synced tables

-- =============================================================================
-- 1. Server-controlled sync metadata (updated_at, updated_by, version)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_sync_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, clock_timestamp());
    NEW.updated_at := clock_timestamp();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.version := 1;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by);
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 2. Prevent hard deletes everywhere (nothing is ever hard-deleted)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prevent_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_hard_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'HARD_DELETE_FORBIDDEN: Records in % cannot be hard-deleted; use soft delete with reason.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

-- Prevent any UPDATE or DELETE on audit_log
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_log is append-only and cannot be modified or deleted.'
    USING ERRCODE = 'P0001';
END;
$$;

-- =============================================================================
-- 3. Fiscal year closed enforcement & audited reopen
-- =============================================================================
CREATE OR REPLACE FUNCTION public.assert_date_not_in_closed_fiscal_year(p_date date)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_closed_label text;
BEGIN
  SELECT label INTO v_closed_label
  FROM public.fiscal_years
  WHERE status = 'closed'
    AND deleted_at IS NULL
    AND p_date BETWEEN start_date AND end_date
  LIMIT 1;

  IF v_closed_label IS NOT NULL THEN
    RAISE EXCEPTION 'YEAR_CLOSED: Fiscal year % is closed; modifications are not allowed.', v_closed_label
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_open_fiscal_year_contributions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.assert_date_not_in_closed_fiscal_year(NEW.period_start);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.assert_date_not_in_closed_fiscal_year(OLD.period_start);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_open_fiscal_year_zakat()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_closed_label text;
  v_target_year int;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.assert_date_not_in_closed_fiscal_year(NEW.paid_on);
    v_target_year := NEW.year;
    SELECT label INTO v_closed_label
    FROM public.fiscal_years
    WHERE status = 'closed'
      AND deleted_at IS NULL
      AND (label = v_target_year::text OR EXTRACT(YEAR FROM start_date)::int = v_target_year)
    LIMIT 1;
    IF v_closed_label IS NOT NULL THEN
      RAISE EXCEPTION 'YEAR_CLOSED: Fiscal year % is closed; Zakat payment modifications are not allowed.', v_closed_label
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.assert_date_not_in_closed_fiscal_year(OLD.paid_on);
    v_target_year := OLD.year;
    SELECT label INTO v_closed_label
    FROM public.fiscal_years
    WHERE status = 'closed'
      AND deleted_at IS NULL
      AND (label = v_target_year::text OR EXTRACT(YEAR FROM start_date)::int = v_target_year)
    LIMIT 1;
    IF v_closed_label IS NOT NULL THEN
      RAISE EXCEPTION 'YEAR_CLOSED: Fiscal year % is closed; Zakat payment modifications are not allowed.', v_closed_label
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_fiscal_year_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'open' AND NEW.status = 'closed' THEN
      NEW.closed_at := COALESCE(NEW.closed_at, clock_timestamp());
      NEW.closed_by := COALESCE(auth.uid(), NEW.closed_by);
    ELSIF OLD.status = 'closed' AND NEW.status = 'open' THEN
      IF length(trim(coalesce(NEW.reopen_reason, ''))) = 0 THEN
        RAISE EXCEPTION 'REOPEN_REASON_REQUIRED: Reopening a closed fiscal year requires a non-empty reason.'
          USING ERRCODE = 'P0001';
      END IF;
      NEW.closed_at := NULL;
      NEW.closed_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 4. Zakat integer math & server-side recalculation trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.compute_zakat_due(
  p_net_zakatable bigint,
  p_nisab_amount int,
  p_rate_bps int
)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_net_zakatable IS NULL OR p_net_zakatable <= 0 OR p_net_zakatable < p_nisab_amount THEN
    RETURN 0;
  END IF;
  -- Exact integer half-up rounding: floor((net * rate_bps + 5000) / 10000)
  RETURN ((p_net_zakatable * p_rate_bps::bigint + 5000) / 10000)::int;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_zakat_assessment_calculation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kv record;
  v_val numeric;
  v_assets_total bigint := 0;
  v_net bigint;
BEGIN
  IF NEW.assets IS NULL OR jsonb_typeof(NEW.assets) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_ZAKAT_ASSETS: assets must be a JSON object.'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_kv IN SELECT key, value FROM jsonb_each(NEW.assets) LOOP
    IF jsonb_typeof(v_kv.value) <> 'number' THEN
      RAISE EXCEPTION 'INVALID_ZAKAT_ASSETS: asset "%" must be an integer.', v_kv.key
        USING ERRCODE = 'P0001';
    END IF;
    v_val := (v_kv.value::text)::numeric;
    IF v_val < 0 OR v_val <> trunc(v_val) THEN
      RAISE EXCEPTION 'INVALID_ZAKAT_ASSETS: asset "%" must be a non-negative integer PKR amount.', v_kv.key
        USING ERRCODE = 'P0001';
    END IF;
    v_assets_total := v_assets_total + v_val::bigint;
  END LOOP;

  v_net := GREATEST(0::bigint, v_assets_total - NEW.liabilities::bigint);
  NEW.net_zakatable := v_net::int;
  NEW.due_amount := public.compute_zakat_due(v_net, NEW.nisab_used, NEW.rate_bps);
  NEW.assessed_by := COALESCE(NEW.assessed_by, auth.uid());
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. Audit log trigger (server-written only via SECURITY DEFINER)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action text;
  v_actor uuid;
  v_old_json jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  v_new_json jsonb := to_jsonb(NEW);
BEGIN
  v_actor := COALESCE(auth.uid(), NEW.updated_by);

  IF TG_OP = 'INSERT' THEN
    v_action := 'INSERT';
  ELSIF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'fiscal_years'
       AND (v_old_json->>'status') = 'open'
       AND (v_new_json->>'status') = 'closed' THEN
      v_action := 'FISCAL_YEAR_CLOSE';
    ELSIF TG_TABLE_NAME = 'fiscal_years'
       AND (v_old_json->>'status') = 'closed'
       AND (v_new_json->>'status') = 'open' THEN
      v_action := 'FISCAL_YEAR_REOPEN';
    ELSIF (v_old_json->>'deleted_at') IS NULL
       AND (v_new_json->>'deleted_at') IS NOT NULL THEN
      v_action := 'VOID';
    ELSE
      v_action := 'UPDATE';
    END IF;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_actor,
    v_action,
    TG_TABLE_NAME,
    NEW.id,
    v_old_json,
    v_new_json
  );

  RETURN NEW;
END;
$$;

-- Attach triggers across all synced tables
DO $$
DECLARE
  t text;
  synced_tables text[] := ARRAY[
    'org_settings',
    'profiles',
    'tiers',
    'tier_rates',
    'member_tiers',
    'fiscal_years',
    'contributions',
    'zakat_settings',
    'zakat_assessments',
    'zakat_payments'
  ];
BEGIN
  FOREACH t IN ARRAY synced_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_sync_metadata
       BEFORE INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_sync_metadata();',
      t, t
    );

    EXECUTE format(
      'CREATE TRIGGER trg_%s_no_hard_delete
       BEFORE DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();',
      t, t
    );

    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit
       AFTER INSERT OR UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();',
      t, t
    );
  END LOOP;
END;
$$;

-- Domain-specific BEFORE triggers
CREATE TRIGGER trg_contributions_open_fiscal_year
  BEFORE INSERT OR UPDATE OR DELETE ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_open_fiscal_year_contributions();

CREATE TRIGGER trg_zakat_payments_open_fiscal_year
  BEFORE INSERT OR UPDATE OR DELETE ON public.zakat_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_open_fiscal_year_zakat();

CREATE TRIGGER trg_fiscal_years_status_transition
  BEFORE UPDATE ON public.fiscal_years
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fiscal_year_status_transition();

CREATE TRIGGER trg_zakat_assessments_recompute
  BEFORE INSERT OR UPDATE ON public.zakat_assessments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_zakat_assessment_calculation();

-- Audit log immutability trigger
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();
