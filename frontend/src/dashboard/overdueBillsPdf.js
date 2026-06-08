import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function formatLkr(n) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function groupRowsByShop(rows) {
  const groups = new Map();
  for (const row of rows) {
    const shop = String(row.customerName ?? '').trim() || 'Unknown';
    if (!groups.has(shop)) groups.set(shop, []);
    groups.get(shop).push(row);
  }

  return [...groups.entries()]
    .map(([shop, bills]) => ({ shop, bills }))
    .sort((a, b) => a.shop.localeCompare(b.shop));
}

function buildGroupedTableBody(rows) {
  const body = [];
  const subtotalRowIndices = new Set();

  for (const { shop, bills } of groupRowsByShop(rows)) {
    const sortedBills = [...bills].sort((a, b) => {
      const dueCmp = String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? ''));
      if (dueCmp !== 0) return dueCmp;
      return (Number(b.outstandingAmount) || 0) - (Number(a.outstandingAmount) || 0);
    });

    for (const bill of sortedBills) {
      body.push([
        shop,
        String(bill.details ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        String(bill.dueDate ?? ''),
        String(bill.daysOverdue ?? 0),
        formatLkr(bill.outstandingAmount),
      ]);
    }

    const shopOutstanding = sortedBills.reduce((sum, r) => sum + (Number(r.outstandingAmount) || 0), 0);
    subtotalRowIndices.add(body.length);
    body.push([
      shop,
      `${sortedBills.length} overdue bill${sortedBills.length === 1 ? '' : 's'} — shop total`,
      '',
      '',
      formatLkr(shopOutstanding),
    ]);
  }

  return { body, subtotalRowIndices };
}

/**
 * Build an A4 portrait PDF of overdue bills (multi-page when needed).
 * @param {Array<{ customerName: string, details: string, dueDate: string, daysOverdue: number, billTotal: number, outstandingAmount: number }>} rows
 */
export function downloadOverdueBillsPdf(rows, options = {}) {
  const { generatedAt = new Date() } = options;
  const safeRows = rows || [];

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const margin = 14;
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('Overdue bills', margin, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const dateStr = generatedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${dateStr}`, margin, 22);
  doc.text(
    'Unpaid credit bills past each customer’s bill overdue window (default 14 days after bill date). Each shop lists individual bills plus total outstanding in LKR.',
    margin,
    27,
  );
  doc.setTextColor(0, 0, 0);

  const head = [['Shop', 'Bill details', 'Due date', 'Days overdue', 'Outstanding']];
  const { body, subtotalRowIndices } = buildGroupedTableBody(safeRows);

  const grandOutstanding = safeRows.reduce((sum, r) => sum + (Number(r.outstandingAmount) || 0), 0);
  const foot = [
    [
      '',
      '',
      '',
      'Grand total',
      formatLkr(grandOutstanding),
    ],
  ];

  autoTable(doc, {
    head,
    body,
    foot,
    startY: 31,
    margin: { top: 31, left: margin, right: margin, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 72 },
      2: { cellWidth: 24 },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 30 },
    },
    tableWidth: pageW - margin * 2,
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section !== 'body' || !subtotalRowIndices.has(data.row.index)) return;
      data.cell.styles.fontStyle = 'bold';
      data.cell.styles.fillColor = [241, 245, 249];
      data.cell.styles.textColor = [15, 23, 42];
      if (data.column.index === 4) {
        data.cell.styles.textColor = [190, 18, 60];
      }
    },
  });

  const pageCount = doc.internal.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount} · A4`, margin, pageHeight - 8);
    doc.setTextColor(0, 0, 0);
  }

  const safeDate = generatedAt.toISOString().slice(0, 10);
  doc.save(`overdue-bills-${safeDate}.pdf`);
}
