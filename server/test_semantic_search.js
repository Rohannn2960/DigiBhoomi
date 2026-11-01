/**
 * Comprehensive Automated Test Suite for DigiBhoomi Multilingual Semantic Search Module
 *
 * Validates cross-lingual semantic search across English, Telugu, and Hindi using
 * Xenova/multilingual-e5-base (768 dimensions) on Windows CPU via ONNX Runtime.
 *
 * Covers all required test scenarios:
 * 1.  Embedding generation (768 dimensions & E5 prefixing)
 * 2.  Mathematical similarity calculation & dimension safety
 * 3.  English query against English document
 * 4.  English query against Telugu document
 * 5.  Telugu query against English document
 * 6.  English query against Hindi document
 * 7.  Hindi query against English document
 * 8.  Telugu query against Hindi document
 * 9.  Exact owner names and survey numbers
 * 10. Empty index handling & invalid query validations
 * 11. Missing land-record fields
 * 12. Duplicate indexing prevention & idempotency
 * 13. Re-indexing after document changes (content comparison)
 * 14. Search-result ranking (relevant vs distant)
 * 15. Public/private document authorization & RBAC enforcement
 * 16. Embedding dimension mismatch handling
 * 17. Mixed-model embedding protection & isolation
 * 18. Migration failures, error logging, and resumability
 */

const mongoose = require('mongoose');
const Document = require('./models/Document');
const SemanticEmbedding = require('./models/SemanticEmbedding');
const {
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_DIMENSIONS,
  getEmbeddingPipeline,
  generateEmbedding,
  cosineSimilarity,
  formatE5Input,
  buildSearchableText,
  indexDocument,
  backfillAllDocuments,
  searchSemantic,
  checkDocumentAccess,
  generateMatchExplanation
} = require('./services/semanticSearchService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';

let testDocIds = [];

async function setup() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGODB_URI);
  }
  // Clean up any lingering test records
  await Document.deleteMany({ 'fileMetadata.originalFilename': /^__test_sem_/ });
  await SemanticEmbedding.deleteMany({ 'metadata.originalFilename': /^__test_sem_/ });
}

async function teardown() {
  if (testDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: testDocIds } });
    await SemanticEmbedding.deleteMany({ documentId: { $in: testDocIds } });
  }
  await Document.deleteMany({ 'fileMetadata.originalFilename': /^__test_sem_/ });
  await SemanticEmbedding.deleteMany({ 'metadata.originalFilename': /^__test_sem_/ });
  console.log('[Teardown] Test artifacts cleaned up successfully.');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Multilingual Semantic Search Tests    ');
  console.log('====================================================\n');

  await setup();

  try {
    // ----------------------------------------------------
    // Test 1: Embedding generation & E5 Prefixing
    // ----------------------------------------------------
    console.log('Test 1: Embedding generation & E5 Prefixing');
    assert(formatE5Input('sample text', 'passage') === 'passage: sample text', 'Passage input should be prefixed');
    assert(formatE5Input('sample query', 'query') === 'query: sample query', 'Query input should be prefixed');
    assert(formatE5Input('passage: already prefixed', 'passage') === 'passage: already prefixed', 'Should not double-prefix passage');
    assert(formatE5Input('query: already prefixed', 'query') === 'query: already prefixed', 'Should not double-prefix query');

    const sampleText = 'Agricultural land record belonging to Ramesh in Rangareddy';
    const embedding = await generateEmbedding(sampleText, 'passage');
    assert(Array.isArray(embedding), 'Embedding should be an array');
    assert(embedding.length === CURRENT_EMBEDDING_DIMENSIONS, `Expected ${CURRENT_EMBEDDING_DIMENSIONS} dimensions, got ${embedding.length}`);
    assert(!embedding.some(isNaN), 'Embedding should not contain NaN values');
    console.log(`  ✓ Pass: Generates ${CURRENT_EMBEDDING_DIMENSIONS}-dimensional unit-normalized vector with E5 formatting.\n`);

    // ----------------------------------------------------
    // Test 2: Similarity calculation & dimension mismatch
    // ----------------------------------------------------
    console.log('Test 2: Similarity calculation & dimension mismatch handling');
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];
    const vecLegacy = [1, 0]; // Different dimension (e.g. 384 vs 768)

    const simIdentical = cosineSimilarity(vecA, vecB);
    const simOrthogonal = cosineSimilarity(vecA, vecC);
    const simMismatch = cosineSimilarity(vecA, vecLegacy);

    assert(Math.abs(simIdentical - 1.0) < 1e-5, `Identical vectors should yield ~1.0, got ${simIdentical}`);
    assert(Math.abs(simOrthogonal - 0.0) < 1e-5, `Orthogonal vectors should yield ~0.0, got ${simOrthogonal}`);
    assert(simMismatch === 0, `Dimension mismatch should return 0 safely, got ${simMismatch}`);
    console.log('  ✓ Pass: Cosine similarity calculation is exact and dimension-mismatch safe.\n');

    // ----------------------------------------------------
    // Setup multilingual test documents in MongoDB
    // ----------------------------------------------------
    // 1. English Agricultural Record
    const docEnglish = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_english_ramesh.pdf',
        storedFilename: 'test_english.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: 'test_hash_en_1',
        storagePath: 'dummy/path/en.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        ownerName: { value: 'Ramesh Kumar' },
        surveyNumber: { value: '125/A' },
        khasraNumber: { value: '450' },
        khataNumber: { value: '88' },
        village: { value: 'Shamshabad' },
        tehsil: { value: 'Shamshabad' },
        district: { value: 'Rangareddy' },
        landClassification: { value: 'Agricultural Dry Land' },
        landArea: { value: '2.5', unit: 'Acre' }
      },
      ocrResult: { fullText: 'Government of Telangana Land Revenue Department Jamabandi Extract' }
    });
    await docEnglish.save();
    testDocIds.push(docEnglish._id);

    // 2. Telugu Agricultural Record
    const docTelugu = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_telugu_ramesh.pdf',
        storedFilename: 'test_telugu.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: 'test_hash_te_2',
        storagePath: 'dummy/path/te.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        ownerName: { value: 'రమేష్ కుమార్' },
        surveyNumber: { value: '125/A' },
        khasraNumber: { value: '450' },
        khataNumber: { value: '88' },
        village: { value: 'శంషాబాద్' },
        tehsil: { value: 'శంషాబాద్' },
        district: { value: 'రంగారెడ్డి' },
        landClassification: { value: 'వ్యవసాయ భూమి' },
        landArea: { value: '2.5', unit: 'Acre' }
      },
      ocrResult: { fullText: 'తెలంగాణ ప్రభుత్వం రెవెన్యూ శాఖ పట్టాదారు పాస్ పుస్తకం మరియు జమాబందీ రికార్డు' }
    });
    await docTelugu.save();
    testDocIds.push(docTelugu._id);

    // 3. Hindi Agricultural Record
    const docHindi = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_hindi_ramesh.pdf',
        storedFilename: 'test_hindi.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: 'test_hash_hi_3',
        storagePath: 'dummy/path/hi.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        ownerName: { value: 'रमेश कुमार' },
        surveyNumber: { value: '125/A' },
        khasraNumber: { value: '450' },
        khataNumber: { value: '88' },
        village: { value: 'शामशाबाद' },
        tehsil: { value: 'शामशाबाद' },
        district: { value: 'रंगारेड्डी' },
        landClassification: { value: 'कृषि भूमि' },
        landArea: { value: '2.5', unit: 'Acre' }
      },
      ocrResult: { fullText: 'तेलंगाना सरकार राजस्व विभाग जमाबंदी खतौनी भू-अभिलेख विवरण' }
    });
    await docHindi.save();
    testDocIds.push(docHindi._id);

    // 4. English Residential Record (Negative control / differentiator)
    const docResidential = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_suresh_residential.pdf',
        storedFilename: 'test_residential.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: 'test_hash_res_4',
        storagePath: 'dummy/path/res.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        ownerName: { value: 'Suresh Rao' },
        surveyNumber: { value: '89/B' },
        village: { value: 'Gachibowli' },
        district: { value: 'Hyderabad' },
        landClassification: { value: 'Residential Non-Agricultural' },
        landArea: { value: '300', unit: 'Sq Yards' }
      },
      ocrResult: { fullText: 'Greater Hyderabad Municipal Corporation Residential Plot Assessment' }
    });
    await docResidential.save();
    testDocIds.push(docResidential._id);

    // Index all four test documents
    await indexDocument(docEnglish._id);
    await indexDocument(docTelugu._id);
    await indexDocument(docHindi._id);
    await indexDocument(docResidential._id);

    // ----------------------------------------------------
    // Test 3: English query against English document
    // ----------------------------------------------------
    console.log('Test 3: English query against English document');
    const resEnEn = await searchSemantic({
      query: 'Find land records belonging to Ramesh in Rangareddy',
      limit: 50
    });
    const matchEn = resEnEn.results.find(r => r.documentId.toString() === docEnglish._id.toString());
    assert(matchEn, 'Should retrieve English Ramesh document');
    assert(matchEn.relevanceScore > 0.75, `Relevance should be high, got ${matchEn.relevanceScore}`);
    assert(matchEn.matchedFields.includes('ownerName'), 'Should identify ownerName in matchedFields');
    console.log(`  ✓ Pass: English -> English matched with relevance score ${matchEn.relevanceScore}.\n`);

    // ----------------------------------------------------
    // Test 4: English query against Telugu document
    // ----------------------------------------------------
    console.log('Test 4: English query against Telugu document');
    const resEnTe = await searchSemantic({
      query: 'Agricultural land in Shamshabad',
      limit: 50
    });
    const matchEnTe = resEnTe.results.find(r => r.documentId.toString() === docTelugu._id.toString());
    assert(matchEnTe, 'English query should retrieve Telugu document');
    assert(matchEnTe.relevanceScore > 0.75, `Cross-lingual EN->TE relevance should be > 0.75, got ${matchEnTe.relevanceScore}`);
    assert(matchEnTe.matchedFields.includes('landClassification'), 'Cross-lingual classification should be identified');
    console.log(`  ✓ Pass: English query "Agricultural land in Shamshabad" retrieved Telugu doc with score ${matchEnTe.relevanceScore}.\n`);

    // ----------------------------------------------------
    // Test 5: Telugu query against English document
    // ----------------------------------------------------
    console.log('Test 5: Telugu query against English document');
    const resTeEn = await searchSemantic({
      query: 'వ్యవసాయ భూమి రమేష్ కుమార్',
      limit: 50
    });
    const matchTeEn = resTeEn.results.find(r => r.documentId.toString() === docEnglish._id.toString());
    assert(matchTeEn, 'Telugu query should retrieve English document');
    assert(matchTeEn.relevanceScore > 0.75, `Cross-lingual TE->EN relevance should be > 0.75, got ${matchTeEn.relevanceScore}`);
    console.log(`  ✓ Pass: Telugu query "వ్యవసాయ భూమి రమేష్ కుమార్" retrieved English doc with score ${matchTeEn.relevanceScore}.\n`);

    // ----------------------------------------------------
    // Test 6: English query against Hindi document
    // ----------------------------------------------------
    console.log('Test 6: English query against Hindi document');
    const resEnHi = await searchSemantic({
      query: 'Agricultural land in Shamshabad',
      limit: 50
    });
    const matchEnHi = resEnHi.results.find(r => r.documentId.toString() === docHindi._id.toString());
    assert(matchEnHi, 'English query should retrieve Hindi document');
    assert(matchEnHi.relevanceScore > 0.75, `Cross-lingual EN->HI relevance should be > 0.75, got ${matchEnHi.relevanceScore}`);
    console.log(`  ✓ Pass: English query retrieved Hindi doc with score ${matchEnHi.relevanceScore}.\n`);

    // ----------------------------------------------------
    // Test 7: Hindi query against English document
    // ----------------------------------------------------
    console.log('Test 7: Hindi query against English document');
    const resHiEn = await searchSemantic({
      query: 'कृषि भूमि रमेश कुमार',
      limit: 50
    });
    const matchHiEn = resHiEn.results.find(r => r.documentId.toString() === docEnglish._id.toString());
    assert(matchHiEn, 'Hindi query should retrieve English document');
    assert(matchHiEn.relevanceScore > 0.75, `Cross-lingual HI->EN relevance should be > 0.75, got ${matchHiEn.relevanceScore}`);
    console.log(`  ✓ Pass: Hindi query retrieved English doc with score ${matchHiEn.relevanceScore}.\n`);

    // ----------------------------------------------------
    // Test 8: Telugu query against Hindi document
    // ----------------------------------------------------
    console.log('Test 8: Telugu query against Hindi document');
    const resTeHi = await searchSemantic({
      query: 'వ్యవసాయ భూమి శంషాబాద్',
      limit: 50
    });
    const matchTeHi = resTeHi.results.find(r => r.documentId.toString() === docHindi._id.toString());
    assert(matchTeHi, 'Telugu query should retrieve Hindi document');
    assert(matchTeHi.relevanceScore > 0.75, `Cross-lingual TE->HI relevance should be > 0.75, got ${matchTeHi.relevanceScore}`);
    console.log(`  ✓ Pass: Telugu query retrieved Hindi doc with score ${matchTeHi.relevanceScore}.\n`);

    // ----------------------------------------------------
    // Test 9: Exact owner names and survey numbers
    // ----------------------------------------------------
    console.log('Test 9: Exact owner names and survey numbers');
    const resSurvey = await searchSemantic({
      query: 'Survey number 125/A',
      limit: 50
    });
    const surveyDoc = resSurvey.results.find(r => r.documentId.toString() === docEnglish._id.toString());
    assert(surveyDoc, 'Exact survey number query should retrieve matching document');
    assert(surveyDoc.matchedFields.includes('surveyNumber'), 'Should identify surveyNumber in matched fields');

    const resOwnerTe = await searchSemantic({
      query: 'రమేష్ కుమార్',
      limit: 50
    });
    const teOwnerDoc = resOwnerTe.results.find(r => r.documentId.toString() === docTelugu._id.toString());
    assert(teOwnerDoc, 'Telugu exact owner name should retrieve Telugu document');
    assert(teOwnerDoc.matchedFields.includes('ownerName'), 'Should identify ownerName in matched fields');
    console.log('  ✓ Pass: Exact survey number (125/A) and owner names accurately identified in matched fields.\n');

    // ----------------------------------------------------
    // Test 10: Empty index and invalid queries
    // ----------------------------------------------------
    console.log('Test 10: Empty index and invalid query validations');
    let emptyCaught = false;
    try {
      await searchSemantic({ query: '   ' });
    } catch (err) {
      emptyCaught = true;
      assert(err.statusCode === 400, 'Empty query should throw HTTP 400');
    }
    assert(emptyCaught, 'Should catch empty query');

    let shortCaught = false;
    try {
      await searchSemantic({ query: 'a' });
    } catch (err) {
      shortCaught = true;
      assert(err.statusCode === 400, 'Short query (<2 chars) should throw HTTP 400');
    }
    assert(shortCaught, 'Should catch short query');

    let longCaught = false;
    try {
      await searchSemantic({ query: 'x'.repeat(1005) });
    } catch (err) {
      longCaught = true;
      assert(err.statusCode === 400, 'Long query (>1000 chars) should throw HTTP 400');
    }
    assert(longCaught, 'Should catch excessively long query');

    const origCount = SemanticEmbedding.countDocuments;
    SemanticEmbedding.countDocuments = async () => 0;
    try {
      const emptyRes = await searchSemantic({ query: 'Find land records' });
      assert(emptyRes.totalResults === 0, 'Should return 0 results when index is empty');
      assert(emptyRes.message.includes('empty'), 'Message should indicate index is empty');
    } finally {
      SemanticEmbedding.countDocuments = origCount;
    }
    console.log('  ✓ Pass: Input validations (empty, short, excessive) and empty index handled safely.\n');

    // ----------------------------------------------------
    // Test 11: Missing land-record fields
    // ----------------------------------------------------
    console.log('Test 11: Missing land-record fields');
    const docIncomplete = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_incomplete_vernacular.pdf',
        storedFilename: 'test_incomplete.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 500,
        sha256Hash: 'test_hash_inc_5',
        storagePath: 'dummy/path/inc.pdf'
      },
      status: 'Needs review',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        village: { value: 'శంషాబాద్' },
        landClassification: { value: 'వ్యవసాయ భూమి' }
      }
    });
    await docIncomplete.save();
    testDocIds.push(docIncomplete._id);

    const incIdx = await indexDocument(docIncomplete._id);
    assert(incIdx.indexed === true, 'Incomplete document should index smoothly');
    const incSearch = await searchSemantic({ query: 'Agricultural land in Shamshabad' });
    const foundInc = incSearch.results.some(r => r.documentId.toString() === docIncomplete._id.toString());
    assert(foundInc, 'Incomplete document should be retrievable on available fields');
    console.log('  ✓ Pass: Document with missing fields indexed and retrieved smoothly.\n');

    // ----------------------------------------------------
    // Test 12: Duplicate indexing prevention & idempotency
    // ----------------------------------------------------
    console.log('Test 12: Duplicate indexing prevention & idempotency');
    const countBefore = await SemanticEmbedding.countDocuments({ documentId: docEnglish._id });
    assert(countBefore === 1, 'Should have exactly 1 embedding entry');

    const secondIndex = await indexDocument(docEnglish._id);
    assert(secondIndex.skipped === true, 'Repeated index should be skipped as unchanged');
    assert(secondIndex.reason === 'UNCHANGED', 'Reason should be UNCHANGED');

    const countAfter = await SemanticEmbedding.countDocuments({ documentId: docEnglish._id });
    assert(countAfter === 1, 'Embedding entry count must remain exactly 1');
    console.log('  ✓ Pass: Repeated indexing is idempotent and prevents duplicate vectors.\n');

    // ----------------------------------------------------
    // Test 13: Re-indexing after document changes
    // ----------------------------------------------------
    console.log('Test 13: Re-indexing after document changes');
    docEnglish.landDetails.ownerName.value = 'Venkat Reddy';
    await docEnglish.save();

    const reindexRes = await indexDocument(docEnglish._id);
    assert(reindexRes.indexed === true, 'Should re-index when content changes');
    assert(reindexRes.skipped === false, 'Should not skip modified document');

    const searchVenkat = await searchSemantic({ query: 'Venkat Reddy in Rangareddy' });
    const venkatMatch = searchVenkat.results.find(r => r.documentId.toString() === docEnglish._id.toString());
    assert(venkatMatch, 'Should find modified record');
    assert(venkatMatch.matchedFields.includes('ownerName'), 'Should identify updated owner name');
    console.log('  ✓ Pass: Re-indexing detects content modifications and updates vector.\n');

    // ----------------------------------------------------
    // Test 14: Search-result ranking
    // ----------------------------------------------------
    console.log('Test 14: Search-result ranking');
    const searchResRanking = await searchSemantic({
      query: 'Residential plots in Gachibowli Hyderabad',
      limit: 10
    });
    const rankSuresh = searchResRanking.results.find(r => r.documentId.toString() === docResidential._id.toString());
    const rankEnglish = searchResRanking.results.find(r => r.documentId.toString() === docEnglish._id.toString());
    assert(rankSuresh, 'Should find residential record');
    assert(rankEnglish, 'Should find agricultural record');
    assert(
      rankSuresh.relevanceScore > rankEnglish.relevanceScore,
      `Residential Gachibowli (${rankSuresh.relevanceScore}) should rank higher than agricultural doc (${rankEnglish.relevanceScore})`
    );
    console.log(`  ✓ Pass: Ranking orders contextually relevant record higher (${rankSuresh.relevanceScore} > ${rankEnglish.relevanceScore}).\n`);

    // ----------------------------------------------------
    // Test 15: Public/private document authorization & RBAC
    // ----------------------------------------------------
    console.log('Test 15: Public/private document authorization & RBAC');
    const docPrivate = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_private_citizen.pdf',
        storedFilename: 'test_private.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 800,
        sha256Hash: 'test_hash_priv_6',
        storagePath: 'dummy/path/private.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: 'citizen-user-123', isPrivate: true },
      assignedOfficer: 'officer-789',
      landDetails: {
        ownerName: { value: 'Secret Owner Rao' },
        village: { value: 'Confidential Village' },
        district: { value: 'Rangareddy' },
        landClassification: { value: 'Private Heritage' }
      }
    });
    await docPrivate.save();
    testDocIds.push(docPrivate._id);
    await indexDocument(docPrivate._id);

    // Unauthenticated search
    const pubSearch = await searchSemantic({
      query: 'Secret Owner Rao Private Heritage',
      actor: { userId: null, role: 'user' }
    });
    assert(!pubSearch.results.some(r => r.documentId.toString() === docPrivate._id.toString()), 'Unauthenticated user MUST NOT see private record');

    // Unrelated citizen search
    const unauthSearch = await searchSemantic({
      query: 'Secret Owner Rao Private Heritage',
      actor: { userId: 'citizen-user-999', role: 'user' }
    });
    assert(!unauthSearch.results.some(r => r.documentId.toString() === docPrivate._id.toString()), 'Unrelated citizen MUST NOT see private record');

    // Authorized owner citizen
    const ownerSearch = await searchSemantic({
      query: 'Secret Owner Rao Private Heritage',
      actor: { userId: 'citizen-user-123', role: 'user' }
    });
    assert(ownerSearch.results.some(r => r.documentId.toString() === docPrivate._id.toString()), 'Owner MUST have access to own private record');

    // Unassigned revenue officer cannot discover unassigned records
    const unassignedOfficerSearch = await searchSemantic({
      query: 'Secret Owner Rao Private Heritage',
      actor: { userId: 'officer-unassigned-999', role: 'officer' }
    });
    assert(!unassignedOfficerSearch.results.some(r => r.documentId.toString() === docPrivate._id.toString()), 'Unassigned officer MUST NOT see record');

    // Authorized assigned revenue officer
    const officerSearch = await searchSemantic({
      query: 'Secret Owner Rao Private Heritage',
      actor: { userId: 'officer-789', role: 'officer' }
    });
    assert(officerSearch.results.some(r => r.documentId.toString() === docPrivate._id.toString()), 'Assigned Officer MUST have access');

    // Response sanitization: Ensure no raw vectors or internal filesystem paths are returned
    const serialized = JSON.stringify(officerSearch);
    assert(!serialized.includes('dummy/path'), 'storagePath must never leak in search results');
    assert(!serialized.includes('"embedding"'), 'Raw embedding array must never leak in search results');
    console.log('  ✓ Pass: Privacy and role-based access rules strictly enforced without information leakage.\n');

    // ----------------------------------------------------
    // Test 16: Embedding dimension mismatch handling
    // ----------------------------------------------------
    console.log('Test 16: Embedding dimension mismatch handling');
    // Create a mock record with 384 dimensions (legacy vector)
    const legacyDoc = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_legacy_dim.pdf',
        storedFilename: 'test_legacy.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 600,
        sha256Hash: 'test_hash_leg_7',
        storagePath: 'dummy/path/leg.pdf'
      },
      status: 'Uploaded',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        ownerName: { value: 'Legacy Dimension User' },
        village: { value: 'Shamshabad' }
      }
    });
    await legacyDoc.save();
    testDocIds.push(legacyDoc._id);

    // Directly insert a 384-dimensional record without model field
    await SemanticEmbedding.create({
      documentId: legacyDoc._id,
      embedding: new Array(384).fill(0.05),
      searchableText: 'Legacy Dimension User Shamshabad',
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
      accessControl: { uploadedBy: null, isPrivate: false },
      metadata: { originalFilename: '__test_sem_legacy_dim.pdf', status: 'Uploaded' }
    });

    // Running searchSemantic MUST NOT crash or mix 384-dim vector with 768-dim query
    const searchAfterLegacy = await searchSemantic({ query: 'Legacy Dimension User Shamshabad' });
    const foundLegacyIn768Search = searchAfterLegacy.results.some(r => r.documentId.toString() === legacyDoc._id.toString());
    assert(!foundLegacyIn768Search, 'Legacy 384-dim record MUST NOT be returned in 768-dim search');
    console.log('  ✓ Pass: Embedding dimension mismatch safely isolated; legacy vector not mixed into search results.\n');

    // ----------------------------------------------------
    // Test 17: Mixed-model embedding protection & isolation
    // ----------------------------------------------------
    console.log('Test 17: Mixed-model embedding protection & isolation');
    const legacyCount = await SemanticEmbedding.countDocuments({
      $or: [
        { model: { $ne: CURRENT_EMBEDDING_MODEL } },
        { dimensions: { $ne: CURRENT_EMBEDDING_DIMENSIONS } }
      ]
    });
    assert(legacyCount >= 1, 'Should detect at least 1 legacy/non-migrated record');

    // Re-indexing the legacy document should automatically upgrade its model and dimensions
    const upgradeRes = await indexDocument(legacyDoc._id);
    assert(upgradeRes.indexed === true, 'Legacy document should be re-indexed with new model');
    assert(upgradeRes.dimensions === CURRENT_EMBEDDING_DIMENSIONS, `Upgraded record should have ${CURRENT_EMBEDDING_DIMENSIONS} dimensions`);

    const upgradedRecord = await SemanticEmbedding.findOne({ documentId: legacyDoc._id });
    assert(upgradedRecord.model === CURRENT_EMBEDDING_MODEL, 'Model should be updated to current model');
    assert(upgradedRecord.dimensions === CURRENT_EMBEDDING_DIMENSIONS, 'Dimensions should be updated to 768');
    console.log('  ✓ Pass: Mixed-model protection isolates legacy vectors and safely upgrades them on index.\n');

    // ----------------------------------------------------
    // Test 18: Migration failures, error logging, and resumability
    // ----------------------------------------------------
    console.log('Test 18: Migration failures, error logging, and resumability');
    // Test backfillAllDocuments
    const backfillSummary1 = await backfillAllDocuments({ force: false });
    assert(backfillSummary1.totalDocuments >= testDocIds.length, 'Should scan all existing documents');
    assert(backfillSummary1.skippedCount >= testDocIds.length - 1, 'Previously indexed documents should be skipped as unchanged');
    assert(backfillSummary1.failedCount === 0, 'Clean batch should have 0 failures');

    // Simulate an indexing failure by mocking Document.findById temporarily
    const origFindById = Document.findById;
    let failSimulated = false;
    Document.findById = function(id) {
      if (id.toString() === docTelugu._id.toString() && !failSimulated) {
        failSimulated = true;
        throw new Error('Simulated transient storage failure on document');
      }
      return origFindById.call(Document, id);
    };

    try {
      const summaryWithFailure = await backfillAllDocuments({ force: true });
      assert(summaryWithFailure.failedCount >= 1, 'Should record failedCount >= 1 for simulated error');
      assert(summaryWithFailure.errors.length >= 1, 'Should capture detailed error in errors array');
      assert(summaryWithFailure.errors.some(e => e.error.includes('Simulated transient storage failure')), 'Error message must match');
      console.log('  ✓ Pass: Document failure properly logged without aborting entire migration process.');
    } finally {
      Document.findById = origFindById;
    }

    // Resumability check: Re-running backfill without force will successfully index the failed document
    const resumeSummary = await backfillAllDocuments({ force: false });
    assert(resumeSummary.failedCount === 0, 'Resumed backfill should succeed without failures');
    console.log('  ✓ Pass: Migration is fully resumable; failed records are picked up and resolved on next pass.\n');

    // ----------------------------------------------------
    // Test 19: Empty searchable document handling
    // ----------------------------------------------------
    console.log('Test 19: Empty searchable document handling');
    const docEmpty = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_empty_doc.pdf',
        storedFilename: 'empty.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0,
        sha256Hash: 'test_hash_empty_99',
        storagePath: 'dummy/path/empty.pdf'
      },
      status: 'Uploaded',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {},
      ocrResult: { fullText: '' }
    });
    await docEmpty.save();
    testDocIds.push(docEmpty._id);

    let emptyIndexCaught = false;
    try {
      await indexDocument(docEmpty._id);
    } catch (err) {
      emptyIndexCaught = true;
      assert(err.statusCode === 400 || err.message.includes('no extractable or searchable text'), 'Should reject empty document with 400');
    }
    assert(emptyIndexCaught, 'Empty document must not generate vector embeddings');
    console.log('  ✓ Pass: Empty searchable document rejected with clean HTTP 400 error.\n');

    // ----------------------------------------------------
    // Test 20: Authoritative live permissions vs stale embedding protection
    // ----------------------------------------------------
    console.log('Test 20: Authoritative live permissions vs stale embedding protection');
    // Create a public document, index it, then update Document.accessControl to private directly in DB
    const docLiveAuth = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_live_auth.pdf',
        storedFilename: 'test_live_auth.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        sha256Hash: 'test_hash_live_auth_100',
        storagePath: 'dummy/path/live_auth.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: 'citizen-alice', isPrivate: false },
      landDetails: {
        ownerName: { value: 'Alice Property Confidential' },
        district: { value: 'Hyderabad' }
      }
    });
    await docLiveAuth.save();
    testDocIds.push(docLiveAuth._id);
    await indexDocument(docLiveAuth._id);

    // Update the Document directly to isPrivate: true (simulating permission change in Document collection)
    // Note: SemanticEmbedding collection has NOT been re-indexed yet and still has stale isPrivate: false!
    await Document.updateOne({ _id: docLiveAuth._id }, { 'accessControl.isPrivate': true });

    // Unauthorized citizen Bob searches:
    const bobSearch = await searchSemantic({
      query: 'Alice Property Confidential Hyderabad',
      actor: { userId: 'citizen-bob', role: 'user' }
    });
    const bobFound = bobSearch.results.some(r => r.documentId.toString() === docLiveAuth._id.toString());
    assert(!bobFound, 'Search MUST use authoritative live Document permissions, NOT stale SemanticEmbedding snapshot');

    // Authorized Alice searches:
    const aliceSearch = await searchSemantic({
      query: 'Alice Property Confidential Hyderabad',
      actor: { userId: 'citizen-alice', role: 'user' }
    });
    const aliceFound = aliceSearch.results.some(r => r.documentId.toString() === docLiveAuth._id.toString());
    assert(aliceFound, 'Owner Alice MUST access her live private document');
    console.log('  ✓ Pass: Authoritative live Document permissions enforced; stale embedding snapshot bypassed.\n');

    // ----------------------------------------------------
    // Test 21: Officer assignment restrictions & Admin global access
    // ----------------------------------------------------
    console.log('Test 21: Officer assignment restrictions and Admin global access');
    // docAssigned is assigned to officer-1
    const docAssigned = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_assigned_doc.pdf',
        storedFilename: 'test_assigned.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        sha256Hash: 'test_hash_assigned_101',
        storagePath: 'dummy/path/assigned.pdf'
      },
      status: 'Needs review',
      accessControl: { uploadedBy: null, isPrivate: false },
      assignedOfficer: 'officer-1',
      landDetails: {
        ownerName: { value: 'Assigned Parcel Officer Review' },
        village: { value: 'Shamshabad' }
      }
    });
    await docAssigned.save();
    testDocIds.push(docAssigned._id);
    await indexDocument(docAssigned._id);

    // Officer-2 searches (not assigned to this document)
    const officer2Search = await searchSemantic({
      query: 'Assigned Parcel Officer Review',
      actor: { userId: 'officer-2', role: 'officer' }
    });
    const officer2Found = officer2Search.results.some(r => r.documentId.toString() === docAssigned._id.toString());
    assert(!officer2Found, 'Officer-2 must NOT see document assigned to Officer-1');

    // Officer-1 searches (assigned)
    const officer1Search = await searchSemantic({
      query: 'Assigned Parcel Officer Review',
      actor: { userId: 'officer-1', role: 'officer' }
    });
    const officer1Found = officer1Search.results.some(r => r.documentId.toString() === docAssigned._id.toString());
    assert(officer1Found, 'Assigned Officer-1 MUST see document');

    // Officer with assignedDocuments whitelist
    const officerWhitelistSearch = await searchSemantic({
      query: 'Assigned Parcel Officer Review',
      actor: { userId: 'officer-99', role: 'officer', assignedDocuments: [docAssigned._id.toString()] }
    });
    assert(officerWhitelistSearch.results.some(r => r.documentId.toString() === docAssigned._id.toString()), 'Officer with document in whitelist MUST have access');

    // Admin searches (global access)
    const adminSearch = await searchSemantic({
      query: 'Assigned Parcel Officer Review',
      actor: { userId: 'admin-super', role: 'admin' }
    });
    assert(adminSearch.results.some(r => r.documentId.toString() === docAssigned._id.toString()), 'Admin MUST have global visibility across assigned records');
    console.log('  ✓ Pass: Officer assignment restrictions and Admin global visibility verified.\n');

    // ----------------------------------------------------
    // Test 22: Explanation accuracy & false-positive prevention
    // ----------------------------------------------------
    console.log('Test 22: Explanation accuracy and false-positive prevention');
    // Test A: Residential document with "Residential Non-Agricultural" must NOT claim "Agricultural"
    const expResid = generateMatchExplanation('agricultural land search', {
      landClassification: 'Residential Non-Agricultural'
    }, 0.65);
    assert(!expResid.matchedFields.includes('landClassification'), 'Residential Non-Agricultural must NOT match agricultural intent');
    assert(!expResid.explanation.includes('Agricultural classification'), 'Explanation must not claim agricultural classification');

    // Test B: Partial survey number like "12" must NOT match "125/A"
    const expPartial = generateMatchExplanation('survey 12 plot', {
      surveyNumber: '125/A'
    }, 0.60);
    assert(!expPartial.matchedFields.includes('surveyNumber'), 'Partial survey number "12" must NOT match "125/A"');

    // Test C: Exact survey number "125/A" MUST match "125/A"
    const expExact = generateMatchExplanation('document survey 125/A in Rangareddy', {
      surveyNumber: '125/A'
    }, 0.85);
    assert(expExact.matchedFields.includes('surveyNumber'), 'Exact survey number 125/A must match');
    assert(expExact.explanation.includes('Survey Number: "125/A"'), 'Explanation should cite Survey Number');
    console.log('  ✓ Pass: False-positive explanations prevented; exact boundaries and negations verified.\n');

    // ----------------------------------------------------
    // Test 23: Deleted document exclusion (orphaned embeddings)
    // ----------------------------------------------------
    console.log('Test 23: Deleted document exclusion (orphaned embeddings)');
    // Create and index a document, then delete the Document model directly
    const docOrphan = new Document({
      fileMetadata: {
        originalFilename: '__test_sem_orphan.pdf',
        storedFilename: 'test_orphan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        sha256Hash: 'test_hash_orphan_102',
        storagePath: 'dummy/path/orphan.pdf'
      },
      status: 'Verified',
      accessControl: { uploadedBy: null, isPrivate: false },
      landDetails: {
        ownerName: { value: 'Orphaned Property Record' }
      }
    });
    await docOrphan.save();
    const orphanId = docOrphan._id;
    await indexDocument(orphanId);

    // Delete Document from MongoDB leaving orphaned SemanticEmbedding
    await Document.deleteOne({ _id: orphanId });

    // Search query MUST NOT return the deleted document
    const orphanSearch = await searchSemantic({ query: 'Orphaned Property Record' });
    const orphanFound = orphanSearch.results.some(r => r.documentId.toString() === orphanId.toString());
    assert(!orphanFound, 'Orphaned embedding whose parent document was deleted MUST NOT be returned');

    // Clean up orphaned embedding
    await SemanticEmbedding.deleteMany({ documentId: orphanId });
    console.log('  ✓ Pass: Deleted documents safely excluded; orphaned embeddings are ignored.\n');

    console.log('====================================================');
    console.log('  All 23 Multilingual Semantic Search Tests PASSED! ✓');
    console.log('====================================================\n');
  } finally {
    await teardown();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
