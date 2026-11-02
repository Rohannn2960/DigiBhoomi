import React, { useState, useEffect, useCallback } from 'react';
import {
  Award,
  ArrowRight,
  Clock,
  User,
  FileText,
  MapPin,
  RefreshCw,
  Loader,
  AlertCircle,
  PlusCircle,
  ShieldCheck
} from 'lucide-react';
import { fetchOwnershipHistory } from '../services/api';
import TransferOwnershipModal from './TransferOwnershipModal';

export default function OwnershipHistoryTab({ document, canTransfer = false, onOwnershipTransferred }) {
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortOrder, setSortOrder] = useState('desc');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  const documentId = document?._id;
  const currentOwnerName = document?.landDetails?.ownerName?.value || 'Unknown Registered Owner';

  const loadHistory = useCallback(async () => {
    if (!documentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchOwnershipHistory(documentId, { sort: sortOrder });
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || 'Failed to load ownership history.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, sortOrder]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header bar */}
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
          <Award size={18} color="var(--primary)" />
          <strong style={{ fontSize: '0.95rem' }}>Ownership Registry & Title Transfers</strong>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              background: '#fef3c7',
              color: '#92400e',
              padding: '0.15rem 0.5rem',
              borderRadius: '999px',
              border: '1px solid #fde68a'
            }}
          >
            {history.length} Transfer{history.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {canTransfer && (
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="btn btn-primary"
              style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <PlusCircle size={13} /> Transfer Ownership
            </button>
          )}

          <select
            className="field-input"
            style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="desc">Newest Transfers First</option>
            <option value="asc">Oldest Transfers First</option>
          </select>

          <button
            onClick={loadHistory}
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            disabled={isLoading}
            title="Refresh ownership history"
          >
            <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Current Legal Owner Banner */}
      <div
        style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '6px',
          padding: '0.8rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div>
          <span style={{ fontSize: '0.72rem', color: '#166534', textTransform: 'uppercase', fontWeight: 600 }}>
            Current Legal Title Holder
          </span>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#14532d', marginTop: '0.1rem' }}>
            {currentOwnerName}
          </div>
        </div>
        <span
          style={{
            fontSize: '0.72rem',
            background: '#dcfce7',
            color: '#15803d',
            padding: '0.2rem 0.6rem',
            borderRadius: '999px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <ShieldCheck size={14} /> Title Active
        </span>
      </div>

      {/* Loading */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <Loader size={20} className="spin" style={{ margin: '0 auto 0.5rem', display: 'block', color: 'var(--primary)' }} />
          Loading ownership history...
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
            fontSize: '0.82rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>Failed to load ownership history: {error}</span>
          </div>
          <button onClick={loadHistory} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && history.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '2.5rem 1rem',
            background: '#f8fafc',
            border: '1px dashed var(--border)',
            borderRadius: '6px',
            color: 'var(--text-muted)',
            fontSize: '0.85rem'
          }}
        >
          <Award size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
          <p style={{ margin: 0, fontWeight: 600 }}>No ownership transfers recorded for this land parcel.</p>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
            The original owner recorded on title is <strong>{currentOwnerName}</strong>.
          </p>
        </div>
      )}

      {/* Ownership Transfer Cards */}
      {!isLoading && !error && history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {history.map((entry, idx) => {
            const officerInfo = entry.officerResponsible || {};
            const prevOwner = entry.previousOwner || {};
            const newOwner = entry.newOwner || {};
            const landRef = entry.landRecordReference || {};

            return (
              <div
                key={entry._id || idx}
                style={{
                  border: '1px solid var(--border)',
                  borderLeft: '4px solid #d97706',
                  borderRadius: '6px',
                  padding: '0.9rem',
                  background: '#ffffff',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                {/* Transfer Flow Banner */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px',
                    paddingBottom: '0.6rem',
                    borderBottom: '1px solid #f1f5f9'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '0.25rem 0.6rem', borderRadius: '4px', fontSize: '0.82rem' }}>
                      <span style={{ fontSize: '0.68rem', color: '#991b1b', display: 'block', textTransform: 'uppercase' }}>Previous Owner</span>
                      <strong style={{ color: '#991b1b' }}>{prevOwner.name || 'Unknown'}</strong>
                    </div>

                    <ArrowRight size={18} color="#d97706" />

                    <div style={{ background: '#dcfce7', border: '1px solid #86efac', padding: '0.25rem 0.6rem', borderRadius: '4px', fontSize: '0.82rem' }}>
                      <span style={{ fontSize: '0.68rem', color: '#166534', display: 'block', textTransform: 'uppercase' }}>New Legal Owner</span>
                      <strong style={{ color: '#166534' }}>{newOwner.name || 'Unknown'}</strong>
                    </div>

                    {entry.versionNumber && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          background: 'var(--primary-light)',
                          color: 'var(--primary)',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}
                      >
                        Recorded in v{entry.versionNumber}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <Clock size={12} />
                    <span>{new Date(entry.transferDate).toLocaleString()}</span>
                  </div>
                </div>

                {/* Transfer Reason */}
                <div style={{ margin: '0.6rem 0 0.4rem', fontSize: '0.82rem' }}>
                  <span style={{ fontWeight: 600, color: '#92400e' }}>Reason: </span>
                  <span style={{ color: '#451a03' }}>{entry.reason}</span>
                </div>

                {/* Supporting Document Reference */}
                {entry.supportingDocumentRef && (
                  <div style={{ margin: '0.25rem 0', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px', color: '#0369a1' }}>
                    <FileText size={13} />
                    <span>Supporting Reference: <strong>{entry.supportingDocumentRef}</strong></span>
                  </div>
                )}

                {/* Land Record Identifiers & Officer Info */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginTop: '0.5rem',
                    paddingTop: '0.4rem',
                    borderTop: '1px solid #f8fafc',
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={12} />
                    <span>
                      Parcel: {landRef.khasraNumber || landRef.surveyNumber || 'N/A'}
                      {landRef.khataNumber ? ` • Khata ${landRef.khataNumber}` : ''}
                      {landRef.village ? ` • ${landRef.village}` : ''}
                      {landRef.district ? `, ${landRef.district}` : ''}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <User size={12} />
                    <span>
                      Authorized by: <strong>{officerInfo.displayName || 'Authorized Officer'}</strong>
                      {officerInfo.role ? ` (${officerInfo.role})` : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {isTransferModalOpen && (
        <TransferOwnershipModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          document={document}
          onSuccess={(result) => {
            loadHistory();
            if (onOwnershipTransferred) onOwnershipTransferred(result);
          }}
        />
      )}
    </div>
  );
}
