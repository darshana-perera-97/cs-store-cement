export const MONTHLY_BILL_SETTLEMENT_BUCKETS = [
  { key: 'd1_14', label: '1–14 days' },
  { key: 'd15_21', label: '15–21 days' },
  { key: 'd22_30', label: '22–30 days' },
  { key: 'd31_35', label: '31–35 days' },
  { key: 'd36_plus', label: 'More than 35 days' },
  { key: 'not_settled', label: 'Not settled' },
];

export function settlementBucketKey(daysToSettle) {
  if (daysToSettle == null) return 'not_settled';
  if (daysToSettle <= 14) return 'd1_14';
  if (daysToSettle <= 21) return 'd15_21';
  if (daysToSettle <= 30) return 'd22_30';
  if (daysToSettle <= 35) return 'd31_35';
  return 'd36_plus';
}

/** Aggregate monthly bill rows by days-to-settle bucket. */
export function buildMonthlyBillSettlementSummary(rows) {
  const buckets = Object.fromEntries(
    MONTHLY_BILL_SETTLEMENT_BUCKETS.map((b) => [
      b.key,
      { ...b, lineCount: 0, bagCount: 0, amount: 0 },
    ]),
  );

  for (const row of rows) {
    const key = settlementBucketKey(row.daysToSettle);
    const bucket = buckets[key];
    bucket.lineCount += 1;
    bucket.bagCount += Number(row.bagCount) || 0;
    bucket.amount += Number(row.amount) || 0;
  }

  const summaryRows = MONTHLY_BILL_SETTLEMENT_BUCKETS.map((b) => buckets[b.key]);
  const totals = summaryRows.reduce(
    (acc, r) => ({
      lineCount: acc.lineCount + r.lineCount,
      bagCount: acc.bagCount + r.bagCount,
      amount: acc.amount + r.amount,
    }),
    { lineCount: 0, bagCount: 0, amount: 0 },
  );

  return { rows: summaryRows, totals };
}
