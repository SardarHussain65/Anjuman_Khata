-- =============================================================================
-- Anjuman Khata — Remove All Amount / Tier / Payment Details (Keep All Members)
-- =============================================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query -> Run
--
-- Keeps all 52 members in `public.profiles` (names, Urdu names, serial #, designation),
-- and removes all tier obligations, personal pledges, and payment amounts so
-- Expected = Rs 0 and Arrears = Rs 0 until the admin assigns real details.
-- =============================================================================

BEGIN;

SET LOCAL app.allow_hard_delete = 'true';

-- 1. Remove all payments and tier assignments
DELETE FROM public.contributions;
DELETE FROM public.member_tiers;
DELETE FROM public.zakat_payments;
DELETE FROM public.zakat_assessments;

-- 2. Reset all non-admin members to Voluntary (no tier / no pledge / no arrears)
UPDATE public.profiles
SET
  status = 'non_earning',
  personal_pledge = NULL
WHERE role NOT IN ('admin', 'super_admin')
  AND deleted_at IS NULL;

COMMIT;

-- 3. Verification
SELECT
  COUNT(*) AS total_members,
  COUNT(*) FILTER (WHERE status = 'non_earning') AS voluntary_members,
  (SELECT COUNT(*) FROM public.member_tiers WHERE deleted_at IS NULL) AS tier_assignments,
  (SELECT COUNT(*) FROM public.contributions WHERE deleted_at IS NULL) AS payments
FROM public.profiles
WHERE role NOT IN ('admin', 'super_admin')
  AND deleted_at IS NULL;
