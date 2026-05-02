import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import {
  TableFiltersBar,
  filterControl,
  inDateRange,
  scrollTableWrap,
  stickyThead,
} from './tableToolbar';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

/** Matches backend `paymentCreditToCustomer`: cash + cheque credited to the customer. */
function paymentTotal(p) {
  const total = Number(p.amount) || 0;
  if (total > 0) return total;
  return (Number(p.cashAmount) || 0) + (Number(p.chequeAmount) || 0);
}

/** Physical cash in + bank deposit line (all treated as banked daily). */
function cashPortion(p) {
  if (p.cashAmount !== undefined || p.chequeAmount !== undefined) {
    return Math.max(0, Number(p.cashAmount) || 0);
  }
  return paymentTotal(p);
}

function chequePortion(p) {
  return Math.max(0, Number(p.chequeAmount) || 0);
}

function buildDailyRows(payments) {
  const map = new Map();
  for (const p of payments) {
    const d = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const cash = cashPortion(p);
    const chq = chequePortion(p);
    const cur = map.get(d) || { date: d, cashIn: 0, bankDeposit: 0, totalIncome: 0 };
    cur.cashIn += cash;
    cur.bankDeposit += cash;
    cur.totalIncome += cash + chq;
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function buildChequeRows(payments) {
  const rows = [];
  for (const p of payments) {
    const amt = chequePortion(p);
    if (amt <= 0) continue;
    const chequeDate = String(p.chequeDate || p.date || '').slice(0, 10);
    rows.push({
      id: p.id,
      chequeDate,
      amount: amt,
      chequeNumber: String(p.chequeNumber ?? '').trim() || '—',
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      paymentDate: String(p.date ?? '').slice(0, 10) || '—',
      sortAt: p.createdAt || `${p.date}T12:00:00`,
    });
  }
  rows.sort((a, b) => {
    const cmp = a.chequeDate.localeCompare(b.chequeDate);
    if (cmp !== 0) return cmp;
    return String(a.sortAt).localeCompare(String(b.sortAt));
  });
  return rows;
}

const tabBtn =
  'rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const tabActive = 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80';
const tabIdle = 'text-slate-600 hover:bg-white/60';

export default function BankPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('cash');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
      const data = await res.json();
      setPayments(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dailyAll = useMemo(() => buildDailyRows(payments), [payments]);
  const dailyRows = useMemo(
    () => dailyAll.filter((r) => inDateRange(r.date, dateFrom, dateTo)),
    [dailyAll, dateFrom, dateTo],
  );

  const chequeAll = useMemo(() => buildChequeRows(payments), [payments]);
  const chequeRows = useMemo(
    () =>
      chequeAll.filter((r) => {
        if (!inDateRange(r.chequeDate, dateFrom, dateTo)) return false;
        return true;
      }),
    [chequeAll, dateFrom, dateTo],
  );

  const dailyTotals = useMemo(() => {
    return dailyRows.reduce(
      (acc, r) => ({
        cashIn: acc.cashIn + r.cashIn,
        bankDeposit: acc.bankDeposit + r.bankDeposit,
        totalIncome: acc.totalIncome + r.totalIncome,
      }),
      { cashIn: 0, bankDeposit: 0, totalIncome: 0 },
    );
  }, [dailyRows]);

  const chequeTotal = useMemo(
    () => chequeRows.reduce((s, r) => s + r.amount, 0),
    [chequeRows],
  );

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h1 className="text-lg font-bold text-slate-900">Bank</h1>
        <p className="mt-1 text-sm text-slate-500">
          Daily cash taken in is treated as deposited to the bank. Total income is cash plus cheques (same as customer
          settlement). Use the filters to narrow dates; the Cheque tab lists cheques in <span className="font-medium">cheque date</span> order.
        </p>
      </div>

      <TableFiltersBar
        hint={
          tab === 'cash'
            ? !loading && dailyRows.length > 0
              ? `${dailyRows.length} day${dailyRows.length === 1 ? '' : 's'} in range`
              : null
            : !loading && chequeRows.length > 0
              ? `${chequeRows.length} cheque${chequeRows.length === 1 ? '' : 's'} in range`
              : null
        }
      >
        <label className="block min-w-[140px] text-sm font-medium text-slate-600">
          From date
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={filterControl}
          />
        </label>
        <label className="block min-w-[140px] text-sm font-medium text-slate-600">
          To date
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={filterControl}
          />
        </label>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="inline-flex rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
        <button
          type="button"
          className={`${tabBtn} ${tab === 'cash' ? tabActive : tabIdle}`}
          onClick={() => setTab('cash')}
        >
          Cash IN
        </button>
        <button
          type="button"
          className={`${tabBtn} ${tab === 'cheque' ? tabActive : tabIdle}`}
          onClick={() => setTab('cheque')}
        >
          Cheque
        </button>
      </div>

      {tab === 'cash' ? (
        <div className="space-y-3">
          <div className={scrollTableWrap}>
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-4 py-3">Date</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Cash in</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Bank deposit</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Total income (cash + cheque)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      No payment days in this range.
                    </td>
                  </tr>
                ) : (
                  dailyRows.map((r) => (
                    <tr key={r.date} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums font-medium">{r.date}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-800">
                        {money(r.cashIn)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sky-800">
                        {money(r.bankDeposit)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {money(r.totalIncome)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && dailyRows.length > 0 ? (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/90 text-sm font-semibold text-slate-900">
                    <td className="px-4 py-3">Range total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(dailyTotals.cashIn)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(dailyTotals.bankDeposit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(dailyTotals.totalIncome)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className={scrollTableWrap}>
            <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left text-sm">
              <thead className={stickyThead}>
                <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-4 py-3">Cheque date</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                  <th className="whitespace-nowrap px-4 py-3 font-mono">Cheque #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
                  <th className="whitespace-nowrap px-4 py-3">Payment date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : chequeRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No cheques in this range.
                    </td>
                  </tr>
                ) : (
                  chequeRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.chequeDate}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-violet-800">
                        {money(r.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.chequeNumber}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{r.customerName}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">{r.billNumber}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.paymentDate}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && chequeRows.length > 0 ? (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50/90 text-sm font-semibold text-slate-900">
                    <td className="px-4 py-3">Range total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(chequeTotal)}</td>
                    <td className="px-4 py-3" colSpan={4} />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
