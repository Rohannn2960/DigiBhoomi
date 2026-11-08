const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MandalBoundary = require('../models/MandalBoundary');

const METADATA_FILE_PATH = path.resolve(__dirname, '..', 'data', 'telangana_mandal_boundaries_metadata.json');
const GEOJSON_FILE_PATH = path.resolve(__dirname, '..', 'data', 'telangana_mandal_boundaries.geojson');

const MANDATORY_DISCLAIMER =
  'This validation checks administrative jurisdiction at the mandal level using the TGRAC Mandal Boundary dataset. ' +
  'Village-level boundaries, individual survey plots, cadastral ownership, and legal land title cannot be verified using this dataset.';

// In-memory cache for tracked metadata and GeoJSON hash with mtime + size invalidation
let cachedMetadataStats = { path: null, mtimeMs: null, size: null };
let cachedGeoJsonStats = { path: null, mtimeMs: null, size: null, sha256: null };
let cachedResult = null;

/**
 * Escapes characters for regular expressions to prevent regex injection.
 */
function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads dataset metadata dynamically from server/data/telangana_mandal_boundaries_metadata.json
 * and verifies it against the actual server/data/telangana_mandal_boundaries.geojson dataset.
 *
 * Caching & Safety:
 * - Uses mtimeMs and file size stats to avoid hashing the 27 MB GeoJSON file on every request.
 * - Computes and verifies the actual SHA-256 hash of the GeoJSON file against `geojson_sha256` in metadata.
 * - Returns `isAvailable: false` with error message if files are missing, corrupted, or hash mismatches.
 * - Never returns fallback metadata that could make an unverified dataset appear valid.
 */
function getDatasetMetadata(customMetadataPath = null, customGeoJsonPath = null) {
  const metaPath = customMetadataPath || METADATA_FILE_PATH;
  const geoPath = customGeoJsonPath || GEOJSON_FILE_PATH;

  if (!fs.existsSync(metaPath)) {
    return {
      isAvailable: false,
      error: `Metadata file not found at ${metaPath}`,
      source: null,
      layerId: null,
      layerName: null,
      crs: null,
      retrievalDate: null,
      featureCount: null,
      fingerprint: null,
      geojsonSha256: null
    };
  }

  if (!fs.existsSync(geoPath)) {
    return {
      isAvailable: false,
      error: `GeoJSON dataset file not found at ${geoPath}`,
      source: null,
      layerId: null,
      layerName: null,
      crs: null,
      retrievalDate: null,
      featureCount: null,
      fingerprint: null,
      geojsonSha256: null
    };
  }

  try {
    const metaStats = fs.statSync(metaPath);
    const geoStats = fs.statSync(geoPath);

    const isCacheValid = cachedResult &&
      cachedMetadataStats.path === metaPath &&
      cachedMetadataStats.mtimeMs === metaStats.mtimeMs &&
      cachedMetadataStats.size === metaStats.size &&
      cachedGeoJsonStats.path === geoPath &&
      cachedGeoJsonStats.mtimeMs === geoStats.mtimeMs &&
      cachedGeoJsonStats.size === geoStats.size;

    if (isCacheValid) {
      return cachedResult;
    }

    const rawMeta = fs.readFileSync(metaPath, 'utf8');
    const data = JSON.parse(rawMeta);

    if (!data.geojson_sha256 || typeof data.geojson_sha256 !== 'string') {
      return {
        isAvailable: false,
        error: "Dataset metadata is missing 'geojson_sha256' fingerprint field.",
        source: null,
        layerId: null,
        layerName: null,
        crs: null,
        retrievalDate: null,
        featureCount: null,
        fingerprint: null,
        geojsonSha256: null
      };
    }

    let geoSha256;
    if (
      cachedGeoJsonStats.path === geoPath &&
      cachedGeoJsonStats.mtimeMs === geoStats.mtimeMs &&
      cachedGeoJsonStats.size === geoStats.size &&
      cachedGeoJsonStats.sha256
    ) {
      geoSha256 = cachedGeoJsonStats.sha256;
    } else {
      const geoRaw = fs.readFileSync(geoPath);
      geoSha256 = crypto.createHash('sha256').update(geoRaw).digest('hex');
      cachedGeoJsonStats = {
        path: geoPath,
        mtimeMs: geoStats.mtimeMs,
        size: geoStats.size,
        sha256: geoSha256
      };
    }

    if (geoSha256 !== data.geojson_sha256) {
      return {
        isAvailable: false,
        error: `GeoJSON dataset hash mismatch: file hash '${geoSha256}' does not match metadata fingerprint '${data.geojson_sha256}'.`,
        source: data.source_url || null,
        layerId: typeof data.layer_id === 'number' ? data.layer_id : null,
        layerName: data.layer_name || null,
        crs: data.coordinate_reference_system || null,
        retrievalDate: data.retrieval_date || null,
        featureCount: typeof data.successfully_downloaded_features === 'number' ? data.successfully_downloaded_features : null,
        fingerprint: null,
        geojsonSha256: null
      };
    }

    const metadata = {
      isAvailable: true,
      error: null,
      source: data.source_url || null,
      layerId: typeof data.layer_id === 'number' ? data.layer_id : null,
      layerName: data.layer_name || null,
      crs: data.coordinate_reference_system || null,
      sourceCrs: data.source_spatial_reference || null,
      retrievalDate: data.retrieval_date || null,
      featureCount: typeof data.successfully_downloaded_features === 'number' ? data.successfully_downloaded_features : null,
      fingerprint: geoSha256,
      geojsonSha256: geoSha256
    };

    cachedMetadataStats = {
      path: metaPath,
      mtimeMs: metaStats.mtimeMs,
      size: metaStats.size
    };
    cachedResult = metadata;

    return metadata;
  } catch (err) {
    return {
      isAvailable: false,
      error: `Failed to parse or verify dataset metadata: ${err.message}`,
      source: null,
      layerId: null,
      layerName: null,
      crs: null,
      retrievalDate: null,
      featureCount: null,
      fingerprint: null,
      geojsonSha256: null
    };
  }
}

/**
 * Extracts and trims district and mandal identifiers from document landDetails.
 *
 * Rules:
 * - Prefers landDetails.tehsil.value; falls back to legacy landDetails.mandal.value only
 *   when tehsil is empty after trimming.
 * - Trims whitespace without mutating the original document fields.
 */
function extractAdministrativeIdentifiers(landDetails = {}) {
  const rawDistrict = typeof landDetails?.district?.value === 'string' ? landDetails.district.value : '';
  const district = rawDistrict.trim();

  const rawTehsil = typeof landDetails?.tehsil?.value === 'string' ? landDetails.tehsil.value : '';
  const tehsilTrimmed = rawTehsil.trim();

  let mandal = '';
  if (tehsilTrimmed.length > 0) {
    mandal = tehsilTrimmed;
  } else {
    const rawMandal = typeof landDetails?.mandal?.value === 'string' ? landDetails.mandal.value : '';
    mandal = rawMandal.trim();
  }

  const rawVillage = typeof landDetails?.village?.value === 'string' ? landDetails.village.value : '';
  const village = rawVillage.trim();

  return {
    district,
    mandal,
    village
  };
}

/**
 * Checks whether stored GIS validation metadata is stale compared to the current reference dataset.
 * Compares both the content SHA-256 fingerprint and the retrievalDate.
 */
function checkValidationStaleness(storedMetadata, currentMetadata = null) {
  const current = currentMetadata || getDatasetMetadata();
  if (!current.isAvailable || !storedMetadata) {
    if (!current.isAvailable && storedMetadata) {
      return {
        isStale: true,
        staleReason: 'The reference boundary dataset is currently unavailable or corrupted. Re-validation cannot be confirmed.'
      };
    }
    return { isStale: false, staleReason: null };
  }

  const storedFingerprint = storedMetadata.fingerprint;
  const currentFingerprint = current.fingerprint;

  if (storedFingerprint && currentFingerprint && storedFingerprint !== currentFingerprint) {
    return {
      isStale: true,
      staleReason: 'The reference cadastral dataset has been updated since this document was validated. Re-validation recommended.'
    };
  }

  const storedDate = storedMetadata.retrievalDate;
  const currentDate = current.retrievalDate;

  if (storedDate && currentDate && storedDate !== currentDate) {
    return {
      isStale: true,
      staleReason: 'The reference dataset retrieval date differs from the version used during validation. Re-validation recommended.'
    };
  }

  return { isStale: false, staleReason: null };
}

/**
 * Validates document administrative jurisdiction against the MandalBoundary collection.
 *
 * Requirements:
 * - Fails safely with UNABLE_TO_VERIFY if reference dataset is unavailable or corrupted.
 * - Both district and mandal must match using anchored, case-insensitive regexes (^...$).
 * - Requires exactly one matching boundary. If multiple matches occur, returns an ambiguity discrepancy (never selects matches[0]).
 * - If the district/mandal pair does not match, queries the dataset for verified candidate districts where the mandal exists.
 * - Returns boundary geometry separately from the document metadata.
 */
async function validateAdministrativeJurisdiction(landDetails = {}) {
  const { district, mandal, village } = extractAdministrativeIdentifiers(landDetails);
  const metadata = getDatasetMetadata();

  const documentIdentifiers = {
    district,
    mandal,
    village: village || null
  };

  // Fail safely if the underlying dataset is missing, corrupted, or hash-mismatched
  if (!metadata.isAvailable) {
    return {
      status: 'UNABLE_TO_VERIFY',
      matchedMandal: null,
      boundary: null,
      datasetMetadata: null,
      documentIdentifiers,
      discrepancies: [{
        field: 'dataset_integrity',
        documentValue: '',
        gisValue: null,
        severity: 'CRITICAL',
        message: `Administrative GIS dataset integrity verification failed: ${metadata.error || 'Dataset unavailable or hash mismatch.'}`
      }]
    };
  }

  const datasetMetadata = {
    source: metadata.source,
    layerId: metadata.layerId,
    layerName: metadata.layerName,
    crs: metadata.crs,
    retrievalDate: metadata.retrievalDate,
    featureCount: metadata.featureCount,
    fingerprint: metadata.fingerprint
  };

  // Case A: Missing District or Mandal
  if (!district && !mandal) {
    return {
      status: 'UNABLE_TO_VERIFY',
      matchedMandal: null,
      boundary: null,
      datasetMetadata,
      documentIdentifiers,
      discrepancies: [{
        field: 'district_and_mandal',
        documentValue: '',
        gisValue: null,
        severity: 'CRITICAL',
        message: 'Both District and Mandal (tehsil) are missing from document extracted data.'
      }]
    };
  }

  if (!district) {
    return {
      status: 'UNABLE_TO_VERIFY',
      matchedMandal: null,
      boundary: null,
      datasetMetadata,
      documentIdentifiers,
      discrepancies: [{
        field: 'district',
        documentValue: '',
        gisValue: null,
        severity: 'CRITICAL',
        message: 'District is required to perform GIS mandal boundary matching.'
      }]
    };
  }

  if (!mandal) {
    return {
      status: 'UNABLE_TO_VERIFY',
      matchedMandal: null,
      boundary: null,
      datasetMetadata,
      documentIdentifiers,
      discrepancies: [{
        field: 'mandal',
        documentValue: '',
        gisValue: null,
        severity: 'CRITICAL',
        message: 'Mandal (tehsil) is required to perform GIS mandal boundary matching.'
      }]
    };
  }

  // Safe anchored regexes with input escaping
  const districtRegex = new RegExp(`^${escapeRegex(district)}$`, 'i');
  const mandalRegex = new RegExp(`^${escapeRegex(mandal)}$`, 'i');

  const matches = await MandalBoundary.find({
    district: districtRegex,
    mandal: mandalRegex
  }).lean();

  // Case B: Exactly one match -> MATCHED
  if (matches.length === 1) {
    const matchedDoc = matches[0];
    const matchedMandal = {
      objectId: matchedDoc.objectId,
      district: matchedDoc.district,
      mandal: matchedDoc.mandal,
      mandalType: matchedDoc.mandalType,
      revenueDivision: matchedDoc.revenueDivision,
      districtTelugu: matchedDoc.districtTelugu || null,
      mandalTelugu: matchedDoc.mandalTelugu || null,
      dcode: matchedDoc.dcode != null ? matchedDoc.dcode : null,
      shapeArea: matchedDoc.shapeArea != null ? matchedDoc.shapeArea : null,
      shapeLength: matchedDoc.shapeLength != null ? matchedDoc.shapeLength : null
    };

    const boundary = {
      type: 'Feature',
      geometry: matchedDoc.geometry,
      properties: {
        objectId: matchedDoc.objectId,
        district: matchedDoc.district,
        mandal: matchedDoc.mandal,
        mandalType: matchedDoc.mandalType,
        revenueDivision: matchedDoc.revenueDivision
      }
    };

    return {
      status: 'MATCHED',
      matchedMandal,
      boundary,
      datasetMetadata,
      documentIdentifiers,
      discrepancies: []
    };
  }

  // Case C: Multiple matches -> Ambiguity Discrepancy (NEVER select matches[0])
  if (matches.length > 1) {
    return {
      status: 'POTENTIAL_DISCREPANCY',
      matchedMandal: null,
      boundary: null,
      datasetMetadata,
      documentIdentifiers,
      discrepancies: [{
        field: 'district_and_mandal',
        documentValue: `${district} / ${mandal}`,
        gisValue: null,
        severity: 'WARNING',
        message: `Ambiguous match: multiple (${matches.length}) boundary records matched district '${district}' and mandal '${mandal}'. Cannot safely resolve a single administrative unit.`
      }]
    };
  }

  // Case D: Zero matches (matches.length === 0)
  // Dynamically investigate candidates in MandalBoundary
  const candidateMatches = await MandalBoundary.find(
    { mandal: mandalRegex },
    { district: 1 }
  ).lean();

  const districtExists = await MandalBoundary.exists({ district: districtRegex });

  if (candidateMatches.length > 0) {
    // Mandal exists, but belongs to other district(s) in Telangana
    const verifiedDistricts = [...new Set(candidateMatches.map(c => c.district))].sort();
    return {
      status: 'POTENTIAL_DISCREPANCY',
      matchedMandal: null,
      boundary: null,
      datasetMetadata,
      documentIdentifiers,
      discrepancies: [{
        field: 'mandal',
        documentValue: mandal,
        gisValue: null,
        severity: 'WARNING',
        message: `Mandal '${mandal}' does not belong to district '${district}'. In Telangana, '${mandal}' is located in: [${verifiedDistricts.join(', ')}].`
      }]
    };
  }

  // Mandal does not exist in any Telangana district
  const discrepancies = [];
  if (!districtExists) {
    discrepancies.push({
      field: 'district',
      documentValue: district,
      gisValue: null,
      severity: 'WARNING',
      message: `District '${district}' is not a recognized Telangana district.`
    });
  }

  discrepancies.push({
    field: 'mandal',
    documentValue: mandal,
    gisValue: null,
    severity: 'WARNING',
    message: districtExists
      ? `Mandal '${mandal}' was not found in district '${district}' or any other Telangana district.`
      : `Mandal '${mandal}' was not found in any Telangana district.`
  });

  return {
    status: 'POTENTIAL_DISCREPANCY',
    matchedMandal: null,
    boundary: null,
    datasetMetadata,
    documentIdentifiers,
    discrepancies
  };
}

module.exports = {
  MANDATORY_DISCLAIMER,
  METADATA_FILE_PATH,
  GEOJSON_FILE_PATH,
  escapeRegex,
  getDatasetMetadata,
  extractAdministrativeIdentifiers,
  checkValidationStaleness,
  validateAdministrativeJurisdiction
};
