const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const AuditEvent = require('../models/AuditEvent');
const { upload, uploadDir, calculateFileHash } = require('../middleware/upload');
const { calculateExtractionValidation } = require('../validation');
const { runDetectionPipeline } = require('../detection');
const { recordAuditEvent, computeFieldDiffs } = require('../audit');
const { indexDocument } = require('../services/semanticSearchService');

/**
 * Helper to check authorization / permissions for accessing a document.
 * Ensures private documents belonging to another user cannot be accessed by unauthorized users.
 */
function checkDocumentAccess(req, document) {
  const userId = req.headers['x-user-id'] || req.query?.userId || null;
  const userRole = req.headers['x-user-role'] || req.query?.role || null;

  // Reviewer roles (officer, admin, inspector) have authorized access
  if (userRole === 'officer' || userRole === 'admin' || userRole === 'inspector') {
    return { allowed: true, userId, role: userRole };
  }

  // If document is marked private and has an owner
  if (document?.accessControl?.uploadedBy) {
    if (userId && document.accessControl.uploadedBy !== userId) {
      return { allowed: false, error: 'Access denied: You do not have authorization to view this document.' };
    }
    if (!userId && document.accessControl.isPrivate) {
      return { allowed: false, error: 'Authentication required to access this private document.' };
    }
  } else if (document?.accessControl?.isPrivate && !userId) {
    return { allowed: false, error: 'Authentication required to access this private document.' };
  }

  return { allowed: true, userId, role: userRole || 'user' };
}

/**
 * Helper middleware wrapper to cleanly handle Multer upload errors
 */
const handleUpload = (req, res, next) => {
  const uploadSingle = upload.single('file');
  uploadSingle(req, res, function(err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMb = process.env.MAX_FILE_SIZE_MB || 10;
        return res.status(400).json({
          error: `File exceeds maximum allowed upload size of ${maxMb} MB.`
        });
      }
      if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    next();
  });
};

/**
 * POST /api/documents
 * Upload document, calculate SHA-256 hash, and create MongoDB record with status 'Uploaded'
 */
router.post('/', handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No document file provided. Please attach a file.' });
  }

  let sha256Hash;
  try {
    sha256Hash = await calculateFileHash(req.file.path);
  } catch (hashErr) {
    // Clean up file if hashing fails
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(500).json({ error: 'Failed to compute SHA-256 hash for document.' });
  }

  try {
    const document = new Document({
      fileMetadata: {
        originalFilename: req.file.originalname,
        storedFilename: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        sha256Hash: sha256Hash,
        storagePath: req.file.path
      },
      status: 'Uploaded',
      landDetails: {}
    });

    const savedDoc = await document.save();

    await recordAuditEvent({
      documentId: savedDoc._id,
      action: 'DOCUMENT_UPLOADED',
      req,
      description: `Document '${req.file.originalname}' uploaded successfully.`,
      details: {
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        sha256Hash: sha256Hash
      },
      outcome: 'SUCCESS'
    });

    return res.status(201).json(savedDoc);
  } catch (dbErr) {
    // Clean up orphaned file on disk if database insertion fails
    await fs.promises.unlink(req.file.path).catch(unlinkErr => {
      console.error('Failed to remove orphaned file after DB error:', unlinkErr);
    });
    return res.status(500).json({
      error: 'Failed to save document metadata in database.',
      details: dbErr.message
    });
  }
});

/**
 * GET /api/documents
 * List all documents sorted newest first
 */
router.get('/', async (req, res) => {
  try {
    const documents = await Document.find().sort({ createdAt: -1 });
    return res.json(documents);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve documents from database.' });
  }
});

/**
 * GET /api/documents/:id
 * Retrieve a single document record by MongoDB ObjectId
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }
    return res.json(document);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve document record.' });
  }
});

/**
 * GET /api/documents/:id/file
 * Safely stream the stored document for inline browser preview (PDF/images)
 */
router.get('/:id/file', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    // Resolve filename strictly inside uploads directory to prevent path traversal
    const safeFilename = path.basename(document.fileMetadata.storedFilename);
    const resolvedPath = path.resolve(uploadDir, safeFilename);

    if (!resolvedPath.startsWith(uploadDir) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Document file not found on server disk.' });
    }

    res.setHeader('Content-Type', document.fileMetadata.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(document.fileMetadata.originalFilename)}"`
    );
    return res.sendFile(resolvedPath);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to serve document file.' });
  }
});

/**
 * POST /api/documents/:id/process
 * Triggers document processing through Python service (Google Gemini primary / local fallback)
 */
router.post('/:id/process', async (req, res) => {
  const { id } = req.params;
  const { engine = 'gemini', language = 'auto' } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  const document = await Document.findById(id);
  if (!document) {
    return res.status(404).json({ error: 'Document record not found.' });
  }

  // Resolve file path safely
  const safeFilename = path.basename(document.fileMetadata.storedFilename);
  const resolvedPath = path.resolve(uploadDir, safeFilename);

  if (!resolvedPath.startsWith(uploadDir) || !fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Physical document file not found on server disk.' });
  }

  const previousStatus = document.status;

  // Step 4: Mark record as Processing
  document.status = 'Processing';
  await document.save();

  try {
    const fileBuffer = await fs.promises.readFile(resolvedPath);
    const blob = new Blob([fileBuffer], { type: document.fileMetadata.mimeType });
    const formData = new FormData();
    formData.append('file', blob, document.fileMetadata.originalFilename);
    formData.append('engine', engine);
    formData.append('language', language);

    const pythonServiceUrl = process.env.PYTHON_OCR_SERVICE_URL || 'http://127.0.0.1:8000';
    const pyResponse = await fetch(`${pythonServiceUrl}/process`, {
      method: 'POST',
      body: formData
    });

    const pyData = await pyResponse.json();

    if (!pyResponse.ok) {
      throw new Error(pyData.detail || pyData.error || `OCR service responded with HTTP ${pyResponse.status}`);
    }

    // Update MongoDB document with extracted data and mark Needs review
    document.status = 'Needs review';
    document.ocrResult = pyData.ocrResult;
    document.landDetails = pyData.landDetails;
    document.extractionValidation = calculateExtractionValidation(
      pyData.landDetails,
      pyData.ocrResult
    );

    // Phase 4: Run Duplicate & Cross-Record Conflict Detection
    try {
      const detectionResults = await runDetectionPipeline(Document, document);
      document.duplicateDetection = detectionResults.duplicateDetection;
      document.conflictDetection = detectionResults.conflictDetection;
    } catch (detectErr) {
      console.error(`[Detection Pipeline Warning on doc ${id}]:`, detectErr.message);
    }

    await document.save();

    await recordAuditEvent({
      documentId: document._id,
      action: 'OCR_PROCESSING_COMPLETED',
      req,
      description: `Extraction and OCR processing completed with engine '${engine}'.`,
      details: {
        engine,
        language,
        extractedFieldsCount: Object.keys(pyData.landDetails || {}).length,
        validationScore: document.extractionValidation?.overallScore
      },
      outcome: 'SUCCESS'
    });

    // Automatic background semantic indexing (non-blocking, safe)
    if (mongoose.connection.readyState === 1) {
      indexDocument(document._id).catch(idxErr => {
        console.warn(`[Background Semantic Indexing Warning on doc ${id}]:`, idxErr.message);
      });
    }

    return res.json(document);

  } catch (err) {
    console.error(`[OCR Processing Error on doc ${id}]:`, err.message);
    // Never leave record stuck in 'Processing' on failure
    document.status = previousStatus === 'Processing' ? 'Uploaded' : previousStatus;
    if (!document.ocrResult) document.ocrResult = {};
    document.ocrResult.error = err.message;
    await document.save();

    await recordAuditEvent({
      documentId: document._id,
      action: 'OCR_PROCESSING_FAILED',
      req,
      description: `OCR processing failed: ${err.message}`,
      details: {
        engine,
        language
      },
      outcome: 'FAILURE',
      errorMessage: err.message
    });

    return res.status(502).json({
      error: `Document processing failed: ${err.message}`,
      status: document.status
    });
  }
});

/**
 * GET /api/documents/:id/conflicts
 * Retrieve duplicate candidates and cross-record conflicts for a document.
 * Enforces authorization: private documents are protected from unauthorized access.
 */
router.get('/:id/conflicts', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const access = checkDocumentAccess(req, document);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    // If never analyzed or refresh requested, run detection pipeline
    if (req.query.refresh === 'true' || !document.duplicateDetection?.lastAnalyzedAt) {
      const detectionResults = await runDetectionPipeline(Document, document, {
        userId: access.userId,
        role: access.role
      });
      document.duplicateDetection = detectionResults.duplicateDetection;
      document.conflictDetection = detectionResults.conflictDetection;
      await document.save();
    }

    return res.json({
      documentId: document._id,
      duplicateDetection: document.duplicateDetection,
      conflictDetection: document.conflictDetection
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to retrieve conflict and duplicate analysis.',
      details: err.message
    });
  }
});

/**
 * POST /api/documents/:id/conflicts/analyze
 * Manually trigger fresh cross-record duplicate and conflict detection.
 */
router.post('/:id/conflicts/analyze', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const access = checkDocumentAccess(req, document);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    const detectionResults = await runDetectionPipeline(Document, document, {
      userId: access.userId,
      role: access.role
    });

    document.duplicateDetection = detectionResults.duplicateDetection;
    document.conflictDetection = detectionResults.conflictDetection;
    await document.save();

    await recordAuditEvent({
      documentId: document._id,
      action: 'CONFLICT_DETECTION_ANALYZED',
      req,
      description: 'Manual cross-record duplicate and conflict detection triggered.',
      details: {
        duplicateCandidateCount: document.duplicateDetection?.candidateCount || 0,
        conflictCount: document.conflictDetection?.totalConflictCount || 0
      },
      outcome: 'SUCCESS'
    });

    return res.json({
      documentId: document._id,
      duplicateDetection: document.duplicateDetection,
      conflictDetection: document.conflictDetection
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to analyze document for conflicts and duplicates.',
      details: err.message
    });
  }
});

/**
 * PATCH /api/documents/:id
 * Update document fields (landDetails) and/or status.
 * Enforces authorization, calculates field diffs, recalculates extraction score,
 * and writes immutable audit events.
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const access = checkDocumentAccess(req, document);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    const { landDetails, status } = req.body || {};
    let modified = false;

    // 1. Check for landDetails updates and compute diffs
    if (landDetails && typeof landDetails === 'object') {
      const oldDetails = document.landDetails ? JSON.parse(JSON.stringify(document.landDetails)) : {};
      const diffs = computeFieldDiffs(oldDetails, landDetails);

      if (diffs.length > 0) {
        document.landDetails = landDetails;
        modified = true;

        // Recalculate extraction validation
        document.extractionValidation = calculateExtractionValidation(
          document.landDetails,
          document.ocrResult
        );

        await recordAuditEvent({
          documentId: document._id,
          action: 'FIELD_EDITS_SAVED',
          req,
          description: `Updated ${diffs.length} land detail field${diffs.length > 1 ? 's' : ''}.`,
          details: { diffs },
          outcome: 'SUCCESS'
        });
      }
    }

    // 2. Check for status updates (e.g., 'Verified', 'Needs review', 'Rejected')
    if (status && status !== document.status) {
      const previousStatus = document.status;
      document.status = status;
      modified = true;

      await recordAuditEvent({
        documentId: document._id,
        action: 'STATUS_UPDATED',
        req,
        description: `Document review status transitioned from '${previousStatus}' to '${status}'.`,
        details: { previousStatus, newStatus: status },
        outcome: 'SUCCESS'
      });
    }

    if (modified) {
      await document.save();
      // Automatic background semantic indexing on field/status updates (non-blocking, safe)
      if (mongoose.connection.readyState === 1) {
        indexDocument(document._id).catch(idxErr => {
          console.warn(`[Background Semantic Indexing Warning on doc ${id}]:`, idxErr.message);
        });
      }
    }

    return res.json(document);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to update document.',
      details: err.message
    });
  }
});

/**
 * GET /api/documents/:id/audit
 * Retrieve immutable audit history for a document.
 * Returns events in chronological order (or reverse chronological if ?sort=desc).
 * Supports pagination (?page=1&limit=20).
 * Enforces authorization checks to prevent reading private document history.
 */
router.get('/:id/audit', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const access = checkDocumentAccess(req, document);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    // Default to chronological order (asc = oldest first) as specified in requirements, or desc if requested
    const sortOrder = req.query.sort === 'desc' ? -1 : 1;
    const skip = (page - 1) * limit;

    const totalEvents = await AuditEvent.countDocuments({ documentId: id });
    const events = await AuditEvent.find({ documentId: id })
      .sort({ timestamp: sortOrder })
      .skip(skip)
      .limit(limit);

    return res.json({
      documentId: id,
      page,
      limit,
      totalEvents,
      totalPages: Math.ceil(totalEvents / limit) || 1,
      sort: sortOrder === 1 ? 'asc' : 'desc',
      events
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to retrieve document audit trail.',
      details: err.message
    });
  }
});
/**
 * POST /api/documents/:id/verify-integrity
 * Verifies cryptographic SHA-256 integrity of the physical document on server disk
 * against the stored immutable hash recorded at upload time.
 * Enforces document access-control authorization.
 * Never overwrites or mutates the original sha256Hash in MongoDB.
 * Records an immutable AuditEvent with outcome and verification details.
 */
router.post('/:id/verify-integrity', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const access = checkDocumentAccess(req, document);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    // Resolve stored physical file path safely inside uploads directory
    const safeFilename = path.basename(document.fileMetadata.storedFilename);
    const resolvedPath = path.resolve(uploadDir, safeFilename);

    if (!resolvedPath.startsWith(uploadDir) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Stored document file not found on server disk.' });
    }

    // Recalculate physical file SHA-256 hash from disk
    const calculatedHash = await calculateFileHash(resolvedPath);
    const storedHash = document.fileMetadata.sha256Hash;
    const isIntact = (calculatedHash === storedHash);

    // CRITICAL: The original document.fileMetadata.sha256Hash is NEVER overwritten or mutated!

    // Record immutable audit event
    await recordAuditEvent({
      documentId: document._id,
      action: 'INTEGRITY_VERIFIED',
      req,
      description: isIntact
        ? 'SHA-256 document cryptographic integrity verification passed: file on disk matches upload hash.'
        : 'CRITICAL ALERT: SHA-256 document cryptographic integrity verification failed! File on disk does not match upload hash.',
      details: {
        storedHash,
        calculatedHash,
        isIntact,
        originalFilename: document.fileMetadata.originalFilename
      },
      outcome: isIntact ? 'SUCCESS' : 'FAILURE'
    });

    return res.json({
      documentId: document._id,
      filename: document.fileMetadata.originalFilename,
      storedHash,
      calculatedHash,
      isIntact,
      verifiedAt: new Date().toISOString(),
      message: isIntact
        ? 'Document integrity verified: File is authentic and unaltered.'
        : 'Integrity check failed: File hash mismatch detected. Potential file tampering or corruption.'
    });
  } catch (err) {
    console.error(`[Integrity Verification Error on doc ${id}]:`, err.message);
    return res.status(500).json({
      error: 'Failed to verify document integrity.',
      details: err.message
    });
  }
});

/**
 * GET /api/documents/:id/verify-integrity
 * Idempotent GET variant of integrity check.
 */
router.get('/:id/verify-integrity', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const access = checkDocumentAccess(req, document);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    const safeFilename = path.basename(document.fileMetadata.storedFilename);
    const resolvedPath = path.resolve(uploadDir, safeFilename);

    if (!resolvedPath.startsWith(uploadDir) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Stored document file not found on server disk.' });
    }

    const calculatedHash = await calculateFileHash(resolvedPath);
    const storedHash = document.fileMetadata.sha256Hash;
    const isIntact = (calculatedHash === storedHash);

    return res.json({
      documentId: document._id,
      filename: document.fileMetadata.originalFilename,
      storedHash,
      calculatedHash,
      isIntact,
      verifiedAt: new Date().toISOString(),
      message: isIntact
        ? 'Document integrity verified: File is authentic and unaltered.'
        : 'Integrity check failed: File hash mismatch detected.'
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to verify document integrity.',
      details: err.message
    });
  }
});

module.exports = router;
