import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Build an A4 portrait PDF of overdue bills (multi-page when needed).
 * @param {Array<{ customerName: string, details: string, billDate: string, dueDate: string, daysOverdue: number, outstandingAmount: number }>} rows
 */
export function downloadOverdueBillsPdf(rows, options = {}) {
  const { generatedAt = new Date() } = options;

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
    'Unpaid credit bills past bill date + 14 days. Outstanding amounts in LKR.',
    margin,
    27,
  );
  doc.setTextColor(0, 0, 0);

  const head = [['Customer', 'Bill details', 'Bill date', 'Due date', 'Days overdue', 'Outstanding']];
  const body = (rows || []).map((r) => [
    String(r.customerName ?? '').trim(),
    String(r.details ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    String(r.billDate ?? ''),
    String(r.dueDate ?? ''),
    String(r.daysOverdue ?? 0),
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(r.outstandingAmount) || 0),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 31,
    margin: { top: 31, left: margin, right: margin, bottom: 16 },
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'top' },
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 58 },
      2: { cellWidth: 22 },
      3: { cellWidth: 22 },
      4: { halign: 'right', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 26 },
    },
    tableWidth: pageW - margin * 2,
    showHead: 'everyPage',
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
