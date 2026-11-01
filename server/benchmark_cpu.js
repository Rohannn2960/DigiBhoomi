const { performance } = require('perf_hooks');
const {
  getEmbeddingPipeline,
  generateEmbedding,
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_DIMENSIONS
} = require('./services/semanticSearchService');

async function benchmark() {
  console.log('--- CPU Performance Benchmark for DigiBhoomi Semantic Search ---');
  console.log(`Model: ${CURRENT_EMBEDDING_MODEL}`);
  console.log(`Dimensions: ${CURRENT_EMBEDDING_DIMENSIONS}`);

  // 1. Model Loading Time
  const t0 = performance.now();
  await getEmbeddingPipeline();
  const loadTime = (performance.now() - t0).toFixed(2);
  console.log(`Model Load Time: ${loadTime} ms`);

  // 2. Query Inference Latency (English, Telugu, Hindi)
  const queries = [
    { lang: 'English', text: 'Find land records belonging to Ramesh in Rangareddy' },
    { lang: 'Telugu',  text: 'వ్యవసాయ భూమి రమేష్ కుమార్ శంషాబాద్' },
    { lang: 'Hindi',   text: 'कृषि भूमि शामशाबाद खसरा संख्या 450' }
  ];

  const latencies = [];
  for (const q of queries) {
    const start = performance.now();
    const vec = await generateEmbedding(q.text, 'query');
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
    console.log(`Inference Latency (${q.lang} Query): ${elapsed.toFixed(2)} ms (Vector Length: ${vec.length})`);
  }

  // 3. Document Passage Inference Latency
  const passageText = 'Document: jamabandi.pdf. Land owner name: Ramesh Kumar. Survey number: 125/A. Khasra number: 450. Khata account number: 88. Location: Village Shamshabad, Tehsil Shamshabad, District Rangareddy. Land classification: Agricultural Dry Land. Recorded land parcel area: 2.5 Acre. Extracted document content: Telangana Land Revenue Department Jamabandi Extract';
  const pStart = performance.now();
  const pVec = await generateEmbedding(passageText, 'passage');
  const pElapsed = (performance.now() - pStart).toFixed(2);
  console.log(`Inference Latency (Full Document Passage): ${pElapsed} ms (Vector Length: ${pVec.length})`);

  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  console.log(`Average Query Latency: ${avgLatency} ms`);
}

benchmark().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
