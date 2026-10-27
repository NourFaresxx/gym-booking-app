import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listOfferings, updateOffering } from '../../api/lockers';
import ErrorMessage from '../../components/ErrorMessage';
import { formatMoney } from '../../lib/formatters';

export default function AdminLockersPage() {
  const [items, setItems] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listOfferings({ limit: 100, includeInactive: showInactive });
      setItems(data.items);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(offering) {
    setTogglingId(offering._id);
    setError(null);
    try {
      await updateOffering(offering._id, { isActive: !offering.isActive });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="admin-section">
      <div className="page-header">
        <h2 className="admin-section-title">Lockers</h2>
        <div className="admin-toolbar">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <Link to="/admin/lockers/new" className="btn btn-primary">
            + New
          </Link>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading ? (
        <p className="page-loading">Loading…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">No locker offerings yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Capacity</th>
                <th>Available now</th>
                <th>Day / Month / Year</th>
                <th>Status</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {items.map((offering) => (
                <tr key={offering._id}>
                  <td>{offering.name}</td>
                  <td>{offering.capacity}</td>
                  <td>{offering.availableNow}</td>
                  <td>
                    {formatMoney(offering.pricing.day, offering.currency)} /{' '}
                    {formatMoney(offering.pricing.month, offering.currency)} /{' '}
                    {formatMoney(offering.pricing.year, offering.currency)}
                  </td>
                  <td>
                    <span className={`badge ${offering.isActive ? 'badge-good' : 'badge-neutral'}`}>
                      {offering.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="data-table-actions">
                    <Link to={`/admin/lockers/${offering._id}/edit`} className="btn btn-ghost btn-small">
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={togglingId === offering._id}
                      onClick={() => toggleActive(offering)}
                    >
                      {togglingId === offering._id
                        ? '…'
                        : offering.isActive
                          ? 'Deactivate'
                          : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
