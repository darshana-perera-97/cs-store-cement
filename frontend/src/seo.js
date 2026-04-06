import { useEffect } from 'react';

const BRAND = 'CS Store';

/** Default browser tab title; index.html should stay aligned for first paint. */
export const DEFAULT_DOCUMENT_TITLE = `Cement supply dashboard — ${BRAND}`;

const SECTION_RULES = [
  { test: (p) => p === '/login', title: `Sign in — ${BRAND}` },
  {
    test: (p) => p === '/dashboard' || p === '/dashboard/',
    title: `Dashboard — ${BRAND}`,
  },
  { test: (p) => p === '/dashboard/analytics', title: `Analytics — ${BRAND}` },
  { test: (p) => p === '/dashboard/customers', title: `Customers — ${BRAND}` },
  {
    test: (p) => p.startsWith('/dashboard/customers/'),
    title: `Customer account — ${BRAND}`,
  },
  { test: (p) => p === '/dashboard/stock', title: `Stock — ${BRAND}` },
  { test: (p) => p === '/dashboard/loads', title: `Loads — ${BRAND}` },
  { test: (p) => p === '/dashboard/bills', title: `Bills — ${BRAND}` },
  { test: (p) => p === '/dashboard/payments', title: `Payments — ${BRAND}` },
  { test: (p) => p === '/dashboard/users', title: `Users — ${BRAND}` },
];

export function useDocumentTitle(pathname) {
  useEffect(() => {
    const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
    const rule = SECTION_RULES.find((r) => r.test(normalized));
    document.title = rule ? rule.title : DEFAULT_DOCUMENT_TITLE;
  }, [pathname]);
}
