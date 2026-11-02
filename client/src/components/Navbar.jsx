import React from 'react';
import { NavLink } from 'react-router-dom';
import { Layers, Upload, ListFilter, Users, LogOut, Search } from 'lucide-react';
import { useAuth } from '../context/auth-context';

export default function Navbar() {
  const { user, isLoading, signOut } = useAuth();
  const canUpload = user && ['Citizen', 'Admin'].includes(user.role);

  return (
    <nav className="navbar">
      <NavLink to={user ? '/records' : '/login'} className="brand">
        <div className="brand-icon">
          <Layers size={20} />
        </div>
        <div>
          <div className="brand-title">DigiBhoomi</div>
          <div className="brand-sub">SIH 26018 • Land Record Digitization</div>
        </div>
      </NavLink>

      <div className="nav-links">
        {!isLoading && user && (
          <>
            <NavLink
              to="/records"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <ListFilter size={16} /> {user.role === 'Officer' ? 'Assigned Reviews' : 'Land Records'}
              </span>
            </NavLink>

            <NavLink
              to="/search"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Search size={16} /> Semantic Search
              </span>
            </NavLink>

            {canUpload && (
              <NavLink
                to="/upload"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Upload size={16} /> Upload Document
                </span>
              </NavLink>
            )}

            {user.role === 'Admin' && (
              <NavLink
                to="/admin/users"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={16} /> Users & Audit
                </span>
              </NavLink>
            )}

            <span className="nav-link" style={{ color: 'var(--text-muted)' }}>
              {user.displayName} · {user.role}
            </span>

            <button
              type="button"
              className="btn btn-secondary"
              title="Sign out"
              onClick={() => signOut().catch(() => {})}
            >
              <LogOut size={16} />
            </button>
          </>
        )}
        {!isLoading && !user && (
          <NavLink to="/login" className="nav-link">
            Sign in
          </NavLink>
        )}
      </div>
    </nav>
  );
}
