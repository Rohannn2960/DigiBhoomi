/**
 * DigiBhoomi Semantic Search Migration Script
 * Migrates existing MongoDB land record embeddings to Xenova/multilingual-e5-base (768 dimensions).
 *
 * Features:
 * - Safe & Resumable: Skips documents already indexed with the current model and unchanged content
 * - Failure-resilient: Errors on individual documents are captured without aborting the entire migration
 * - Detailed reporting: Prints total documents, indexed count, skipped count, failed count, and errors
 * - Supports --force flag to re-index all records unconditionally
 *
 * Usage:
 *   node server/migrate_embeddings.js
 *   node server/migrate_embeddings.js --force
 */

require('dotenv').config();
const mongoose = require('mongoose');
const {
  backfillAllDocuments,
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_DIMENSIONS
} = require('./services/semanticSearchService');
const SemanticEmbedding = require('./models/SemanticEmbedding');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';

async function migrate() {
  const force = process.argv.includes('--force');
  console.log('====================================================');
  console.log('   DigiBhoomi Semantic Search Model Migration       ');
  console.log('====================================================');
  console.log(`Target Model:      ${CURRENT_EMBEDDING_MODEL}`);
  console.log(`Vector Dimensions: ${CURRENT_EMBEDDING_DIMENSIONS}`);
  console.log(`Force Re-index:    ${force}`);
  console.log('Connecting to MongoDB...');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB successfully.\n');

  const initialCurrentCount = await SemanticEmbedding.countDocuments({
    model: CURRENT_EMBEDDING_MODEL,
    dimensions: CURRENT_EMBEDDING_DIMENSIONS
  });
  const initialLegacyCount = await SemanticEmbedding.countDocuments({
    $or: [
      { model: { $ne: CURRENT_EMBEDDING_MODEL } },
      { dimensions: { $ne: CURRENT_EMBEDDING_DIMENSIONS } },
      { model: { $exists: false } }
    ]
  });

  console.log(`Pre-migration status:`);
  console.log(`  - Records with active model (${CURRENT_EMBEDDING_MODEL}): ${initialCurrentCount}`);
  console.log(`  - Records requiring migration / legacy:                   ${initialLegacyCount}\n`);
  console.log('Starting migration backfill process...');

  const startTime = Date.now();
  const summary = await backfillAllDocuments({ force, batchSize: 5 });
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n====================================================');
  console.log('   Migration Summary                                ');
  console.log('====================================================');
  console.log(`Total Documents Scanned: ${summary.totalDocuments}`);
  console.log(`Successfully Indexed:    ${summary.indexedCount}`);
  console.log(`Skipped (Unchanged):     ${summary.skippedCount}`);
  console.log(`Failed:                  ${summary.failedCount}`);
  console.log(`Time Elapsed:            ${durationSec}s`);

  if (summary.errors && summary.errors.length > 0) {
    console.log('\nMigration Errors:');
    summary.errors.forEach((err, idx) => {
      console.log(`  [${idx + 1}] Doc ID: ${err.documentId} -> ${err.error}`);
    });
  }

  const finalCurrentCount = await SemanticEmbedding.countDocuments({
    model: CURRENT_EMBEDDING_MODEL,
    dimensions: CURRENT_EMBEDDING_DIMENSIONS
  });
  const finalLegacyCount = await SemanticEmbedding.countDocuments({
    $or: [
      { model: { $ne: CURRENT_EMBEDDING_MODEL } },
      { dimensions: { $ne: CURRENT_EMBEDDING_DIMENSIONS } },
      { model: { $exists: false } }
    ]
  });

  console.log('\nPost-migration status:');
  console.log(`  - Active multilingual embeddings (768-dim): ${finalCurrentCount}`);
  console.log(`  - Remaining legacy embeddings:              ${finalLegacyCount}`);

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB. Migration completed successfully.');
  process.exit(summary.failedCount > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('\nFatal Migration Error:', err);
  process.exit(1);
});
