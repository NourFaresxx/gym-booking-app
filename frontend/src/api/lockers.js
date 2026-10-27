import { apiFetch } from './client';

function toQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  }
  const string = query.toString();
  return string ? `?${string}` : '';
}

export async function listOfferings(params = {}) {
  return apiFetch(`/lockers${toQueryString(params)}`, { auth: Boolean(params.includeInactive) });
}

export async function getOffering(id) {
  return apiFetch(`/lockers/${id}`, { auth: false });
}

export async function createOffering(data) {
  return apiFetch('/lockers', { method: 'POST', body: data });
}

export async function updateOffering(id, data) {
  return apiFetch(`/lockers/${id}`, { method: 'PATCH', body: data });
}

export async function deleteOffering(id) {
  return apiFetch(`/lockers/${id}`, { method: 'DELETE' });
}
