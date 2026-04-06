const fs = require('fs').promises;
const path = require('path');
const { readStocks, toNonNegNumber } = require('./stocksStore');
const { readBills, aggregateOutsByDateFromBills } = require('./billsStore');

const DAILY_FILE = path.join(__dirname, 'data', 'dailyStock.json');

const BRAND_KEYS = ['tokyo', 'samudra', 'atlas', 'nippon'];
const BAG_FIELDS = {
  tokyo: 'tokyoBags',
  samudra: 'samudraBags',
  atlas: 'atlasBags',
  nippon: 'nipponBags',
};

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function todayYmdLocal() {
  const dt = new Date();
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function maxYmd(a, b) {
  return a >= b ? a : b;
}

function emptyBrandMap() {
  return { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
}

function aggregateLoadsByDate(loads) {
  const map = {};
  for (const row of loads) {
    const d = String(row.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!map[d]) map[d] = emptyBrandMap();
    for (const k of BRAND_KEYS) {
      map[d][k] += toNonNegNumber(row[BAG_FIELDS[k]]);
    }
  }
  return map;
}

function eachDateInclusive(fromYmd, toYmd) {
  const out = [];
  let cur = fromYmd;
  for (;;) {
    if (cur > toYmd) break;
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

/** Build daily ledger: start-of-day balance, bags in (loads that day), out (bills / credit sales that day), end-of-day. */
function buildDailyStockPayload(loads, bills) {
  const inByDate = aggregateLoadsByDate(loads);
  const outByDate = aggregateOutsByDateFromBills(Array.isArray(bills) ? bills : []);
  const allKeys = new Set([...Object.keys(inByDate), ...Object.keys(outByDate)]);
  if (allKeys.size === 0) {
    return { generatedAt: new Date().toISOString(), days: [] };
  }

  const sortedDates = [...allKeys].sort();
  const minDate = sortedDates[0];
  const maxActivityDate = sortedDates[sortedDates.length - 1];
  const endDate = maxYmd(maxActivityDate, todayYmdLocal());

  const days = [];
  let prevEnd = emptyBrandMap();

  for (const date of eachDateInclusive(minDate, endDate)) {
    const inn = inByDate[date] || emptyBrandMap();
    const outv = outByDate[date] || emptyBrandMap();

    const brands = {};
    for (const k of BRAND_KEYS) {
      const start = prevEnd[k];
      const inBags = inn[k];
      const outBags = outv[k];
      const end = start + inBags - outBags;
      brands[k] = { start: start, in: inBags, out: outBags, end: end };
      prevEnd[k] = end;
    }
    days.push({ date, brands });
  }

  return { generatedAt: new Date().toISOString(), days };
}

async function writeDailyStock(payload) {
  await fs.mkdir(path.dirname(DAILY_FILE), { recursive: true });
  await fs.writeFile(DAILY_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

async function rebuildAndPersistDailyStock(loadsOptional, billsOptional) {
  const loads = loadsOptional != null ? loadsOptional : await readStocks();
  const bills = billsOptional != null ? billsOptional : await readBills();
  const payload = buildDailyStockPayload(loads, bills);
  await writeDailyStock(payload);
  return payload;
}

module.exports = {
  rebuildAndPersistDailyStock,
  buildDailyStockPayload,
  writeDailyStock,
  DAILY_FILE,
};
