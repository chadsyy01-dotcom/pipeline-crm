import { useEffect, useState } from 'react';
import { api } from '../api/client';

const EMPTY_FORM = { name: '', website: '', industry: '' };

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  async function load() {
    setCompanies(await api.companies.list());
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (editingId) {
      await api.companies.update(editingId, form);
    } else {
      await api.companies.create(form);
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    load();
  }

  function startEdit(c) {
    setForm({ name: c.name || '', website: c.website || '', industry: c.industry || '' });
    setEditingId(c.id);
    setShowForm(true);
  }

  function cancelForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this company? This cannot be undone.')) return;
    await api.companies.remove(id);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Companies</h1>
          <div className="sub">{companies.length} accounts</div>
        </div>
        <button className="btn" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
          {showForm ? 'Cancel' : 'New company'}
        </button>
      </div>

      {showForm && (
        <form className="form-card" onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>Website</label>
            <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          <div className="field">
            <label>Industry</label>
            <input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          </div>
          <button className="btn" type="submit">{editingId ? 'Update company' : 'Save company'}</button>
        </form>
      )}

      {companies.length === 0 ? (
        <div className="empty-state">No companies yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Website</th>
              <th>Industry</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.website}</td>
                <td>{c.industry}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-outline btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => startEdit(c)}>
                    Edit
                  </button>
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
