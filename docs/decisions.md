# Architectural Decisions & Assumptions — Anjuman Khata

## ADR-001: Local SQLite Engine (`expo-sqlite` vs `@nozbe/watermelondb`)
- **Decision**: Use Expo's first-party `expo-sqlite` (WAL mode, JSI-backed) paired with a lightweight reactive live-query subscription layer and a declarative, registry-driven `pullChanges`/`pushChanges` sync engine (`src/data/sync/`).
- **Rationale**:
  1. **Expo SDK 58 & React Native 0.88 Bridgeless Compatibility**: This repository targets Expo SDK 58 + RN 0.88 (mandatory New Architecture / Bridgeless) + React Compiler + TypeScript 6. `@nozbe/watermelondb` requires legacy Babel decorators (`@babel/plugin-proposal-decorators`), third-party Expo config plugins, and native C++/Gradle patches that frequently break across Expo SDK upgrades. `expo-sqlite` is first-party, ships SDK-matched versions via `npx expo install`, and runs in Expo Dev Client, Expo Go, and Jest tests without native hacks.
  2. **Sync Engine Control**: Our offline sync specification requires per-field dirty tracking (`changed_fields`), optimistic `base_version` conflict checks, loser audit logging, and **non-blocking per-item quarantine** (e.g., `YEAR_CLOSED` rejected while valid entries in the same batch succeed). Implementing the registry-driven sync engine directly over `expo-sqlite` with explicit `sync_outbox` and `sync_quarantine` tables makes these guarantees simple, transparent, and thoroughly unit-testable.
  3. **Dataset Scale & Cost**: A ~55-member community register over 10+ years represents ~6,000–10,000 rows (< 5 MB), which `expo-sqlite` queries in sub-millisecond time while staying 100% free alongside Supabase's Free Tier (500 MB Postgres).

## ADR-002: Non-Retroactive Tier Minimums (`tier_rates`)
- **Decision**: Maintain `tiers.min_amount` for quick display of the active tier minimum, AND store effective-dated history in `tier_rates (tier_id, min_amount, effective_from)`.
- **Rationale**: Business rule 3.1 mandates that changing a tier or a tier's minimum is **never retroactive**. Without `tier_rates`, raising `small_business` from 200 PKR to 300 PKR in July would retroactively mark Jan–Jun 200 PKR payments as `short`. Both Postgres (`get_member_effective_tier`) and TypeScript (`src/core/rules/tiers.ts`) resolve the rate effective on or before the target month.

## ADR-003: Member Profiles & Offline Creation (`profiles.id`)
- **Decision**: `profiles.id` is a `uuid PRIMARY KEY` matching `auth.users.id` for every login-enabled member created via the `admin-create-user` Edge Function, without a blocking FK to `auth.users` so CSV-imported paper-register members and offline-created directory members can exist and sync cleanly before login credentials are provisioned.
- **Security Impact**: None — Postgres RLS enforces `id = auth.uid()` and `member_id = auth.uid()` against the verified JWT subject (`auth.uid()`), so no unlinked profile can ever be accessed by another standard user.

## ADR-004: Sync Cursor Safety & Server Timestamps
- **Decision**: Every synced table stamps `updated_at = clock_timestamp()` and increments `version` via `BEFORE INSERT OR UPDATE` triggers, ignoring client timestamps. `pull_changes()` applies a 2-second lookback overlap window (`updated_at > p_last_pulled_at - interval '2 seconds'`) combined with idempotent client upserts.
- **Rationale**: Eliminates clock-skew bugs and Postgres MVCC snapshot boundary gaps where a concurrent transaction commits with an `updated_at` slightly before another client's pull timestamp.

## ADR-005: Charts Library (`react-native-gifted-charts`)
- **Decision**: Use `react-native-gifted-charts` (`react-native-svg` + `expo-linear-gradient`) instead of `victory-native` (Skia).
- **Rationale**: Smaller native binary size, lower GPU memory footprint on budget Android devices, and simpler RTL bar/donut configuration.

## ADR-006: Passwordless Read-Only Community Viewer & Admin-Only Authentication
- **Decision**: Normal community members open the app directly into a full-register **Read-Only Viewer** without needing an email, password, or Auth account (`anon` role granted `SELECT` only via `20261123000006_public_readonly_viewer.sql`). Only Admins authenticate with email/password to unlock write actions.
- **Offline Benefit**: Regular members are created directly in `profiles` via `localInsert` (100% offline-capable, zero Edge Function or Auth account required), while `pull_changes()` allows viewers to download and browse the entire community register offline. `audit_log` and all write operations remain strictly locked to authenticated Admins in Postgres RLS.

## Assumptions
1. **Default Fiscal Year**: `org_settings.fiscal_year_start_month` defaults to `1` (calendar year Jan–Dec) and is configurable by admins anytime.
2. **Timezone**: All cycle boundaries and "current month" evaluations use `Asia/Karachi` (`UTC+5`, no DST).
3. **Zakat Closed-Year Check**: A Zakat payment is blocked if either its `paid_on` date or its `year` maps to a `closed` row in `fiscal_years`.
4. **Offline Auth Session**: Supabase JWT sessions are persisted via a chunked `expo-secure-store` adapter (handling Android's 2048-byte limit) alongside the cached user profile/role in local SQLite so airplane-mode launches enter the correct role navigator immediately.
