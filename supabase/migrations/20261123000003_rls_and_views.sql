-- Phase 1.3: Row-Level Security (RLS) & computed reporting views
-- Enforces strict read-only own-row isolation for standard users and full access for admins.

-- =============================================================================
-- 1. Admin role check helper (SECURITY DEFINER to avoid RLS recursion on profiles)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- =============================================================================
-- 2. Enable & force RLS on EVERY table
-- =============================================================================
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zakat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zakat_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zakat_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. RLS Policies
-- Standard users: SELECT own rows + shared config; NO write policies anywhere.
-- Admins: SELECT/INSERT/UPDATE on all business tables; SELECT only on audit_log.
-- =============================================================================

-- profiles
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY profiles_insert_admin ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- member_tiers
CREATE POLICY member_tiers_select_own_or_admin ON public.member_tiers
  FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR public.is_admin());

CREATE POLICY member_tiers_insert_admin ON public.member_tiers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY member_tiers_update_admin ON public.member_tiers
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- contributions
CREATE POLICY contributions_select_own_or_admin ON public.contributions
  FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR public.is_admin());

CREATE POLICY contributions_insert_admin ON public.contributions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY contributions_update_admin ON public.contributions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- zakat_assessments (sensitive asset breakdown: strictly own member or admin)
CREATE POLICY zakat_assessments_select_own_or_admin ON public.zakat_assessments
  FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR public.is_admin());

CREATE POLICY zakat_assessments_insert_admin ON public.zakat_assessments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY zakat_assessments_update_admin ON public.zakat_assessments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- zakat_payments
CREATE POLICY zakat_payments_select_own_or_admin ON public.zakat_payments
  FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR public.is_admin());

CREATE POLICY zakat_payments_insert_admin ON public.zakat_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY zakat_payments_update_admin ON public.zakat_payments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Shared config tables: readable by all authenticated users, writable only by admins
CREATE POLICY org_settings_select_auth ON public.org_settings
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY org_settings_insert_admin ON public.org_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY org_settings_update_admin ON public.org_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY tiers_select_auth ON public.tiers
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY tiers_insert_admin ON public.tiers
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY tiers_update_admin ON public.tiers
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY tier_rates_select_auth ON public.tier_rates
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY tier_rates_insert_admin ON public.tier_rates
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY tier_rates_update_admin ON public.tier_rates
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY fiscal_years_select_auth ON public.fiscal_years
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY fiscal_years_insert_admin ON public.fiscal_years
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY fiscal_years_update_admin ON public.fiscal_years
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY zakat_settings_select_auth ON public.zakat_settings
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY zakat_settings_insert_admin ON public.zakat_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY zakat_settings_update_admin ON public.zakat_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- audit_log: admins can SELECT only; nobody can INSERT/UPDATE/DELETE directly
CREATE POLICY audit_log_select_admin ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- =============================================================================
-- 4. Derived reporting helpers & views (SECURITY INVOKER so RLS applies!)
-- =============================================================================

-- Effective tier & non-retroactive minimum in force for a member in a given month
CREATE OR REPLACE FUNCTION public.get_member_effective_tier(
  p_member_id uuid,
  p_month_start date
)
RETURNS TABLE (
  tier_id uuid,
  tier_code text,
  tier_name text,
  min_amount int,
  effective_from date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH chosen_assignment AS (
    SELECT mt.tier_id, mt.effective_from
    FROM public.member_tiers mt
    WHERE mt.member_id = p_member_id
      AND mt.deleted_at IS NULL
      AND date_trunc('month', mt.effective_from)::date <= date_trunc('month', p_month_start)::date
    ORDER BY mt.effective_from DESC, mt.created_at DESC
    LIMIT 1
  ),
  chosen_rate AS (
    SELECT tr.min_amount
    FROM chosen_assignment ca
    JOIN public.tier_rates tr ON tr.tier_id = ca.tier_id
    WHERE tr.deleted_at IS NULL
      AND date_trunc('month', tr.effective_from)::date <= date_trunc('month', p_month_start)::date
    ORDER BY tr.effective_from DESC, tr.created_at DESC
    LIMIT 1
  )
  SELECT
    t.id AS tier_id,
    t.code AS tier_code,
    t.name AS tier_name,
    COALESCE((SELECT min_amount FROM chosen_rate), t.min_amount) AS min_amount,
    ca.effective_from
  FROM chosen_assignment ca
  JOIN public.tiers t ON t.id = ca.tier_id;
$$;

-- Computed per-member monthly compliance for any fiscal year
CREATE OR REPLACE FUNCTION public.get_fiscal_year_compliance(
  p_fiscal_year_id uuid
)
RETURNS TABLE (
  member_id uuid,
  member_no int,
  full_name text,
  member_status text,
  period_start date,
  tier_id uuid,
  tier_code text,
  expected_min int,
  paid_amount int,
  compliance_status text,
  shortfall int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH fy AS (
    SELECT start_date, end_date
    FROM public.fiscal_years
    WHERE id = p_fiscal_year_id AND deleted_at IS NULL
  ),
  months AS (
    SELECT generate_series(
      date_trunc('month', fy.start_date)::date,
      date_trunc('month', fy.end_date)::date,
      interval '1 month'
    )::date AS period_start
    FROM fy
  ),
  karachi_now AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'Asia/Karachi')::date)::date AS current_month
  ),
  paid_by_month AS (
    SELECT
      c.member_id,
      c.period_start,
      COALESCE(SUM(c.amount), 0)::int AS paid_amount
    FROM public.contributions c
    JOIN fy ON c.period_start BETWEEN fy.start_date AND fy.end_date
    WHERE c.deleted_at IS NULL
    GROUP BY c.member_id, c.period_start
  )
  SELECT
    p.id AS member_id,
    p.member_no,
    p.full_name,
    p.status AS member_status,
    m.period_start,
    et.tier_id,
    et.tier_code,
    COALESCE(et.min_amount, 0) AS expected_min,
    COALESCE(pm.paid_amount, 0) AS paid_amount,
    CASE
      WHEN p.status IN ('non_earning', 'inactive') OR et.tier_id IS NULL THEN
        'exempt'
      WHEN m.period_start > kn.current_month THEN
        CASE WHEN COALESCE(pm.paid_amount, 0) > 0 THEN 'advance' ELSE 'exempt' END
      WHEN COALESCE(pm.paid_amount, 0) >= et.min_amount THEN
        'met'
      WHEN COALESCE(pm.paid_amount, 0) > 0 THEN
        'short'
      ELSE
        'unpaid'
    END AS compliance_status,
    CASE
      WHEN p.status IN ('non_earning', 'inactive') OR et.tier_id IS NULL OR m.period_start > kn.current_month THEN
        0
      ELSE
        GREATEST(0, et.min_amount - COALESCE(pm.paid_amount, 0))
    END AS shortfall
  FROM public.profiles p
  CROSS JOIN months m
  CROSS JOIN karachi_now kn
  LEFT JOIN LATERAL public.get_member_effective_tier(p.id, m.period_start) et ON true
  LEFT JOIN paid_by_month pm ON pm.member_id = p.id AND pm.period_start = m.period_start
  WHERE p.deleted_at IS NULL
  ORDER BY p.member_no, m.period_start;
$$;

-- Separate Zakat balance view (never mixed with charity contributions)
CREATE OR REPLACE VIEW public.v_zakat_member_balance
WITH (security_invoker = true) AS
WITH assessments AS (
  SELECT
    za.member_id,
    za.year,
    COALESCE(SUM(za.due_amount), 0)::int AS total_due
  FROM public.zakat_assessments za
  WHERE za.deleted_at IS NULL
  GROUP BY za.member_id, za.year
),
payments AS (
  SELECT
    zp.member_id,
    zp.year,
    COALESCE(SUM(zp.amount), 0)::int AS total_paid
  FROM public.zakat_payments zp
  WHERE zp.deleted_at IS NULL
  GROUP BY zp.member_id, zp.year
),
keys AS (
  SELECT member_id, year FROM assessments
  UNION
  SELECT member_id, year FROM payments
)
SELECT
  k.member_id,
  k.year,
  COALESCE(a.total_due, 0) AS due_amount,
  COALESCE(p.total_paid, 0) AS paid_amount,
  (COALESCE(a.total_due, 0) - COALESCE(p.total_paid, 0)) AS balance
FROM keys k
LEFT JOIN assessments a ON a.member_id = k.member_id AND a.year = k.year
LEFT JOIN payments p ON p.member_id = k.member_id AND p.year = k.year;
