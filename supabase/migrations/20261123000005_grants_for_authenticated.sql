-- Phase 1.5: Explicit least-privilege table, view, and function GRANTs for Supabase hosted roles.
-- Necessary because `supabase db push --remote` runs via a login role rather than `postgres`,
-- so `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` does not automatically grant table access.
-- Row-Level Security (RLS) still strictly enforces per-user isolation and admin-only writes.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Synced business tables (RLS restricts standard users to own-row SELECT only; admins get full CRUD)
GRANT SELECT, INSERT, UPDATE ON
  public.org_settings,
  public.profiles,
  public.tiers,
  public.tier_rates,
  public.member_tiers,
  public.fiscal_years,
  public.contributions,
  public.zakat_settings,
  public.zakat_assessments,
  public.zakat_payments
TO authenticated;

GRANT ALL ON
  public.org_settings,
  public.profiles,
  public.tiers,
  public.tier_rates,
  public.member_tiers,
  public.fiscal_years,
  public.contributions,
  public.zakat_settings,
  public.zakat_assessments,
  public.zakat_payments
TO service_role;

-- Audit log: read-only for admins (enforced by RLS); server triggers write via SECURITY DEFINER
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO service_role;

-- Reporting views
GRANT SELECT ON public.v_zakat_member_balance TO authenticated, service_role;

-- Functions & Sync RPCs
GRANT EXECUTE ON FUNCTION
  public.is_admin(),
  public.compute_zakat_due(bigint, int, int),
  public.get_member_effective_tier(uuid, date),
  public.get_fiscal_year_compliance(uuid),
  public.pull_changes(timestamptz, text[]),
  public.push_changes(jsonb),
  public.log_conflict_loser(text, uuid, jsonb, jsonb)
TO authenticated, service_role;
