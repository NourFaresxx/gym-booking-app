import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { createBooking } from '../api/bookings';
import StripeCheckoutForm from '../components/StripeCheckoutForm';
import ErrorMessage from '../components/ErrorMessage';
import { isStripeConfigured } from '../lib/stripe';
import { formatDateTime, formatMoney } from '../lib/formatters';
import { useCountdown } from '../lib/useCountdown';

export default function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resourceId, slotStart, resourceName } = location.state || {};

  const [booking, setBooking] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [error, setError] = useState(null);
  const [succeeded, setSucceeded] = useState(false);

  // React 18's StrictMode runs effects twice in development; without this
  // guard that would call createBooking — which reserves a real seat —
  // twice for one page visit.
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!resourceId || !slotStart || requestedRef.current) return;
    requestedRef.current = true;

    createBooking({ resourceId, slotStart })
      .then((data) => {
        setBooking(data.booking);
        setClientSecret(data.clientSecret);
      })
      .catch(setError);
  }, [resourceId, slotStart]);

  const deadline = booking?.expiresAt ? new Date(booking.expiresAt).getTime() : null;
  const countdown = useCountdown(succeeded ? null : deadline);

  if (!resourceId || !slotStart) {
    return <Navigate to="/" replace />;
  }

  if (succeeded) {
    return (
      <div className="page checkout-page">
        <div className="checkout-success">
          <h1>Payment submitted</h1>
          <p>
            Your booking for <strong>{resourceName || 'this resource'}</strong> at{' '}
            <strong>{formatDateTime(slotStart)}</strong> is being confirmed. This usually takes just a
            few seconds once the payment finishes processing.
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
          <span className="checkout-summary-label">Resource</span>
          <span>{resourceName || '—'}</span>
        </div>
        <div>
          <span className="checkout-summary-label">Time</span>
          <span>{formatDateTime(slotStart)}</span>
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
          Complete payment within <strong>{countdown}</strong> or this seat will be released.
        </p>
      )}

      <ErrorMessage error={error} />

      {error && (
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← Choose a different slot
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
