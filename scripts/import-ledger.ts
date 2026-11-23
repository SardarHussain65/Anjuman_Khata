#!/usr/bin/env tsx
/**
 * Paper-register CSV importer CLI for Anjuman Khata.
 * Usage:
 *   npx tsx scripts/import-ledger.ts scripts/sample-register.csv --year 2026 --dry-run
 *   EXPO_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/import-ledger.ts path/to/register.csv --year 2026
 */

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parseRegisterCsv } from '../src/features/reports/csvImportParser';

async function runCli() {
  const args = process.argv.slice(2);
  const csvPath = args[0];
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/import-ledger.ts <csv-path> --year 2026 [--dry-run]');
    process.exit(1);
  }
  const yearFlagIdx = args.indexOf('--year');
  const year = yearFlagIdx >= 0 ? Number.parseInt(args[yearFlagIdx + 1], 10) : new Date().getFullYear();
  const dryRun = args.includes('--dry-run');

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const parsed = parseRegisterCsv(csvText, year);

  console.log(
    `Parsed ${parsed.members.length} members for ${year}: Charity = Rs ${parsed.totalCharity.toLocaleString()}, Zakat (separate) = Rs ${parsed.totalZakat.toLocaleString()}`,
  );

  if (dryRun) {
    for (const m of parsed.members) {
      console.log(
        `  #${m.member_no} ${m.full_name} [${m.status}] -> Charity Rs ${m.yearly_charity_total}, Zakat Rs ${m.zakat_amount}`,
      );
    }
    return;
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tierRows, error: tierErr } = await supabase.from('tiers').select('id, code');
  if (tierErr) throw tierErr;
  const tierIdByCode = new Map((tierRows ?? []).map((t) => [t.code, t.id]));

  for (const m of parsed.members) {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('member_no', m.member_no)
      .maybeSingle();

    let memberId = existingProfile?.id as string | undefined;
    if (!memberId) {
      const { data: inserted, error: profErr } = await supabase
        .from('profiles')
        .insert({
          member_no: m.member_no,
          full_name: m.full_name,
          designation: m.designation,
          status: m.status,
          role: 'user',
          joined_on: `${year}-01-01`,
          notes: m.remarks,
        })
        .select('id')
        .single();
      if (profErr) throw profErr;
      memberId = inserted.id;
    }

    if (m.tier_code && tierIdByCode.has(m.tier_code)) {
      await supabase.from('member_tiers').insert({
        member_id: memberId,
        tier_id: tierIdByCode.get(m.tier_code),
        effective_from: `${year}-01-01`,
        reason: 'Imported from paper register CSV',
      });
    }

    if (m.monthly_contributions.length > 0) {
      const { error: contribErr } = await supabase.from('contributions').insert(
        m.monthly_contributions.map((c) => ({
          member_id: memberId,
          amount: c.amount,
          period_start: c.period_start,
          kind: 'monthly',
          paid_on: c.period_start,
          remark: c.remark,
        })),
      );
      if (contribErr) throw contribErr;
    }

    if (m.zakat_amount > 0) {
      const { error: zErr } = await supabase.from('zakat_payments').insert({
        member_id: memberId,
        year,
        amount: m.zakat_amount,
        paid_on: `${year}-06-01`,
        remark: m.remarks ?? 'Imported from paper register Zakat column',
      });
      if (zErr) throw zErr;
    }
  }

  console.log('✅ CSV import complete.');
}

runCli().catch((err) => {
  console.error('❌ Import failed:', err);
  process.exit(1);
});
