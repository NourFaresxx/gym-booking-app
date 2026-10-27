import { Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';
import ResourcesPage from './pages/ResourcesPage';
import ResourceDetailPage from './pages/ResourceDetailPage';
import SelfCarePage from './pages/SelfCarePage';
import TrainersPage from './pages/TrainersPage';
import TrainerDetailPage from './pages/TrainerDetailPage';
import LockersPage from './pages/LockersPage';
import LockerOfferingDetailPage from './pages/LockerOfferingDetailPage';
import LockerCheckoutPage from './pages/LockerCheckoutPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CheckoutPage from './pages/CheckoutPage';
import MyBookingsPage from './pages/MyBookingsPage';
import NotFoundPage from './pages/NotFoundPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminClassesPage from './pages/admin/AdminClassesPage';
import ClassFormPage from './pages/admin/ClassFormPage';
import AdminTrainersPage from './pages/admin/AdminTrainersPage';
import TrainerFormPage from './pages/admin/TrainerFormPage';
import AdminLockersPage from './pages/admin/AdminLockersPage';
import LockerOfferingFormPage from './pages/admin/LockerOfferingFormPage';

const ADMIN_ROLES = ['staff', 'admin'];

export default function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-body">
        <main className="app-main">
          <Routes>
            <Route path="/" element={<ResourcesPage />} />
            <Route path="/resources/:id" element={<ResourceDetailPage />} />
            <Route path="/self-care" element={<SelfCarePage />} />
            <Route path="/trainers" element={<TrainersPage />} />
            <Route path="/trainers/:id" element={<TrainerDetailPage />} />
            <Route path="/lockers" element={<LockersPage />} />
            <Route path="/lockers/:id" element={<LockerOfferingDetailPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/checkout"
              element={
                <ProtectedRoute>
                  <CheckoutPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/locker-checkout"
              element={
                <ProtectedRoute>
                  <LockerCheckoutPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings"
              element={
                <ProtectedRoute>
                  <MyBookingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={ADMIN_ROLES}>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<AdminDashboardPage />} />
              <Route path="classes" element={<AdminClassesPage />} />
              <Route path="classes/new" element={<ClassFormPage />} />
              <Route path="classes/:id/edit" element={<ClassFormPage />} />
              <Route path="trainers" element={<AdminTrainersPage />} />
              <Route path="trainers/new" element={<TrainerFormPage />} />
              <Route path="trainers/:id/edit" element={<TrainerFormPage />} />
              <Route path="lockers" element={<AdminLockersPage />} />
              <Route path="lockers/new" element={<LockerOfferingFormPage />} />
              <Route path="lockers/:id/edit" element={<LockerOfferingFormPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </div>
  );
}
