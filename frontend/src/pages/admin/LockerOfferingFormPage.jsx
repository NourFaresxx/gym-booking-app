import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getOffering, createOffering, updateOffering } from '../../api/lockers';
import ErrorMessage from '../../components/ErrorMessage';

const EMPTY_FORM = {
  name: '',
  description: '',
  capacity: '10',
  dayDollars: '5.00',
  monthDollars: '40.00',
  yearDollars: '350.00',
};

export default function LockerOfferingFormPage() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isEditing) return;
    getOffering(id)
      .then((offering) => {
        setForm({
          name: offering.name,
          description: offering.description || '',
          capacity: String(offering.capacity),
          dayDollars: (offering.pricing.day / 100).toFixed(2),
          monthDollars: (offering.pricing.month / 100).toFixed(2),
          yearDollars: (offering.pricing.year / 100).toFixed(2),
        });
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id, isEditing]);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload = {
      name: form.name,
      description: form.description || undefined,
      capacity: Math.round(Number(form.capacity)),
      pricing: {
        day: Math.round(Number(form.dayDollars) * 100),
        month: Math.round(Number(form.monthDollars) * 100),
        year: Math.round(Number(form.yearDollars) * 100),
      },
    };

    try {
      if (isEditing) await updateOffering(id, payload);
      else await createOffering(payload);
      navigate('/admin/lockers');
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  if (loading) return <p className="page-loading">Loading…</p>;

  return (
    <div className="admin-section">
      <h2 className="admin-section-title">
        {isEditing ? 'Edit locker offering' : 'New locker offering'}
      </h2>

      <form className="admin-form" onSubmit={handleSubmit}>
        <ErrorMessage error={error} />

        <label>
          Name
          <input
            type="text"
            required
            minLength={2}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>

        <label>
          Description
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>

        <label>
          Capacity (number of physical lockers)
          <input
            type="number"
            min="1"
            step="1"
            required
            value={form.capacity}
            onChange={(e) => update({ capacity: e.target.value })}
          />
        </label>

        <div className="admin-form-row">
          <label>
            Price per day (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.dayDollars}
              onChange={(e) => update({ dayDollars: e.target.value })}
            />
          </label>
          <label>
            Price per month (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.monthDollars}
              onChange={(e) => update({ monthDollars: e.target.value })}
            />
          </label>
          <label>
            Price per year (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.yearDollars}
              onChange={(e) => update({ yearDollars: e.target.value })}
            />
          </label>
        </div>

        {isEditing && (
          <p className="field-hint">
            Raising capacity provisions new units immediately. Lowering it never removes existing
            units, so real capacity never drops below what's already been rented out.
          </p>
        )}

        <div className="admin-form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/admin/lockers')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create offering'}
          </button>
        </div>
      </form>
    </div>
  );
}
