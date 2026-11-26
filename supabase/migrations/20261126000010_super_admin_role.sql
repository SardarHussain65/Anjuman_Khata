-- Phase 1.10: Super Admin role & Admin Management support
-- Introduces `super_admin` alongside `admin` and `user` in `public.profiles.role`:
--   - `super_admin`: full admin rights + exclusive ability to create, reset, and
--     revoke/re-enable `admin` accounts from inside the app.
--   - `admin`: full charity/zakat ledger management, cannot manage other admins.
--   - Both `admin` and `super_admin` are excluded from the charity member register
--     and have NULL `member_no`.
--   - Revoked admins (`status = 'inactive'`) immediately lose RLS write access.

-- =============================================================================
-- 1. Extend profiles.role check constraint & member_no constraint
-- =============================================================================
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'admin', 'super_admin'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS chk_profiles_member_no_required_for_users;

ALTER TABLE public.profiles
  ADD CONSTRAINT chk_profiles_member_no_required_for_users
  CHECK (role IN ('admin', 'super_admin') OR member_no IS NOT NULL);

UPDATE public.profiles
SET member_no = NULL
WHERE role IN ('admin', 'super_admin')
  AND member_no IS NOT NULL;

-- Make member_no uniqueness DEFERRABLE INITIALLY DEFERRED so batched serial
-- reordering inside a single sync transaction (push_changes) never hits a
-- transient mid-batch unique violation. (NULLs for admins do not collide.)
DROP INDEX IF EXISTS public.idx_profiles_member_no_unique;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS uq_profiles_member_no;
ALTER TABLE public.profiles
  ADD CONSTRAINT uq_profiles_member_no UNIQUE (member_no) DEFERRABLE INITIALLY DEFERRED;

-- =============================================================================
-- 2. Update is_admin() and add is_super_admin() helpers
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
      AND role IN ('admin', 'super_admin')
      AND status = 'active'
      AND deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_super_admin()
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
      AND role = 'super_admin'
      AND status = 'active'
      AND deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, service_role;

-- =============================================================================
-- 3. Exclude both admin and super_admin from compliance register calculations
-- =============================================================================
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
    AND p.role NOT IN ('admin', 'super_admin')
  ORDER BY p.member_no, m.period_start;
$$;
