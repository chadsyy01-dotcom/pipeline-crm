import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken } from '../api/client';

export default function Layout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Pipeline</div>
        <nav>
          <NavLink to="/deals" className={({ isActive }) => (isActive ? 'active' : '')}>
            Deals
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => (isActive ? 'active' : '')}>
            Contacts
          </NavLink>
          <NavLink to="/companies" className={({ isActive }) => (isActive ? 'active' : '')}>
            Companies
          </NavLink>
          <NavLink to="/tasks" className={({ isActive }) => (isActive ? 'active' : '')}>
            Tasks
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <button className="btn-outline btn" onClick={logout} style={{ width: '100%' }}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
