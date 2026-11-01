/**
 * DigiBhoomi Centralized API Client
 * Connects to Express backend via Vite proxy (/api)
 */

export async function fetchDocuments() {
  const res = await fetch('/api/documents');
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch documents (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function fetchDocumentById(id) {
  const res = await fetch(`/api/documents/${id}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Document not found (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/documents', {
    method: 'POST',
    body: formData
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
  }

  return data;
}

export function getDocumentFileUrl(id) {
  return `/api/documents/${id}/file`;
}

export async function processDocument(id, { engine = 'gemini', language = 'auto' } = {}) {
  const res = await fetch(`/api/documents/${id}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ engine, language })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Processing failed (HTTP ${res.status})`);
  }
  return data;
}

export async function fetchDocumentConflicts(id, { refresh = false } = {}) {
  const url = `/api/documents/${id}/conflicts${refresh ? '?refresh=true' : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch conflicts (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function analyzeDocumentConflicts(id) {
  const res = await fetch(`/api/documents/${id}/conflicts/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to analyze conflicts (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function updateDocument(id, updates) {
  const res = await fetch(`/api/documents/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to update document (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function fetchDocumentAuditHistory(id, { page = 1, limit = 20, sort = 'desc' } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit), sort }).toString();
  const res = await fetch(`/api/documents/${id}/audit?${query}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch audit history (HTTP ${res.status})`);
  }
  return await res.json();
}

export async function verifyDocumentIntegrity(id) {
  const res = await fetch(`/api/documents/${id}/verify-integrity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Integrity verification failed (HTTP ${res.status})`);
  }
  return data;
}
