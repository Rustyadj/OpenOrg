import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { appConfig, hasFirebaseConfig } from '../lib/config';
import { getFirebaseAuth } from '../lib/firebase';

type AuthContextValue = {
  loading: boolean;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  user: User | null;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(!appConfig.allowDemoAuth && hasFirebaseConfig);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (appConfig.allowDemoAuth || !hasFirebaseConfig) {
      setLoading(false);
      return;
    }

    const { auth } = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    return onAuthStateChanged(auth, (currentUser: User | null) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    isAuthenticated: appConfig.allowDemoAuth || Boolean(user),
    isDemoMode: appConfig.allowDemoAuth,
    user,
    signIn: async () => {
      const { auth, provider } = getFirebaseAuth();
      if (!auth || !provider) throw new Error('Firebase auth is not configured.');
      await signInWithPopup(auth, provider);
    },
    signOutUser: async () => {
      const { auth } = getFirebaseAuth();
      if (!auth) return;
      await signOut(auth);
    },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.loading) {
    return <CenteredCard title="Checking auth" body="Verifying your session…" />;
  }

  if (!auth.isAuthenticated) {
    return (
      <CenteredCard
        title="Authentication required"
        body={hasFirebaseConfig
          ? 'Sign in with Firebase before using the dashboard.'
          : 'Add Firebase env vars or explicitly enable demo auth for local-only previews.'}
        action={hasFirebaseConfig ? { label: 'Sign in with Google', onClick: auth.signIn } : undefined}
        footer={!hasFirebaseConfig ? 'Copy .env.example to .env and configure Firebase + gateway URL.' : undefined}
      />
    );
  }

  return <>{children}</>;
}

function CenteredCard({
  title,
  body,
  action,
  footer,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => Promise<void> | void };
  footer?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, position: 'relative', zIndex: 1 }}>
      <div className="glass-strong" style={{ width: 'min(100%, 460px)', borderRadius: 24, padding: 28 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.04em' }}>{title}</div>
        <div style={{ marginTop: 10, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{body}</div>
        {action && (
          <button
            onClick={async () => {
              try {
                setError(null);
                await action.onClick();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Sign-in failed.');
              }
            }}
            style={{
              marginTop: 18,
              border: 'none',
              borderRadius: 12,
              padding: '12px 16px',
              fontWeight: 700,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, #00E6A8, #00C494)',
              color: '#fff',
            }}
          >
            {action.label}
          </button>
        )}
        {error && <div style={{ marginTop: 12, color: 'var(--status-red)', fontSize: 14 }}>{error}</div>}
        {footer && <div style={{ marginTop: 14, color: 'var(--text-muted)', fontSize: 13 }}>{footer}</div>}
      </div>
    </div>
  );
}
