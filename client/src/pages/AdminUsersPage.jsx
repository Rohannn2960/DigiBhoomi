import React, { useEffect, useState } from 'react';
import { fetchAuditEvents, fetchUsers, updateUserRole } from '../services/api';
import { useAuth } from '../context/auth-context';

const ROLES = ['Citizen', 'Officer', 'Admin'];

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchUsers(), fetchAuditEvents()])
      .then(([userList, auditEvents]) => {
        setUsers(userList);
        setEvents(auditEvents);
      })
      .catch(requestError => setError(requestError.message))
      .finally(() => setIsLoading(false));
  }, []);

  const handleRoleChange = async (userId, role) => {
    setError(null);
    try {
      const result = await updateUserRole(userId, role);
      setUsers(current => current.map(user => user.id === userId ? result.user : user));
      setEvents(await fetchAuditEvents());
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">User Administration</h1>
          <p className="page-description">Manage accounts, role assignments, and security events.</p>
        </div>
      </header>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {isLoading ? <p role="status">Loading administrative data...</p> : (
        <>
          <section className="table-container" aria-labelledby="users-heading">
            <h2 id="users-heading" style={{ padding: '1rem 1rem 0.25rem', fontSize: '1rem' }}>Users</h2>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Assigned role</th></tr></thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id}>
                    <td>{user.displayName}</td>
                    <td>{user.email}</td>
                    <td>{user.role}</td>
                    <td>
                      <select className="field-input" aria-label={`Role for ${user.email}`} value={user.role} disabled={user.id === currentUser?.id} onChange={event => handleRoleChange(user.id, event.target.value)}>
                        {ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="table-container" aria-labelledby="audit-heading" style={{ marginTop: '1.5rem' }}>
            <h2 id="audit-heading" style={{ padding: '1rem 1rem 0.25rem', fontSize: '1rem' }}>Persistent Audit History</h2>
            <table className="data-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th></tr></thead>
              <tbody>
                {events.map(event => (
                  <tr key={event._id}>
                    <td>{new Date(event.timestamp).toLocaleString()}</td>
                    <td>{event.actorId?.email || 'Unauthenticated'}</td>
                    <td>{event.action}</td>
                    <td>{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}</td>
                    <td>{event.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}