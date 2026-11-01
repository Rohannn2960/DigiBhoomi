/**
 * DigiBhoomi Semantic Search API Client
 * Dedicated service for semantic search, backfill, and vector index operations.
 * Relies on HTTP-only session cookie authentication.
 */

/**
 * Searches land records using natural-language queries.
 * @param {Object} params
 * @param {string} params.query - Natural-language query string
 * @param {number} [params.limit=10] - Maximum results to retrieve
 */
export async function searchSemanticRecords({ query, limit = 10 } = {}) {
  const res = await fetch('/api/search/semantic', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, limit })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Semantic search failed (HTTP ${res.status})`);
  }

  return data;
}

/**
 * Fetches status of the semantic search vector index.
 */
export async function fetchSearchIndexStatus() {
  const res = await fetch('/api/search/status', {
    credentials: 'same-origin'
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch search index status (HTTP ${res.status})`);
  }
  return await res.json();
}

/**
 * Triggers batch backfill indexing of existing documents.
 * Strictly restricted to Admin role.
 */
export async function triggerBackfillIndex({ force = false } = {}) {
  const res = await fetch('/api/search/backfill', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ force })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Backfill failed (HTTP ${res.status})`);
  }

  return data;
}

/**
 * Indexes a single document.
 * Strictly restricted to Admin role.
 */
export async function indexDocumentRecord(id, { force = false } = {}) {
  const res = await fetch(`/api/search/index/${id}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ force })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Indexing document failed (HTTP ${res.status})`);
  }

  return data;
}
