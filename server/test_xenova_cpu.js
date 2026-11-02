// Standalone verification script for @xenova/transformers on Windows CPU
// Validates actual model loading, embedding dimensions (768), inference execution, and multilingual cosine similarity.

async function verifyTransformers() {
  console.log('[Verification] Starting @xenova/transformers test on Windows Node.js CPU...');
  const startTime = Date.now();

  try {
    const { pipeline } = await import('@xenova/transformers');
    console.log('[Verification] Successfully imported @xenova/transformers.');

    console.log('[Verification] Loading pipeline for "Xenova/multilingual-e5-base"...');
    const loadStartTime = Date.now();
    const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-base', {
      quantized: true
    });
    console.log(`[Verification] Model pipeline loaded in ${Date.now() - loadStartTime}ms.`);

    const passage1 = 'passage: Agricultural land record belonging to Ramesh Kumar in Rangareddy district Shamshabad village survey 125/A area 2.5 acres';
    const queryEn = 'query: Find land records belonging to Ramesh in Rangareddy';
    const queryTe = 'query: రమేష్ కుమార్ వ్యవసాయ భూమి రంగారెడ్డి';
    const irrelevantQuery = 'query: Industrial factory unit in Ahmedabad Gujarat commercial manufacturing';

    console.log('[Verification] Running inference on sample multilingual texts...');
    const t0 = Date.now();
    const out1 = await extractor(passage1, { pooling: 'mean', normalize: true });
    const outEn = await extractor(queryEn, { pooling: 'mean', normalize: true });
    const outTe = await extractor(queryTe, { pooling: 'mean', normalize: true });
    const outIrr = await extractor(irrelevantQuery, { pooling: 'mean', normalize: true });
    const inferenceTime = Date.now() - t0;
    console.log(`[Verification] 4 inferences completed in ${inferenceTime}ms.`);

    const v1 = Array.from(out1.data);
    const vEn = Array.from(outEn.data);
    const vTe = Array.from(outTe.data);
    const vIrr = Array.from(outIrr.data);

    console.log(`[Verification] Vector dimensionality: ${v1.length} (Expected: 768)`);

    function cosineSimilarity(a, b) {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    const simEn = cosineSimilarity(v1, vEn);
    const simTe = cosineSimilarity(v1, vTe);
    const simIrr = cosineSimilarity(v1, vIrr);

    console.log(`[Verification] Similarity (EN Doc <-> EN Query "Ramesh in Rangareddy"): ${simEn.toFixed(4)}`);
    console.log(`[Verification] Similarity (EN Doc <-> TE Query "రమేష్ కుమార్ రంగారెడ్డి"): ${simTe.toFixed(4)}`);
    console.log(`[Verification] Similarity (EN Doc <-> Irrelevant "Industrial Factory"):   ${simIrr.toFixed(4)}`);

    if (v1.length !== 768) {
      throw new Error(`Expected 768 dimensions, got ${v1.length}`);
    }
    if (simEn <= simIrr) {
      throw new Error(`Expected English relevant similarity (${simEn}) > irrelevant similarity (${simIrr})`);
    }
    if (simTe <= simIrr) {
      throw new Error(`Expected Telugu cross-lingual similarity (${simTe}) > irrelevant similarity (${simIrr})`);
    }

    console.log('[Verification] SUCCESS: Xenova/multilingual-e5-base loading, CPU inference, and cross-lingual ranking verified!');
    process.exit(0);
  } catch (err) {
    console.error('[Verification] FAILED with error:', err);
    process.exit(1);
  }
}

verifyTransformers();
