import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Footer from './Footer';
import Login from './Login';
import { isAuthed } from './auth';
import { useDocumentTitle } from './seo';
import DashboardLayout from './dashboard/DashboardLayout';
import AnalyticsPage from './dashboard/AnalyticsPage';
import BillsPage from './dashboard/BillsPage';
import CustomerTransactionsPage from './dashboard/CustomerTransactionsPage';
import CustomersPage from './dashboard/CustomersPage';
import LoadsPage from './dashboard/LoadsPage';
import PaymentsPage from './dashboard/PaymentsPage';
import PromotionsPage from './dashboard/PromotionsPage';
import UsersPage from './dashboard/UsersPage';
import StockPage from './dashboard/StockPage';

function ProtectedRoute({ children }) {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppRoutes() {
  const { pathname } = useLocation();
  useDocumentTitle(pathname);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="analytics" replace />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="customers/:customerId" element={<CustomerTransactionsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="loads" element={<LoadsPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route
        path="/"
        element={<Navigate to={isAuthed() ? '/dashboard/analytics' : '/login'} replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <AppRoutes />
      </div>
      <Footer />
    </div>
  );
}
