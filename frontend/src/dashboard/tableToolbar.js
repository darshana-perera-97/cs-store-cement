/**
 * Shared helpers and layout for table search / filter bars on dashboard pages.
 */

export function rowMatchesQuery(q, parts) {
  const s = String(q ?? '').trim().toLowerCase();
  if (!s) return true;
  return parts.some((p) => String(p ?? '').toLowerCase().includes(s));
}

/** dateStr is YYYY-MM-DD */
export function inDateRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = String(dateStr ?? '');
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function TableFiltersBar({ children, hint, className = '' }) {
  return (
    <div
      className={`rounded-[20px] bg-white p-4 shadow-md shadow-slate-200/30 ring-1 ring-slate-100 ${className}`.trim()}
    >
      <div className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">{children}</div>
      {hint ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs tabular-nums text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** className for text/date/select inputs inside filter bars */
export const filterControl =
  'mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';
