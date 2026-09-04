import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');

  async function load() {
    setTasks(await api.tasks.list());
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim()) return;
    await api.tasks.create({ title, dueDate: dueDate || null });
    setTitle('');
    setDueDate('');
    load();
  }

  async function toggleDone(task) {
    await api.tasks.update(task.id, { done: !task.done });
    load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tasks</h1>
          <div className="sub">{tasks.filter((t) => !t.done).length} open</div>
        </div>
      </div>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          placeholder="New task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--rule-strong)', borderRadius: 3 }}
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid var(--rule-strong)', borderRadius: 3 }}
        />
        <button className="btn" type="submit">Add</button>
      </form>

      {tasks.length === 0 ? (
        <div className="empty-state">No tasks yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Task</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ opacity: t.done ? 0.5 : 1 }}>
                <td><input type="checkbox" checked={t.done} onChange={() => toggleDone(t)} /></td>
                <td style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</td>
                <td>{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
