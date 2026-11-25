-- Phase 1.6: Passwordless Read-Only Community Viewer (`anon` role SELECT-only)
-- Normal community members browse the full register without email/password.
-- Writes remain strictly admin-only (`authenticated` + `public.is_admin()`).
-- `audit_log` remains strictly admin-only (never readable by `anon`).

GRANT USAGE ON SCHEMA public TO anon;

-- Read-only SELECT privileges for `anon` on register tables (ZERO write grants)
GRANT SELECT ON
  public.org_settings,
  public.profiles,
  public.tiers,
  public.tier_rates,
  public.member_tiers,
  public.fiscal_years,
  public.contributions,
  public.zakat_settings,
  public.zakat_assessments,
  public.zakat_payments,
  public.v_zakat_member_balance
TO anon;

-- Explicit SELECT-only RLS policies for `anon` and authenticated viewers
CREATE POLICY org_settings_select_public ON public.org_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY tiers_select_public ON public.tiers
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY tier_rates_select_public ON public.tier_rates
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY fiscal_years_select_public ON public.fiscal_years
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY zakat_settings_select_public ON public.zakat_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY profiles_select_public ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY member_tiers_select_public ON public.member_tiers
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY contributions_select_public ON public.contributions
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY zakat_assessments_select_public ON public.zakat_assessments
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY zakat_payments_select_public ON public.zakat_payments
  FOR SELECT TO anon, authenticated USING (true);

-- Update pull_changes() so `anon` viewers can sync the register offline (still SECURITY INVOKER + read-only)
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

GRANT EXECUTE ON FUNCTION public.pull_changes(timestamptz, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.compute_zakat_due(bigint, int, int),
  public.get_member_effective_tier(uuid, date),
  public.get_fiscal_year_compliance(uuid)
TO anon, authenticated, service_role;
