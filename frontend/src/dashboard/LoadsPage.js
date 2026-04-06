import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { getUsername } from '../auth';
import { BRANDS } from './brandTheme';
import { TableFiltersBar, filterControl, inDateRange, rowMatchesQuery } from './tableToolbar';

const apiBase = getApiBase();

const VEHICLE_OPTIONS = ['NW NA 2072', 'NW NB 2071', 'NW NC 2345'];

const emptyForm = () => ({
  date: new Date().toISOString().slice(0, 10),
  stockId: '',
  vehicleNumber: '',
  tokyoBags: '',
  tokyoCost: '',
  samudraBags: '',
  samudraCost: '',
  atlasBags: '',
  atlasCost: '',
  nipponBags: '',
  nipponCost: '',
});

/** Next ID after the highest existing STK-nnnn (or plain number); defaults to STK-0001. */
function nextSuggestedStockId(records) {
  let max = 0;
  for (const r of records) {
    const raw = String(r.stockId ?? '').trim();
    if (!raw) continue;
    const m = /^STK-(\d+)$/i.exec(raw);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
      continue;
    }
    if (/^\d+$/.test(raw)) {
      max = Math.max(max, parseInt(raw, 10));
    }
  }
  const next = max + 1;
  return `STK-${String(next).padStart(4, '0')}`;
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export default function LoadsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/stocks`);
      if (!res.ok) throw new Error('Failed to load stocks');
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

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const costParts = BRANDS.map((b) => String(r[`${b.key}Cost`] ?? ''));
      const bagParts = BRANDS.map((b) => String(r[`${b.key}Bags`] ?? ''));
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.vehicleNumber,
        r.addedBy,
        String(r.totalAmount ?? ''),
        ...bagParts,
        ...costParts,
      ]);
    });
  }, [rows, search, dateFrom, dateTo]);

  const filteredTotals = useMemo(() => {
    const t = {
      tokyoBags: 0,
      tokyoCost: 0,
      samudraBags: 0,
      samudraCost: 0,
      atlasBags: 0,
      atlasCost: 0,
      nipponBags: 0,
      nipponCost: 0,
      totalAmount: 0,
    };
    for (const r of filteredRows) {
      t.tokyoBags += Number(r.tokyoBags) || 0;
      t.tokyoCost += Number(r.tokyoCost) || 0;
      t.samudraBags += Number(r.samudraBags) || 0;
      t.samudraCost += Number(r.samudraCost) || 0;
      t.atlasBags += Number(r.atlasBags) || 0;
      t.atlasCost += Number(r.atlasCost) || 0;
      t.nipponBags += Number(r.nipponBags) || 0;
      t.nipponCost += Number(r.nipponCost) || 0;
      t.totalAmount += Number(r.totalAmount) || 0;
    }
    return t;
  }, [filteredRows]);

  const openModal = () => {
    setForm({
      ...emptyForm(),
      stockId: nextSuggestedStockId(rows),
    });
    setSaveError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
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
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${apiBase}/api/stocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addedBy: username,
          date: form.date,
          stockId: form.stockId.trim(),
          vehicleNumber: form.vehicleNumber.trim(),
          tokyoBags: form.tokyoBags,
          tokyoCost: form.tokyoCost,
          samudraBags: form.samudraBags,
          samudraCost: form.samudraCost,
          atlasBags: form.atlasBags,
          atlasCost: form.atlasCost,
          nipponBags: form.nipponBags,
          nipponCost: form.nipponCost,
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
          Track load dispatches, vehicle assignments, bag counts, and costs per brand.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-[1.03]"
        >
          Add a Stock
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
            ? `Showing ${filteredRows.length} of ${rows.length} load${rows.length === 1 ? '' : 's'}. Footer totals reflect the filtered rows.`
            : null
        }
      >
        <label className="block min-w-[220px] flex-1 text-sm font-medium text-slate-600">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Stock ID, vehicle, staff, bags, costs…"
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
      </TableFiltersBar>

      <div className="overflow-x-auto rounded-[20px] bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
        <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Date
              </th>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Stock ID
              </th>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Vehicle No.
              </th>
              {BRANDS.map((b) => (
                <th
                  key={b.key}
                  colSpan={2}
                  className={`px-2 py-2 text-center font-bold tracking-wide ${b.ledger.head}`}
                >
                  {b.label}
                </th>
              ))}
              <th rowSpan={2} className="whitespace-nowrap border-l border-slate-100 px-3 py-3 align-bottom text-right">
                Total
              </th>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-3 align-bottom">
                Added by
              </th>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-semibold uppercase text-slate-400">
              {BRANDS.map((b) => (
                <Fragment key={b.key}>
                  <th className={`px-2 py-2 text-center ${b.ledger.sub}`}>Bags</th>
                  <th className={`px-2 py-2 text-center ${b.ledger.sub}`}>Cost</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-slate-500">
                  No stock loads yet. Use &quot;Add a Stock&quot; to create a record.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-10 text-center text-slate-500">
                  No loads match your search or filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const rowLine = 'border-b border-slate-100/90';
                return (
                  <tr key={r.id}>
                    <td
                      className={`whitespace-nowrap px-3 py-3 font-medium ${rowLine} bg-slate-50/70 text-slate-800`}
                    >
                      {r.date}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 ${rowLine} bg-slate-50/70`}>{r.stockId}</td>
                    <td className={`whitespace-nowrap px-3 py-3 ${rowLine} bg-slate-50/70`}>
                      {r.vehicleNumber}
                    </td>
                    {BRANDS.map((b) => (
                      <Fragment key={b.key}>
                        <td
                          className={`px-2 py-3 text-center tabular-nums transition-colors hover:brightness-[0.98] ${rowLine} ${b.ledger.cellLead}`}
                        >
                          {r[`${b.key}Bags`] ?? 0}
                        </td>
                        <td
                          className={`px-2 py-3 text-right tabular-nums transition-colors hover:brightness-[0.98] ${rowLine} ${b.ledger.cell} text-slate-900`}
                        >
                          {money(r[`${b.key}Cost`])}
                        </td>
                      </Fragment>
                    ))}
                    <td
                      className={`border-l border-slate-100 px-3 py-3 text-right font-semibold text-slate-900 tabular-nums ${rowLine} bg-white`}
                    >
                      {money(r.totalAmount)}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 text-slate-600 ${rowLine} bg-white`}>
                      {r.addedBy}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
                <td colSpan={3} className="bg-slate-100/80 px-3 py-3">
                  Totals (filtered)
                </td>
                {BRANDS.map((b) => (
                  <Fragment key={b.key}>
                    <td
                      className={`px-2 py-3 text-center tabular-nums ${b.ledger.cellLead} brightness-[1.02]`}
                    >
                      {filteredTotals[`${b.key}Bags`]}
                    </td>
                    <td className={`px-2 py-3 text-right tabular-nums text-slate-900 ${b.ledger.cell} brightness-[1.02]`}>
                      {money(filteredTotals[`${b.key}Cost`])}
                    </td>
                  </Fragment>
                ))}
                <td className="border-l border-slate-200 bg-indigo-50/60 px-3 py-3 text-right text-indigo-900 tabular-nums">
                  {money(filteredTotals.totalAmount)}
                </td>
                <td className="bg-slate-50/90 px-3 py-3" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="loads-modal-title">
          <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-label="Close" onClick={closeModal} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
            <h2 id="loads-modal-title" className="text-lg font-bold text-slate-900">
              Add a stock load
            </h2>
            <p className="mt-1 text-sm text-slate-500">Recorded as user: {getUsername() || '—'}</p>
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
                  Stock ID
                  <input
                    type="text"
                    required
                    value={form.stockId}
                    onChange={(e) => handleFormChange('stockId', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                    placeholder="STK-0001"
                    autoComplete="off"
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-400">
                    Suggested next ID — you can edit before saving.
                  </span>
                </label>
                <label className="col-span-full block text-sm font-medium text-slate-600 sm:col-span-2">
                  Vehicle number
                  <select
                    required
                    value={form.vehicleNumber}
                    onChange={(e) => handleFormChange('vehicleNumber', e.target.value)}
                    className="mt-1 w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/35"
                  >
                    <option value="">Select vehicle…</option>
                    {VEHICLE_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cement bags & cost</p>
                <div className="mt-3 space-y-3">
                  {BRANDS.map((b) => (
                    <div key={b.key} className="grid grid-cols-3 items-end gap-2">
                      <span className="col-span-3 text-sm font-medium text-slate-700 sm:col-span-1">{b.label}</span>
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
                        Cost (LKR)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={form[`${b.key}Cost`]}
                          onChange={(e) => handleFormChange(`${b.key}Cost`, e.target.value)}
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
                  onClick={closeModal}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
