import { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { AuthPage } from './pages/AuthPage';
import { CreatePage } from './pages/CreatePage';
import { HistoryPage } from './pages/HistoryPage';
import { JobPage } from './pages/JobPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Header() {
  const { user, signOut } = useAuth();
  return (
    <header className="header">
      <NavLink to="/" className="brand">
        <span className="brand-mark">▶</span> Clipforge
      </NavLink>
      {user && (
        <nav className="nav">
          <NavLink to="/" end>
            Create
          </NavLink>
          <NavLink to="/history">History</NavLink>
          <span className="muted user-name">{user.name}</span>
          <button className="btn ghost small" onClick={signOut}>
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}

export function App() {
  return (
    <>
      <Header />
      <main className="container">
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <CreatePage />
              </RequireAuth>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <RequireAuth>
                <JobPage />
              </RequireAuth>
            }
          />
          <Route
            path="/history"
            element={
              <RequireAuth>
                <HistoryPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
