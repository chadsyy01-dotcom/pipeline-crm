import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './api/client';
import Login from './pages/Login.jsx';
import CsrDashboard from './pages/CsrDashboard.jsx';

function isNetlifyDeploy() {
  return window.location.hostname.includes('netlify.app');
}

function Protected({ children }) {
  if (!isLoggedIn() && !isNetlifyDeploy()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Log in and sign up share one page (2026-09-21): /register opens the
          same card already switched to "Create account". The separate
          Register page is no longer used. The keys make React start a fresh
          page when moving between the two routes, so each opens in the
          right mode. */}
      <Route path="/login" element={<Login key="login" />} />
      <Route path="/register" element={<Login key="register" />} />
      <Route
        path="/"
        element={
          <Protected>
            <CsrDashboard />
          </Protected>
        }
      />
      <Route
        path="csr-dashboard"
        element={
          <Protected>
            <CsrDashboard />
          </Protected>
        }
      />
    </Routes>
  );
}
