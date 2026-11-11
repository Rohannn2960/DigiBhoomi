import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi DocumentComparisonModal Tests         ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function runTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ Pass: ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  ✗ Fail: ${name}`);
      console.error(`    ${err.message}`);
      failed += 1;
    }
  }

  const vite = await createServer({
    root: __dirname,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent'
  });

  try {
    const mod = await vite.ssrLoadModule('/src/components/DocumentComparisonModal.jsx');
    const DocumentComparisonModal = mod.default;
    const { normalizeComparisonDocId, createComparisonRequestManager } = mod;

    await runTest('1. Heading renamed to Land-record Overview while preserving metadata separation, confidence, filters, and disclaimer', async () => {
      const modalPath = path.join(__dirname, 'src', 'components', 'DocumentComparisonModal.jsx');
      const source = fs.readFileSync(modalPath, 'utf8');

      assert.ok(source.includes('Land-record Overview:'), 'Must display "Land-record Overview:" heading');
      assert.strictEqual(source.includes('Cadastral Overview'), false, 'Must not contain "Cadastral Overview"');
      assert.ok(source.includes('Document Metadata (Isolated from Cadastral Discrepancies)'));
      assert.ok(source.includes('Cadastral & Land Record Attributes'));
      assert.ok(source.includes("setViewFilter('all_land')"));
      assert.ok(source.includes("setViewFilter('discrepancies')"));
      assert.ok(source.includes("setViewFilter('identical')"));
      assert.ok(source.includes("setViewFilter('metadata')"));
      assert.ok(source.includes('docAConfidence'));
      assert.ok(source.includes('docBConfidence'));
      assert.ok(source.includes('Administrative Review Disclaimer:'));
    });

    await runTest('2. Component renders cleanly across closed, missing, invalid, and identical selection states', async () => {
      const closedHtml = renderToStaticMarkup(
        React.createElement(DocumentComparisonModal, {
          isOpen: false,
          onClose: () => {},
          initialDocA: 'doc-1',
          initialDocB: 'doc-2'
        })
      );
      assert.strictEqual(closedHtml, '');

      const identicalHtml = renderToStaticMarkup(
        React.createElement(DocumentComparisonModal, {
          isOpen: true,
          onClose: () => {},
          initialDocA: 'doc-1',
          initialDocB: 'doc-1'
        })
      );
      assert.ok(identicalHtml.includes('Please select two different documents to compare.'));

      const invalidPropHtml = renderToStaticMarkup(
        React.createElement(DocumentComparisonModal, {
          isOpen: true,
          onClose: () => {},
          initialDocA: {},
          initialDocB: null
        })
      );
      assert.ok(invalidPropHtml.includes('Compare Any Two Documents'));
    });

    await runTest('3. normalizeComparisonDocId safely normalizes strings, objects, numbers, and rejects invalid values', async () => {
      assert.strictEqual(normalizeComparisonDocId('  abc123  '), 'abc123');
      assert.strictEqual(normalizeComparisonDocId({ _id: ' id-from-underscore ' }), 'id-from-underscore');
      assert.strictEqual(normalizeComparisonDocId({ id: ' id-from-prop ' }), 'id-from-prop');
      assert.strictEqual(normalizeComparisonDocId(42), '42');
      assert.strictEqual(normalizeComparisonDocId('   '), '');
      assert.strictEqual(normalizeComparisonDocId(null), '');
      assert.strictEqual(normalizeComparisonDocId(undefined), '');
      assert.strictEqual(normalizeComparisonDocId({}), '');
      assert.strictEqual(normalizeComparisonDocId(true), '');
    });

    await runTest('4. Rapid selection changes: slower older response never overwrites newer comparison result', async () => {
      const pending = new Map();
      let state = { isLoading: false, comparisonData: null, error: null };

      const manager = createComparisonRequestManager({
        fetchComparison: (a, b) => {
          const d = createDeferred();
          pending.set(`${a}:${b}`, d);
          return d.promise;
        },
        onStateChange: (next) => {
          state = next;
        }
      });

      const p1 = manager.run(true, 'doc-1', 'doc-2');
      assert.strictEqual(state.isLoading, true);

      manager.invalidate();
      const p2 = manager.run(true, 'doc-1', 'doc-3');
      assert.strictEqual(state.isLoading, true);

      // Newer request (doc-1, doc-3) settles first
      pending.get('doc-1:doc-3').resolve({ pair: '1-3' });
      await p2;
      assert.deepStrictEqual(state, {
        isLoading: false,
        comparisonData: { pair: '1-3' },
        error: null
      });

      // Stale request (doc-1, doc-2) settles later and must be ignored
      pending.get('doc-1:doc-2').resolve({ pair: '1-2-stale' });
      await p1;
      assert.deepStrictEqual(state, {
        isLoading: false,
        comparisonData: { pair: '1-3' },
        error: null
      });
    });

    await runTest('5. Rapid selection changes: stale request error does not clear loading or overwrite active/newer state', async () => {
      const pending = new Map();
      let state = { isLoading: false, comparisonData: null, error: null };

      const manager = createComparisonRequestManager({
        fetchComparison: (a, b) => {
          const d = createDeferred();
          pending.set(`${a}:${b}`, d);
          return d.promise;
        },
        onStateChange: (next) => {
          state = next;
        }
      });

      const p1 = manager.run(true, 'doc-1', 'doc-bad');
      manager.invalidate();
      const p2 = manager.run(true, 'doc-1', 'doc-good');
      assert.strictEqual(state.isLoading, true);

      // Stale request fails while newer request is still in flight
      pending.get('doc-1:doc-bad').reject(new Error('Stale network timeout'));
      await p1;
      assert.strictEqual(state.isLoading, true, 'Loading must remain true for the newer in-flight request');
      assert.strictEqual(state.error, null, 'Stale error must be ignored');

      // Newer request succeeds
      pending.get('doc-1:doc-good').resolve({ pair: '1-good' });
      await p2;
      assert.deepStrictEqual(state, {
        isLoading: false,
        comparisonData: { pair: '1-good' },
        error: null
      });
    });

    await runTest('6. Closing modal while request is running ignores eventual resolve and reject results', async () => {
      // Subcase A: resolves after modal closes
      const dResolve = createDeferred();
      let changeCountA = 0;
      let stateA = { isLoading: false, comparisonData: null, error: null };
      const managerA = createComparisonRequestManager({
        fetchComparison: () => dResolve.promise,
        onStateChange: (next) => {
          changeCountA += 1;
          stateA = next;
        }
      });

      const pA = managerA.run(true, 'doc-1', 'doc-2');
      assert.strictEqual(stateA.isLoading, true);

      // Close modal while request is still pending
      managerA.invalidate();
      await managerA.run(false, 'doc-1', 'doc-2');
      const countAfterCloseA = changeCountA;
      assert.deepStrictEqual(stateA, {
        isLoading: false,
        comparisonData: null,
        error: null
      });

      dResolve.resolve({ pair: 'late-after-close' });
      await pA;
      assert.strictEqual(changeCountA, countAfterCloseA, 'Late resolution after close must not emit state updates');
      assert.deepStrictEqual(stateA, {
        isLoading: false,
        comparisonData: null,
        error: null
      });

      // Subcase B: rejects after modal closes / disposes
      const dReject = createDeferred();
      let changeCountB = 0;
      let stateB = { isLoading: false, comparisonData: null, error: null };
      const managerB = createComparisonRequestManager({
        fetchComparison: () => dReject.promise,
        onStateChange: (next) => {
          changeCountB += 1;
          stateB = next;
        }
      });

      const pB = managerB.run(true, 'doc-1', 'doc-2');
      managerB.dispose();
      const countAfterDisposeB = changeCountB;
      dReject.reject(new Error('Late error after unmount'));
      await pB;
      assert.strictEqual(changeCountB, countAfterDisposeB, 'Late rejection after dispose must not emit state updates');
      assert.strictEqual(stateB.error, null);
    });

    await runTest('7. Invalid or identical document IDs clear stale comparison data, stale errors, and reset loading state', async () => {
      let fetchCalls = 0;
      let pendingInFlight = null;
      let state = { isLoading: false, comparisonData: null, error: null };

      const manager = createComparisonRequestManager({
        fetchComparison: (a, b) => {
          fetchCalls += 1;
          if (a === 'fail-id') {
            return Promise.reject(new Error('Previous failure'));
          }
          if (a === 'slow-id') {
            pendingInFlight = createDeferred();
            return pendingInFlight.promise;
          }
          return Promise.resolve({ pair: `${a}-${b}` });
        },
        onStateChange: (next) => {
          state = next;
        }
      });

      // Seed loaded data, then transition to identical IDs (including surrounding whitespace)
      await manager.run(true, 'doc-1', 'doc-2');
      assert.deepStrictEqual(state.comparisonData, { pair: 'doc-1-doc-2' });

      await manager.run(true, 'doc-1', ' doc-1 ');
      assert.strictEqual(fetchCalls, 1, 'Identical IDs must not trigger API call');
      assert.deepStrictEqual(state, {
        isLoading: false,
        comparisonData: null,
        error: null
      });

      // Seed an error, then transition to invalid/empty IDs
      await manager.run(true, 'fail-id', 'doc-2');
      assert.strictEqual(state.error, 'Previous failure');

      for (const invalidPair of [
        ['', 'doc-2'],
        ['doc-1', '   '],
        [null, 'doc-2'],
        [{}, 'doc-2'],
        ['doc-1', undefined]
      ]) {
        await manager.run(true, 'fail-id', 'doc-2');
        assert.strictEqual(state.error, 'Previous failure');
        const callsBefore = fetchCalls;
        await manager.run(true, invalidPair[0], invalidPair[1]);
        assert.strictEqual(fetchCalls, callsBefore, `Invalid pair ${JSON.stringify(invalidPair)} must not call API`);
        assert.deepStrictEqual(state, {
          isLoading: false,
          comparisonData: null,
          error: null
        });
      }

      // Transition from in-flight request to invalid selection invalidates pending response
      const slowPromise = manager.run(true, 'slow-id', 'doc-2');
      assert.strictEqual(state.isLoading, true);
      manager.invalidate();
      await manager.run(true, 'slow-id', '');
      assert.deepStrictEqual(state, {
        isLoading: false,
        comparisonData: null,
        error: null
      });
      pendingInFlight.resolve({ pair: 'stale-slow' });
      await slowPromise;
      assert.deepStrictEqual(state, {
        isLoading: false,
        comparisonData: null,
        error: null
      });
    });
  } finally {
    await vite.close();
  }

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
