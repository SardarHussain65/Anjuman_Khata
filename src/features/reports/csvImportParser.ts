const MONTH_COLS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

export interface ParsedMemberImport {
  member_no: number;
  full_name: string;
  designation: string | null;
  tier_code: string | null;
  status: 'active' | 'non_earning';
  monthly_contributions: { period_start: string; amount: number; remark: string | null }[];
  yearly_charity_total: number;
  zakat_amount: number;
  remarks: string | null;
}

export interface ParsedRegisterResult {
  year: number;
  members: ParsedMemberImport[];
  totalCharity: number;
  totalZakat: number;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseIntRupees(raw: string | undefined, label: string): number {
  const cleaned = (raw ?? '').replace(/Rs\.?/gi, '').replace(/[,\s]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
  if (!/^\d+$/.test(cleaned)) {
    throw new Error(`Invalid integer PKR value "${raw}" for ${label}`);
  }
  return Number.parseInt(cleaned, 10);
}

/**
 * Pure parser for paper-register CSVs:
 * `member_no,name,designation,tier,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec,zakat,remarks`
 * Routes monthly amounts into charity contributions and Zakat strictly into Zakat payments.
 */
export function parseRegisterCsv(csvText: string, year: number): ParsedRegisterResult {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include header row and at least one member row.');
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const colIdx = (name: string) => headers.indexOf(name);

  if (colIdx('member_no') < 0 || colIdx('name') < 0) {
    throw new Error('CSV header must contain at least member_no and name columns.');
  }

  const members: ParsedMemberImport[] = [];
  let totalCharity = 0;
  let totalZakat = 0;

  for (let r = 1; r < lines.length; r += 1) {
    const cells = splitCsvLine(lines[r]);
    const memberNo = parseIntRupees(cells[colIdx('member_no')], `row ${r + 1} member_no`);
    const fullName = cells[colIdx('name')]?.trim();
    if (!memberNo || !fullName) continue;

    const designation = colIdx('designation') >= 0 ? cells[colIdx('designation')] || null : null;
    const rawTier = colIdx('tier') >= 0 ? cells[colIdx('tier')]?.trim().toLowerCase() || null : null;
    const remarks = colIdx('remarks') >= 0 ? cells[colIdx('remarks')] || null : null;

    const monthly_contributions: { period_start: string; amount: number; remark: string | null }[] = [];
    let yearlyCharityTotal = 0;

    MONTH_COLS.forEach((mCol, idx) => {
      const i = colIdx(mCol);
      if (i < 0) return;
      const amt = parseIntRupees(cells[i], `member #${memberNo} ${mCol}`);
      if (amt > 0) {
        const mm = String(idx + 1).padStart(2, '0');
        monthly_contributions.push({
          period_start: `${year}-${mm}-01`,
          amount: amt,
          remark: remarks,
        });
        yearlyCharityTotal += amt;
      }
    });

    const zakatIdx = colIdx('zakat');
    const zakatAmount =
      zakatIdx >= 0 ? parseIntRupees(cells[zakatIdx], `member #${memberNo} zakat`) : 0;

    const status: 'active' | 'non_earning' =
      !rawTier && yearlyCharityTotal === 0 ? 'non_earning' : 'active';

    totalCharity += yearlyCharityTotal;
    totalZakat += zakatAmount;

    members.push({
      member_no: memberNo,
      full_name: fullName,
      designation,
      tier_code: rawTier,
      status,
      monthly_contributions,
      yearly_charity_total: yearlyCharityTotal,
      zakat_amount: zakatAmount,
      remarks,
    });
  }

  return { year, members, totalCharity, totalZakat };
}
