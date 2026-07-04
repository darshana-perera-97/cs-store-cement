import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { BRANDS } from './brandTheme';
import {
  TableFiltersBar,
  filterControl,
  inDateRange,
  scrollTableWrap,
  stickyThead,
} from './tableToolbar';
import { buildChequeTableRows, chequePortion } from './paymentCheques';
import { downloadCustomerOutstandingReport } from './customerOutstandingExport';
import { downloadLoadsSummaryPdf } from './loadsSummaryPdf';
import { downloadReportsPdf } from './reportsPdf';
import { downloadRefReport } from './reportsRefExport';

const apiBase = getApiBase();

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentIsoWeekValue(d = new Date()) {
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function currentMonthValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthDisplayLabel(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return monthValue || '—';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function daysFromYmdToToday(fromYmd, toYmd = localYmd()) {
  if (!fromYmd || !toYmd || fromYmd.length < 10 || toYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(fromYmd.slice(0, 4), 10),
    parseInt(fromYmd.slice(5, 7), 10) - 1,
    parseInt(fromYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(toYmd.slice(0, 4), 10),
    parseInt(toYmd.slice(5, 7), 10) - 1,
    parseInt(toYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function buildShopRowsForRange(bills, payments, customerLocationMap, from, to, brandKey = '') {
  const map = new Map();

  const ensure = (name) => {
    const key = String(name ?? '').trim() || '—';
    if (!map.has(key)) {
      const location = customerLocationMap.get(key.toLowerCase()) || '';
      map.set(key, {
        shop: key,
        location,
        tokyoBags: 0,
        samudraBags: 0,
        atlasBags: 0,
        nipponBags: 0,
        totalBags: 0,
        creditSales: 0,
        billCount: 0,
        cashIn: 0,
        paymentCount: 0,
      });
    }
    return map.get(key);
  };

  for (const b of bills) {
    if (!inDateRange(b.date, from, to)) continue;
    if (!recordHasBrandBags(b, brandKey)) continue;
    const row = ensure(b.customerName);
    const { byBrand, total } = bagsFromRecord(b, brandKey);
    row.tokyoBags += byBrand.tokyo || 0;
    row.samudraBags += byBrand.samudra || 0;
    row.atlasBags += byBrand.atlas || 0;
    row.nipponBags += byBrand.nippon || 0;
    row.totalBags += total;
    row.creditSales += brandLineFromBill(b, brandKey);
    row.billCount += 1;
  }

  for (const p of payments) {
    if (!inDateRange(p.date, from, to)) continue;
    const row = ensure(p.customerName);
    row.cashIn += paymentTotal(p);
    row.paymentCount += 1;
  }

  return [...map.values()].sort((a, b) => a.shop.localeCompare(b.shop));
}

/** ISO calendar week (Mon–Sun) from `<input type="week">` value e.g. `2026-W22`. */
function weeklyRangeFromWeekValue(weekValue) {
  const match = /^(\d{4})-W(\d{2})$/i.exec(String(weekValue ?? '').trim());
  if (!match) return weeklyRangeFromWeekValue(currentIsoWeekValue());
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  const from = new Date(week1Monday);
  from.setDate(week1Monday.getDate() + (week - 1) * 7);
  const to = new Date(from);
  to.setDate(from.getDate() + 6);
  return { from: localYmd(from), to: localYmd(to) };
}

/** Calendar month from `<input type="month">` value e.g. `2026-06`. */
function monthlyRangeFromMonthValue(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthValue ?? '').trim());
  if (!match) return monthlyRangeFromMonthValue(currentMonthValue());
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  return { from: localYmd(from), to: localYmd(to) };
}

function money(n) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'LKR',
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function bagsFromRecord(record, brandKey = '') {
  const byBrand = {};
  let total = 0;
  const brands = brandKey ? BRANDS.filter((b) => b.key === brandKey) : BRANDS;
  for (const b of brands) {
    const n = Number(record[b.bagsField]) || 0;
    byBrand[b.key] = n;
    total += n;
  }
  return { byBrand, total };
}

function brandLineFromBill(bill, brandKey) {
  if (!brandKey) return Number(bill.totalAmount) || 0;
  const line = Number(bill[`${brandKey}Line`]);
  if (line > 0) return line;
  const bags = Number(bill[`${brandKey}Bags`]) || 0;
  const price = Number(bill[`${brandKey}UnitPrice`]) || 0;
  return Math.round(bags * price * 100) / 100;
}

function recordHasBrandBags(record, brandKey) {
  if (!brandKey) return true;
  const brand = BRANDS.find((b) => b.key === brandKey);
  return brand ? (Number(record[brand.bagsField]) || 0) > 0 : false;
}

/** Matches backend `paymentCreditToCustomer`: cash + cheque credited to the customer. */
function paymentTotal(p) {
  const total = Number(p.amount) || 0;
  if (total > 0) return total;
  return (Number(p.cashAmount) || 0) + (Number(p.chequeAmount) || 0);
}

/** Physical cash in — treated as bank deposit on the payment date (same as Bank page). */
function cashPortion(p) {
  if (p.cashAmount !== undefined || p.chequeAmount !== undefined) {
    return Math.max(0, Number(p.cashAmount) || 0);
  }
  return paymentTotal(p);
}

function buildDailyBankRows(payments) {
  const map = new Map();
  for (const p of payments) {
    const d = String(p.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const cash = cashPortion(p);
    const chq = chequePortion(p);
    const cur = map.get(d) || { date: d, cashIn: 0, bankDeposit: 0, totalIncome: 0 };
    cur.cashIn += cash;
    cur.bankDeposit += cash;
    cur.totalIncome += cash + chq;
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function buildPendingChequeRows(payments, from, to) {
  const rows = buildChequeTableRows(payments, (p, _c, flat) => {
    if (flat.chequeDeposited) return null;
    if (!inDateRange(flat.chequeDate, from, to)) return null;
    return {
      id: flat.rowKey,
      chequeDate: flat.chequeDate,
      amount: flat.amount,
      chequeNumber: flat.chequeNumber,
      customerName: String(p.customerName ?? '').trim() || '—',
      billNumber: p.billNumber != null ? String(p.billNumber) : '—',
      paymentDate: String(p.date ?? '').slice(0, 10) || '—',
      sortAt: p.createdAt || `${p.date}T12:00:00`,
    };
  });
  rows.sort((a, b) => {
    const cmp = a.chequeDate.localeCompare(b.chequeDate);
    if (cmp !== 0) return cmp;
    return String(a.sortAt).localeCompare(String(b.sortAt));
  });
  return rows;
}

const periodBtn =
  'rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40';
const periodActive = 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80';
const periodIdle = 'text-slate-600 hover:bg-white/60';

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function BrandBagSummary({ byBrand, total, loadCount, brandKey = '' }) {
  const visibleBrands = brandKey ? BRANDS.filter((b) => b.key === brandKey) : BRANDS;
  return (
    <div
      className={`grid gap-3 sm:grid-cols-2 ${visibleBrands.length > 1 ? 'lg:grid-cols-5' : 'lg:grid-cols-2'}`}
    >
      {visibleBrands.map((b) => (
        <div
          key={b.key}
          className={`rounded-xl bg-gradient-to-br ${b.accent} p-4 text-white shadow-md ring-1 ${b.ring}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-white/85">{b.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{(byBrand[b.key] || 0).toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-white/75">bags</p>
        </div>
      ))}
      <div className="rounded-xl bg-slate-800 p-4 text-white shadow-md ring-1 ring-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/85">Total</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{total.toLocaleString()}</p>
        <p className="mt-0.5 text-xs text-white/75">
          from {loadCount} load{loadCount === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [loads, setLoads] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [periodMode, setPeriodMode] = useState('weekly');
  const [selectedWeek, setSelectedWeek] = useState(() => currentIsoWeekValue());
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthValue());
  const [dateFrom, setDateFrom] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).from);
  const [dateTo, setDateTo] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).to);
  const [appliedFrom, setAppliedFrom] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).from);
  const [appliedTo, setAppliedTo] = useState(() => weeklyRangeFromWeekValue(currentIsoWeekValue()).to);
  const [brandFilter, setBrandFilter] = useState('');
  const [loadsSummaryMonth, setLoadsSummaryMonth] = useState(() => currentMonthValue());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadsRes, billsRes, paymentsRes, customersRes] = await Promise.all([
        fetch(`${apiBase}/api/stocks`),
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/payments`),
        fetch(`${apiBase}/api/customers`),
      ]);
      if (!loadsRes.ok) throw new Error('Failed to load loads');
      if (!billsRes.ok) throw new Error('Failed to load bills');
      if (!paymentsRes.ok) throw new Error('Failed to load payments');
      if (!customersRes.ok) throw new Error('Failed to load customers');

      const [loadsData, billsData, paymentsData, customersData] = await Promise.all([
        loadsRes.json(),
        billsRes.json(),
        paymentsRes.json(),
        customersRes.json(),
      ]);

      setLoads(Array.isArray(loadsData) ? loadsData : []);
      setBills(Array.isArray(billsData) ? billsData : []);
      setPayments(Array.isArray(paymentsData) ? paymentsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
    } catch (e) {
      setError(e.message || 'Could not load report data');
      setLoads([]);
      setBills([]);
      setPayments([]);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const customerLocationMap = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const name = String(c.name ?? '').trim();
      if (name) map.set(name.toLowerCase(), String(c.location ?? '').trim());
    }
    return map;
  }, [customers]);

  const applyWeek = (weekValue) => {
    const week = weekValue || currentIsoWeekValue();
    const { from, to } = weeklyRangeFromWeekValue(week);
    setSelectedWeek(week);
    setDateFrom(from);
    setDateTo(to);
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const applyMonth = (monthValue) => {
    const month = monthValue || currentMonthValue();
    const { from, to } = monthlyRangeFromMonthValue(month);
    setSelectedMonth(month);
    setDateFrom(from);
    setDateTo(to);
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const handlePeriodChange = (mode) => {
    setPeriodMode(mode);
    if (mode === 'weekly') {
      applyWeek(selectedWeek || currentIsoWeekValue());
    } else if (mode === 'monthly') {
      applyMonth(selectedMonth || currentMonthValue());
    }
  };

  const handleGenerate = () => {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
  };

  const activeBrand = useMemo(() => BRANDS.find((b) => b.key === brandFilter) ?? null, [brandFilter]);

  const loadsReport = useMemo(() => {
    const filtered = loads.filter(
      (r) => inDateRange(r.date, appliedFrom, appliedTo) && recordHasBrandBags(r, brandFilter),
    );
    const byBrand = Object.fromEntries(BRANDS.map((b) => [b.key, 0]));
    let total = 0;
    for (const r of filtered) {
      const { byBrand: row, total: rowTotal } = bagsFromRecord(r, brandFilter);
      for (const b of BRANDS) byBrand[b.key] += row[b.key] || 0;
      total += rowTotal;
    }
    return { byBrand, total, loadCount: filtered.length };
  }, [loads, appliedFrom, appliedTo, brandFilter]);

  const shopRows = useMemo(
    () =>
      buildShopRowsForRange(
        bills,
        payments,
        customerLocationMap,
        appliedFrom,
        appliedTo,
        brandFilter,
      ),
    [bills, payments, appliedFrom, appliedTo, customerLocationMap, brandFilter],
  );

  const loadsSummaryRange = useMemo(
    () => monthlyRangeFromMonthValue(loadsSummaryMonth),
    [loadsSummaryMonth],
  );

  const loadsSummaryMonthLabel = useMemo(
    () => monthDisplayLabel(loadsSummaryMonth),
    [loadsSummaryMonth],
  );

  const monthLoadsReport = useMemo(() => {
    const { from, to } = loadsSummaryRange;
    const filtered = loads.filter((r) => inDateRange(r.date, from, to));
    const byBrand = Object.fromEntries(BRANDS.map((b) => [b.key, 0]));
    let total = 0;
    let totalAmount = 0;
    for (const r of filtered) {
      const { byBrand: row, total: rowTotal } = bagsFromRecord(r, '');
      for (const b of BRANDS) byBrand[b.key] += row[b.key] || 0;
      total += rowTotal;
      totalAmount += Number(r.totalAmount) || 0;
    }
    return { byBrand, total, loadCount: filtered.length, totalAmount };
  }, [loads, loadsSummaryRange]);

  const monthLoadRows = useMemo(() => {
    const { from, to } = loadsSummaryRange;
    return loads
      .filter((r) => inDateRange(r.date, from, to))
      .map((r) => ({
        date: String(r.date ?? '').slice(0, 10),
        stockId: String(r.stockId ?? '').trim(),
        vehicleNumber: String(r.vehicleNumber ?? '').trim(),
        tokyoBags: Number(r.tokyoBags) || 0,
        samudraBags: Number(r.samudraBags) || 0,
        atlasBags: Number(r.atlasBags) || 0,
        nipponBags: Number(r.nipponBags) || 0,
        totalAmount: Number(r.totalAmount) || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.stockId.localeCompare(b.stockId));
  }, [loads, loadsSummaryRange]);

  const monthShopRows = useMemo(
    () =>
      buildShopRowsForRange(
        bills,
        payments,
        customerLocationMap,
        loadsSummaryRange.from,
        loadsSummaryRange.to,
        '',
      ),
    [bills, payments, customerLocationMap, loadsSummaryRange],
  );

  const monthShopTotals = useMemo(
    () =>
      monthShopRows.reduce(
        (acc, r) => ({
          totalBags: acc.totalBags + r.totalBags,
          creditSales: acc.creditSales + r.creditSales,
          cashIn: acc.cashIn + r.cashIn,
        }),
        { totalBags: 0, creditSales: 0, cashIn: 0 },
      ),
    [monthShopRows],
  );

  const shopOutstandingByName = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const name = String(c.name ?? '').trim();
      if (!name) continue;
      map.set(name.toLowerCase(), Math.max(0, Number(c.remainingAmount) || 0));
      map.set(name, Math.max(0, Number(c.remainingAmount) || 0));
    }
    return map;
  }, [customers]);

  const outstandingForShop = useCallback(
    (shop) => {
      const key = String(shop ?? '').trim();
      if (!key) return 0;
      if (shopOutstandingByName.has(key)) return shopOutstandingByName.get(key);
      return shopOutstandingByName.get(key.toLowerCase()) ?? 0;
    },
    [shopOutstandingByName],
  );

  const monthInvoiceRows = useMemo(() => {
    const { from, to } = loadsSummaryRange;
    const asOf = localYmd();
    const rows = [];
    for (const b of bills) {
      if (!inDateRange(b.date, from, to)) continue;
      const shop = String(b.customerName ?? '').trim() || '—';
      const invoiceDate = String(b.date ?? '').slice(0, 10);
      rows.push({
        shop,
        invoiceDate,
        daysFromBillDate: daysFromYmdToToday(invoiceDate, asOf),
        amount: Number(b.totalAmount) || 0,
      });
    }
    rows.sort((a, b) => {
      const shopCmp = a.shop.localeCompare(b.shop);
      if (shopCmp !== 0) return shopCmp;
      return a.invoiceDate.localeCompare(b.invoiceDate);
    });
    return rows;
  }, [bills, loadsSummaryRange]);

  const monthInvoiceGroups = useMemo(() => {
    const groups = new Map();
    for (const row of monthInvoiceRows) {
      if (!groups.has(row.shop)) {
        groups.set(row.shop, {
          shop: row.shop,
          invoices: [],
          totalAmount: 0,
          outstanding: outstandingForShop(row.shop),
        });
      }
      const g = groups.get(row.shop);
      g.invoices.push(row);
      g.totalAmount += row.amount;
    }
    return [...groups.values()].sort((a, b) => a.shop.localeCompare(b.shop));
  }, [monthInvoiceRows, outstandingForShop]);

  const monthInvoiceGrandTotals = useMemo(
    () =>
      monthInvoiceGroups.reduce(
        (acc, g) => ({
          totalAmount: acc.totalAmount + g.totalAmount,
          outstanding: acc.outstanding + g.outstanding,
        }),
        { totalAmount: 0, outstanding: 0 },
      ),
    [monthInvoiceGroups],
  );

  const visibleBrands = useMemo(
    () => (activeBrand ? [activeBrand] : BRANDS),
    [activeBrand],
  );

  const refDetailRows = useMemo(() => {
    const brands = brandFilter ? BRANDS.filter((b) => b.key === brandFilter) : BRANDS;
    const rows = [];
    for (const b of bills) {
      if (!inDateRange(b.date, appliedFrom, appliedTo)) continue;
      if (!recordHasBrandBags(b, brandFilter)) continue;
      const shop = String(b.customerName ?? '').trim() || '—';
      const location = customerLocationMap.get(shop.toLowerCase()) || '';
      const date = String(b.date ?? '').slice(0, 10);
      for (const brand of brands) {
        const bagCount = Number(b[brand.bagsField]) || 0;
        if (bagCount <= 0) continue;
        rows.push({
          date,
          shop,
          location,
          bagType: brand.label,
          bagCount,
        });
      }
    }
    rows.sort((a, b) => {
      const shopCmp = a.shop.localeCompare(b.shop);
      if (shopCmp !== 0) return shopCmp;
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.bagType.localeCompare(b.bagType);
    });
    return rows;
  }, [bills, appliedFrom, appliedTo, brandFilter, customerLocationMap]);

  const shopTotals = useMemo(
    () =>
      shopRows.reduce(
        (acc, r) => ({
          totalBags: acc.totalBags + r.totalBags,
          creditSales: acc.creditSales + r.creditSales,
          cashIn: acc.cashIn + r.cashIn,
        }),
        { totalBags: 0, creditSales: 0, cashIn: 0 },
      ),
    [shopRows],
  );

  const bankDailyRows = useMemo(() => {
    const all = buildDailyBankRows(payments);
    return all.filter((r) => inDateRange(r.date, appliedFrom, appliedTo));
  }, [payments, appliedFrom, appliedTo]);

  const bankDailyTotals = useMemo(
    () =>
      bankDailyRows.reduce(
        (acc, r) => ({
          cashIn: acc.cashIn + r.cashIn,
          bankDeposit: acc.bankDeposit + r.bankDeposit,
          totalIncome: acc.totalIncome + r.totalIncome,
        }),
        { cashIn: 0, bankDeposit: 0, totalIncome: 0 },
      ),
    [bankDailyRows],
  );

  const pendingChequeRows = useMemo(
    () => buildPendingChequeRows(payments, appliedFrom, appliedTo),
    [payments, appliedFrom, appliedTo],
  );

  const pendingChequeTotal = useMemo(
    () => pendingChequeRows.reduce((s, r) => s + r.amount, 0),
    [pendingChequeRows],
  );

  const periodLabel =
    appliedFrom && appliedTo
      ? `${appliedFrom} → ${appliedTo}`
      : appliedFrom
        ? `From ${appliedFrom}`
        : appliedTo
          ? `Until ${appliedTo}`
          : 'All dates';

  const filterHint = [
    `Report period: ${periodLabel}`,
    activeBrand ? `Brand: ${activeBrand.label}` : 'Brand: All brands',
  ].join(' · ');

  const handleDownloadPdf = useCallback(() => {
    downloadReportsPdf(
      {
        periodLabel,
        brandLabel: activeBrand ? activeBrand.label : 'All brands',
        loadsReport,
        visibleBrands,
        shopRows,
        shopTotals,
        bankDailyRows,
        bankDailyTotals,
        pendingChequeRows,
        pendingChequeTotal,
      },
      { dateFrom: appliedFrom, dateTo: appliedTo },
    );
  }, [
    appliedFrom,
    appliedTo,
    periodLabel,
    activeBrand,
    loadsReport,
    visibleBrands,
    shopRows,
    shopTotals,
    bankDailyRows,
    bankDailyTotals,
    pendingChequeRows,
    pendingChequeTotal,
  ]);

  const handleDownloadRef = useCallback(() => {
    downloadRefReport(
      refDetailRows,
      {
        periodLabel,
        brandLabel: activeBrand ? activeBrand.label : 'All brands',
      },
      { dateFrom: appliedFrom, dateTo: appliedTo, brandLabel: activeBrand ? activeBrand.label : 'All brands' },
    );
  }, [refDetailRows, periodLabel, activeBrand, appliedFrom, appliedTo]);

  const downloadBtnClass =
    'rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

  const todayYmd = useMemo(() => localYmd(), []);

  const outstandingSummary = useMemo(() => {
    let totalOutstanding = 0;
    let totalCredit = 0;
    let withBalance = 0;
    for (const c of customers) {
      const outstanding = Math.max(0, Number(c.remainingAmount) || 0);
      const credit = Math.max(0, Number(c.overpaymentAmount) || 0);
      totalOutstanding += outstanding;
      totalCredit += credit;
      if (outstanding > 0) withBalance += 1;
    }
    return { totalOutstanding, totalCredit, withBalance, customerCount: customers.length };
  }, [customers]);

  const outstandingRows = useMemo(() => {
    return [...customers]
      .map((c) => ({
        id: c.id,
        name: String(c.name ?? '').trim() || '—',
        location: String(c.location ?? '').trim(),
        dueDate: String(c.dueDate ?? '').slice(0, 10) || '—',
        outstanding: Math.max(0, Number(c.remainingAmount) || 0),
        credit: Math.max(0, Number(c.overpaymentAmount) || 0),
      }))
      .filter((r) => r.outstanding > 0 || r.credit > 0)
      .sort((a, b) => {
        const balCmp = b.outstanding - a.outstanding;
        if (balCmp !== 0) return balCmp;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  }, [customers]);

  const handleDownloadOutstanding = useCallback(() => {
    downloadCustomerOutstandingReport(customers, { asOfDate: todayYmd });
  }, [customers, todayYmd]);

  const handleDownloadLoadsSummary = useCallback(() => {
    downloadLoadsSummaryPdf(
      {
        monthLabel: loadsSummaryMonthLabel,
        loadsReport: monthLoadsReport,
        loadRows: monthLoadRows,
        invoiceRows: monthInvoiceRows,
        shopOutstandingByName,
      },
      { monthSlug: loadsSummaryMonth },
    );
  }, [
    loadsSummaryMonth,
    loadsSummaryMonthLabel,
    monthLoadsReport,
    monthLoadRows,
    monthInvoiceRows,
    shopOutstandingByName,
  ]);

  return (
    <div className="space-y-5">
      <div className="rounded-[20px] bg-white p-5 shadow-lg shadow-slate-200/40 ring-1 ring-slate-100 sm:p-6">
        <h1 className="text-lg font-bold text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Download today&apos;s customer outstanding balances, a monthly loads summary with per-shop sales and cash
          in, or generate weekly, monthly, and custom-period reports for cement bags, credit sales, bank deposits,
          and pending cheques.
        </p>
      </div>

      <Card
        title="Total loads summary"
        subtitle={`Bags brought in during ${loadsSummaryMonthLabel} — credit invoices that month with days from bill date, outstanding | total per shop`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[160px] text-sm font-medium text-slate-600">
            Month
            <input
              type="month"
              value={loadsSummaryMonth}
              onChange={(e) => setLoadsSummaryMonth(e.target.value || currentMonthValue())}
              className={filterControl}
            />
          </label>
          <button
            type="button"
            onClick={handleDownloadLoadsSummary}
            disabled={loading || !!error}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download loads summary (PDF)
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl bg-slate-800 p-4 text-white shadow-md ring-1 ring-slate-700 sm:col-span-2 lg:col-span-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/85">Bags from loads</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{monthLoadsReport.total.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-white/75">
              {monthLoadsReport.loadCount} load{monthLoadsReport.loadCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Load purchase total</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-900">{money(monthLoadsReport.totalAmount)}</p>
          </div>
          <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Bags sold</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-sky-900">
              {monthShopTotals.totalBags.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Invoice total</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-violet-900">
              {money(monthInvoiceGrandTotals.totalAmount)}
            </p>
          </div>
          <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Outstanding (shops)</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-rose-900">
              {money(monthInvoiceGrandTotals.outstanding)}
            </p>
          </div>
        </div>

        <div className={`mt-5 ${scrollTableWrap}`}>
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-4 py-3">Shop name</th>
                <th className="whitespace-nowrap px-4 py-3">Invoice date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Days from bill date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : monthInvoiceGroups.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No credit invoices in {loadsSummaryMonthLabel}.
                  </td>
                </tr>
              ) : (
                monthInvoiceGroups.flatMap((g) => [
                  ...g.invoices.map((inv, idx) => (
                    <tr
                      key={`${g.shop}-${inv.invoiceDate}-${idx}`}
                      className="border-t border-slate-100 hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{inv.shop}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                        {inv.invoiceDate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                        {inv.daysFromBillDate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {money(inv.amount)}
                      </td>
                    </tr>
                  )),
                  <tr
                    key={`${g.shop}-subtotal`}
                    className="border-t border-slate-200 bg-slate-50/90 font-semibold text-slate-900"
                  >
                    <td className="px-4 py-3">{g.shop}</td>
                    <td className="px-4 py-3 text-slate-600" colSpan={2}>
                      Outstanding | Total
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-800">
                      {money(g.outstanding)} | {money(g.totalAmount)}
                    </td>
                  </tr>,
                ])
              )}
            </tbody>
            {!loading && monthInvoiceGroups.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-indigo-50/60 font-semibold text-slate-900">
                  <td className="px-4 py-3">Grand total</td>
                  <td className="px-4 py-3 text-slate-600" colSpan={2}>
                    Outstanding | Total
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-900">
                    {money(monthInvoiceGrandTotals.outstanding)} |{' '}
                    {money(monthInvoiceGrandTotals.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <Card
        title="Customer outstanding (today)"
        subtitle={`Snapshot as of ${todayYmd} — all customers with current balance owed or credit on account`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-indigo-50 p-4 ring-1 ring-indigo-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Total outstanding</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-indigo-900">
              {money(outstandingSummary.totalOutstanding)}
            </p>
            <p className="mt-0.5 text-xs text-indigo-600">
              {outstandingSummary.withBalance} customer{outstandingSummary.withBalance === 1 ? '' : 's'} with balance due
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Total credit</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
              {money(outstandingSummary.totalCredit)}
            </p>
            <p className="mt-0.5 text-xs text-emerald-600">Overpayment on account</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Customers</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
              {outstandingSummary.customerCount}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">Included in download</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadOutstanding}
          disabled={loading || !!error || customers.length === 0}
          className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download outstanding (PDF + Excel)
        </button>

        <div className={`mt-5 ${scrollTableWrap}`}>
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
            <thead className={stickyThead}>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Shop</th>
                <th className="px-4 py-3">Location</th>
                <th className="whitespace-nowrap px-4 py-3">Due date</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Outstanding</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Loading customer balances…
                  </td>
                </tr>
              ) : outstandingRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No customers with an outstanding balance or credit on account.
                  </td>
                </tr>
              ) : (
                outstandingRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.location || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.dueDate}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-indigo-800">
                      {r.outstanding > 0 ? money(r.outstanding) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                      {r.credit > 0 ? money(r.credit) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && outstandingRows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={3}>
                    Total ({outstandingSummary.customerCount} customers in download)
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-indigo-800">
                    {money(outstandingSummary.totalOutstanding)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                    {outstandingSummary.totalCredit > 0 ? money(outstandingSummary.totalCredit) : '—'}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </Card>

      <TableFiltersBar hint={!loading ? filterHint : null}>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-600">Period</span>
          <div className="inline-flex rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/60">
            <button
              type="button"
              className={`${periodBtn} ${periodMode === 'weekly' ? periodActive : periodIdle}`}
              onClick={() => handlePeriodChange('weekly')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`${periodBtn} ${periodMode === 'monthly' ? periodActive : periodIdle}`}
              onClick={() => handlePeriodChange('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`${periodBtn} ${periodMode === 'custom' ? periodActive : periodIdle}`}
              onClick={() => setPeriodMode('custom')}
            >
              Custom
            </button>
          </div>
        </div>

        {periodMode === 'weekly' ? (
          <label className="block min-w-[160px] text-sm font-medium text-slate-600">
            Week
            <input
              type="week"
              value={selectedWeek}
              onChange={(e) => applyWeek(e.target.value)}
              className={filterControl}
            />
          </label>
        ) : null}

        {periodMode === 'monthly' ? (
          <label className="block min-w-[160px] text-sm font-medium text-slate-600">
            Month
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => applyMonth(e.target.value)}
              className={filterControl}
            />
          </label>
        ) : null}

        {periodMode === 'custom' ? (
          <>
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
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleGenerate}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                Generate report
              </button>
            </div>
          </>
        ) : null}

        <label className="block min-w-[160px] text-sm font-medium text-slate-600">
          Brand
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className={filterControl}>
            <option value="">All brands</option>
            {BRANDS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={loading || !!error}
            className={downloadBtnClass}
          >
            Download PDF for CS
          </button>
          <button
            type="button"
            onClick={handleDownloadRef}
            disabled={loading || !!error || refDetailRows.length === 0}
            className={downloadBtnClass}
          >
            Download for Ref
          </button>
        </div>
      </TableFiltersBar>

      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading report data…</p>
      ) : (
        <>
          <Card
            title="Cement bags from loads"
            subtitle={`Total bags received from stock loads in the selected period${activeBrand ? ` (${activeBrand.label} only)` : ''} (${loadsReport.loadCount} load${loadsReport.loadCount === 1 ? '' : 's'})`}
          >
            <BrandBagSummary
              byBrand={loadsReport.byBrand}
              total={loadsReport.total}
              loadCount={loadsReport.loadCount}
              brandKey={brandFilter}
            />
          </Card>

          <Card
            title="Cement bags per shop"
            subtitle={`Credit bill bags sold to each customer in the selected period${activeBrand ? ` (${activeBrand.label} only)` : ''}`}
          >
            <div className={scrollTableWrap}>
              <table className="w-full min-w-[800px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3">Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Location</th>
                    {visibleBrands.map((b) => (
                      <th key={b.key} className="whitespace-nowrap px-4 py-3 text-right">
                        {b.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total bags</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Bills</th>
                  </tr>
                </thead>
                <tbody>
                  {shopRows.filter((r) => r.totalBags > 0).length === 0 ? (
                    <tr>
                      <td colSpan={visibleBrands.length + 4} className="px-4 py-8 text-center text-slate-500">
                        No bag sales in this period{activeBrand ? ` for ${activeBrand.label}` : ''}.
                      </td>
                    </tr>
                  ) : (
                    shopRows
                      .filter((r) => r.totalBags > 0)
                      .map((r) => (
                      <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                        {visibleBrands.map((b) => (
                          <td key={b.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {r[`${b.key}Bags`].toLocaleString()}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {r.totalBags.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                          {r.billCount}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {shopRows.filter((r) => r.totalBags > 0).length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      {visibleBrands.map((b) => {
                        const sum = shopRows
                          .filter((r) => r.totalBags > 0)
                          .reduce((s, r) => s + (r[`${b.key}Bags`] || 0), 0);
                        return (
                          <td key={b.key} className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {sum.toLocaleString()}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopTotals.totalBags.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopRows.filter((r) => r.totalBags > 0).reduce((s, r) => s + r.billCount, 0)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Credit sales per shop"
            subtitle={`Total credit bill amounts per customer in the selected period${activeBrand ? ` (${activeBrand.label} line totals only)` : ''}`}
          >
            <div className={scrollTableWrap}>
              <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3">Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Location</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Bills</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Credit sales</th>
                  </tr>
                </thead>
                <tbody>
                  {shopRows.filter((r) => r.creditSales > 0).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No credit sales in this period.
                      </td>
                    </tr>
                  ) : (
                    shopRows
                      .filter((r) => r.creditSales > 0)
                      .sort((a, b) => b.creditSales - a.creditSales)
                      .map((r) => (
                        <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                            {r.billCount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {money(r.creditSales)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
                {shopTotals.creditSales > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopRows.reduce((s, r) => s + r.billCount, 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {money(shopTotals.creditSales)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Cash in per shop"
            subtitle="Payments received (cash + cheque) per customer in the selected period"
          >
            <div className={scrollTableWrap}>
              <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3">Shop</th>
                    <th className="whitespace-nowrap px-4 py-3">Location</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Payments</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Cash in</th>
                  </tr>
                </thead>
                <tbody>
                  {shopRows.filter((r) => r.cashIn > 0).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No payments in this period.
                      </td>
                    </tr>
                  ) : (
                    shopRows
                      .filter((r) => r.cashIn > 0)
                      .sort((a, b) => b.cashIn - a.cashIn)
                      .map((r) => (
                        <tr key={r.shop} className="border-t border-slate-100 hover:bg-slate-50/80">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{r.shop}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.location || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">
                            {r.paymentCount}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                            {money(r.cashIn)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
                {shopTotals.cashIn > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {shopRows.reduce((s, r) => s + r.paymentCount, 0)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">
                        {money(shopTotals.cashIn)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Bank cash deposits"
            subtitle="Daily cash taken in (by payment date) — each amount is treated as deposited to the bank on that day"
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Bank deposit total</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-sky-900">{money(bankDailyTotals.bankDeposit)}</p>
                <p className="mt-0.5 text-xs text-sky-600">{bankDailyRows.length} day{bankDailyRows.length === 1 ? '' : 's'}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Cash in</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{money(bankDailyTotals.cashIn)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-4 ring-1 ring-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Total income (cash + cheque)</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{money(bankDailyTotals.totalIncome)}</p>
              </div>
            </div>
            <div className={scrollTableWrap}>
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3">Payment date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Cash in</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Bank deposit</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Total income (cash + cheque)</th>
                  </tr>
                </thead>
                <tbody>
                  {bankDailyRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No cash deposits in this period.
                      </td>
                    </tr>
                  ) : (
                    bankDailyRows.map((r) => (
                      <tr key={r.date} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-slate-900">{r.date}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-800">
                          {money(r.cashIn)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-sky-800">
                          {money(r.bankDeposit)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                          {money(r.totalIncome)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {bankDailyRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3">Total</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bankDailyTotals.cashIn)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bankDailyTotals.bankDeposit)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(bankDailyTotals.totalIncome)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>

          <Card
            title="Cheques to be deposited"
            subtitle="Cheques dated in the selected period that are not yet marked as deposited at the bank"
          >
            <div className="mb-4 rounded-xl bg-violet-50 p-4 ring-1 ring-violet-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Pending deposit total</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-violet-900">{money(pendingChequeTotal)}</p>
              <p className="mt-0.5 text-xs text-violet-600">
                {pendingChequeRows.length} cheque{pendingChequeRows.length === 1 ? '' : 's'} awaiting bank deposit
              </p>
            </div>
            <div className={scrollTableWrap}>
              <table className="w-full min-w-[880px] border-separate border-spacing-0 text-left text-sm">
                <thead className={stickyThead}>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3">Cheque date</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                    <th className="whitespace-nowrap px-4 py-3 font-mono">Cheque #</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3 font-mono">Bill #</th>
                    <th className="whitespace-nowrap px-4 py-3">Payment date</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingChequeRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No cheques pending deposit in this period.
                      </td>
                    </tr>
                  ) : (
                    pendingChequeRows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums font-medium text-slate-900">{r.chequeDate}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-violet-800">
                          {money(r.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.chequeNumber}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{r.customerName}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums">{r.billNumber}</td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.paymentDate}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {pendingChequeRows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                      <td className="px-4 py-3">Total</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-violet-800">
                        {money(pendingChequeTotal)}
                      </td>
                      <td className="px-4 py-3" colSpan={4} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
