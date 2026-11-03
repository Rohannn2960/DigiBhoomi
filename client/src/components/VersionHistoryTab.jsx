import React, { useState, useEffect, useCallback } from 'react';
import {
  History,
  GitCompare,
  Upload,
  RefreshCw,
  Loader,
  AlertCircle,
  Clock,
  User,
  ShieldCheck,
  Eye,
  Copy,
  Check
} from 'lucide-react';
import { fetchDocumentVersions } from '../services/api';
import VersionDetailsModal from './VersionDetailsModal';
import VersionComparisonModal from './VersionComparisonModal';
import ReplaceFileModal from './ReplaceFileModal';

export default function VersionHistoryTab({ documentId, currentVersion = 1, canManage = false, onVersionUpdated }) {
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortOrder, setSortOrder] = useState('desc');

  // Modals
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [compareFrom, setCompareFrom] = useState(1);
  const [compareTo, setCompareTo] = useState(currentVersion || 2);
  const [isReplaceFileOpen, setIsReplaceFileOpen] = useState(false);
  const [copiedHashId, setCopiedHashId] = useState(null);

  const loadVersions = useCallback(async () => {
    if (!documentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDocumentVersions(documentId, { sort: sortOrder });
      setVersions(data.versions || []);
    } catch (err) {
      setError(err.message || 'Failed to load version history.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, sortOrder]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const handleCopyHash = (versionId, hash) => {
    navigator.clipboard.writeText(hash);
    setCopiedHashId(versionId);
    setTimeout(() => setCopiedHashId(null), 2000);
  };

  const handleOpenCompare = (vNum) => {
    // Set base as the clicked version and target as the latest
    setCompareFrom(vNum);
    setCompareTo(currentVersion > vNum ? currentVersion : (versions[0]?.versionNumber || 1));
    setIsCompareOpen(true);
  };

  const getChangeTypeColor = (type) => {
    switch (type) {
      case 'INITIAL_UPLOAD':
        return { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd' };
      case 'CORRECTION':
        return { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' };
      case 'REVIEW_DECISION':
        return { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' };
      case 'OWNERSHIP_TRANSFER':
        return { bg: '#fef3c7', text: '#92400e', border: '#fde68a' };
      case 'DOCUMENT_REPLACEMENT':
        return { bg: '#fae8ff', text: '#86198f', border: '#f5d0fe' };
      case 'STATUS_CHANGE':
        return { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1' };
      default:
        return { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Action and Filter Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          paddingBottom: '0.5rem',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <History size={18} color="var(--primary)" />
          <strong style={{ fontSize: '0.95rem' }}>Version Timeline</strong>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              padding: '0.15rem 0.5rem',
              borderRadius: '999px'
            }}
          >
            {versions.length} Version{versions.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {canManage && (
            <button
              onClick={() => setIsReplaceFileOpen(true)}
              className="btn btn-secondary"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              title="Replace physical document file"
            >
              <Upload size={13} /> Replace File
            </button>
          )}

          {versions.length > 1 && (
            <button
              onClick={() => {
                setCompareFrom(versions[versions.length - 1]?.versionNumber || 1);
                setCompareTo(versions[0]?.versionNumber || currentVersion);
                setIsCompareOpen(true);
              }}
              className="btn btn-secondary"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              title="Compare two versions"
            >
              <GitCompare size={13} /> Compare Versions
            </button>
          )}

          <select
            className="field-input"
            style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="desc">Newest First</option>
            <option value="asc">Oldest First</option>
          </select>

          <button
            onClick={loadVersions}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            disabled={isLoading}
            title="Refresh versions"
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <Loader size={20} className="spin" style={{ margin: '0 auto 0.5rem', display: 'block', color: 'var(--primary)' }} />
          Loading version history...
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            fontSize: '0.82rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>Failed to load versions: {error}</span>
          </div>
          <button onClick={loadVersions} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && versions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <History size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No historical versions found for this document.</p>
        </div>
      )}

      {/* Versions List / Timeline */}
      {!isLoading && !error && versions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {versions.map((ver, _idx) => {
            const isCurrent = ver.versionNumber === currentVersion;
            const styleBadge = getChangeTypeColor(ver.changeType);

            return (
              <div
                key={ver._id || ver.versionNumber}
                style={{
                  border: isCurrent ? '2px solid var(--primary)' : '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '0.85rem',
                  background: isCurrent ? '#fafffd' : '#ffffff',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                {/* Header row: Version Number, Current Pill, Change Type, Author, Timestamp */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: '0.78rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: 'var(--text-main)',
                        color: '#ffffff'
                      }}
                    >
                      v{ver.versionNumber}
                    </span>

                    {isCurrent && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          background: '#dcfce7',
                          color: '#15803d',
                          border: '1px solid #86efac',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '4px'
                        }}
                      >
                        CURRENT
                      </span>
                    )}

                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: styleBadge.bg,
                        color: styleBadge.text,
                        border: `1px solid ${styleBadge.border}`
                      }}
                    >
                      {(ver.changeType || '').replace(/_/g, ' ')}
                    </span>

                    <span
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--text-muted)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px'
                      }}
                    >
                      <User size={12} />
                      <strong>{ver.changedBy?.displayName || ver.changedBy?.email || 'User'}</strong>
                      {ver.changedByRole && ` (${ver.changedByRole})`}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    <span>{new Date(ver.changedAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Reason description */}
                {ver.changeReason && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', margin: '0.35rem 0' }}>
                    {ver.changeReason}
                  </div>
                )}

                {/* SHA-256 Hash Row */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '4px',
                    padding: '0.3rem 0.5rem',
                    fontSize: '0.72rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    margin: '0.4rem 0'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                    <ShieldCheck size={13} color="var(--primary)" />
                    <span style={{ color: 'var(--text-muted)' }}>SHA-256:</span>
                    <code style={{ fontSize: '0.7rem', color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {ver.sha256Hash || ver.snapshot?.fileMetadata?.sha256Hash || 'Unavailable'}
                    </code>
                  </div>
                  <button
                    onClick={() => handleCopyHash(ver._id || ver.versionNumber, ver.sha256Hash || ver.snapshot?.fileMetadata?.sha256Hash)}
                    className="btn btn-secondary"
                    style={{ padding: '0.1rem 0.35rem', fontSize: '0.68rem', border: 'none', background: 'transparent' }}
                    title="Copy SHA-256"
                  >
                    {copiedHashId === (ver._id || ver.versionNumber) ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                  </button>
                </div>

                {/* Diffs Summary */}
                {ver.diffs && ver.diffs.length > 0 && (
                  <div style={{ margin: '0.35rem 0', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Changed attributes: </span>
                    <span style={{ color: '#0f766e', fontWeight: 500 }}>
                      {ver.diffs.map((d) => d.label || d.field).join(', ')}
                    </span>
                  </div>
                )}

                {/* Card Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.4rem' }}>
                  <button
                    onClick={() => setSelectedSnapshot(ver)}
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Eye size={12} /> View Snapshot
                  </button>

                  {versions.length > 1 && !isCurrent && (
                    <button
                      onClick={() => handleOpenCompare(ver.versionNumber)}
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      <GitCompare size={12} /> Compare with Current
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Snapshot Modal */}
      {selectedSnapshot && (
        <VersionDetailsModal
          version={selectedSnapshot}
          isOpen={Boolean(selectedSnapshot)}
          onClose={() => setSelectedSnapshot(null)}
        />
      )}

      {/* Comparison Modal */}
      {isCompareOpen && (
        <VersionComparisonModal
          isOpen={isCompareOpen}
          onClose={() => setIsCompareOpen(false)}
          documentId={documentId}
          versions={versions}
          initialFrom={compareFrom}
          initialTo={compareTo}
        />
      )}

      {/* Replace File Modal */}
      {isReplaceFileOpen && (
        <ReplaceFileModal
          isOpen={isReplaceFileOpen}
          onClose={() => setIsReplaceFileOpen(false)}
          documentId={documentId}
          onSuccess={() => {
            loadVersions();
            if (onVersionUpdated) onVersionUpdated();
          }}
        />
      )}
    </div>
  );
}
