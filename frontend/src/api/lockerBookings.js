import { apiFetch } from './client';

export async function rentLocker({ offeringId, tier }) {
  return apiFetch('/locker-bookings', { method: 'POST', body: { offeringId, tier } });
}

export async function listMyLockerBookings(params = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch(`/locker-bookings/me${suffix}`);
}

export async function cancelLockerBooking(id) {
  return apiFetch(`/locker-bookings/${id}/cancel`, { method: 'PATCH' });
}
