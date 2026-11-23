-- Phase 1 Verification Suite: RLS, Triggers, Closed-Year Enforcement, Zakat Math,
-- Non-Retroactive Tiers, and Sync RPC Conflict / Quarantine Behavior.
-- Runs inside a single rolled-back transaction so it leaves the database clean.

BEGIN;

-- =============================================================================
-- Test fixture setup (as superuser / postgres before switching to authenticated role)
-- =============================================================================
DO $$
DECLARE
  v_admin_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001'::uuid;
  v_user1_id uuid := 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;
  v_user2_id uuid := 'bbbbbbbb-0000-0000-0000-000000000002'::uuid;
  v_tier_small uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_tier_est uuid := '10000000-0000-0000-0000-000000000002'::uuid;
BEGIN
  -- Ensure seed rows exist even if run on an unseeded DB
  INSERT INTO public.org_settings (id, org_name, org_name_ur)
  VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Anjuman Khata', 'انجمن کھاتہ')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tiers (id, code, name, min_amount) VALUES
    (v_tier_small, 'small_business', 'Small Business', 200),
    (v_tier_est, 'established_business', 'Established Business', 500)
  ON CONFLICT (code) DO NOTHING;

  INSERT INTO public.tier_rates (id, tier_id, min_amount, effective_from) VALUES
    ('20000000-0000-0000-0000-000000000001'::uuid, v_tier_small, 200, '1900-01-01'),
    ('20000000-0000-0000-0000-000000000002'::uuid, v_tier_est, 500, '1900-01-01')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.fiscal_years (id, label, start_date, end_date, status) VALUES
    ('30000000-0000-0000-0000-000000002025'::uuid, '2025', '2025-01-01', '2025-12-31', 'closed'),
    ('30000000-0000-0000-0000-000000002026'::uuid, '2026', '2026-01-01', '2026-12-31', 'open')
  ON CONFLICT (label) DO NOTHING;

  INSERT INTO public.zakat_settings (id, year, nisab_amount, rate_bps, basis_note) VALUES
    ('40000000-0000-0000-0000-000000002026'::uuid, 2026, 180000, 250, 'Silver basis test')
  ON CONFLICT (year) DO NOTHING;

  -- Profiles: 1 admin, 2 standard users
  INSERT INTO public.profiles (id, member_no, full_name, status, role) VALUES
    (v_admin_id, 9001, 'Admin One', 'active', 'admin'),
    (v_user1_id, 9002, 'Member One', 'active', 'user'),
    (v_user2_id, 9003, 'Member Two', 'non_earning', 'user');

  -- Member One starts on small_business (200) from 2026-01-01
  INSERT INTO public.member_tiers (id, member_id, tier_id, effective_from, reason) VALUES
    ('50000000-0000-0000-0000-000000000001'::uuid, v_user1_id, v_tier_small, '2026-01-01', 'Initial');

  -- Contributions for Member One & Member Two in 2026 (open year)
  INSERT INTO public.contributions (id, member_id, amount, period_start, kind, paid_on, remark) VALUES
    ('60000000-0000-0000-0000-000000000001'::uuid, v_user1_id, 200, '2026-01-01', 'monthly', '2026-01-05', 'Jan paid'),
    ('60000000-0000-0000-0000-000000000002'::uuid, v_user2_id, 300, '2026-01-01', 'special', '2026-01-10', 'Voluntary');

  -- Zakat assessment for Member Two (sensitive asset details!)
  INSERT INTO public.zakat_assessments (id, member_id, year, assets, liabilities, nisab_used, rate_bps, due_amount)
  VALUES (
    '70000000-0000-0000-0000-000000000001'::uuid,
    v_user2_id,
    2026,
    '{"cash": 500000, "gold": 100000}'::jsonb,
    50000,
    180000,
    250,
    1 -- deliberately tampered by client; trigger MUST recompute to 13750!
  );
END $$;

-- =============================================================================
-- TEST 1: Zakat server-side recalculation, half-up integer rounding & immutability
-- =============================================================================
DO $$
DECLARE
  v_net int;
  v_due int;
  v_due_below int;
  v_due_half_up int;
BEGIN
  -- Verify tampered due_amount=1 was overwritten by trigger: (500000+100000-50000)=550000 * 250 / 10000 = 13750
  SELECT net_zakatable, due_amount INTO v_net, v_due
  FROM public.zakat_assessments
  WHERE id = '70000000-0000-0000-0000-000000000001'::uuid;

  IF v_net <> 550000 OR v_due <> 13750 THEN
    RAISE EXCEPTION 'FAIL TEST 1a: expected net=550000 due=13750, got net=% due=%', v_net, v_due;
  END IF;

  -- Below nisab => due must be 0
  v_due_below := public.compute_zakat_due(179999, 180000, 250);
  IF v_due_below <> 0 THEN
    RAISE EXCEPTION 'FAIL TEST 1b: expected below-nisab due=0, got %', v_due_below;
  END IF;

  -- Exact half-up check: 200020 * 250 / 10000 = 5000.5 -> must round UP to 5001
  v_due_half_up := public.compute_zakat_due(200020, 180000, 250);
  IF v_due_half_up <> 5001 THEN
    RAISE EXCEPTION 'FAIL TEST 1c: expected half-up 5001, got %', v_due_half_up;
  END IF;

  -- Changing zakat_settings later must NOT change stored assessment snapshot
  UPDATE public.zakat_settings SET nisab_amount = 999999 WHERE year = 2026;
  SELECT due_amount INTO v_due
  FROM public.zakat_assessments
  WHERE id = '70000000-0000-0000-0000-000000000001'::uuid;

  IF v_due <> 13750 THEN
    RAISE EXCEPTION 'FAIL TEST 1d: changing zakat_settings altered past assessment to %', v_due;
  END IF;

  RAISE NOTICE 'PASS TEST 1: Zakat integer math, server recomputation, and snapshot immutability';
END $$;

-- =============================================================================
-- TEST 2: Non-retroactive tier minimum & tier reassignment compliance
-- =============================================================================
DO $$
DECLARE
  v_user1_id uuid := 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;
  v_tier_small uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_tier_est uuid := '10000000-0000-0000-0000-000000000002'::uuid;
  v_jan_min int;
  v_mar_min int;
  v_jun_min int;
  v_jan_status text;
  v_user2_status text;
BEGIN
  -- Raise small_business minimum from 200 -> 300 effective 2026-03-01
  INSERT INTO public.tier_rates (tier_id, min_amount, effective_from)
  VALUES (v_tier_small, 300, '2026-03-01');
  UPDATE public.tiers SET min_amount = 300 WHERE id = v_tier_small;

  -- Upgrade Member One to established_business (500) effective 2026-06-01
  INSERT INTO public.member_tiers (member_id, tier_id, effective_from, reason)
  VALUES (v_user1_id, v_tier_est, '2026-06-01', 'Business grew');

  SELECT min_amount INTO v_jan_min FROM public.get_member_effective_tier(v_user1_id, '2026-01-01');
  SELECT min_amount INTO v_mar_min FROM public.get_member_effective_tier(v_user1_id, '2026-03-01');
  SELECT min_amount INTO v_jun_min FROM public.get_member_effective_tier(v_user1_id, '2026-06-01');

  IF v_jan_min <> 200 OR v_mar_min <> 300 OR v_jun_min <> 500 THEN
    RAISE EXCEPTION 'FAIL TEST 2a: expected 200/300/500, got %/%/%', v_jan_min, v_mar_min, v_jun_min;
  END IF;

  -- Member One paid 200 in Jan 2026 -> must STILL be 'met' even after March rate increase & June tier upgrade!
  SELECT compliance_status INTO v_jan_status
  FROM public.get_fiscal_year_compliance('30000000-0000-0000-0000-000000002026'::uuid)
  WHERE member_id = v_user1_id AND period_start = '2026-01-01';

  IF v_jan_status <> 'met' THEN
    RAISE EXCEPTION 'FAIL TEST 2b: Jan 2026 compliance retroactively changed to %', v_jan_status;
  END IF;

  -- Member Two is non_earning -> must ALWAYS be 'exempt'
  SELECT compliance_status INTO v_user2_status
  FROM public.get_fiscal_year_compliance('30000000-0000-0000-0000-000000002026'::uuid)
  WHERE member_id = 'bbbbbbbb-0000-0000-0000-000000000002'::uuid AND period_start = '2026-02-01';

  IF v_user2_status <> 'exempt' THEN
    RAISE EXCEPTION 'FAIL TEST 2c: non_earning member got compliance=% instead of exempt', v_user2_status;
  END IF;

  RAISE NOTICE 'PASS TEST 2: Non-retroactive tier rates, tier history, and non_earning exemption';
END $$;

-- =============================================================================
-- TEST 3: Closed fiscal year rejection & reopen reason enforcement
-- =============================================================================
DO $$
DECLARE
  v_user1_id uuid := 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;
  v_caught boolean := false;
BEGIN
  -- Inserting contribution into closed 2025 must fail with YEAR_CLOSED
  BEGIN
    INSERT INTO public.contributions (member_id, amount, period_start, kind, paid_on)
    VALUES (v_user1_id, 200, '2025-05-01', 'monthly', '2025-05-05');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'YEAR_CLOSED:%' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 3a: contribution into closed year was not rejected';
  END IF;

  -- Inserting zakat payment into closed 2025 must fail with YEAR_CLOSED
  v_caught := false;
  BEGIN
    INSERT INTO public.zakat_payments (member_id, year, amount, paid_on)
    VALUES (v_user1_id, 2025, 1000, '2025-04-01');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'YEAR_CLOSED:%' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 3b: zakat payment into closed year was not rejected';
  END IF;

  -- Reopening 2025 without a reason must fail
  v_caught := false;
  BEGIN
    UPDATE public.fiscal_years SET status = 'open', reopen_reason = '' WHERE label = '2025';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'REOPEN_REASON_REQUIRED:%' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 3c: reopening closed year without reason was not rejected';
  END IF;

  -- Hard delete must fail
  v_caught := false;
  BEGIN
    DELETE FROM public.contributions WHERE id = '60000000-0000-0000-0000-000000000001'::uuid;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'HARD_DELETE_FORBIDDEN:%' THEN
      v_caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 3d: hard delete was not rejected';
  END IF;

  RAISE NOTICE 'PASS TEST 3: Closed fiscal year lock, reopen reason check, and hard-delete prevention';
END $$;

-- =============================================================================
-- TEST 4: Public Read-Only Viewer (`anon`) & Non-Admin (`user`):
-- Can read community register cleanly, ZERO access to audit_log, ZERO writes!
-- =============================================================================
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{}', true);

DO $$
DECLARE
  v_count int;
  v_pull jsonb;
  v_caught boolean := false;
BEGIN
  -- Viewer can read full register (all profiles, contributions, zakat)
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'FAIL TEST 4a: public viewer expected >=3 profiles, saw %', v_count;
  END IF;

  -- Viewer can pull changes offline via pull_changes()
  v_pull := public.pull_changes(NULL, ARRAY['profiles', 'contributions', 'zakat_assessments']);
  IF jsonb_array_length(v_pull->'changes'->'profiles') < 3 THEN
    RAISE EXCEPTION 'FAIL TEST 4b: public viewer pull_changes missing profiles: %', v_pull;
  END IF;

  -- Viewer CANNOT read audit_log
  BEGIN
    SELECT count(*) INTO v_count FROM public.audit_log;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 4c: anon viewer could query audit_log!';
  END IF;

  -- Viewer CANNOT write to contributions
  v_caught := false;
  BEGIN
    INSERT INTO public.contributions (member_id, amount, period_start, kind, paid_on)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 200, '2026-02-01', 'monthly', '2026-02-01');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 4d: anon viewer inserted contribution!';
  END IF;

  -- Viewer CANNOT call push_changes()
  v_caught := false;
  BEGIN
    PERFORM public.push_changes('[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 4e: anon viewer executed push_changes()!';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated"}', true);

DO $$
DECLARE
  v_count int;
  v_push jsonb;
  v_caught boolean := false;
BEGIN
  -- Non-admin cannot read audit_log
  SELECT count(*) INTO v_count FROM public.audit_log;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL TEST 4f: non-admin user read audit_log (%)', v_count;
  END IF;

  -- Non-admin cannot write to contributions
  BEGIN
    INSERT INTO public.contributions (member_id, amount, period_start, kind, paid_on)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, 200, '2026-02-01', 'monthly', '2026-02-01');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'FAIL TEST 4g: non-admin user inserted contribution!';
  END IF;

  -- Non-admin cannot escalate own role to admin
  UPDATE public.profiles SET role = 'admin' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid;
  IF public.is_admin() THEN
    RAISE EXCEPTION 'FAIL TEST 4h: non-admin escalated role to admin!';
  END IF;

  -- push_changes() rejects non-admin writes via RLS
  v_push := public.push_changes(jsonb_build_array(
    jsonb_build_object(
      'outbox_id', 'u-try-1',
      'table', 'contributions',
      'op', 'insert',
      'record_id', '60000000-0000-0000-0000-000000000099',
      'payload', jsonb_build_object(
        'member_id', 'bbbbbbbb-0000-0000-0000-000000000001',
        'amount', 500,
        'period_start', '2026-02-01',
        'kind', 'monthly',
        'paid_on', '2026-02-05'
      )
    )
  ));
  IF (v_push->'results'->0->>'status') <> 'rejected' THEN
    RAISE EXCEPTION 'FAIL TEST 4i: push_changes allowed non-admin write: %', v_push;
  END IF;

  RAISE NOTICE 'PASS TEST 4: Public read-only viewer & non-admin write/audit lock enforced by RLS';
END $$;

-- =============================================================================
-- TEST 5: Admin CRUD, Sync Quarantine (non-blocking), Conflict Merge & Loser Audit
-- =============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

DO $$
DECLARE
  v_pull jsonb;
  v_push jsonb;
  v_r0 jsonb;
  v_r1 jsonb;
  v_conflict_res jsonb;
  v_loser_count int;
  v_soft_res jsonb;
  v_remark text;
  v_amount int;
BEGIN
  -- Admin sees ALL profiles & zakat_assessments via pull_changes
  v_pull := public.pull_changes(NULL, ARRAY['profiles', 'zakat_assessments']);
  IF jsonb_array_length(v_pull->'changes'->'profiles') < 3
     OR jsonb_array_length(v_pull->'changes'->'zakat_assessments') < 1 THEN
    RAISE EXCEPTION 'FAIL TEST 5a: admin pull_changes missing rows: %', v_pull;
  END IF;

  -- Batch push: item 0 hits closed year 2025 (must quarantine), item 1 hits open year 2026 (must SUCCEED!)
  v_push := public.push_changes(jsonb_build_array(
    jsonb_build_object(
      'outbox_id', 'bad-closed-year',
      'table', 'contributions',
      'op', 'insert',
      'record_id', '60000000-0000-0000-0000-000000000010',
      'payload', jsonb_build_object(
        'member_id', 'bbbbbbbb-0000-0000-0000-000000000001',
        'amount', 200,
        'period_start', '2025-11-01',
        'kind', 'monthly',
        'paid_on', '2025-11-05'
      )
    ),
    jsonb_build_object(
      'outbox_id', 'good-open-year',
      'table', 'contributions',
      'op', 'insert',
      'record_id', '60000000-0000-0000-0000-000000000011',
      'payload', jsonb_build_object(
        'member_id', 'bbbbbbbb-0000-0000-0000-000000000001',
        'amount', 250,
        'period_start', '2026-02-01',
        'kind', 'monthly',
        'paid_on', '2026-02-05',
        'remark', 'Feb cash'
      )
    )
  ));

  v_r0 := v_push->'results'->0;
  v_r1 := v_push->'results'->1;
  IF (v_r0->>'status') <> 'rejected' OR (v_r0->>'code') <> 'YEAR_CLOSED' THEN
    RAISE EXCEPTION 'FAIL TEST 5b: closed year mutation not quarantined cleanly: %', v_r0;
  END IF;
  IF (v_r1->>'status') <> 'accepted' THEN
    RAISE EXCEPTION 'FAIL TEST 5c: valid mutation in same batch was blocked: %', v_r1;
  END IF;

  -- Simulate two admins editing contribution 0011 offline from base_version = 1:
  -- Admin A pushes first (updates remark + amount -> server version becomes 2)
  PERFORM public.push_changes(jsonb_build_array(
    jsonb_build_object(
      'outbox_id', 'admin-a-edit',
      'table', 'contributions',
      'op', 'update',
      'record_id', '60000000-0000-0000-0000-000000000011',
      'base_version', 1,
      'changed_fields', jsonb_build_array('amount', 'remark'),
      'payload', jsonb_build_object('amount', 300, 'remark', 'Admin A note')
    )
  ));

  -- Admin B pushes later with stale base_version = 1 updating ONLY amount -> 400
  -- Expected: field-level merge keeps Admin A's remark ('Admin A note'), overwrites amount -> 400, logs loser (300) in audit_log!
  v_conflict_res := public.push_changes(jsonb_build_array(
    jsonb_build_object(
      'outbox_id', 'admin-b-edit',
      'table', 'contributions',
      'op', 'update',
      'record_id', '60000000-0000-0000-0000-000000000011',
      'base_version', 1,
      'changed_fields', jsonb_build_array('amount'),
      'payload', jsonb_build_object('amount', 400)
    )
  ));

  SELECT amount, remark INTO v_amount, v_remark
  FROM public.contributions
  WHERE id = '60000000-0000-0000-0000-000000000011'::uuid;

  IF v_amount <> 400 OR v_remark <> 'Admin A note' OR (v_conflict_res->'results'->0->>'status') <> 'conflict_merged' THEN
    RAISE EXCEPTION 'FAIL TEST 5d: field-level merge failed (amount=%, remark=%, res=%)', v_amount, v_remark, v_conflict_res;
  END IF;

  SELECT count(*) INTO v_loser_count
  FROM public.audit_log
  WHERE action = 'CONFLICT_LOSER'
    AND table_name = 'contributions'
    AND record_id = '60000000-0000-0000-0000-000000000011'::uuid;

  IF v_loser_count < 1 THEN
    RAISE EXCEPTION 'FAIL TEST 5e: conflict loser was not logged to audit_log';
  END IF;

  -- Soft-delete wins over subsequent stale edit
  PERFORM public.push_changes(jsonb_build_array(
    jsonb_build_object(
      'outbox_id', 'admin-void',
      'table', 'contributions',
      'op', 'soft_delete',
      'record_id', '60000000-0000-0000-0000-000000000011',
      'base_version', 3,
      'changed_fields', jsonb_build_array('void_reason'),
      'payload', jsonb_build_object('void_reason', 'Duplicate entry')
    )
  ));

  v_soft_res := public.push_changes(jsonb_build_array(
    jsonb_build_object(
      'outbox_id', 'stale-edit-after-void',
      'table', 'contributions',
      'op', 'update',
      'record_id', '60000000-0000-0000-0000-000000000011',
      'base_version', 2,
      'changed_fields', jsonb_build_array('amount'),
      'payload', jsonb_build_object('amount', 999)
    )
  ));

  IF (v_soft_res->'results'->0->>'status') <> 'conflict_server_wins'
     OR (v_soft_res->'results'->0->'record'->>'deleted_at') IS NULL THEN
    RAISE EXCEPTION 'FAIL TEST 5f: soft delete did not win over edit: %', v_soft_res;
  END IF;

  RAISE NOTICE 'PASS TEST 5: Admin CRUD, non-blocking quarantine, field-level merge, loser audit, and soft-delete-wins';
END $$;

ROLLBACK;
