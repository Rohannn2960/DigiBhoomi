const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { validateTestUploadDir } = require('../test_helpers/isolation');

// Resolve and ensure uploads directory exists (test-aware fallback & strict validation)
const isTestEnv = process.env.NODE_ENV === 'test' || String(process.env.PORT) === '5001';
const defaultUploadDir = isTestEnv ? (process.env.RBAC_TEST_UPLOAD_DIR || 'uploads_rbac_test') : 'uploads';
const rawUploadDir = process.env.UPLOAD_DIR || defaultUploadDir;
if (isTestEnv) {
  validateTestUploadDir(path.resolve(__dirname, '..'), rawUploadDir);
}
const uploadDir = path.resolve(__dirname, '..', rawUploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed file specifications
const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg'];
const ALLOWED_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

// Configure Multer disk storage with UUID filenames
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueFilename = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueFilename);
  }
});

// Strict file filter validating both extension and MIME type
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (!ALLOWED_EXTS.includes(ext) || !ALLOWEDMIMES_INCLUDES(mime, ext)) {
    const error = new Error('Invalid file type. Only PDF, PNG, JPG, and JPEG documents are permitted.');
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }
  cb(null, true);
};

// Helper to ensure extension matches expected MIME category
function ALLOWEDMIMES_INCLUDES(mime, ext) {
  if (!ALLOWED_MIMES.includes(mime)) return false;
  if (ext === '.pdf' && mime !== 'application/pdf') return false;
  if (ext === '.png' && mime !== 'image/png') return false;
  if (['.jpg', '.jpeg'].includes(ext) && !['image/jpeg', 'image/jpg'].includes(mime)) return false;
  return true;
}

const maxSizeBytes = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10) * 1024 * 1024;

const upload = multer({
  storage: storage,
  limits: { fileSize: maxSizeBytes },
  fileFilter: fileFilter
});

/**
 * Calculates SHA-256 hash using Node.js built-in crypto streaming
 * @param {string} filePath - Absolute path to stored file
 * @returns {Promise<string>} Hex SHA-256 hash
 */
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

module.exports = {
  upload,
  uploadDir,
  calculateFileHash
};
