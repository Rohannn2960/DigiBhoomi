/**
 * DigiBhoomi Document Comparison Service
 * Compares any two distinct uploaded documents across extracted land attributes and metadata.
 *
 * Rules:
 * 1. Supports any two distinct documents, including unrelated documents.
 * 2. Does not assume two records refer to the same land parcel merely because some fields match.
 * 3. Compares semantically equivalent fields even when labels or structures vary.
 * 4. Land-area comparison implements actual numeric unit normalization for Acre, Hectare, and Gunta
 *    using a canonical Acre representation with documented floating-point tolerance.
 * 5. If land-area unit is missing, unsupported, or ambiguous, comparison is marked as incomparable
 *    or requiring review without assuming equivalence.
 * 6. Land attributes are cleanly separated from document metadata. Land-record fields determine
 *    the discrepancy counts. Metadata differences (filename, hash, upload date) are isolated.
 * 7. Custom/unmapped fields are clearly distinguished: matching custom keys present in both are compared,
 *    and unshared custom fields are marked as missing in either document rather than falsely merged.
 * 8. Preserves original extracted values and field-level confidence without modifying either document.
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
 * Safely serializes objects or arrays without crashing on circular structures.
 */
function safeStringify(val) {
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

/**
 * Safely formats a scalar value for display without treating 0 or false as empty.
 * Returns fallback only when val is null, undefined, or empty/whitespace string.
 *
 * @param {*} val
 * @param {string} fallback
 * @returns {string}
 */
function formatScalarDisplayValue(val, fallback = '(Not provided)') {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'boolean' || typeof val === 'number') {
    return String(val);
  }
  const s = String(val).trim();
  if (s === '') return fallback;
  return s;
}

/**
 * Normalizes Mongoose documents and subdocuments to plain JS objects so
 * SchemaType defaults, persisted unmapped keys, and nested subdocuments
 * behave identically to plain JavaScript objects without mutating originals.
 */
function toPlainData(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  if ((obj.$__ || obj._doc) && typeof obj.toObject === 'function') {
    return obj.toObject({ getters: false, virtuals: false, flattenMaps: true });
  }
  return obj;
}

/**
 * Resolves the authoritative assigned reviewing officer ID from a document,
 * preferring the schema's ObjectId `assignedOfficerId` field (including populated
 * user objects) with fallback to legacy `assignedOfficer` / `assignedTo`.
 */
function resolveAssignedOfficerId(doc) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  const candidates = [doc.assignedOfficerId, doc.assignedOfficer, doc.assignedTo];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === 'object') {
      if (typeof candidate.toHexString === 'function' || candidate._bsontype === 'ObjectId') {
        const str = String(candidate).trim();
        if (str) return str;
        continue;
      }
      if (candidate._id !== undefined && candidate._id !== null) {
        const str = String(candidate._id).trim();
        if (str) return str;
        continue;
      }
      if (candidate.id !== undefined && candidate.id !== null) {
        const str = String(candidate.id).trim();
        if (str) return str;
        continue;
      }
    }
    const str = String(candidate).trim();
    if (str) return str;
  }
  return null;
}

/**
 * Normalizes supported unit names to canonical casing.
 * Returns raw trimmed string for unsupported units.
 *
 * @param {string} unitStr
 * @returns {string|null}
 */
function normalizeUnitName(unitStr) {
  if (!unitStr || typeof unitStr !== 'string') return null;
  const clean = unitStr.trim().toLowerCase();
  if (clean === 'acre' || clean === 'acres' || clean === 'ac') {
    return 'Acre';
  }
  if (clean === 'hectare' || clean === 'hectares' || clean === 'ha') {
    return 'Hectare';
  }
  if (clean === 'gunta' || clean === 'guntas' || clean === 'guntha' || clean === 'gunthas') {
    return 'Gunta';
  }
  return unitStr.trim();
}

/**
 * Checks whether a trimmed string matches a strictly valid positive numeric format.
 * Allows:
 *   - Plain integers or decimals: "2.5", "100", "0.5"
 *   - Leading dot decimals: ".5", ".25"
 *   - Standard comma-separated: "1,250", "1,250.5", "1,250,000"
 *   - Indian numbering comma-separated: "1,00,000", "10,50,000"
 * Disallows:
 *   - Negative numbers
 *   - Multiple decimals (".5.5", "2.5.5")
 *   - Misplaced commas ("1,25", "1,,250", "1,250,")
 *   - Alphanumeric strings ("12a34", "2.5foo")
 *
 * @param {string} str
 * @returns {boolean}
 */
function isValidPositiveNumericString(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!s) return false;

  const standardNum = /^\d+(\.\d+)?$/;
  const leadingDotNum = /^\.\d+$/;
  const standardCommaNum = /^\d{1,3}(?:,\d{3})+(\.\d+)?$/;
  const indianCommaNum = /^\d{1,2}(?:,\d{2})+,\d{3}(\.\d+)?$/;

  return standardNum.test(s) || leadingDotNum.test(s) || standardCommaNum.test(s) || indianCommaNum.test(s);
}

/**
 * Land-Area Unit Normalization Constants
 * Canonical Internal Unit: Acre
 * Approximately:
 *   1 Hectare = 2.4710538 Acres
 *   1 Acre = 40 Guntas => 1 Gunta = 0.025 Acres
 *
 * Documented Floating-Point Tolerance:
 *   AREA_TOLERANCE_ACRES = 0.002 Acres (~8.09 sq. meters).
 *   This is a strict, fixed bounded tolerance that accounts for rounding in
 *   standard 2-3 decimal place conversions while preventing false equivalences
 *   at small, medium, and large land extents.
 */
const CANONICAL_AREA_UNIT = 'Acre';
const ACRES_PER_HECTARE = 2.4710538;
const GUNTAS_PER_ACRE = 40;
const ACRES_PER_GUNTA = 1 / GUNTAS_PER_ACRE; // 0.025
const AREA_TOLERANCE_ACRES = 0.002;
const SUPPORTED_AREA_UNITS = new Set(['Acre', 'Hectare', 'Gunta']);

/**
 * Parses and extracts numeric value and unit from landArea field.
 * Handles objects ({ value, unit }), strings ("2.5 Acre", ".5 Acre", "1,250 Acres"),
 * and unitless inputs. Hardened against negative numbers, malformed commas, partially
 * numeric strings, and conflicting units.
 *
 * @param {Object|string} fieldObj
 * @returns {Object} { numeric, unit, rawDisplay, confidence, error, embeddedUnit, explicitUnit }
 */
function parseLandArea(fieldObj) {
  if (fieldObj === null || fieldObj === undefined) {
    return { numeric: null, unit: null, rawDisplay: '(Not provided)', confidence: null, error: 'missing' };
  }

  // Pre-flagged conflicting units from resolver
  if (typeof fieldObj === 'object' && !Array.isArray(fieldObj) && fieldObj.error === 'conflicting_units') {
    const valRaw = fieldObj.value !== undefined && fieldObj.value !== null ? fieldObj.value : '';
    const valStr = String(valRaw).trim();
    const conf = typeof fieldObj.confidence === 'number' && Number.isFinite(fieldObj.confidence) ? fieldObj.confidence : null;
    let parsedNum = null;
    if (typeof valRaw === 'number') {
      parsedNum = valRaw;
    } else {
      const match = valStr.match(/^((?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)/);
      if (match) {
        const n = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(n) && Number.isFinite(n)) {
          parsedNum = n;
        }
      }
    }
    return {
      numeric: parsedNum,
      unit: null,
      embeddedUnit: fieldObj.embeddedUnit || fieldObj.areaUnit || null,
      explicitUnit: fieldObj.explicitUnit || null,
      conflictDetails: fieldObj.conflictDetails || null,
      rawDisplay: fieldObj.rawDisplay || `${valStr} (conflicting units)`,
      confidence: conf,
      error: 'conflicting_units'
    };
  }

  // Container landDetails object passed directly to parseLandArea
  if (
    typeof fieldObj === 'object' &&
    !Array.isArray(fieldObj) &&
    fieldObj.value === undefined &&
    fieldObj.numeric === undefined &&
    (fieldObj.landArea !== undefined || fieldObj.area !== undefined || fieldObj.extent !== undefined)
  ) {
    const resolved = resolveLandAreaRepresentation(fieldObj);
    return parseLandArea(resolved);
  }

  let valRaw = '';
  let unitRaw = '';
  let conf = null;

  if (typeof fieldObj === 'object' && !Array.isArray(fieldObj)) {
    valRaw = fieldObj.value !== undefined && fieldObj.value !== null ? fieldObj.value : '';
    unitRaw = fieldObj.unit !== undefined && fieldObj.unit !== null ? String(fieldObj.unit).trim() : '';
    if (typeof fieldObj.confidence === 'number' && Number.isFinite(fieldObj.confidence)) {
      conf = fieldObj.confidence;
    }
  } else if (Array.isArray(fieldObj)) {
    return {
      numeric: null,
      unit: null,
      rawDisplay: safeStringify(fieldObj),
      confidence: null,
      error: 'invalid_numeric'
    };
  } else {
    valRaw = fieldObj;
  }

  // Check for primitive numeric negative
  if (typeof valRaw === 'number') {
    if (valRaw < 0) {
      return {
        numeric: null,
        unit: unitRaw ? normalizeUnitName(unitRaw) : null,
        rawDisplay: `${valRaw}${unitRaw ? ' ' + unitRaw : ''}`,
        confidence: conf,
        error: 'negative_numeric'
      };
    }
  }

  const valStr = String(valRaw).trim();
  if (!valStr) {
    return { numeric: null, unit: null, rawDisplay: '(Not provided)', confidence: conf, error: 'empty' };
  }

  // Check for string-based negative
  if (/^-\s*(\d|\.\d)/.test(valStr)) {
    return {
      numeric: null,
      unit: unitRaw ? normalizeUnitName(unitRaw) : null,
      rawDisplay: valStr,
      confidence: conf,
      error: 'negative_numeric'
    };
  }

  // Match leading numeric token (plain integer/decimal, leading dot, or valid comma format)
  // and capture any remaining suffix
  const areaPattern = /^((?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:\s*(.*))?$/;
  const match = valStr.match(areaPattern);

  if (!match) {
    return {
      numeric: null,
      unit: unitRaw ? normalizeUnitName(unitRaw) : null,
      rawDisplay: valStr,
      confidence: conf,
      error: 'invalid_numeric'
    };
  }

  const numPart = match[1];
  const embeddedUnitCandidate = match[2] ? match[2].trim() : '';

  // Validate that the matched numeric part is strictly valid positive numeric
  if (!isValidPositiveNumericString(numPart)) {
    return {
      numeric: null,
      unit: unitRaw ? normalizeUnitName(unitRaw) : null,
      rawDisplay: valStr,
      confidence: conf,
      error: 'invalid_numeric'
    };
  }

  // If there is an embedded unit candidate, validate that it does NOT contain digits or invalid punctuation
  if (embeddedUnitCandidate) {
    if (/\d/.test(embeddedUnitCandidate) || !/^[a-zA-Z\s.]+$/.test(embeddedUnitCandidate)) {
      return {
        numeric: null,
        unit: unitRaw ? normalizeUnitName(unitRaw) : null,
        rawDisplay: valStr,
        confidence: conf,
        error: 'invalid_numeric'
      };
    }

    // If unit candidate was directly attached without space (e.g., "2.5Acre" vs "2.5foo"),
    // require that it normalizes to a supported unit
    const hadLeadingSpace = match[0].slice(numPart.length).startsWith(' ');
    if (!hadLeadingSpace) {
      const normalizedCandidate = normalizeUnitName(embeddedUnitCandidate);
      if (!SUPPORTED_AREA_UNITS.has(normalizedCandidate)) {
        return {
          numeric: null,
          unit: unitRaw ? normalizeUnitName(unitRaw) : null,
          rawDisplay: valStr,
          confidence: conf,
          error: 'invalid_numeric'
        };
      }
    }
  }

  // Safely parse number removing commas
  const parsedNum = parseFloat(numPart.replace(/,/g, ''));
  if (isNaN(parsedNum) || !isFinite(parsedNum) || parsedNum < 0) {
    return {
      numeric: null,
      unit: unitRaw ? normalizeUnitName(unitRaw) : null,
      rawDisplay: valStr,
      confidence: conf,
      error: parsedNum < 0 ? 'negative_numeric' : 'invalid_numeric'
    };
  }

  // Normalize embedded unit and explicit unit
  const normEmbedded = embeddedUnitCandidate ? normalizeUnitName(embeddedUnitCandidate) : null;
  const normExplicit = unitRaw ? normalizeUnitName(unitRaw) : null;

  // Verify that embedded unit in value and explicit unit property agree
  if (normEmbedded && normExplicit) {
    if (normEmbedded.toLowerCase() !== normExplicit.toLowerCase()) {
      return {
        numeric: parsedNum,
        unit: null,
        embeddedUnit: normEmbedded,
        explicitUnit: normExplicit,
        rawDisplay: `${valStr} (conflicting unit property: "${unitRaw}")`,
        confidence: conf,
        error: 'conflicting_units'
      };
    }
  }

  const finalUnit = normExplicit || normEmbedded || null;

  // Build raw display preserving original expression
  let rawDisplay = valStr;
  if (finalUnit && !valStr.toLowerCase().includes(finalUnit.toLowerCase())) {
    rawDisplay = `${valStr} ${finalUnit}`;
  }

  // Explicitly reject zero land area: numeric 0, "0", "0.0", "0 Acre"
  if (parsedNum === 0) {
    return {
      numeric: 0,
      unit: finalUnit,
      rawDisplay,
      confidence: conf,
      error: 'zero_area'
    };
  }

  return {
    numeric: parsedNum,
    unit: finalUnit,
    rawDisplay,
    confidence: conf,
    error: !finalUnit ? 'missing_unit' : null
  };
}

/**
 * Converts a numeric area and supported unit into canonical Acres.
 *
 * @param {number} numeric
 * @param {string} unit 'Acre' | 'Hectare' | 'Gunta'
 * @returns {number|null}
 */
function convertToCanonicalAcres(numeric, unit) {
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return null;
  if (unit === 'Acre') return numeric;
  if (unit === 'Hectare') return numeric * ACRES_PER_HECTARE;
  if (unit === 'Gunta') return numeric * ACRES_PER_GUNTA;
  return null;
}

/**
 * Resolves the actual populated land-area representation from landDetails in prioritized order:
 * 1. Prefer landDetails.landArea when its value is non-empty.
 * 2. Otherwise use landDetails.area when its value is non-empty, combining it with landDetails.areaUnit.value as explicit unit.
 * 3. Otherwise use populated legacy landDetails.extent.
 * 4. Return null if none contains an area value (treated as missing).
 *
 * Guarantees:
 * - Empty default landArea object (e.g. { value: '', unit: 'Acre' }) does NOT mask populated area.
 * - Confidence is preserved.
 * - Embedded units in value are preserved for conflict detection.
 * - Missing areaUnit does not silently assume Acre.
 * - Respects explicitly populated canonical landArea.unit.
 * - Safe for Mongoose documents and plain objects.
 * - Pure read-only, does not mutate inputs.
 *
 * @param {Object} landDetails
 * @returns {Object|null}
 */
function resolveLandAreaRepresentation(landDetails) {
  if (!landDetails || typeof landDetails !== 'object') {
    return null;
  }
  landDetails = toPlainData(landDetails);

  function getProp(obj, prop) {
    obj = toPlainData(obj);
    if (!obj || typeof obj !== 'object') return undefined;
    if (typeof obj.get === 'function') {
      const val = obj.get(prop);
      if (val !== undefined) return val;
    }
    return obj[prop];
  }

  function extractCandidate(field) {
    if (field === null || field === undefined) return null;

    let val = null;
    let unit = null;
    let conf = null;
    let rawOcr = null;

    if (typeof field === 'object' && !Array.isArray(field)) {
      const fieldVal = getProp(field, 'value');
      if (fieldVal !== undefined && fieldVal !== null) {
        const s = String(fieldVal).trim();
        if (s !== '') {
          val = fieldVal;
        }
      }
      const fieldUnit = getProp(field, 'unit');
      if (fieldUnit !== undefined && fieldUnit !== null) {
        const u = String(fieldUnit).trim();
        if (u !== '') {
          unit = u;
        }
      }
      const fieldConf = getProp(field, 'confidence');
      if (typeof fieldConf === 'number' && Number.isFinite(fieldConf)) {
        conf = fieldConf;
      }
      rawOcr = getProp(field, 'rawOcrText') || getProp(field, 'rawText') || null;
    } else if (typeof field === 'string' || typeof field === 'number') {
      const s = String(field).trim();
      if (s !== '') {
        val = field;
      }
    }

    if (val === null) return null;
    return { value: val, unit, confidence: conf, rawOcrText: rawOcr };
  }

  // 1. Prefer landDetails.landArea when its value is non-empty
  const candLandArea = extractCandidate(getProp(landDetails, 'landArea'));
  if (candLandArea) {
    return candLandArea;
  }

  // 2. Otherwise use landDetails.area when its value is non-empty
  const candArea = extractCandidate(getProp(landDetails, 'area'));
  if (candArea) {
    let explicitUnit = null;
    let unitConf = null;

    const areaUnitField = getProp(landDetails, 'areaUnit') || getProp(landDetails, 'area_unit');
    if (areaUnitField !== undefined && areaUnitField !== null) {
      if (typeof areaUnitField === 'object' && !Array.isArray(areaUnitField)) {
        const uVal = getProp(areaUnitField, 'value') !== undefined && getProp(areaUnitField, 'value') !== null
          ? String(getProp(areaUnitField, 'value')).trim()
          : (getProp(areaUnitField, 'unit') ? String(getProp(areaUnitField, 'unit')).trim() : '');
        if (uVal !== '') {
          explicitUnit = uVal;
        }
        const uConf = getProp(areaUnitField, 'confidence');
        if (typeof uConf === 'number' && Number.isFinite(uConf)) {
          unitConf = uConf;
        }
      } else {
        const uVal = String(areaUnitField).trim();
        if (uVal !== '') {
          explicitUnit = uVal;
        }
      }
    }

    const normAreaUnit = candArea.unit ? normalizeUnitName(candArea.unit) : null;
    const normExplicitUnit = explicitUnit ? normalizeUnitName(explicitUnit) : null;
    const finalConf = candArea.confidence !== null ? candArea.confidence : unitConf;

    // Verify whether both unit sources agree if both are populated
    if (normAreaUnit && normExplicitUnit) {
      if (normAreaUnit.toLowerCase() !== normExplicitUnit.toLowerCase()) {
        const valStr = String(candArea.value).trim();
        return {
          value: candArea.value,
          unit: null,
          areaUnit: normAreaUnit,
          explicitUnit: normExplicitUnit,
          embeddedUnit: normAreaUnit,
          conflictDetails: `area.unit "${normAreaUnit}" vs areaUnit.value "${normExplicitUnit}"`,
          rawDisplay: `${valStr} (conflicting units: area.unit "${normAreaUnit}" vs areaUnit.value "${normExplicitUnit}")`,
          confidence: finalConf,
          rawOcrText: candArea.rawOcrText,
          error: 'conflicting_units'
        };
      }
    }

    // If only one is populated, use that unit. If neither is populated, keep unit missing (null).
    // Do NOT silently assume Acre!
    const finalUnit = normExplicitUnit || normAreaUnit || null;

    return {
      value: candArea.value,
      unit: finalUnit,
      areaUnit: normAreaUnit,
      explicitUnit: normExplicitUnit,
      confidence: finalConf,
      rawOcrText: candArea.rawOcrText
    };
  }

  // 3. Otherwise use legacy landDetails.extent
  const candExtent = extractCandidate(getProp(landDetails, 'extent'));
  if (candExtent) {
    return candExtent;
  }

  // 4. None contains an area value
  return null;
}

/**
 * Performs rigorous numeric land-area comparison between two document fields.
 *
 * @param {Object} fieldObj1 Field from Document A
 * @param {Object} fieldObj2 Field from Document B
 * @returns {Object} Comparison result
 */
function compareLandAreas(fieldObj1, fieldObj2) {
  const parsedA = parseLandArea(fieldObj1);
  const parsedB = parseLandArea(fieldObj2);

  const rawA = parsedA.rawDisplay;
  const rawB = parsedB.rawDisplay;
  const confA = parsedA.confidence;
  const confB = parsedB.confidence;

  const hasA = parsedA.error !== 'missing' && parsedA.error !== 'empty';
  const hasB = parsedB.error !== 'missing' && parsedB.error !== 'empty';

  // 1. Missing in either or both
  if (!hasA && !hasB) {
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'NOT_RECORDED',
      statusLabel: 'Not Recorded in Either',
      changeCategory: 'not_recorded',
      explanation: 'Land area was not extracted or recorded in either document.'
    };
  }

  if (hasA && !hasB) {
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'MISSING_IN_B',
      statusLabel: 'Missing in Document B',
      changeCategory: 'missing_in_b',
      explanation: 'Land area is present in Document A but missing or unextracted in Document B.'
    };
  }

  if (!hasA && hasB) {
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'MISSING_IN_A',
      statusLabel: 'Missing in Document A',
      changeCategory: 'missing_in_a',
      explanation: 'Land area is present in Document B but missing or unextracted in Document A.'
    };
  }

  // 2. Both documents provide an area expression: Validate negative, zero, and numeric validity
  if (parsedA.error === 'negative_numeric' || parsedB.error === 'negative_numeric') {
    const negDocs = [];
    if (parsedA.error === 'negative_numeric') negDocs.push(`Document A ("${rawA}")`);
    if (parsedB.error === 'negative_numeric') negDocs.push(`Document B ("${rawB}")`);
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'INCOMPARABLE',
      statusLabel: 'Incomparable / Negative Value',
      changeCategory: 'incomparable',
      explanation: `Land area expression in ${negDocs.join(' and ')} is negative. Land extents cannot be negative. Manual review required.`
    };
  }

  // Reject zero land area with explicit error (not treated as missing)
  if (parsedA.error === 'zero_area' || parsedB.error === 'zero_area') {
    const zeroDocs = [];
    if (parsedA.error === 'zero_area') zeroDocs.push(`Document A ("${rawA}")`);
    if (parsedB.error === 'zero_area') zeroDocs.push(`Document B ("${rawB}")`);
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'INCOMPARABLE',
      statusLabel: 'Incomparable / Non-Positive Area',
      changeCategory: 'incomparable',
      explanation: `Land area in ${zeroDocs.join(' and ')} is zero. Land extents must be positive numbers greater than zero. Manual review required.`
    };
  }

  if (parsedA.error === 'invalid_numeric' || parsedB.error === 'invalid_numeric') {
    const invalidDoc = parsedA.error === 'invalid_numeric' && parsedB.error === 'invalid_numeric'
      ? 'both documents'
      : parsedA.error === 'invalid_numeric'
      ? 'Document A'
      : 'Document B';
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'INCOMPARABLE',
      statusLabel: 'Incomparable / Invalid Number',
      changeCategory: 'incomparable',
      explanation: `Land area expression in ${invalidDoc} cannot be parsed as a valid numeric extent. Manual review required.`
    };
  }

  // 3. Conflicting units in either document (embedded in value string vs explicit unit property)
  if (parsedA.error === 'conflicting_units' || parsedB.error === 'conflicting_units') {
    const conflictDocs = [];
    if (parsedA.error === 'conflicting_units') {
      const details = parsedA.conflictDetails
        ? parsedA.conflictDetails
        : `embedded "${parsedA.embeddedUnit}" vs property "${parsedA.explicitUnit}"`;
      conflictDocs.push(`Document A has conflicting units (${details})`);
    }
    if (parsedB.error === 'conflicting_units') {
      const details = parsedB.conflictDetails
        ? parsedB.conflictDetails
        : `embedded "${parsedB.embeddedUnit}" vs property "${parsedB.explicitUnit}"`;
      conflictDocs.push(`Document B has conflicting units (${details})`);
    }
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'INCOMPARABLE',
      statusLabel: 'Incomparable / Conflicting Units',
      changeCategory: 'incomparable',
      explanation: `${conflictDocs.join('; ')}. Values cannot be reliably compared when units conflict. Manual review required.`
    };
  }

  // 4. Unit missing in either document
  if (parsedA.error === 'missing_unit' || parsedB.error === 'missing_unit') {
    const missingDoc = parsedA.error === 'missing_unit' && parsedB.error === 'missing_unit'
      ? 'both Document A and Document B'
      : parsedA.error === 'missing_unit'
      ? 'Document A'
      : 'Document B';
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'INCOMPARABLE',
      statusLabel: 'Incomparable / Missing Unit',
      changeCategory: 'incomparable',
      explanation: `Land area unit is missing in ${missingDoc}. Values cannot be reliably compared without a defined unit of measurement.`
    };
  }

  // 5. Unsupported unit in either document
  const isAUnitSupported = SUPPORTED_AREA_UNITS.has(parsedA.unit);
  const isBUnitSupported = SUPPORTED_AREA_UNITS.has(parsedB.unit);

  if (!isAUnitSupported || !isBUnitSupported) {
    const unsupportedUnit = !isAUnitSupported && !isBUnitSupported
      ? `"${parsedA.unit}" and "${parsedB.unit}"`
      : !isAUnitSupported
      ? `"${parsedA.unit}"`
      : `"${parsedB.unit}"`;
    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'INCOMPARABLE',
      statusLabel: 'Incomparable / Unsupported Unit',
      changeCategory: 'incomparable',
      explanation: `Unit ${unsupportedUnit} is not supported for automated normalized area conversion (supported units: Acre, Hectare, Gunta). Manual review required.`
    };
  }

  // 6. Convert both to canonical Acres and compare using documented fixed tolerance (0.002 Acres)
  const acresA = convertToCanonicalAcres(parsedA.numeric, parsedA.unit);
  const acresB = convertToCanonicalAcres(parsedB.numeric, parsedB.unit);

  const delta = Math.abs(acresA - acresB);

  if (delta <= AREA_TOLERANCE_ACRES) {
    const explanation = parsedA.unit === parsedB.unit
      ? 'Land area values match across both documents.'
      : `Land area values are numerically equivalent after unit conversion (${rawA} ≈ ${rawB}; Δ = ${delta.toFixed(4)} Acres within fixed tolerance ${AREA_TOLERANCE_ACRES} Acres).`;

    return {
      key: 'landArea',
      label: 'Land Area & Extent',
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: rawA,
      docBValue: rawB,
      docAConfidence: confA,
      docBConfidence: confB,
      status: 'IDENTICAL',
      statusLabel: 'Identical',
      changeCategory: 'identical',
      explanation
    };
  }

  return {
    key: 'landArea',
    label: 'Land Area & Extent',
    section: 'Land Attributes',
    category: 'land_attribute',
    docAValue: rawA,
    docBValue: rawB,
    docAConfidence: confA,
    docBConfidence: confB,
    status: 'DIFFERENT',
    statusLabel: 'Different / Discrepancy',
    changeCategory: 'different',
    explanation: `Land area differs: Document A has "${rawA}" (${acresA.toFixed(4)} Acres), Document B has "${rawB}" (${acresB.toFixed(4)} Acres); Δ = ${delta.toFixed(4)} Acres exceeds tolerance of ${AREA_TOLERANCE_ACRES} Acres. Discrepancy requires review.`
  };
}

/**
 * Extracts a normalized and display value from a document's landDetails.
 * Handles primitive values, nested objects ({ value, confidence }),
 * and flags unsupported structures (arrays, complex objects without a scalar value).
 */
function extractFieldValue(container, keys) {
  const plainContainer = toPlainData(container);
  if (!plainContainer || typeof plainContainer !== 'object') {
    return {
      value: null,
      confidence: null,
      rawOcrText: null,
      isPresent: false,
      isUnsupportedStructure: false,
      structureType: null,
      displayValue: '(Not provided)',
      rawSource: null
    };
  }

  const keyList = Array.isArray(keys) ? keys : [keys];
  let firstEmptyResult = null;

  for (const k of keyList) {
    if (Object.prototype.hasOwnProperty.call(plainContainer, k) && plainContainer[k] !== undefined && plainContainer[k] !== null) {
      const fieldObj = toPlainData(plainContainer[k]);
      if (fieldObj === undefined || fieldObj === null) {
        continue;
      }

      // Primitive value (string, number, boolean)
      if (typeof fieldObj === 'string' || typeof fieldObj === 'number' || typeof fieldObj === 'boolean') {
        const strVal = String(fieldObj).trim();
        if (strVal !== '') {
          return {
            value: strVal,
            confidence: null,
            rawOcrText: null,
            isPresent: true,
            isUnsupportedStructure: false,
            structureType: null,
            displayValue: strVal,
            rawSource: fieldObj
          };
        }
        if (!firstEmptyResult) {
          firstEmptyResult = {
            value: strVal,
            confidence: null,
            rawOcrText: null,
            isPresent: false,
            isUnsupportedStructure: false,
            structureType: null,
            displayValue: '(Empty)',
            rawSource: fieldObj
          };
        }
        continue;
      }

      // Array -> Unsupported complex structure
      if (Array.isArray(fieldObj)) {
        return {
          value: null,
          confidence: null,
          rawOcrText: null,
          isPresent: true,
          isUnsupportedStructure: true,
          structureType: 'Array',
          displayValue: safeStringify(fieldObj),
          rawSource: fieldObj
        };
      }

      // Object
      if (typeof fieldObj === 'object') {
        // Has a 'value' property
        if (Object.prototype.hasOwnProperty.call(fieldObj, 'value')) {
          const valProp = toPlainData(fieldObj.value);
          const conf = typeof fieldObj.confidence === 'number' && Number.isFinite(fieldObj.confidence)
            ? fieldObj.confidence
            : null;
          const rawOcr = fieldObj.rawOcrText || fieldObj.rawText || null;

          if (valProp === undefined || valProp === null) {
            if (!firstEmptyResult) {
              firstEmptyResult = {
                value: null,
                confidence: conf,
                rawOcrText: rawOcr,
                isPresent: false,
                isUnsupportedStructure: false,
                structureType: null,
                displayValue: '(Empty)',
                rawSource: fieldObj
              };
            }
            continue;
          }

          if (typeof valProp === 'string' || typeof valProp === 'number' || typeof valProp === 'boolean') {
            const val = String(valProp).trim();
            if (val !== '') {
              return {
                value: val,
                confidence: conf,
                rawOcrText: rawOcr,
                isPresent: true,
                isUnsupportedStructure: false,
                structureType: null,
                displayValue: val,
                rawSource: fieldObj
              };
            }
            if (!firstEmptyResult) {
              firstEmptyResult = {
                value: val,
                confidence: conf,
                rawOcrText: rawOcr,
                isPresent: false,
                isUnsupportedStructure: false,
                structureType: null,
                displayValue: '(Empty)',
                rawSource: fieldObj
              };
            }
            continue;
          }

          // 'value' is itself an array or complex object
          return {
            value: null,
            confidence: null,
            rawOcrText: null,
            isPresent: true,
            isUnsupportedStructure: true,
            structureType: Array.isArray(valProp) ? 'Array' : 'Nested Object',
            displayValue: safeStringify(fieldObj),
            rawSource: fieldObj
          };
        }

        // Object without 'value' property
        const innerKeys = Object.keys(fieldObj);
        if (innerKeys.length === 0) {
          if (!firstEmptyResult) {
            firstEmptyResult = {
              value: null,
              confidence: null,
              rawOcrText: null,
              isPresent: false,
              isUnsupportedStructure: false,
              structureType: null,
              displayValue: '(Empty)',
              rawSource: fieldObj
            };
          }
          continue;
        }

        // Object has properties without a standard scalar value
        return {
          value: null,
          confidence: null,
          rawOcrText: null,
          isPresent: true,
          isUnsupportedStructure: true,
          structureType: 'Complex Object',
          displayValue: safeStringify(fieldObj),
          rawSource: fieldObj
        };
      }
    }
  }

  if (firstEmptyResult) {
    return firstEmptyResult;
  }

  return {
    value: null,
    confidence: null,
    rawOcrText: null,
    isPresent: false,
    isUnsupportedStructure: false,
    structureType: null,
    displayValue: '(Not provided)',
    rawSource: null
  };
}

/**
 * Standard semantic land attributes evaluated during cross-document comparison.
 */
const SEMANTIC_LAND_FIELDS = [
  {
    key: 'ownerName',
    label: 'Owner / Pattadar Name',
    aliases: ['ownerName', 'pattadarName', 'khatadarName', 'holderName']
  },
  {
    key: 'surveyNumber',
    label: 'Survey / Khasra Number',
    aliases: ['surveyNumber', 'khasraNumber', 'surveyNo', 'khasraNo', 'plotNumber']
  },
  {
    key: 'khataNumber',
    label: 'Khata / Khewat Number',
    aliases: ['khataNumber', 'khewatNumber', 'khataNo', 'khewatNo', 'accountNumber']
  },
  {
    key: 'landArea',
    label: 'Land Area & Extent',
    aliases: ['landArea', 'area', 'extent'],
    customComparator: true
  },
  {
    key: 'village',
    label: 'Village / Mauza',
    aliases: ['village', 'mauza', 'gram']
  },
  {
    key: 'tehsil',
    label: 'Tehsil / Mandal / Taluk',
    aliases: ['tehsil', 'mandal', 'taluka', 'subDistrict']
  },
  {
    key: 'district',
    label: 'District',
    aliases: ['district', 'zilla']
  },
  {
    key: 'state',
    label: 'State',
    aliases: ['state', 'pradesh']
  },
  {
    key: 'landClassification',
    label: 'Land Classification',
    aliases: ['landClassification', 'landType', 'natureOfLand']
  }
];

/**
 * Internal and standard cadastral keys excluded when identifying custom land attributes.
 * areaUnit is consumed by the land-area resolver and must not appear as custom_areaUnit.
 */
const EXCLUDED_LAND_DETAIL_KEYS = new Set([
  '_id',
  'areaUnit',
  'area_unit',
  ...SEMANTIC_LAND_FIELDS.flatMap((f) => f.aliases)
]);

/**
 * Document-level record metadata evaluated during cross-document comparison.
 * Note: Metadata differences are isolated from land-record discrepancy calculations.
 */
const METADATA_FIELDS = [
  {
    key: 'documentStatus',
    label: 'Document Review Status',
    extract: (doc) => ({ value: doc?.status || 'Uploaded', confidence: null })
  },
  {
    key: 'filename',
    label: 'Original File Name',
    extract: (doc) => ({ value: doc?.fileMetadata?.originalFilename || null, confidence: null })
  },
  {
    key: 'uploadDate',
    label: 'Upload Timestamp',
    extract: (doc) => {
      if (!doc || !doc.createdAt) {
        return { value: null, confidence: null };
      }
      try {
        const d = new Date(doc.createdAt);
        if (isNaN(d.getTime())) {
          return { value: null, confidence: null };
        }
        return { value: d.toISOString(), confidence: null };
      } catch {
        return { value: null, confidence: null };
      }
    }
  },
  {
    key: 'fileSize',
    label: 'File Size (Bytes)',
    extract: (doc) => ({
      value: doc?.fileMetadata?.sizeBytes !== undefined && doc?.fileMetadata?.sizeBytes !== null
        ? `${doc.fileMetadata.sizeBytes} bytes`
        : null,
      confidence: null
    })
  },
  {
    key: 'sha256Hash',
    label: 'File Cryptographic Hash (SHA-256)',
    extract: (doc) => ({ value: doc?.fileMetadata?.sha256Hash || null, confidence: null })
  },
  {
    key: 'assignedOfficer',
    label: 'Assigned Reviewing Officer',
    extract: (doc) => {
      const officerId = resolveAssignedOfficerId(doc);
      return { value: officerId || 'Unassigned', confidence: null };
    }
  }
];

/**
 * Compares any two distinct documents.
 *
 * @param {Object} doc1 First document
 * @param {Object} doc2 Second document
 * @returns {Object} Structured comparison analysis
 */
function compareDocuments(doc1, doc2) {
  if (!doc1 || !doc2) {
    const err = new Error('Two documents are required for comparison.');
    err.statusCode = 400;
    throw err;
  }

  const id1 = (doc1._id || doc1.id)?.toString();
  const id2 = (doc2._id || doc2.id)?.toString();

  if (id1 && id2 && id1 === id2) {
    const err = new Error('Two distinct documents are required for comparison. To compare versions of the same document, use version history comparison.');
    err.statusCode = 400;
    throw err;
  }

  const ld1 = toPlainData(doc1.landDetails) || {};
  const ld2 = toPlainData(doc2.landDetails) || {};

  const landAttributes = [];
  const metadataAttributes = [];

  // 1. Compare standard semantic land fields
  for (const field of SEMANTIC_LAND_FIELDS) {
    // Specialized numeric area comparison using prioritized representation resolver
    if (field.customComparator && field.key === 'landArea') {
      const areaField1 = resolveLandAreaRepresentation(ld1);
      const areaField2 = resolveLandAreaRepresentation(ld2);
      landAttributes.push(compareLandAreas(areaField1, areaField2));
      continue;
    }

    const val1Obj = extractFieldValue(ld1, field.aliases);
    const val2Obj = extractFieldValue(ld2, field.aliases);

    // Guard against unsupported complex structures in standard semantic fields
    if (val1Obj.isUnsupportedStructure || val2Obj.isUnsupportedStructure) {
      const unsupportedDocs = [];
      if (val1Obj.isUnsupportedStructure) unsupportedDocs.push(`Document A (${val1Obj.structureType || 'Complex Structure'})`);
      if (val2Obj.isUnsupportedStructure) unsupportedDocs.push(`Document B (${val2Obj.structureType || 'Complex Structure'})`);
      landAttributes.push({
        key: field.key,
        label: field.label,
        section: 'Land Attributes',
        category: 'land_attribute',
        docAValue: formatScalarDisplayValue(val1Obj.displayValue, '(Not provided)'),
        docBValue: formatScalarDisplayValue(val2Obj.displayValue, '(Not provided)'),
        docAConfidence: val1Obj.confidence,
        docBConfidence: val2Obj.confidence,
        status: 'INCOMPARABLE',
        statusLabel: 'Incomparable / Complex Structure',
        changeCategory: 'incomparable',
        explanation: `Field "${field.label}" in ${unsupportedDocs.join(' and ')} contains an unsupported complex structure without a scalar representation. Manual review required.`
      });
      continue;
    }

    const raw1 = val1Obj.value;
    const raw2 = val2Obj.value;

    const norm1 = normalizeText(raw1);
    const norm2 = normalizeText(raw2);

    let status;
    let statusLabel;
    let changeCategory;
    let explanation;

    if (norm1 !== '' && norm2 !== '') {
      if (norm1 === norm2) {
        status = 'IDENTICAL';
        statusLabel = 'Identical';
        changeCategory = 'identical';
        explanation = 'Values match across both documents.';
      } else {
        status = 'DIFFERENT';
        statusLabel = 'Different / Discrepancy';
        changeCategory = 'different';
        explanation = `Values differ between Document A ("${formatScalarDisplayValue(raw1, '(Not provided)')}") and Document B ("${formatScalarDisplayValue(raw2, '(Not provided)')}"). Discrepancy requires review.`;
      }
    } else if (norm1 !== '' && norm2 === '') {
      status = 'MISSING_IN_B';
      statusLabel = 'Missing in Document B';
      changeCategory = 'missing_in_b';
      explanation = 'Attribute is recorded in Document A but missing or unextracted in Document B.';
    } else if (norm1 === '' && norm2 !== '') {
      status = 'MISSING_IN_A';
      statusLabel = 'Missing in Document A';
      changeCategory = 'missing_in_a';
      explanation = 'Attribute is recorded in Document B but missing or unextracted in Document A.';
    } else {
      status = 'NOT_RECORDED';
      statusLabel = 'Not Recorded in Either';
      changeCategory = 'not_recorded';
      explanation = 'Field was not extracted or recorded in either document.';
    }

    landAttributes.push({
      key: field.key,
      label: field.label,
      section: 'Land Attributes',
      category: 'land_attribute',
      docAValue: formatScalarDisplayValue(raw1, '(Not provided)'),
      docBValue: formatScalarDisplayValue(raw2, '(Not provided)'),
      docAConfidence: val1Obj.confidence,
      docBConfidence: val2Obj.confidence,
      status,
      statusLabel,
      changeCategory,
      explanation
    });
  }

  // 2. Identify and compare custom / unmapped fields
  // Clearly distinguish custom fields present in both, present in only one, or not reliably comparable.
  // Note: areaUnit is excluded so it is consumed by the land-area resolver and never appears as custom_areaUnit.
  const customKeys1 = Object.keys(ld1).filter((k) => !EXCLUDED_LAND_DETAIL_KEYS.has(k));
  const customKeys2 = Object.keys(ld2).filter((k) => !EXCLUDED_LAND_DETAIL_KEYS.has(k));
  const allCustomKeys = Array.from(new Set([...customKeys1, ...customKeys2]));

  for (const customKey of allCustomKeys) {
    const val1Obj = extractFieldValue(ld1, customKey);
    const val2Obj = extractFieldValue(ld2, customKey);

    const hasIn1 = val1Obj.isPresent;
    const hasIn2 = val2Obj.isPresent;

    let status;
    let statusLabel;
    let changeCategory;
    let explanation;
    let docAValue = val1Obj.displayValue;
    let docBValue = val2Obj.displayValue;

    // Check for unsupported complex structures (arrays or objects without a scalar value representation)
    if (val1Obj.isUnsupportedStructure || val2Obj.isUnsupportedStructure) {
      status = 'INCOMPARABLE';
      statusLabel = 'Incomparable / Complex Structure';
      changeCategory = 'incomparable';

      const unsupportedDocs = [];
      if (val1Obj.isUnsupportedStructure) {
        unsupportedDocs.push(`Document A (${val1Obj.structureType || 'Complex Structure'})`);
      }
      if (val2Obj.isUnsupportedStructure) {
        unsupportedDocs.push(`Document B (${val2Obj.structureType || 'Complex Structure'})`);
      }

      if (hasIn1 && hasIn2) {
        explanation = `Custom attribute "${customKey}" in ${unsupportedDocs.join(' and ')} contains an unsupported complex structure without a scalar representation. Complex structures cannot be automatically compared and require manual review.`;
      } else if (hasIn1 && !hasIn2) {
        docBValue = '(Absent)';
        explanation = `Custom attribute "${customKey}" in Document A contains an unsupported complex structure (${val1Obj.structureType}) and is absent in Document B schema. Manual review required.`;
      } else {
        docAValue = '(Absent)';
        explanation = `Custom attribute "${customKey}" in Document B contains an unsupported complex structure (${val2Obj.structureType}) and is absent in Document A schema. Manual review required.`;
      }
    } else if (hasIn1 && hasIn2) {
      // Both documents contain this exact custom attribute key with scalar representations
      const raw1 = val1Obj.value;
      const raw2 = val2Obj.value;
      const norm1 = normalizeText(raw1);
      const norm2 = normalizeText(raw2);

      if (norm1 !== '' && norm2 !== '' && norm1 === norm2) {
        status = 'IDENTICAL';
        statusLabel = 'Identical (Custom Field)';
        changeCategory = 'identical';
        explanation = `Custom attribute "${customKey}" matches across both documents.`;
      } else if (norm1 !== '' && norm2 !== '') {
        status = 'DIFFERENT';
        statusLabel = 'Different / Discrepancy (Custom Field)';
        changeCategory = 'different';
        explanation = `Custom attribute "${customKey}" differs: Document A has "${formatScalarDisplayValue(raw1, '(Absent)')}", Document B has "${formatScalarDisplayValue(raw2, '(Absent)')}". Discrepancy requires review.`;
      } else if (norm1 !== '' && norm2 === '') {
        status = 'MISSING_IN_B';
        statusLabel = 'Missing in Document B (Custom Field)';
        changeCategory = 'missing_in_b';
        explanation = `Custom attribute "${customKey}" is present in Document A but empty in Document B.`;
      } else if (norm1 === '' && norm2 !== '') {
        status = 'MISSING_IN_A';
        statusLabel = 'Missing in Document A (Custom Field)';
        changeCategory = 'missing_in_a';
        explanation = `Custom attribute "${customKey}" is present in Document B but empty in Document A.`;
      } else {
        status = 'NOT_RECORDED';
        statusLabel = 'Not Recorded in Either';
        changeCategory = 'not_recorded';
        explanation = `Custom attribute "${customKey}" is defined but empty in both records.`;
      }
    } else if (hasIn1 && !hasIn2) {
      status = 'MISSING_IN_B';
      statusLabel = 'Missing in Document B (Custom Field)';
      changeCategory = 'missing_in_b';
      docBValue = '(Absent)';
      explanation = `Custom field "${customKey}" is present in Document A but absent in Document B schema.`;
    } else if (!hasIn1 && hasIn2) {
      status = 'MISSING_IN_A';
      statusLabel = 'Missing in Document A (Custom Field)';
      changeCategory = 'missing_in_a';
      docAValue = '(Absent)';
      explanation = `Custom field "${customKey}" is present in Document B but absent in Document A schema.`;
    } else {
      status = 'NOT_RECORDED';
      statusLabel = 'Not Recorded in Either';
      changeCategory = 'not_recorded';
      explanation = `Custom field "${customKey}" is absent in both documents.`;
    }

    landAttributes.push({
      key: `custom_${customKey}`,
      label: `Custom: ${customKey}`,
      section: 'Custom Land Attributes',
      category: 'land_attribute',
      docAValue: formatScalarDisplayValue(docAValue, '(Absent)'),
      docBValue: formatScalarDisplayValue(docBValue, '(Absent)'),
      docAConfidence: val1Obj.confidence,
      docBConfidence: val2Obj.confidence,
      status,
      statusLabel,
      changeCategory,
      explanation
    });
  }

  // 3. Compare document record metadata (isolated from land attribute discrepancies)
  for (const meta of METADATA_FIELDS) {
    const val1Obj = meta.extract(doc1);
    const val2Obj = meta.extract(doc2);

    const raw1 = val1Obj.value;
    const raw2 = val2Obj.value;

    const norm1 = normalizeText(raw1);
    const norm2 = normalizeText(raw2);

    let status;
    let statusLabel;
    let changeCategory;
    let explanation;

    if (norm1 !== '' && norm2 !== '') {
      if (norm1 === norm2) {
        status = 'IDENTICAL';
        statusLabel = 'Identical Metadata';
        changeCategory = 'identical';
        explanation = 'Record metadata matches across both documents.';
      } else {
        status = 'DIFFERENT';
        statusLabel = 'Different Metadata';
        changeCategory = 'different';
        explanation = `Metadata differs: Document A has "${formatScalarDisplayValue(raw1, '(Not available)')}", Document B has "${formatScalarDisplayValue(raw2, '(Not available)')}".`;
      }
    } else if (norm1 !== '' && norm2 === '') {
      status = 'MISSING_IN_B';
      statusLabel = 'Missing in Document B Metadata';
      changeCategory = 'missing_in_b';
      explanation = 'Metadata property is recorded in Document A but unavailable in Document B.';
    } else if (norm1 === '' && norm2 !== '') {
      status = 'MISSING_IN_A';
      statusLabel = 'Missing in Document A Metadata';
      changeCategory = 'missing_in_a';
      explanation = 'Metadata property is recorded in Document B but unavailable in Document A.';
    } else {
      status = 'NOT_RECORDED';
      statusLabel = 'Metadata Unavailable';
      changeCategory = 'not_recorded';
      explanation = 'Metadata is unavailable in both records.';
    }

    metadataAttributes.push({
      key: meta.key,
      label: meta.label,
      section: 'Document Metadata',
      category: 'metadata',
      docAValue: formatScalarDisplayValue(raw1, '(Not available)'),
      docBValue: formatScalarDisplayValue(raw2, '(Not available)'),
      docAConfidence: null,
      docBConfidence: null,
      status,
      statusLabel,
      changeCategory,
      explanation
    });
  }

  // 4. Compute cleanly separated discrepancy lists & summaries
  // Land record discrepancies strictly encompass land-attribute variations
  const landDiscrepancies = landAttributes.filter((a) =>
    ['DIFFERENT', 'MISSING_IN_A', 'MISSING_IN_B', 'INCOMPARABLE'].includes(a.status)
  );

  const metadataDifferences = metadataAttributes.filter((a) =>
    ['DIFFERENT', 'MISSING_IN_A', 'MISSING_IN_B'].includes(a.status)
  );

  const summary = {
    // Primary Land Attributes Summary (determines discrepancy count)
    landAttributes: {
      total: landAttributes.length,
      identicalCount: landAttributes.filter((a) => a.status === 'IDENTICAL').length,
      discrepanciesCount: landDiscrepancies.length,
      differentCount: landAttributes.filter((a) => a.status === 'DIFFERENT').length,
      missingInACount: landAttributes.filter((a) => a.status === 'MISSING_IN_A').length,
      missingInBCount: landAttributes.filter((a) => a.status === 'MISSING_IN_B').length,
      incomparableCount: landAttributes.filter((a) => a.status === 'INCOMPARABLE').length,
      notRecordedCount: landAttributes.filter((a) => a.status === 'NOT_RECORDED').length
    },
    // Document Metadata Summary (isolated from land discrepancies)
    metadata: {
      total: metadataAttributes.length,
      identicalCount: metadataAttributes.filter((a) => a.status === 'IDENTICAL').length,
      differencesCount: metadataDifferences.length,
      differentCount: metadataAttributes.filter((a) => a.status === 'DIFFERENT').length,
      missingInACount: metadataAttributes.filter((a) => a.status === 'MISSING_IN_A').length,
      missingInBCount: metadataAttributes.filter((a) => a.status === 'MISSING_IN_B').length,
      notRecordedCount: metadataAttributes.filter((a) => a.status === 'NOT_RECORDED').length
    },
    // Top-level shortcuts for backward compatibility and convenience
    totalLandAttributes: landAttributes.length,
    landDiscrepanciesCount: landDiscrepancies.length,
    identicalLandCount: landAttributes.filter((a) => a.status === 'IDENTICAL').length,
    totalAttributes: landAttributes.length + metadataAttributes.length
  };

  const allAttributes = [...landAttributes, ...metadataAttributes];

  const officer1Id = resolveAssignedOfficerId(doc1);
  const officer2Id = resolveAssignedOfficerId(doc2);

  return {
    documentA: {
      id: id1 || null,
      originalFilename: doc1.fileMetadata?.originalFilename || 'Document A',
      createdAt: doc1.createdAt || null,
      sizeBytes: doc1.fileMetadata?.sizeBytes || null,
      mimeType: doc1.fileMetadata?.mimeType || null,
      status: doc1.status || 'Uploaded',
      sha256Hash: doc1.fileMetadata?.sha256Hash || null,
      owner: doc1.accessControl?.uploadedBy || null,
      assignedOfficerId: officer1Id,
      assignedOfficer: officer1Id
    },
    documentB: {
      id: id2 || null,
      originalFilename: doc2.fileMetadata?.originalFilename || 'Document B',
      createdAt: doc2.createdAt || null,
      sizeBytes: doc2.fileMetadata?.sizeBytes || null,
      mimeType: doc2.fileMetadata?.mimeType || null,
      status: doc2.status || 'Uploaded',
      sha256Hash: doc2.fileMetadata?.sha256Hash || null,
      owner: doc2.accessControl?.uploadedBy || null,
      assignedOfficerId: officer2Id,
      assignedOfficer: officer2Id
    },
    landAttributes,
    metadataAttributes,
    allAttributes,
    // differences points strictly to landDiscrepancies so ordinary metadata variance is excluded
    differences: landDiscrepancies,
    landDiscrepancies,
    metadataDifferences,
    summary,
    disclaimer: 'Comparison results highlight discrepancies between extracted land attributes. Document metadata variations are reported separately. Differences do not automatically imply fraud or ownership dispute and require independent administrative verification. Records are not assumed to refer to the same land parcel.'
  };
}

module.exports = {
  compareDocuments,
  normalizeText,
  normalizeUnitName,
  isValidPositiveNumericString,
  safeStringify,
  formatScalarDisplayValue,
  resolveLandAreaRepresentation,
  parseLandArea,
  convertToCanonicalAcres,
  compareLandAreas,
  extractFieldValue,
  CANONICAL_AREA_UNIT,
  ACRES_PER_HECTARE,
  GUNTAS_PER_ACRE,
  ACRES_PER_GUNTA,
  AREA_TOLERANCE_ACRES,
  SUPPORTED_AREA_UNITS,
  SEMANTIC_LAND_FIELDS,
  EXCLUDED_LAND_DETAIL_KEYS,
  METADATA_FIELDS
};
