/**
 * DigiBhoomi Semantic Search API Client
 * Dedicated service for semantic search, backfill, and vector index operations.
 * Completely isolated from api.js.
 */

/**
 * Searches land records using natural-language queries.
 * @param {Object} params
 * @param {string} params.query - Natural-language query string
 * @param {number} [params.limit=10] - Maximum results to retrieve
 * @param {string|null} [params.userId] - Optional client user identity
 * @param {string|null} [params.role] - Optional client role ('officer', 'clerk', 'admin')
 */
export async function searchSemanticRecords({ query, limit = 10, userId = null, role = null } = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (userId) {
    headers['x-user-id'] = userId;
  }
  if (role) {
    headers['x-user-role'] = role;
  }

  const res = await fetch('/api/search/semantic', {
    method: 'POST',
    headers,
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
  const res = await fetch('/api/search/status');
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch search index status (HTTP ${res.status})`);
  }
  return await res.json();
}

/**
 * Triggers batch backfill indexing of existing documents.
 * Restricted to reviewer/admin roles.
 */
export async function triggerBackfillIndex({ force = false, role = 'officer', userId = null } = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (role) headers['x-user-role'] = role;
  if (userId) headers['x-user-id'] = userId;

  const res = await fetch('/api/search/backfill', {
    method: 'POST',
    headers,
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
 * Restricted to reviewer/admin roles.
 */
export async function indexDocumentRecord(id, { force = false, role = 'officer', userId = null } = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (role) headers['x-user-role'] = role;
  if (userId) headers['x-user-id'] = userId;

  const res = await fetch(`/api/search/index/${id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ force })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Indexing document failed (HTTP ${res.status})`);
  }

  return data;
}
