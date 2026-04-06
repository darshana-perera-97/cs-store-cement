const { toNonNegMoney } = require('./customersStore');

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** True balance: opening past bill + all credit bills by name − all payments by customer id. */
function computeRemainingAmount(customer, bills, payments) {
  const nameKey = normalizeCustomerName(customer.name);
  let owed = toNonNegMoney(customer.pastBill);
  for (const b of bills) {
    if (normalizeCustomerName(b.customerName) !== nameKey) continue;
    owed += toNonNegMoney(b.totalAmount);
  }
  for (const p of payments) {
    if (p.customerId !== customer.id) continue;
    owed -= toNonNegMoney(p.amount);
  }
  return Math.max(0, Math.round(owed * 100) / 100);
}

module.exports = {
  normalizeCustomerName,
  computeRemainingAmount,
};
