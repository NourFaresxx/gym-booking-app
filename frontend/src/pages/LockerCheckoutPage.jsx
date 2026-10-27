import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { rentLocker } from '../api/lockerBookings';
import StripeCheckoutForm from '../components/StripeCheckoutForm';
import ErrorMessage from '../components/ErrorMessage';
import { isStripeConfigured } from '../lib/stripe';
import { formatMoney } from '../lib/formatters';
import { useCountdown } from '../lib/useCountdown';

const TIER_LABELS = { day: '1 day', month: '1 month', year: '1 year' };

export default function LockerCheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { offeringId, tier, offeringName } = location.state || {};

  const [booking, setBooking] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [error, setError] = useState(null);
  const [succeeded, setSucceeded] = useState(false);

  // See CheckoutPage — same StrictMode double-effect guard, since rentLocker
  // claims a real unit.
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!offeringId || !tier || requestedRef.current) return;
    requestedRef.current = true;

    rentLocker({ offeringId, tier })
      .then((data) => {
        setBooking(data.booking);
        setClientSecret(data.clientSecret);
      })
      .catch(setError);
  }, [offeringId, tier]);

  const deadline = booking?.expiresAt ? new Date(booking.expiresAt).getTime() : null;
  const countdown = useCountdown(succeeded ? null : deadline);

  if (!offeringId || !tier) {
    return <Navigate to="/lockers" replace />;
  }

  if (succeeded) {
    return (
      <div className="page checkout-page">
        <div className="checkout-success">
          <h1>Payment submitted</h1>
          <p>
            Your {TIER_LABELS[tier]} rental of <strong>{offeringName || 'this locker'}</strong> is
            being confirmed. This usually takes just a few seconds once the payment finishes
            processing.
          </p>
          <Link to="/bookings" className="btn btn-primary">
            View my bookings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page checkout-page">
      <h1>Checkout</h1>
      <div className="checkout-summary">
        <div>
          <span className="checkout-summary-label">Locker</span>
          <span>{offeringName || '—'}</span>
        </div>
        <div>
          <span className="checkout-summary-label">Length</span>
          <span>{TIER_LABELS[tier]}</span>
        </div>
        {booking && (
          <div>
            <span className="checkout-summary-label">Total</span>
            <span>{formatMoney(booking.amount, booking.currency)}</span>
          </div>
        )}
      </div>

      {countdown && (
        <p className="checkout-countdown">
          Complete payment within <strong>{countdown}</strong> or this locker will be released.
        </p>
      )}

      <ErrorMessage error={error} />

      {error && (
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← Choose a different length
        </button>
      )}

      {!error && !isStripeConfigured && (
        <p className="error-message">
          Payments aren't configured on this deployment (missing VITE_STRIPE_PUBLISHABLE_KEY).
        </p>
      )}

      {!error && isStripeConfigured && !clientSecret && (
        <p className="page-loading">Preparing checkout…</p>
      )}

      {!error && isStripeConfigured && clientSecret && (
        <StripeCheckoutForm clientSecret={clientSecret} onSucceeded={() => setSucceeded(true)} />
      )}
    </div>
  );
}
