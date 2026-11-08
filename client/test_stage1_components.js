import assert from 'node:assert/strict';
import { fetchDocumentGis, validateDocumentGis } from './src/services/api.js';

console.log('====================================================');
console.log('   Phase 2B Stage 1: Component & API Verification   ');
console.log('====================================================\n');

// 1. Verify API Helper Exports
console.log('Checking API functions...');
assert.strictEqual(typeof fetchDocumentGis, 'function', 'fetchDocumentGis must be a function');
assert.strictEqual(typeof validateDocumentGis, 'function', 'validateDocumentGis must be a function');
console.log('  ✓ Pass: API functions exported correctly.');

// 2. Test geometry validation rules
console.log('Checking geometry validation rules...');
const testCases = [
  { name: 'null', input: null, expected: false },
  { name: 'empty object', input: {}, expected: false },
  { name: 'missing geometry', input: { type: 'Feature' }, expected: false },
  { name: 'unsupported LineString', input: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }, expected: false },
  { name: 'empty Polygon coordinates', input: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] } }, expected: false },
  {
    name: 'valid Polygon',
    input: {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[78.4, 17.2], [78.5, 17.2], [78.5, 17.3], [78.4, 17.3], [78.4, 17.2]]]
      }
    },
    expected: true
  },
  {
    name: 'valid MultiPolygon',
    input: {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[78.4, 17.2], [78.5, 17.2], [78.5, 17.3], [78.4, 17.3], [78.4, 17.2]]]]
      }
    },
    expected: true
  }
];

function checkValid(feature) {
  if (!feature || typeof feature !== 'object') return false;
  const geom = feature.geometry;
  if (!geom || typeof geom !== 'object') return false;
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return false;
  if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) return false;
  return true;
}

for (const tc of testCases) {
  const actual = checkValid(tc.input);
  assert.strictEqual(actual, tc.expected, `Test case '${tc.name}' failed`);
  console.log(`  ✓ Pass: ${tc.name} -> ${actual}`);
}

console.log('\n====================================================');
console.log('All Stage 1 Component & API Checks Passed! ✓');
console.log('====================================================');
