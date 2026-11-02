const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const documentRoutes = require('./routes/documents');
const searchRoutes = require('./routes/search');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');
const { ensureBootstrapAdmin } = require('./services/auth');
const { csrfProtection, getAllowedOrigins } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';

// Middleware
const allowedOrigins = getAllowedOrigins();
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  credentials: true
}));
app.use(csrfProtection);
app.use(express.json());

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log(`[DigiBhoomi Database] Connected successfully to MongoDB at ${MONGODB_URI}`);
    try {
      const admin = await ensureBootstrapAdmin();
      if (admin) console.log('[DigiBhoomi Auth] Bootstrap administrator ready.');
    } catch (err) {
      console.error('[DigiBhoomi Auth] Bootstrap administrator setup failed:', err.message);
    }
  })
  .catch((err) => {
    console.error(`[DigiBhoomi Database] MongoDB connection error:`, err.message);
  });

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'DigiBhoomi Backend',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit', auditRoutes);

// Mount Document API Routes
app.use('/api/documents', documentRoutes);

// Mount Semantic Search API Routes
app.use('/api/search', searchRoutes);

// Global 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  console.log(`[DigiBhoomi Server] Running on http://localhost:${PORT}`);
});
