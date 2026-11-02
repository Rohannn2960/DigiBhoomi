const VALIDATION_WEIGHTS = Object.freeze({
  requiredFields: 25,
  formats: 25,
  ocrSupport: 30,
  consistency: 20
});

const REQUIRED_FIELDS = [
  ['ownerName', 'Owner name'],
  ['surveyNumber', 'Survey number'],
  ['khataNumber', 'Khata number'],
  ['landArea', 'Land area'],
  ['village', 'Village'],
  ['tehsil', 'Tehsil'],
  ['district', 'District'],
  ['landClassification', 'Land classification']
];

const FIELD_LABELS = Object.fromEntries(REQUIRED_FIELDS);
const FIELD_KEYS = REQUIRED_FIELDS.map(([key]) => key);
const AREA_UNITS = new Set(['Acre', 'Hectare', 'Bigha', 'Biswa', 'Gunta', 'Sq Yards']);

function getFieldValue(landDetails, key) {
  const field = landDetails && landDetails[key];
  if (!field || typeof field !== 'object') return '';
  return typeof field.value === 'string' ? field.value.trim() : '';
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function makeCheck(id, label, category, evaluated, passed, reason) {
  return { id, label, category, evaluated, passed: Boolean(passed), reason };
}

function checkRequiredFields(landDetails) {
  return REQUIRED_FIELDS.map(([key, label]) => {
    const value = getFieldValue(landDetails, key);
    return makeCheck(
      `required-${key}`,
      `${label} is present`,
      'requiredFields',
      true,
      Boolean(value),
      value ? `${label} is present.` : `${label} is missing.`
    );
  });
}

function checkFormats(landDetails) {
  const checks = [];
  const survey = getFieldValue(landDetails, 'surveyNumber');
  const khata = getFieldValue(landDetails, 'khataNumber');
  const area = getFieldValue(landDetails, 'landArea');
  const areaUnit = landDetails?.landArea?.unit;

  checks.push(makeCheck(
    'format-survey-number',
    'Survey number has a valid land-record format',
    'formats',
    Boolean(survey),
    Boolean(survey && /^[\p{L}\p{N}][\p{L}\p{N}./() -]*$/u.test(survey)),
    survey ? 'Survey number uses an allowed identifier format.' : 'Survey number is unavailable for format validation.'
  ));
  checks.push(makeCheck(
    'format-khata-number',
    'Khata number has a valid identifier format',
    'formats',
    Boolean(khata),
    Boolean(khata && /^[\p{L}\p{N}][\p{L}\p{N}./() -]*$/u.test(khata)),
    khata ? 'Khata number uses an allowed identifier format.' : 'Khata number is unavailable for format validation.'
  ));
  checks.push(makeCheck(
    'format-land-area',
    'Land area is a positive numeric value',
    'formats',
    Boolean(area),
    Boolean(area && Number.isFinite(Number(area.replace(',', '.'))) && Number(area.replace(',', '.')) > 0),
    area ? 'Land area is numeric and positive.' : 'Land area is unavailable for format validation.'
  ));
  checks.push(makeCheck(
    'format-land-area-unit',
    'Land area unit is recognized',
    'formats',
    Boolean(areaUnit),
    AREA_UNITS.has(areaUnit),
    areaUnit ? `Land area unit is ${areaUnit}.` : 'Land area unit is unavailable for format validation.'
  ));

  return checks;
}

function checkOcrSupport(landDetails, ocrText) {
  const normalizedOcr = normalizeText(ocrText);
  return FIELD_KEYS.map((key) => {
    const value = getFieldValue(landDetails, key);
    const evaluated = Boolean(normalizedOcr && value);
    const supported = evaluated && normalizedOcr.includes(normalizeText(value));
    return makeCheck(
      `ocr-support-${key}`,
      `${FIELD_LABELS[key]} is supported by OCR text`,
      'ocrSupport',
      evaluated,
      supported,
      !normalizedOcr
        ? 'OCR text is unavailable.'
        : !value
          ? `${FIELD_LABELS[key]} is unavailable for OCR support validation.`
          : supported
            ? 'Extracted value appears in the available OCR text.'
            : 'Extracted value was not found in the available OCR text.'
    );
  });
}

function checkConsistency(landDetails) {
  const survey = getFieldValue(landDetails, 'surveyNumber');
  const khasra = getFieldValue(landDetails, 'khasraNumber');
  const area = getFieldValue(landDetails, 'landArea');
  const areaAlias = getFieldValue(landDetails, 'area');
  const checks = [];

  checks.push(makeCheck(
    'consistency-survey-khasra',
    'Survey and Khasra numbers agree',
    'consistency',
    Boolean(survey && khasra),
    Boolean(survey && khasra && normalizeText(survey) === normalizeText(khasra)),
    !survey || !khasra
      ? 'Both survey and Khasra values are required for comparison.'
      : normalizeText(survey) === normalizeText(khasra)
        ? 'Survey and Khasra values agree.'
        : 'Survey and Khasra values conflict.'
  ));
  checks.push(makeCheck(
    'consistency-area-alias',
    'Land area aliases agree',
    'consistency',
    Boolean(area && areaAlias),
    Boolean(area && areaAlias && normalizeText(area) === normalizeText(areaAlias)),
    !area || !areaAlias
      ? 'Both land area values are required for comparison.'
      : normalizeText(area) === normalizeText(areaAlias)
        ? 'Land area values agree.'
        : 'Land area values conflict.'
  ));

  return checks;
}

function scoreCategory(checks, category, weight) {
  const categoryChecks = checks.filter((check) => check.category === category);
  const evaluatedChecks = categoryChecks.filter((check) => check.evaluated);
  const passedChecks = evaluatedChecks.filter((check) => check.passed);
  const evaluated = evaluatedChecks.length > 0;
  const ratio = evaluated ? passedChecks.length / evaluatedChecks.length : 0;

  return {
    weight,
    evaluated,
    evaluatedChecks: evaluatedChecks.length,
    totalChecks: categoryChecks.length,
    passedChecks: passedChecks.length,
    score: Math.round(weight * ratio * 100) / 100,
    checks: categoryChecks
  };
}

function calculateExtractionValidation(landDetails = {}, ocrResult = {}) {
  const checks = [
    ...checkRequiredFields(landDetails),
    ...checkFormats(landDetails),
    ...checkOcrSupport(landDetails, ocrResult.fullText),
    ...checkConsistency(landDetails)
  ];
  const categories = {
    requiredFields: scoreCategory(checks, 'requiredFields', VALIDATION_WEIGHTS.requiredFields),
    formats: scoreCategory(checks, 'formats', VALIDATION_WEIGHTS.formats),
    ocrSupport: scoreCategory(checks, 'ocrSupport', VALIDATION_WEIGHTS.ocrSupport),
    consistency: scoreCategory(checks, 'consistency', VALIDATION_WEIGHTS.consistency)
  };
  const failedChecks = checks
    .filter((check) => !check.evaluated || !check.passed)
    .map(({ id, label, category, evaluated, reason }) => ({ id, label, category, evaluated, reason }));
  const reviewReasons = failedChecks.map((check) => check.reason);

  return {
    score: Object.values(categories).reduce((total, category) => total + category.score, 0),
    weights: VALIDATION_WEIGHTS,
    categories,
    failedChecks,
    reviewReasons,
    disclaimer: 'This validation score measures extraction consistency only. It does not prove ownership, legal validity, or document authenticity; manual/legal verification may still be required.',
    calculatedAt: new Date()
  };
}

module.exports = {
  VALIDATION_WEIGHTS,
  calculateExtractionValidation
};
