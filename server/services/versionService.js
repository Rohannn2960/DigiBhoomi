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

  // Update currentVersion pointer on Document
  document.currentVersion = nextVersionNumber;
  await document.save();

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
 * Compares two DocumentVersion snapshots and identifies added, modified, and removed attributes.
 */
function compareVersions(v1, v2) {
  if (!v1 || !v2) {
    throw new Error('Two versions are required for comparison.');
  }

  const diffs = [];
  const s1 = v1.snapshot || {};
  const s2 = v2.snapshot || {};

  // Status comparison
  if (s1.status !== s2.status) {
    diffs.push({
      field: 'status',
      label: 'Document Status',
      changeCategory: 'modified',
      previousValue: s1.status || '(empty)',
      updatedValue: s2.status || '(empty)'
    });
  }

  // File replacement / SHA-256 comparison
  const h1 = s1.fileMetadata?.sha256Hash || v1.sha256Hash;
  const h2 = s2.fileMetadata?.sha256Hash || v2.sha256Hash;
  if (h1 && h2 && h1 !== h2) {
    diffs.push({
      field: 'fileMetadata.sha256Hash',
      label: 'File Cryptographic Hash (SHA-256)',
      changeCategory: 'modified',
      previousValue: `${s1.fileMetadata?.originalFilename || 'File'} [${h1}]`,
      updatedValue: `${s2.fileMetadata?.originalFilename || 'File'} [${h2}]`
    });
  }

  // Review remarks
  const r1 = (s1.reviewRemarks || '').trim();
  const r2 = (s2.reviewRemarks || '').trim();
  if (r1 !== r2) {
    diffs.push({
      field: 'reviewRemarks',
      label: 'Review Remarks',
      changeCategory: !r1 ? 'added' : !r2 ? 'removed' : 'modified',
      previousValue: r1 || '(empty)',
      updatedValue: r2 || '(empty)'
    });
  }

  // Land details fields
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

  const ld1 = s1.landDetails || {};
  const ld2 = s2.landDetails || {};

  for (const { key, label } of fields) {
    let val1 = '';
    let val2 = '';

    if (key === 'landArea') {
      const a1 = ld1.landArea || {};
      const a2 = ld2.landArea || {};
      val1 = `${a1.value || ''} ${a1.unit || ''}`.trim();
      val2 = `${a2.value || ''} ${a2.unit || ''}`.trim();
    } else {
      val1 = (typeof ld1[key]?.value === 'string' ? ld1[key].value : (typeof ld1[key] === 'string' ? ld1[key] : '')).trim();
      val2 = (typeof ld2[key]?.value === 'string' ? ld2[key].value : (typeof ld2[key] === 'string' ? ld2[key] : '')).trim();
    }

    if (val1 !== val2) {
      let category = 'modified';
      if (!val1 && val2) category = 'added';
      else if (val1 && !val2) category = 'removed';

      diffs.push({
        field: `landDetails.${key}`,
        label,
        changeCategory: category,
        previousValue: val1 || '(empty)',
        updatedValue: val2 || '(empty)'
      });
    }
  }

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
    differences: diffs
  };
}

module.exports = {
  extractSnapshot,
  computeDetailedDiffs,
  createInitialVersion,
  recordDocumentVersion,
  compareVersions
};
