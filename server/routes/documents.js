const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const { upload, uploadDir, calculateFileHash } = require('../middleware/upload');

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

