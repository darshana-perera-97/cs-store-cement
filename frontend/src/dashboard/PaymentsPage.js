import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
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

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const emptyForm = () => ({
  customerId: '',
  billNumber: '',
  amount: '',
  date: todayYmdLocal(),
  note: '',
});

export default function PaymentsPage() {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
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
      const res = await fetch(`${apiBase}/api/payments`);
      if (!res.ok) throw new Error('Failed to load payments');
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
      if (
        !rowMatchesQuery(search, [
          r.date,
          r.billNumber,
          r.customerName,
          r.note,
          r.recordedBy,
          String(r.amount),
        ])
      ) {
        return false;
      }
      return true;
    });
  }, [rows, search, dateFrom, dateTo, customerFilter]);

  const pagination = useTablePagination(filteredRows.length, [
    search,
    dateFrom,
    dateTo,
    customerFilter,
  ]);
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
    if (!form.billNumber || form.billNumber.length < 1) {
      setSaveError('Enter a bill number (1–3 digits, e.g. 001).');
      return;
    }
    const padBill = String(parseInt(form.billNumber, 10)).padStart(3, '0');
    if (rows.some((r) => String(r.billNumber || '') === padBill)) {
      setSaveError('This bill number is already used.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordedBy: username,
          customerId: form.customerId,
          billNumber: form.billNumber,
          amount: form.amount,
          date: form.date,
          note: form.note.trim(),
        }),
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
          All payments are saved to <span className="font-medium text-slate-700">payments.json</span> on the server and
          lower each customer&apos;s amount to pay. Each payment needs a unique 3-digit bill number (e.g.{' '}
          <span className="font-mono">001</span>).
        </p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03]"
        >
          Record payment
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
            ? `Showing ${filteredRows.length} of ${rows.length} payment${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className="block min-w-[200px] flex-1 text-sm font-medium text-slate-600">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, bill #, note, amount…"
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
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Note</th>
              <th className="whitespace-nowrap px-4 py-3">Recorded by</th>
              <th className="whitespace-nowrap px-4 py-3 text-center"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  No payments yet. Record one to update customer balances.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  No payments match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.date}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm font-semibold tabular-nums text-slate-800">
                    {r.billNumber || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.customerName || '—'}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                    −{money(r.amount)}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">
                    <span className="line-clamp-2">{r.note || '—'}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.recordedBy || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <Link
                      to={`/dashboard/customers/${encodeURIComponent(r.customerId)}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      Customer
                    </Link>
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
          aria-labelledby="payments-modal-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={closeModal}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <h2 id="payments-modal-title" className="text-lg font-bold text-slate-900">
              Record payment
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Stored in payments.json. Logged in as {getUsername() || '—'}.
            </p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <label className="block text-sm font-medium text-slate-600">
                Customer
                <select
                  required
                  value={form.customerId}
                  onChange={(e) => handleChange('customerId', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  disabled={customers.length === 0}
                >
                  <option value="">{customers.length === 0 ? 'No customers yet' : 'Select customer…'}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-600">
                Bill number
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  maxLength={3}
                  value={form.billNumber}
                  onChange={(e) => handleChange('billNumber', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 font-mono text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. 1 → 001"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  1–3 digits, padded to 3. Must be unique across all payments.
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-600">
                  Amount (LKR)
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    required
                    value={form.amount}
                    onChange={(e) => handleChange('amount', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Date
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => handleChange('date', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-600">
                Note (optional)
                <input
                  type="text"
                  value={form.note}
                  onChange={(e) => handleChange('note', e.target.value)}
                  className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  placeholder="e.g. Cash, transfer ref…"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || customers.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
