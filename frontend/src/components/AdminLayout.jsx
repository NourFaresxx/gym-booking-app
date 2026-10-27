import { NavLink, Outlet } from 'react-router-dom';

const tabClass = ({ isActive }) => (isActive ? 'active' : undefined);

export default function AdminLayout() {
  return (
    <div className="admin-layout">
      <div className="page-header">
        <h1>Admin</h1>
      </div>
      <nav className="admin-tabs">
        <NavLink to="/admin" end className={tabClass}>
          Dashboard
        </NavLink>
        <NavLink to="/admin/classes" className={tabClass}>
          Resources
        </NavLink>
        <NavLink to="/admin/trainers" className={tabClass}>
          Trainers
        </NavLink>
        <NavLink to="/admin/lockers" className={tabClass}>
          Lockers
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
