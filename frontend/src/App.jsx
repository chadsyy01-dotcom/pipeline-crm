import { Routes, Route, Navigate } from 'react-router-dom';
import { isLoggedIn } from './api/client';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
import Companies from './pages/Companies.jsx';
import Deals from './pages/Deals.jsx';
import DealDetail from './pages/DealDetail.jsx';
import Tasks from './pages/Tasks.jsx';
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
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="deals" element={<Deals />} />
        <Route path="deals/:id" element={<DealDetail />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactDetail />} />
        <Route path="companies" element={<Companies />} />
        <Route path="tasks" element={<Tasks />} />
      </Route>
    </Routes>
  );
}
