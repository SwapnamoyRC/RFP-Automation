const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const errorHandler = require('./middleware/error-handler');

const healthRoutes = require('./routes/health.routes');
const scraperRoutes = require('./routes/scraper.routes');
const searchRoutes = require('./routes/search.routes');
const productsRoutes = require('./routes/products.routes');
const syncRoutes = require('./routes/sync.routes');
const pdfRoutes = require('./routes/pdf.routes');
const rfpRoutes = require('./routes/rfp.routes');
const sessionRoutes = require('./routes/session.routes');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Debug: log all session requests
app.use('/api/sessions', (req, res, next) => {
  console.log(`[DEBUG ${req.method}] ${req.url} Body:`, req.method === 'GET' ? '-' : JSON.stringify(req.body));
  next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/scrape', scraperRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/extract-pdf', pdfRoutes);
app.use('/api/rfp', rfpRoutes);
app.use('/api/sessions', sessionRoutes);

// Error handler
app.use(errorHandler);

module.exports = app;
