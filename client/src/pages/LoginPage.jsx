import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, UserCheck } from 'lucide-react';
import { useAuth } from '../context/auth-context';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isRegistering) await signUp({ displayName, email, password });
      else await signIn({ email, password });
      navigate(location.state?.from || '/records', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
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
          <h2 style={{ fontSize: '1.4rem', marginBottom: '0.25rem' }}>{isRegistering ? 'Create Citizen Account' : 'DigiBhoomi Portal'}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Land Record Digitization & Verification System (SIH 26018)
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {isRegistering && (
            <div className="field-group">
              <label className="field-label" htmlFor="displayName">Full name</label>
              <input id="displayName" className="field-input" autoComplete="name" maxLength={100} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
          )}
          <div className="field-group">
            <label className="field-label" htmlFor="email">Email</label>
            <input 
              id="email"
              type="email" 
              className="field-input" 
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field-group" style={{ marginBottom: '1rem' }}>
            <label className="field-label" htmlFor="password">Password</label>
            <input 
              id="password"
              type="password" 
              className="field-input" 
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              minLength={isRegistering ? 12 : undefined}
              maxLength={256}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && <p role="alert" style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ width: '100%', justifyContent: 'center' }}>
            <UserCheck size={18} /> {isSubmitting ? 'Please wait...' : isRegistering ? 'Create Citizen Account' : 'Sign In'} <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={() => { setIsRegistering(value => !value); setError(null); }}>
            {isRegistering ? 'Already registered? Sign in' : 'Register as a Citizen'}
          </button>
        </div>
      </div>
    </div>
  );
}
