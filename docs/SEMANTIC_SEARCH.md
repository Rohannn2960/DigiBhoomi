# DigiBhoomi — Semantic Search Module Documentation

> **Intelligent Land Record Digitization and Validation System (SIH Problem Statement 26018)**
> **Module:** Local Vector-Based Semantic Search
> **Release:** v1.0.0 (Independent Parallel Development)

---

## 1. Overview & Architecture

The **Semantic Search Module** enables revenue officials, inspectors, and citizens to discover and inspect digitized land records (such as Jamabandi, Khasra-Khatauni, and Satbara 7/12 extracts) using intuitive, cross-lingual natural-language queries across English, Telugu, and Hindi instead of rigid keyword lookups.

### Architectural Diagram

```
[ Frontend / React Client ]
       │
       ▼ (POST /api/search/semantic)
[ Express Search Router (server/routes/search.js) ]
       │
       ├─► [ Actor Authentication & Access Control ]
       │     - Checks 'x-user-id' & 'x-user-role'
       │     - Enforces reviewer vs citizen visibility
       │
       ├─► [ Multilingual Inference Engine (@xenova/transformers) ]
       │     - Model: Xenova/multilingual-e5-base (ONNX CPU)
       │     - Format: E5 prefixing ('query: ' for queries, 'passage: ' for documents)
       │     - Converts query into 768-dimensional unit vector
       │
       ├─► [ Isolated Vector Collection (semantic_embeddings) ]
       │     - Model version isolation & dimension filtering
       │     - Applies authorization filter before scoring
       │     - Computes cosine similarity across multilingual embeddings
       │
       └─► [ Multilingual Match Explanation & Field Attribution ]
             - Identifies direct matches, cross-lingual entity alignments, or vector similarity
             - Returns sanitized results without leaking server paths or raw vectors
```

---

## 2. Embedding Model Specification

- **Model Name:** `intfloat/multilingual-e5-base` (ONNX Quantized via `Xenova/multilingual-e5-base`)
- **Engine:** `@xenova/transformers` (Transformers.js) running on local Windows CPU via ONNX Runtime Node.
- **Dimensions:** 768-dimensional dense floating-point vector.
- **Input Conventions:**
  - Passages / Land Record Documents: prefixed with `passage: `
  - Search Queries: prefixed with `query: `
- **Supported Languages:** English, Telugu (తెలుగు), Hindi (हिन्दी), and 90+ other world languages natively.
- **Execution Cost:** 100% offline, local CPU execution. Zero external API fees, zero third-party telemetry, zero GPU requirements.

---

## 3. Cross-Lingual Semantic Search

Ordinary keyword search (e.g. MongoDB `$text`, regex, or SQL `LIKE`) fails when queries and documents are in different languages or use distinct vernacular phrasing.

The DigiBhoomi Multilingual Semantic Search engine:
1. Projects queries and document representations into a unified, language-agnostic 768-dimensional multilingual embedding space.
2. Natively aligns semantic concepts across scripts:
   - English `"Agricultural land"` aligns with Telugu `"వ్యవసాయ భూమి"` and Hindi `"कृषि भूमि"`
   - English `"Ramesh"` aligns with Telugu `"రమేష్"` and Hindi `"रमेश"`
   - English `"Hyderabad"` aligns with Telugu `"హైదరాబాద్"` and Hindi `"हैदराबाद"`
3. Computes vector distance (cosine similarity) to identify records matching the **meaning and intent** across language boundaries.

---

## 4. Indexing Workflow & Unchanged Content Detection

```
Document Uploaded / Updated in MongoDB
                 │
                 ▼
     [ Build Searchable Text ]
   Synthesizes: Owner + Survey/Khasra/Khata +
   Village/Tehsil/District + Classification + Area + OCR snippet
                 │
                 ▼
  [ Compare with Stored SearchableText ]
       │                              │
(Text Identical)               (Text Modified or New)
       │                              │
       ▼                              ▼
 [ Skip Re-embedding ]        [ Generate New Embedding ]
 Preserves index; avoids       Inference via all-MiniLM-L6-v2
 unnecessary CPU cycles        Upsert into 'semantic_embeddings'
```

### Searchable Text Canonicalization
Land records contain heterogenous, nested fields. The canonicalizer formats them into structured semantic statements:

```
Land record jamabandi_125.pdf. Land owner name: Ramesh Kumar. Survey number: 125/A. Khasra number: 450. Khata account number: 88. Location: Village Shamshabad, Tehsil Shamshabad, District Rangareddy. Land classification: Agricultural Dry Land. Recorded land parcel area: 2.5 Acre. Extracted document content: Government of Telangana Land Revenue Department Jamabandi Extract...
```

### Idempotency & Change Detection (No SHA-256 Hashing)
To respect parallel development boundaries and avoid competing hashing routines:
- Unchanged records are detected by direct string equality on normalized `searchableText`.
- Re-indexing an unchanged document updates metadata without re-running vector inference.

---

## 5. Cosine Similarity & Relevance Ranking

Cosine similarity measures the angle between normalized query vector $\vec{q}$ and document vector $\vec{d}$:

$$\text{Cosine Similarity}(\vec{q}, \vec{d}) = \frac{\vec{q} \cdot \vec{d}}{\|\vec{q}\| \|\vec{d}\|}$$

Because both $\vec{q}$ and $\vec{d}$ are $L_2$-normalized unit vectors ($\|\vec{q}\| = \|\vec{d}\| = 1$):

$$\text{Relevance Score} = \max(0, \min(1, \vec{q} \cdot \vec{d}))$$

### Scoring Rules:
- **Strictly Labeled "Relevance score":** The score is a ranking metric, **not** a confidence probability or legal validity indicator.
- Scores typically range from $0.50 - 0.85$ for strong contextual matches, $0.35 - 0.50$ for partial matches, and $< 0.30$ for unrelated records.

---

## 6. Access Control & Authorization

Security and document privacy are strictly enforced prior to result synthesis:

1. **Identity Extraction:**
   - Client identity is extracted strictly from server headers `x-user-id` and `x-user-role` (or query parameters).
   - Identifiers in request bodies are ignored.
2. **Reviewer Privileges:**
   - Roles `officer`, `admin`, and `inspector` have visibility across all indexed land records.
3. **Citizen / Public Access:**
   - Unauthenticated or non-reviewer users cannot access private documents (`accessControl.isPrivate === true` or documents owned by another user `accessControl.uploadedBy !== userId`).
4. **Leakage Prevention:**
   - Disallowed records are completely filtered out before ranking.
   - Internal server paths (`storagePath`), physical filenames, and raw embedding arrays are never exposed in API responses.

---

## 7. API Endpoints

### 1. `POST /api/search/semantic`
Executes natural-language search across indexed records.

**Request:**
```http
POST /api/search/semantic HTTP/1.1
Content-Type: application/json
x-user-role: officer

{
  "query": "Find land records belonging to Ramesh in Rangareddy",
  "limit": 10
}
```

**Response (200 OK):**
```json
{
  "query": "Find land records belonging to Ramesh in Rangareddy",
  "totalResults": 1,
  "totalIndexed": 14,
  "results": [
    {
      "documentId": "65b8e9...",
      "filename": "jamabandi_125.pdf",
      "status": "Verified",
      "relevanceScore": 0.7421,
      "matchExplanation": "Contextual semantic match aligned with Owner Name: \"Ramesh Kumar\", District: \"Rangareddy\", Agricultural classification.",
      "matchedFields": ["ownerName", "district", "landClassification"],
      "landDetails": {
        "ownerName": "Ramesh Kumar",
        "surveyNumber": "125/A",
        "khasraNumber": "450",
        "khataNumber": "88",
        "village": "Shamshabad",
        "tehsil": "Shamshabad",
        "district": "Rangareddy",
        "landClassification": "Agricultural Dry Land",
        "landArea": "2.5 Acre"
      },
      "indexedAt": "2026-11-01T12:00:00.000Z"
    }
  ]
}
```

### 2. `POST /api/search/index/:id`
Indexes a single document. Requires reviewer or admin role.

### 3. `POST /api/search/backfill`
Batch indexes all existing documents in MongoDB. Requires reviewer or admin role.

### 4. `GET /api/search/status`
Reports vector index statistics and model operational status.

---

## 8. Installation & Setup

1. **Install Dependencies:**
   ```powershell
   cd server
   npm install
   ```

2. **Verify Local Inference on Windows CPU:**
   ```powershell
   node test_xenova_cpu.js
   ```

3. **Run Semantic Search Test Suite:**
   ```powershell
   node test_semantic_search.js
   ```

4. **Backfill & Migrate Existing Records:**
   Execute via CLI migration script:
   ```powershell
   node server/migrate_embeddings.js
   ```
   Or trigger via the frontend UI under **Semantic Search -> Index Records**, or via API:
   ```powershell
   curl.exe -X POST http://localhost:5000/api/search/backfill -H "Content-Type: application/json" -H "x-user-role: officer"
   ```

---

## 9. Current Limitations & Field Filtering Distinction

1. **Semantic Similarity vs. Numeric Logic:**
   - Vector search excels at matching linguistic context across languages (e.g. finding "వ్యవసాయ భూమి" when the query asks for "agricultural land").
   - However, **numeric comparisons are NOT strict arithmetic filters**. A query for *"land larger than two acres"* will score documents mentioning 2.5 acres highly due to term proximity, but cannot guarantee strict mathematical filtering ($\text{area} > 2.0$). Numeric land parcel areas and survey boundaries must always be verified by authorized revenue officers.
2. **Context Length Ceiling:**
   - Documents with exceptionally long OCR transcripts are truncated to the first 400 characters of OCR text to prevent attention dilution. Structured fields (Owner, Parcel, Village, Classification) are always prioritized.
3. **Complex Dialectal Variations:**
   - While `multilingual-e5-base` supports standard Hindi and Telugu, historical or archaic revenue terms (e.g. specialized Urdu/Nizami revenue terms used in Telangana like Inam, Maqta, Asaldar) may benefit from supplementary dictionary alignment.
