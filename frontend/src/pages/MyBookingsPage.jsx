import { useCallback, useEffect, useState } from 'react';
import { listMyBookings, cancelBooking } from '../api/bookings';
import { listMyLockerBookings, cancelLockerBooking } from '../api/lockerBookings';
import StatusBadge from '../components/StatusBadge';
import ErrorMessage from '../components/ErrorMessage';
import { formatDateTime, formatMoney } from '../lib/formatters';

const CANCELLABLE_STATUSES = new Set(['pending', 'confirmed']);
const TIER_LABELS = { day: '1 day', month: '1 month', year: '1 year' };

export default function MyBookingsPage() {
  const [tab, setTab] = useState('classes');

  return (
    <div className="page">
      <h1>My bookings</h1>

      <nav className="admin-tabs">
        <button
          type="button"
          className={tab === 'classes' ? 'active' : undefined}
          onClick={() => setTab('classes')}
        >
          Classes
        </button>
        <button
          type="button"
          className={tab === 'lockers' ? 'active' : undefined}
          onClick={() => setTab('lockers')}
        >
          Lockers
        </button>
      </nav>

      {tab === 'classes' ? <ClassBookingsTab /> : <LockerBookingsTab />}
    </div>
  );
}

function ClassBookingsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyBookings();
      setItems(data.items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel(booking) {
    const resourceName = booking.resourceId?.name || 'this booking';
    if (!window.confirm(`Cancel your booking for ${resourceName}?`)) return;

    setCancellingId(booking._id);
    setError(null);
    try {
      const updated = await cancelBooking(booking._id);
      setItems((current) => current.map((item) => (item._id === updated._id ? updated : item)));
    } catch (err) {
      setError(err);
    } finally {
      setCancellingId(null);
    }
  }

  const upcomingFirst = [...items].sort((a, b) => new Date(a.slotStart) - new Date(b.slotStart));

  return (
    <>
      <ErrorMessage error={error} />
      {loading ? (
        <p className="page-loading">Loading…</p>
      ) : upcomingFirst.length === 0 ? (
        <p className="empty-state">You haven't booked any classes yet.</p>
      ) : (
        <ul className="booking-list">
          {upcomingFirst.map((booking) => {
            const slotHasStarted = new Date(booking.slotStart).getTime() <= Date.now();
            const canCancel = CANCELLABLE_STATUSES.has(booking.status) && !slotHasStarted;

            return (
              <li key={booking._id} className="booking-item">
                <div className="booking-item-main">
                  <h3>{booking.resourceId?.name || 'Resource'}</h3>
                  <p>{formatDateTime(booking.slotStart)}</p>
                  <p className="booking-item-amount">{formatMoney(booking.amount, booking.currency)}</p>
                </div>
                <div className="booking-item-side">
                  <StatusBadge status={booking.status} />
                  {canCancel && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={cancellingId === booking._id}
                      onClick={() => handleCancel(booking)}
                    >
                      {cancellingId === booking._id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function LockerBookingsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMyLockerBookings();
      setItems(data.items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCancel(booking) {
    const offeringName = booking.offeringId?.name || 'this locker';
    if (!window.confirm(`Cancel your rental of ${offeringName}?`)) return;

    setCancellingId(booking._id);
    setError(null);
    try {
      const updated = await cancelLockerBooking(booking._id);
      setItems((current) => current.map((item) => (item._id === updated._id ? updated : item)));
    } catch (err) {
      setError(err);
    } finally {
      setCancellingId(null);
    }
  }

  const newestFirst = [...items].sort((a, b) => new Date(b.rentalStart) - new Date(a.rentalStart));

  return (
    <>
      <ErrorMessage error={error} />
      {loading ? (
        <p className="page-loading">Loading…</p>
      ) : newestFirst.length === 0 ? (
        <p className="empty-state">You haven't rented a locker yet.</p>
      ) : (
        <ul className="booking-list">
          {newestFirst.map((booking) => {
            const canCancel = CANCELLABLE_STATUSES.has(booking.status);

            return (
              <li key={booking._id} className="booking-item">
                <div className="booking-item-main">
                  <h3>{booking.offeringId?.name || 'Locker'}</h3>
                  <p>
                    {booking.unitId?.label ? `${booking.unitId.label} · ` : ''}
                    {TIER_LABELS[booking.tier] || booking.tier} · {formatDateTime(booking.rentalStart)}{' '}
                    – {formatDateTime(booking.rentalEnd)}
                  </p>
                  <p className="booking-item-amount">{formatMoney(booking.amount, booking.currency)}</p>
                </div>
                <div className="booking-item-side">
                  <StatusBadge status={booking.status} />
                  {canCancel && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={cancellingId === booking._id}
                      onClick={() => handleCancel(booking)}
                    >
                      {cancellingId === booking._id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
