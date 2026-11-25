-- Seed data for Anjuman Khata
-- Safe to run on fresh DB; uses deterministic UUIDs and ON CONFLICT DO NOTHING.

-- 1. Organization settings (single row)
INSERT INTO public.org_settings (
  id,
  org_name,
  org_name_ur,
  fiscal_year_start_month,
  cycle,
  currency,
  grace_days
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Anjuman Khata',
  'انجمن کھاتہ',
  1,
  'monthly',
  'PKR',
  0
)
ON CONFLICT (id) DO NOTHING;

-- 2. Contribution tiers (admin-editable)
INSERT INTO public.tiers (id, code, name, name_ur, min_amount, is_active) VALUES
  (
    '10000000-0000-0000-0000-000000000001'::uuid,
    'small_business',
    'Small Business',
    'چھوٹا کاروبار',
    200,
    true
  ),
  (
    '10000000-0000-0000-0000-000000000002'::uuid,
    'established_business',
    'Established Business',
    'بڑا کاروبار',
    500,
    true
  )
ON CONFLICT (code) DO NOTHING;

-- 3. Initial effective-dated tier rates (backdated to 1900-01-01 as baseline)
INSERT INTO public.tier_rates (id, tier_id, min_amount, effective_from) VALUES
  (
    '20000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    200,
    '1900-01-01'::date
  ),
  (
    '20000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    500,
    '1900-01-01'::date
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Current fiscal / calendar year (2026, open)
INSERT INTO public.fiscal_years (id, label, start_date, end_date, status) VALUES
  (
    '30000000-0000-0000-0000-000000002026'::uuid,
    '2026',
    '2026-01-01'::date,
    '2026-12-31'::date,
    'open'
  )
ON CONFLICT (label) DO NOTHING;

-- 5. Initial Zakat setting for 2026 (configurable by admin; never hardcoded in UI)
INSERT INTO public.zakat_settings (id, year, nisab_amount, rate_bps, basis_note) VALUES
  (
    '40000000-0000-0000-0000-000000002026'::uuid,
    2026,
    180000,
    250,
    'Silver basis (52.5 tola) — confirm current market rate and school of thought with committee scholar'
  )
ON CONFLICT (year) DO NOTHING;
