import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { BRANDS } from './brandTheme';
import { TableFiltersBar, filterControl, rowMatchesQuery } from './tableToolbar';

const apiBase = getApiBase();

export default function StockPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dailyDays, setDailyDays] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [dailyError, setDailyError] = useState(null);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/stocks`);
      if (!res.ok) throw new Error('Failed to load stock data');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDaily = useCallback(async () => {
    setDailyLoading(true);
    setDailyError(null);
    try {
      const res = await fetch(`${apiBase}/api/daily-stock`);
      if (!res.ok) throw new Error('Failed to load daily stock');
      const data = await res.json();
      const days = Array.isArray(data.days) ? data.days : [];
      setDailyDays(days);
    } catch (e) {
      setDailyError(e.message || 'Could not load daily ledger');
      setDailyDays([]);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadDaily();
  }, [load, loadDaily]);

  const totals = useMemo(() => {
    const t = { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
    for (const r of rows) {
      t.tokyo += Number(r.tokyoBags) || 0;
      t.samudra += Number(r.samudraBags) || 0;
      t.atlas += Number(r.atlasBags) || 0;
      t.nippon += Number(r.nipponBags) || 0;
    }
    return t;
  }, [rows]);

  const dailyRowsDesc = useMemo(() => [...dailyDays].reverse(), [dailyDays]);

  const filteredDailyRows = useMemo(() => {
    return dailyRowsDesc.filter((day) => {
      if (!rowMatchesQuery(ledgerSearch, [day.date])) return false;
      if (ledgerFilter === 'with-out') {
        const hasOut = BRANDS.some((b) => Number((day.brands?.[b.key] || {}).out) > 0);
        if (!hasOut) return false;
      }
      if (ledgerFilter === 'with-in') {
        const hasIn = BRANDS.some((b) => Number((day.brands?.[b.key] || {}).in) > 0);
        if (!hasIn) return false;
      }
      return true;
    });
  }, [dailyRowsDesc, ledgerSearch, ledgerFilter]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          Bag totals from all recorded loads. Add or adjust figures on the{' '}
          <span className="font-medium text-slate-700">Loads</span> page.
        </p>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {BRANDS.map((b) => {
          const count = totals[b.key];
          return (
            <div
              key={b.key}
              className={`relative overflow-hidden rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/50 ring-1 ${b.ring}`}
            >
              <div
                className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br opacity-[0.12] ${b.accent}`}
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-start justify-between gap-2">
                  <span className={`inline-flex rounded-xl px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${b.iconBg}`}>
                    {b.label}
                  </span>
                  {loading ? (
                    <span className="text-xs text-slate-400">…</span>
                  ) : null}
                </div>
                <p className="mt-4 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {loading ? '—' : count.toLocaleString()}
                </p>
                <p className="mt-1 text-xs font-medium text-slate-500">Bags in stock</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-bold text-slate-900">Daily bag ledger</h2>
        <p className="text-sm text-slate-500">
          Start of day, bags in from Loads that day, bags out from credit sales on the{' '}
          <span className="font-medium text-slate-700">Bills</span> page (by bill date), and end-of-day balance per
          brand. Saved as{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700">backend/data/dailyStock.json</code>
          .
        </p>
      </div>

      {dailyError ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {dailyError}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !dailyLoading && dailyRowsDesc.length > 0
            ? `Showing ${filteredDailyRows.length} of ${dailyRowsDesc.length} day${dailyRowsDesc.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className="block min-w-[200px] flex-1 text-sm font-medium text-slate-600">
          Search by date
          <input
            type="search"
            value={ledgerSearch}
            onChange={(e) => setLedgerSearch(e.target.value)}
            placeholder="e.g. 2025-04"
            className={filterControl}
          />
        </label>
        <label className="block min-w-[200px] text-sm font-medium text-slate-600">
          Ledger activity
          <select
            value={ledgerFilter}
            onChange={(e) => setLedgerFilter(e.target.value)}
            className={filterControl}
          >
            <option value="all">All days</option>
            <option value="with-out">Days with bags out (sales)</option>
            <option value="with-in">Days with bags in (loads)</option>
          </select>
        </label>
      </TableFiltersBar>

      <div className="overflow-x-auto rounded-[20px] bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Date
              </th>
              {BRANDS.map((b) => (
                <th
                  key={b.key}
                  colSpan={4}
                  className={`px-2 py-2 text-center font-bold tracking-wide ${b.ledger.head}`}
                >
                  {b.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-semibold uppercase text-slate-400">
              {BRANDS.map((b) => (
                <Fragment key={b.key}>
                  <th className={`px-1.5 py-2 text-center ${b.ledger.sub}`}>Start</th>
                  <th className={`px-1.5 py-2 text-center ${b.ledger.sub}`}>In</th>
                  <th className={`px-1.5 py-2 text-center ${b.ledger.sub}`}>Out</th>
                  <th className={`px-1.5 py-2 text-center ${b.ledger.sub}`}>End</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {dailyLoading ? (
              <tr>
                <td colSpan={17} className="px-4 py-10 text-center text-slate-500">
                  Loading daily ledger…
                </td>
              </tr>
            ) : dailyRowsDesc.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-4 py-10 text-center text-slate-500">
                  No load dates yet. Add loads to see day-by-day balances.
                </td>
              </tr>
            ) : filteredDailyRows.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-4 py-10 text-center text-slate-500">
                  No ledger rows match your search or filters.
                </td>
              </tr>
            ) : (
              filteredDailyRows.map((day) => (
                <tr key={day.date}>
                  <td className="whitespace-nowrap border-b border-slate-100 bg-slate-50/70 px-3 py-3 font-medium tabular-nums text-slate-800">
                    {day.date}
                  </td>
                  {BRANDS.map((b) => {
                    const cell = day.brands?.[b.key] || { start: 0, in: 0, out: 0, end: 0 };
                    const rowLine = 'border-b border-slate-100/90';
                    const cellBase = `px-1.5 py-3 text-center tabular-nums transition-colors hover:brightness-[0.98] ${rowLine} ${b.ledger.cell}`;
                    const cellLead = `px-1.5 py-3 text-center tabular-nums transition-colors hover:brightness-[0.98] ${rowLine} ${b.ledger.cellLead}`;
                    return (
                      <Fragment key={b.key}>
                        <td className={cellLead}>{cell.start}</td>
                        <td className={`${cellBase} text-emerald-800`}>{cell.in}</td>
                        <td className={`${cellBase} text-amber-900`}>{cell.out}</td>
                        <td className={`${cellBase} font-semibold text-slate-900`}>{cell.end}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
