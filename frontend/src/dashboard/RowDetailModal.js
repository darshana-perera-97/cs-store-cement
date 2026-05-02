import { useEffect } from 'react';

function formatDetailValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (Array.isArray(value)) return value.length === 0 ? '—' : JSON.stringify(value, null, 2);
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function humanizeKey(key) {
  return String(key)
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Read-only popup listing every enumerable field on a row object (typical API record).
 */
export default function RowDetailModal({ open, row, title = 'Details', subtitle = null, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || row == null || typeof row !== 'object') return null;

  const entries = Object.entries(row).filter(([, v]) => typeof v !== 'function');

  return (
    <div
      className="fixed inset-0 z-[101] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="row-detail-modal-title"
    >
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full min-h-0 max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="min-h-0 max-h-[min(90vh,calc(100dvh-3rem))] overflow-y-auto overscroll-contain p-6">
          <h2 id="row-detail-modal-title" className="text-lg font-bold text-slate-900">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          <dl className="mt-4 space-y-3">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{humanizeKey(key)}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-900">{formatDetailValue(value)}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shared interaction pattern for data tables: click row or Enter/Space to open details. */
export function detailRowAttrs(openDetail, extraClassName = '') {
  return {
    tabIndex: 0,
    role: 'button',
    title: 'Click to view full row',
    className: `cursor-pointer outline-none transition-colors focus-visible:bg-indigo-50/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${extraClassName}`.trim(),
    onClick: openDetail,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail();
      }
    },
  };
}
