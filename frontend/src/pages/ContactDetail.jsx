import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    const [contactData, companyList] = await Promise.all([
      api.contacts.get(id),
      api.companies.list(),
    ]);
    setContact(contactData);
    setCompanies(companyList);
    setForm({
      firstName: contactData.firstName || '',
      lastName: contactData.lastName || '',
      email: contactData.email || '',
      phone: contactData.phone || '',
      status: contactData.status || 'lead',
      CompanyId: contactData.CompanyId || '',
    });
  }

  useEffect(() => { load(); }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    await api.contacts.update(id, { ...form, CompanyId: form.CompanyId || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    load();
  }

  async function handleDelete() {
    if (!window.confirm('Delete this contact? This cannot be undone.')) return;
    await api.contacts.remove(id);
    navigate('/contacts');
  }

  async function handleAddNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    await api.contacts.addActivity(id, { type: 'note', content: note });
    setNote('');
    load();
  }

  if (!contact || !form) return <div>Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{contact.firstName} {contact.lastName}</h1>
          <div className="sub">{contact.email || 'No email'} · {contact.phone || 'No phone'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/contacts" className="btn btn-outline">Back to contacts</Link>
          <button className="btn btn-danger" onClick={handleDelete}>Delete contact</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr 1fr', gap: 32 }}>
        <form className="form-card" onSubmit={handleSave} style={{ maxWidth: 'none' }}>
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
          <div className="field">
            <label>Company</label>
            <select value={form.CompanyId} onChange={(e) => setForm({ ...form, CompanyId: e.target.value })}>
              <option value="">— None —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button className="btn" type="submit">Save changes</button>
          {saved && <span style={{ marginLeft: 10, fontSize: 12.5, color: 'var(--pine-dark)' }}>Saved.</span>}
        </form>

        <div>
          <h3 style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Deals
          </h3>
          {contact.Deals && contact.Deals.length > 0 ? (
            <ul style={{ paddingLeft: 18 }}>
              {contact.Deals.map((d) => (
                <li key={d.id}><Link to={`/deals/${d.id}`}>{d.title}</Link> — ${d.value}</li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">No deals linked yet.</div>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Activity
          </h3>
          <form onSubmit={handleAddNote} style={{ marginBottom: 16 }}>
            <textarea
              placeholder="Log a note, call, or email…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid var(--rule-strong)', borderRadius: 3, fontFamily: 'inherit' }}
            />
            <button className="btn" type="submit" style={{ marginTop: 8 }}>Log note</button>
          </form>
          {contact.Activities && contact.Activities.length > 0 ? (
            contact.Activities.map((a) => (
              <div key={a.id} style={{ borderBottom: '1px solid var(--rule)', padding: '10px 0' }}>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>
                  {a.type} · {new Date(a.createdAt).toLocaleString()}
                </div>
                <div>{a.content}</div>
              </div>
            ))
          ) : (
            <div className="empty-state">No activity logged yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
