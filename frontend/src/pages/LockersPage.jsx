import { useEffect, useState } from 'react';
import { listOfferings } from '../api/lockers';
import LockerOfferingCard from '../components/LockerOfferingCard';
import ErrorMessage from '../components/ErrorMessage';
import SkeletonGrid from '../components/SkeletonGrid';

export default function LockersPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listOfferings({ limit: 50 })
      .then((data) => {
        if (!cancelled) setItems(data.items);
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
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Lockers</h1>
          <p className="page-subtitle">Keep your things safe — rent by the day, month, or year.</p>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading ? (
        <SkeletonGrid count={2} />
      ) : items.length === 0 ? (
        <p className="empty-state">No locker offerings right now.</p>
      ) : (
        <div className="resource-grid">
          {items.map((offering) => (
            <LockerOfferingCard key={offering._id} offering={offering} />
          ))}
        </div>
      )}
    </div>
  );
}
