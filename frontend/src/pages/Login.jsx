import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.login({ email, password });
      setToken(token);
      navigate('/deals');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-screen">
      <div>
        <div className="brand">
          <span>Customer Service</span>
          <span>Representative CRM</span>
        </div>
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn" type="submit" style={{ width: '100%', marginTop: 8 }}>
            Log in
          </button>
          <div style={{ marginTop: 14, fontSize: 12.5, textAlign: 'center' }}>
            No account? <Link to="/register">Create one</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
