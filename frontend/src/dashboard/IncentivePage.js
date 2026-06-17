import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../apiBase';
import { BRANDS } from './brandTheme';
import RowDetailModal, { detailRowAttrs } from './RowDetailModal';
import {
  buildBasicIncentiveRows,
  buildShopGroupedBasicIncentiveRows,
  buildStockGroupedBasicIncentiveRows,
  downloadBasicIncentiveExcel,
  downloadBasicIncentivePdf,
  downloadStockWiseIncentiveExcel,
  downloadStockWiseIncentivePdf,
} from './incentiveBasicExport';
import { downloadIncentiveCompanyReport, resolveLocation } from './incentiveCompanyExport';
import {
  buildShopGroupedDistributionRows,
  downloadIncentiveCalculatorPdf,
  downloadIncentiveCostPdf,
  downloadIncentivePdf,
} from './incentivePdf';
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
const DEFAULT_MARGIN_PER_BAG = 70;

function money(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function moneyOrDash(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return money(n);
}

const negativeMoneyClass = 'font-medium text-orange-600';

function moneyOrDashStyled(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const formatted = money(n);
  if (Number(n) < 0) return <span className={negativeMoneyClass}>{formatted}</span>;
  return formatted;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function priceDiffPerBag(left, right) {
  if (
    left == null ||
    right == null ||
    !Number.isFinite(Number(left)) ||
    !Number.isFinite(Number(right))
  ) {
    return null;
  }
  return round2(Number(left) - Number(right));
}

/** (Per bag price + transport + margin) − cut-off price (per bag). */
function cutOffIncentivePerBag(perBagPrice, transportPerBag, marginPerBag, cutOffPrice) {
  if (
    perBagPrice == null ||
    transportPerBag == null ||
    marginPerBag == null ||
    cutOffPrice == null ||
    !Number.isFinite(Number(perBagPrice)) ||
    !Number.isFinite(Number(transportPerBag)) ||
    !Number.isFinite(Number(marginPerBag)) ||
    !Number.isFinite(Number(cutOffPrice))
  ) {
    return null;
  }
  return round2(
    Number(perBagPrice) + Number(transportPerBag) + Number(marginPerBag) - Number(cutOffPrice),
  );
}

function loadHasIncentivePricing(load) {
  return 'transportCostPerBag' in load || 'marginPerBag' in load;
}

/** One row per stock load × brand (bags > 0). */
function buildIncentiveRows(loads) {
  const rows = [];
  for (const load of loads) {
    const stockId = String(load.stockId ?? '').trim() || '—';
    const loadDate = String(load.date ?? '').slice(0, 10);
    const hasLoadPricing = loadHasIncentivePricing(load);
    const transportPerBagStored = hasLoadPricing ? round2(Number(load.transportCostPerBag) || 0) : null;
    const marginPerBagRaw = load.marginPerBag;
    const marginPerBagForLoad = round2(
      marginPerBagRaw === '' || marginPerBagRaw == null
        ? DEFAULT_MARGIN_PER_BAG
        : Number(marginPerBagRaw) || DEFAULT_MARGIN_PER_BAG,
    );

    for (const b of BRANDS) {
      const bags = Number(load[`${b.key}Bags`]) || 0;
      if (bags <= 0) continue;

      const totalCost = Number(load[`${b.key}Cost`]) || 0;
      const perBagCost = bags > 0 ? round2(totalCost / bags) : 0;
      const invoiceNumber = String(load[`${b.key}Invoice`] ?? '').trim() || '—';
      const chequeNumber = String(load[`${b.key}Cheque`] ?? '').trim() || '—';
      const convertingDate =
        String(load[`${b.key}ConvertingDate`] ?? '').trim().slice(0, 10) || loadDate || '—';

      const cutOffRaw = load[`${b.key}CutOffPrice`];
      const cutOffNumber = cutOffRaw == null || cutOffRaw === '' ? null : Number(cutOffRaw);
      const hasCutOff = cutOffNumber != null && Number.isFinite(cutOffNumber);

      const transportPerBag = round2(transportPerBagStored ?? 0);
      const transportCost = round2(transportPerBag * bags);
      const margin = marginPerBagForLoad;
      const unloadingPrice = round2(perBagCost + transportPerBag + margin);

      rows.push({
        rowKey: `${load.id || stockId}-${b.key}`,
        date: loadDate,
        stockId,
        brandKey: b.key,
        brandLabel: b.label,
        bags,
        totalCost,
        perBagCost,
        invoiceNumber,
        chequeNumber,
        convertingDate,
        transportCost,
        transportPerBag,
        margin,
        cutOffPrice: hasCutOff ? round2(cutOffNumber) : null,
        unloadingPrice,
        vehicleNumber: String(load.vehicleNumber ?? '').trim() || '—',
        addedBy: String(load.addedBy ?? '').trim() || '—',
        totalLoadAmount: Number(load.totalAmount) || 0,
        sourceLoad: load,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    const byStock = b.stockId.localeCompare(a.stockId);
    if (byStock !== 0) return byStock;
    return a.brandLabel.localeCompare(b.brandLabel);
  });

  return rows;
}

function compareLoadOrder(a, b) {
  const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (byDate !== 0) return byDate;
  const byStock = String(a.stockId ?? '').localeCompare(String(b.stockId ?? ''));
  if (byStock !== 0) return byStock;
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function compareBillOrder(a, b) {
  const byDate = String(a.date ?? '').localeCompare(String(b.date ?? ''));
  if (byDate !== 0) return byDate;
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
}

/** Per-bag pricing from stock loads, keyed by stockId|brandKey. */
function buildLoadBrandPricingLookup(loads) {
  const map = new Map();
  for (const load of loads) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;

    const hasLoadPricing = loadHasIncentivePricing(load);
    const transportPerBag = round2(hasLoadPricing ? Number(load.transportCostPerBag) || 0 : 0);
    const marginPerBagRaw = load.marginPerBag;
    const marginPerBag = round2(
      marginPerBagRaw === '' || marginPerBagRaw == null
        ? DEFAULT_MARGIN_PER_BAG
        : Number(marginPerBagRaw) || DEFAULT_MARGIN_PER_BAG,
    );

    for (const b of BRANDS) {
      const bags = Number(load[`${b.key}Bags`]) || 0;
      if (bags <= 0) continue;
      const totalCost = Number(load[`${b.key}Cost`]) || 0;
      const perBagPrice = round2(totalCost / bags);
      const totalCostPerBag = round2(perBagPrice + transportPerBag + marginPerBag);
      const cutOffRaw = load[`${b.key}CutOffPrice`];
      const cutOffNumber = cutOffRaw == null || cutOffRaw === '' ? null : Number(cutOffRaw);
      const cutOffPrice =
        cutOffNumber != null && Number.isFinite(cutOffNumber) ? round2(cutOffNumber) : null;
      const invoiceNumber = String(load[`${b.key}Invoice`] ?? '').trim() || '—';
      const loadDate = String(load.date ?? '').slice(0, 10) || '—';
      map.set(`${stockId}|${b.key}`, {
        perBagPrice,
        cutOffPrice,
        transportPerBag,
        marginPerBag,
        totalCostPerBag,
        invoiceNumber,
        loadDate,
      });
    }
  }
  return map;
}

/** Per-brand FIFO pools from stock loads (oldest load first). */
function buildLoadPools(loads) {
  const pools = Object.fromEntries(BRANDS.map((b) => [b.key, []]));
  for (const load of [...loads].sort(compareLoadOrder)) {
    const stockId = String(load.stockId ?? '').trim();
    if (!stockId) continue;
    for (const b of BRANDS) {
      const bags = Number(load[`${b.key}Bags`]) || 0;
      if (bags > 0) pools[b.key].push({ stockId, remaining: bags });
    }
  }
  return pools;
}

function allocateFromPool(pool, need, stockIdFilter = null) {
  const chunks = [];
  let left = need;
  for (const slot of pool) {
    if (left <= 0) break;
    if (stockIdFilter && slot.stockId !== stockIdFilter) continue;
    if (slot.remaining <= 0) continue;
    const take = Math.min(left, slot.remaining);
    slot.remaining -= take;
    left -= take;
    chunks.push({ stockId: slot.stockId, bags: take });
  }
  return chunks;
}

/**
 * One row per credit bill × brand × stock load.
 * Bills are not stored with a stock ID — bags are matched to loads FIFO (oldest load first).
 */
function buildDistributionRows(loads, bills) {
  const pools = buildLoadPools(loads);
  const pricingLookup = buildLoadBrandPricingLookup(loads);
  const rows = [];

  for (const bill of [...bills].sort(compareBillOrder)) {
    const date = String(bill.date ?? '').slice(0, 10);
    const shop = String(bill.customerName ?? '').trim() || '—';
    const explicitStockId = String(bill.stockId ?? '').trim();

    for (const b of BRANDS) {
      let need = Number(bill[`${b.key}Bags`]) || 0;
      if (need <= 0) continue;

      const pool = pools[b.key];
      let chunks = explicitStockId
        ? allocateFromPool(pool, need, explicitStockId)
        : allocateFromPool(pool, need);

      if (explicitStockId) {
        const taken = chunks.reduce((sum, c) => sum + c.bags, 0);
        if (taken < need) {
          chunks = chunks.concat(allocateFromPool(pool, need - taken));
        }
      }

      const unitPriceRaw = bill[`${b.key}UnitPrice`];
      const sellingPricePerBag =
        unitPriceRaw == null || unitPriceRaw === '' ? null : round2(Number(unitPriceRaw));

      for (const chunk of chunks) {
        const pricing = pricingLookup.get(`${chunk.stockId}|${b.key}`);
        const perBagPrice = pricing?.perBagPrice ?? null;
        const cutOffPrice = pricing?.cutOffPrice ?? null;
        const transportPerBag = pricing?.transportPerBag ?? null;
        const marginPerBag = pricing?.marginPerBag ?? null;
        const totalCostPerBag = pricing?.totalCostPerBag ?? null;
        const invoiceNumber = pricing?.invoiceNumber ?? '—';
        const loadDate = pricing?.loadDate ?? date;
        const incentivePerBag = priceDiffPerBag(totalCostPerBag, sellingPricePerBag);
        const cutOffIncentive = cutOffIncentivePerBag(perBagPrice, transportPerBag, marginPerBag, cutOffPrice);
        const pureIncentivePerBag = priceDiffPerBag(incentivePerBag, cutOffIncentive);
        rows.push({
          rowKey: `${bill.id || date}-${b.key}-${chunk.stockId}-${rows.length}`,
          date,
          loadDate,
          stockId: chunk.stockId,
          shop,
          brandKey: b.key,
          brandLabel: b.label,
          bags: chunk.bags,
          perBagPrice,
          invoiceNumber,
          cutOffPrice,
          transportPerBag,
          marginPerBag,
          totalCostPerBag,
          sellingPricePerBag,
          incentivePerBag,
          cutOffIncentivePerBag: cutOffIncentive,
          pureIncentivePerBag,
          totalIncentive: pureIncentivePerBag != null ? round2(pureIncentivePerBag * chunk.bags) : null,
        });
      }
    }
  }

  rows.sort((a, b) => {
    const byShop = a.shop.localeCompare(b.shop);
    if (byShop !== 0) return byShop;
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    const byStock = a.stockId.localeCompare(b.stockId);
    if (byStock !== 0) return byStock;
    return a.brandLabel.localeCompare(b.brandLabel);
  });

  return rows;
}

export default function IncentivePage() {
  const [loads, setLoads] = useState([]);
  const [bills, setBills] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailRow, setDetailRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadsRes, billsRes, customersRes] = await Promise.all([
        fetch(`${apiBase}/api/stocks`),
        fetch(`${apiBase}/api/bills`),
        fetch(`${apiBase}/api/customers`),
      ]);
      if (!loadsRes.ok) throw new Error('Failed to load stock data');
      if (!billsRes.ok) throw new Error('Failed to load bill data');
      if (!customersRes.ok) throw new Error('Failed to load customer data');
      const [loadsData, billsData, customersData] = await Promise.all([
        loadsRes.json(),
        billsRes.json(),
        customersRes.json(),
      ]);
      setLoads(Array.isArray(loadsData) ? loadsData : []);
      setBills(Array.isArray(billsData) ? billsData : []);
      setCustomers(Array.isArray(customersData) ? customersData : []);
    } catch (e) {
      setError(e.message || 'Could not load data');
      setLoads([]);
      setBills([]);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tableRows = useMemo(() => buildIncentiveRows(loads), [loads]);
  const distributionRows = useMemo(() => buildDistributionRows(loads, bills), [loads, bills]);

  const customerLocationMap = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const name = String(c.name ?? '').trim();
      if (name) map.set(name.toLowerCase(), String(c.location ?? '').trim());
    }
    return map;
  }, [customers]);

  const filteredRows = useMemo(() => {
    return tableRows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.brandLabel,
        r.invoiceNumber,
        r.chequeNumber,
        r.convertingDate,
        String(r.bags),
        String(r.totalCost),
        String(r.perBagCost),
        String(r.cutOffPrice),
        String(r.transportPerBag),
        String(r.transportCost),
        String(r.margin),
        String(r.unloadingPrice),
      ]);
    });
  }, [tableRows, search, dateFrom, dateTo]);

  const filteredDistributionRows = useMemo(() => {
    return distributionRows.filter((r) => {
      if (!inDateRange(r.date, dateFrom, dateTo)) return false;
      const location = resolveLocation(r.shop, customerLocationMap);
      return rowMatchesQuery(search, [
        r.date,
        r.stockId,
        r.shop,
        location,
        r.brandLabel,
        String(r.bags),
        String(r.perBagPrice),
        String(r.cutOffPrice),
        String(r.cutOffIncentivePerBag),
        String(r.transportPerBag),
        String(r.totalCostPerBag),
        String(r.sellingPricePerBag),
        String(r.incentivePerBag),
        String(r.pureIncentivePerBag),
        String(r.totalIncentive),
      ]);
    });
  }, [distributionRows, search, dateFrom, dateTo, customerLocationMap]);

  const groupedDistributionRows = useMemo(
    () => buildShopGroupedDistributionRows(filteredDistributionRows),
    [filteredDistributionRows],
  );

  const basicIncentiveRows = useMemo(
    () => buildBasicIncentiveRows(filteredDistributionRows, customerLocationMap),
    [filteredDistributionRows, customerLocationMap],
  );

  const groupedBasicIncentiveRows = useMemo(
    () => buildShopGroupedBasicIncentiveRows(basicIncentiveRows),
    [basicIncentiveRows],
  );

  const stockGroupedBasicIncentiveRows = useMemo(
    () => buildStockGroupedBasicIncentiveRows(basicIncentiveRows),
    [basicIncentiveRows],
  );

  const basicIncentiveTotals = useMemo(() => {
    let bags = 0;
    let totalIncentive = 0;
    let hasTotalIncentive = false;
    for (const r of basicIncentiveRows) {
      bags += r.bags;
      if (r.basicTotalIncentive != null) {
        totalIncentive += r.basicTotalIncentive;
        hasTotalIncentive = true;
      }
    }
    return {
      bags,
      totalIncentive: round2(totalIncentive),
      hasTotalIncentive,
    };
  }, [basicIncentiveRows]);

  const loadPagination = useTablePagination(filteredRows.length, [search, dateFrom, dateTo]);
  const pagedLoadRows = useMemo(
    () => filteredRows.slice(loadPagination.offset, loadPagination.offset + loadPagination.pageSize),
    [filteredRows, loadPagination.offset, loadPagination.pageSize],
  );

  const basicPagination = useTablePagination(groupedBasicIncentiveRows.length, [search, dateFrom, dateTo]);
  const pagedBasicRows = useMemo(
    () =>
      groupedBasicIncentiveRows.slice(
        basicPagination.offset,
        basicPagination.offset + basicPagination.pageSize,
      ),
    [groupedBasicIncentiveRows, basicPagination.offset, basicPagination.pageSize],
  );

  const distributionPagination = useTablePagination(groupedDistributionRows.length, [
    search,
    dateFrom,
    dateTo,
  ]);
  const pagedDistributionRows = useMemo(
    () =>
      groupedDistributionRows.slice(
        distributionPagination.offset,
        distributionPagination.offset + distributionPagination.pageSize,
      ),
    [groupedDistributionRows, distributionPagination.offset, distributionPagination.pageSize],
  );

  const filteredTotals = useMemo(() => {
    const t = { bags: 0, transportCost: 0, margin: 0, hasTransport: false, hasMargin: false };
    for (const r of filteredRows) {
      t.bags += r.bags;
      if (r.transportPerBag != null) {
        t.transportCost += r.transportPerBag * r.bags;
        t.hasTransport = true;
      }
      if (r.margin != null) {
        t.margin += r.margin * r.bags;
        t.hasMargin = true;
      }
    }
    return t;
  }, [filteredRows]);

  const distributionTotals = useMemo(() => {
    let bags = 0;
    let totalIncentive = 0;
    let hasTotalIncentive = false;
    for (const r of filteredDistributionRows) {
      bags += r.bags;
      if (r.totalIncentive != null) {
        totalIncentive += r.totalIncentive;
        hasTotalIncentive = true;
      }
    }
    return {
      bags,
      totalIncentive: round2(totalIncentive),
      hasTotalIncentive,
    };
  }, [filteredDistributionRows]);

  const brandByKey = useMemo(() => Object.fromEntries(BRANDS.map((b) => [b.key, b])), []);

  const handleDownloadPdf = useCallback(() => {
    downloadIncentivePdf(filteredRows, filteredDistributionRows, { dateFrom, dateTo, search });
  }, [filteredRows, filteredDistributionRows, dateFrom, dateTo, search]);

  const handleDownloadCostPdf = useCallback(() => {
    downloadIncentiveCostPdf(filteredRows, { dateFrom, dateTo, search });
  }, [filteredRows, dateFrom, dateTo, search]);

  const handleDownloadBasicIncentivePdf = useCallback(() => {
    downloadBasicIncentivePdf(groupedBasicIncentiveRows, { dateFrom, dateTo, search });
  }, [groupedBasicIncentiveRows, dateFrom, dateTo, search]);

  const handleDownloadBasicIncentiveExcel = useCallback(() => {
    downloadBasicIncentiveExcel(groupedBasicIncentiveRows, { dateFrom, dateTo, search });
  }, [groupedBasicIncentiveRows, dateFrom, dateTo, search]);

  const handleDownloadStockWiseIncentivePdf = useCallback(() => {
    downloadStockWiseIncentivePdf(stockGroupedBasicIncentiveRows, { dateFrom, dateTo, search });
  }, [stockGroupedBasicIncentiveRows, dateFrom, dateTo, search]);

  const handleDownloadStockWiseIncentiveExcel = useCallback(() => {
    downloadStockWiseIncentiveExcel(stockGroupedBasicIncentiveRows, { dateFrom, dateTo, search });
  }, [stockGroupedBasicIncentiveRows, dateFrom, dateTo, search]);

  const handleDownloadCalculatorPdf = useCallback(() => {
    downloadIncentiveCalculatorPdf(filteredDistributionRows, { dateFrom, dateTo, search });
  }, [filteredDistributionRows, dateFrom, dateTo, search]);

  const handleDownloadForCompany = useCallback(() => {
    downloadIncentiveCompanyReport(filteredDistributionRows, customerLocationMap, {
      dateFrom,
      dateTo,
      search,
    });
  }, [filteredDistributionRows, customerLocationMap, dateFrom, dateTo, search]);

  const downloadPdfButtonClass =
    'rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <TableFiltersBar
        hint={
          !loading && tableRows.length > 0
            ? `Showing ${filteredRows.length} of ${tableRows.length} line${tableRows.length === 1 ? '' : 's'}.`
            : null
        }
      >
        <label className="block min-w-[220px] flex-1 text-sm font-medium text-slate-600">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Stock ID, shop, bag type, invoice, amounts…"
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
        <div className="flex items-end">
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || (filteredRows.length === 0 && filteredDistributionRows.length === 0)}
            onClick={handleDownloadPdf}
          >
            Download PDF
          </button>
        </div>
      </TableFiltersBar>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Cost Calculator for Loads</h2>
          <p className="mt-1 text-sm text-slate-500">
            Stock load pricing by bag type — per-bag price, transport, margin, and total cost per bag.
          </p>
        </div>
        <button
          type="button"
          className={downloadPdfButtonClass}
          disabled={loading || filteredRows.length === 0}
          onClick={handleDownloadCostPdf}
        >
          Download PDF
        </button>
      </div>

      <div className={scrollTableWrap}>
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3">Bag type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Bags</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Per bag price</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Cut-off price (per bag)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Transport </th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Margin</th>
              <th className="whitespace-nowrap bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-3 text-right font-bold text-indigo-900 ring-1 ring-inset ring-indigo-200/50">
                Total cost per bag
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No stock loads yet. Add loads on the Loads page to see incentive data here.
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No rows match your search or filters.
                </td>
              </tr>
            ) : (
              pagedLoadRows.map((r) => {
                const brand = brandByKey[r.brandKey];
                return (
                  <tr
                    key={r.rowKey}
                    {...detailRowAttrs(() => setDetailRow(r), 'bg-white hover:bg-slate-50/80')}
                    aria-label={`Incentive ${r.stockId} ${r.brandLabel} details`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.date}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.perBagCost)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.cutOffPrice)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.transportPerBag)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{moneyOrDashStyled(r.margin)}</td>
                    <td className="whitespace-nowrap bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-3 text-right text-base font-bold tabular-nums text-indigo-950 ring-1 ring-inset ring-indigo-200/40">
                      {moneyOrDashStyled(r.unloadingPrice)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={2} className="px-4 py-3">
                  Totals (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{filteredTotals.bags.toLocaleString()}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {filteredTotals.hasTransport ? moneyOrDashStyled(filteredTotals.transportCost) : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {filteredTotals.hasMargin ? moneyOrDashStyled(filteredTotals.margin) : '—'}
                </td>
                <td className="bg-gradient-to-br from-indigo-50 via-violet-50 to-sky-50 px-4 py-3 ring-1 ring-inset ring-indigo-200/40" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!loading && tableRows.length > 0 ? (
        <TablePaginationBar
          page={loadPagination.page}
          totalPages={loadPagination.totalPages}
          pageSize={loadPagination.pageSize}
          totalCount={filteredRows.length}
          onPageChange={loadPagination.setPage}
          onPageSizeChange={loadPagination.setPageSize}
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Incentive Calculator</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadBasicIncentivePdf}
          >
            Download PDF
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadBasicIncentiveExcel}
          >
            Download Excel
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadStockWiseIncentivePdf}
          >
            Stock wise PDF
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || basicIncentiveRows.length === 0}
            onClick={handleDownloadStockWiseIncentiveExcel}
          >
            Stock wise Excel
          </button>
        </div>
      </div>

      <div className={scrollTableWrap}>
        <table className="w-full min-w-[1480px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3">StockID</th>
              <th className="whitespace-nowrap px-4 py-3">Shop name + Location</th>
              <th className="whitespace-nowrap px-4 py-3">Bag type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">No. Bags</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Bag Price in Invoice</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Transport Cost</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Cut-off price (per bag)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total Cost per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Incentive per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total Incentive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : distributionRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  No shop distributions yet. Add credit bills on the Bills page to see allocations here.
                </td>
              </tr>
            ) : basicIncentiveRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  No rows match your search or filters.
                </td>
              </tr>
            ) : (
              pagedBasicRows.map((r) => {
                if (r.type === 'shopTotal') {
                  return (
                    <tr
                      key={r.rowKey}
                      className="border-t border-slate-200 bg-slate-100/90 font-semibold text-slate-900"
                    >
                      <td colSpan={3} className="px-4 py-3">
                        {r.shopLocation} total
                      </td>
                      <td className="px-4 py-3" />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.hasTotalIncentive ? moneyOrDashStyled(r.basicTotalIncentive) : '—'}
                      </td>
                    </tr>
                  );
                }

                const brand = brandByKey[r.brandKey];
                return (
                  <tr key={r.rowKey} className="bg-white">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.date}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{r.stockId}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-800">{r.shopLocation}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.perBagPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.transportPerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.cutOffPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.totalCostPerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.basicIncentivePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.basicTotalIncentive)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && basicIncentiveRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={4} className="px-4 py-3">
                  Grand total (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{basicIncentiveTotals.bags.toLocaleString()}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {basicIncentiveTotals.hasTotalIncentive
                    ? moneyOrDashStyled(basicIncentiveTotals.totalIncentive)
                    : '—'}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!loading && basicIncentiveRows.length > 0 ? (
        <TablePaginationBar
          page={basicPagination.page}
          totalPages={basicPagination.totalPages}
          pageSize={basicPagination.pageSize}
          totalCount={groupedBasicIncentiveRows.length}
          onPageChange={basicPagination.setPage}
          onPageSizeChange={basicPagination.setPageSize}
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Special Price Calculator</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || filteredDistributionRows.length === 0}
            onClick={handleDownloadCalculatorPdf}
          >
            Download PDF
          </button>
          <button
            type="button"
            className={downloadPdfButtonClass}
            disabled={loading || filteredDistributionRows.length === 0}
            onClick={handleDownloadForCompany}
          >
            Download for Company
          </button>
        </div>
      </div>

      <div className={scrollTableWrap}>
        <table className="w-full min-w-[1680px] border-separate border-spacing-0 text-left text-sm">
          <thead className={stickyThead}>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3">StockID</th>
              <th className="whitespace-nowrap px-4 py-3">Shop Name</th>
              <th className="whitespace-nowrap px-4 py-3">Bag Type</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">No. Bags</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Bag price in invoice</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Cut-off price (per bag)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Incentive for cut-off bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Transport Cost per Bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total cost per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Selling price per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Incentive per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Pure incentive per bag</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Total Incentive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading ? (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : distributionRows.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-slate-500">
                  No shop distributions yet. Add credit bills on the Bills page to see allocations here.
                </td>
              </tr>
            ) : filteredDistributionRows.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-4 py-10 text-center text-slate-500">
                  No rows match your search or filters.
                </td>
              </tr>
            ) : (
              pagedDistributionRows.map((r) => {
                if (r.type === 'shopTotal') {
                  return (
                    <tr
                      key={r.rowKey}
                      className="border-t border-slate-200 bg-slate-100/90 font-semibold text-slate-900"
                    >
                      <td colSpan={4} className="px-4 py-3">
                        {r.shop} total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.hasTotalIncentive ? moneyOrDashStyled(r.totalIncentive) : '—'}
                      </td>
                    </tr>
                  );
                }

                const brand = brandByKey[r.brandKey];
                return (
                  <tr key={r.rowKey} className="bg-white">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{r.date}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{r.stockId}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-800">{r.shop}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${brand?.iconBg || 'bg-slate-100 text-slate-700'}`}
                      >
                        {r.brandLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{r.bags.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.perBagPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.cutOffPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.cutOffIncentivePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.transportPerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.totalCostPerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.sellingPricePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.incentivePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.pureIncentivePerBag)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {moneyOrDashStyled(r.totalIncentive)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && filteredDistributionRows.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                <td colSpan={4} className="px-4 py-3">
                  Grand total (filtered)
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{distributionTotals.bags.toLocaleString()}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">
                  {distributionTotals.hasTotalIncentive ? moneyOrDashStyled(distributionTotals.totalIncentive) : '—'}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!loading && filteredDistributionRows.length > 0 ? (
        <TablePaginationBar
          page={distributionPagination.page}
          totalPages={distributionPagination.totalPages}
          pageSize={distributionPagination.pageSize}
          totalCount={groupedDistributionRows.length}
          onPageChange={distributionPagination.setPage}
          onPageSizeChange={distributionPagination.setPageSize}
        />
      ) : null}

      <RowDetailModal
        open={!!detailRow}
        row={detailRow}
        variant="incentive"
        onClose={() => setDetailRow(null)}
      />
    </div>
  );
}
