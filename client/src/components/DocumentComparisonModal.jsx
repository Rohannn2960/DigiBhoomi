import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  GitCompare,
  ArrowLeftRight,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileText,
  Loader,
  AlertCircle
} from 'lucide-react';
import { compareDocuments } from '../services/api';
import StatusBadge from './StatusBadge';

// oxlint-disable-next-line react/only-export-components
export function normalizeComparisonDocId(doc) {
  const raw = typeof doc === 'object' && doc !== null ? doc._id ?? doc.id : doc;
  if (typeof raw === 'string') {
    return raw.trim();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  return '';
}

// oxlint-disable-next-line react/only-export-components
export function createComparisonRequestManager({ fetchComparison, onStateChange }) {
  let latestSeq = 0;
  let disposed = false;

  const invalidate = () => {
    latestSeq += 1;
  };

  const dispose = () => {
    disposed = true;
    latestSeq += 1;
  };

  const run = async (isOpen, docA, docB) => {
    const requestId = ++latestSeq;
    const idA = normalizeComparisonDocId(docA);
    const idB = normalizeComparisonDocId(docB);

    if (disposed || !isOpen || !idA || !idB || idA === idB) {
      if (!disposed) {
        onStateChange({ isLoading: false, comparisonData: null, error: null });
      }
      return null;
    }

    onStateChange({ isLoading: true, comparisonData: null, error: null });

    try {
      const data = await fetchComparison(idA, idB);
      if (disposed || latestSeq !== requestId) {
        return null;
      }
      onStateChange({ isLoading: false, comparisonData: data, error: null });
      return data;
    } catch (err) {
      if (disposed || latestSeq !== requestId) {
        return null;
      }
      onStateChange({
        isLoading: false,
        comparisonData: null,
        error: err?.message || 'Failed to compare the selected documents.'
      });
      return null;
    }
  };

  return { run, invalidate, dispose };
}

export default function DocumentComparisonModal({
  isOpen,
  onClose,
  initialDocA,
  initialDocB,
  availableDocuments = []
}) {
  const propDocAId = normalizeComparisonDocId(initialDocA);
  const propDocBId = normalizeComparisonDocId(initialDocB);

  const [docAId, setDocAId] = useState(() => propDocAId);
  const [docBId, setDocBId] = useState(() => propDocBId);
  const [comparisonData, setComparisonData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewFilter, setViewFilter] = useState('all_land'); // 'all_land' | 'discrepancies' | 'identical' | 'metadata'
  const [prevProps, setPrevProps] = useState({
    isOpen,
    docA: propDocAId,
    docB: propDocBId
  });

  if (
    isOpen !== prevProps.isOpen ||
    propDocAId !== prevProps.docA ||
    propDocBId !== prevProps.docB
  ) {
    const openedFresh = isOpen && !prevProps.isOpen;
    setPrevProps({ isOpen, docA: propDocAId, docB: propDocBId });
    if (openedFresh) {
      setDocAId(propDocAId);
      setDocBId(propDocBId);
      setViewFilter('all_land');
    } else {
      if (propDocAId !== prevProps.docA) setDocAId(propDocAId);
      if (propDocBId !== prevProps.docB) setDocBId(propDocBId);
    }
  }

  const requestManagerRef = useRef(null);

  const applyComparisonState = useCallback(({ isLoading: nextLoading, comparisonData: nextData, error: nextError }) => {
    setIsLoading(nextLoading);
    setComparisonData(nextData);
    setError(nextError);
  }, []);

  useEffect(() => {
    const manager = createComparisonRequestManager({
      fetchComparison: compareDocuments,
      onStateChange: applyComparisonState
    });
    requestManagerRef.current = manager;
    return () => {
      manager.dispose();
      if (requestManagerRef.current === manager) {
        requestManagerRef.current = null;
      }
    };
  }, [applyComparisonState]);

  useEffect(() => {
    const manager = requestManagerRef.current;
    if (!manager) return undefined;
    manager.run(isOpen, docAId, docBId);
    return () => {
      manager.invalidate();
    };
  }, [isOpen, docAId, docBId]);

  if (!isOpen) return null;

  const handleSwap = () => {
    const prevA = docAId;
    setDocAId(docBId);
    setDocBId(prevA);
  };

  const landAttributes = comparisonData?.landAttributes || [];
  const metadataAttributes = comparisonData?.metadataAttributes || [];
  const landDiscrepancies = comparisonData?.landDiscrepancies || comparisonData?.differences || [];
  const metadataDifferences = comparisonData?.metadataDifferences || [];

  const summary = comparisonData?.summary || {};
  const landSummary = summary.landAttributes || {
    total: landAttributes.length,
    identicalCount: landAttributes.filter((a) => a.status === 'IDENTICAL').length,
    discrepanciesCount: landDiscrepancies.length,
    differentCount: landAttributes.filter((a) => a.status === 'DIFFERENT').length,
    missingInACount: landAttributes.filter((a) => a.status === 'MISSING_IN_A').length,
    missingInBCount: landAttributes.filter((a) => a.status === 'MISSING_IN_B').length,
    incomparableCount: landAttributes.filter((a) => a.status === 'INCOMPARABLE').length
  };
  const metaSummary = summary.metadata || {
    total: metadataAttributes.length,
    identicalCount: metadataAttributes.filter((a) => a.status === 'IDENTICAL').length,
    differentCount: metadataDifferences.length
  };

  const displayedAttributes =
    viewFilter === 'discrepancies'
      ? landDiscrepancies
      : viewFilter === 'identical'
      ? landAttributes.filter((a) => a.status === 'IDENTICAL')
      : viewFilter === 'metadata'
      ? metadataAttributes
      : landAttributes;

  const docAMeta = comparisonData?.documentA || {};
  const docBMeta = comparisonData?.documentB || {};

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'IDENTICAL':
        return {
          bg: '#dcfce7',
          border: '#86efac',
          color: '#15803d',
          icon: <CheckCircle2 size={13} />
        };
      case 'DIFFERENT':
        return {
          bg: '#fef3c7',
          border: '#fde68a',
          color: '#92400e',
          icon: <AlertTriangle size={13} />
        };
      case 'MISSING_IN_A':
      case 'MISSING_IN_B':
        return {
          bg: '#ffedd5',
          border: '#fed7aa',
          color: '#c2410c',
          icon: <AlertCircle size={13} />
        };
      case 'INCOMPARABLE':
        return {
          bg: '#fef2f2',
          border: '#fecaca',
          color: '#b91c1c',
          icon: <HelpCircle size={13} />
        };
      default:
        return {
          bg: '#f8fafc',
          border: '#e2e8f0',
          color: '#64748b',
          icon: null
        };
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(3px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 'var(--radius)',
          maxWidth: '1120px',
          width: '100%',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)',
          overflow: 'hidden'
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
            alignItems: 'center',
            background: '#ffffff'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                background: 'var(--primary-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)'
              }}
            >
              <GitCompare size={20} />
            </div>
            <div>
              <strong style={{ fontSize: '1.05rem', display: 'block', color: 'var(--text-primary)' }}>
                Compare Any Two Documents
              </strong>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Side-by-side comparison of extracted land attributes, normalized extent, and isolated metadata review
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.55rem', border: 'none' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Document Selection & Inspection Bar */}
        <div
          style={{
            padding: '0.9rem 1.25rem',
            background: '#f8fafc',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
            gap: '12px',
            alignItems: 'center'
          }}
        >
          {/* Document A Selector / Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '0.75rem 0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Document A (Left)
              </span>
              {docAMeta.id && (
                <a
                  href={`/records/${docAMeta.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                  title="Inspect full original document in a new tab"
                >
                  Inspect Original <ExternalLink size={12} />
                </a>
              )}
            </div>

            {availableDocuments.length > 0 ? (
              <select
                className="field-input"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', marginTop: '2px' }}
                value={docAId}
                onChange={(e) => setDocAId(normalizeComparisonDocId(e.target.value))}
              >
                <option value="">Select Document A...</option>
                {availableDocuments.map((doc) => (
                  <option key={doc._id} value={doc._id} disabled={doc._id === docBId}>
                    {doc.fileMetadata?.originalFilename || `Document ${doc._id.slice(-6)}`} (
                    {doc.landDetails?.ownerName?.value || 'No owner'})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text-primary)', marginTop: '2px' }}>
                {docAMeta.originalFilename || docAId}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', color: 'var(--text-muted)', flexWrap: 'wrap', marginTop: '2px' }}>
              {docAMeta.createdAt && (
                <span>Uploaded: {new Date(docAMeta.createdAt).toLocaleDateString()}</span>
              )}
              {docAMeta.sizeBytes && (
                <span>• {(docAMeta.sizeBytes / 1024).toFixed(1)} KB</span>
              )}
              {docAMeta.status && (
                <span>• <StatusBadge status={docAMeta.status} /></span>
              )}
            </div>
          </div>

          {/* Swap Button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <button
              onClick={handleSwap}
              className="btn btn-secondary"
              style={{
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--shadow-sm)'
              }}
              title="Swap Document A and Document B"
              disabled={!docAId || !docBId || docAId === docBId}
            >
              <ArrowLeftRight size={16} />
            </button>
          </div>

          {/* Document B Selector / Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '0.75rem 0.9rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Document B (Right)
              </span>
              {docBMeta.id && (
                <a
                  href={`/records/${docBMeta.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                  title="Inspect full original document in a new tab"
                >
                  Inspect Original <ExternalLink size={12} />
                </a>
              )}
            </div>

            {availableDocuments.length > 0 ? (
              <select
                className="field-input"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', marginTop: '2px' }}
                value={docBId}
                onChange={(e) => setDocBId(normalizeComparisonDocId(e.target.value))}
              >
                <option value="">Select Document B...</option>
                {availableDocuments.map((doc) => (
                  <option key={doc._id} value={doc._id} disabled={doc._id === docAId}>
                    {doc.fileMetadata?.originalFilename || `Document ${doc._id.slice(-6)}`} (
                    {doc.landDetails?.ownerName?.value || 'No owner'})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text-primary)', marginTop: '2px' }}>
                {docBMeta.originalFilename || docBId}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem', color: 'var(--text-muted)', flexWrap: 'wrap', marginTop: '2px' }}>
              {docBMeta.createdAt && (
                <span>Uploaded: {new Date(docBMeta.createdAt).toLocaleDateString()}</span>
              )}
              {docBMeta.sizeBytes && (
                <span>• {(docBMeta.sizeBytes / 1024).toFixed(1)} KB</span>
              )}
              {docBMeta.status && (
                <span>• <StatusBadge status={docBMeta.status} /></span>
              )}
            </div>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
          {/* Identical Selection Warning */}
          {docAId && docBId && docAId === docBId && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
                padding: '1.25rem',
                borderRadius: '8px',
                textAlign: 'center'
              }}
            >
              <AlertTriangle size={24} style={{ margin: '0 auto 0.5rem', display: 'block' }} />
              <p style={{ margin: 0, fontWeight: 600 }}>Please select two different documents to compare.</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem' }}>
                Comparison requires two distinct documents. To compare historical versions of a single document, open its Version History tab.
              </p>
            </div>
          )}

          {/* Loading Indicator */}
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
              <Loader size={30} className="spin" style={{ margin: '0 auto 0.75rem', display: 'block', color: 'var(--primary)' }} />
              <p style={{ margin: 0, fontWeight: 500, fontSize: '0.9rem' }}>
                Analyzing semantically mapped land fields, unit conversions, and isolated metadata...
              </p>
            </div>
          )}

          {/* Error Banner */}
          {!isLoading && error && (
            <div
              style={{
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                color: '#991b1b',
                padding: '0.85rem 1rem',
                borderRadius: '6px',
                fontSize: '0.85rem'
              }}
            >
              <AlertCircle size={16} style={{ display: 'inline', marginRight: '6px' }} />
              {error}
            </div>
          )}

          {/* Comparison Output */}
          {!isLoading && !error && comparisonData && docAId && docBId && docAId !== docBId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Summary Statistics Bar & Category Filters */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  padding: '0.75rem 1rem',
                  background: '#f8fafc',
                  border: '1px solid var(--border)',
                  borderRadius: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>Land-record Overview:</span>
                  <span
                    style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#334155',
                      fontWeight: 600
                    }}
                  >
                    {landSummary.total} Land Attributes
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
                    {landSummary.identicalCount} Identical
                  </span>
                  <span
                    style={{
                      padding: '0.15rem 0.5rem',
                      borderRadius: '4px',
                      background: landSummary.discrepanciesCount > 0 ? '#fef3c7' : '#f1f5f9',
                      border: `1px solid ${landSummary.discrepanciesCount > 0 ? '#fde68a' : '#e2e8f0'}`,
                      color: landSummary.discrepanciesCount > 0 ? '#92400e' : '#475569',
                      fontWeight: 600
                    }}
                  >
                    {landSummary.discrepanciesCount} Land Discrepancies
                  </span>
                  {(landSummary.missingInACount > 0 || landSummary.missingInBCount > 0) && (
                    <span
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: '#ffedd5',
                        border: '1px solid #fed7aa',
                        color: '#c2410c',
                        fontWeight: 600
                      }}
                    >
                      {landSummary.missingInACount + landSummary.missingInBCount} Missing in Either
                    </span>
                  )}
                  {landSummary.incomparableCount > 0 && (
                    <span
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#b91c1c',
                        fontWeight: 600
                      }}
                    >
                      {landSummary.incomparableCount} Incomparable Area/Unit
                    </span>
                  )}
                </div>

                {/* Filter Pills */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setViewFilter('all_land')}
                    className={`btn ${viewFilter === 'all_land' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                  >
                    All Land Fields ({landSummary.total})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewFilter('discrepancies')}
                    className={`btn ${viewFilter === 'discrepancies' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                  >
                    Land Discrepancies ({landSummary.discrepanciesCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewFilter('identical')}
                    className={`btn ${viewFilter === 'identical' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                  >
                    Identical Land Fields ({landSummary.identicalCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewFilter('metadata')}
                    className={`btn ${viewFilter === 'metadata' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                  >
                    Record Metadata ({metaSummary.total})
                  </button>
                </div>
              </div>

              {/* Section Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {viewFilter === 'metadata'
                    ? 'Document Metadata (Isolated from Cadastral Discrepancies)'
                    : 'Cadastral & Land Record Attributes'}
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {displayedAttributes.length} attribute{displayedAttributes.length !== 1 ? 's' : ''} listed
                </span>
              </div>

              {/* Empty Filter State */}
              {displayedAttributes.length === 0 && (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2.5rem 1rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px dashed var(--border)'
                  }}
                >
                  <CheckCircle2 size={24} color="#16a34a" style={{ margin: '0 auto 0.5rem' }} />
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
                    {viewFilter === 'discrepancies'
                      ? 'No land attribute discrepancies found between these records.'
                      : 'No matching attributes found for this filter.'}
                  </p>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    Switch to &ldquo;All Land Fields&rdquo; above to view all aligned attributes.
                  </p>
                </div>
              )}

              {/* Side-by-Side Comparison Table / Grid (Responsive) */}
              {displayedAttributes.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                  <div className="comparison-table-wrapper" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
                          <th style={{ padding: '0.7rem 0.9rem', textAlign: 'left', fontWeight: 600, width: '22%' }}>
                            Attribute / Field
                          </th>
                          <th style={{ padding: '0.7rem 0.9rem', textAlign: 'left', fontWeight: 600, width: '20%' }}>
                            Comparison Status
                          </th>
                          <th style={{ padding: '0.7rem 0.9rem', textAlign: 'left', fontWeight: 600, width: '29%', borderLeft: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#0284c7' }} />
                              <span>Document A Value</span>
                            </div>
                          </th>
                          <th style={{ padding: '0.7rem 0.9rem', textAlign: 'left', fontWeight: 600, width: '29%', borderLeft: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
                              <span>Document B Value</span>
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedAttributes.map((attr, idx) => {
                          const badge = getStatusBadgeStyle(attr.status);
                          const isIdentical = attr.status === 'IDENTICAL';
                          const isDifferent = attr.status === 'DIFFERENT';
                          const isMissingA = attr.status === 'MISSING_IN_A';
                          const isMissingB = attr.status === 'MISSING_IN_B';
                          const isIncomparable = attr.status === 'INCOMPARABLE';

                          const rowBg = isIdentical
                            ? '#ffffff'
                            : isDifferent
                            ? '#fffbeb'
                            : isMissingA || isMissingB
                            ? '#fff7ed'
                            : isIncomparable
                            ? '#fef2f2'
                            : '#f8fafc';

                          return (
                            <tr
                              key={attr.key || idx}
                              style={{
                                borderBottom: idx < displayedAttributes.length - 1 ? '1px solid var(--border)' : 'none',
                                background: rowBg
                              }}
                            >
                              {/* Column 1: Field Label & Section */}
                              <td style={{ padding: '0.7rem 0.9rem', verticalAlign: 'top' }}>
                                <strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: '0.84rem' }}>
                                  {attr.label}
                                </strong>
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                  {attr.section}
                                </span>
                              </td>

                              {/* Column 2: Status Badge & Explanation */}
                              <td style={{ padding: '0.7rem 0.9rem', verticalAlign: 'top' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '0.2rem 0.55rem',
                                    borderRadius: '4px',
                                    background: badge.bg,
                                    border: `1px solid ${badge.border}`,
                                    color: badge.color,
                                    fontSize: '0.72rem',
                                    fontWeight: 600
                                  }}
                                >
                                  {badge.icon}
                                  <span>{attr.statusLabel}</span>
                                </span>
                                {attr.explanation && (
                                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '4px', lineHeight: 1.35 }}>
                                    {attr.explanation}
                                  </div>
                                )}
                              </td>

                              {/* Column 3: Document A Value */}
                              <td
                                style={{
                                  padding: '0.7rem 0.9rem',
                                  verticalAlign: 'top',
                                  borderLeft: '1px solid var(--border)',
                                  background: isMissingA ? '#ffedd5' : 'transparent'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                  <span
                                    style={{
                                      fontWeight: isDifferent || isIdentical ? 600 : 400,
                                      color: isMissingA ? '#c2410c' : 'var(--text-primary)',
                                      fontStyle: isMissingA ? 'italic' : 'normal'
                                    }}
                                  >
                                    {attr.docAValue}
                                  </span>
                                  {typeof attr.docAConfidence === 'number' && (
                                    <span
                                      className="confidence-meter"
                                      title="Field-level extraction confidence"
                                      style={{ fontSize: '0.68rem', padding: '1px 5px', whiteSpace: 'nowrap' }}
                                    >
                                      Conf: {(attr.docAConfidence * 100).toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Column 4: Document B Value */}
                              <td
                                style={{
                                  padding: '0.7rem 0.9rem',
                                  verticalAlign: 'top',
                                  borderLeft: '1px solid var(--border)',
                                  background: isMissingB ? '#ffedd5' : 'transparent'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                  <span
                                    style={{
                                      fontWeight: isDifferent || isIdentical ? 600 : 400,
                                      color: isMissingB ? '#c2410c' : 'var(--text-primary)',
                                      fontStyle: isMissingB ? 'italic' : 'normal'
                                    }}
                                  >
                                    {attr.docBValue}
                                  </span>
                                  {typeof attr.docBConfidence === 'number' && (
                                    <span
                                      className="confidence-meter"
                                      title="Field-level extraction confidence"
                                      style={{ fontSize: '0.68rem', padding: '1px 5px', whiteSpace: 'nowrap' }}
                                    >
                                      Conf: {(attr.docBConfidence * 100).toFixed(0)}%
                                    </span>
                                  )}
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

              {/* Mandatory Disclaimer Banner */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.73rem',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px'
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px', color: '#64748b' }} />
                <div>
                  <strong>Administrative Review Disclaimer:</strong>{' '}
                  {comparisonData?.disclaimer ||
                    'Discrepancies highlight variances in extracted values and record metadata. Differences do not constitute proof of fraud or dispute. Records are not assumed to refer to the same land parcel and must be verified by authorized revenue officers.'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            background: '#ffffff'
          }}
        >
          <button onClick={onClose} className="btn btn-secondary">
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
}
