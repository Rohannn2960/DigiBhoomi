import React, { useState, useEffect, useCallback } from 'react';
import { X, GitCompare, Loader, AlertCircle, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { compareDocumentVersions } from '../services/api';

export default function VersionComparisonModal({
  isOpen,
  onClose,
  documentId,
  versions = [],
  initialFrom = 1,
  initialTo = 2
}) {
  const [fromVersion, setFromVersion] = useState(initialFrom);
  const [toVersion, setToVersion] = useState(initialTo);
  const [prevProps, setPrevProps] = useState({ initialFrom, initialTo });
  const [comparisonData, setComparisonData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewFilter, setViewFilter] = useState('all'); // 'all' | 'changed'

  if (prevProps.initialFrom !== initialFrom || prevProps.initialTo !== initialTo) {
    setPrevProps({ initialFrom, initialTo });
    setFromVersion(initialFrom);
    setToVersion(initialTo);
  }

  const loadComparison = useCallback(async (from, to) => {
    if (!documentId || !from || !to || from === to) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await compareDocumentVersions(documentId, from, to);
      setComparisonData(data);
    } catch (err) {
      setError(err.message || 'Failed to compare versions.');
      setComparisonData(null);
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    if (isOpen && documentId && fromVersion && toVersion && fromVersion !== toVersion) {
      loadComparison(fromVersion, toVersion);
    }
  }, [isOpen, documentId, fromVersion, toVersion, loadComparison]);

  if (!isOpen) return null;

  const handleSwap = () => {
    const prevFrom = fromVersion;
    setFromVersion(toVersion);
    setToVersion(prevFrom);
  };

  const differences = comparisonData?.differences || [];
  const allFields = comparisonData?.allFields || differences;
  const summary = comparisonData?.summary || {
    totalFields: allFields.length,
    changedFields: differences.length,
    unchangedFields: allFields.length - differences.length,
    addedCount: differences.filter(d => d.changeCategory === 'added').length,
    modifiedCount: differences.filter(d => d.changeCategory === 'modified').length,
    removedCount: differences.filter(d => d.changeCategory === 'removed').length
  };

  const fromMeta = comparisonData?.fromVersion || {};
  const toMeta = comparisonData?.toVersion || {};

  const displayedFields = viewFilter === 'changed' ? differences : allFields;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 'var(--radius)',
          maxWidth: '960px',
          width: '100%',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitCompare size={20} color="var(--primary)" />
            <div>
              <strong style={{ fontSize: '1.05rem', display: 'block' }}>
                Compare Document Versions
              </strong>
              {comparisonData?.documentReference && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Ref: {comparisonData.documentReference}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.5rem', border: 'none' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Version Pickers Bar */}
        <div
          style={{
            padding: '0.85rem 1.25rem',
            background: '#f8fafc',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                Base Version (Left):
              </span>
              <select
                className="field-input"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', width: 'auto' }}
                value={fromVersion}
                onChange={(e) => setFromVersion(parseInt(e.target.value, 10))}
              >
                {versions.map((v) => (
                  <option key={v.versionNumber} value={v.versionNumber}>
                    v{v.versionNumber} ({v.changeType?.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSwap}
              className="btn btn-secondary"
              style={{ padding: '0.4rem 0.6rem', marginTop: '14px', fontSize: '0.75rem' }}
              title="Swap versions"
              disabled={fromVersion === toVersion}
            >
              <ArrowLeftRight size={14} />
            </button>

            <div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
                Compared Version (Right):
              </span>
              <select
                className="field-input"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem', width: 'auto' }}
                value={toVersion}
                onChange={(e) => setToVersion(parseInt(e.target.value, 10))}
              >
                {versions.map((v) => (
                  <option key={v.versionNumber} value={v.versionNumber}>
                    v{v.versionNumber} ({v.changeType?.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter view toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setViewFilter('all')}
                style={{
                  padding: '0.3rem 0.65rem',
                  fontSize: '0.75rem',
                  fontWeight: viewFilter === 'all' ? 700 : 500,
                  background: viewFilter === 'all' ? 'var(--primary)' : '#ffffff',
                  color: viewFilter === 'all' ? '#ffffff' : 'var(--text-main)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                All Fields ({summary.totalFields})
              </button>
              <button
                type="button"
                onClick={() => setViewFilter('changed')}
                style={{
                  padding: '0.3rem 0.65rem',
                  fontSize: '0.75rem',
                  fontWeight: viewFilter === 'changed' ? 700 : 500,
                  background: viewFilter === 'changed' ? 'var(--primary)' : '#ffffff',
                  color: viewFilter === 'changed' ? '#ffffff' : 'var(--text-main)',
                  border: 'none',
                  borderLeft: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              >
                Changed Only ({summary.changedFields})
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
          {/* Same Version Guard */}
          {fromVersion === toVersion && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <AlertCircle size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
              <p style={{ margin: 0, fontWeight: 500 }}>Please select two different versions to compare.</p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
                Comparison requires distinct versions of the same document.
              </p>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
              <Loader size={24} className="spin" style={{ margin: '0 auto 0.5rem', color: 'var(--primary)' }} />
              <p style={{ margin: 0 }}>Computing version diffs...</p>
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                fontSize: '0.85rem'
              }}
            >
              <AlertCircle size={16} style={{ display: 'inline', marginRight: '6px' }} />
              {error}
            </div>
          )}

          {/* Comparison Result */}
          {!isLoading && !error && comparisonData && fromVersion !== toVersion && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Summary Statistics Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                  padding: '0.65rem 1rem',
                  background: '#f8fafc',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.78rem'
                }}
              >
                <span style={{ fontWeight: 600, color: '#475569' }}>Comparison Summary:</span>
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: '#f1f5f9',
                    color: '#334155',
                    fontWeight: 600
                  }}
                >
                  {summary.totalFields} Total Fields
                </span>
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: '#dcfce7',
                    border: '1px solid #86efac',
                    color: '#15803d',
                    fontWeight: 600
                  }}
                >
                  +{summary.addedCount} Added
                </span>
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: '#dbeafe',
                    border: '1px solid #93c5fd',
                    color: '#1d4ed8',
                    fontWeight: 600
                  }}
                >
                  Δ {summary.modifiedCount} Modified
                </span>
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: '#fee2e2',
                    border: '1px solid #fca5a5',
                    color: '#b91c1c',
                    fontWeight: 600
                  }}
                >
                  -{summary.removedCount} Removed
                </span>
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    color: '#64748b'
                  }}
                >
                  {summary.unchangedFields} Unchanged
                </span>
              </div>

              {/* Version Comparison Header Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Base Version Card */}
                <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#475569' }}>
                      Version {fromMeta.versionNumber} (Base)
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {fromMeta.changedAt ? new Date(fromMeta.changedAt).toLocaleString() : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.35rem', color: 'var(--text-muted)' }}>
                    Author: <strong>{fromMeta.changedBy?.displayName || fromMeta.changedBy?.email || 'User'}</strong>
                    {fromMeta.changedByRole && ` (${fromMeta.changedByRole})`}
                  </div>
                  {fromMeta.changeReason && (
                    <div style={{ fontSize: '0.72rem', marginTop: '0.25rem', color: '#64748b', fontStyle: 'italic' }}>
                      &ldquo;{fromMeta.changeReason}&rdquo;
                    </div>
                  )}
                </div>

                {/* Compared Version Card */}
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#166534' }}>
                      Version {toMeta.versionNumber} (Updated)
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {toMeta.changedAt ? new Date(toMeta.changedAt).toLocaleString() : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.35rem', color: 'var(--text-muted)' }}>
                    Author: <strong>{toMeta.changedBy?.displayName || toMeta.changedBy?.email || 'User'}</strong>
                    {toMeta.changedByRole && ` (${toMeta.changedByRole})`}
                  </div>
                  {toMeta.changeReason && (
                    <div style={{ fontSize: '0.72rem', marginTop: '0.25rem', color: '#14532d', fontStyle: 'italic' }}>
                      &ldquo;{toMeta.changeReason}&rdquo;
                    </div>
                  )}
                </div>
              </div>

              {/* No differences banner (if filtered to changed or completely identical) */}
              {displayedFields.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: '#f8fafc', borderRadius: '6px', border: '1px dashed var(--border)' }}>
                  <CheckCircle2 size={24} color="#16a34a" style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
                    {viewFilter === 'changed'
                      ? `No differences found between Version ${fromVersion} and Version ${toVersion}.`
                      : 'No comparison fields available.'}
                  </p>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    {viewFilter === 'changed'
                      ? 'Switch to "All Fields" above to view all identical record attributes.'
                      : 'All extracted metadata values match.'}
                  </p>
                </div>
              )}

              {/* Differences & Fields Table */}
              {displayedFields.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '0.88rem' }}>
                      {viewFilter === 'changed'
                        ? `Changed Fields (${displayedFields.length} variance${displayedFields.length > 1 ? 's' : ''}):`
                        : `All Record Fields (${displayedFields.length} attributes):`}
                    </strong>
                  </div>

                  <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '0.6rem 0.85rem', textAlign: 'left', fontWeight: 600, width: '22%' }}>Field / Attribute</th>
                          <th style={{ padding: '0.6rem 0.85rem', textAlign: 'left', fontWeight: 600, width: '14%' }}>Status</th>
                          <th style={{ padding: '0.6rem 0.85rem', textAlign: 'left', fontWeight: 600, width: '32%' }}>
                            v{fromVersion} Value (Previous)
                          </th>
                          <th style={{ padding: '0.6rem 0.85rem', textAlign: 'left', fontWeight: 600, width: '32%' }}>
                            v{toVersion} Value (Updated)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedFields.map((diff, idx) => {
                          const category = diff.changeCategory || 'modified';
                          const isAdded = category === 'added';
                          const isRemoved = category === 'removed';
                          const isModified = category === 'modified';
                          const isUnchanged = category === 'unchanged';

                          return (
                            <tr
                              key={diff.field || idx}
                              style={{
                                borderBottom: idx < displayedFields.length - 1 ? '1px solid var(--border)' : 'none',
                                background: isAdded ? '#f0fdf4' : isRemoved ? '#fef2f2' : isModified ? '#f8fafc' : '#ffffff'
                              }}
                            >
                              <td style={{ padding: '0.6rem 0.85rem', fontWeight: 600 }}>
                                {diff.label || diff.field}
                              </td>
                              <td style={{ padding: '0.6rem 0.85rem' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    padding: '0.15rem 0.45rem',
                                    borderRadius: '4px',
                                    background: isAdded
                                      ? '#dcfce7'
                                      : isRemoved
                                      ? '#fee2e2'
                                      : isModified
                                      ? '#dbeafe'
                                      : '#f1f5f9',
                                    color: isAdded
                                      ? '#15803d'
                                      : isRemoved
                                      ? '#b91c1c'
                                      : isModified
                                      ? '#1d4ed8'
                                      : '#475569'
                                  }}
                                >
                                  {isAdded ? '+ Added' : isRemoved ? '- Removed' : isModified ? 'Δ Modified' : 'Unchanged'}
                                </span>
                              </td>
                              <td style={{ padding: '0.6rem 0.85rem' }}>
                                <div
                                  style={{
                                    color: isRemoved ? '#b91c1c' : isUnchanged ? '#334155' : '#64748b',
                                    textDecoration: isRemoved || isModified ? 'line-through' : 'none',
                                    background: isRemoved ? '#fee2e2' : 'transparent',
                                    padding: isRemoved ? '0.15rem 0.35rem' : '0',
                                    borderRadius: '3px',
                                    display: 'inline-block',
                                    overflowWrap: 'anywhere'
                                  }}
                                >
                                  {diff.previousValue || '(empty)'}
                                </div>
                              </td>
                              <td style={{ padding: '0.6rem 0.85rem' }}>
                                <div
                                  style={{
                                    fontWeight: isUnchanged ? 400 : 600,
                                    color: isAdded ? '#15803d' : isUnchanged ? '#334155' : '#0f172a',
                                    background: isAdded ? '#dcfce7' : isModified ? '#dbeafe' : 'transparent',
                                    padding: isAdded || isModified ? '0.15rem 0.4rem' : '0',
                                    borderRadius: '3px',
                                    display: 'inline-block',
                                    overflowWrap: 'anywhere'
                                  }}
                                >
                                  {diff.updatedValue || '(empty)'}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#f8fafc',
            borderBottomLeftRadius: 'var(--radius)',
            borderBottomRightRadius: 'var(--radius)'
          }}
        >
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Comparing v{fromVersion} ➔ v{toVersion} • Verified by DigiBhoomi RBAC
          </span>
          <button onClick={onClose} className="btn btn-secondary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
