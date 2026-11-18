'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { customerApi } from '../lib/api';

export interface CustomerUser {
  id: string;
  username: string;
  full_name?: string | null;
  email: string;
  phone_e164?: string | null;
  avatar_url?: string | null;
  preferred_language?: 'vi' | 'en';
  created_at?: string;
}

interface AuthContextType {
  token: string | null;
  refreshToken: string | null;
  user: CustomerUser | null;
  isAuthenticated: boolean;
  sessionExpired: boolean;
  setSessionExpired: (expired: boolean) => void;
  login: (token: string, user: CustomerUser, refreshToken?: string | null) => void;
  updateUser: (patch: Partial<CustomerUser>, nextToken?: string) => void;
  logout: () => void;
  authHeaders: () => Record<string, string>;
  handleSessionExpired: () => void;
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isTokenExpired(jwtToken: string): boolean {
  try {
    const parts = jwtToken.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    return payload.exp * 1000 <= Date.now() + 5000;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  const rotateSession = useCallback(async (rt: string): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const job = (async () => {
      try {
        const res = await fetch(`${customerApi}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.access_token && data.user) {
          setToken(data.access_token);
          setUser(data.user);
          localStorage.setItem('court_customer_token', data.access_token);
          localStorage.setItem('court_customer_user', JSON.stringify(data.user));
          if (data.refresh_token) {
            setRefreshToken(data.refresh_token);
            localStorage.setItem('court_customer_refresh_token', data.refresh_token);
          }
          return data.access_token as string;
        }
        return null;
      } catch {
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = job;
    return job;
  }, []);

  useEffect(() => {
    const savedToken = localStorage.getItem('court_customer_token');
    const savedRefresh = localStorage.getItem('court_customer_refresh_token');
    const savedUser = localStorage.getItem('court_customer_user');
    if (savedRefresh) setRefreshToken(savedRefresh);

    if (savedToken && savedUser) {
      if (isTokenExpired(savedToken)) {
        if (savedRefresh) {
          void rotateSession(savedRefresh).then((fresh) => {
            if (!fresh) {
              localStorage.removeItem('court_customer_token');
              localStorage.removeItem('court_customer_refresh_token');
              localStorage.removeItem('court_customer_user');
              setToken(null);
              setRefreshToken(null);
              setUser(null);
            }
          });
        } else {
          localStorage.removeItem('court_customer_token');
          localStorage.removeItem('court_customer_user');
        }
      } else {
        try {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
        } catch {
          localStorage.removeItem('court_customer_user');
        }
      }
    }
  }, [rotateSession]);

  const login = useCallback((newToken: string, newUser: CustomerUser, newRefresh?: string | null) => {
    setToken(newToken);
    setUser(newUser);
    setSessionExpired(false);
    localStorage.setItem('court_customer_token', newToken);
    localStorage.setItem('court_customer_user', JSON.stringify(newUser));
    if (newRefresh) {
      setRefreshToken(newRefresh);
      localStorage.setItem('court_customer_refresh_token', newRefresh);
    }
  }, []);

  const updateUser = useCallback((patch: Partial<CustomerUser>, nextToken?: string) => {
    setUser((prev) => {
      if (!prev) return prev;
      const merged = { ...prev, ...patch };
      localStorage.setItem('court_customer_user', JSON.stringify(merged));
      return merged;
    });
    if (nextToken) {
      setToken(nextToken);
      localStorage.setItem('court_customer_token', nextToken);
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    setSessionExpired(false);
    localStorage.removeItem('court_customer_token');
    localStorage.removeItem('court_customer_refresh_token');
    localStorage.removeItem('court_customer_user');
  }, []);

  const handleSessionExpired = useCallback(() => {
    setToken(null);
    setRefreshToken(null);
    setUser(null);
    setSessionExpired(true);
    localStorage.removeItem('court_customer_token');
    localStorage.removeItem('court_customer_refresh_token');
    localStorage.removeItem('court_customer_user');
  }, []);

  const authHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const authenticatedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let activeToken = token;
      if (activeToken && isTokenExpired(activeToken) && refreshToken) {
        activeToken = await rotateSession(refreshToken);
      }
      if (!activeToken) {
        handleSessionExpired();
        throw new Error('SESSION_EXPIRED');
      }

      const headers = new Headers(init?.headers || {});
      headers.set('Authorization', `Bearer ${activeToken}`);
      let res = await fetch(input, { ...init, headers });

      if (res.status === 401 && refreshToken) {
        const refreshed = await rotateSession(refreshToken);
        if (refreshed) {
          headers.set('Authorization', `Bearer ${refreshed}`);
          res = await fetch(input, { ...init, headers });
        }
      }

      if (res.status === 401) {
        handleSessionExpired();
      }
      return res;
    },
    [token, refreshToken, rotateSession, handleSessionExpired]
  );

  return (
    <AuthContext.Provider
      value={{
        token,
        refreshToken,
        user,
        isAuthenticated: !!token,
        sessionExpired,
        setSessionExpired,
        login,
        updateUser,
        logout,
        authHeaders,
        handleSessionExpired,
        authenticatedFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
