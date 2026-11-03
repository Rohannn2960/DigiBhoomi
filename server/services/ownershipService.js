const mongoose = require('mongoose');
const OwnershipHistory = require('../models/OwnershipHistory');
const { recordDocumentVersion, extractSnapshot } = require('./versionService');
const { recordAuditEvent } = require('./audit');

/**
 * Executes an explicit, authorized ownership transfer for a land record.
 */
async function transferOwnership({
  document,
  newOwnerName,
  newOwnerUserId = null,
  officer,
  reason,
  supportingDocumentRef = ''
}) {
  if (!document) {
    throw new Error('Document is required for ownership transfer.');
  }

  if (!officer || !['Officer', 'Admin'].includes(officer.role)) {
    throw new Error('Only authorized Officers and Administrators can record ownership transfers.');
  }

  if (!newOwnerName || typeof newOwnerName !== 'string' || !newOwnerName.trim()) {
    throw new Error('New owner name is required for ownership transfer.');
  }

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    throw new Error('A legitimate reason is required for recording an ownership transfer.');
  }

  const trimmedNewName = newOwnerName.trim();
  const trimmedReason = reason.trim();
  const trimmedRef = (supportingDocumentRef || '').trim();

  // Capture previous owner details
  const prevOwnerName = document.landDetails?.ownerName?.value || 'Unknown';
  const prevOwnerId = document.ownerId || null;

  // Capture land identifiers
  const landRef = {
    khasraNumber: document.landDetails?.khasraNumber?.value || '',
    surveyNumber: document.landDetails?.surveyNumber?.value || '',
    khataNumber: document.landDetails?.khataNumber?.value || '',
    district: document.landDetails?.district?.value || '',
    tehsil: document.landDetails?.tehsil?.value || '',
    village: document.landDetails?.village?.value || ''
  };

  const previousSnapshot = extractSnapshot(document);

  // Update document owner details
  if (!document.landDetails) document.landDetails = {};
  if (!document.landDetails.ownerName) document.landDetails.ownerName = {};
  document.landDetails.ownerName.value = trimmedNewName;
  document.landDetails.ownerName.reviewStatus = 'Corrected';

  if (newOwnerUserId && mongoose.Types.ObjectId.isValid(newOwnerUserId)) {
    document.ownerId = new mongoose.Types.ObjectId(newOwnerUserId);
  }

  // Generate explicit version diffs
  const diffs = [
    {
      field: 'landDetails.ownerName.value',
      label: 'Owner Name (Legal Transfer)',
      before: prevOwnerName,
      after: trimmedNewName
    }
  ];

  if (newOwnerUserId && prevOwnerId?.toString() !== newOwnerUserId.toString()) {
    diffs.push({
      field: 'ownerId',
      label: 'Owner User Account',
      before: prevOwnerId?.toString() || '(unassigned)',
      after: newOwnerUserId.toString()
    });
  }

  // Create a new DocumentVersion representing the ownership transfer
  const newVersion = await recordDocumentVersion(document, {
    user: officer,
    changeType: 'OWNERSHIP_TRANSFER',
    changeReason: `Ownership transferred from '${prevOwnerName}' to '${trimmedNewName}'. Reason: ${trimmedReason}`,
    diffs,
    previousSnapshot
  });

  // Record immutable OwnershipHistory entry
  const historyEntry = new OwnershipHistory({
    documentId: document._id,
    previousOwner: {
      userId: prevOwnerId,
      name: prevOwnerName,
      details: {
        khataNumber: landRef.khataNumber,
        khasraNumber: landRef.khasraNumber
      }
    },
    newOwner: {
      userId: document.ownerId,
      name: trimmedNewName,
      details: {
        supportingDocumentRef: trimmedRef
      }
    },
    landRecordReference: landRef,
    officerResponsible: {
      userId: officer._id,
      displayName: officer.displayName || 'Authorized Officer',
      role: officer.role
    },
    transferDate: new Date(),
    reason: trimmedReason,
    supportingDocumentRef: trimmedRef,
    versionNumber: newVersion.versionNumber
  });

  let savedHistory;
  try {
    savedHistory = await historyEntry.save();
  } catch (histErr) {
    // Rollback document state and version on failure to prevent inconsistent records
    document.landDetails.ownerName.value = prevOwnerName;
    document.ownerId = prevOwnerId;
    document.currentVersion = newVersion.versionNumber > 1 ? newVersion.versionNumber - 1 : 1;
    await document.save().catch(() => {});
    await DocumentVersion.deleteOne({ _id: newVersion._id }, { allowTestCleanup: true }).catch(() => {});
    throw new Error(`Failed to persist ownership history record: ${histErr.message}`);
  }

  // Record audit log
  await recordAuditEvent({
    actorId: officer._id,
    action: 'OWNERSHIP_TRANSFERRED',
    resourceType: 'DOCUMENT',
    resourceId: document._id.toString(),
    documentId: document._id,
    description: `Ownership for parcel '${landRef.khasraNumber || landRef.surveyNumber || document._id}' transferred from '${prevOwnerName}' to '${trimmedNewName}'.`,
    outcome: 'SUCCESS',
    metadata: {
      previousOwnerName: prevOwnerName,
      newOwnerName: trimmedNewName,
      reason: trimmedReason,
      supportingDocumentRef: trimmedRef,
      versionNumber: newVersion.versionNumber,
      officerId: officer._id.toString(),
      role: officer.role
    }
  });

  return {
    ownershipHistory: savedHistory,
    newVersion,
    document
  };
}

module.exports = {
  transferOwnership
};
