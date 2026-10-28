import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BrandMark from './BrandMark';

const linkClass = ({ isActive }) => (isActive ? 'active' : undefined);

export default function Sidebar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <aside className="sidebar">
      <Link to="/" className="nav-brand">
        <BrandMark className="nav-brand-mark" />
        Elite Gym
      </Link>

      <nav className="nav-links">
        <NavLink to="/" end className={linkClass}>
          Classes
        </NavLink>
        <NavLink to="/self-care" className={linkClass}>
          Self Care
        </NavLink>
        <NavLink to="/lockers" className={linkClass}>
          Lockers
        </NavLink>
        <NavLink to="/trainers" className={linkClass}>
          Trainers
        </NavLink>
        {isAuthenticated && (
          <NavLink to="/bookings" className={linkClass}>
            My bookings
          </NavLink>
        )}
        {isAuthenticated && ['staff', 'admin'].includes(user.role) && (
          <NavLink to="/admin" className={linkClass}>
            Admin
          </NavLink>
        )}
      </nav>

      <div className="nav-auth">
        {isAuthenticated ? (
          <>
            <span className="nav-user">{user.name}</span>
            <button type="button" className="btn btn-ghost" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="btn btn-ghost">
              Log in
            </Link>
            <Link to="/register" className="btn btn-primary">
              Sign up
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
