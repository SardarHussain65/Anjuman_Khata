-- Phase 1.1: Core schema and indexes for Anjuman Khata
-- All money amounts are stored as integer PKR (never floats).
-- All synced tables share: id, created_at, updated_at, deleted_at, updated_by, version.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Organization settings (single row)
CREATE TABLE public.org_settings (
  id uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  org_name text NOT NULL CHECK (length(trim(org_name)) > 0),
  org_name_ur text NOT NULL DEFAULT '',
  logo text,
  fiscal_year_start_month int NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  cycle text NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly')),
  currency text NOT NULL DEFAULT 'PKR' CHECK (length(trim(currency)) > 0),
  grace_days int NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 31),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- 2. Member profiles (id matches auth.users.id for login-enabled accounts;
-- also permits offline/CSV-imported directory members prior to login provisioning)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_no int NOT NULL UNIQUE CHECK (member_no > 0),
  full_name text NOT NULL CHECK (length(trim(full_name)) > 0),
  full_name_ur text,
  phone text,
  designation text,
  tag text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'non_earning', 'inactive')),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  personal_pledge int CHECK (personal_pledge IS NULL OR personal_pledge > 0),
  joined_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Karachi')::date),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- 3. Contribution tiers (admin-editable)
CREATE TABLE public.tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  name_ur text NOT NULL DEFAULT '',
  min_amount int NOT NULL CHECK (min_amount > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- 4. Effective-dated tier minimum rates (guarantees changing a tier minimum is never retroactive)
CREATE TABLE public.tier_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id uuid NOT NULL REFERENCES public.tiers(id),
  min_amount int NOT NULL CHECK (min_amount > 0),
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE UNIQUE INDEX idx_tier_rates_unique_active
  ON public.tier_rates (tier_id, effective_from)
  WHERE deleted_at IS NULL;

-- 5. Member tier assignment history (effective-dated; current tier = latest <= target month)
CREATE TABLE public.member_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles(id),
  tier_id uuid NOT NULL REFERENCES public.tiers(id),
  effective_from date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- 6. Fiscal / calendar years (open or closed; closed years reject ledger mutations)
CREATE TABLE public.fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE CHECK (length(trim(label)) > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by uuid REFERENCES public.profiles(id),
  closed_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT chk_fiscal_year_dates CHECK (end_date >= start_date)
);

-- 7. Charity contributions ledger (append-only; NO 'zakat' kind)
CREATE TABLE public.contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles(id),
  amount int NOT NULL CHECK (amount > 0),
  period_start date NOT NULL CHECK (EXTRACT(DAY FROM period_start) = 1),
  kind text NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly', 'special', 'advance')),
  paid_on date NOT NULL,
  collected_by uuid REFERENCES public.profiles(id),
  remark text,
  void_reason text,
  client_created_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT chk_contributions_void_reason CHECK (
    deleted_at IS NULL OR length(trim(coalesce(void_reason, ''))) > 0
  )
);

-- 8. Zakat yearly settings (nisab never hardcoded in UI)
CREATE TABLE public.zakat_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL UNIQUE CHECK (year BETWEEN 2000 AND 2100),
  nisab_amount int NOT NULL CHECK (nisab_amount >= 0),
  rate_bps int NOT NULL DEFAULT 250 CHECK (rate_bps > 0 AND rate_bps <= 10000),
  basis_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- 9. Zakat assessments (stores immutable snapshot of nisab_used, rate_bps, assets, due_amount)
CREATE TABLE public.zakat_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles(id),
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  assets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assets) = 'object'),
  liabilities int NOT NULL DEFAULT 0 CHECK (liabilities >= 0),
  net_zakatable int NOT NULL DEFAULT 0 CHECK (net_zakatable >= 0),
  nisab_used int NOT NULL CHECK (nisab_used >= 0),
  rate_bps int NOT NULL DEFAULT 250 CHECK (rate_bps > 0 AND rate_bps <= 10000),
  due_amount int NOT NULL DEFAULT 0 CHECK (due_amount >= 0),
  assessed_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1)
);

-- 10. Zakat payments ledger (strictly separate from charity contributions)
CREATE TABLE public.zakat_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles(id),
  assessment_id uuid REFERENCES public.zakat_assessments(id),
  year int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  amount int NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL,
  collected_by uuid REFERENCES public.profiles(id),
  remark text,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  updated_by uuid,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  CONSTRAINT chk_zakat_payments_void_reason CHECK (
    deleted_at IS NULL OR length(trim(coalesce(void_reason, ''))) > 0
  )
);

-- 11. Audit log (server-written only, read-only for admins)
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Required & query-performance indexes
CREATE INDEX idx_org_settings_updated_at ON public.org_settings (updated_at);
CREATE INDEX idx_profiles_updated_at ON public.profiles (updated_at);
CREATE INDEX idx_profiles_status ON public.profiles (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tiers_updated_at ON public.tiers (updated_at);
CREATE INDEX idx_tier_rates_updated_at ON public.tier_rates (updated_at);
CREATE INDEX idx_tier_rates_lookup ON public.tier_rates (tier_id, effective_from DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_member_tiers_updated_at ON public.member_tiers (updated_at);
CREATE INDEX idx_member_tiers_lookup ON public.member_tiers (member_id, effective_from DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_fiscal_years_updated_at ON public.fiscal_years (updated_at);
CREATE INDEX idx_fiscal_years_dates ON public.fiscal_years (start_date, end_date);
CREATE INDEX idx_contributions_updated_at ON public.contributions (updated_at);
CREATE INDEX idx_contributions_member_period ON public.contributions (member_id, period_start);
CREATE INDEX idx_contributions_period ON public.contributions (period_start);
CREATE INDEX idx_zakat_settings_updated_at ON public.zakat_settings (updated_at);
CREATE INDEX idx_zakat_assessments_updated_at ON public.zakat_assessments (updated_at);
CREATE INDEX idx_zakat_assessments_member_year ON public.zakat_assessments (member_id, year);
CREATE INDEX idx_zakat_payments_updated_at ON public.zakat_payments (updated_at);
CREATE INDEX idx_zakat_payments_member_year ON public.zakat_payments (member_id, year);
CREATE INDEX idx_audit_log_record ON public.audit_log (table_name, record_id, created_at DESC);
CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);
