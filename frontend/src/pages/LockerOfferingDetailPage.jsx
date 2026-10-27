import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getOffering } from '../api/lockers';
import { useAuth } from '../context/AuthContext';
import ErrorMessage from '../components/ErrorMessage';
import { formatMoney } from '../lib/formatters';

const TIERS = [
  { key: 'day', label: '1 Day' },
  { key: 'month', label: '1 Month' },
  { key: 'year', label: '1 Year' },
];

export default function LockerOfferingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [offering, setOffering] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState('month');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOffering(id)
      .then((data) => {
        if (!cancelled) setOffering(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleRent() {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: `/lockers/${id}` } } });
      return;
    }
    navigate('/locker-checkout', {
      state: { offeringId: id, tier, offeringName: offering?.name },
    });
  }

  if (loading) {
    return (
      <div className="page">
        <p className="page-loading">Loading…</p>
      </div>
    );
  }

  if (error || !offering) {
    return (
      <div className="page">
        <ErrorMessage error={error} />
      </div>
    );
  }

  const soldOut = offering.availableNow === 0;

  return (
    <div className="page">
      <div className="resource-detail-header">
        <div>
          <h1>{offering.name}</h1>
          {offering.description && <p className="resource-detail-desc">{offering.description}</p>}
        </div>
      </div>

      <section className="availability-section">
        <h2 className="tier-section-title">Choose a rental length</h2>
        <div className="tier-grid">
          {TIERS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tier-btn${tier === t.key ? ' tier-btn-selected' : ''}`}
              onClick={() => setTier(t.key)}
            >
              <span className="tier-btn-label">{t.label}</span>
              <span className="tier-btn-price">
                {formatMoney(offering.pricing[t.key], offering.currency)}
              </span>
            </button>
          ))}
        </div>
        <p className="locker-availability-note">
          {soldOut
            ? 'No lockers available right now'
            : `${offering.availableNow} locker${offering.availableNow === 1 ? '' : 's'} available now`}
        </p>
      </section>

      <div className="booking-cta">
        <button type="button" className="btn btn-primary" disabled={soldOut} onClick={handleRent}>
          {soldOut ? 'Fully booked' : 'Continue to payment'}
        </button>
      </div>
    </div>
  );
}
