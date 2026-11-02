async function apiRequest(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
    window.dispatchEvent(new Event('digibhoomi:unauthenticated'));
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function login(credentials) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
}

export async function register(details) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(details)
  });
}

export async function getCurrentUser() {
  try {
    const result = await apiRequest('/api/auth/me');
    return result.user;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' });
}

export async function fetchDocuments() {
  return apiRequest('/api/documents');
}

export async function fetchDocumentById(id) {
  return apiRequest(`/api/documents/${id}`);
}

export async function checkDocumentIntegrity(id) {
  return apiRequest(`/api/documents/${id}/integrity`);
}

export async function verifyDocumentIntegrity(id) {
  return apiRequest(`/api/documents/${id}/verify-integrity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);

  return apiRequest('/api/documents', {
    method: 'POST',
    body: formData
  });
}

export function getDocumentFileUrl(id) {
  return `/api/documents/${id}/file`;
}

export async function processDocument(id, { engine = 'gemini', language = 'auto' } = {}) {
  return apiRequest(`/api/documents/${id}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ engine, language })
  });
}

export async function reviewDocument(id, review) {
  return apiRequest(`/api/documents/${id}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review)
  });
}

export async function assignDocument(id, assignedOfficerId) {
  return apiRequest(`/api/documents/${id}/assignment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignedOfficerId })
  });
}

export async function fetchUsers() {
  return apiRequest('/api/users');
}

export async function updateUserRole(id, role) {
  return apiRequest(`/api/users/${id}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role })
  });
}

export async function fetchAuditEvents() {
  return apiRequest('/api/audit');
}

export async function fetchDocumentConflicts(id, { refresh = false } = {}) {
  const url = `/api/documents/${id}/conflicts${refresh ? '?refresh=true' : ''}`;
  return apiRequest(url);
}

export async function analyzeDocumentConflicts(id) {
  return apiRequest(`/api/documents/${id}/conflicts/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export async function updateDocument(id, updates) {
  return apiRequest(`/api/documents/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });
}

export async function fetchDocumentAuditHistory(id, { page = 1, limit = 20, sort = 'desc' } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit), sort }).toString();
  return apiRequest(`/api/documents/${id}/audit?${query}`);
}

export async function fetchDocumentVersions(id, { sort = 'desc' } = {}) {
  return apiRequest(`/api/documents/${id}/versions?sort=${sort}`);
}

export async function fetchDocumentVersion(id, versionNumber) {
  return apiRequest(`/api/documents/${id}/versions/${versionNumber}`);
}

export async function compareDocumentVersions(id, fromVersion, toVersion) {
  return apiRequest(`/api/documents/${id}/versions/compare?from=${fromVersion}&to=${toVersion}`);
}

export async function replaceDocumentFile(id, file, { changeReason = '' } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (changeReason) {
    formData.append('changeReason', changeReason);
  }
  return apiRequest(`/api/documents/${id}/versions/replace-file`, {
    method: 'POST',
    body: formData
  });
}

export async function fetchOwnershipHistory(id, { sort = 'desc' } = {}) {
  return apiRequest(`/api/documents/${id}/ownership-history?sort=${sort}`);
}

export async function transferOwnership(id, transferDetails) {
  return apiRequest(`/api/documents/${id}/transfer-ownership`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transferDetails)
  });
}
