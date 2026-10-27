import { Link } from 'react-router-dom';
import { formatMoney } from '../lib/formatters';

export default function LockerOfferingCard({ offering }) {
  return (
    <Link to={`/lockers/${offering._id}`} className="resource-card">
      <h3>{offering.name}</h3>
      {offering.description && <p className="resource-card-desc">{offering.description}</p>}
      <dl className="resource-card-meta">
        <div>
          <dt>Day</dt>
          <dd>{formatMoney(offering.pricing.day, offering.currency)}</dd>
        </div>
        <div>
          <dt>Month</dt>
          <dd>{formatMoney(offering.pricing.month, offering.currency)}</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd>{formatMoney(offering.pricing.year, offering.currency)}</dd>
        </div>
      </dl>
      <p className="locker-card-availability">
        {offering.availableNow > 0
          ? `${offering.availableNow} available now`
          : 'Fully booked right now'}
      </p>
    </Link>
  );
}
