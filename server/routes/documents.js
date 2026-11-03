const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const AuditEvent = require('../models/AuditEvent');
const User = require('../models/User');
const DocumentVersion = require('../models/DocumentVersion');
const OwnershipHistory = require('../models/OwnershipHistory');
const { upload, uploadDir, calculateFileHash } = require('../middleware/upload');
const { calculateExtractionValidation } = require('../validation');
const { runDetectionPipeline } = require('../detection');
const { recordAuditEvent: recordDocumentAudit, computeFieldDiffs } = require('../audit');
const { recordAuditEvent } = require('../services/audit');
const { indexDocument } = require('../services/semanticSearchService');
const { authenticate, findAuthorizedDocument, hasDocumentAccess, requireRole } = require('../middleware/auth');
const {
  createInitialVersion,
  recordDocumentVersion,
  extractSnapshot,
  compareVersions
} = require('../services/versionService');
const { transferOwnership } = require('../services/ownershipService');

const HASH_ALGORITHM = 'SHA-256';

/**
 * Helper to check authorization / permissions for accessing a document.
 * Authoritative: Evaluates real RBAC access based on authenticated req.user.
 */
function checkDocumentAccess(req, document) {
  if (!req.user) {
    return { allowed: false, error: 'Authentication required to access this document.' };
  }
  const allowed = hasDocumentAccess(document, req.user);
  if (!allowed) {
    return { allowed: false, error: 'Access denied: You do not have authorization to view this document.' };
  }
  return { allowed: true, userId: req.user._id.toString(), role: req.user.role };
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

router.use(authenticate);

/**
 * POST /api/documents
 * Upload document, calculate SHA-256 hash, and create MongoDB record with status 'Uploaded'
 */
router.post('/', requireRole('Citizen', 'Admin'), handleUpload, async (req, res) => {
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
        hashAlgorithm: HASH_ALGORITHM,
        storagePath: req.file.path
      },
      ownerId: req.user._id,
      status: 'Uploaded',
      landDetails: {}
    });

    const savedDoc = await document.save();
    await recordDocumentAudit({
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

    try {
      await recordAuditEvent({
        actorId: req.user._id,
        action: 'DOCUMENT_HASH_GENERATED',
        resourceType: 'DOCUMENT',
        resourceId: savedDoc._id.toString(),
        documentId: savedDoc._id,
        description: `SHA-256 hash computed on upload: ${sha256Hash}`,
        outcome: 'SUCCESS',
        metadata: { hashAlgorithm: HASH_ALGORITHM, sha256Hash, role: req.user.role }
      });
      await createInitialVersion(savedDoc, req.user);
    } catch (auditError) {
      await Document.deleteOne({ _id: savedDoc._id });
      throw auditError;
    }
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
    const officerIdStr = req.user._id.toString();
    const scope = req.user.role === 'Admin'
      ? {}
      : req.user.role === 'Officer'
        ? {
            $or: [
              { assignedOfficerId: req.user._id },
              { assignedOfficer: officerIdStr },
              { assignedTo: officerIdStr }
            ]
          }
        : {
            $or: [
              { ownerId: req.user._id },
              { 'accessControl.uploadedBy': req.user._id.toString() }
            ]
          };
    const documents = await Document.find(scope).sort({ createdAt: -1 });
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
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }
    return res.json(document);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve document record.' });
  }
});

/**
 * PATCH /api/documents/:id/review
 * Assigned officers may correct extracted values and approve or reject a record
 */
router.patch('/:id/review', requireRole('Officer', 'Admin'), async (req, res, next) => {
  const { id } = req.params;
  const { action, decision, remarks = '', landDetails = {} } = req.body || {};
  const reviewAction = action || decision;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }
  if (!['save', 'approve', 'reject'].includes(reviewAction) || typeof remarks !== 'string' || remarks.length > 2000) {
    return res.status(400).json({ error: 'Provide a save/approve/reject action and remarks no longer than 2000 characters.' });
  }
  if (!landDetails || typeof landDetails !== 'object' || Array.isArray(landDetails)) {
    return res.status(400).json({ error: 'Review fields must be an object.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) return res.status(404).json({ error: 'Document record not found.' });
    if (document.status !== 'Needs review') {
      return res.status(409).json({ error: 'Only documents awaiting review can be approved or rejected.' });
    }

    const previousSnapshot = extractSnapshot(document);

    const allowedFields = new Set([
      'ownerName', 'surveyNumber', 'khasraNumber', 'khataNumber', 'area', 'areaUnit',
      'landArea', 'village', 'tehsil', 'district', 'landClassification'
    ]);
    for (const [field, values] of Object.entries(landDetails)) {
      if (!allowedFields.has(field) || !values || typeof values !== 'object' || Array.isArray(values)) {
        return res.status(400).json({ error: `Invalid review field: ${field}.` });
      }
      if (Object.hasOwn(values, 'value')) {
        if (typeof values.value !== 'string' || values.value.length > 1000) {
          return res.status(400).json({ error: `Invalid value for review field: ${field}.` });
        }
        document.set(`landDetails.${field}.value`, values.value);
        document.set(`landDetails.${field}.reviewStatus`, 'Corrected');
      }
      if (field === 'landArea' && Object.hasOwn(values, 'unit')) {
        if (typeof values.unit !== 'string' || values.unit.length > 40) {
          return res.status(400).json({ error: 'Invalid land-area unit.' });
        }
        document.set('landDetails.landArea.unit', values.unit);
      }
    }

    document.reviewRemarks = remarks.trim();
    if (reviewAction !== 'save') {
      document.status = reviewAction === 'approve' ? 'Verified' : 'Rejected';
      document.reviewedBy = req.user._id;
      document.reviewedAt = new Date();
    }
    await document.save();
    await recordAuditEvent({
      actorId: req.user._id,
      action: reviewAction === 'save'
        ? 'DOCUMENT_REVIEW_DRAFT_SAVED'
        : reviewAction === 'approve' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
      resourceType: 'DOCUMENT',
      resourceId: document._id.toString(),
      documentId: document._id,
      description: reviewAction === 'save'
        ? 'Document review draft saved.'
        : reviewAction === 'approve'
          ? 'Document verified and approved by officer.'
          : 'Document rejected during officer review.',
      outcome: 'SUCCESS',
      metadata: { status: document.status, action: reviewAction, remarks, role: req.user.role }
    });

    await recordDocumentVersion(document, {
      user: req.user,
      changeType: 'REVIEW_DECISION',
      changeReason: remarks ? `Review decision (${reviewAction}): ${remarks}` : `Review decision: ${reviewAction}`,
      previousSnapshot
    });

    return res.json(document);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/assignment', requireRole('Admin'), async (req, res, next) => {
  const { id } = req.params;
  const { assignedOfficerId } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(id) ||
      (assignedOfficerId !== null && !mongoose.Types.ObjectId.isValid(assignedOfficerId))) {
    return res.status(400).json({ error: 'Invalid document or officer ID.' });
  }

  try {
    const document = await Document.findById(id);
    if (!document) return res.status(404).json({ error: 'Document record not found.' });
    let officer = null;
    if (assignedOfficerId !== null) {
      officer = await User.findOne({ _id: assignedOfficerId, role: 'Officer', isActive: true });
      if (!officer) return res.status(400).json({ error: 'Assignment target must be an active officer.' });
    }

    const previousOfficerId = document.assignedOfficerId?.toString() || null;
    document.assignedOfficerId = officer?._id || null;
    await document.save();
    await recordAuditEvent({
      actorId: req.user._id,
      action: 'DOCUMENT_ASSIGNMENT_CHANGED',
      resourceType: 'DOCUMENT',
      resourceId: document._id.toString(),
      documentId: document._id,
      description: officer
        ? `Document assigned to officer ${officer.displayName} (${officer.email}).`
        : 'Document unassigned.',
      outcome: 'SUCCESS',
      metadata: { previousOfficerId, assignedOfficerId: officer?._id.toString() || null, role: req.user.role }
    });
    return res.json({ documentId: document._id, assignedOfficerId: document.assignedOfficerId });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/documents/:id/integrity
 * Compare the stored SHA-256 with a fresh hash of the stored original file
 */
router.get('/:id/integrity', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const storedHash = document.fileMetadata?.sha256Hash || null;
    const hashAlgorithm = document.fileMetadata?.hashAlgorithm || HASH_ALGORITHM;
    const storedFilename = document.fileMetadata?.storedFilename;
    let calculatedHash = null;

    if (typeof storedFilename === 'string' && storedFilename.length > 0) {
      const safeFilename = path.basename(storedFilename);
      const resolvedPath = path.resolve(uploadDir, safeFilename);
      const relativePath = path.relative(uploadDir, resolvedPath);
      const isInsideUploadDir = relativePath &&
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath);

      if (isInsideUploadDir) {
        try {
          const stats = await fs.promises.stat(resolvedPath);
          if (stats.isFile()) {
            calculatedHash = await calculateFileHash(resolvedPath);
          }
        } catch (fileError) {
          console.warn(`[Integrity] Unable to read stored file for ${id}: ${fileError.code || 'read error'}`);
        }
      }
    }

    const hasValidStoredHash = typeof storedHash === 'string' && /^[a-f\d]{64}$/i.test(storedHash);
    const status = !calculatedHash || !hasValidStoredHash || hashAlgorithm !== HASH_ALGORITHM
      ? 'HASH_UNAVAILABLE'
      : calculatedHash === storedHash.toLowerCase()
        ? 'INTEGRITY_VERIFIED'
        : 'INTEGRITY_FAILED';
    const verifiedAt = new Date();

    await Document.updateOne(
      { _id: document._id },
      { $set: { integrityVerification: { status, calculatedHash, verifiedAt } } }
    );

    await recordAuditEvent({
      actorId: req.user._id,
      action: 'DOCUMENT_INTEGRITY_VERIFIED',
      resourceType: 'DOCUMENT',
      resourceId: document._id.toString(),
      documentId: document._id,
      description: status === 'INTEGRITY_VERIFIED'
        ? 'Document SHA-256 integrity verified successfully.'
        : status === 'INTEGRITY_FAILED'
          ? 'Document SHA-256 integrity check failed.'
          : 'Document SHA-256 hash unavailable.',
      outcome: status === 'INTEGRITY_VERIFIED' ? 'SUCCESS' : 'FAILED',
      metadata: { status, hashAlgorithm, calculatedHash, role: req.user.role }
    });

    return res.json({
      status,
      hashAlgorithm,
      storedHash,
      calculatedHash,
      verifiedAt: verifiedAt.toISOString()
    });
  } catch (err) {
    console.error(`[Integrity Verification Error on doc ${id}]:`, err.message);
    return res.status(500).json({ error: 'Failed to verify document integrity.' });
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
    const document = await findAuthorizedDocument(id, req.user);
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
  if (!hasDocumentAccess(document, req.user)) {
    await recordAuditEvent({
      actorId: req.user._id,
      action: 'DOCUMENT_ACCESS_DENIED',
      resourceType: 'DOCUMENT',
      resourceId: document._id.toString(),
      outcome: 'DENIED'
    });
    return res.status(404).json({ error: 'Document record not found.' });
  }

  // 1. Status transition check: only newly 'Uploaded' documents may enter processing
  if (document.status !== 'Uploaded') {
    return res.status(409).json({
      error: `Cannot process document with status '${document.status}'. Only newly uploaded documents can be processed.`
    });
  }

  // Resolve file path safely
  const safeFilename = path.basename(document.fileMetadata.storedFilename);
  const resolvedPath = path.resolve(uploadDir, safeFilename);

  if (!resolvedPath.startsWith(uploadDir) || !fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Physical document file not found on server disk.' });
  }

  // 2. Concurrency-safe atomic conditional update: transition from 'Uploaded' to 'Processing'
  const processingDoc = await Document.findOneAndUpdate(
    { _id: id, status: 'Uploaded' },
    { $set: { status: 'Processing' } },
    { returnDocument: 'after' }
  );

  if (!processingDoc) {
    return res.status(409).json({
      error: 'Document is already being processed or is no longer in Uploaded status.'
    });
  }

  try {
    const fileBuffer = await fs.promises.readFile(resolvedPath);
    const blob = new Blob([fileBuffer], { type: processingDoc.fileMetadata.mimeType });
    const formData = new FormData();
    formData.append('file', blob, processingDoc.fileMetadata.originalFilename);
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
    processingDoc.status = 'Needs review';
    processingDoc.ocrResult = pyData.ocrResult;
    processingDoc.landDetails = pyData.landDetails;
    processingDoc.extractionValidation = calculateExtractionValidation(
      pyData.landDetails,
      pyData.ocrResult
    );

    // Phase 4: Run Duplicate & Cross-Record Conflict Detection
    try {
      const detectionResults = await runDetectionPipeline(Document, processingDoc, {
        userId: req.user._id.toString(),
        role: req.user.role
      });
      processingDoc.duplicateDetection = detectionResults.duplicateDetection;
      processingDoc.conflictDetection = detectionResults.conflictDetection;
    } catch (detectErr) {
      console.error(`[Detection Pipeline Warning on doc ${id}]:`, detectErr.message);
    }

    await processingDoc.save();

    await recordDocumentAudit({
      documentId: processingDoc._id,
      action: 'OCR_PROCESSING_COMPLETED',
      req,
      description: `Extraction and OCR processing completed with engine '${engine}'.`,
      details: {
        engine,
        language,
        extractedFieldsCount: Object.keys(pyData.landDetails || {}).length,
        validationScore: processingDoc.extractionValidation?.overallScore
      },
      outcome: 'SUCCESS'
    });

    // Automatic background semantic indexing (non-blocking, safe)
    if (mongoose.connection.readyState === 1) {
      indexDocument(processingDoc._id).catch(idxErr => {
        console.warn(`[Background Semantic Indexing Warning on doc ${id}]:`, idxErr.message);
      });
    }

    return res.json(processingDoc);

  } catch (err) {
    console.error(`[OCR Processing Error on doc ${id}]:`, err.message);
    // Never leave record stuck in 'Processing' on failure, and never reset Verified/Rejected
    await Document.updateOne(
      { _id: id, status: 'Processing' },
      {
        $set: {
          status: 'Uploaded',
          'ocrResult.error': err.message
        }
      }
    );

    await recordDocumentAudit({
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
      status: 'Uploaded'
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
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // If never analyzed or refresh requested, run detection pipeline
    if (req.query.refresh === 'true' || !document.duplicateDetection?.lastAnalyzedAt) {
      const detectionResults = await runDetectionPipeline(Document, document, {
        userId: req.user._id.toString(),
        role: req.user.role
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
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const detectionResults = await runDetectionPipeline(Document, document, {
      userId: req.user._id.toString(),
      role: req.user.role
    });

    document.duplicateDetection = detectionResults.duplicateDetection;
    document.conflictDetection = detectionResults.conflictDetection;
    await document.save();

    await recordDocumentAudit({
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
 * Enforces strict authorization:
 * - Citizens: cannot change status (cannot approve/reject); cannot edit official landDetails after processing has started.
 * - Officers: can only update documents assigned to them.
 * - Admins: full administrative access.
 * Validates landDetails against an explicit allowlist.
 */
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const previousSnapshot = extractSnapshot(document);
    const { landDetails, status, changeReason } = req.body || {};

    // 1. Enforce strict role constraints
    if (req.user.role === 'Citizen') {
      if (status !== undefined) {
        return res.status(403).json({ error: 'Citizens cannot approve, reject, or change document status.' });
      }
      if (document.status !== 'Uploaded') {
        return res.status(403).json({ error: 'Citizens cannot modify official extracted land details after document processing.' });
      }
    } else if (req.user.role === 'Officer' || req.user.role === 'Admin') {
      if (status && ['Verified', 'Rejected'].includes(status)) {
        return res.status(400).json({
          error: "Formal review decisions ('Verified', 'Rejected') must be submitted via the dedicated review endpoint: PATCH /api/documents/:id/review"
        });
      }
      if (status && !['Uploaded', 'Processing', 'Needs review'].includes(status)) {
        return res.status(400).json({ error: 'Invalid document status.' });
      }
    }

    let modified = false;

    // 2. Allowlist validation for landDetails updates
    if (landDetails && typeof landDetails === 'object' && !Array.isArray(landDetails)) {
      const allowedFields = new Set([
        'ownerName', 'surveyNumber', 'khasraNumber', 'khataNumber', 'area', 'areaUnit',
        'landArea', 'village', 'tehsil', 'district', 'landClassification'
      ]);

      const oldDetails = document.landDetails ? JSON.parse(JSON.stringify(document.landDetails)) : {};
      const newDetailsForDiff = JSON.parse(JSON.stringify(oldDetails));

      for (const [field, fieldData] of Object.entries(landDetails)) {
        if (!allowedFields.has(field)) {
          return res.status(400).json({ error: `Invalid land detail field: ${field}` });
        }
        if (!fieldData || typeof fieldData !== 'object' || Array.isArray(fieldData)) {
          return res.status(400).json({ error: `Invalid format for field: ${field}` });
        }

        if (Object.hasOwn(fieldData, 'value')) {
          if (typeof fieldData.value !== 'string' || fieldData.value.length > 1000) {
            return res.status(400).json({ error: `Invalid value for field: ${field}` });
          }
          document.set(`landDetails.${field}.value`, fieldData.value);
          document.set(`landDetails.${field}.reviewStatus`, 'Corrected');
          if (!newDetailsForDiff[field]) newDetailsForDiff[field] = {};
          newDetailsForDiff[field].value = fieldData.value;
          modified = true;
        }

        if (field === 'landArea' && Object.hasOwn(fieldData, 'unit')) {
          if (typeof fieldData.unit !== 'string' || fieldData.unit.length > 40) {
            return res.status(400).json({ error: 'Invalid land-area unit.' });
          }
          document.set('landDetails.landArea.unit', fieldData.unit);
          if (!newDetailsForDiff.landArea) newDetailsForDiff.landArea = {};
          newDetailsForDiff.landArea.unit = fieldData.unit;
          modified = true;
        }
      }

      if (modified) {
        const diffs = computeFieldDiffs(oldDetails, newDetailsForDiff);
        if (diffs.length > 0) {
          // Recalculate extraction validation
          document.extractionValidation = calculateExtractionValidation(
            document.landDetails,
            document.ocrResult
          );

          await recordDocumentAudit({
            documentId: document._id,
            action: 'FIELD_EDITS_SAVED',
            req,
            description: `Updated ${diffs.length} land detail field${diffs.length > 1 ? 's' : ''}.`,
            details: { diffs },
            outcome: 'SUCCESS'
          });
        }
      }
    }

    // 3. Status updates (Officer & Admin only; non-final statuses like 'Needs review')
    if (status && status !== document.status && ['Officer', 'Admin'].includes(req.user.role)) {
      const previousStatus = document.status;
      document.status = status;
      modified = true;

      await recordDocumentAudit({
        documentId: document._id,
        action: 'STATUS_UPDATED',
        req,
        description: `Document status transitioned from '${previousStatus}' to '${status}'.`,
        details: { previousStatus, newStatus: status },
        outcome: 'SUCCESS'
      });
    }

    if (modified) {
      await document.save();

      // Automatic version creation on meaningful modifications
      try {
        const changeType = (status && !landDetails) ? 'STATUS_CHANGE' : 'CORRECTION';
        const recordedReason = changeReason || (status && !landDetails
          ? `Status changed to ${status}`
          : 'Corrected land details attribute(s)');
        await recordDocumentVersion(document, {
          user: req.user,
          changeType,
          changeReason: recordedReason,
          previousSnapshot
        });
      } catch (verErr) {
        console.error('[Version Recording Error in PATCH /:id]:', verErr.message);
      }

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
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    // Default to chronological order (asc = oldest first) as specified in requirements, or desc if requested
    const sortOrder = req.query.sort === 'desc' ? -1 : 1;
    const skip = (page - 1) * limit;

    const docObjectId = new mongoose.Types.ObjectId(id);
    const filter = {
      $or: [
        { documentId: docObjectId },
        { resourceType: 'DOCUMENT', resourceId: id.toString() }
      ]
    };

    const totalEvents = await AuditEvent.countDocuments(filter);
    const events = await AuditEvent.find(filter)
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
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
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
    await recordDocumentAudit({
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
      status: isIntact ? 'INTEGRITY_VERIFIED' : 'INTEGRITY_FAILED',
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
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
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

/**
 * GET /api/documents/:id/versions
 * List all historical versions of a document.
 * Enforces document-level RBAC access control.
 * Sanitizes internal filesystem paths.
 */
router.get('/:id/versions', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const sortOrder = req.query.sort === 'asc' ? 1 : -1;
    let versions = await DocumentVersion.find({ documentId: document._id })
      .populate('changedBy', 'displayName email role')
      .sort({ versionNumber: sortOrder })
      .lean();

    // If document was created before versioning existed, lazily synthesize version 1
    if (versions.length === 0) {
      try {
        const v1 = await createInitialVersion(document, req.user);
        versions = [v1.toObject ? v1.toObject() : v1];
      } catch (lazyErr) {
        console.warn(`[Lazy v1 Creation Notice on doc ${id}]:`, lazyErr.message);
      }
    }

    // Sanitize snapshots to prevent exposing internal filesystem paths
    for (const v of versions) {
      if (v.snapshot?.fileMetadata) {
        delete v.snapshot.fileMetadata.storagePath;
      }
    }

    return res.json({
      documentId: document._id,
      currentVersion: document.currentVersion || versions.length || 1,
      totalVersions: versions.length,
      versions
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to retrieve document version history.',
      details: err.message
    });
  }
});

/**
 * GET /api/documents/:id/versions/compare
 * Compares two historical versions of a document.
 * Query params: ?from=1&to=2
 * Displays previous value, updated value, changed field, version numbers, modification date, user responsible.
 * Highlights added, modified, removed, and unchanged values with summary statistics.
 */
router.get('/:id/versions/compare', async (req, res) => {
  const { id } = req.params;
  const fromNum = parseInt(req.query.from, 10);
  const toNum = parseInt(req.query.to, 10);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  if (isNaN(fromNum) || isNaN(toNum) || fromNum < 1 || toNum < 1) {
    return res.status(400).json({ error: "Both 'from' and 'to' version numbers are required and must be positive integers." });
  }

  if (fromNum === toNum) {
    return res.status(400).json({ error: 'Identical version selection is prohibited. Please select two different versions to compare.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const [v1, v2] = await Promise.all([
      DocumentVersion.findOne({ documentId: document._id, versionNumber: fromNum })
        .populate('changedBy', 'displayName email role'),
      DocumentVersion.findOne({ documentId: document._id, versionNumber: toNum })
        .populate('changedBy', 'displayName email role')
    ]);

    if (!v1 || !v2) {
      return res.status(404).json({ error: `Specified version (${!v1 ? fromNum : toNum}) does not exist for this document.` });
    }

    const comparison = compareVersions(v1, v2);

    // Record audit event for version comparison (strictly read-only)
    await recordAuditEvent({
      actorId: req.user._id,
      action: 'DOCUMENT_VERSIONS_COMPARED',
      resourceType: 'DOCUMENT',
      resourceId: document._id.toString(),
      documentId: document._id,
      description: `Compared version ${fromNum} with version ${toNum} of document '${document.fileMetadata?.originalFilename || id}'.`,
      outcome: 'SUCCESS',
      metadata: {
        documentId: document._id.toString(),
        fromVersion: fromNum,
        toVersion: toNum,
        changedFieldsCount: comparison.summary?.changedFields ?? comparison.differences?.length ?? 0,
        unchangedFieldsCount: comparison.summary?.unchangedFields ?? 0,
        role: req.user.role
      }
    });

    return res.json({
      documentId: document._id,
      documentReference: document.fileMetadata?.originalFilename || document._id.toString(),
      ...comparison
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      error: err.message || 'Failed to compare document versions.',
      details: err.message
    });
  }
});

/**
 * POST /api/documents/:id/versions/replace-file
 * Replace the physical file of a document (e.g. enhanced re-scan).
 * Authorized: Officer or Admin only.
 * Creates a DOCUMENT_REPLACEMENT version and maintains SHA-256 integrity verification.
 */
router.post('/:id/versions/replace-file', requireRole('Officer', 'Admin'), handleUpload, async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No replacement file attached.' });
  }

  let newSha256Hash;
  try {
    newSha256Hash = await calculateFileHash(req.file.path);
  } catch (hashErr) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(500).json({ error: 'Failed to compute SHA-256 hash for replacement file.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const previousSnapshot = extractSnapshot(document);
    const oldFilename = document.fileMetadata.originalFilename;
    const oldHash = document.fileMetadata.sha256Hash;

    // Update document file metadata
    document.fileMetadata = {
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      sha256Hash: newSha256Hash,
      hashAlgorithm: HASH_ALGORITHM,
      storagePath: req.file.path
    };
    document.integrityVerification = {
      status: 'INTEGRITY_VERIFIED',
      calculatedHash: newSha256Hash,
      verifiedAt: new Date()
    };

    const reason = req.body.changeReason || `Replaced file '${oldFilename}' with '${req.file.originalname}'`;

    const diffs = [{
      field: 'fileMetadata.sha256Hash',
      label: 'Document File Replacement',
      before: `${oldFilename} (${oldHash})`,
      after: `${req.file.originalname} (${newSha256Hash})`
    }];

    const newVersion = await recordDocumentVersion(document, {
      user: req.user,
      changeType: 'DOCUMENT_REPLACEMENT',
      changeReason: reason,
      diffs,
      previousSnapshot
    });

    await recordAuditEvent({
      actorId: req.user._id,
      action: 'DOCUMENT_REPLACED',
      resourceType: 'DOCUMENT',
      resourceId: document._id.toString(),
      documentId: document._id,
      description: `Physical document replaced by officer ${req.user.displayName || req.user.email}. New SHA-256: ${newSha256Hash}`,
      outcome: 'SUCCESS',
      metadata: {
        previousFilename: oldFilename,
        newFilename: req.file.originalname,
        previousSha256: oldHash,
        newSha256: newSha256Hash,
        versionNumber: newVersion.versionNumber,
        role: req.user.role
      }
    });

    return res.status(201).json({
      message: 'Document file replaced successfully.',
      document,
      newVersion
    });
  } catch (err) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(500).json({
      error: 'Failed to replace document file.',
      details: err.message
    });
  }
});

/**
 * GET /api/documents/:id/versions/:versionNumber
 * Retrieve a specific historical version snapshot by version number.
 * Enforces document-level RBAC access control.
 */
router.get('/:id/versions/:versionNumber', async (req, res) => {
  const { id, versionNumber } = req.params;
  const vNum = parseInt(versionNumber, 10);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  if (isNaN(vNum) || vNum < 1) {
    return res.status(400).json({ error: 'Invalid version number.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const version = await DocumentVersion.findOne({ documentId: document._id, versionNumber: vNum })
      .populate('changedBy', 'displayName email role')
      .lean();

    if (!version) {
      return res.status(404).json({ error: `Version ${vNum} not found for this document.` });
    }

    if (version.snapshot?.fileMetadata) {
      delete version.snapshot.fileMetadata.storagePath;
    }

    return res.json(version);
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to retrieve document version.',
      details: err.message
    });
  }
});

/**
 * GET /api/documents/:id/ownership-history
 * Retrieve ownership history for a document.
 * Enforces RBAC document access control.
 */
router.get('/:id/ownership-history', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const sortOrder = req.query.sort === 'asc' ? 1 : -1;
    const history = await OwnershipHistory.find({ documentId: document._id })
      .populate('officerResponsible.userId', 'displayName email role')
      .populate('previousOwner.userId', 'displayName email role')
      .populate('newOwner.userId', 'displayName email role')
      .sort({ transferDate: sortOrder });

    return res.json({
      documentId: document._id,
      totalTransfers: history.length,
      history
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to retrieve ownership history.',
      details: err.message
    });
  }
});

/**
 * POST /api/documents/:id/transfer-ownership
 * Explicit ownership transfer workflow.
 * Authorized: Officer or Admin only.
 * Ordinary metadata corrections do NOT trigger this endpoint.
 */
router.post('/:id/transfer-ownership', requireRole('Officer', 'Admin'), async (req, res) => {
  const { id } = req.params;
  const { newOwnerName, newOwnerUserId, reason, supportingDocumentRef } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid document ID format.' });
  }

  if (!newOwnerName || typeof newOwnerName !== 'string' || !newOwnerName.trim()) {
    return res.status(400).json({ error: 'New owner name is required.' });
  }

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'A legitimate reason for ownership transfer is required.' });
  }

  if (newOwnerUserId && !mongoose.Types.ObjectId.isValid(newOwnerUserId)) {
    return res.status(400).json({ error: 'Invalid new owner user ID format.' });
  }

  try {
    const document = await findAuthorizedDocument(id, req.user);
    if (!document) {
      return res.status(404).json({ error: 'Document record not found.' });
    }

    const result = await transferOwnership({
      document,
      newOwnerName,
      newOwnerUserId,
      officer: req.user,
      reason,
      supportingDocumentRef
    });

    // Semantic search background indexing
    if (mongoose.connection.readyState === 1) {
      indexDocument(document._id).catch(idxErr => {
        console.warn(`[Background Semantic Indexing Warning after ownership transfer on doc ${id}]:`, idxErr.message);
      });
    }

    return res.status(200).json({
      message: 'Ownership transferred and recorded successfully.',
      ownershipHistory: result.ownershipHistory,
      newVersion: result.newVersion,
      document: result.document
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to transfer ownership.',
      details: err.message
    });
  }
});

module.exports = router;
