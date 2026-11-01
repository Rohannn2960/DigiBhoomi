const mongoose = require('mongoose');

/**
 * Normalizes text by removing diacritics/NFKC variations, converting to lowercase,
 * and collapsing consecutive whitespace into a single space.
 */
function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes land identifiers (e.g. Survey, Khasra, Khata numbers).
 * Collapses whitespace, removes whitespace around slashes/hyphens,
 * and removes leading zeroes from purely numeric tokens (e.g. "00058" -> "58").
 */
function normalizeIdentifier(value) {
  if (value === null || value === undefined) return '';
  let str = String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Remove spaces surrounding slashes, dots, or dashes (e.g. "142 / 2" -> "142/2")
  str = str.replace(/\s*([\/.\-])\s*/g, '$1');

  // Strip leading zeroes from numeric tokens (e.g., "00058" -> "58", "00142/002" -> "142/2")
  str = str.replace(/\b0+(\d+)\b/g, '$1');

  return str;
}

/**
 * Extracts a trimmed string value from a landDetails field object or string.
 */
function getFieldValue(landDetails, key) {
  if (!landDetails || typeof landDetails !== 'object') return '';
  const field = landDetails[key];
  if (!field) return '';
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'object' && typeof field.value === 'string') {
    return field.value.trim();
  }
  return '';
}

/**
 * Extracts area value and unit from landDetails.
 */
function getAreaDetails(landDetails) {
  if (!landDetails) return { value: '', unit: '' };
  const landArea = landDetails.landArea || {};
  const areaAlias = landDetails.area || {};

  const value = (typeof landArea.value === 'string' ? landArea.value : '') ||
                (typeof areaAlias.value === 'string' ? areaAlias.value : '');
  const unit = (typeof landArea.unit === 'string' ? landArea.unit : '') ||
               (typeof landDetails.areaUnit?.value === 'string' ? landDetails.areaUnit.value : '');

  return {
    value: value.trim(),
    unit: unit.trim()
  };
}

/**
 * Compares location fields (village, tehsil, district).
 * Location matches if at least one field is non-empty and matching,
 * and no populated location fields contradict each other.
 */
function compareLocations(sourceLand, targetLand) {
  const sourceVillage = normalizeText(getFieldValue(sourceLand, 'village'));
  const targetVillage = normalizeText(getFieldValue(targetLand, 'village'));

  const sourceTehsil = normalizeText(getFieldValue(sourceLand, 'tehsil'));
  const targetTehsil = normalizeText(getFieldValue(targetLand, 'tehsil'));

  const sourceDistrict = normalizeText(getFieldValue(sourceLand, 'district'));
  const targetDistrict = normalizeText(getFieldValue(targetLand, 'district'));

  const matchedFields = [];
  let hasPopulatedComparison = false;

  // Check District
  if (sourceDistrict && targetDistrict) {
    hasPopulatedComparison = true;
    if (sourceDistrict === targetDistrict) {
      matchedFields.push('district');
    } else {
      return { matches: false, matchedFields: [], reason: 'District mismatch' };
    }
  }

  // Check Tehsil
  if (sourceTehsil && targetTehsil) {
    hasPopulatedComparison = true;
    if (sourceTehsil === targetTehsil) {
      matchedFields.push('tehsil');
    } else {
      return { matches: false, matchedFields: [], reason: 'Tehsil mismatch' };
    }
  }

  // Check Village
  if (sourceVillage && targetVillage) {
    hasPopulatedComparison = true;
    if (sourceVillage === targetVillage) {
      matchedFields.push('village');
    } else {
      return { matches: false, matchedFields: [], reason: 'Village mismatch' };
    }
  }

  // If no common location fields exist, we cannot confirm same location
  if (!hasPopulatedComparison || matchedFields.length === 0) {
    return { matches: false, matchedFields: [], reason: 'Insufficient location data' };
  }

  return { matches: true, matchedFields, reason: 'Location matches' };
}

/**
 * Checks if two records share a primary land parcel identifier (Khasra or Survey number).
 */
function compareParcelIdentifiers(sourceLand, targetLand) {
  const sourceKhasra = normalizeIdentifier(getFieldValue(sourceLand, 'khasraNumber') || getFieldValue(sourceLand, 'surveyNumber'));
  const targetKhasra = normalizeIdentifier(getFieldValue(targetLand, 'khasraNumber') || getFieldValue(targetLand, 'surveyNumber'));

  if (sourceKhasra && targetKhasra && sourceKhasra === targetKhasra) {
    return { matches: true, identifier: sourceKhasra, field: 'khasraNumber' };
  }

  return { matches: false, identifier: null };
}

/**
 * Checks if two records share a holding identifier (Khata number).
 */
function compareKhataIdentifiers(sourceLand, targetLand) {
  const sourceKhata = normalizeIdentifier(getFieldValue(sourceLand, 'khataNumber'));
  const targetKhata = normalizeIdentifier(getFieldValue(targetLand, 'khataNumber'));

  if (sourceKhata && targetKhata && sourceKhata === targetKhata) {
    return { matches: true, identifier: sourceKhata, field: 'khataNumber' };
  }

  return { matches: false, identifier: null };
}

/**
 * Detects duplicate records between a source document and a list of candidate documents.
 *
 * Rules:
 * 1. Self-matches are excluded.
 * 2. SHA-256 file hash match -> EXACT_DUPLICATE.
 * 3. Exact parcel ID + exact Khata ID + matching location + matching owner -> EXACT_DUPLICATE.
 * 4. Exact parcel ID + matching location + matching owner (Khata missing/differing) -> POSSIBLE_DUPLICATE.
 * 5. Exact Khata ID + matching location + matching owner (parcel missing) -> POSSIBLE_DUPLICATE.
 * 6. Matching owner ALONE does NOT declare duplicate.
 * 7. Missing identifiers never produce matches.
 * 8. Returns distinct matches without duplicate entries.
 */
function detectDuplicates(sourceDoc, candidateDocs = []) {
  const sourceId = String(sourceDoc._id || sourceDoc.id || '');
  const sourceHash = sourceDoc.fileMetadata?.sha256Hash;
  const sourceLand = sourceDoc.landDetails || {};
  const sourceOwner = normalizeText(getFieldValue(sourceLand, 'ownerName'));

  const matches = [];
  const seenDocIds = new Set();

  for (const candidate of candidateDocs) {
    const candidateId = String(candidate._id || candidate.id || '');
    if (!candidateId || candidateId === sourceId) continue;
    if (seenDocIds.has(candidateId)) continue;

    const candLand = candidate.landDetails || {};
    const candOwner = normalizeText(getFieldValue(candLand, 'ownerName'));
    const targetFilename = candidate.fileMetadata?.originalFilename || 'Document';

    // 1. SHA-256 exact file hash match
    if (sourceHash && candidate.fileMetadata?.sha256Hash && sourceHash === candidate.fileMetadata.sha256Hash) {
      matches.push({
        targetDocumentId: candidate._id,
        targetFilename,
        matchType: 'EXACT_DUPLICATE',
        matchedFields: ['fileMetadata.sha256Hash'],
        explanation: `Exact file duplicate: SHA-256 cryptographic checksum matches stored record #${candidateId}.`,
        detectedAt: new Date()
      });
      seenDocIds.add(candidateId);
      continue;
    }

    // Evaluate location match
    const locationComparison = compareLocations(sourceLand, candLand);
    if (!locationComparison.matches) {
      // Different or unknown location -> cannot be duplicate land record
      continue;
    }

    const parcelComp = compareParcelIdentifiers(sourceLand, candLand);
    const khataComp = compareKhataIdentifiers(sourceLand, candLand);
    const ownerMatches = Boolean(sourceOwner && candOwner && sourceOwner === candOwner);

    // Rule: Owner match ALONE is not a duplicate
    if (!parcelComp.matches && !khataComp.matches) {
      continue;
    }

    // Both Parcel and Khata match + location matches + owner matches
    if (parcelComp.matches && khataComp.matches && ownerMatches) {
      const matchedFields = ['khasraNumber', 'khataNumber', 'ownerName', ...locationComparison.matchedFields];
      matches.push({
        targetDocumentId: candidate._id,
        targetFilename,
        matchType: 'EXACT_DUPLICATE',
        matchedFields,
        explanation: `Exact record match: Identical land parcel (Khasra ${parcelComp.identifier}), Khata holding (${khataComp.identifier}), location, and owner name (${getFieldValue(sourceLand, 'ownerName')}).`,
        detectedAt: new Date()
      });
      seenDocIds.add(candidateId);
      continue;
    }

    // Parcel matches + location matches + owner matches (Khata missing or differs)
    if (parcelComp.matches && ownerMatches) {
      const matchedFields = ['khasraNumber', 'ownerName', ...locationComparison.matchedFields];
      matches.push({
        targetDocumentId: candidate._id,
        targetFilename,
        matchType: 'POSSIBLE_DUPLICATE',
        matchedFields,
        explanation: `Possible duplicate: Matches land parcel (${parcelComp.identifier}) and owner (${getFieldValue(sourceLand, 'ownerName')}) in ${locationComparison.matchedFields.map(f => getFieldValue(sourceLand, f)).filter(Boolean).join(', ')}.`,
        detectedAt: new Date()
      });
      seenDocIds.add(candidateId);
      continue;
    }

    // Khata matches + location matches + owner matches (Parcel missing or differs)
    if (khataComp.matches && ownerMatches) {
      const matchedFields = ['khataNumber', 'ownerName', ...locationComparison.matchedFields];
      matches.push({
        targetDocumentId: candidate._id,
        targetFilename,
        matchType: 'POSSIBLE_DUPLICATE',
        matchedFields,
        explanation: `Possible duplicate: Matches Khata holding (${khataComp.identifier}) and owner (${getFieldValue(sourceLand, 'ownerName')}) in ${locationComparison.matchedFields.map(f => getFieldValue(sourceLand, f)).filter(Boolean).join(', ')}.`,
        detectedAt: new Date()
      });
      seenDocIds.add(candidateId);
      continue;
    }

    // Both Parcel and Khata match in same location, but owner is empty in one record
    if (parcelComp.matches && khataComp.matches && (!sourceOwner || !candOwner)) {
      const matchedFields = ['khasraNumber', 'khataNumber', ...locationComparison.matchedFields];
      matches.push({
        targetDocumentId: candidate._id,
        targetFilename,
        matchType: 'POSSIBLE_DUPLICATE',
        matchedFields,
        explanation: `Possible duplicate: Identical parcel (${parcelComp.identifier}) and Khata (${khataComp.identifier}) in ${locationComparison.matchedFields.map(f => getFieldValue(sourceLand, f)).filter(Boolean).join(', ')}, but owner name is pending in one record.`,
        detectedAt: new Date()
      });
      seenDocIds.add(candidateId);
      continue;
    }
  }

  return {
    hasPotentialDuplicates: matches.length > 0,
    duplicateCount: matches.length,
    matches,
    lastAnalyzedAt: new Date()
  };
}

/**
 * Compares area values numerically when possible, considering unit.
 */
function areasConflict(sourceArea, candArea) {
  if (!sourceArea.value || !candArea.value) return false;

  const numSource = Number(sourceArea.value.replace(',', '.'));
  const numCand = Number(candArea.value.replace(',', '.'));

  const normUnitSource = normalizeText(sourceArea.unit);
  const normUnitCand = normalizeText(candArea.unit);

  // If units are specified and different, flag conflict
  if (normUnitSource && normUnitCand && normUnitSource !== normUnitCand) {
    return true;
  }

  // If both numeric, compare numbers with a small floating tolerance
  if (Number.isFinite(numSource) && Number.isFinite(numCand)) {
    return Math.abs(numSource - numCand) > 0.0001;
  }

  // Fallback string normalization
  return normalizeText(sourceArea.value) !== normalizeText(candArea.value);
}

/**
 * Detects cross-record conflicts between a source document and candidates.
 *
 * Rules:
 * 1. Compares records only when they share primary land identifier (Khasra/Survey) AND location.
 * 2. Compares owner names, land area, classification, and khata only when both records have values.
 * 3. Normalizes whitespace and letter case during comparison, preserving original stored values.
 * 4. Missing data is NOT treated as a conflict.
 * 5. Explanations reflect review warnings (e.g. mutations, subdivision, clerical differences).
 */
function detectConflicts(sourceDoc, candidateDocs = []) {
  const sourceId = String(sourceDoc._id || sourceDoc.id || '');
  const sourceLand = sourceDoc.landDetails || {};
  const conflicts = [];
  const seenDocIds = new Set();

  for (const candidate of candidateDocs) {
    const candidateId = String(candidate._id || candidate.id || '');
    if (!candidateId || candidateId === sourceId) continue;
    if (seenDocIds.has(candidateId)) continue;

    const candLand = candidate.landDetails || {};
    const targetFilename = candidate.fileMetadata?.originalFilename || 'Document';

    // Must share land parcel identifier (Khasra or Survey)
    const parcelComp = compareParcelIdentifiers(sourceLand, candLand);
    if (!parcelComp.matches) continue;

    // Must share location
    const locationComp = compareLocations(sourceLand, candLand);
    if (!locationComp.matches) continue;

    const conflictingFields = [];
    const sharedIdentifiers = [
      { field: parcelComp.field, value: getFieldValue(sourceLand, parcelComp.field) || parcelComp.identifier }
    ];
    locationComp.matchedFields.forEach(field => {
      sharedIdentifiers.push({ field, value: getFieldValue(sourceLand, field) });
    });

    // 1. Owner Name Conflict
    const sourceOwner = getFieldValue(sourceLand, 'ownerName');
    const candOwner = getFieldValue(candLand, 'ownerName');
    if (sourceOwner && candOwner && normalizeText(sourceOwner) !== normalizeText(candOwner)) {
      conflictingFields.push({
        field: 'ownerName',
        label: 'Owner Name',
        currentValue: sourceOwner,
        targetValue: candOwner,
        reason: `Different owner names recorded for parcel ${parcelComp.identifier}. This may reflect a title transfer, mutation, co-ownership, or spelling variation.`
      });
    }

    // 2. Land Area Conflict
    const sourceArea = getAreaDetails(sourceLand);
    const candArea = getAreaDetails(candLand);
    if (sourceArea.value && candArea.value && areasConflict(sourceArea, candArea)) {
      conflictingFields.push({
        field: 'landArea',
        label: 'Land Area',
        currentValue: `${sourceArea.value} ${sourceArea.unit}`.trim(),
        targetValue: `${candArea.value} ${candArea.unit}`.trim(),
        reason: `Different land area recorded for parcel ${parcelComp.identifier}. This may indicate plot subdivision, resurvey, or unit recording differences.`
      });
    }

    // 3. Land Classification Conflict
    const sourceClass = getFieldValue(sourceLand, 'landClassification');
    const candClass = getFieldValue(candLand, 'landClassification');
    if (sourceClass && candClass && normalizeText(sourceClass) !== normalizeText(candClass)) {
      conflictingFields.push({
        field: 'landClassification',
        label: 'Land Classification',
        currentValue: sourceClass,
        targetValue: candClass,
        reason: `Land classification discrepancy recorded for parcel ${parcelComp.identifier} (${sourceClass} vs ${candClass}).`
      });
    }

    // 4. Khata Number Conflict
    const sourceKhata = getFieldValue(sourceLand, 'khataNumber');
    const candKhata = getFieldValue(candLand, 'khataNumber');
    if (sourceKhata && candKhata && normalizeIdentifier(sourceKhata) !== normalizeIdentifier(candKhata)) {
      conflictingFields.push({
        field: 'khataNumber',
        label: 'Khata / Khewat Number',
        currentValue: sourceKhata,
        targetValue: candKhata,
        reason: `Differing Khata account numbers (${sourceKhata} vs ${candKhata}) associated with parcel ${parcelComp.identifier}.`
      });
    }

    if (conflictingFields.length > 0) {
      const summaryList = conflictingFields.map(f => f.label).join(', ');
      conflicts.push({
        targetDocumentId: candidate._id,
        targetFilename,
        sharedIdentifiers,
        conflictingFields,
        explanation: `Potential field variance on shared parcel (${parcelComp.identifier}) in ${locationComp.matchedFields.map(f => getFieldValue(sourceLand, f)).filter(Boolean).join(', ')}: ${summaryList}.`,
        severity: conflictingFields.some(f => f.field === 'ownerName' || f.field === 'landArea') ? 'WARNING' : 'INFO',
        detectedAt: new Date()
      });
      seenDocIds.add(candidateId);
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts,
    disclaimer: 'Cross-record conflicts indicate potential data variances or historical transactions requiring human review. They do not constitute proof of fraud or document invalidity.',
    lastAnalyzedAt: new Date()
  };
}

/**
 * Queries candidate documents from MongoDB using targeted indexed queries
 * to avoid unnecessary full-collection scans.
 * Enforces access control / privacy boundaries when options.userId is provided.
 */
async function findCandidateDocuments(DocumentModel, sourceDoc, options = {}) {
  const sourceId = sourceDoc._id;
  const sourceHash = sourceDoc.fileMetadata?.sha256Hash;
  const sourceLand = sourceDoc.landDetails || {};

  const sourceKhasra = getFieldValue(sourceLand, 'khasraNumber') || getFieldValue(sourceLand, 'surveyNumber');
  const sourceSurvey = getFieldValue(sourceLand, 'surveyNumber');
  const sourceKhata = getFieldValue(sourceLand, 'khataNumber');
  const sourceDistrict = getFieldValue(sourceLand, 'district');
  const sourceVillage = getFieldValue(sourceLand, 'village');

  const orConditions = [];

  // 1. SHA-256 match
  if (sourceHash) {
    orConditions.push({ 'fileMetadata.sha256Hash': sourceHash });
  }

  // 2. Khasra / Survey match with location filtering
  if (sourceKhasra) {
    const khasraRegex = new RegExp(`^\\s*${sourceKhasra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const condition = {
      $or: [
        { 'landDetails.khasraNumber.value': khasraRegex },
        { 'landDetails.surveyNumber.value': khasraRegex }
      ]
    };
    if (sourceDistrict) {
      condition['landDetails.district.value'] = new RegExp(`^\\s*${sourceDistrict.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    }
    orConditions.push(condition);
  }

  // 3. Khata match with location filtering
  if (sourceKhata) {
    const khataRegex = new RegExp(`^\\s*${sourceKhata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const condition = { 'landDetails.khataNumber.value': khataRegex };
    if (sourceDistrict) {
      condition['landDetails.district.value'] = new RegExp(`^\\s*${sourceDistrict.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    }
    orConditions.push(condition);
  }

  if (orConditions.length === 0) {
    return [];
  }

  const query = {
    _id: { $ne: sourceId },
    $or: orConditions
  };

  // Authorization / Privacy scoping:
  // If options.userId is passed and options.role !== 'admin' && options.role !== 'officer':
  // Exclude private documents owned by other users
  if (options.userId && options.role !== 'admin' && options.role !== 'officer') {
    query.$and = [
      {
        $or: [
          { 'accessControl.isPrivate': { $ne: true } },
          { 'accessControl.uploadedBy': options.userId }
        ]
      }
    ];
  } else if (!options.allowPrivateOfOthers) {
    // By default, do not leak other users' private documents
    if (options.userId) {
      query.$and = [
        {
          $or: [
            { 'accessControl.isPrivate': { $ne: true } },
            { 'accessControl.uploadedBy': options.userId }
          ]
        }
      ];
    } else {
      query['accessControl.isPrivate'] = { $ne: true };
    }
  }

  return await DocumentModel.find(query).limit(50);
}

/**
 * Runs the end-to-end duplicate and conflict detection pipeline.
 */
async function runDetectionPipeline(DocumentModel, sourceDoc, options = {}) {
  const candidateDocs = await findCandidateDocuments(DocumentModel, sourceDoc, options);
  const duplicateDetection = detectDuplicates(sourceDoc, candidateDocs);
  const conflictDetection = detectConflicts(sourceDoc, candidateDocs);

  return {
    duplicateDetection,
    conflictDetection,
    candidateCount: candidateDocs.length
  };
}

module.exports = {
  normalizeText,
  normalizeIdentifier,
  getFieldValue,
  getAreaDetails,
  compareLocations,
  compareParcelIdentifiers,
  compareKhataIdentifiers,
  detectDuplicates,
  detectConflicts,
  findCandidateDocuments,
  runDetectionPipeline
};
