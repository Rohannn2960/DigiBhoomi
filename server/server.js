const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const documentRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log(`[DigiBhoomi Database] Connected successfully to MongoDB at ${MONGODB_URI}`);
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

// Mount Document API Routes
app.use('/api/documents', documentRoutes);

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
