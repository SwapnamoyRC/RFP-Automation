const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/error-handler');
const { authenticate } = require('./middleware/auth');

const authRoutes = require('./routes/auth.routes');
const healthRoutes = require('./routes/health.routes');
const scraperRoutes = require('./routes/scraper.routes');
const searchRoutes = require('./routes/search.routes');
const productsRoutes = require('./routes/products.routes');
const syncRoutes = require('./routes/sync.routes');
const pdfRoutes = require('./routes/pdf.routes');
const rfpRoutes = require('./routes/rfp.routes');
const sessionRoutes = require('./routes/session.routes');
const matchRoutes = require('./routes/match.routes');
const catalogRoutes = require('./routes/catalog.routes');

const app = express();

// Middleware
app.use(helmet());

// CORS — restrict to allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 3600,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting — strict for auth, relaxed for general API
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 min
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes (no auth required)
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/health', healthRoutes);

// Protected routes (JWT required + general rate limit)
app.use('/api/scrape', authenticate, apiLimiter, scraperRoutes);
app.use('/api/search', authenticate, apiLimiter, searchRoutes);
app.use('/api/products', authenticate, apiLimiter, productsRoutes);
app.use('/api/sync', authenticate, apiLimiter, syncRoutes);
app.use('/api/extract-pdf', authenticate, apiLimiter, pdfRoutes);
app.use('/api/rfp', authenticate, apiLimiter, rfpRoutes);
app.use('/api/sessions', authenticate, apiLimiter, sessionRoutes);
app.use('/api/match', authenticate, apiLimiter, matchRoutes);
app.use('/api/catalog', authenticate, apiLimiter, catalogRoutes);

// Serve uploaded images statically
app.use('/uploads', express.static(require('path').join(process.cwd(), 'uploads')));

// Error handler
app.use(errorHandler);

module.exports = app;
