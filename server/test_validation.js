const assert = require('assert');
const { calculateExtractionValidation } = require('./validation');

const validDetails = {
  ownerName: { value: 'Ramesh Kumar' },
  surveyNumber: { value: '120/4' },
  khasraNumber: { value: '120/4' },
  khataNumber: { value: '45' },
  landArea: { value: '3.5', unit: 'Acre' },
  area: { value: '3.5' },
  village: { value: 'Rampur' },
  tehsil: { value: 'Jhansi' },
  district: { value: 'Jhansi' },
  landClassification: { value: 'Agricultural land' }
};
const validOcr = {
  fullText: 'Owner: Ramesh Kumar Survey: 120/4 Khasra: 120/4 Khata: 45 Area: 3.5 Acre Village: Rampur Tehsil: Jhansi District: Jhansi Agricultural land'
};

const valid = calculateExtractionValidation(validDetails, validOcr);
assert.strictEqual(valid.score, 100);
assert.strictEqual(valid.failedChecks.length, 0);

const missing = calculateExtractionValidation({ ...validDetails, khataNumber: { value: '' } }, validOcr);
assert(missing.score < 100);
assert(missing.reviewReasons.some((reason) => reason.includes('Khata number is missing')));

const mismatch = calculateExtractionValidation(validDetails, {
  fullText: validOcr.fullText.replace('Ramesh Kumar', 'Different Name')
});
assert(mismatch.failedChecks.some((check) => check.id === 'ocr-support-ownerName'));
assert(mismatch.score < 100);

const inconsistent = calculateExtractionValidation(
  { ...validDetails, khasraNumber: { value: '121/4' } },
  validOcr
);
assert(inconsistent.failedChecks.some((check) => check.id === 'consistency-survey-khasra'));
assert(inconsistent.score < 100);

const unavailableOcr = calculateExtractionValidation(validDetails, { fullText: '' });
assert(unavailableOcr.categories.ocrSupport.evaluated === false);
assert(unavailableOcr.score < 100);
assert(unavailableOcr.failedChecks.every((check) => check.evaluated === false || !check.passed));

console.log('Validation tests passed.');
