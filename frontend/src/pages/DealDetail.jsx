import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';

export default function DealDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [stages, setStages] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    const [dealData, board, contactList, companyList] = await Promise.all([
      api.deals.get(id),
      api.deals.board(),
      api.contacts.list(),
      api.companies.list(),
    ]);
    setDeal(dealData);
    setStages(board.map(({ id, name }) => ({ id, name })));
    setContacts(contactList);
    setCompanies(companyList);
    setForm({
      title: dealData.title || '',
      value: dealData.value ?? 0,
      DealStageId: dealData.DealStageId || '',
      ContactId: dealData.ContactId || '',
      CompanyId: dealData.CompanyId || '',
      notes: dealData.notes || '',
    });
  }

  useEffect(() => { load(); }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    await api.deals.update(id, {
      ...form,
      ContactId: form.ContactId || null,
      CompanyId: form.CompanyId || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    load();
  }

  async function handleDelete() {
    if (!window.confirm('Delete this deal? This cannot be undone.')) return;
    await api.deals.remove(id);
    navigate('/deals');
  }

  async function handleAddNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    // Deals don't have a dedicated activity endpoint yet — reuse notes field
    // as a running log for now by appending to it.
    const updatedNotes = form.notes ? `${form.notes}\n\n${new Date().toLocaleString()} — ${note}` : `${new Date().toLocaleString()} — ${note}`;
    await api.deals.update(id, { notes: updatedNotes });
    setNote('');
    load();
  }

  if (!deal || !form) return <div>Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{deal.title}</h1>
          <div className="sub">
            {deal.DealStage?.name || 'No stage'} · ${deal.value}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/deals" className="btn btn-outline">Back to pipeline</Link>
          <button className="btn btn-danger" onClick={handleDelete}>Delete deal</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 32 }}>
        <form className="form-card" onSubmit={handleSave} style={{ maxWidth: 'none' }}>
          <div className="field">
            <label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="field">
            <label>Value ($)</label>
            <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
          </div>
          <div className="field">
            <label>Stage</label>
            <select value={form.DealStageId} onChange={(e) => setForm({ ...form, DealStageId: e.target.value })}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Contact</label>
            <select value={form.ContactId} onChange={(e) => setForm({ ...form, ContactId: e.target.value })}>
              <option value="">— None —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
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
            Notes
          </h3>
          <form onSubmit={handleAddNote} style={{ marginBottom: 16 }}>
            <textarea
              placeholder="Add a note about this deal…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ width: '100%', minHeight: 60, padding: 8, border: '1px solid var(--rule-strong)', borderRadius: 3, fontFamily: 'inherit' }}
            />
            <button className="btn" type="submit" style={{ marginTop: 8 }}>Add note</button>
          </form>
          {form.notes ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13.5, background: 'var(--paper-raised)', border: '1px solid var(--rule)', borderRadius: 4, padding: 14 }}>
              {form.notes}
            </pre>
          ) : (
            <div className="empty-state">No notes yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
