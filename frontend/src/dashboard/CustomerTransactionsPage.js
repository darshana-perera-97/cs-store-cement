import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiBase } from '../apiBase';
import { TableFiltersBar, filterControl, rowMatchesQuery } from './tableToolbar';

const apiBase = getApiBase();

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

export default function CustomerTransactionsPage() {
  const { customerId } = useParams();
  const [customer, setCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/customers/${encodeURIComponent(customerId)}/transactions`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load transactions');
      }
      setCustomer(data.customer || null);
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setCustomer(null);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (kindFilter !== 'all' && tx.kind !== kindFilter) return false;
      return rowMatchesQuery(search, [tx.date, tx.type, tx.details, String(tx.amount)]);
    });
  }, [transactions, search, kindFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/dashboard/customers"
            className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
          >
            ← Back to Customers
          </Link>
          <h2 className="mt-3 text-base font-bold text-slate-900">
            {customer ? `Transactions — ${customer.name}` : 'Customer transactions'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Credit sales and opening balance both add to what the customer owes; record payments on the{' '}
            <Link to="/dashboard/payments" className="font-semibold text-indigo-600 hover:text-indigo-800">
              Payments
            </Link>{' '}
            page — they reduce this balance.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading || !customerId}
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {customer ? (
        <div className="rounded-2xl bg-gradient-to-br from-slate-50 to-indigo-50/40 px-5 py-4 ring-1 ring-slate-100/80">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount to pay (updated)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{money(customer.remainingAmount)}</p>
          <p className="mt-2 text-sm text-slate-600">
            Opening credit, credit sales (by name), minus payments — same total as the customers list.
          </p>
          {customer.location ? (
            <p className="mt-2 text-sm text-slate-500">
              {customer.location}
              {customer.contactNumber ? ` · ${customer.contactNumber}` : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900">Full activity</h3>
        <p className="text-xs text-slate-500">Opening credit, credit sales, and payments in one timeline.</p>
        <TableFiltersBar
          hint={
            !loading && transactions.length > 0
              ? `Showing ${filteredTransactions.length} of ${transactions.length} row${transactions.length === 1 ? '' : 's'}`
              : null
          }
        >
          <label className="block min-w-[200px] flex-1 text-sm font-medium text-slate-600">
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Date, type, details, amount…"
              className={filterControl}
            />
          </label>
          <label className="block min-w-[200px] text-sm font-medium text-slate-600">
            Type
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className={filterControl}
            >
              <option value="all">All activity</option>
              <option value="opening">Opening balance</option>
              <option value="bill">Credit sales</option>
              <option value="payment">Payments</option>
            </select>
          </label>
        </TableFiltersBar>
        <div className="overflow-x-auto rounded-[20px] bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-100">
          {loading ? (
            <p className="px-4 py-12 text-center text-sm text-slate-500">Loading…</p>
          ) : (
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Details</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      No transactions found.
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      No rows match your search or type filter.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={`${tx.kind}-${tx.id}`} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{tx.date}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{tx.type}</td>
                      <td className="max-w-md px-4 py-3 text-slate-600">
                        <span className="line-clamp-2">{tx.details}</span>
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${
                          tx.direction === 'credit' ? 'text-emerald-700' : 'text-slate-900'
                        }`}
                      >
                        {tx.direction === 'credit' ? `−${money(tx.amount)}` : money(tx.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
