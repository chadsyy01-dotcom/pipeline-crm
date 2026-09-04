import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function Deals() {
  const [stages, setStages] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', value: '', DealStageId: '' });

  async function load() {
    const data = await api.deals.board();
    setStages(data);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    await api.deals.create({ ...form, DealStageId: form.DealStageId || stages[0]?.id });
    setForm({ title: '', value: '', DealStageId: '' });
    setShowForm(false);
    load();
  }

  function onDragStart(e, dealId) {
    e.dataTransfer.setData('dealId', dealId);
  }

  async function onDrop(e, stageId) {
    const dealId = e.dataTransfer.getData('dealId');
    await api.deals.moveStage(dealId, stageId);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Pipeline</h1>
          <div className="sub">Drag deals between stages</div>
        </div>
        <button className="btn" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New deal'}
        </button>
      </div>

      {showForm && (
        <form className="form-card" onSubmit={handleCreate} style={{ marginBottom: 24 }}>
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
          <button className="btn" type="submit">Save deal</button>
        </form>
      )}

      <div className="board">
        {stages.map((stage) => (
          <div
            key={stage.id}
            className="board-column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, stage.id)}
          >
            <h3>
              <span>{stage.name}</span>
              <span>{stage.Deals?.length || 0}</span>
            </h3>
            {(stage.Deals || []).map((deal) => (
              <div
                key={deal.id}
                className="deal-card"
                draggable
                onDragStart={(e) => onDragStart(e, deal.id)}
              >
                <Link to={`/deals/${deal.id}`} style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                  <div className="title">{deal.title}</div>
                  <div className="value">${deal.value}</div>
                  <div className="meta">{deal.Contact ? `${deal.Contact.firstName} ${deal.Contact.lastName}` : deal.Company?.name || ''}</div>
                </Link>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
