import React from 'react';
import { X, ShieldCheck, Clock, User, FileText, Check } from 'lucide-react';

export default function VersionDetailsModal({ version, isOpen, onClose }) {
  const [copiedHash, setCopiedHash] = React.useState(false);

  if (!isOpen || !version) return null;

  const snapshot = version.snapshot || {};
  const fileMeta = snapshot.fileMetadata || {};
  const landDetails = snapshot.landDetails || {};

  const handleCopyHash = () => {
    if (version.sha256Hash) {
      navigator.clipboard.writeText(version.sha256Hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const landFields = [
    { key: 'ownerName', label: 'Owner Name' },
    { key: 'khasraNumber', label: 'Khasra Number' },
    { key: 'surveyNumber', label: 'Survey Number' },
    { key: 'khataNumber', label: 'Khata Number' },
    { key: 'landArea', label: 'Land Area' },
    { key: 'village', label: 'Village' },
    { key: 'tehsil', label: 'Tehsil' },
    { key: 'district', label: 'District' },
    { key: 'landClassification', label: 'Land Classification' }
  ];

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
          maxWidth: '680px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
            <span
              style={{
                background: 'var(--primary-light)',
                color: 'var(--primary)',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '4px'
              }}
            >
              Version {version.versionNumber}
            </span>
            <strong style={{ fontSize: '1.05rem' }}>Snapshot Details</strong>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.5rem', border: 'none' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Metadata Banner */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.85rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.6rem',
              fontSize: '0.82rem'
            }}
          >
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Change Type</div>
              <strong style={{ color: 'var(--primary)' }}>{(version.changeType || '').replace(/_/g, ' ')}</strong>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Modified By</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <User size={13} />
                <strong>{version.changedBy?.displayName || version.changedBy?.email || 'System'}</strong>
                {version.changedByRole && <span style={{ color: 'var(--text-muted)' }}>({version.changedByRole})</span>}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Timestamp</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={13} />
                <span>{new Date(version.changedAt).toLocaleString()}</span>
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Status at Snapshot</div>
              <strong>{snapshot.status || 'N/A'}</strong>
            </div>
          </div>

          {/* Reason */}
          {version.changeReason && (
            <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px', padding: '0.7rem 0.9rem', fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 600, color: '#92400e', marginBottom: '0.2rem' }}>Modification Reason:</div>
              <div style={{ color: '#78350f' }}>{version.changeReason}</div>
            </div>
          )}

          {/* SHA-256 Hash Verification */}
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '6px',
              padding: '0.75rem 0.9rem',
              fontSize: '0.8rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <span style={{ fontWeight: 600, color: '#166534', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ShieldCheck size={15} /> Snapshot Cryptographic Hash (SHA-256)
              </span>
              <button
                onClick={handleCopyHash}
                className="btn btn-secondary"
                style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
              >
                {copiedHash ? <Check size={12} color="#16a34a" /> : <FileText size={12} />}
                {copiedHash ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code style={{ fontSize: '0.75rem', overflowWrap: 'anywhere', color: '#14532d' }}>
              {version.sha256Hash || fileMeta.sha256Hash || 'Unavailable'}
            </code>
            {fileMeta.originalFilename && (
              <div style={{ marginTop: '0.25rem', color: '#15803d', fontSize: '0.72rem' }}>
                File: {fileMeta.originalFilename} ({((fileMeta.sizeBytes || 0) / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>

          {/* Land Attributes Snapshot Table */}
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.5rem' }}>
              Land Attributes in this Version:
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, width: '40%' }}>Attribute</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600 }}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {landFields.map(({ key, label }, idx) => {
                    let displayVal = '';
                    if (key === 'landArea') {
                      const areaObj = landDetails.landArea || {};
                      displayVal = `${areaObj.value || ''} ${areaObj.unit || ''}`.trim();
                    } else {
                      displayVal = landDetails[key]?.value || landDetails[key] || '';
                    }

                    return (
                      <tr
                        key={key}
                        style={{
                          borderBottom: idx < landFields.length - 1 ? '1px solid var(--border)' : 'none',
                          background: idx % 2 === 0 ? '#ffffff' : '#fcfcfc'
                        }}
                      >
                        <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-muted)' }}>{label}</td>
                        <td style={{ padding: '0.45rem 0.75rem', fontWeight: displayVal ? 500 : 400, color: displayVal ? 'inherit' : '#94a3b8' }}>
                          {displayVal || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {snapshot.reviewRemarks && (
            <div style={{ fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>Remarks:</div>
              <div style={{ color: 'var(--text-muted)' }}>{snapshot.reviewRemarks}</div>
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
            Immutable Historical Record • DigiBhoomi Integrity Protected
          </span>
          <button onClick={onClose} className="btn btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
