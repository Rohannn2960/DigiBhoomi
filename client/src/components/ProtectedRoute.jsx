import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth-context';

export default function ProtectedRoute({ children, roles }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <p role="status" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Checking your session...</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <section role="alert" className="card" style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <h2>Access denied</h2>
        <p>Your {user.role} account does not have permission to open this page.</p>
        <Link to="/records" className="btn btn-primary">Return to your records</Link>
      </section>
    );
  }
  return children;
}