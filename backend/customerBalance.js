const { toNonNegMoney } = require('./customersStore');

function normalizeCustomerName(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Total applied against the customer’s balance for one payment (cash + cheque).
 * Uses stored `amount`; if missing, sums cash and cheque parts.
 */
function paymentCreditToCustomer(p) {
  const total = toNonNegMoney(p?.amount);
  if (total > 0) return total;
  return toNonNegMoney(p?.cashAmount) + toNonNegMoney(p?.chequeAmount);
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
    owed -= paymentCreditToCustomer(p);
  }
  return Math.max(0, Math.round(owed * 100) / 100);
}

module.exports = {
  normalizeCustomerName,
  computeRemainingAmount,
  paymentCreditToCustomer,
};
