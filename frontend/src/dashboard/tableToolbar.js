/**
 * Shared helpers and layout for table search / filter bars on dashboard pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

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

/**
 * Wrapper for data tables: vertical + horizontal scroll with a max height so
 * `position: sticky` on `<thead>` keeps headers visible while scrolling rows.
 */
export const scrollTableWrap =
  'max-h-[min(75vh,40rem)] overflow-auto rounded-[20px] bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-100';

/** Apply to `<thead>` (sticky within {@link scrollTableWrap}). */
export const stickyThead =
  'sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 shadow-[0_1px_0_0_rgb(241_245_249)] backdrop-blur-sm';

/** For tables with custom header cell colors (e.g. brand columns); use instead of opaque stickyThead bg. */
export const stickyTheadTransparent =
  'sticky top-0 z-10 border-b border-slate-200 bg-white/90 shadow-[0_1px_0_0_rgb(241_245_249)] backdrop-blur-sm';

/** Options in the rows-per-page control (values must be positive integers). */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const paginationBtn =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40';

const paginationSelect =
  'rounded-lg border-0 bg-slate-100 py-1.5 pl-2 pr-8 text-xs font-medium text-slate-800 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35';

/**
 * Client-side pagination over an already-filtered list.
 *
 * @param {number} totalCount - Length of the filtered list.
 * @param {unknown[]} resetDeps - When any entry changes, page resets to 1.
 * @param {number} [defaultPageSize=10]
 */
export function useTablePagination(totalCount, resetDeps, defaultPageSize = 10) {
  const initialSize =
    typeof defaultPageSize === 'number' && defaultPageSize > 0
      ? defaultPageSize
      : 10;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => initialSize);

  const setPageSize = useCallback((n) => {
    setPageSizeState(n);
    setPage(1);
  }, []);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller supplies filter identity
  }, resetDeps);

  const totalPages = useMemo(() => {
    if (totalCount <= 0) return 1;
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [totalCount, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const pageSafe = Math.min(page, totalPages);
  const offset = (pageSafe - 1) * pageSize;

  return {
    page: pageSafe,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    offset,
  };
}

/** When {@link defaultPageSize} is not in {@link PAGE_SIZE_OPTIONS}, include it so the select stays valid. */
export function pageSizeOptionsWith(defaultPageSize) {
  const n = typeof defaultPageSize === 'number' && defaultPageSize > 0 ? defaultPageSize : 10;
  if (PAGE_SIZE_OPTIONS.includes(n)) return PAGE_SIZE_OPTIONS;
  return [n, ...PAGE_SIZE_OPTIONS].sort((a, b) => a - b);
}

/**
 * Rows-per-page + prev/next + page indicator. Place below the scrollable table wrapper.
 */
export function TablePaginationBar({
  page,
  totalPages,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className = '',
}) {
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}
    >
      <p className="text-xs tabular-nums text-slate-500">
        {totalCount === 0
          ? 'No rows on this page.'
          : `${from}–${to} of ${totalCount.toLocaleString()}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className={paginationSelect}
            aria-label="Rows per page"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={paginationBtn}
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
            aria-label="First page"
          >
            First
          </button>
          <button
            type="button"
            className={paginationBtn}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span className="px-1 text-xs tabular-nums text-slate-600">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            className={paginationBtn}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
          </button>
          <button
            type="button"
            className={paginationBtn}
            disabled={page >= totalPages}
            onClick={() => onPageChange(totalPages)}
            aria-label="Last page"
          >
            Last
          </button>
        </div>
      </div>
    </div>
  );
}
