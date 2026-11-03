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

// Connect to MongoDB with automatic fallback to embedded in-memory MongoDB for local dev
async function initializeDatabase() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2500 });
    console.log(`[DigiBhoomi Database] Connected successfully to MongoDB at ${MONGODB_URI}`);
  } catch (err) {
    console.warn(`[DigiBhoomi Database] Direct connection to ${MONGODB_URI} failed (${err.code || err.message}).`);
    if (MONGODB_URI.includes('localhost') || MONGODB_URI.includes('127.0.0.1')) {
      try {
        console.log('[DigiBhoomi Database] Starting embedded MongoDB service...');
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongod = await MongoMemoryServer.create();
        const memUri = mongod.getUri();
        await mongoose.connect(memUri);
        console.log(`[DigiBhoomi Database] Connected successfully to embedded MongoDB at ${memUri}`);
      } catch (memErr) {
        console.error('[DigiBhoomi Database] Failed to initialize embedded MongoDB:', memErr.message);
      }
    }
  }

  if (mongoose.connection.readyState === 1) {
    try {
      const admin = await ensureBootstrapAdmin();
      if (admin) console.log(`[DigiBhoomi Auth] Bootstrap administrator ready (${admin.email}).`);
    } catch (adminErr) {
      console.error('[DigiBhoomi Auth] Bootstrap administrator setup failed:', adminErr.message);
    }
  }
}

initializeDatabase();

// Database connection guard
app.use((req, res, next) => {
  if (req.path === '/api/health') return next();
  if (req.path.startsWith('/api') && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: 'Database connection unavailable. MongoDB is not running or still initializing.',
      database: 'disconnected'
    });
  }
  next();
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
