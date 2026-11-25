# Anjuman Khata (انجمن کھاتہ)

Production-grade, **offline-first** React Native (Expo SDK 58) + Supabase mobile application that digitizes a community charity contribution register (~55–60 members) and a strictly separated Zakat register.

## Highlights
- **Offline-First Architecture**: Local SQLite (`expo-sqlite`, WAL mode) with instant optimistic reads/writes, chunked `expo-secure-store` session persistence for airplane-mode launches, registry-driven `pull_changes`/`push_changes` sync, field-level conflict merging with loser audit logging, and non-blocking quarantine (`YEAR_CLOSED`, validation errors).
- **Ledger-First Financial Integrity**: Append-only charity ledger (`contributions`) in integer PKR (never floats), effective-dated tier assignments & rate history (`member_tiers`, `tier_rates`) that never retroactively alter past compliance, `non_earning` exemption rules, and fiscal-year locking with audited reopening.
- **Strictly Isolated Zakat Subsystem**: Configurable yearly Nisab & basis notes (`zakat_settings`), exact integer half-up 2.5% calculation mirrored in TypeScript and Postgres triggers, immutable assessment snapshots (`zakat_assessments`), private RLS protection for declared assets, and a separate `zakat_payments` ledger.
- **Bilingual English + Urdu (RTL) & Offline PDFs**: Full EN/UR toggle with `I18nManager` RTL support, Heritage Emerald & Antique Gold visual separation, WhatsApp unpaid-list sharing, UTF-8 BOM CSV export, and 5 offline A4 PDF reports with embedded base64 `Noto Naskh Arabic` font.
- **Database-Enforced Security**: Row-Level Security on every table, `SECURITY INVOKER` sync RPCs, read-only standard users, tamper-evident `audit_log`, and server-only `admin-create-user` Edge Function.

## Quick Start
See [docs/setup.md](docs/setup.md) for the complete < 15-minute setup guide.

```bash
pnpm install
cp .env.example .env
pnpm run typecheck && pnpm run lint && pnpm test && pnpm run test:sql
npx expo start
```

## Documentation
- [Architecture Overview](docs/architecture.md)
- [Architectural Decisions & Assumptions](docs/decisions.md)
- [Developer Setup Guide](docs/setup.md)
