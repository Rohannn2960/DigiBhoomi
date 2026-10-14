import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, UserCheck } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState('officer');

  const handleLogin = (e) => {
    e.preventDefault();
    // Day 1: Mock login, straight to records list
    navigate('/records');
  };

  return (
    <div style={{ maxWidth: '440px', margin: '4rem auto 0 auto' }}>
      <div className="card" style={{ padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div 
            style={{ 
              width: '48px', 
              height: '48px', 
              background: 'var(--primary-light)', 
              color: 'var(--primary)', 
              borderRadius: '50%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              margin: '0 auto 1rem' 
            }}
          >
            <ShieldCheck size={28} />
          </div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>DigiBhoomi Portal</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Land Record Digitization & Verification System (SIH 26018)
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="field-group">
            <label className="field-label">Portal Role (Mock)</label>
            <select 
              className="field-input" 
              value={role} 
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="officer">Revenue Inspector / Tehsildar (Reviewer)</option>
              <option value="clerk">Record Room Data Entry Clerk</option>
              <option value="admin">District Land Administrator</option>
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">Officer Email</label>
            <input 
              type="email" 
              className="field-input" 
              defaultValue="officer.revenue@up.gov.in" 
              readOnly 
            />
          </div>

          <div className="field-group" style={{ marginBottom: '1.75rem' }}>
            <label className="field-label">Password</label>
            <input 
              type="password" 
              className="field-input" 
              defaultValue="••••••••••••" 
              readOnly 
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            <UserCheck size={18} /> Enter Portal <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Day 1 Prototype: Authentication bypassed for evaluation.
          </span>
        </div>
      </div>
    </div>
  );
}
