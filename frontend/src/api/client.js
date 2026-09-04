// Use environment variable for API base, fall back to /api for dev
const BASE = import.meta.env.VITE_API_BASE || '/api';

function getToken() {
  return localStorage.getItem('pipeline_token');
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),
  me: () => request('/auth/me'),

  companies: {
    list: () => request('/companies'),
    get: (id) => request(`/companies/${id}`),
    create: (body) => request('/companies', { method: 'POST', body }),
    update: (id, body) => request(`/companies/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/companies/${id}`, { method: 'DELETE' }),
  },

  contacts: {
    list: (params = '') => request(`/contacts${params}`),
    get: (id) => request(`/contacts/${id}`),
    create: (body) => request('/contacts', { method: 'POST', body }),
    update: (id, body) => request(`/contacts/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/contacts/${id}`, { method: 'DELETE' }),
    addActivity: (id, body) => request(`/contacts/${id}/activities`, { method: 'POST', body }),
  },

  deals: {
    board: () => request('/deals/board'),
    list: () => request('/deals'),
    get: (id) => request(`/deals/${id}`),
    create: (body) => request('/deals', { method: 'POST', body }),
    update: (id, body) => request(`/deals/${id}`, { method: 'PUT', body }),
    moveStage: (id, DealStageId) => request(`/deals/${id}/stage`, { method: 'PATCH', body: { DealStageId } }),
    remove: (id) => request(`/deals/${id}`, { method: 'DELETE' }),
  },

  tasks: {
    list: () => request('/tasks'),
    create: (body) => request('/tasks', { method: 'POST', body }),
    update: (id, body) => request(`/tasks/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  },
};

export function setToken(token) {
  localStorage.setItem('pipeline_token', token);
}

export function clearToken() {
  localStorage.removeItem('pipeline_token');
}

export function isLoggedIn() {
  return !!getToken();
}