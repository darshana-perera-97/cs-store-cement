import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearAuth, getToken, getUsername, isAdmin, isAuthed } from '../auth';
import { DASHBOARD_NAV } from './navConfig';
import { NavIcon } from './NavIcon';

function getApiBase() {
  const fromEnv = (process.env.REACT_APP_API_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:1248';
  }
  return '';
}

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function formatLkr2(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

const KIND_BADGE = {
  load: 'bg-violet-100 text-violet-800',
  bill: 'bg-sky-100 text-sky-900',
  customer: 'bg-emerald-100 text-emerald-900',
  payment: 'bg-amber-100 text-amber-900',
};
const KIND_SHORT = {
  load: 'LD',
  bill: 'BI',
  customer: 'CU',
  payment: 'PY',
};

/** Light tints: green → yellow → orange → red by oldest overdue bill (days past 14-day due). */
const OVERDUE_PRIORITY_CARD = {
  none: 'from-emerald-50 via-green-50 to-teal-50 ring-emerald-200/60 shadow-emerald-500/10',
  low: 'from-lime-50 via-emerald-50 to-green-50 ring-lime-200/60 shadow-lime-500/10',
  moderate: 'from-amber-50 via-yellow-50 to-amber-50/90 ring-amber-200/60 shadow-amber-500/10',
  high: 'from-orange-50 via-amber-50 to-orange-50/90 ring-orange-200/60 shadow-orange-500/10',
  critical: 'from-rose-50 via-red-50/80 to-rose-50 ring-rose-200/60 shadow-rose-500/10',
};

const OVERDUE_PRIORITY_LABEL = {
  none: 'text-emerald-800/90',
  low: 'text-emerald-900/85',
  moderate: 'text-amber-900/80',
  high: 'text-orange-900/85',
  critical: 'text-rose-900/85',
};

const OVERDUE_PRIORITY_AMOUNT = {
  none: 'text-emerald-950',
  low: 'text-emerald-950',
  moderate: 'text-amber-950',
  high: 'text-orange-950',
  critical: 'text-rose-950',
};

const OVERDUE_PRIORITY_SUB = {
  none: 'text-emerald-800/75',
  low: 'text-emerald-900/75',
  moderate: 'text-amber-900/70',
  high: 'text-orange-900/72',
  critical: 'text-rose-900/72',
};

function overduePriorityCopy(od) {
  const n = Number(od?.billCount) || 0;
  const d = Number(od?.maxDaysOverdue) || 0;
  const p = od?.priority || 'none';
  if (n === 0) return 'No overdue bills · within 14-day terms';
  if (p === 'low') return `${n} bill${n === 1 ? '' : 's'} · up to ${d} day${d === 1 ? '' : 's'} late`;
  if (p === 'moderate') return `${n} bill${n === 1 ? '' : 's'} · ${d} days late (review)`;
  if (p === 'high') return `${n} bill${n === 1 ? '' : 's'} · ${d} days late (urgent)`;
  return `${n} bill${n === 1 ? '' : 's'} · ${d} days late (critical)`;
}

function getSectionTitle(pathname) {
  const sorted = [...DASHBOARD_NAV].sort((a, b) => b.to.length - a.to.length);
  const found = sorted.find((n) => pathname.startsWith(n.to));
  return found ? found.label : 'Dashboard';
}

export default function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCashSummary, setSidebarCashSummary] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const section = getSectionTitle(location.pathname);
  const headerTitle = section === 'Analytics' ? 'Main Dashboard' : section;

  const normalizedOverdue =
    sidebarCashSummary == null
      ? null
      : {
          totalOutstanding: Number(sidebarCashSummary.overdue?.totalOutstanding) || 0,
          billCount: Number(sidebarCashSummary.overdue?.billCount) || 0,
          maxDaysOverdue: Number(sidebarCashSummary.overdue?.maxDaysOverdue) || 0,
          priority: ['none', 'low', 'moderate', 'high', 'critical'].includes(
            sidebarCashSummary.overdue?.priority,
          )
            ? sidebarCashSummary.overdue.priority
            : 'none',
        };

  const overduePriority = normalizedOverdue?.priority || 'none';
  const overdueCardTint = OVERDUE_PRIORITY_CARD[overduePriority] || OVERDUE_PRIORITY_CARD.none;

  useEffect(() => {
    const api = getApiBase();
    if (!api) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${api}/api/cash-summary`);
        if (!cancelled && res.ok) setSidebarCashSummary(await res.json());
        else if (!cancelled) setSidebarCashSummary(null);
      } catch {
        if (!cancelled) setSidebarCashSummary(null);
      }
    }
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const signOut = () => {
    clearAuth();
    navigate('/login', { replace: true });
  };

  useEffect(() => {
    if (isAuthed() && !getToken()) {
      clearAuth();
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const navItems = DASHBOARD_NAV.filter((item) => item.to !== '/dashboard/users' || isAdmin());
  const signedInName = getUsername().trim() || 'Signed in';
  const userInitial = signedInName.charAt(0).toUpperCase() || '?';
  const roleLabel = isAdmin() ? 'Administrator' : 'Staff';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#F4F7FE] text-slate-900">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar fixed to viewport; main column offset on md+ so content is not underneath. */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[260px] flex-col border-r border-white/60 bg-white/80 px-4 py-4 shadow-xl shadow-slate-200/40 backdrop-blur-xl transition-transform md:translate-x-0 md:py-5 md:shadow-lg ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-xs font-bold text-white shadow-md shadow-indigo-500/25">
              CS
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-slate-900">CS STORE</p>
              <p className="mt-0.5 truncate text-xs font-medium text-slate-500" title={signedInName}>
                {signedInName}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav
          className="scrollbar-hide mt-8 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1"
          aria-label="Main"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to !== '/dashboard/customers'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span
                      className="absolute right-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-l-full bg-indigo-600"
                      aria-hidden
                    />
                  ) : null}
                  <NavIcon name={item.icon} active={isActive} />
                  <span className="relative z-10">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 shrink-0 space-y-3 border-t border-slate-100 pt-4">
          <div
            className={`rounded-2xl bg-gradient-to-br p-3 shadow-lg ring-1 ${overdueCardTint}`}
            aria-live="polite"
          >
            <p
              className={`text-[10px] font-medium uppercase tracking-wider ${OVERDUE_PRIORITY_LABEL[overduePriority]}`}
            >
              Overdue (14-day terms)
            </p>
            <p
              className={`mt-0.5 text-lg font-bold tabular-nums tracking-tight ${OVERDUE_PRIORITY_AMOUNT[overduePriority]}`}
            >
              {normalizedOverdue == null ? '—' : formatLkr2(normalizedOverdue.totalOutstanding)}
            </p>
            <p className={`text-[11px] leading-snug ${OVERDUE_PRIORITY_SUB[overduePriority]}`}>
              {normalizedOverdue == null ? 'Loading…' : overduePriorityCopy(normalizedOverdue)}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50/90 px-3 py-2.5 ring-1 ring-slate-100">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-200 to-violet-200 text-sm font-semibold text-indigo-900"
              aria-hidden
            >
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900" title={signedInName}>
                {signedInName}
              </p>
              <p className="truncate text-xs text-slate-500">{roleLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col md:pl-[260px]">
        <header className="sticky top-0 z-30 shrink-0 border-b border-white/50 bg-[#F4F7FE]/90 px-4 py-2.5 backdrop-blur-md sm:px-6 sm:py-3 lg:px-8">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-start gap-2.5 sm:items-center">
              <button
                type="button"
                className="shrink-0 rounded-xl border border-slate-200/80 bg-white p-2 text-slate-600 shadow-sm shadow-slate-200/50 md:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
              <div className="min-w-0 pt-0.5 md:pt-0">
                <p className="text-[11px] font-medium leading-tight text-slate-400 sm:text-xs">
                  Dashboards / <span className="text-slate-600">Default</span>
                </p>
                <h1 className="mt-0 text-lg font-bold leading-tight tracking-tight text-slate-900 sm:text-xl">
                  {headerTitle}
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="relative min-w-[200px] flex-1 sm:flex-initial sm:min-w-[220px]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </span>
                <input
                  type="search"
                  placeholder="Search…"
                  className="w-full rounded-full border-0 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-md shadow-slate-200/50 ring-1 ring-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              <div className="flex items-center gap-1 rounded-full border border-slate-100 bg-white p-1 shadow-md shadow-slate-200/50">
                <button
                  type="button"
                  className="rounded-full p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                  aria-label="Notifications"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="rounded-full p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                  aria-label="Info"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                </button>
                <div className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white">
                  A
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 pb-8 pt-3 sm:px-6 sm:pt-4 lg:px-8 lg:pb-10">
          <main className="min-w-0 shrink-0 pr-1 lg:pr-[calc(300px+1.5rem)] xl:pr-[calc(320px+1.5rem)]">
            <Outlet />
          </main>
          <RightPanel />
        </div>
      </div>
    </div>
  );
}

function RightPanel() {
  const apiBase = getApiBase();
  const [stockSummary, setStockSummary] = useState(null);
  const [cashSummary, setCashSummary] = useState(null);
  const [recentActivities, setRecentActivities] = useState([]);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState(null);
  const [activityError, setActivityError] = useState(null);

  useEffect(() => {
    if (!apiBase) {
      setStockLoading(false);
      setStockError('Set REACT_APP_API_URL to load live stock.');
      return undefined;
    }

    let cancelled = false;

    async function loadPanel() {
      try {
        const [stockRes, cashRes] = await Promise.all([
          fetch(`${apiBase}/api/stocks/summary`),
          fetch(`${apiBase}/api/cash-summary`),
        ]);

        if (!cancelled) {
          if (cashRes.ok) {
            const cashJson = await cashRes.json();
            setCashSummary(cashJson);
          } else {
            setCashSummary(null);
          }
        }

        if (!stockRes.ok) {
          throw new Error(`HTTP ${stockRes.status}`);
        }
        const sum = await stockRes.json();
        const brands = Array.isArray(sum.brands) ? sum.brands : [];

        if (!cancelled) {
          setStockSummary({ brands, liveAt: sum.liveAt || new Date().toISOString() });
          setStockError(null);
        }

        const actRes = await fetch(`${apiBase}/api/activity?limit=5`);
        if (!cancelled) {
          if (actRes.ok) {
            const act = await actRes.json();
            setRecentActivities(Array.isArray(act) ? act : []);
            setActivityError(null);
          } else {
            setRecentActivities([]);
            setActivityError('Could not load activity.');
          }
        }
      } catch {
        if (!cancelled) {
          setStockError('Could not load stock.');
          setRecentActivities([]);
          setActivityError(null);
        }
      } finally {
        if (!cancelled) {
          setStockLoading(false);
        }
      }
    }

    loadPanel();
    const id = window.setInterval(loadPanel, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiBase]);

  return (
    <aside
      className="flex w-full min-h-0 flex-col gap-5 overflow-y-auto overscroll-y-contain pb-2 max-lg:h-full max-lg:min-h-0 max-lg:flex-1 max-lg:shrink lg:fixed lg:bottom-0 lg:right-0 lg:top-[4.75rem] lg:z-20 lg:w-[300px] lg:max-w-none lg:border-l lg:border-slate-200/70 lg:bg-[#F4F7FE]/95 lg:px-4 lg:py-4 lg:pb-6 lg:backdrop-blur-md lg:scrollbar-hide xl:w-[320px]"
      aria-label="Account and activity"
    >
      <div className="flex shrink-0 flex-col overflow-hidden rounded-[20px] bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 p-5 text-white shadow-xl shadow-fuchsia-500/20 ring-1 ring-white/20">
        <ul className="space-y-3.5 text-sm">
          <li className="border-b border-white/20 pb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/75">
              Pending cash from customers
            </p>
            <p className="mt-1 text-base font-bold tabular-nums leading-tight sm:text-lg">
              {cashSummary == null ? '—' : formatLkr2(cashSummary.pendingFromCustomers)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/65">Total amount still to collect</p>
          </li>
          <li>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/75">
              Cash received from customers
            </p>
            <p className="mt-1 text-base font-bold tabular-nums leading-tight text-emerald-100 sm:text-lg">
              {cashSummary == null ? '—' : formatLkr2(cashSummary.cashReceivedFromCustomers)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/65">All recorded payments</p>
          </li>
        </ul>
      </div>
      <div className="shrink-0 rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">Bag stock (live)</h2>
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">Total bags on hand across all loads</p>
        {stockLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading stock…</p>
        ) : stockError ? (
          <p className="mt-4 text-sm text-rose-600">{stockError}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {(stockSummary?.brands || []).map((b) => (
              <li
                key={b.key}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/90 px-3 py-2.5 ring-1 ring-slate-100"
              >
                <span className="text-sm font-semibold text-slate-800">{b.label}</span>
                <span className="font-mono text-sm font-bold tabular-nums text-indigo-700">
                  {Number(b.bags).toLocaleString()} <span className="text-[10px] font-semibold text-slate-500">bags</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <h2 className="text-sm font-bold text-slate-900">Recent activity</h2>
        <p className="mt-0.5 text-xs text-slate-500">Loads, bills, customers, payments (last 5)</p>
        {activityError ? (
          <p className="mt-2 text-xs text-amber-700">{activityError}</p>
        ) : null}
        {stockLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading…</p>
        ) : recentActivities.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            {activityError ? (
              'Try again in a moment.'
            ) : stockError ? (
              <span className="text-rose-600">{stockError}</span>
            ) : (
              'No activity yet.'
            )}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {recentActivities.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold leading-tight ${
                    KIND_BADGE[item.kind] || 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {KIND_SHORT[item.kind] || '·'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="truncate text-xs text-slate-500">{item.subtitle}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-800">
                  {formatLkr(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
