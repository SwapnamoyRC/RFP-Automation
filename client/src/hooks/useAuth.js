import { useState, useCallback, useEffect } from 'react';
import * as authApi from '../api/auth';
import { extractError } from '../utils/extractError';

export function useAuth() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isAuthenticated = !!user;

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const { user: u, token } = await authApi.login(email, password);
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(u));
      setUser(u);
      return u;
    } catch (err) {
      const msg = extractError(err, 'Login failed');
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email, password, name) => {
    setLoading(true);
    setError(null);
    try {
      const { user: u, token } = await authApi.register(email, password, name);
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(u));
      setUser(u);
      return u;
    } catch (err) {
      const msg = extractError(err, 'Registration failed');
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      // Call logout API to invalidate session on backend
      await authApi.logout();
    } catch (err) {
      console.error('Logout failed:', err);
      // Continue with client-side logout even if API call fails
    } finally {
      // Always clear client-side session
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    }
  }, []);

  return { user, isAuthenticated, loading, error, login, register, logout };
}
