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

