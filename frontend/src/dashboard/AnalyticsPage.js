import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getApiBase } from '../apiBase';
import { BRANDS } from './brandTheme';
import { TableFiltersBar, filterControl, rowMatchesQuery } from './tableToolbar';
import { downloadOverdueBillsPdf } from './overdueBillsPdf';

/** Bar fills aligned with `BRANDS` — same hues as light theme, higher chroma for readability */
const BRAND_BAR_COLORS = {
  tokyo: '#a78bfa',
  samudra: '#38bdf8',
  atlas: '#fbbf24',
  nippon: '#f472b6',
};

/** [0] pending · [1] payments — stronger tints for Pending vs collected donut */
const DONUT_COLORS = ['#a78bfa', '#34d399'];

const OVERDUE_PREVIEW_COUNT = 6;

const overdueSubtitle =
  'Payment is due within 14 days of each bill date (local calendar); these credit bills still have a balance after that due date.';

function formatLkrCompact(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function formatLkrExact(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function formatRelativeTime(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Card({ title, subtitle, children, className = '', headerExtra = null }) {
  return (
    <div
      className={`rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {headerExtra ? <div className="shrink-0 pt-0.5">{headerExtra}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function OverdueBillsTable({ rows, totalLoadedCount }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <th className="pb-3 pl-1 pr-3">Customer</th>
            <th className="pb-3 pr-3">Bill details</th>
            <th className="pb-3 pr-3">Bill date</th>
            <th className="pb-3 pr-3">Due date</th>
            <th className="pb-3 pr-3 text-right">Days overdue</th>
            <th className="pb-3 pr-1 text-right">Outstanding</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                {totalLoadedCount === 0 ? 'No overdue bills.' : 'No rows match your search.'}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="text-slate-700">
                <td className="max-w-[140px] py-3.5 pl-1 pr-3 font-semibold text-slate-900">
                  <span className="line-clamp-2">{row.customerName}</span>
                </td>
                <td className="max-w-[260px] py-3.5 pr-3 text-xs leading-snug text-slate-600 sm:text-sm">
                  <span className="line-clamp-3">{row.details}</span>
                </td>
                <td className="whitespace-nowrap py-3.5 pr-3 tabular-nums text-slate-600">{row.billDate}</td>
                <td className="whitespace-nowrap py-3.5 pr-3 tabular-nums text-slate-600">{row.dueDate}</td>
                <td className="py-3.5 pr-3 text-right">
                  <span className="inline-flex min-w-[2rem] justify-end font-semibold tabular-nums text-rose-600">
                    {row.daysOverdue}
                  </span>
                </td>
                <td className="py-3.5 pr-1 text-right font-semibold tabular-nums text-slate-900">
                  {formatLkrExact(row.outstandingAmount)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const apiBase = getApiBase();
  const [cashSummary, setCashSummary] = useState(null);
  const [cashFlow, setCashFlow] = useState([]);
  const [bagSalesByDay, setBagSalesByDay] = useState([]);
  const [recentTransfers, setRecentTransfers] = useState([]);
  const [overdueBills, setOverdueBills] = useState([]);
  const [cashDashLoading, setCashDashLoading] = useState(true);
  const [overdueSearch, setOverdueSearch] = useState('');
  const [overdueListView, setOverdueListView] = useState('preview');

  useEffect(() => {
    if (!apiBase) {
      setCashDashLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const [sumRes, flowRes, bagsRes, xferRes, overdueRes] = await Promise.all([
          fetch(`${apiBase}/api/cash-summary`),
          fetch(`${apiBase}/api/cash-flow?days=7`),
          fetch(`${apiBase}/api/bag-sales-by-day?days=7`),
          fetch(`${apiBase}/api/recent-transfers?limit=5`),
          fetch(`${apiBase}/api/overdue-bills`),
        ]);
        if (!cancelled) {
          if (sumRes.ok) setCashSummary(await sumRes.json());
          else setCashSummary(null);
          if (flowRes.ok) {
            const rows = await flowRes.json();
            setCashFlow(Array.isArray(rows) ? rows : []);
          } else {
            setCashFlow([]);
          }
          if (bagsRes.ok) {
            const rows = await bagsRes.json();
            setBagSalesByDay(Array.isArray(rows) ? rows : []);
          } else {
            setBagSalesByDay([]);
          }
          if (xferRes.ok) {
            const rows = await xferRes.json();
            setRecentTransfers(Array.isArray(rows) ? rows : []);
          } else {
            setRecentTransfers([]);
          }
          if (overdueRes.ok) {
            const rows = await overdueRes.json();
            setOverdueBills(Array.isArray(rows) ? rows : []);
          } else {
            setOverdueBills([]);
          }
        }
      } catch {
        if (!cancelled) {
          setCashSummary(null);
          setCashFlow([]);
          setBagSalesByDay([]);
          setRecentTransfers([]);
          setOverdueBills([]);
        }
      } finally {
        if (!cancelled) setCashDashLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const donutModel = useMemo(() => {
    const pending = Number(cashSummary?.pendingFromCustomers) || 0;
    const paid = Number(cashSummary?.cashReceivedFromCustomers) || 0;
    const whole = pending + paid;
    if (whole <= 0) {
      return {
        slices: [],
        pendingPercent: 0,
        whole,
        pending,
        paid,
        hasData: false,
      };
    }
    const pendingPercent = Math.round((pending / whole) * 1000) / 10;
    return {
      slices: [
        { name: 'Still pending', value: pending },
        { name: 'Payments recorded', value: paid },
      ],
      pendingPercent,
      whole,
      pending,
      paid,
      hasData: true,
    };
  }, [cashSummary]);

  const filteredOverdueBills = useMemo(() => {
    return overdueBills.filter((row) =>
      rowMatchesQuery(overdueSearch, [
        row.customerName,
        row.details,
        row.billDate,
        row.dueDate,
        row.daysOverdue,
        row.outstandingAmount,
        row.billTotal,
      ]),
    );
  }, [overdueBills, overdueSearch]);

  const previewOverdueRows = useMemo(
    () => filteredOverdueBills.slice(0, OVERDUE_PREVIEW_COUNT),
    [filteredOverdueBills],
  );

  const showOverdueViewAll = overdueBills.length > OVERDUE_PREVIEW_COUNT;

  const overdueSearchInput = (
    <label className="block min-w-[220px] flex-1 text-sm font-medium text-slate-600">
      Search
      <input
        type="search"
        value={overdueSearch}
        onChange={(e) => setOverdueSearch(e.target.value)}
        placeholder="Customer, stock, dates, amount…"
        className={filterControl}
      />
    </label>
  );

  const backButtonClass =
    'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50';

  const viewAllButtonClass =
    'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700';

  const downloadPdfButtonClass =
    'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

  const handleDownloadOverduePdf = useCallback(() => {
    downloadOverdueBillsPdf(overdueBills);
  }, [overdueBills]);

  const overdueDownloadButton = (
    <button
      type="button"
      className={downloadPdfButtonClass}
      disabled={cashDashLoading || overdueBills.length === 0}
      onClick={handleDownloadOverduePdf}
    >
      Download Overdue Bills
    </button>
  );

  if (overdueListView === 'full') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className={backButtonClass}
            onClick={() => {
              setOverdueListView('preview');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <span aria-hidden>←</span> Back to analytics
          </button>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">All overdue bills</h1>
        </div>
        <p className="text-sm text-slate-600">{overdueSubtitle}</p>
        <Card
          title={`Overdue bills (${overdueBills.length})`}
          subtitle="Full list — same 14-day rule as the dashboard summary."
          headerExtra={overdueDownloadButton}
        >
          <TableFiltersBar
            className="!bg-slate-50/90 shadow-none"
            hint={
              cashDashLoading
                ? null
                : overdueBills.length === 0
                  ? 'No overdue bills — all are within 14 days or fully allocated by payments.'
                  : filteredOverdueBills.length === overdueBills.length
                    ? `${overdueBills.length} overdue bill${overdueBills.length === 1 ? '' : 's'}.`
                    : `Showing ${filteredOverdueBills.length} of ${overdueBills.length} matching search.`
            }
          >
            {overdueSearchInput}
          </TableFiltersBar>
          {cashDashLoading ? (
            <div className="mt-4 py-10 text-center text-sm text-slate-500">Loading…</div>
          ) : (
            <div className="mt-4">
              <OverdueBillsTable rows={filteredOverdueBills} totalLoadedCount={overdueBills.length} />
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Bag sales by brand"
          subtitle="Last 7 days · Stacked bags per day from credit bills (Tokyo, Samudra, Atlas, Nippon)"
          className="lg:col-span-2"
        >
          {cashDashLoading ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">Loading…</div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bagSalesByDay} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value) => `${Math.round(Number(value) || 0)} bags`}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date ? String(payload[0].payload.date) : ''
                    }
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 40px -10px rgb(0 0 0 / 0.15)',
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {BRANDS.map((b) => (
                    <Bar
                      key={b.key}
                      dataKey={b.key}
                      stackId="bags"
                      name={b.label}
                      fill={BRAND_BAR_COLORS[b.key]}
                      maxBarSize={40}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card
          title="Pending vs collected"
          subtitle="Customer money still owed versus payments recorded (same totals as Your card)"
        >
          {cashDashLoading ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">Loading…</div>
          ) : !donutModel.hasData ? (
            <div className="flex h-[240px] flex-col items-center justify-center px-3 text-center text-sm text-slate-500">
              <p>No data yet.</p>
              <p className="mt-2 text-xs leading-relaxed">
                When you have customer balances and/or recorded payments, this chart shows what share is still
                pending versus already collected.
              </p>
            </div>
          ) : (
            <div className="relative h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutModel.slices}
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={86}
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {donutModel.slices.map((entry, index) => (
                      <Cell key={entry.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatLkrCompact(value)}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <span className="block text-3xl font-bold tabular-nums text-slate-900">
                    {donutModel.pendingPercent}%
                  </span>
                  <span className="mt-0.5 block text-[11px] font-medium leading-snug text-slate-500">
                    pending
                    <br />
                    of total
                  </span>
                </div>
              </div>
            </div>
          )}
          {!cashDashLoading && donutModel.hasData ? (
            <p className="mt-2 text-center text-[11px] text-slate-500">
              <span className="font-semibold text-violet-700">{formatLkrCompact(donutModel.pending)}</span> pending
              <span className="mx-1 text-slate-300">·</span>
              <span className="font-semibold text-emerald-600">{formatLkrCompact(donutModel.paid)}</span> paid
              <span className="mx-1 text-slate-300">·</span>
              <span className="tabular-nums">{formatLkrCompact(donutModel.whole)}</span> combined
            </p>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card
          title="Cash in vs stock spend"
          subtitle="Last 7 days · Daily customer payments compared to stock load purchase totals"
          className="lg:col-span-3"
        >
          {cashDashLoading ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">Loading…</div>
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cashFlow} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(value) => formatLkrCompact(value)}
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.date ? String(payload[0].payload.date) : ''
                    }
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 10px 40px -10px rgb(0 0 0 / 0.15)',
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value) => <span className="text-slate-600">{value}</span>}
                  />
                  <Line
                    type="monotone"
                    dataKey="cashIn"
                    name="Customer payments"
                    stroke="#059669"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#059669', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="cashOut"
                    name="Stock purchases"
                    stroke="#dc2626"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#dc2626', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card
          title="Your transfers"
          subtitle="Last 5: customer payments in and stock purchases (loads)"
          className="lg:col-span-2"
        >
          {cashDashLoading ? (
            <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">Loading…</div>
          ) : recentTransfers.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No payments or stock purchases yet. They will appear here in chronological order.
            </p>
          ) : (
            <ul className="space-y-4">
              {recentTransfers.map((t) => {
                const isOut = t.kind === 'stock_purchase';
                const label = String(t.title || '').trim() || (isOut ? 'Stock' : 'Payment');
                const chip = label.slice(0, 1).toUpperCase();
                const when = formatRelativeTime(t.at);
                const sub = String(t.subtitle || '').trim();
                return (
                  <li key={t.id} className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {chip}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
                      <p className="truncate text-xs text-slate-500">
                        {when}
                        {sub ? ` · ${sub}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${isOut ? 'text-rose-500' : 'text-emerald-600'}`}
                    >
                      {isOut ? '-' : '+'}
                      {formatLkrCompact(t.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Overdue bills"
        subtitle={overdueSubtitle}
        headerExtra={
          <div className="flex max-w-[min(100%,380px)] flex-wrap items-center justify-end gap-2">
            {overdueDownloadButton}
            {showOverdueViewAll ? (
              <button
                type="button"
                className={viewAllButtonClass}
                onClick={() => {
                  setOverdueListView('full');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                View all
              </button>
            ) : null}
          </div>
        }
      >
        <TableFiltersBar
          className="!bg-slate-50/90 shadow-none"
          hint={
            cashDashLoading
              ? null
              : overdueBills.length === 0
                ? 'No overdue bills — all are within 14 days or fully allocated by payments.'
                : filteredOverdueBills.length <= OVERDUE_PREVIEW_COUNT
                  ? `Showing ${filteredOverdueBills.length} overdue bill${
                      filteredOverdueBills.length === 1 ? '' : 's'
                    }${overdueSearch.trim() ? ' (search)' : ''}.`
                  : `Showing ${previewOverdueRows.length} of ${filteredOverdueBills.length} matching search (${
                      overdueBills.length
                    } total overdue). Open View all for the full table.`
          }
        >
          {overdueSearchInput}
        </TableFiltersBar>
        {cashDashLoading ? (
          <div className="mt-4 py-10 text-center text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="mt-4">
            <OverdueBillsTable rows={previewOverdueRows} totalLoadedCount={overdueBills.length} />
          </div>
        )}
      </Card>
    </div>
  );
}
