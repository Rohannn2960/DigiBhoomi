import React, { useState } from 'react';
import { X, Loader, AlertCircle, ShieldAlert, Award } from 'lucide-react';
import { transferOwnership } from '../services/api';

export default function TransferOwnershipModal({ isOpen, onClose, document, onSuccess }) {
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerUserId, setNewOwnerUserId] = useState('');
  const [reason, setReason] = useState('');
  const [supportingDocumentRef, setSupportingDocumentRef] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !document) return null;

  const currentOwner = document.landDetails?.ownerName?.value || 'Unknown Current Owner';
  const landRef = `${document.landDetails?.khasraNumber?.value || document.landDetails?.surveyNumber?.value || 'Parcel'} - ${document.landDetails?.village?.value || ''}, ${document.landDetails?.district?.value || ''}`.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newOwnerName.trim()) {
      setError('New legal owner name is required.');
      return;
    }
    if (!reason.trim()) {
      setError('A formal legal reason for ownership transfer is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        newOwnerName: newOwnerName.trim(),
        newOwnerUserId: newOwnerUserId.trim() || undefined,
        reason: reason.trim(),
        supportingDocumentRef: supportingDocumentRef.trim()
      };

      const result = await transferOwnership(document._id, payload);
      if (onSuccess) onSuccess(result);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to record ownership transfer.');
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
          maxWidth: '560px',
          width: '100%',
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
            <Award size={18} color="var(--primary)" />
            <strong style={{ fontSize: '1.05rem' }}>Transfer Land Ownership</strong>
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

          {/* Current Owner Banner */}
          <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', fontSize: '0.82rem' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Current Registered Owner</div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a', marginTop: '0.15rem' }}>{currentOwner}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Land Reference: {landRef}
            </div>
          </div>

          {/* New Owner Name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              New Legal Owner Name *
            </label>
            <input
              type="text"
              className="field-input"
              placeholder="e.g. Shyam Sundar Verma"
              value={newOwnerName}
              onChange={(e) => setNewOwnerName(e.target.value)}
              required
            />
          </div>

          {/* New Owner Citizen User ID */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              New Owner Citizen Account ID (Optional)
            </label>
            <input
              type="text"
              className="field-input"
              placeholder="MongoDB User ObjectId (if registered citizen)"
              value={newOwnerUserId}
              onChange={(e) => setNewOwnerUserId(e.target.value)}
            />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              If provided, document ownership in RBAC will be reassigned to this citizen.
            </span>
          </div>

          {/* Legal Reason */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Legal Reason / Basis for Transfer *
            </label>
            <textarea
              className="field-input"
              rows={3}
              placeholder="e.g. Registered Sale Deed executed on 15/02/2026; Inheritance partition decree No. 89/2025"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          {/* Supporting Document Reference */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Supporting Document / Registry Reference
            </label>
            <input
              type="text"
              className="field-input"
              placeholder="e.g. Deed Book 1, Vol. 452, Pages 10-14, Sub-Registrar Office North"
              value={supportingDocumentRef}
              onChange={(e) => setSupportingDocumentRef(e.target.value)}
            />
          </div>

          {/* Legal Warning Notice */}
          <div
            style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '6px',
              padding: '0.65rem 0.85rem',
              fontSize: '0.75rem',
              color: '#92400e',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start'
            }}
          >
            <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Permanent Legal Record:</strong> Ownership transfers create an immutable entry in the ownership timeline and automatically record a new document version. This cannot be triggered by ordinary metadata edits.
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '0.5rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <Loader size={15} className="spin" /> : <Award size={15} />}
              {isSubmitting ? 'Recording Legal Transfer...' : 'Confirm Legal Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
