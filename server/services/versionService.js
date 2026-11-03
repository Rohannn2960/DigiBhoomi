const mongoose = require('mongoose');
const DocumentVersion = require('../models/DocumentVersion');
const { recordAuditEvent } = require('./audit');

/**
 * Extracts a serializable snapshot of document state for version preservation.
 */
function extractSnapshot(document) {
  const fileMeta = document.fileMetadata || {};
  return {
    fileMetadata: {
      originalFilename: fileMeta.originalFilename || '',
      storedFilename: fileMeta.storedFilename || '',
      mimeType: fileMeta.mimeType || '',
      sizeBytes: fileMeta.sizeBytes || 0,
      sha256Hash: fileMeta.sha256Hash || '',
      hashAlgorithm: fileMeta.hashAlgorithm || 'SHA-256'
    },
    status: document.status || 'Uploaded',
    landDetails: document.landDetails ? JSON.parse(JSON.stringify(document.landDetails)) : {},
    reviewRemarks: document.reviewRemarks || '',
    ownerId: document.ownerId || null,
    assignedOfficerId: document.assignedOfficerId || null
  };
}

/**
 * Computes deep field differences between two snapshots or states.
 */
function computeDetailedDiffs(oldSnapshot = {}, newSnapshot = {}) {
  const diffs = [];

  // File replacement check
  const oldFileHash = oldSnapshot.fileMetadata?.sha256Hash;
  const newFileHash = newSnapshot.fileMetadata?.sha256Hash;
  if (oldFileHash && newFileHash && oldFileHash !== newFileHash) {
    diffs.push({
      field: 'fileMetadata.sha256Hash',
      label: 'Document File (SHA-256)',
      before: `${oldSnapshot.fileMetadata.originalFilename} (${oldFileHash.substring(0, 10)}...)`,
      after: `${newSnapshot.fileMetadata.originalFilename} (${newFileHash.substring(0, 10)}...)`
    });
  }

  // Status check
  if (oldSnapshot.status && newSnapshot.status && oldSnapshot.status !== newSnapshot.status) {
    diffs.push({
      field: 'status',
      label: 'Document Status',
      before: oldSnapshot.status,
      after: newSnapshot.status
    });
  }

  // Review remarks check
  const oldRemarks = (oldSnapshot.reviewRemarks || '').trim();
  const newRemarks = (newSnapshot.reviewRemarks || '').trim();
  if (oldRemarks !== newRemarks) {
    diffs.push({
      field: 'reviewRemarks',
      label: 'Review Remarks',
      before: oldRemarks || '(empty)',
      after: newRemarks || '(empty)'
    });
  }

  // Land details fields check
  const fields = [
    { key: 'ownerName', label: 'Owner Name' },
    { key: 'khasraNumber', label: 'Khasra Number' },
    { key: 'surveyNumber', label: 'Survey Number' },
    { key: 'khataNumber', label: 'Khata Number' },
    { key: 'area', label: 'Area' },
    { key: 'areaUnit', label: 'Area Unit' },
    { key: 'landArea', label: 'Land Area' },
    { key: 'village', label: 'Village' },
    { key: 'tehsil', label: 'Tehsil' },
    { key: 'district', label: 'District' },
    { key: 'landClassification', label: 'Land Classification' }
  ];

  const oldLD = oldSnapshot.landDetails || {};
  const newLD = newSnapshot.landDetails || {};

  for (const { key, label } of fields) {
    if (key === 'landArea') {
      const bArea = oldLD.landArea || {};
      const aArea = newLD.landArea || {};
      const bStr = `${bArea.value || ''} ${bArea.unit || ''}`.trim();
      const aStr = `${aArea.value || ''} ${aArea.unit || ''}`.trim();
      if (bStr !== aStr) {
        diffs.push({
          field: 'landDetails.landArea',
          label,
          before: bStr || '(empty)',
          after: aStr || '(empty)'
        });
      }
    } else {
      const bVal = (typeof oldLD[key]?.value === 'string' ? oldLD[key].value : (typeof oldLD[key] === 'string' ? oldLD[key] : '')).trim();
      const aVal = (typeof newLD[key]?.value === 'string' ? newLD[key].value : (typeof newLD[key] === 'string' ? newLD[key] : '')).trim();
      if (bVal !== aVal) {
        diffs.push({
          field: `landDetails.${key}.value`,
          label,
          before: bVal || '(empty)',
          after: aVal || '(empty)'
        });
      }
    }
  }

  return diffs;
}

/**
 * Creates Version 1 for a newly uploaded document.
 */
async function createInitialVersion(document, user) {
  const snapshot = extractSnapshot(document);
  const version = new DocumentVersion({
    documentId: document._id,
    versionNumber: 1,
    changeType: 'INITIAL_UPLOAD',
    changeReason: 'Initial document upload',
    changedBy: user._id || user.id,
    changedByRole: user.role || 'Citizen',
    changedAt: document.createdAt || new Date(),
    sha256Hash: document.fileMetadata?.sha256Hash,
    diffs: [{
      field: 'fileMetadata',
      label: 'Document File',
      before: null,
      after: `${document.fileMetadata?.originalFilename} (${document.fileMetadata?.sha256Hash?.substring(0, 10)}...)`
    }],
    snapshot
  });

  const savedVersion = await version.save();

  await recordAuditEvent({
    actorId: user._id || user.id,
    action: 'DOCUMENT_VERSION_CREATED',
    resourceType: 'DOCUMENT',
    resourceId: document._id.toString(),
    documentId: document._id,
    description: `Document version 1 created upon upload of '${document.fileMetadata?.originalFilename}'.`,
    outcome: 'SUCCESS',
    metadata: {
      versionNumber: 1,
      changeType: 'INITIAL_UPLOAD',
      sha256Hash: document.fileMetadata?.sha256Hash,
      role: user.role
    }
  });

  return savedVersion;
}

/**
 * Creates and persists a new sequential version whenever meaningful changes occur.
 */
async function recordDocumentVersion(document, {
  user,
  changeType,
  changeReason = '',
  diffs = null,
  previousSnapshot = null
}) {
  if (!user || !user._id) {
    throw new Error('User identity is required to record a document version.');
  }

  // Find latest existing version to enforce strict sequential numbering
  const latestVersion = await DocumentVersion.findOne({ documentId: document._id })
    .sort({ versionNumber: -1 });

  let nextVersionNumber = 1;
  let baseSnapshot = previousSnapshot;

  if (latestVersion) {
    nextVersionNumber = latestVersion.versionNumber + 1;
    if (!baseSnapshot) {
      baseSnapshot = latestVersion.snapshot;
    }
  } else {
    // If no prior version exists (legacy document), create baseline v1 then advance
    baseSnapshot = baseSnapshot || extractSnapshot(document);
    nextVersionNumber = (document.currentVersion || 1) > 1 ? document.currentVersion + 1 : 2;
  }

  const currentSnapshot = extractSnapshot(document);
  const computedDiffs = diffs || computeDetailedDiffs(baseSnapshot, currentSnapshot);

  // If no meaningful differences and not an explicit replacement or transfer, do not create duplicate version
  if (computedDiffs.length === 0 && !['DOCUMENT_REPLACEMENT', 'OWNERSHIP_TRANSFER'].includes(changeType)) {
    return latestVersion;
  }

  const version = new DocumentVersion({
    documentId: document._id,
    versionNumber: nextVersionNumber,
    changeType,
    changeReason: changeReason.trim() || `Document updated (${changeType})`,
    changedBy: user._id,
    changedByRole: user.role || 'Officer',
    changedAt: new Date(),
    sha256Hash: document.fileMetadata?.sha256Hash,
    diffs: computedDiffs,
    snapshot: currentSnapshot
  });

  const savedVersion = await version.save();

  try {
    // Update currentVersion pointer on Document
    document.currentVersion = nextVersionNumber;
    await document.save();
  } catch (docSaveErr) {
    // Safe compensation: delete orphaned version on failed document update to maintain consistency
    await DocumentVersion.deleteOne({ _id: savedVersion._id }, { allowTestCleanup: true }).catch(() => {});
    throw docSaveErr;
  }

  await recordAuditEvent({
    actorId: user._id,
    action: 'DOCUMENT_VERSION_CREATED',
    resourceType: 'DOCUMENT',
    resourceId: document._id.toString(),
    documentId: document._id,
    description: `Document version ${nextVersionNumber} created (${changeType}): ${changeReason || 'No reason provided'}.`,
    outcome: 'SUCCESS',
    metadata: {
      versionNumber: nextVersionNumber,
      changeType,
      changeReason,
      diffsCount: computedDiffs.length,
      sha256Hash: document.fileMetadata?.sha256Hash,
      role: user.role
    }
  });

  return savedVersion;
}

/**
 * Normalizes values for comparison to prevent false positives from formatting or units.
 */
function normalizeComparisonValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (!str || str === '(empty)') return '';

  // Numeric equivalence: e.g. "102" or "2.50" vs "2.5"
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return String(parseFloat(str));
  }

  // Value with unit: e.g. "2.50 Acre" vs "2.5 Acres"
  const areaMatch = str.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
  if (areaMatch) {
    const num = parseFloat(areaMatch[1]);
    const unit = (areaMatch[2] || '').toLowerCase().replace(/s$/, '');
    return `${num} ${unit}`.trim();
  }

  // General text: collapse multiple internal whitespace and lowercase
  return str.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Extracts a normalized string value from a field container.
 */
function extractFieldValue(container, key) {
  if (!container) return '';
  const item = container[key];
  if (item === null || item === undefined) return '';
  if (typeof item === 'object') {
    if (key === 'landArea') {
      const v = item.value !== undefined && item.value !== null ? String(item.value).trim() : '';
      const u = item.unit !== undefined && item.unit !== null ? String(item.unit).trim() : '';
      if (!v && !u) return '';
      return `${v} ${u}`.trim();
    }
    if (item.value !== undefined && item.value !== null) {
      return String(item.value).trim();
    }
    return '';
  }
  return String(item).trim();
}

/**
 * Compares two DocumentVersion snapshots and identifies added, modified, and removed attributes.
 */
function compareVersions(v1, v2) {
  if (!v1 || !v2) {
    const err = new Error('Two versions are required for comparison.');
    err.statusCode = 400;
    throw err;
  }

  // Verify versions belong to the same document
  const docId1 = (v1.documentId?._id || v1.documentId)?.toString();
  const docId2 = (v2.documentId?._id || v2.documentId)?.toString();
  if (docId1 && docId2 && docId1 !== docId2) {
    const err = new Error('Comparison is only permitted between versions of the same document.');
    err.statusCode = 400;
    throw err;
  }

  // Prevent comparing the same version
  if (v1.versionNumber !== undefined && v2.versionNumber !== undefined && v1.versionNumber === v2.versionNumber) {
    const err = new Error('Identical version selection is prohibited. Please select two different versions to compare.');
    err.statusCode = 400;
    throw err;
  }

  const s1 = v1.snapshot || {};
  const s2 = v2.snapshot || {};
  const ld1 = s1.landDetails || {};
  const ld2 = s2.landDetails || {};

  const fields = [
    { key: 'ownerName', field: 'landDetails.ownerName', label: 'Owner Name' },
    { key: 'surveyNumber', field: 'landDetails.surveyNumber', label: 'Survey Number' },
    { key: 'khasraNumber', field: 'landDetails.khasraNumber', label: 'Khasra Number' },
    { key: 'khataNumber', field: 'landDetails.khataNumber', label: 'Khata Number' },
    { key: 'landArea', field: 'landDetails.landArea', label: 'Land Area' },
    { key: 'area', field: 'landDetails.area', label: 'Area' },
    { key: 'areaUnit', field: 'landDetails.areaUnit', label: 'Area Unit' },
    { key: 'village', field: 'landDetails.village', label: 'Village' },
    { key: 'tehsil', field: 'landDetails.tehsil', label: 'Tehsil' },
    { key: 'district', field: 'landDetails.district', label: 'District' },
    { key: 'landClassification', field: 'landDetails.landClassification', label: 'Land Classification' }
  ];

  const allFields = [];
  const differences = [];

  for (const item of fields) {
    const key = item.key;
    const fieldPath = item.field;
    const label = item.label;

    const raw1 = extractFieldValue(ld1, key);
    const raw2 = extractFieldValue(ld2, key);

    const norm1 = normalizeComparisonValue(raw1);
    const norm2 = normalizeComparisonValue(raw2);

    let category = 'unchanged';
    let status = 'Unchanged';

    if (!norm1 && norm2) {
      category = 'added';
      status = 'Added';
    } else if (norm1 && !norm2) {
      category = 'removed';
      status = 'Removed';
    } else if (norm1 && norm2 && norm1 !== norm2) {
      category = 'modified';
      status = 'Modified';
    }

    const fieldDiff = {
      field: fieldPath,
      label,
      changeCategory: category,
      status,
      previousValue: raw1 || '(empty)',
      updatedValue: raw2 || '(empty)'
    };

    allFields.push(fieldDiff);
    if (category !== 'unchanged') {
      differences.push(fieldDiff);
    }
  }

  // Compare Status
  const st1 = (s1.status || '').trim();
  const st2 = (s2.status || '').trim();
  const normSt1 = normalizeComparisonValue(st1);
  const normSt2 = normalizeComparisonValue(st2);
  let statusCat = 'unchanged';
  let statusStatus = 'Unchanged';
  if (!normSt1 && normSt2) {
    statusCat = 'added';
    statusStatus = 'Added';
  } else if (normSt1 && !normSt2) {
    statusCat = 'removed';
    statusStatus = 'Removed';
  } else if (normSt1 !== normSt2) {
    statusCat = 'modified';
    statusStatus = 'Modified';
  }
  const statusDiff = {
    field: 'status',
    label: 'Document Status',
    changeCategory: statusCat,
    status: statusStatus,
    previousValue: st1 || '(empty)',
    updatedValue: st2 || '(empty)'
  };
  allFields.push(statusDiff);
  if (statusCat !== 'unchanged') {
    differences.push(statusDiff);
  }

  // Compare Cryptographic Hash (SHA-256)
  const h1 = (s1.fileMetadata?.sha256Hash || v1.sha256Hash || '').trim();
  const h2 = (s2.fileMetadata?.sha256Hash || v2.sha256Hash || '').trim();
  let hashCat = 'unchanged';
  let hashStatus = 'Unchanged';
  if (!h1 && h2) {
    hashCat = 'added';
    hashStatus = 'Added';
  } else if (h1 && !h2) {
    hashCat = 'removed';
    hashStatus = 'Removed';
  } else if (h1 && h2 && h1 !== h2) {
    hashCat = 'modified';
    hashStatus = 'Modified';
  }
  const hashDiff = {
    field: 'fileMetadata.sha256Hash',
    label: 'File Cryptographic Hash (SHA-256)',
    changeCategory: hashCat,
    status: hashStatus,
    previousValue: h1 ? (s1.fileMetadata?.originalFilename ? `${s1.fileMetadata.originalFilename} [${h1}]` : h1) : '(empty)',
    updatedValue: h2 ? (s2.fileMetadata?.originalFilename ? `${s2.fileMetadata.originalFilename} [${h2}]` : h2) : '(empty)'
  };
  allFields.push(hashDiff);
  if (hashCat !== 'unchanged') {
    differences.push(hashDiff);
  }

  // Compare Review Remarks
  const r1 = (s1.reviewRemarks || '').trim();
  const r2 = (s2.reviewRemarks || '').trim();
  let remCat = 'unchanged';
  let remStatus = 'Unchanged';
  if (!r1 && r2) {
    remCat = 'added';
    remStatus = 'Added';
  } else if (r1 && !r2) {
    remCat = 'removed';
    remStatus = 'Removed';
  } else if (r1 && r2 && r1 !== r2) {
    remCat = 'modified';
    remStatus = 'Modified';
  }
  const remDiff = {
    field: 'reviewRemarks',
    label: 'Review Remarks',
    changeCategory: remCat,
    status: remStatus,
    previousValue: r1 || '(empty)',
    updatedValue: r2 || '(empty)'
  };
  allFields.push(remDiff);
  if (remCat !== 'unchanged') {
    differences.push(remDiff);
  }

  // Summary counts
  const summary = {
    totalFields: allFields.length,
    changedFields: differences.length,
    unchangedFields: allFields.filter(f => f.changeCategory === 'unchanged').length,
    addedCount: allFields.filter(f => f.changeCategory === 'added').length,
    modifiedCount: allFields.filter(f => f.changeCategory === 'modified').length,
    removedCount: allFields.filter(f => f.changeCategory === 'removed').length
  };

  return {
    fromVersion: {
      versionNumber: v1.versionNumber,
      changedAt: v1.changedAt,
      changedBy: v1.changedBy,
      changedByRole: v1.changedByRole,
      changeType: v1.changeType,
      changeReason: v1.changeReason,
      sha256Hash: v1.sha256Hash
    },
    toVersion: {
      versionNumber: v2.versionNumber,
      changedAt: v2.changedAt,
      changedBy: v2.changedBy,
      changedByRole: v2.changedByRole,
      changeType: v2.changeType,
      changeReason: v2.changeReason,
      sha256Hash: v2.sha256Hash
    },
    differences,
    allFields,
    summary
  };
}

module.exports = {
  extractSnapshot,
  computeDetailedDiffs,
  createInitialVersion,
  recordDocumentVersion,
  compareVersions
};
