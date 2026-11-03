import React, { useState } from 'react';
import { X, Upload, Loader, AlertCircle, FileText } from 'lucide-react';
import { replaceDocumentFile } from '../services/api';

export default function ReplaceFileModal({ isOpen, onClose, documentId, onSuccess }) {
  const [file, setFile] = useState(null);
  const [changeReason, setChangeReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a replacement file.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await replaceDocumentFile(documentId, file, { changeReason: changeReason.trim() });
      if (onSuccess) onSuccess(result);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to replace document file.');
    } finally {
      setIsSubmitting(false);
    }
  };

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
          maxWidth: '520px',
          width: '100%',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
            <Upload size={18} color="var(--primary)" />
            <strong style={{ fontSize: '1.05rem' }}>Replace Document File</strong>
          </div>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '0.3rem 0.5rem', border: 'none' }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.65rem', borderRadius: '6px', fontSize: '0.82rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Select Replacement File (PDF / Image) *
            </label>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files[0] || null)}
              className="field-input"
              required
            />
            {file && (
              <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <FileText size={13} />
                <span>Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Replacement Reason / Remarks
            </label>
            <textarea
              className="field-input"
              rows={3}
              placeholder="e.g. Scanned higher resolution copy of land deed; replaced illegible page"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>

          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: '#f8fafc', padding: '0.5rem', borderRadius: '4px' }}>
            Replacing the physical file calculates a fresh SHA-256 hash and archives the prior file in a new immutable version.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting || !file}>
              {isSubmitting ? <Loader size={15} className="spin" /> : <Upload size={15} />}
              {isSubmitting ? 'Uploading & Hashing...' : 'Upload Replacement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
