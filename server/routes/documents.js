const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const User = require('../models/User');
const { upload, uploadDir, calculateFileHash } = require('../middleware/upload');
const { authenticate, findAuthorizedDocument, hasDocumentAccess, requireRole } = require('../middleware/auth');
const { recordAuditEvent } = require('../services/audit');

const HASH_ALGORITHM = 'SHA-256';

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
    try {
      await recordAuditEvent({
        actorId: req.user._id,
        action: 'DOCUMENT_HASH_GENERATED',
        resourceType: 'DOCUMENT',
        resourceId: savedDoc._id.toString(),
        outcome: 'SUCCESS',
        metadata: { hashAlgorithm: HASH_ALGORITHM, sha256Hash }
      });
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
    const scope = req.user.role === 'Admin'
      ? {}
      : req.user.role === 'Officer'
        ? { assignedOfficerId: req.user._id }
        : { ownerId: req.user._id };
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
      outcome: 'SUCCESS',
      metadata: { status: document.status, action: reviewAction }
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
      outcome: 'SUCCESS',
      metadata: { previousOfficerId, assignedOfficerId: officer?._id.toString() || null }
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
      outcome: status === 'INTEGRITY_VERIFIED' ? 'SUCCESS' : 'FAILED',
      metadata: { status, hashAlgorithm, calculatedHash }
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
    await document.save();

    return res.json(document);

  } catch (err) {
    console.error(`[OCR Processing Error on doc ${id}]:`, err.message);
    // Never leave record stuck in 'Processing' on failure
    document.status = previousStatus === 'Processing' ? 'Uploaded' : previousStatus;
    if (!document.ocrResult) document.ocrResult = {};
    document.ocrResult.error = err.message;
    await document.save();

    return res.status(502).json({
      error: `Document processing failed: ${err.message}`,
      status: document.status
    });
  }
});

module.exports = router;

