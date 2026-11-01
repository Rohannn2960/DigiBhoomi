const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const {
  searchSemantic,
  indexDocument,
  backfillAllDocuments,
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_DIMENSIONS
} = require('../services/semanticSearchService');
const SemanticEmbedding = require('../models/SemanticEmbedding');
const { authenticate, requireRole } = require('../middleware/auth');

/**
 * Require authentication on all semantic search routes.
 * Derives the actor exclusively from authenticated req.user.
 * Client-supplied headers, query parameters, or body properties are NEVER trusted.
 */
router.use(authenticate);

/**
 * POST /api/search/semantic
 * Executes natural language semantic search across indexed land records.
 * Enforces ownership and visibility authorization on each result.
 */
router.post('/semantic', async (req, res) => {
  try {
    const { query, limit = 10 } = req.body || {};

    const searchOutput = await searchSemantic({
      query,
      limit,
      actor: req.user
    });

    return res.json(searchOutput);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[Semantic Search Error]:', err);
    return res.status(500).json({
      error: 'Semantic search query processing failed.',
      details: err.message
    });
  }
});

/**
 * POST /api/search/index/:id
 * Indexes or updates the vector embedding for a specific document.
 * Strictly restricted to Admins.
 */
router.post('/index/:id', requireRole('Admin'), async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const result = await indexDocument(id, {
      force: req.body?.force === true
    });

    return res.json({
      message: result.skipped
        ? 'Document content unchanged; embedding index preserved.'
        : 'Document indexed successfully.',
      ...result
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    if (err.statusCode === 404 || err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error(`[Index Document Error on ${id}]:`, err);
    return res.status(500).json({
      error: 'Failed to index document.',
      details: err.message
    });
  }
});

/**
 * POST /api/search/backfill
 * Re-indexes all existing documents in the database.
 * Strictly restricted to Admins.
 */
router.post('/backfill', requireRole('Admin'), async (req, res) => {
  try {
    const force = req.body?.force === true;
    const summary = await backfillAllDocuments({ force });

    return res.json({
      message: 'Backfill indexing completed.',
      summary
    });
  } catch (err) {
    console.error('[Backfill Indexing Error]:', err);
    return res.status(500).json({
      error: 'Backfill indexing failed.',
      details: err.message
    });
  }
});

/**
 * GET /api/search/status
 * Reports semantic search index statistics and model status.
 * Protected by authentication.
 */
router.get('/status', async (req, res) => {
  try {
    const totalIndexed = await SemanticEmbedding.countDocuments({
      model: CURRENT_EMBEDDING_MODEL,
      dimensions: CURRENT_EMBEDDING_DIMENSIONS
    });
    const totalLegacy = await SemanticEmbedding.countDocuments({
      $or: [
        { model: { $ne: CURRENT_EMBEDDING_MODEL } },
        { dimensions: { $ne: CURRENT_EMBEDDING_DIMENSIONS } },
        { model: { $exists: false } }
      ]
    });
    return res.json({
      service: 'DigiBhoomi Semantic Search',
      model: `${CURRENT_EMBEDDING_MODEL} (CPU)`,
      dimensions: CURRENT_EMBEDDING_DIMENSIONS,
      totalIndexed,
      totalLegacy,
      needsMigration: totalLegacy > 0,
      status: 'ready'
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to retrieve search status.',
      details: err.message
    });
  }
});

module.exports = router;
