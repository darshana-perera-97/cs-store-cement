import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { BRANDS } from './brandTheme';
import {
  TableFiltersBar,
  TablePaginationBar,
  filterControl,
  inDateRange,
  rowMatchesQuery,
  scrollTableWrap,
  stickyThead,
  useTablePagination,
} from './tableToolbar';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function totalFreeBags(row) {
  return BRANDS.reduce((s, b) => s + (Number(row[`${b.key}Bags`]) || 0), 0);
}

function emptyForm() {
  const f = {
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    billNumber: '',
    reason: '',
  };
  for (const b of BRANDS) {
    f[`${b.key}Bags`] = '';
  }
  return f;
}

export default function PromotionsPage() {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/customers`);
      if (!res.ok) throw new Error('Failed to load customers');
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setCustomers([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/promotions`);
      if (!res.ok) throw new Error('Failed to load promotions');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      if (customerFilter && r.customerId !== customerFilter) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.customerName,
        r.billNumber,
        r.reason,
        r.enteredBy,
        String(totalFreeBags(r)),
      ]);
    });
  }, [rows, search, dateFrom, dateTo, customerFilter]);

  const pagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo, customerFilter]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openModal = () => {
    setForm(emptyForm());
    setSaveError(null);
    loadCustomers();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSaveError(null);
  };

  const handleChange = (field, value) => {
    if (field === 'billNumber') {
      const digits = String(value).replace(/\D/g, '').slice(0, 3);
      setForm((f) => ({ ...f, billNumber: digits }));
      return;
    }
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    if (!form.customerId) {
      setSaveError('Select a customer.');
      return;
    }
    if (!String(form.reason || '').trim()) {
      setSaveError('Enter a reason for the promotion.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        enteredBy: username,
        date: form.date,
        customerId: form.customerId,
        billNumber: form.billNumber || undefined,
        reason: String(form.reason).trim(),
        tokyoBags: form.tokyoBags,
        samudraBags: form.samudraBags,
        atlasBags: form.atlasBags,
        nipponBags: form.nipponBags,
      };
      const res = await fetch(`${apiBase}/api/promotions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Save failed');
        return;
      }
      await load();
      closeModal();
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">
          Record <span className="font-medium text-slate-700">free bags</span> given as promotions. Saved to{' '}
          <span className="font-medium text-slate-700">promotions.json</span> and counted as{' '}
          <span className="font-medium text-slate-700">stock out</span> in{' '}
          <span className="font-medium text-slate-700">liveStock.json</span> (remaining bags and daily ledger “Out” on the
          issue date). Does <span className="font-medium text-slate-700">not</span> change customer balances or cash.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03]"
        >
          Add promotion
        </button>
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && rows.length > 0
            ? `Showing ${filteredRows.length} of ${rows.length} promotion${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className="block min-w-[200px] flex-1 text-sm font-medium text-slate-600">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, bill #, reason…"
            className={filterControl}
          />
        </label>
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
        <label className="block min-w-[180px] flex-1 text-sm font-medium text-slate-600">
          Customer
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className={filterControl}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </TableFiltersBar>

      <div className="space-y-3">
        <div className={scrollTableWrap}>
          <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Free bags</th>
                <th className="whitespace-nowrap px-4 py-3 text-center"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No promotions yet. Use &quot;Add promotion&quot; to record free bags for a customer.
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No rows match your search or filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.date}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{r.customerName || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">
                      {r.billNumber ? `#${r.billNumber}` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-500">
                      {money(0)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-indigo-800">
                      {totalFreeBags(r)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => setDetailRow(r)}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100"
                      >
                        View more
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && rows.length > 0 ? (
          <TablePaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            totalCount={filteredRows.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        ) : null}
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="promo-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeModal}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <h2 id="promo-modal-title" className="text-lg font-bold text-slate-900">
              Add promotion (free bags)
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Logged in as {getUsername() || '—'}. Reduces live stock totals; no payment or customer balance change.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Issue date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => handleChange('date', e.target.value)}
                  className={filterControl}
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Customer
                <select
                  required
                  value={form.customerId}
                  onChange={(e) => handleChange('customerId', e.target.value)}
                  className={filterControl}
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Bill number <span className="font-normal text-slate-400">(optional reference)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.billNumber}
                  onChange={(e) => handleChange('billNumber', e.target.value)}
                  placeholder="e.g. 001"
                  className={filterControl}
                  maxLength={3}
                />
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Reason
                <textarea
                  required
                  rows={3}
                  value={form.reason}
                  onChange={(e) => handleChange('reason', e.target.value)}
                  placeholder="e.g. Loyalty reward, compensation, festival offer…"
                  className={`${filterControl} min-h-[5rem] resize-y`}
                />
              </label>
              <div>
                <p className="text-sm font-medium text-slate-600">Free bags by brand</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {BRANDS.map((b) => (
                    <label key={b.key} className="block text-xs font-medium text-slate-600">
                      {b.label}
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={form[`${b.key}Bags`]}
                        onChange={(e) => handleChange(`${b.key}Bags`, e.target.value)}
                        className={filterControl}
                        placeholder="0"
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save promotion'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {detailRow ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="promo-detail-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => setDetailRow(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <h2 id="promo-detail-title" className="text-lg font-bold text-slate-900">
              Promotion detail
            </h2>
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950 ring-1 ring-amber-100">
              Counts as bags out in live stock / daily ledger. Does not change customer balance or cash.
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Issue date</dt>
                <dd className="font-medium tabular-nums text-slate-900">{detailRow.date}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Customer</dt>
                <dd className="text-right font-medium text-slate-900">{detailRow.customerName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Bill #</dt>
                <dd className="font-mono font-medium text-slate-900">
                  {detailRow.billNumber ? `#${detailRow.billNumber}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Cash amount</dt>
                <dd className="tabular-nums text-slate-500">{money(0)}</dd>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <dt className="text-slate-500">Reason</dt>
                <dd className="mt-1 text-slate-800">{detailRow.reason || '—'}</dd>
              </div>
            </dl>
            <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-slate-100">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className={stickyThead}>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-3 py-2 text-right">Free bags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {BRANDS.map((b) => (
                    <tr key={b.key}>
                      <td className={`px-3 py-2.5 font-medium ${b.ledger.cellLead}`}>{b.label}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${b.ledger.cell}`}>
                        {Number(detailRow[`${b.key}Bags`]) || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Total free bags:{' '}
              <span className="font-semibold text-slate-800">{totalFreeBags(detailRow)}</span>
            </p>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-700">Recorded by:</span> {detailRow.enteredBy || '—'}
            </p>
            {detailRow.createdAt ? (
              <p className="mt-1 text-xs text-slate-400">
                Saved {String(detailRow.createdAt).slice(0, 19).replace('T', ' ')}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setDetailRow(null)}
              className="mt-5 w-full rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
