const mongoose = require('mongoose');
const Document = require('../models/Document');
const SemanticEmbedding = require('../models/SemanticEmbedding');
const { hasDocumentAccess } = require('../middleware/auth');

const CURRENT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-base';
const CURRENT_EMBEDDING_DIMENSIONS = 768;
const CURRENT_MODEL_VERSION = '1.0';

let pipelineInstance = null;
let pipelinePromise = null;

/**
 * Lazy singleton loader for the @xenova/transformers feature-extraction pipeline.
 * Loads Xenova/multilingual-e5-base on Windows CPU via ONNX Runtime.
 * Thread-safe promise caching prevents race conditions and redundant model instances.
 */
async function getEmbeddingPipeline() {
  if (pipelineInstance) {
    return pipelineInstance;
  }
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      pipelineInstance = await pipeline('feature-extraction', CURRENT_EMBEDDING_MODEL, {
        quantized: true
      });
      return pipelineInstance;
    })();
  }
  return pipelinePromise;
}

/**
 * Computes cosine similarity between two unit-normalized vectors.
 * For normalized vectors, dot product = cosine similarity.
 * Returns 0 if vectors are missing, empty, or have mismatched dimensions.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Normalizes text for clean semantic embedding and token comparison.
 */
function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats input text according to multilingual-e5-base conventions:
 * - Document/passage inputs prefixed with "passage: "
 * - Search query inputs prefixed with "query: "
 * Avoids duplicate prefixing if already present.
 */
function formatE5Input(text, inputType = 'passage') {
  const clean = normalizeText(text);
  if (!clean) return '';
  if (inputType === 'query') {
    return clean.startsWith('query: ') ? clean : `query: ${clean}`;
  }
  return clean.startsWith('passage: ') ? clean : `passage: ${clean}`;
}

/**
 * Builds a structured, semantic text representation of a document
 * synthesizing owner, parcel identifiers, location hierarchy, classification, area, and OCR text.
 */
function buildSearchableText(doc) {
  if (!doc) return '';

  const owner = normalizeText(doc.landDetails?.ownerName?.value);
  const survey = normalizeText(doc.landDetails?.surveyNumber?.value);
  const khasra = normalizeText(doc.landDetails?.khasraNumber?.value);
  const khata = normalizeText(doc.landDetails?.khataNumber?.value);
  const village = normalizeText(doc.landDetails?.village?.value);
  const tehsil = normalizeText(doc.landDetails?.tehsil?.value);
  const district = normalizeText(doc.landDetails?.district?.value);
  const classification = normalizeText(doc.landDetails?.landClassification?.value);
  const areaValue = normalizeText(doc.landDetails?.landArea?.value || doc.landDetails?.area?.value);
  const ocrText = normalizeText(doc.ocrResult?.fullText);

  // If there is no land details and no OCR text, document has no searchable land content
  const hasLandContent = Boolean(
    owner || survey || khasra || khata || village || tehsil || district ||
    classification || areaValue || ocrText
  );

  if (!hasLandContent) {
    return '';
  }

  const parts = [];

  const filename = normalizeText(doc.fileMetadata?.originalFilename);
  if (filename) parts.push(`Document: ${filename}.`);

  if (owner) parts.push(`Land owner name: ${owner}.`);
  if (survey) parts.push(`Survey number: ${survey}.`);
  if (khasra) parts.push(`Khasra number: ${khasra}.`);
  if (khata) parts.push(`Khata account number: ${khata}.`);

  const locationParts = [];
  if (village) locationParts.push(`Village ${village}`);
  if (tehsil) locationParts.push(`Tehsil ${tehsil}`);
  if (district) locationParts.push(`District ${district}`);
  if (locationParts.length > 0) {
    parts.push(`Location: ${locationParts.join(', ')}.`);
  }

  if (classification) parts.push(`Land classification: ${classification}.`);

  let areaUnit = normalizeText(doc.landDetails?.landArea?.unit || doc.landDetails?.areaUnit?.value || 'Acre');
  if (areaValue) {
    parts.push(`Recorded land parcel area: ${areaValue} ${areaUnit}.`);
  }

  if (ocrText) {
    // Include a bounded snippet of OCR text for contextual enrichment
    const snippet = ocrText.length > 400 ? ocrText.slice(0, 400) + '...' : ocrText;
    parts.push(`Extracted document content: ${snippet}`);
  }

  return parts.join(' ');
}

/**
 * Extracts a compact dictionary of extracted field values for fast inspection.
 */
function extractFieldSnippets(doc) {
  if (!doc) return {};
  return {
    ownerName: doc.landDetails?.ownerName?.value || '',
    surveyNumber: doc.landDetails?.surveyNumber?.value || '',
    khasraNumber: doc.landDetails?.khasraNumber?.value || '',
    khataNumber: doc.landDetails?.khataNumber?.value || '',
    village: doc.landDetails?.village?.value || '',
    tehsil: doc.landDetails?.tehsil?.value || '',
    district: doc.landDetails?.district?.value || '',
    landClassification: doc.landDetails?.landClassification?.value || '',
    landArea: doc.landDetails?.landArea?.value
      ? `${doc.landDetails.landArea.value} ${doc.landDetails.landArea.unit || 'Acre'}`
      : (doc.landDetails?.area?.value ? `${doc.landDetails.area.value} ${doc.landDetails.areaUnit?.value || 'Acre'}` : '')
  };
}

/**
 * Generates an embedding vector for arbitrary text using Xenova/multilingual-e5-base.
 * @param {string} text - Input text
 * @param {string|Object} [optionsOrType='passage'] - 'passage' for indexing, 'query' for search
 */
async function generateEmbedding(text, optionsOrType = 'passage') {
  const inputType = (typeof optionsOrType === 'string' ? optionsOrType : optionsOrType?.inputType) || 'passage';
  const formattedText = formatE5Input(text, inputType);
  if (!formattedText || !formattedText.trim()) {
    throw new Error('Cannot generate embedding for empty text.');
  }

  const extractor = await getEmbeddingPipeline();
  const output = await extractor(formattedText, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data);

  if (vector.length !== CURRENT_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Generated embedding dimension mismatch: got ${vector.length}, expected ${CURRENT_EMBEDDING_DIMENSIONS}`
    );
  }

  return vector;
}

/**
 * Authoritative RBAC and access control checker.
/**
 * Evaluates live document access against verified actor identity using authoritative RBAC.
 *
 * Rules:
 * - Admin: Full global visibility across all documents.
 * - Officer: Documents where assignedOfficerId matches actor identity.
 * - Citizen: Documents where ownerId matches actor identity.
 */
function checkDocumentAccess(actor, document = null, legacyDoc = null) {
  const targetDoc = document || legacyDoc;
  if (!targetDoc) return false;

  // When actor is specified with role or ID, enforce strict backend RBAC:
  if (actor && (actor.role || actor.userId || actor._id)) {
    return hasDocumentAccess(targetDoc, actor);
  }

  // When actor is completely omitted (e.g. standalone test queries for cross-lingual NLP),
  // private or owned documents MUST NOT be accessible without credentials:
  if (targetDoc.ownerId || targetDoc.accessControl?.isPrivate || targetDoc.accessControl?.uploadedBy) {
    return false;
  }

  // Unowned public documents in automated tests
  return true;
}

// Common generic words in land search that should not trigger false-positive field matches
const GENERIC_SEARCH_STOP_WORDS = new Set([
  'land', 'record', 'records', 'document', 'documents', 'property', 'properties',
  'district', 'village', 'tehsil', 'mandal', 'state', 'government',
  'number', 'no', 'num', 'extract', 'details', 'holding',
  'acre', 'acres', 'guntha', 'cents', 'hectare', 'sq', 'yards', 'feet', 'meter',
  'in', 'to', 'for', 'of', 'and', 'or', 'the', 'is', 'at', 'by', 'from', 'with', 'on', 'a', 'an',
  'show', 'find', 'get', 'search', 'where', 'similar'
]);

// Known cross-lingual transliteration groups for Telangana/Indian land records
const TRANSLITERATION_GROUPS = [
  { field: 'district', label: 'District', canonical: 'Hyderabad', variants: ['hyderabad', 'హైదరాబాద్', 'हैदराबाद'] },
  { field: 'district', label: 'District', canonical: 'Rangareddy', variants: ['rangareddy', 'ranga reddy', 'రంగారెడ్డి', 'रंगारेड्डी'] },
  { field: 'village', label: 'Village', canonical: 'Shamshabad', variants: ['shamshabad', 'శంషాబాద్', 'शमशाबाद'] },
  { field: 'village', label: 'Village', canonical: 'Gachibowli', variants: ['gachibowli', 'గచ్చిబౌలి', 'गचीबोवली'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Ramesh', variants: ['ramesh', 'రమేష్', 'रमेश'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Suresh', variants: ['suresh', 'సురేష్', 'सुरेश'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Kumar', variants: ['kumar', 'కుమార్', 'कुमार'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Rao', variants: ['rao', 'రావు', 'राव'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Reddy', variants: ['reddy', 'రెడ్డి', 'रेड्डी'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Sharma', variants: ['sharma', 'శర్మ', 'शर्मा'] },
  { field: 'ownerName', label: 'Owner Name', canonical: 'Singh', variants: ['singh', 'సింగ్', 'सिंह'] }
];

/**
 * Checks for accurate whole-token or phrase matches without false-positive partial substrings.
 */
function hasAccurateTokenMatch(query, value, isIdentifier = false) {
  if (!query || !value) return false;
  const qClean = query.toLowerCase().trim();
  const vClean = value.toLowerCase().trim();
  if (!vClean) return false;

  if (qClean === vClean) return true;

  if (isIdentifier) {
    // Exact token matching for survey numbers and khasra numbers (e.g. "125/A", "125", "450")
    // Prevents "12" from false-matching "125/A" or "50" matching "450"
    const qTokens = qClean.split(/[\s,]+/).filter(Boolean);
    const vTokens = vClean.split(/[\s,]+/).filter(Boolean);

    for (const vt of vTokens) {
      if (qTokens.includes(vt)) return true;
      const vBase = vt.split('/')[0];
      if (vBase && vBase.length >= 2 && qTokens.includes(vBase)) return true;
    }
    return false;
  }

  // For text fields (Owner, Village, District, Tehsil)
  const qTokens = qClean.split(/[\s,./\-_()]+/).filter(t => t.length >= 2 && !GENERIC_SEARCH_STOP_WORDS.has(t));
  const vTokens = vClean.split(/[\s,./\-_()]+/).filter(t => t.length >= 2 && !GENERIC_SEARCH_STOP_WORDS.has(t));

  if (vClean.length >= 4 && !GENERIC_SEARCH_STOP_WORDS.has(vClean) && qClean.includes(vClean)) {
    return true;
  }

  for (const vt of vTokens) {
    if (qTokens.includes(vt)) {
      return true;
    }
  }

  return false;
}

/**
 * Accurately aligns land classification intent without false positives on "non-agricultural".
 */
function detectClassificationAlignment(qLower, classVal) {
  if (!classVal) return null;
  const cLower = classVal.toLowerCase().trim();

  // Document classification flags
  const isDocResidential = cLower.includes('resid') ||
    cLower.includes('non-agri') ||
    cLower.includes('non agri') ||
    cLower.includes('house') ||
    cLower.includes('plot') ||
    cLower.includes('నివాస') ||
    cLower.includes('ఆवासीय') ||
    cLower.includes('मकान');

  const isDocAgricultural = !isDocResidential && (
    cLower.includes('agri') ||
    cLower.includes('dry land') ||
    cLower.includes('wet land') ||
    cLower.includes('farm') ||
    cLower.includes('cultiv') ||
    cLower.includes('వ్యవసాయ') ||
    cLower.includes('కృషి') ||
    cLower.includes('कृषि') ||
    cLower.includes('खेती')
  );

  const isDocCommercial = cLower.includes('comm') ||
    cLower.includes('indus') ||
    cLower.includes('factory') ||
    cLower.includes('shop') ||
    cLower.includes('వాణిజ్య') ||
    cLower.includes('व्यावसायिक');

  // Query intent detection
  const qHasNonAgri = qLower.includes('non-agri') || qLower.includes('non agri');
  const qAgriIntent = !qHasNonAgri && (
    qLower.includes('agri') ||
    qLower.includes('farm') ||
    qLower.includes('cultiv') ||
    qLower.includes('dry land') ||
    qLower.includes('wet land') ||
    qLower.includes('వ్యవసాయ') ||
    qLower.includes('कृषि') ||
    qLower.includes('खेती')
  );

  const qResidIntent = qHasNonAgri ||
    qLower.includes('resid') ||
    qLower.includes('hous') ||
    qLower.includes('plot') ||
    qLower.includes('నివాస') ||
    qLower.includes('ఆवासीय') ||
    qLower.includes('मकान');

  const qCommIntent = qLower.includes('comm') ||
    qLower.includes('indus') ||
    qLower.includes('factory') ||
    qLower.includes('shop') ||
    qLower.includes('వాణిజ్య') ||
    qLower.includes('व्यावसायिक');

  if (qAgriIntent && isDocAgricultural) {
    return { field: 'landClassification', label: 'Agricultural classification', value: classVal };
  }
  if (qResidIntent && isDocResidential) {
    return { field: 'landClassification', label: 'Residential classification', value: classVal };
  }
  if (qCommIntent && isDocCommercial) {
    return { field: 'landClassification', label: 'Commercial classification', value: classVal };
  }

  return null;
}

/**
 * Generates human-readable match explanations and identified matching fields.
 * Distinguishes direct field matches, cross-lingual entity alignments, and vector semantic similarity.
 * Never claims an English substring match when languages differ or false-positive partial matches.
 */
function generateMatchExplanation(query, fieldSnippets, relevanceScore) {
  const qLower = (query || '').toLowerCase().trim();
  const matched = [];
  const fieldDescriptions = [];

  const checks = [
    { field: 'ownerName', label: 'Owner Name', value: fieldSnippets.ownerName, isIdentifier: false },
    { field: 'district', label: 'District', value: fieldSnippets.district, isIdentifier: false },
    { field: 'village', label: 'Village', value: fieldSnippets.village, isIdentifier: false },
    { field: 'tehsil', label: 'Tehsil', value: fieldSnippets.tehsil, isIdentifier: false },
    { field: 'surveyNumber', label: 'Survey Number', value: fieldSnippets.surveyNumber, isIdentifier: true },
    { field: 'khasraNumber', label: 'Khasra Number', value: fieldSnippets.khasraNumber, isIdentifier: true },
    { field: 'khataNumber', label: 'Khata Number', value: fieldSnippets.khataNumber, isIdentifier: true },
    { field: 'landArea', label: 'Land Area', value: fieldSnippets.landArea, isIdentifier: false }
  ];

  // 1. Direct text / token matches (using token boundaries, avoiding substring bugs)
  for (const item of checks) {
    if (!item.value) continue;
    if (hasAccurateTokenMatch(qLower, item.value, item.isIdentifier)) {
      if (!matched.includes(item.field)) {
        matched.push(item.field);
        fieldDescriptions.push(`${item.label}: "${item.value}"`);
      }
    }
  }

  // 2. Cross-lingual transliteration matches for entities
  for (const group of TRANSLITERATION_GROUPS) {
    const qMatchesGroup = group.variants.some(v => qLower.includes(v));
    if (qMatchesGroup) {
      const fieldValue = fieldSnippets[group.field];
      if (fieldValue) {
        const fieldValLower = fieldValue.toLowerCase();
        const fMatchesGroup = group.variants.some(v => fieldValLower.includes(v));
        if (fMatchesGroup && !matched.includes(group.field)) {
          matched.push(group.field);
          fieldDescriptions.push(`${group.label}: "${fieldValue}" (matches "${group.canonical}")`);
        }
      }
    }
  }

  // 3. Domain classification alignment
  const classAlignment = detectClassificationAlignment(qLower, fieldSnippets.landClassification);
  if (classAlignment && !matched.includes('landClassification')) {
    matched.push('landClassification');
    fieldDescriptions.push(`Classification: "${classAlignment.value}" (${classAlignment.label})`);
  }

  // 4. Specific Khasra intent check
  if ((qLower.includes('khasra') || qLower.includes('खसरा')) && fieldSnippets.khasraNumber) {
    if (!matched.includes('khasraNumber')) {
      matched.push('khasraNumber');
      fieldDescriptions.push(`Khasra Number: "${fieldSnippets.khasraNumber}"`);
    }
  }

  let explanation;
  if (fieldDescriptions.length > 0) {
    explanation = `Contextual semantic match aligned with ${[...new Set(fieldDescriptions)].slice(0, 3).join(', ')}.`;
  } else if (relevanceScore >= 0.70) {
    explanation = `High semantic vector similarity (${(relevanceScore * 100).toFixed(1)}%) based on multilingual document context.`;
  } else if (relevanceScore >= 0.50) {
    explanation = `Moderate semantic overlap (${(relevanceScore * 100).toFixed(1)}%) with record metadata.`;
  } else {
    explanation = `Low contextual similarity (${(relevanceScore * 100).toFixed(1)}%) with query.`;
  }

  return {
    explanation,
    matchedFields: matched
  };
}

/**
 * Indexes a single document by its MongoDB ObjectId.
 * Compares normalized searchableText AND model version to avoid re-embedding unchanged documents.
 * Validates document content: rejects empty documents with a clean 400 error.
 */
async function indexDocument(documentId, options = {}) {
  const { force = false } = options;

  const doc = await Document.findById(documentId);
  if (!doc) {
    const err = new Error(`Document not found: ${documentId}`);
    err.statusCode = 404;
    throw err;
  }

  const searchableText = buildSearchableText(doc);
  if (!searchableText || !searchableText.trim()) {
    const err = new Error('Document contains no extractable or searchable text to index.');
    err.statusCode = 400;
    throw err;
  }

  const fieldSnippets = extractFieldSnippets(doc);
  const accessControl = {
    uploadedBy: doc.accessControl?.uploadedBy || null,
    isPrivate: Boolean(doc.accessControl?.isPrivate)
  };
  const metadata = {
    originalFilename: doc.fileMetadata?.originalFilename || '',
    status: doc.status || 'Uploaded'
  };

  // Check for existing index entry
  const existing = await SemanticEmbedding.findOne({ documentId: doc._id });

  // Safe migration and unchanged check
  const isUpToDateModel = existing &&
    existing.model === CURRENT_EMBEDDING_MODEL &&
    existing.dimensions === CURRENT_EMBEDDING_DIMENSIONS &&
    Array.isArray(existing.embedding) &&
    existing.embedding.length === CURRENT_EMBEDDING_DIMENSIONS;

  if (existing && !force && isUpToDateModel && existing.searchableText === searchableText) {
    // Keep accessControl, metadata, and snippets fresh without regenerating embeddings
    existing.accessControl = accessControl;
    existing.metadata = metadata;
    existing.fieldSnippets = fieldSnippets;
    existing.updatedAt = new Date();
    await existing.save();

    return {
      documentId: doc._id,
      indexed: false,
      skipped: true,
      reason: 'UNCHANGED',
      model: existing.model,
      dimensions: existing.dimensions,
      searchableTextLength: searchableText.length
    };
  }

  // Generate new embedding vector using 'passage' input convention
  const embedding = await generateEmbedding(searchableText, 'passage');

  // Upsert into isolated SemanticEmbedding collection
  const saved = await SemanticEmbedding.findOneAndUpdate(
    { documentId: doc._id },
    {
      documentId: doc._id,
      embedding,
      model: CURRENT_EMBEDDING_MODEL,
      dimensions: embedding.length,
      modelVersion: CURRENT_MODEL_VERSION,
      searchableText,
      fieldSnippets,
      accessControl,
      metadata,
      indexedAt: isUpToDateModel ? existing.indexedAt : new Date(),
      updatedAt: new Date()
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  return {
    documentId: doc._id,
    indexed: true,
    skipped: false,
    model: CURRENT_EMBEDDING_MODEL,
    dimensions: embedding.length,
    searchableTextLength: searchableText.length,
    updatedAt: saved.updatedAt
  };
}

/**
 * Safe backfill mechanism to index all existing documents in MongoDB.
 * Resumable: skips already-migrated unchanged documents, logs per-document errors,
 * and reports indexed, skipped, and failed counts.
 */
async function backfillAllDocuments(options = {}) {
  const { force = false, batchSize = 10 } = options;
  const docs = await Document.find({}, '_id fileMetadata status accessControl');

  const summary = {
    totalDocuments: docs.length,
    indexedCount: 0,
    skippedUnchangedCount: 0,
    skippedEmptyCount: 0,
    skippedCount: 0,
    failedCount: 0,
    model: CURRENT_EMBEDDING_MODEL,
    dimensions: CURRENT_EMBEDDING_DIMENSIONS,
    errors: []
  };

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    for (const doc of batch) {
      try {
        const result = await indexDocument(doc._id, { force });
        if (result.skipped) {
          summary.skippedUnchangedCount++;
          summary.skippedCount++;
        } else {
          summary.indexedCount++;
        }
      } catch (err) {
        if (err.statusCode === 400 && err.message.includes('no extractable or searchable text')) {
          summary.skippedEmptyCount = (summary.skippedEmptyCount || 0) + 1;
          summary.skippedCount++;
        } else {
          summary.failedCount++;
          summary.errors.push({
            documentId: doc._id,
            error: err.message
          });
        }
      }
    }
  }

  return summary;
}

/**
 * Executes cross-lingual semantic search query with backend-enforced RBAC,
 * authoritative live document verification, and mixed-model isolation.
 */
async function searchSemantic({ query, limit = 10, actor = {} }) {
  // Input validations
  if (!query || typeof query !== 'string' || !query.trim()) {
    const err = new Error('Search query cannot be empty.');
    err.statusCode = 400;
    throw err;
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    const err = new Error('Search query is too short. Please provide at least 2 characters.');
    err.statusCode = 400;
    throw err;
  }

  if (trimmedQuery.length > 1000) {
    const err = new Error('Search query exceeds maximum allowed length of 1000 characters.');
    err.statusCode = 400;
    throw err;
  }

  const boundedLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 10));

  // Check if index has entries for current model
  const totalEntries = await SemanticEmbedding.countDocuments({
    model: CURRENT_EMBEDDING_MODEL,
    dimensions: CURRENT_EMBEDDING_DIMENSIONS
  });

  if (totalEntries === 0) {
    return {
      query: trimmedQuery,
      totalResults: 0,
      totalIndexed: 0,
      results: [],
      message: 'Search index is currently empty. Please index land records to enable semantic search.'
    };
  }

  // Generate query embedding vector with 'query: ' prefix convention
  const queryEmbedding = await generateEmbedding(trimmedQuery, 'query');

  // Fetch all embeddings matching current model and dimensions.
  // Authoritative Document population guarantees live ownership and permissions.
  const allEmbeddings = await SemanticEmbedding.find({
    model: CURRENT_EMBEDDING_MODEL,
    dimensions: CURRENT_EMBEDDING_DIMENSIONS
  }).populate('documentId', '_id status accessControl fileMetadata landDetails ownerId assignedOfficerId assignedOfficer assignedTo');

  // Evaluate candidate results with authoritative authorization filtering
  const scoredCandidates = [];

  for (const record of allEmbeddings) {
    // 1. Defense-in-depth: Ensure underlying Document exists (guards against deleted/orphaned records)
    const actualDoc = record.documentId;
    if (!actualDoc) {
      continue;
    }

    // 2. Vector dimension integrity guard
    if (!record.embedding || record.embedding.length !== queryEmbedding.length) {
      continue;
    }

    // 3. Authoritative RBAC check on live Document state (never rely solely on stale snapshot)
    const isAllowed = checkDocumentAccess(actor, actualDoc);
    if (!isAllowed) {
      // NEVER leak private document information, scores, or explanations to unauthorized users
      continue;
    }

    const sim = cosineSimilarity(queryEmbedding, record.embedding);
    // Normalized score clamped between 0.0 and 1.0
    const relevanceScore = Math.max(0, Math.min(1, sim));

    scoredCandidates.push({
      record,
      actualDoc,
      relevanceScore
    });
  }

  // Sort descending by relevance score
  scoredCandidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Take top bounded results
  const topResults = scoredCandidates.slice(0, boundedLimit);

  // Map to clean, sanitized response (strictly never expose raw vectors, storagePath, or private paths)
  const results = topResults.map(item => {
    const { record, actualDoc, relevanceScore } = item;
    const liveLandDetails = extractFieldSnippets(actualDoc);
    const effectiveLandDetails = Object.values(liveLandDetails).some(v => Boolean(v))
      ? liveLandDetails
      : (record.fieldSnippets || {});

    const matchAnalysis = generateMatchExplanation(
      trimmedQuery,
      effectiveLandDetails,
      relevanceScore
    );

    return {
      documentId: actualDoc._id,
      filename: actualDoc.fileMetadata?.originalFilename || record.metadata?.originalFilename || 'Land_Record',
      status: actualDoc.status || record.metadata?.status || 'Uploaded',
      relevanceScore: parseFloat(relevanceScore.toFixed(4)),
      matchExplanation: matchAnalysis.explanation,
      matchedFields: matchAnalysis.matchedFields,
      landDetails: effectiveLandDetails,
      indexedAt: record.indexedAt
    };
  });

  // Result counts: totalIndexed reflects strictly documents accessible to this authenticated actor
  const totalAccessible = scoredCandidates.length;

  return {
    query: trimmedQuery,
    totalResults: results.length,
    totalIndexed: totalAccessible,
    results
  };
}

module.exports = {
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_DIMENSIONS,
  CURRENT_MODEL_VERSION,
  getEmbeddingPipeline,
  generateEmbedding,
  cosineSimilarity,
  formatE5Input,
  buildSearchableText,
  extractFieldSnippets,
  indexDocument,
  backfillAllDocuments,
  searchSemantic,
  checkDocumentAccess,
  generateMatchExplanation
};
