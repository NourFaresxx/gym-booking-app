const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const authRoutes = require('./routes/authRoutes');
const resourceRoutes = require('./routes/resourceRoutes');
const trainerRoutes = require('./routes/trainerRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const lockerRoutes = require('./routes/lockerRoutes');
const lockerBookingRoutes = require('./routes/lockerBookingRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Needed for express-rate-limit to read the real client IP behind a proxy
// (Render, Railway, nginx). Without it every request looks like it comes from
// the proxy and one noisy client can rate-limit everyone.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

app.use(helmet());
app.use(cors(corsOptions()));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Stripe signs the raw request bytes, so this must be mounted BEFORE
// express.json() and only for this one route — a parsed-then-restringified
// body would not match the signature.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: '100kb' }));

// Blanket ceiling on API traffic. The auth routes add their own tighter
// limits on top of this.
if (process.env.NODE_ENV !== 'test') {
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: Number(process.env.GLOBAL_RATE_LIMIT || 1000),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please slow down' },
    })
  );
}

/**
 * Liveness plus a real dependency check, so an orchestrator can tell "process
 * is up" from "process is up but can't reach its database".
 */
app.get('/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  const healthy = mongoose.connection.readyState === 1;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db: dbState,
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/openapi.json', (req, res) => res.json(swaggerSpec));

app.use('/api/auth', authRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/trainers', trainerRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/lockers', lockerRoutes);
app.use('/api/locker-bookings', lockerBookingRoutes);
app.use('/api/analytics', analyticsRoutes);

app.use(notFound);
app.use(errorHandler);

/**
 * Allows a comma-separated CLIENT_URL list. With no origin configured, CORS is
 * left off rather than opened to `*` — a credentialed API shouldn't default to
 * accepting browser requests from anywhere.
 */
function corsOptions() {
  const configured = (process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length === 0) return { origin: false };

  return {
    origin: (origin, callback) => {
      // No Origin header: same-origin, curl, or a server-to-server call.
      if (!origin || configured.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  };
}

module.exports = app;
