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
  stickyTheadTransparent,
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

function suggestStockIdFromLoads(loads) {
  if (!Array.isArray(loads) || loads.length === 0) return 'STK-0001';
  const sorted = [...loads].sort((a, b) => {
    const ta = new Date(a.createdAt || `${a.date}T12:00:00`).getTime();
    const tb = new Date(b.createdAt || `${b.date}T12:00:00`).getTime();
    return tb - ta;
  });
  const sid = String(sorted[0].stockId || '').trim();
  return sid || 'STK-0001';
}

function emptyForm() {
  const f = {
    date: new Date().toISOString().slice(0, 10),
    customerId: '',
    stockId: 'STK-0001',
  };
  for (const b of BRANDS) {
    f[`${b.key}Bags`] = '';
    f[`${b.key}UnitPrice`] = '';
  }
  return f;
}

export default function BillsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [detailBill, setDetailBill] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
      const res = await fetch(`${apiBase}/api/bills`);
      if (!res.ok) throw new Error('Failed to load bills');
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

  const stockOptions = useMemo(() => {
    const u = new Set();
    for (const r of rows) {
      const id = String(r.stockId ?? '').trim();
      if (id) u.add(id);
    }
    return [...u].sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (stockFilter && String(r.stockId ?? '').trim() !== stockFilter) return false;
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const bagParts = BRANDS.map((b) => String(r[`${b.key}Bags`] ?? ''));
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.customerName,
        r.enteredBy,
        String(r.totalAmount ?? ''),
        ...bagParts,
      ]);
    });
  }, [rows, search, stockFilter, dateFrom, dateTo]);

  const pagination = useTablePagination(filteredRows.length, [search, stockFilter, dateFrom, dateTo]);
  const pagedRows = useMemo(
    () => filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    [filteredRows, pagination.offset, pagination.pageSize]
  );

  const openAdd = async () => {
    setSaveError(null);
    loadCustomers();
    let suggested = 'STK-0001';
    try {
      const res = await fetch(`${apiBase}/api/stocks`);
      if (res.ok) {
        const list = await res.json();
        suggested = suggestStockIdFromLoads(Array.isArray(list) ? list : []);
      }
    } catch {
      /* keep sample default */
    }
    setForm({ ...emptyForm(), stockId: suggested });
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setSaveError(null);
  };

  const handleFormChange = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = getUsername();
    if (!username) {
      setSaveError('You need to be signed in with a username.');
      return;
    }
    const selected = customers.find((c) => c.id === form.customerId);
    if (!selected) {
      setSaveError('Please select a customer from the list.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        enteredBy: username,
        date: form.date,
        customerName: String(selected.name || '').trim(),
        stockId: String(form.stockId ?? '').trim(),
      };
      for (const b of BRANDS) {
        body[`${b.key}Bags`] = form[`${b.key}Bags`];
        body[`${b.key}UnitPrice`] = form[`${b.key}UnitPrice`];
      }
      const res = await fetch(`${apiBase}/api/bills`, {
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
      closeAdd();
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
          Credit sales of cement bags (Tokyo, Samudra, Atlas, Nippon) to customers. The customer must exist on the{' '}
          <span className="font-medium text-slate-700">Customers</span> page first. Unit price is per bag; total bill
          is the sum of line amounts. With a Stock ID, saving subtracts sold bags from that load in{' '}
          <span className="font-medium text-slate-700">Loads</span> (and the bag cards on{' '}
          <span className="font-medium text-slate-700">Stock</span>). Every bill also adds bag totals to{' '}
          <span className="font-medium text-slate-700">Out</span> on the bill date in the daily ledger (
          <span className="font-medium text-slate-700">Stock</span> page table).
        </p>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03]"
        >
          Record credit sale
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
            ? `Showing ${filteredRows.length} of ${rows.length} bill${rows.length === 1 ? '' : 's'}`
            : null
        }
      >
        <label className="block min-w-[200px] flex-1 text-sm font-medium text-slate-600">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer, stock ID, staff, total…"
            className={filterControl}
          />
        </label>
        <label className="block min-w-[140px] text-sm font-medium text-slate-600">
          Stock ID
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className={filterControl}
          >
            <option value="">All loads</option>
            {stockOptions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
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
      </TableFiltersBar>

      <div className="space-y-3">
      <div className={scrollTableWrap}>
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyTheadTransparent}>
            <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap bg-slate-50/95 px-3 py-3 align-bottom">Date</th>
              <th className="whitespace-nowrap bg-slate-50/95 px-3 py-3 align-bottom">Stock</th>
              <th className="whitespace-nowrap bg-slate-50/95 px-3 py-3 align-bottom">Customer</th>
              {BRANDS.map((b) => (
                <th key={b.key} className={`whitespace-nowrap px-2 py-2 text-center ${b.ledger.head}`}>
                  {b.label}
                  <span className="mt-0.5 block text-[10px] font-normal normal-case opacity-90">Bags</span>
                </th>
              ))}
              <th className="whitespace-nowrap border-l border-slate-100 px-3 py-3 align-bottom text-right">
                Total bill
              </th>
              <th className="whitespace-nowrap px-3 py-3 align-bottom text-center"> </th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  No credit bills yet. Use &quot;Record credit sale&quot; to add one.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  No bills match your search or filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((r) => {
                const rowLine = 'border-b border-slate-100/90';
                return (
                  <tr key={r.id}>
                    <td className={`whitespace-nowrap px-3 py-3 font-medium ${rowLine} bg-slate-50/70 tabular-nums`}>
                      {r.date}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-mono text-sm text-slate-800 ${rowLine} bg-slate-50/70`}
                    >
                      {r.stockId || '—'}
                    </td>
                    <td className={`max-w-[180px] px-3 py-3 font-medium text-slate-900 ${rowLine} bg-slate-50/70`}>
                      <span className="line-clamp-2">{r.customerName}</span>
                    </td>
                    {BRANDS.map((b) => (
                      <td
                        key={b.key}
                        className={`px-2 py-3 text-center tabular-nums ${rowLine} ${b.ledger.cellLead} transition-colors hover:brightness-[0.98]`}
                      >
                        {r[`${b.key}Bags`] ?? 0}
                      </td>
                    ))}
                    <td
                      className={`border-l border-slate-100 px-3 py-3 text-right font-semibold tabular-nums text-slate-900 ${rowLine} bg-white`}
                    >
                      {money(r.totalAmount)}
                    </td>
                    <td className={`px-3 py-3 text-center ${rowLine} bg-white`}>
                      <button
                        type="button"
                        onClick={() => setDetailBill(r)}
                        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100"
                      >
                        View more
                      </button>
                    </td>
                  </tr>
                );
              })
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

      {addOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bills-add-title"
        >
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={closeAdd} />
          <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <h2 id="bills-add-title" className="text-lg font-bold text-slate-900">
              Record credit sale
            </h2>
            <p className="mt-1 text-sm text-slate-500">Logged in as {getUsername() || '—'}</p>
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              {saveError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-100">{saveError}</p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-600">
                  Date
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={(e) => handleFormChange('date', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600">
                  Stock (load Stock ID)
                  <input
                    type="text"
                    value={form.stockId}
                    onChange={(e) => handleFormChange('stockId', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 font-mono text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    placeholder="STK-0001"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-600 sm:col-span-2">
                  Customer
                  <select
                    required
                    value={form.customerId}
                    onChange={(e) => handleFormChange('customerId', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={customers.length === 0}
                  >
                    <option value="">
                      {customers.length === 0 ? 'No customers yet — add some on Customers' : 'Select customer…'}
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bags &amp; unit price (LKR)</p>
                <div className="mt-3 space-y-3">
                  {BRANDS.map((b) => (
                    <div key={b.key} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3">
                      <span className="col-span-2 text-sm font-medium text-slate-800 sm:col-span-1">{b.label}</span>
                      <label className="text-xs text-slate-500">
                        Bags
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={form[`${b.key}Bags`]}
                          onChange={(e) => handleFormChange(`${b.key}Bags`, e.target.value)}
                          className="mt-0.5 w-full rounded-lg border-0 bg-white px-2 py-2 text-sm tabular-nums ring-1 ring-slate-200"
                        />
                      </label>
                      <label className="text-xs text-slate-500">
                        Price / bag
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={form[`${b.key}UnitPrice`]}
                          onChange={(e) => handleFormChange(`${b.key}UnitPrice`, e.target.value)}
                          className="mt-0.5 w-full rounded-lg border-0 bg-white px-2 py-2 text-sm tabular-nums ring-1 ring-slate-200"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeAdd}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || customers.length === 0}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save bill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {detailBill ? (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bills-detail-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => setDetailBill(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <h2 id="bills-detail-title" className="text-lg font-bold text-slate-900">
              Bill detail
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {detailBill.date}
              {detailBill.stockId ? (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-mono font-semibold text-slate-700">{detailBill.stockId}</span>
                </>
              ) : null}{' '}
              · {detailBill.customerName}
            </p>
            <div className="mt-4 max-h-64 overflow-auto rounded-xl ring-1 ring-slate-100">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className={stickyThead}>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Brand</th>
                    <th className="px-2 py-2 text-center">Bags</th>
                    <th className="px-2 py-2 text-right">Price / bag</th>
                    <th className="px-3 py-2 text-right">Line</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {BRANDS.map((b) => (
                    <tr key={b.key}>
                      <td className={`px-3 py-2.5 font-medium ${b.ledger.cellLead}`}>{b.label}</td>
                      <td className={`px-2 py-2.5 text-center tabular-nums ${b.ledger.cell}`}>
                        {detailBill[`${b.key}Bags`] ?? 0}
                      </td>
                      <td className={`px-2 py-2.5 text-right tabular-nums text-slate-800 ${b.ledger.cell}`}>
                        {money(detailBill[`${b.key}UnitPrice`])}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 ${b.ledger.cell}`}>
                        {money(detailBill[`${b.key}Line`])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-indigo-50 px-4 py-3 ring-1 ring-indigo-100">
              <span className="text-sm font-semibold text-indigo-950">Total bill</span>
              <span className="text-lg font-bold tabular-nums text-indigo-900">{money(detailBill.totalAmount)}</span>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium text-slate-700">Entered by:</span> {detailBill.enteredBy || '—'}
            </p>
            <button
              type="button"
              onClick={() => setDetailBill(null)}
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
