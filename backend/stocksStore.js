const fs = require('fs').promises;
const path = require('path');

const STOCKS_FILE = path.join(__dirname, 'data', 'stocks.json');

async function readStocks() {
  try {
    const raw = await fs.readFile(STOCKS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function writeStocks(records) {
  await fs.mkdir(path.dirname(STOCKS_FILE), { recursive: true });
  await fs.writeFile(STOCKS_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function toNonNegNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const BAG_BRANDS = ['tokyo', 'samudra', 'atlas', 'nippon'];

/** Subtract sold bags from the load row whose stockId matches (credit sale). Empty stockId skips deduction. */
function applyBillDeductionToLoads(stocks, stockId, billBags) {
  const sid = String(stockId ?? '').trim();
  if (!sid) return { ok: true };

  const load = stocks.find((s) => String(s.stockId || '').trim() === sid);
  if (!load) {
    return {
      ok: false,
      error: `No load with Stock ID "${sid}". Add it on Loads or correct the Stock ID on the bill.`,
    };
  }

  for (const k of BAG_BRANDS) {
    const field = `${k}Bags`;
    const have = toNonNegNumber(load[field]);
    const need = toNonNegNumber(billBags[field]);
    if (need > have) {
      return {
        ok: false,
        error: `Not enough ${k} bags on load ${sid}: have ${have}, this sale needs ${need}.`,
      };
    }
  }

  for (const k of BAG_BRANDS) {
    const field = `${k}Bags`;
    load[field] = toNonNegNumber(load[field]) - toNonNegNumber(billBags[field]);
  }

  return { ok: true };
}

module.exports = { readStocks, writeStocks, toNonNegNumber, applyBillDeductionToLoads };
