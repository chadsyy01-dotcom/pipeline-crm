import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

const STATUS_CLASS = { lead: 'pill-lead', active: 'pill-active', customer: 'pill-customer', inactive: 'pill-inactive' };

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', status: 'lead' });

  async function load(query = '') {
    const data = await api.contacts.list(query ? `?q=${encodeURIComponent(query)}` : '');
    setContacts(data);
  }

  useEffect(() => { load(); }, []);

  async function handleSearch(e) {
    e.preventDefault();
    load(q);
  }

  async function handleCreate(e) {
    e.preventDefault();
    await api.contacts.create(form);
    setForm({ firstName: '', lastName: '', email: '', phone: '', status: 'lead' });
    setShowForm(false);
    load();
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this contact? This cannot be undone.')) return;
    await api.contacts.remove(id);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <div className="sub">{contacts.length} people</div>
        </div>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New contact'}
        </button>
      </div>

      {showForm && (
        <form className="form-card" onSubmit={handleCreate} style={{ marginBottom: 24 }}>
          <div className="field">
            <label>First name</label>
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          </div>
          <div className="field">
            <label>Last name</label>
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="lead">Lead</option>
              <option value="active">Active</option>
              <option value="customer">Customer</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <button className="btn" type="submit">Save contact</button>
        </form>
      )}

      <form onSubmit={handleSearch} style={{ marginBottom: 16 }}>
        <input
          placeholder="Search contacts…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--rule-strong)', borderRadius: 3, width: 280 }}
        />
      </form>

      {contacts.length === 0 ? (
        <div className="empty-state">No contacts yet. Add your first one above.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Company</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/contacts/${c.id}`}>{c.firstName} {c.lastName}</Link></td>
                <td>{c.email}</td>
                <td>{c.phone}</td>
                <td>{c.Company?.name || '—'}</td>
                <td><span className={`pill ${STATUS_CLASS[c.status]}`}>{c.status}</span></td>
                <td>
                  <button className="btn-outline btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleDelete(c.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
