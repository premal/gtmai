// Bulk-load the account universe from CSV into the `Account` table.
//
//   tsx prisma/import-accounts.ts <file.csv> [--max N]
//
// Expected columns (header-flexible; extra columns land in `data`):
//   name, domain, linkedin_url, industry, size, employees, revenue_musd,
//   city | hq_city, state | hq_state, country, founded, ticker, source
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { PrismaClient } from '@prisma/client';

const BATCH = 5000;
const HEADER_MAP: Record<string, string> = {
  name: 'name',
  domain: 'domain',
  website: 'domain',
  linkedin_url: 'linkedinUrl',
  linkedinurl: 'linkedinUrl',
  industry: 'industry',
  size: 'size',
  employees: 'employees',
  number_of_employees: 'employees',
  revenue_musd: 'revenueUsdM',
  revenues_m: 'revenueUsdM',
  city: 'city',
  hq_city: 'city',
  state: 'state',
  hq_state: 'state',
  country: 'country',
  founded: 'founded',
  ticker: 'ticker',
  source: 'source',
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v: string) => {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) ? n : undefined;
};

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error('usage: tsx prisma/import-accounts.ts <file.csv> [--max N]');
    process.exit(1);
  }
  const maxIdx = rest.indexOf('--max');
  const max = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : Infinity;

  const prisma = new PrismaClient();
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });

  let header: string[] | null = null;
  let pending = '';
  let batch: Record<string, unknown>[] = [];
  let total = 0;

  const flush = async () => {
    if (!batch.length) return;
    await prisma.account.createMany({ data: batch as never[], skipDuplicates: true });
    total += batch.length;
    batch = [];
    if (total % 100000 === 0) console.log(`imported ${total}…`);
  };

  for await (const raw of rl) {
    if (total >= max) break;
    pending = pending ? pending + '\n' + raw : raw;
    if ((pending.match(/"/g) ?? []).length % 2 === 1) continue; // quoted field w/ newline
    const line = pending;
    pending = '';
    if (!header) {
      header = parseCsvLine(line).map((h) => h.trim().toLowerCase());
      continue;
    }
    const cells = parseCsvLine(line);
    const rec: Record<string, unknown> = {};
    const extra: Record<string, string> = {};
    header.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      if (v === '') return;
      const field = HEADER_MAP[h];
      if (!field) {
        extra[h] = v;
        return;
      }
      if (field === 'employees' || field === 'founded') rec[field] = num(v);
      else if (field === 'revenueUsdM') rec[field] = num(v);
      else if (field === 'domain')
        rec[field] = v
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0];
      else if (field === 'linkedinUrl') {
        rec[field] = /^https?:/.test(v) ? v : `https://www.${v.replace(/^www\./, '')}`;
      } else rec[field] = v;
    });
    if (!rec.name) continue;
    rec.domain = rec.domain || undefined;
    if (Object.keys(extra).length) rec.data = extra;
    batch.push(rec);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  const count = await prisma.account.count();
  console.log(`done: imported ${total} rows; Account total = ${count}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
