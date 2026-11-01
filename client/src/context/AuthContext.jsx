import React, { useEffect, useState } from 'react';
import { getCurrentUser, login, logout, register } from '../services/api';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then(currentUser => { if (active) setUser(currentUser); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setIsLoading(false); });

    const handleUnauthenticated = () => setUser(null);
    window.addEventListener('digibhoomi:unauthenticated', handleUnauthenticated);
    return () => {
      active = false;
      window.removeEventListener('digibhoomi:unauthenticated', handleUnauthenticated);
    };
  }, []);

  const signIn = async (credentials) => {
    const result = await login(credentials);
    setUser(result.user);
    return result.user;
  };

  const signUp = async (details) => {
    const result = await register(details);
    setUser(result.user);
    return result.user;
  };

  const signOut = async () => {
    await logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}