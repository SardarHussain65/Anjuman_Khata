# Architecture — Anjuman Khata

## 1. System Overview

**Anjuman Khata** is an offline-first Expo / React Native mobile application backed by Supabase (PostgreSQL 16 + Auth + RLS + Edge Functions) for digitizing a ~55-member community charity register and separate Zakat register.

```text
Screens (src/app/, src/features/*/screens)
  └─> Feature Hooks & Pure Rules (src/core/rules/)
        └─> Local SQLite DB + Reactive Live Queries (src/data/db/)
              └─> Registry-Driven Sync Engine (src/data/sync/)
                    └─> Supabase RPCs & Edge Functions (src/data/api/)
                          └─> Postgres + RLS + Triggers (supabase/migrations/)
```

UI components never import `supabase` directly. Every operational read and write hits local SQLite first for instant optimistic rendering and airplane-mode reliability.

## 2. Ledger-First Data Model

- **Append-only charity ledger (`contributions`)**: Each monthly/special/advance payment is a row with integer PKR `amount > 0`, `period_start` (first of calendar month), `paid_on`, `kind` (`monthly | special | advance` — never `zakat`), and optional `void_reason` (soft-delete via `deleted_at`).
- **Effective-dated tiers (`tiers`, `tier_rates`, `member_tiers`)**: Both tier assignments and tier minimum changes are effective-dated so past months' compliance is never altered retroactively.
- **Strictly isolated Zakat subsystem (`zakat_settings`, `zakat_assessments`, `zakat_payments`)**:
  - `zakat_settings` stores yearly `nisab_amount`, `rate_bps` (default `250` = 2.5%), and `basis_note`. Never hardcoded in UI.
  - `zakat_assessments` snapshots `nisab_used`, `rate_bps`, `assets`, `liabilities`, `net_zakatable`, and `due_amount`. A Postgres `BEFORE INSERT OR UPDATE` trigger recomputes `net_zakatable` and `due_amount` using exact integer half-up math (`(net * rate_bps + 5000) / 10000`).
  - `zakat_payments` is a separate ledger; Zakat sums never enter charity totals.
- **Fiscal years (`fiscal_years`)**: Honor `org_settings.fiscal_year_start_month`. Closing a fiscal year activates triggers rejecting inserts/updates/voids on `contributions` and `zakat_payments` in that period (`YEAR_CLOSED`). Reopening requires a non-empty `reopen_reason` and is recorded in `audit_log`.
- **Tamper-evident audit log (`audit_log`)**: Server-written only via `SECURITY DEFINER` triggers on all 10 synced tables; read-only for admins; immutable (`UPDATE`/`DELETE` blocked by trigger).

## 3. Security Boundary (Defense in Depth)

1. **Database RLS**: Enabled on every table. `public.is_admin()` (`SECURITY DEFINER`) checks `profiles.role = 'admin' AND deleted_at IS NULL`.
   - Standard users: `SELECT` own rows (`id = auth.uid()` or `member_id = auth.uid()`) + shared config (`tiers`, `tier_rates`, `fiscal_years`, `zakat_settings`, `org_settings`). Zero write policies anywhere. No access to other members' rows or sensitive `zakat_assessments` assets.
   - Admins: Full CRUD on all business tables, `SELECT` on `audit_log`.
2. **Sync RPCs (`pull_changes`, `push_changes`)**: `SECURITY INVOKER` so Postgres RLS applies automatically to every pulled or pushed row.
3. **Admin Account Provisioning (`supabase/functions/admin-create-user`)**: Holds `SUPABASE_SERVICE_ROLE_KEY` exclusively server-side, verifies caller JWT + admin role, creates Auth user + profile (+ optional initial tier) atomically, and supports password resets.
4. **Client Route Isolation**: Expo Router `<Stack.Protected>` omits `(admin)` routes completely from a standard user's navigator.

## 4. Offline-First Sync & Quarantine Protocol

- **Registry (`src/data/sync/registry.ts`)**: Declares all 10 synced tables, push dependency order, role scope, and conflict policy. Adding an entity requires only one registry entry.
- **Conflict Policies**:
  - `contributions`, `zakat_payments` (`ledger_field_merge`): Client UUID inserts are idempotent; concurrent updates merge non-overlapping fields, later server-received write wins on overlapping fields with loser logged to `audit_log` (`CONFLICT_LOSER`); **soft delete wins over edit**.
  - `profiles`, `member_tiers`, `zakat_assessments` (`mutable_field_merge`): `base_version` check + field-level merge + loser audit logging.
  - `org_settings`, `tiers`, `tier_rates`, `fiscal_years`, `zakat_settings` (`server_wins`): Server wins on version mismatch.
- **Non-Blocking Quarantine**: `push_changes()` wraps each mutation in a Postgres sub-transaction savepoint. A rejected mutation (e.g. `YEAR_CLOSED`) moves into `sync_quarantine` with a human-readable localized reason while all valid mutations in the same batch succeed.
- **Session Persistence**: Supabase Auth uses a chunked `expo-secure-store` adapter (`src/data/api/secureStorageAdapter.ts`, avoiding Android's 2048-byte key cap) plus cached profile metadata so app relaunches in airplane mode enter the correct navigator immediately.

## 5. Offline PDF & Urdu RTL Pipeline

- Pure `data → HTML` templates (`src/features/reports/templates/`) generate all 5 reports (A4 landscape annual ledger, financial summary, individual member statement, Zakat report, unpaid/short list) plus UTF-8 BOM CSV.
- Bundles `@expo-google-fonts/noto-naskh-arabic`, reads the local TTF via `expo-asset` + `expo-file-system` as base64 at export time, and embeds it via `@font-face` so Urdu (`dir="rtl"`) renders reliably offline in `expo-print` and shares via `expo-sharing`.
