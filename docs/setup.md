# Developer Setup Guide (< 15 Minutes)

## Prerequisites
- **Node.js** 20+ (tested on v24.11) and **pnpm** 10+
- **Supabase CLI** (`brew install supabase/tap/supabase`) and optionally Docker (or local PostgreSQL 16 for instant SQL tests)
- **Expo Go** (quick UI preview) or **Expo Dev Client** / **EAS CLI** for full native builds

## 1. Install Dependencies
```bash
pnpm install
```

## 2. Configure Environment
Copy `.env.example` to `.env` and fill in your Supabase project URL and **anon** key (free tier Supabase works out of the box for 50–60 members):
```bash
cp .env.example .env
```
> Never put `SUPABASE_SERVICE_ROLE_KEY` in `.env` with `EXPO_PUBLIC_` prefix or commit `.env`.

## 3. Set Up Supabase Database (Local or Free-Tier Cloud)

### Option A: Hosted Supabase (Free Tier — Recommended for small communities)
1. Create a free project at https://supabase.com
2. Link and push migrations + seed:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push --remote --include-seed
   ```
3. Deploy the admin Edge Function:
   ```bash
   supabase functions deploy admin-create-user
   ```
4. Create your first Admin account in Supabase Dashboard → Authentication → Users, then insert their matching row in `public.profiles` with `role = 'admin'` and `member_no = 1`.

### Option B: Local Supabase (Docker)
```bash
supabase start
supabase db reset   # applies all migrations + seed.sql
supabase functions serve admin-create-user
```

## 4. Import Existing Paper Register CSV (Optional)
Preview first with `--dry-run`:
```bash
npx tsx scripts/import-ledger.ts scripts/sample-register.csv --year 2026 --dry-run
```
Then run live using your server-side service role key (shell env only):
```bash
EXPO_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npx tsx scripts/import-ledger.ts path/to/your-register.csv --year 2026
```

## 5. Run the App
```bash
npx expo start
```
For a full custom development build (recommended for production testing):
```bash
npx expo run:android   # or npx expo run:ios
# Or cloud build via EAS (no Xcode/Android Studio required):
npx eas-cli@latest build --profile development --platform android
```

## 6. Verification Commands
```bash
pnpm run typecheck     # TypeScript strict check
pnpm run lint          # Expo ESLint check
pnpm test              # Jest + RNTL unit & sync tests
pnpm run test:sql      # Real PostgreSQL 16 RLS, triggers, Zakat, & sync RPC tests
```
