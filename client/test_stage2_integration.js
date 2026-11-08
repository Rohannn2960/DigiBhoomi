// client/test_stage2_integration.js
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Starting DigiBhoomi Phase 2B Stage 2 Integration Verification...\n');

// 1. Verify GisValidationTab.jsx
const tabPath = path.join(__dirname, 'src', 'components', 'GisValidationTab.jsx');
assert.ok(fs.existsSync(tabPath), 'GisValidationTab.jsx must exist');
const tabSource = fs.readFileSync(tabPath, 'utf8');

assert.ok(tabSource.includes('fetchDocumentGis'), 'Must import and use fetchDocumentGis');
assert.ok(tabSource.includes('validateDocumentGis'), 'Must import and use validateDocumentGis');
assert.ok(tabSource.includes('GisBoundaryMap'), 'Must import and render GisBoundaryMap');
assert.ok(tabSource.includes('GisDiscrepancyList'), 'Must import and render GisDiscrepancyList');

// Status handling
assert.ok(tabSource.includes('MATCHED'), 'Must handle MATCHED status');
assert.ok(tabSource.includes('POTENTIAL_DISCREPANCY'), 'Must handle POTENTIAL_DISCREPANCY status');
assert.ok(tabSource.includes('UNABLE_TO_VERIFY'), 'Must handle UNABLE_TO_VERIFY status');
assert.ok(tabSource.includes('NOT_RUN'), 'Must handle NOT_RUN status');

// Stale dataset handling
assert.ok(tabSource.includes('isStale'), 'Must handle isStale dataset warning');
assert.ok(tabSource.includes('staleReason'), 'Must display staleReason');

// Missing geometry warning
assert.ok(tabSource.includes('isMatchedWithoutGeometry'), 'Must detect matched boundary without geometry');

// Matched administrative identifiers
assert.ok(tabSource.includes('matchedDistrict'), 'Must display matchedDistrict');
assert.ok(tabSource.includes('matchedMandal'), 'Must display matchedMandal');
assert.ok(tabSource.includes('mandalType'), 'Must display mandalType');
assert.ok(tabSource.includes('revenueDivision'), 'Must display revenueDivision');

// Dataset metadata
assert.ok(tabSource.includes('datasetMetadata'), 'Must display dataset metadata');
assert.ok(tabSource.includes('featureCount'), 'Must display featureCount');

// Mandatory limitation disclaimer
assert.ok(tabSource.includes('disclaimer'), 'Must display backend limitation disclaimer');

// Role-based validation action
assert.ok(tabSource.includes('canValidate'), 'Must respect canValidate prop');
assert.ok(tabSource.includes('onValidationComplete'), 'Must call onValidationComplete callback');
console.log('  ✅ GisValidationTab.jsx component source checks passed.');

// 2. Verify ReviewPage.jsx integration
const reviewPath = path.join(__dirname, 'src', 'pages', 'ReviewPage.jsx');
assert.ok(fs.existsSync(reviewPath), 'ReviewPage.jsx must exist');
const reviewSource = fs.readFileSync(reviewPath, 'utf8');

// Imports
assert.ok(reviewSource.includes("import GisValidationTab from '../components/GisValidationTab';"), 'Must import GisValidationTab');
assert.ok(/import\s*\{[^}]*MapPin[^}]*\}\s*from\s*'lucide-react';/.test(reviewSource), 'Must import MapPin from lucide-react');

// Tab navigation
assert.ok(reviewSource.includes("setActiveTab('gis')"), "Must have onClick handler setting activeTab to 'gis'");
assert.ok(reviewSource.includes('GIS & Boundaries'), 'Must have "GIS & Boundaries" tab button label');

// Tab panel rendering
assert.ok(
  reviewSource.includes("activeTab === 'gis'") &&
  reviewSource.includes('<GisValidationTab'),
  "Must render GisValidationTab when activeTab === 'gis'"
);
assert.ok(reviewSource.includes('documentId={record._id}'), 'Must pass documentId={record._id} to GisValidationTab');
assert.ok(reviewSource.includes('canValidate={canReview}'), 'Must pass canValidate={canReview} to GisValidationTab');
assert.ok(reviewSource.includes('onValidationComplete={handleReloadDocument}'), 'Must pass onValidationComplete={handleReloadDocument} to GisValidationTab');

// Compact GIS indicator in Extracted Fields tab
assert.ok(reviewSource.includes('TGRAC Administrative Boundary Status:'), 'Must show compact GIS indicator in fields tab');
assert.ok(reviewSource.includes('View GIS Map & Boundary'), 'Must provide link to GIS tab from fields tab');
console.log('  ✅ ReviewPage.jsx integration checks passed.');

console.log('\n🎉 ALL PHASE 2B STAGE 2 VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
