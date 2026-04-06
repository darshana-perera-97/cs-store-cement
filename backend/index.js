const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { readStocks, writeStocks, toNonNegNumber, applyBillDeductionToLoads } = require('./stocksStore');
const { rebuildAndPersistDailyStock } = require('./dailyStockStore');
const {
  readCustomers,
  writeCustomers,
  toNonNegMoney,
  defaultDueDateYmd,
} = require('./customersStore');
const { normalizeCustomerName, computeRemainingAmount } = require('./customerBalance');
const { readBills, writeBills, lineTotal } = require('./billsStore');
const {
  readPayments,
  writePayments,
  todayYmdLocal: paymentDateDefaultYmd,
  normalizePaymentBillNumber,
  isPaymentBillNumberTaken,
} = require('./paymentsStore');
const { signToken, requireAdmin } = require('./authToken');
const {
  readUsers,
  verifyStoredUser,
  findUserByUsername,
  createUser,
  deleteUserById,
  toPublicUser,
} = require('./usersStore');

const app = express();
const PORT = Number(process.env.PORT) || 1248;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'backend' });
});

/** Aggregates for dashboard "Your card": receivables, stock spend, payments in */
app.get('/api/cash-summary', async (req, res) => {
  try {
    const [customers, bills, payments, stocks] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
      readStocks(),
    ]);
    let pendingFromCustomers = 0;
    for (const c of customers) {
      pendingFromCustomers += computeRemainingAmount(c, bills, payments);
    }
    let cashToBuyStock = 0;
    for (const s of stocks) {
      cashToBuyStock += toNonNegMoney(s.totalAmount);
    }
    let cashReceivedFromCustomers = 0;
    for (const p of payments) {
      cashReceivedFromCustomers += toNonNegMoney(p.amount);
    }
    const round2 = (n) => Math.round(Number(n) * 100) / 100;
    const overdueRows = collectOverdueBillRows(customers, bills, payments);
    const maxDaysOverdue = overdueRows.length
      ? Math.max(...overdueRows.map((r) => r.daysOverdue))
      : 0;
    const overdueTotal = round2(
      overdueRows.reduce((s, r) => s + toNonNegMoney(r.outstandingAmount), 0),
    );
    const overduePriority = overduePriorityFromMaxDays(maxDaysOverdue);
    res.json({
      pendingFromCustomers: round2(pendingFromCustomers),
      cashToBuyStock: round2(cashToBuyStock),
      cashReceivedFromCustomers: round2(cashReceivedFromCustomers),
      overdue: {
        totalOutstanding: overdueTotal,
        billCount: overdueRows.length,
        maxDaysOverdue,
        priority: overduePriority,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cash summary' });
  }
});

/** Last N calendar days (local server time): oldest first. Each key is YYYY-MM-DD. */
function lastNDaysYmdLocal(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/** Credit bills are treated as due for payment by bill date + this many days (local calendar). */
const BILL_SETTLEMENT_DAYS = 14;

function ymdTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToYmd(ymd, days) {
  const parts = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const d = new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10));
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

function daysFromDueToToday(dueYmd, todayYmd) {
  if (!dueYmd || !todayYmd || dueYmd.length < 10 || todayYmd.length < 10) return 0;
  const t0 = new Date(
    parseInt(dueYmd.slice(0, 4), 10),
    parseInt(dueYmd.slice(5, 7), 10) - 1,
    parseInt(dueYmd.slice(8, 10), 10),
  ).getTime();
  const t1 = new Date(
    parseInt(todayYmd.slice(0, 4), 10),
    parseInt(todayYmd.slice(5, 7), 10) - 1,
    parseInt(todayYmd.slice(8, 10), 10),
  ).getTime();
  return Math.max(0, Math.round((t1 - t0) / (24 * 60 * 60 * 1000)));
}

function billDetailsLine(bill) {
  const parts = [];
  const stockId = String(bill.stockId ?? '').trim();
  if (stockId) parts.push(`Stock ${stockId}`);
  const bagParts = [];
  const labels = [
    ['tokyo', 'Tokyo'],
    ['samudra', 'Samudra'],
    ['atlas', 'Atlas'],
    ['nippon', 'Nippon'],
  ];
  for (const [key, label] of labels) {
    const n = toNonNegNumber(bill[`${key}Bags`]);
    if (n > 0) bagParts.push(`${label} ${n} bags`);
  }
  if (bagParts.length) parts.push(bagParts.join(', '));
  const line = parts.join(' · ');
  if (line) return line;
  const amt = toNonNegMoney(bill.totalAmount);
  return amt > 0 ? `Total LKR ${amt}` : 'Credit bill';
}

/** Overdue credit bills (same rules as `/api/overdue-bills`). */
function collectOverdueBillRows(customers, bills, payments) {
  const todayYmd = ymdTodayLocal();
  const overdue = [];

  for (const cust of customers) {
    const nk = normalizeCustomerName(cust.name);
    const custBills = bills.filter((b) => normalizeCustomerName(b.customerName) === nk);
    let paySum = 0;
    for (const p of payments) {
      if (p.customerId === cust.id) paySum += toNonNegMoney(p.amount);
    }
    const sortedBills = [...custBills].sort((a, b) => {
      const cmp = String(a.date).localeCompare(String(b.date));
      if (cmp !== 0) return cmp;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    let remainingCredit = paySum;
    const pastOwed = toNonNegMoney(cust.pastBill);
    const towardPast = Math.min(pastOwed, remainingCredit);
    remainingCredit -= towardPast;

    for (const bill of sortedBills) {
      const total = toNonNegMoney(bill.totalAmount);
      const paidTowardBill = Math.min(total, remainingCredit);
      remainingCredit -= paidTowardBill;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      const due = addDaysToYmd(bill.date, BILL_SETTLEMENT_DAYS);
      if (remaining > 0 && due && todayYmd > due) {
        overdue.push({
          id: bill.id,
          customerName: cust.name,
          billDate: bill.date,
          dueDate: due,
          daysOverdue: daysFromDueToToday(due, todayYmd),
          outstandingAmount: remaining,
          billTotal: total,
          details: billDetailsLine(bill),
        });
      }
    }
  }

  const registeredNk = new Set(customers.map((c) => normalizeCustomerName(c.name)));
  const orphanBillsByNk = new Map();
  for (const bill of bills) {
    const nk = normalizeCustomerName(bill.customerName);
    if (registeredNk.has(nk)) continue;
    if (!orphanBillsByNk.has(nk)) orphanBillsByNk.set(nk, []);
    orphanBillsByNk.get(nk).push(bill);
  }

  for (const [nk, obills] of orphanBillsByNk) {
    let paySum = 0;
    for (const p of payments) {
      if (normalizeCustomerName(p.customerName) === nk) paySum += toNonNegMoney(p.amount);
    }
    const sortedBills = [...obills].sort((a, b) => {
      const cmp = String(a.date).localeCompare(String(b.date));
      if (cmp !== 0) return cmp;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    let remainingCredit = paySum;
    for (const bill of sortedBills) {
      const total = toNonNegMoney(bill.totalAmount);
      const paidTowardBill = Math.min(total, remainingCredit);
      remainingCredit -= paidTowardBill;
      const remaining = Math.round((total - paidTowardBill) * 100) / 100;
      const due = addDaysToYmd(bill.date, BILL_SETTLEMENT_DAYS);
      if (remaining > 0 && due && todayYmd > due) {
        const name = String(bill.customerName ?? '').trim() || 'Unknown';
        overdue.push({
          id: bill.id,
          customerName: name,
          billDate: bill.date,
          dueDate: due,
          daysOverdue: daysFromDueToToday(due, todayYmd),
          outstandingAmount: remaining,
          billTotal: total,
          details: billDetailsLine(bill),
        });
      }
    }
  }

  overdue.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return b.outstandingAmount - a.outstandingAmount;
  });
  return overdue;
}

/** Longest days past due → UI priority tier (green → red). */
function overduePriorityFromMaxDays(maxDays) {
  if (!maxDays || maxDays <= 0) return 'none';
  if (maxDays <= 7) return 'low';
  if (maxDays <= 14) return 'moderate';
  if (maxDays <= 30) return 'high';
  return 'critical';
}

/** Daily cash in (customer payments) vs cash out (load/stock purchases) */
app.get('/api/cash-flow', async (req, res) => {
  try {
    const n = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const dayKeys = lastNDaysYmdLocal(n);
    const daySet = new Set(dayKeys);
    const [payments, stocks] = await Promise.all([readPayments(), readStocks()]);

    const inByDate = Object.fromEntries(dayKeys.map((d) => [d, 0]));
    const outByDate = Object.fromEntries(dayKeys.map((d) => [d, 0]));

    for (const p of payments) {
      const d = String(p.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      inByDate[d] += toNonNegMoney(p.amount);
    }
    for (const s of stocks) {
      const d = String(s.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      outByDate[d] += toNonNegMoney(s.totalAmount);
    }

    const round2 = (x) => Math.round(Number(x) * 100) / 100;
    const series = dayKeys.map((date) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      cashIn: round2(inByDate[date]),
      cashOut: round2(outByDate[date]),
    }));
    res.json(series);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load cash flow' });
  }
});

/** Daily bag totals from credit bills (Tokyo / Samudra / Atlas / Nippon) */
app.get('/api/bag-sales-by-day', async (req, res) => {
  try {
    const n = Math.min(90, Math.max(1, parseInt(String(req.query.days), 10) || 7));
    const dayKeys = lastNDaysYmdLocal(n);
    const daySet = new Set(dayKeys);
    const bills = await readBills();
    const byDay = Object.fromEntries(
      dayKeys.map((d) => [d, { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 }]),
    );
    for (const b of bills) {
      const d = String(b.date ?? '').slice(0, 10);
      if (!daySet.has(d)) continue;
      byDay[d].tokyo += toNonNegNumber(b.tokyoBags);
      byDay[d].samudra += toNonNegNumber(b.samudraBags);
      byDay[d].atlas += toNonNegNumber(b.atlasBags);
      byDay[d].nippon += toNonNegNumber(b.nipponBags);
    }
    const series = dayKeys.map((date) => ({
      date,
      label: date.slice(5).replace('-', '/'),
      ...byDay[date],
    }));
    res.json(series);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load bag sales by day' });
  }
});

/** Latest customer payments (cash in) and stock load purchases (cash out), merged by time */
app.get('/api/recent-transfers', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit), 10) || 5));
    const [payments, stocks] = await Promise.all([readPayments(), readStocks()]);
    const rows = [];

    for (const p of payments) {
      const id = String(p.id ?? '').trim();
      const at = p.createdAt || `${String(p.date ?? '').slice(0, 10)}T12:00:00`;
      const title = String(p.customerName ?? '').trim() || 'Customer payment';
      const billNum = String(p.billNumber ?? '').trim();
      rows.push({
        id: id ? `payment-${id}` : `payment-${at}-${billNum}-${toNonNegMoney(p.amount)}`,
        kind: 'payment_in',
        at,
        title,
        subtitle: billNum ? `Bill #${billNum} · Payment in` : 'Payment in',
        amount: toNonNegMoney(p.amount),
      });
    }

    for (const s of stocks) {
      const id = String(s.id ?? '').trim();
      const at = s.createdAt || `${String(s.date ?? '').slice(0, 10)}T12:00:00`;
      const stockId = String(s.stockId ?? '').trim();
      const veh = String(s.vehicleNumber ?? '').trim();
      rows.push({
        id: id ? `stock-${id}` : `stock-${at}-${stockId}`,
        kind: 'stock_purchase',
        at,
        title: stockId ? `Load ${stockId}` : 'Stock purchase',
        subtitle: veh ? `${veh} · Paid for stock` : 'Paid for stock',
        amount: toNonNegMoney(s.totalAmount),
      });
    }

    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(rows.slice(0, limit));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load recent transfers' });
  }
});

/**
 * Bills that are still unpaid past the settlement window (bill date + 14 days local).
 * Payments apply to `pastBill` first, then to bills in chronological order (same idea as balances).
 */
app.get('/api/overdue-bills', async (req, res) => {
  try {
    const [customers, bills, payments] = await Promise.all([
      readCustomers(),
      readBills(),
      readPayments(),
    ]);
    res.json(collectOverdueBillRows(customers, bills, payments));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load overdue bills' });
  }
});

app.post('/api/login', async (req, res) => {
  const expectedUser = (process.env.ADMIN_USERNAME || '').trim();
  const expectedPass = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expectedUser || !expectedPass) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const body = req.body || {};
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '').trim();
  try {
    if (username === expectedUser && password === expectedPass) {
      return res.json({
        ok: true,
        role: 'admin',
        token: signToken(expectedUser, 'admin'),
        username: expectedUser,
      });
    }
    if (await verifyStoredUser(username, password)) {
      const u = await findUserByUsername(username);
      if (!u) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      return res.json({
        ok: true,
        role: 'staff',
        token: signToken(u.username, 'staff'),
        username: u.username,
      });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/users', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const users = await readUsers();
    res.json(users.map(toPublicUser));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read users' });
  }
});

app.post('/api/users', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const body = req.body || {};
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '').trim();
    const result = await createUser({
      username,
      password,
      createdBy: admin.username,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    res.status(201).json(result.user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const result = await deleteUserById(req.params.id);
    if (!result.ok) {
      return res.status(result.error === 'User not found' ? 404 : 400).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const customers = await readCustomers();
    const [bills, payments] = await Promise.all([readBills(), readPayments()]);
    const enriched = customers.map((c) => ({
      ...c,
      remainingAmount: computeRemainingAmount(c, bills, payments),
    }));
    const sorted = [...enriched].sort((a, b) => {
      const da = String(a.dueDate || '');
      const db = String(b.dueDate || '');
      if (da !== db) return da.localeCompare(db);
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read customers' });
  }
});

app.get('/api/customers/:id/transactions', async (req, res) => {
  try {
    const id = String(req.params.id ?? '').trim();
    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === id);
    if (!cust) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const nameKey = normalizeCustomerName(cust.name);

    const [bills, payments] = await Promise.all([readBills(), readPayments()]);
    const transactions = [];

    transactions.push({
      kind: 'opening',
      id: `${cust.id}-opening`,
      date: cust.createdAt ? String(cust.createdAt).slice(0, 10) : cust.dueDate,
      sortAt: cust.createdAt || `${cust.dueDate}T12:00:00`,
      type: 'Credit (opening balance)',
      details: `Past bill owed on account${cust.addedBy ? ` · ${cust.addedBy}` : ''}`,
      amount: Number(cust.pastBill) || 0,
      direction: 'charge',
    });

    for (const b of bills) {
      if (normalizeCustomerName(b.customerName) !== nameKey) continue;
      transactions.push({
        kind: 'bill',
        id: b.id,
        date: b.date,
        sortAt: b.createdAt || `${b.date}T12:00:00`,
        type: 'Credit sale',
        details: [b.stockId, b.enteredBy ? `by ${b.enteredBy}` : ''].filter(Boolean).join(' · '),
        amount: Number(b.totalAmount) || 0,
        direction: 'charge',
      });
    }

    for (const p of payments) {
      if (p.customerId !== cust.id) continue;
      transactions.push({
        kind: 'payment',
        id: p.id,
        date: p.date,
        sortAt: p.createdAt || `${p.date}T12:00:00`,
        type: 'Payment',
        details: [
          p.billNumber ? `Bill #${p.billNumber}` : null,
          p.note,
          p.recordedBy ? `by ${p.recordedBy}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || '—',
        amount: Number(p.amount) || 0,
        direction: 'credit',
      });
    }

    transactions.sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime());

    const remainingAmount = computeRemainingAmount(cust, bills, payments);
    res.json({ customer: { ...cust, remainingAmount }, transactions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const body = req.body || {};
    const addedBy = String(body.addedBy ?? '').trim();
    if (!addedBy) {
      return res.status(400).json({ error: 'addedBy (username) is required' });
    }

    const name = String(body.name ?? '').trim();
    const location = String(body.location ?? '').trim();
    const contactNumber = String(body.contactNumber ?? '').trim();
    if (!name || !location || !contactNumber) {
      return res.status(400).json({ error: 'name, location, and contactNumber are required' });
    }

    const pastBill = toNonNegMoney(body.pastBill);
    let dueDate = String(body.dueDate ?? '').trim();
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      dueDate = defaultDueDateYmd();
    }

    const row = {
      id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      location,
      contactNumber,
      pastBill,
      remainingAmount: pastBill,
      dueDate,
      addedBy,
      createdAt: new Date().toISOString(),
    };

    const customers = await readCustomers();
    customers.push(row);
    await writeCustomers(customers);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save customer' });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    const payments = await readPayments();
    const sorted = [...payments].sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read payments' });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const body = req.body || {};
    const recordedBy = String(body.recordedBy ?? '').trim();
    if (!recordedBy) {
      return res.status(400).json({ error: 'recordedBy (username) is required' });
    }
    const customerId = String(body.customerId ?? '').trim();
    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }
    const amount = toNonNegMoney(body.amount);
    if (amount <= 0) {
      return res.status(400).json({ error: 'amount must be greater than 0' });
    }
    let date = String(body.date ?? '').trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      date = paymentDateDefaultYmd();
    }
    const note = String(body.note ?? '').trim();

    const billNumber = normalizePaymentBillNumber(body.billNumber);
    if (!billNumber) {
      return res.status(400).json({
        error: 'billNumber is required (1–3 digits, stored as 001–999)',
      });
    }

    const customers = await readCustomers();
    const cust = customers.find((c) => c.id === customerId);
    if (!cust) {
      return res.status(400).json({ error: 'Customer not found' });
    }

    const payments = await readPayments();
    if (isPaymentBillNumberTaken(payments, billNumber)) {
      return res.status(400).json({ error: 'This bill number is already used for another payment.' });
    }

    const row = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerId: cust.id,
      customerName: cust.name,
      billNumber,
      amount,
      note,
      recordedBy,
      createdAt: new Date().toISOString(),
    };

    payments.push(row);
    const billsList = await readBills();
    cust.remainingAmount = computeRemainingAmount(cust, billsList, payments);
    await writeCustomers(customers);
    await writePayments(payments);
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save payment' });
  }
});

app.get('/api/activity', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 5));
    const [loads, bills, customers, payments] = await Promise.all([
      readStocks(),
      readBills(),
      readCustomers(),
      readPayments(),
    ]);

    const items = [];

    for (const r of loads) {
      items.push({
        kind: 'load',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: r.stockId || 'Stock load',
        subtitle: [r.vehicleNumber, r.date, r.addedBy].filter(Boolean).join(' · '),
        amount: Number(r.totalAmount) || 0,
      });
    }
    for (const r of bills) {
      items.push({
        kind: 'bill',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: `Bill · ${r.customerName || 'Customer'}`,
        subtitle: [r.stockId, r.date, r.enteredBy].filter(Boolean).join(' · '),
        amount: Number(r.totalAmount) || 0,
      });
    }
    for (const r of customers) {
      items.push({
        kind: 'customer',
        id: r.id,
        at: r.createdAt || `${r.dueDate}T12:00:00`,
        title: `Customer · ${r.name}`,
        subtitle: [r.location, r.addedBy].filter(Boolean).join(' · '),
        amount: Number(r.pastBill) || 0,
      });
    }
    for (const r of payments) {
      items.push({
        kind: 'payment',
        id: r.id,
        at: r.createdAt || `${r.date}T12:00:00`,
        title: `Payment · ${r.customerName}`,
        subtitle: [r.billNumber ? `#${r.billNumber}` : null, r.date, r.recordedBy, r.note]
          .filter(Boolean)
          .join(' · '),
        amount: Number(r.amount) || 0,
      });
    }

    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    res.json(items.slice(0, limit));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

app.get('/api/bills', async (req, res) => {
  try {
    const bills = await readBills();
    const sorted = [...bills].sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(sorted);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read bills' });
  }
});

app.post('/api/bills', async (req, res) => {
  try {
    const body = req.body || {};
    const enteredBy = String(body.enteredBy ?? body.addedBy ?? '').trim();
    if (!enteredBy) {
      return res.status(400).json({ error: 'enteredBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const customerName = String(body.customerName ?? '').trim();
    if (!date || !customerName) {
      return res.status(400).json({ error: 'date and customerName are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const tokyoBags = toNonNegNumber(body.tokyoBags);
    const samudraBags = toNonNegNumber(body.samudraBags);
    const atlasBags = toNonNegNumber(body.atlasBags);
    const nipponBags = toNonNegNumber(body.nipponBags);

    const tokyoUnitPrice = toNonNegMoney(body.tokyoUnitPrice);
    const samudraUnitPrice = toNonNegMoney(body.samudraUnitPrice);
    const atlasUnitPrice = toNonNegMoney(body.atlasUnitPrice);
    const nipponUnitPrice = toNonNegMoney(body.nipponUnitPrice);

    const tokyoLine = lineTotal(tokyoBags, tokyoUnitPrice);
    const samudraLine = lineTotal(samudraBags, samudraUnitPrice);
    const atlasLine = lineTotal(atlasBags, atlasUnitPrice);
    const nipponLine = lineTotal(nipponBags, nipponUnitPrice);

    const totalAmount =
      Math.round((tokyoLine + samudraLine + atlasLine + nipponLine) * 100) / 100;

    const stockId = String(body.stockId ?? '').trim();

    const row = {
      id: `bill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      customerName,
      stockId,
      tokyoBags,
      samudraBags,
      atlasBags,
      nipponBags,
      tokyoUnitPrice,
      samudraUnitPrice,
      atlasUnitPrice,
      nipponUnitPrice,
      tokyoLine,
      samudraLine,
      atlasLine,
      nipponLine,
      totalAmount,
      enteredBy,
      createdAt: new Date().toISOString(),
    };

    const stocks = await readStocks();
    const deduct = applyBillDeductionToLoads(stocks, stockId, {
      tokyoBags,
      samudraBags,
      atlasBags,
      nipponBags,
    });
    if (!deduct.ok) {
      return res.status(400).json({ error: deduct.error });
    }

    const bills = await readBills();
    bills.push(row);

    await writeStocks(stocks);
    await writeBills(bills);

    const paymentsList = await readPayments();
    const customers = await readCustomers();
    const nameKey = normalizeCustomerName(customerName);
    for (const c of customers) {
      if (normalizeCustomerName(c.name) === nameKey) {
        c.remainingAmount = computeRemainingAmount(c, bills, paymentsList);
        break;
      }
    }
    await writeCustomers(customers);

    try {
      await rebuildAndPersistDailyStock(stocks, bills);
    } catch (e) {
      console.error('daily stock rebuild after bill', e);
    }

    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save bill' });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const stocks = await readStocks();
    res.json(stocks);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read stocks' });
  }
});

app.get('/api/daily-stock', async (req, res) => {
  try {
    const payload = await rebuildAndPersistDailyStock();
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to build daily stock' });
  }
});

app.get('/api/stocks/summary', async (req, res) => {
  try {
    const stocks = await readStocks();
    const totals = { tokyo: 0, samudra: 0, atlas: 0, nippon: 0 };
    for (const row of stocks) {
      totals.tokyo += toNonNegNumber(row.tokyoBags);
      totals.samudra += toNonNegNumber(row.samudraBags);
      totals.atlas += toNonNegNumber(row.atlasBags);
      totals.nippon += toNonNegNumber(row.nipponBags);
    }
    res.json({
      liveAt: new Date().toISOString(),
      brands: [
        { key: 'tokyo', label: 'Tokyo', bags: totals.tokyo },
        { key: 'samudra', label: 'Samudra', bags: totals.samudra },
        { key: 'atlas', label: 'Atlas', bags: totals.atlas },
        { key: 'nippon', label: 'Nippon', bags: totals.nippon },
      ],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to summarize stock' });
  }
});

app.post('/api/stocks', async (req, res) => {
  try {
    const body = req.body || {};
    const addedBy = String(body.addedBy ?? '').trim();
    if (!addedBy) {
      return res.status(400).json({ error: 'addedBy (username) is required' });
    }

    const date = String(body.date ?? '').trim();
    const stockId = String(body.stockId ?? '').trim();
    const vehicleNumber = String(body.vehicleNumber ?? '').trim();
    if (!date || !stockId || !vehicleNumber) {
      return res.status(400).json({ error: 'date, stockId, and vehicleNumber are required' });
    }

    const row = {
      id: `load-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      date,
      stockId,
      vehicleNumber,
      tokyoBags: toNonNegNumber(body.tokyoBags),
      tokyoCost: toNonNegNumber(body.tokyoCost),
      samudraBags: toNonNegNumber(body.samudraBags),
      samudraCost: toNonNegNumber(body.samudraCost),
      atlasBags: toNonNegNumber(body.atlasBags),
      atlasCost: toNonNegNumber(body.atlasCost),
      nipponBags: toNonNegNumber(body.nipponBags),
      nipponCost: toNonNegNumber(body.nipponCost),
      addedBy,
      createdAt: new Date().toISOString(),
    };

    row.totalAmount =
      row.tokyoCost + row.samudraCost + row.atlasCost + row.nipponCost;

    const stocks = await readStocks();
    stocks.push(row);
    await writeStocks(stocks);
    try {
      await rebuildAndPersistDailyStock(stocks);
    } catch (e) {
      console.error('daily stock rebuild', e);
    }
    res.status(201).json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save stock record' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
