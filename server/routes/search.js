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

// =========================================================================
// RBAC INTEGRATION HOOK POINT:
// When integrating with the separate checkout containing verified RBAC:
// 1. Mount the verified authentication middleware on the search router:
//    router.use(verifyAuthToken);
// 2. The middleware must populate `req.user = { id, role, assignedDocuments, ... }`.
// 3. `extractActor(req)` below automatically uses `req.user` as the authoritative source
//    and ignores client-supplied headers.
// =========================================================================

/**
 * Extracts actor credentials from verified authentication context.
 * Prioritizes backend-verified `req.user` populated by auth middleware.
 * In production, never trusts unverified client headers.
 * In development/test mode, allows simulated role headers for testing only when req.user is absent.
 */
function extractActor(req) {
  // 1. Authoritative: Use verified session/token user populated by backend auth middleware
  if (req.user) {
    return {
      userId: req.user.id || req.user._id || req.user.userId || null,
      role: req.user.role || 'user',
      isVerified: true,
      assignedDocuments: req.user.assignedDocuments || []
    };
  }

  // Check if req.actor was already set by upstream verified middleware
  if (req.actor && req.actor.isVerified) {
    return req.actor;
  }

  // 2. Unauthenticated / development simulation handling
  const isProduction = process.env.NODE_ENV === 'production';
  const clientUserId = req.headers['x-user-id'] || req.query?.userId || null;
  const clientRole = req.headers['x-user-role'] || req.query?.role || null;

  if (isProduction) {
    // In production, NEVER trust client-supplied headers without verified auth
    return {
      userId: null,
      role: 'user',
      isVerified: false,
      assignedDocuments: []
    };
  }

  // In test/development environment without auth middleware installed:
  // Allow simulation for UI testing, but flag as unverified
  return {
    userId: clientUserId,
    role: clientRole || 'user',
    isVerified: false,
    assignedDocuments: []
  };
}

/**
 * Middleware: Restricts administrative indexing endpoints to authorized reviewer roles
 * (Revenue Officer, Admin, Inspector).
 */
function requireReviewerAuth(req, res, next) {
  const actor = extractActor(req);

  // If in production without verified authentication, reject immediately
  if (process.env.NODE_ENV === 'production' && !actor.isVerified) {
    return res.status(401).json({
      error: 'Authentication required: Verified reviewer or administrator credentials required.'
    });
  }

  if (actor.role !== 'officer' && actor.role !== 'admin' && actor.role !== 'inspector') {
    return res.status(403).json({
      error: 'Access denied: Indexing operations are restricted to authorized reviewers or administrators.'
    });
  }
  req.actor = actor;
  next();
}

/**
 * POST /api/search/semantic
 * Executes natural language semantic search across indexed land records.
 * Enforces ownership and visibility authorization on each result.
 */
router.post('/semantic', async (req, res) => {
  try {
    const { query, limit = 10 } = req.body || {};
    const actor = extractActor(req);

    const searchOutput = await searchSemantic({
      query,
      limit,
      actor
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
 * Restricts access to authorized reviewer roles.
 */
router.post('/index/:id', requireReviewerAuth, async (req, res) => {
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
 * Restricts access to authorized reviewer roles.
 */
router.post('/backfill', requireReviewerAuth, async (req, res) => {
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
