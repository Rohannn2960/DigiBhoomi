import React from 'react';
import { NavLink } from 'react-router-dom';
import { Layers, Upload, ListFilter, User, Search } from 'lucide-react';

export default function Navbar() {
  return (
    <nav className="navbar">
      <NavLink to="/records" className="brand">
        <div className="brand-icon">
          <Layers size={20} />
        </div>
        <div>
          <div className="brand-title">DigiBhoomi</div>
          <div className="brand-sub">SIH 26018 • Land Record Digitization</div>
        </div>
      </NavLink>

      <div className="nav-links">
        <NavLink
          to="/records"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ListFilter size={16} /> Land Records
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

        <NavLink
          to="/upload"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={16} /> Upload Document
          </span>
        </NavLink>

        <NavLink
          to="/login"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          style={{ marginLeft: '1rem', borderLeft: '1px solid var(--border)', paddingLeft: '1rem' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <User size={16} /> Revenue Officer (Mock)
          </span>
        </NavLink>
      </div>
    </nav>
  );
}
