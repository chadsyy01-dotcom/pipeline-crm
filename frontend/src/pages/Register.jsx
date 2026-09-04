import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token } = await api.register({ name, email, password, inviteCode });
      setToken(token);
      navigate('/deals');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-screen">
      <div>
        <div className="brand">Pipeline</div>
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div className="field">
            <label>Invite code <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>(only needed after the first account exists)</span></label>
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn" type="submit" style={{ width: '100%', marginTop: 8 }}>
            Create account
          </button>
          <div style={{ marginTop: 14, fontSize: 12.5, textAlign: 'center' }}>
            Already have one? <Link to="/login">Log in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
