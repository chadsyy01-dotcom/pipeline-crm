import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './api/client';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import CsrDashboard from './pages/CsrDashboard.jsx';

function Protected({ children }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
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
