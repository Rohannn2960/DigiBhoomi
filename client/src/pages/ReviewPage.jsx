import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  assignDocument,
  fetchDocumentById,
  fetchUsers,
  getDocumentFileUrl,
  processDocument,
  reviewDocument,
  verifyDocumentIntegrity,
  analyzeDocumentConflicts,
  fetchDocumentAuditHistory
} from '../services/api';
import { useAuth } from '../context/auth-context';
import DocumentViewer from '../components/DocumentViewer';
import StatusBadge from '../components/StatusBadge';
import VersionHistoryTab from '../components/VersionHistoryTab';
import OwnershipHistoryTab from '../components/OwnershipHistoryTab';
import {
  ArrowLeft,
  Save,
  CheckCircle,
  AlertTriangle,
  Loader,
  AlertCircle,
  Sparkles,
  Cpu,
  Copy,
  Check,
  FileText,
  ChevronDown,
  ChevronUp,
  GitCompare,
  RefreshCw,
  History,
  User,
  Clock,
  ShieldCheck,
  Award
} from 'lucide-react';

const defaultField = {
  value: '',
  rawText: null,
  rawOcrText: null,
  confidence: null,
  confidenceSource: null,
  isFlagged: false,
  reviewStatus: 'Unreviewed'
};

const formatConfidenceValue = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Not available';
  }

  const normalized = value > 1 ? value / 100 : value;
  return `${normalized.toFixed(2)} / 1.00`;
};

const getOverallConfidence = (record) => {
  const value = record?.ocrResult?.meanConfidence;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const normalizeLandDetails = (details = {}) => ({
  ownerName: { ...defaultField, ...(details.ownerName || {}) },
  khasraNumber: { ...defaultField, ...(details.khasraNumber || {}) },
  khataNumber: { ...defaultField, ...(details.khataNumber || {}) },
  landArea: { ...defaultField, unit: 'Acre', ...(details.landArea || {}) },
  district: { ...defaultField, ...(details.district || {}) },
  tehsil: { ...defaultField, ...(details.tehsil || {}) },
  village: { ...defaultField, ...(details.village || {}) },
  landClassification: { ...defaultField, ...(details.landClassification || {}) }
});

export default function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [record, setRecord] = useState(null);
  const [formData, setFormData] = useState(normalizeLandDetails());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveMessage, setSaveMessage] = useState(null);
  const [integrityCheck, setIntegrityCheck] = useState(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewError, setReviewError] = useState(null);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [officers, setOfficers] = useState([]);
  const [isAssigning, setIsAssigning] = useState(false);

  const recordIsAwaitingReview = record?.status === 'Needs review';
  const canReview = ['Officer', 'Admin'].includes(user?.role);
  const canEditReview = canReview && recordIsAwaitingReview;

  // Phase 3 OCR State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState(null);
  const [selectedEngine, setSelectedEngine] = useState('gemini');
  const [selectedLanguage, setSelectedLanguage] = useState('auto');
  const [showRawOcr, setShowRawOcr] = useState(true);
  const [copiedText, setCopiedText] = useState(false);

  // Phase 4 Duplicate & Conflict Detection State
  const [isAnalyzingConflicts, setIsAnalyzingConflicts] = useState(false);
  const [conflictActionMessage, setConflictActionMessage] = useState(null);

  // Tab State
  const [activeTab, setActiveTab] = useState('fields'); // 'fields', 'versions', 'ownership', 'conflicts', 'audit'

  // Phase 4 Audit History State
  const [auditEvents, setAuditEvents] = useState([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [auditSort, setAuditSort] = useState('asc');

  // SHA-256 Integrity Verification State
  const [isVerifyingIntegrity, setIsVerifyingIntegrity] = useState(false);
  const [integrityResult, setIntegrityResult] = useState(null);
  const [integrityError, setIntegrityError] = useState(null);

  const handleVerifyIntegrity = async () => {
    if (!record || !record._id) return;
    setIsVerifyingIntegrity(true);
    setIntegrityError(null);
    try {
      const res = await verifyDocumentIntegrity(record._id);
      setIntegrityResult(res);
      setIntegrityCheck(res);
      fetchAuditTrail();
    } catch (err) {
      setIntegrityError(err.message || 'Integrity check failed.');
      setIntegrityCheck({
        status: 'HASH_UNAVAILABLE',
        calculatedHash: null,
        verifiedAt: new Date().toISOString()
      });
      fetchAuditTrail();
    } finally {
      setIsVerifyingIntegrity(false);
    }
  };

  const fetchAuditTrail = async () => {
    if (!id) return;
    setIsLoadingAudit(true);
    setAuditError(null);
    try {
      const data = await fetchDocumentAuditHistory(id, { page: 1, limit: 50, sort: auditSort });
      setAuditEvents(data.events || []);
    } catch (err) {
      setAuditError(err.message || 'Failed to load audit history.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchAuditTrail();
    }
  }, [id, auditSort]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    // Fetch from MongoDB backend
    fetchDocumentById(id)
      .then(doc => {
        if (!isMounted) return;
        if (doc.fileMetadata && !doc.fileMetadata.previewUrl) {
          doc.fileMetadata.previewUrl = getDocumentFileUrl(doc._id);
        }
        setRecord(doc);
        setFormData(normalizeLandDetails(doc.landDetails));
        setIntegrityCheck(doc.integrityVerification || null);
        setReviewRemarks(doc.reviewRemarks || '');
        setIsLoading(false);
      })
      .catch(apiErr => {
        if (!isMounted) return;
        setError(apiErr.message || 'Document record not found.');
        setIsLoading(false);
      });

    return () => { isMounted = false; };
  }, [id]);

  const handleReloadDocument = async () => {
    try {
      const doc = await fetchDocumentById(id);
      if (doc.fileMetadata && !doc.fileMetadata.previewUrl) {
        doc.fileMetadata.previewUrl = getDocumentFileUrl(doc._id);
      }
      setRecord(doc);
      setFormData(normalizeLandDetails(doc.landDetails));
      setIntegrityCheck(doc.integrityVerification || null);
    } catch (e) {
      console.error('Failed to reload document:', e);
    }
  };

  useEffect(() => {
    if (user?.role !== 'Admin') return undefined;
    let active = true;
    fetchUsers()
      .then(users => { if (active) setOfficers(users.filter(candidate => candidate.role === 'Officer')); })
      .catch(requestError => { if (active) setReviewError(requestError.message); });
    return () => { active = false; };
  }, [user?.role]);

  const handleFieldChange = (fieldKey, subKey, value) => {
    if (!canEditReview) return;
    setFormData(prev => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        [subKey]: value,
        reviewStatus: 'Corrected'
      }
    }));
  };

  const handleReviewAction = async (action) => {
    if (!record?._id || !canEditReview) return;
    setIsSavingReview(true);
    setReviewError(null);
    try {
      const updatedDoc = await reviewDocument(record._id, {
        action,
        remarks: reviewRemarks,
        landDetails: formData
      });
      setRecord(updatedDoc);
      setFormData(normalizeLandDetails(updatedDoc.landDetails));
      setReviewRemarks(updatedDoc.reviewRemarks || '');
      setSaveMessage(action === 'save'
        ? 'Review changes saved.'
        : action === 'approve' ? 'Document approved.' : 'Document rejected.');
      setTimeout(() => setSaveMessage(null), 3500);
      if (typeof fetchAuditTrail === 'function') fetchAuditTrail();
    } catch (requestError) {
      setReviewError(requestError.message || 'Unable to save review.');
    } finally {
      setIsSavingReview(false);
    }
  };

  const handleSave = () => handleReviewAction('save');
  const handleVerify = () => handleReviewAction('approve');
  const handleReject = () => handleReviewAction('reject');

  const handleAssignOfficer = async (event) => {
    setIsAssigning(true);
    setReviewError(null);
    try {
      const result = await assignDocument(record._id, event.target.value || null);
      setRecord(current => ({ ...current, assignedOfficerId: result.assignedOfficerId }));
      if (typeof fetchAuditTrail === 'function') fetchAuditTrail();
    } catch (requestError) {
      setReviewError(requestError.message || 'Unable to update assignment.');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRunOcr = async () => {
    if (!record || !record._id || !canReview) return;
    setIsProcessing(true);
    setProcessingError(null);
    setSaveMessage(null);

    try {
      const updatedDoc = await processDocument(record._id, {
        engine: selectedEngine,
        language: selectedLanguage
      });

      if (updatedDoc.fileMetadata && !updatedDoc.fileMetadata.previewUrl) {
        updatedDoc.fileMetadata.previewUrl = getDocumentFileUrl(updatedDoc._id);
      }

      setRecord(updatedDoc);
      setFormData(normalizeLandDetails(updatedDoc.landDetails));
      setSaveMessage(`Extraction completed using ${updatedDoc.ocrResult?.engine || selectedEngine}!`);
      setTimeout(() => setSaveMessage(null), 4000);
      fetchAuditTrail();
    } catch (err) {
      setProcessingError(err.message || 'Failed to process document.');
      fetchAuditTrail();
    } finally {
      setIsProcessing(false);
    }
  };


  const handleCopyRawText = () => {
    if (record?.ocrResult?.fullText) {
      navigator.clipboard.writeText(record.ocrResult.fullText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    }
  };

  const handleRefreshConflicts = async () => {
    if (!record || !record._id) return;
    setIsAnalyzingConflicts(true);
    setConflictActionMessage(null);
    try {
      const data = await analyzeDocumentConflicts(record._id);
      setRecord(prev => ({
        ...prev,
        duplicateDetection: data.duplicateDetection,
        conflictDetection: data.conflictDetection
      }));
      setConflictActionMessage('Cross-record analysis updated.');
      setTimeout(() => setConflictActionMessage(null), 3000);
      fetchAuditTrail();
    } catch (err) {
      setConflictActionMessage(`Analysis check failed: ${err.message}`);
      setTimeout(() => setConflictActionMessage(null), 4000);
    } finally {
      setIsAnalyzingConflicts(false);
    }
  };

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
        <Loader size={36} className="spin" style={{ margin: '0 auto 1rem', display: 'block', color: 'var(--primary)' }} />
        <p>Loading document metadata and preview...</p>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div style={{ maxWidth: '600px', margin: '3rem auto' }}>
        <button onClick={() => navigate('/records')} className="btn btn-secondary" style={{ marginBottom: '1rem' }}>
          <ArrowLeft size={16} /> Back to Records
        </button>
        <div className="card" style={{ borderLeft: '4px solid #dc2626' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', marginBottom: '0.5rem' }}>
            <AlertCircle size={20} />
            <strong style={{ fontSize: '1.1rem' }}>Record Not Found</strong>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
            {error || 'Unable to load the requested document record.'}
          </p>
          <button onClick={() => navigate('/records')} className="btn btn-primary">
            Return to Repository
          </button>
        </div>
      </div>
    );
  }

  const overallConfidence = getOverallConfidence(record);
  const fieldConfidenceEntries = [
    { key: 'ownerName', label: 'Owner Name' },
    { key: 'khasraNumber', label: 'Khasra / Survey Number' },
    { key: 'khataNumber', label: 'Khata / Khewat Number' },
    { key: 'landArea', label: 'Land Area' },
    { key: 'district', label: 'District' },
    { key: 'tehsil', label: 'Tehsil' },
    { key: 'village', label: 'Village' },
    { key: 'landClassification', label: 'Land Classification' }
  ]
    .map(({ key, label }) => {
      const field = formData[key];
      if (!field || typeof field !== 'object') return null;
      return {
        key,
        label,
        confidence: field.confidence,
        source: field.confidenceSource || 'Unspecified'
      };
    })
    .filter(item => item && typeof item.confidence === 'number' && Number.isFinite(item.confidence));

  const validation = record?.extractionValidation || null;
  const duplicateDetection = record?.duplicateDetection || { hasPotentialDuplicates: false, duplicateCount: 0, matches: [] };
  const conflictDetection = record?.conflictDetection || { hasConflicts: false, conflictCount: 0, conflicts: [] };

  const integrityStatus = integrityCheck?.status ||
    (record.fileMetadata?.sha256Hash ? 'NOT_VERIFIED' : 'HASH_UNAVAILABLE');
  const integrityColor = integrityStatus === 'INTEGRITY_VERIFIED'
    ? '#15803d'
    : integrityStatus === 'INTEGRITY_FAILED'
      ? '#b91c1c'
      : '#64748b';
  const integrityLabel = integrityStatus === 'INTEGRITY_VERIFIED'
    ? 'Integrity Verified'
    : integrityStatus === 'INTEGRITY_FAILED'
      ? 'Integrity Failed'
      : integrityStatus === 'NOT_VERIFIED'
        ? 'Not verified'
        : 'Hash Unavailable';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Top Action Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/records')}
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            <ArrowLeft size={16} /> All Records
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
                Record #{record._id}
              </h2>
              <StatusBadge status={record.status} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '12px', marginTop: '2px', flexWrap: 'wrap' }}>
              <span>File: <strong>{record.fileMetadata?.originalFilename}</strong></span>
              <span>Size: {((record.fileMetadata?.sizeBytes || 0) / 1024).toFixed(1)} KB</span>
              <span title={record.fileMetadata?.sha256Hash} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                SHA-256: <code>{record.fileMetadata?.sha256Hash?.substring(0, 16)}...</code>
                <button
                  type="button"
                  onClick={handleVerifyIntegrity}
                  disabled={isVerifyingIntegrity}
                  className="btn btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '0.72rem', height: '22px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  title="Verify cryptographic SHA-256 hash against disk file"
                >
                  <ShieldCheck size={12} />
                  {isVerifyingIntegrity ? 'Verifying...' : 'Verify Integrity'}
                </button>
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {saveMessage && (
            <span style={{ color: '#15803d', fontSize: '0.85rem', fontWeight: 600 }}>
              {saveMessage}
            </span>
          )}
          {canEditReview && (
            <>
              <button onClick={handleSave} className="btn btn-secondary" disabled={isSavingReview}>
                <Save size={16} /> Save Edits
              </button>
              <button onClick={handleReject} className="btn btn-secondary" disabled={isSavingReview}>
                Reject
              </button>
              <button onClick={handleVerify} className="btn btn-success" disabled={isSavingReview}>
                <CheckCircle size={16} /> Approve
              </button>
            </>
          )}
        </div>
      </div>

      {/* SHA-256 Cryptographic Integrity Verification Banner */}
      {integrityResult && (
        <div
          style={{
            background: integrityResult.isIntact ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${integrityResult.isIntact ? '#bbf7d0' : '#fecaca'}`,
            color: integrityResult.isIntact ? '#15803d' : '#991b1b',
            padding: '0.6rem 1rem',
            borderRadius: 'var(--radius)',
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.85rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={18} />
            <span>
              <strong>{integrityResult.isIntact ? 'Integrity Verified:' : 'Integrity Mismatch:'}</strong>{' '}
              {integrityResult.message}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
            Calculated Disk Hash: <code>{integrityResult.calculatedHash?.substring(0, 16)}...</code>
          </span>
        </div>
      )}
      {integrityError && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.6rem 1rem',
            borderRadius: 'var(--radius)',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertCircle size={16} />
          <span><strong>Integrity Check Error:</strong> {integrityError}</span>
        </div>
      )}

      {/* Phase 3 OCR Extraction Action Panel */}
      {canReview && (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '0.65rem 1rem',
          marginBottom: '0.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Sparkles size={16} color="var(--primary)" /> Intelligent OCR:
          </span>

          {/* Engine Selector */}
          <select
            className="field-input"
            style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.82rem' }}
            value={selectedEngine}
            onChange={(e) => setSelectedEngine(e.target.value)}
            disabled={isProcessing}
          >
            <option value="gemini">Google Gemini AI (Primary Engine)</option>
            <option value="local">Local OCR Engine (EasyOCR Fallback)</option>
          </select>

          {/* Language Selector */}
          <select
            className="field-input"
            style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.82rem' }}
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            disabled={isProcessing}
          >
            <option value="auto">Language: Auto-Detect</option>
            <option value="hi">Hindi (हिंदी)</option>
            <option value="te">Telugu (తెలుగు)</option>
            <option value="en">English</option>
            <option value="mr">Marathi (मराठी)</option>
            <option value="ta">Tamil (தமிழ்)</option>
          </select>
        </div>

        <div>
          <button
            onClick={handleRunOcr}
            className="btn btn-primary"
            style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader size={16} className="spin" />
                {selectedEngine === 'gemini' ? 'Analyzing with Gemini AI...' : 'Executing Local OCR...'}
              </>
            ) : (
              <>
                <Sparkles size={16} /> Run OCR & Extract Fields
              </>
            )}
          </button>
        </div>
      </div>
      )}

      {user?.role === 'Admin' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <label htmlFor="officer-assignment" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Assigned officer</label>
          <select
            id="officer-assignment"
            className="field-input"
            style={{ width: 'auto', minWidth: '220px' }}
            value={record.assignedOfficerId?.toString() || ''}
            onChange={handleAssignOfficer}
            disabled={isAssigning}
          >
            <option value="">Unassigned</option>
            {officers.map(officer => <option key={officer.id} value={officer.id}>{officer.displayName} · {officer.email}</option>)}
          </select>
        </div>
      )}

      {reviewError && <p role="alert" style={{ color: '#b91c1c', marginBottom: '0.75rem' }}>{reviewError}</p>}

      <section
        aria-live="polite"
        style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px' }}>
            <strong>Document Integrity</strong>
            <div style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}>
              SHA-256: <code style={{ overflowWrap: 'anywhere' }}>{record.fileMetadata?.sha256Hash || 'Unavailable'}</code>
            </div>
            <div style={{ marginTop: '0.25rem', color: integrityColor, fontSize: '0.85rem', fontWeight: 600 }}>
              {integrityLabel}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              Last verification: {integrityCheck?.verifiedAt
                ? new Date(integrityCheck.verifiedAt).toLocaleString()
                : 'Not yet verified'}
            </div>
          </div>
          <button
            onClick={handleVerifyIntegrity}
            className="btn btn-secondary"
            disabled={isVerifyingIntegrity}
          >
            {isVerifyingIntegrity ? <Loader size={16} className="spin" /> : <CheckCircle size={16} />}
            {isVerifyingIntegrity ? 'Verifying...' : 'Verify Document Integrity'}
          </button>
        </div>
        <div style={{ marginTop: '0.4rem', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          A matching hash confirms the file bytes are unchanged; it does not establish legal authenticity or ownership.
        </div>
      </section>

      {/* Processing Error Notice */}
      {processingError && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius)',
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem'
          }}
        >
          <AlertCircle size={18} />
          <span><strong>Processing Error:</strong> {processingError}</span>
        </div>
      )}

      {/* Split Grid View */}
      <div className="review-grid">
        {/* Left Pane: Document Viewer */}
        <div className="preview-pane">
          <DocumentViewer fileMetadata={record.fileMetadata} />
        </div>

        {/* Right Pane: Editable Fields, OCR Text, Version History, Ownership History, Conflicts, Audit */}
        <div className="form-pane">
          {/* Sub-navigation Tabs */}
          <div
            style={{
              padding: '0.6rem 1rem',
              background: '#f8fafc',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              alignItems: 'center'
            }}
          >
            <button
              onClick={() => setActiveTab('fields')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                borderRadius: 'var(--radius)',
                border: '1px solid',
                borderColor: activeTab === 'fields' ? 'var(--primary)' : '#e2e8f0',
                background: activeTab === 'fields' ? '#ffffff' : '#f8fafc',
                color: activeTab === 'fields' ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'fields' ? 'var(--shadow-sm)' : 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <FileText size={14} />
              <span>Attributes & Review</span>
            </button>

            <button
              onClick={() => setActiveTab('versions')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                borderRadius: 'var(--radius)',
                border: '1px solid',
                borderColor: activeTab === 'versions' ? 'var(--primary)' : '#e2e8f0',
                background: activeTab === 'versions' ? '#ffffff' : '#f8fafc',
                color: activeTab === 'versions' ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'versions' ? 'var(--shadow-sm)' : 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <History size={14} />
              <span>Version History</span>
              {record.currentVersion && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    background: activeTab === 'versions' ? 'var(--primary-light)' : '#e2e8f0',
                    color: activeTab === 'versions' ? 'var(--primary)' : '#475569',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    fontWeight: 700
                  }}
                >
                  v{record.currentVersion}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('ownership')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                borderRadius: 'var(--radius)',
                border: '1px solid',
                borderColor: activeTab === 'ownership' ? 'var(--primary)' : '#e2e8f0',
                background: activeTab === 'ownership' ? '#ffffff' : '#f8fafc',
                color: activeTab === 'ownership' ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'ownership' ? 'var(--shadow-sm)' : 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <Award size={14} />
              <span>Ownership History</span>
            </button>

            <button
              onClick={() => setActiveTab('conflicts')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                borderRadius: 'var(--radius)',
                border: '1px solid',
                borderColor: activeTab === 'conflicts' ? 'var(--primary)' : '#e2e8f0',
                background: activeTab === 'conflicts' ? '#ffffff' : '#f8fafc',
                color: activeTab === 'conflicts' ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'conflicts' ? 'var(--shadow-sm)' : 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <GitCompare size={14} />
              <span>Conflicts</span>
              {(conflictDetection.conflictCount || 0) > 0 && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    background: '#fef3c7',
                    color: '#92400e',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    fontWeight: 700
                  }}
                >
                  {conflictDetection.conflictCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0.4rem 0.8rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                borderRadius: 'var(--radius)',
                border: '1px solid',
                borderColor: activeTab === 'audit' ? 'var(--primary)' : '#e2e8f0',
                background: activeTab === 'audit' ? '#ffffff' : '#f8fafc',
                color: activeTab === 'audit' ? 'var(--primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: activeTab === 'audit' ? 'var(--shadow-sm)' : 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <Clock size={14} />
              <span>Audit Trail</span>
              {auditEvents.length > 0 && (
                <span
                  style={{
                    fontSize: '0.68rem',
                    background: activeTab === 'audit' ? 'var(--primary-light)' : '#e2e8f0',
                    color: activeTab === 'audit' ? 'var(--primary)' : '#475569',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    fontWeight: 700
                  }}
                >
                  {auditEvents.length}
                </span>
              )}
            </button>
          </div>

          <div className="form-body">
            {/* Version History Tab Panel */}
            {activeTab === 'versions' && (
              <VersionHistoryTab
                documentId={record._id}
                currentVersion={record.currentVersion || 1}
                canManage={canReview}
                onVersionUpdated={handleReloadDocument}
              />
            )}

            {/* Ownership History Tab Panel */}
            {activeTab === 'ownership' && (
              <OwnershipHistoryTab
                document={record}
                canTransfer={canReview}
                onOwnershipTransferred={handleReloadDocument}
              />
            )}

            {/* Land Attributes: Confidence and Summary */}
            {activeTab === 'fields' && (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '0.9rem 1rem',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                <Cpu size={16} color="var(--primary)" />
                <strong style={{ fontSize: '0.88rem' }}>Confidence</strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem 0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Overall extraction confidence
                  </div>
                  <div style={{ fontWeight: 700, marginTop: '0.25rem', fontSize: '0.95rem' }}>
                    {overallConfidence !== null ? formatConfidenceValue(overallConfidence) : 'Not available'}
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem 0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Validation TrustScore
                  </div>
                  <div style={{ fontWeight: 700, marginTop: '0.25rem', fontSize: '0.95rem' }}>
                    Not available
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {overallConfidence !== null
                  ? `Extraction confidence is reported by the selected engine and is not treated as a validated trust score.`
                  : 'Gemini model output is intentionally kept uncalibrated, so no numeric confidence is displayed unless a separate scoring pipeline is provided.'}
              </div>

              {validation?.score !== null && validation?.score !== undefined && (
                <div style={{ marginTop: '0.9rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Extraction Validation Score
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.2rem', marginTop: '0.2rem' }}>
                    {Number(validation.score).toFixed(0)} / 100
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', marginTop: '0.6rem' }}>
                    {Object.entries(validation.categories || {}).map(([key, category]) => (
                      <div key={key} style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        <strong>{key.replace(/([A-Z])/g, ' $1')}</strong>: {Number(category.score || 0).toFixed(0)} / {category.weight}
                      </div>
                    ))}
                  </div>
                  {(validation.reviewReasons || []).length > 0 && (
                    <div style={{ marginTop: '0.65rem', color: '#92400e', fontSize: '0.75rem' }}>
                      <strong>Review warnings:</strong>
                      <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                        {validation.reviewReasons.slice(0, 5).map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
                      </ul>
                    </div>
                  )}
                  <div style={{ marginTop: '0.65rem', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                    {validation.disclaimer || 'This score supports extraction review only; manual/legal verification may still be required.'}
                  </div>
                </div>
              )}

              {fieldConfidenceEntries.length > 0 && (
                <div style={{ marginTop: '0.9rem' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>
                    Per-field extraction confidence
                  </div>
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {fieldConfidenceEntries.map(({ key, label, confidence, source }) => (
                      <div
                        key={key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          background: '#ffffff',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          padding: '0.45rem 0.65rem',
                          fontSize: '0.78rem'
                        }}
                      >
                        <span>{label}</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {formatConfidenceValue(confidence)}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                          {source}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Phase 4: Duplicate & Cross-Record Conflict Detection Section */}
            {activeTab === 'conflicts' && (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '0.9rem 1rem',
                marginBottom: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <GitCompare size={17} color="var(--primary)" />
                  <strong style={{ fontSize: '0.88rem' }}>Cross-Record Conflict & Duplicate Detection</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {conflictActionMessage && (
                    <span style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>
                      {conflictActionMessage}
                    </span>
                  )}
                  <button
                    onClick={handleRefreshConflicts}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    disabled={isAnalyzingConflicts}
                    title="Scan indexed records for duplicates and conflicts"
                  >
                    <RefreshCw size={12} className={isAnalyzingConflicts ? 'spin' : ''} />
                    {isAnalyzingConflicts ? 'Analyzing...' : 'Re-check Conflicts'}
                  </button>
                </div>
              </div>

              {/* Status summary pills */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '12px',
                    background: (duplicateDetection.duplicateCount || 0) > 0 ? '#fee2e2' : '#dcfce7',
                    color: (duplicateDetection.duplicateCount || 0) > 0 ? '#991b1b' : '#166534',
                    border: `1px solid ${(duplicateDetection.duplicateCount || 0) > 0 ? '#fecaca' : '#bbf7d0'}`
                  }}
                >
                  {(duplicateDetection.duplicateCount || 0) > 0
                    ? `⚠️ ${duplicateDetection.duplicateCount} Duplicate Candidate(s)`
                    : '✓ No Duplicates'}
                </span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.55rem',
                    borderRadius: '12px',
                    background: (conflictDetection.conflictCount || 0) > 0 ? '#fef3c7' : '#dcfce7',
                    color: (conflictDetection.conflictCount || 0) > 0 ? '#92400e' : '#166534',
                    border: `1px solid ${(conflictDetection.conflictCount || 0) > 0 ? '#fde68a' : '#bbf7d0'}`
                  }}
                >
                  {(conflictDetection.conflictCount || 0) > 0
                    ? `⚠️ ${conflictDetection.conflictCount} Cross-Record Conflict(s)`
                    : '✓ No Cross-Record Conflicts'}
                </span>
              </div>

              {/* 1. Duplicate Matches List */}
              {(duplicateDetection.matches || []).length > 0 && (
                <div style={{ marginBottom: '0.9rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#991b1b', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangle size={13} />
                    Potential Duplicate Candidates:
                  </div>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {(duplicateDetection.matches || []).map((match, idx) => (
                      <div
                        key={match.targetDocumentId || idx}
                        style={{
                          background: '#fff',
                          border: '1px solid #fecaca',
                          borderLeft: '3px solid #dc2626',
                          borderRadius: '6px',
                          padding: '0.55rem 0.75rem',
                          fontSize: '0.78rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '4px',
                              background: match.matchType === 'EXACT_DUPLICATE' ? '#fee2e2' : '#fef3c7',
                              color: match.matchType === 'EXACT_DUPLICATE' ? '#991b1b' : '#92400e'
                            }}
                          >
                            {match.matchType === 'EXACT_DUPLICATE' ? 'Exact Duplicate' : 'Possible Duplicate'}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Target Record #{String(match.targetDocumentId || '').slice(-6)} ({match.targetFilename || 'Record'})
                          </span>
                        </div>
                        <p style={{ margin: '0 0 0.35rem 0', color: 'var(--text-main)', fontSize: '0.76rem' }}>
                          {match.explanation}
                        </p>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Matched fields:</span>
                          {(match.matchedFields || []).map((field, fIdx) => (
                            <span
                              key={fIdx}
                              style={{
                                background: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '3px',
                                fontSize: '0.68rem',
                                color: '#334155'
                              }}
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Cross-Record Conflicts List */}
              {(conflictDetection.conflicts || []).length > 0 && (
                <div style={{ marginBottom: '0.65rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangle size={13} />
                    Cross-Record Conflict Warnings:
                  </div>
                  <div style={{ display: 'grid', gap: '0.55rem' }}>
                    {(conflictDetection.conflicts || []).map((conflict, cIdx) => (
                      <div
                        key={conflict.targetDocumentId || cIdx}
                        style={{
                          background: '#fff',
                          border: '1px solid #fde68a',
                          borderLeft: '3px solid #d97706',
                          borderRadius: '6px',
                          padding: '0.55rem 0.75rem',
                          fontSize: '0.78rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                          <strong style={{ fontSize: '0.75rem', color: '#92400e' }}>
                            Shared Land Parcel ({(conflict.sharedIdentifiers || []).map(i => `${i.field}: ${i.value}`).join(', ') || 'Shared Identifier'})
                          </strong>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            vs. Record #{String(conflict.targetDocumentId || '').slice(-6)}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '0.4rem' }}>
                          {(conflict.conflictingFields || []).map((cf, fIdx) => (
                            <div
                              key={fIdx}
                              style={{
                                background: '#fdf8f6',
                                border: '1px solid #fee2e2',
                                borderRadius: '4px',
                                padding: '0.4rem 0.55rem'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.74rem', marginBottom: '0.2rem' }}>
                                <span>{cf.label || cf.field}</span>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.72rem' }}>
                                <div>
                                  <span style={{ color: 'var(--text-muted)' }}>This document: </span>
                                  <strong>{cf.currentValue || '(empty)'}</strong>
                                </div>
                                <div>
                                  <span style={{ color: 'var(--text-muted)' }}>Compared record: </span>
                                  <strong>{cf.targetValue || '(empty)'}</strong>
                                </div>
                              </div>
                              <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#78350f' }}>
                                <em>{cf.reason}</em>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Informational clean message when neither duplicate nor conflict */}
              {(!duplicateDetection.duplicateCount && !conflictDetection.conflictCount) && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <CheckCircle size={14} color="#16a34a" />
                  <span>No duplicate records or cross-record field conflicts detected for this land parcel.</span>
                </div>
              )}

              {/* Disclaimer */}
              <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', borderTop: '1px solid #e2e8f0', paddingTop: '0.45rem' }}>
                {conflictDetection.disclaimer ||
                  'Cross-record conflicts indicate potential data variances or historical transactions requiring human review. They do not constitute proof of fraud or document invalidity.'}
              </div>
            </div>
            )}

            {/* Land Details Form Fields */}
            {activeTab === 'fields' && (
              <>
            {/* Raw OCR Text Section (Collapsible) */}
            {record.ocrResult?.fullText && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '0.75rem 1rem',
                  marginBottom: '1.25rem'
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setShowRawOcr(!showRawOcr)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}>
                    <FileText size={16} color="var(--primary)" />
                    <span>Raw Transcribed OCR Text</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                      ({record.ocrResult.fullText.length} characters • {record.ocrResult.detectedLanguage || 'Detected Script'})
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopyRawText(); }}
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      title="Copy raw text to clipboard"
                    >
                      {copiedText ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                      {copiedText ? 'Copied' : 'Copy'}
                    </button>
                    {showRawOcr ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {showRawOcr && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <textarea
                      readOnly
                      value={record.ocrResult.fullText}
                      style={{
                        width: '100%',
                        minHeight: '110px',
                        fontSize: '0.85rem',
                        fontFamily: 'monospace',
                        padding: '0.6rem',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: '#ffffff',
                        color: '#1e293b',
                        resize: 'vertical',
                        lineHeight: '1.4'
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Owner Name */}
            <div className="field-group">
              <div className="field-label-row">
                <label className="field-label">Owner Name (खातेदार का नाम / పట్టాదారు పేరు)</label>
                {formData.ownerName.confidence !== null && (
                  <span className="confidence-meter">
                    Conf: {(formData.ownerName.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <input
                type="text"
                className={`field-input ${formData.ownerName.isFlagged ? 'field-flagged' : ''}`}
                value={formData.ownerName.value || ''}
                onChange={(e) => handleFieldChange('ownerName', 'value', e.target.value)}
                placeholder="Pending extraction"
                disabled={!canEditReview}
              />
              {formData.ownerName.rawOcrText && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  Raw Text: <em>{formData.ownerName.rawOcrText}</em>
                </div>
              )}
            </div>

            {/* Khasra and Khata Numbers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="field-group">
                <div className="field-label-row">
                  <label className="field-label">Khasra / Survey Number (సర్వే నం)</label>
                  {formData.khasraNumber.confidence !== null && (
                    <span className="confidence-meter">
                      {(formData.khasraNumber.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  className={`field-input ${formData.khasraNumber.isFlagged ? 'field-flagged' : ''}`}
                  value={formData.khasraNumber.value || ''}
                  onChange={(e) => handleFieldChange('khasraNumber', 'value', e.target.value)}
                  placeholder="e.g. 142/2 or 154/2"
                  disabled={!canEditReview}
                />
              </div>

              <div className="field-group">
                <div className="field-label-row">
                  <label className="field-label">Khata / Khewat Number (ఖాతా నం)</label>
                  {formData.khataNumber.confidence !== null && (
                    <span className="confidence-meter">
                      {(formData.khataNumber.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  className={`field-input ${formData.khataNumber.isFlagged ? 'field-flagged' : ''}`}
                  value={formData.khataNumber.value || ''}
                  onChange={(e) => handleFieldChange('khataNumber', 'value', e.target.value)}
                  placeholder="e.g. 00058 or 402/A"
                  disabled={!canEditReview}
                />
              </div>
            </div>

            {/* Land Area and Unit */}
            <div className="field-group">
              <div className="field-label-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label className="field-label">Land Area & Unit (क्षेत्रफल / విస్తీర్ణం)</label>
                  {formData.landArea.isFlagged && (
                    <span className="flag-alert">
                      <AlertTriangle size={12} /> Low Confidence or Unfilled
                    </span>
                  )}
                </div>
                {formData.landArea.confidence !== null && (
                  <span className="confidence-meter" style={{ color: formData.landArea.isFlagged ? '#b45309' : 'inherit' }}>
                    Conf: {(formData.landArea.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
                <input
                  type="text"
                  className={`field-input ${formData.landArea.isFlagged ? 'field-flagged' : ''}`}
                  value={formData.landArea.value || ''}
                  onChange={(e) => handleFieldChange('landArea', 'value', e.target.value)}
                  placeholder="e.g. 2.50 or 1.4500"
                  disabled={!canEditReview}
                />
                <select
                  className="field-input"
                  value={formData.landArea.unit || 'Acre'}
                  onChange={(e) => handleFieldChange('landArea', 'unit', e.target.value)}
                  disabled={!canEditReview}
                >
                  <option value="Acre">Acre</option>
                  <option value="Hectare">Hectare</option>
                  <option value="Bigha">Bigha</option>
                  <option value="Biswa">Biswa</option>
                  <option value="Gunta">Gunta</option>
                  <option value="Sq Yards">Sq Yards</option>
                </select>
              </div>
              {formData.landArea.rawOcrText && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                  Raw Text detected: <em>{formData.landArea.rawOcrText}</em>
                </div>
              )}
            </div>

            {/* Administrative Hierarchy: District, Tehsil, Village */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <div className="field-group">
                <label className="field-label">District (जिला / జిల్లా)</label>
                <input
                  type="text"
                  className={`field-input ${formData.district.isFlagged ? 'field-flagged' : ''}`}
                  value={formData.district.value || ''}
                  onChange={(e) => handleFieldChange('district', 'value', e.target.value)}
                  placeholder="District"
                  disabled={!canEditReview}
                />
              </div>

              <div className="field-group">
                <label className="field-label">Tehsil (तहसील / మండలం)</label>
                <input
                  type="text"
                  className={`field-input ${formData.tehsil.isFlagged ? 'field-flagged' : ''}`}
                  value={formData.tehsil.value || ''}
                  onChange={(e) => handleFieldChange('tehsil', 'value', e.target.value)}
                  placeholder="Tehsil / Mandal"
                  disabled={!canEditReview}
                />
              </div>

              <div className="field-group">
                <label className="field-label">Village (ग्राम / గ్రామం)</label>
                <input
                  type="text"
                  className={`field-input ${formData.village.isFlagged ? 'field-flagged' : ''}`}
                  value={formData.village.value || ''}
                  onChange={(e) => handleFieldChange('village', 'value', e.target.value)}
                  placeholder="Village"
                  disabled={!canEditReview}
                />
              </div>
            </div>

            {/* Land Classification */}
            <div className="field-group">
              <div className="field-label-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label className="field-label">Land Classification (भूमि श्रेणी / భూమి రకం)</label>
                  {formData.landClassification.isFlagged && (
                    <span className="flag-alert">
                      <AlertTriangle size={12} /> Review Needed
                    </span>
                  )}
                </div>
              </div>
              <input
                type="text"
                className={`field-input ${formData.landClassification.isFlagged ? 'field-flagged' : ''}`}
                value={formData.landClassification.value || ''}
                onChange={(e) => handleFieldChange('landClassification', 'value', e.target.value)}
                placeholder="e.g. Agricultural / Dry / Wet / Commercial"
                disabled={!canEditReview}
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="review-remarks">Review remarks</label>
              <textarea
                id="review-remarks"
                className="field-input"
                rows="3"
                maxLength={2000}
                value={reviewRemarks}
                onChange={event => setReviewRemarks(event.target.value)}
                disabled={!canEditReview}
                placeholder={canEditReview ? 'Add review notes' : 'No review remarks'}
              />
            </div>
            </>
            )}

            {/* Phase 4: Document Audit History Section */}
            {activeTab === 'audit' && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '1rem',
                marginTop: '1.25rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <History size={18} color="var(--primary)" />
                  <strong style={{ fontSize: '0.95rem' }}>Audit History & Activity Log</strong>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: '#f1f5f9', padding: '0.15rem 0.45rem', borderRadius: '10px' }}>
                    Append-Only Log
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <select
                    className="field-input"
                    style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                    value={auditSort}
                    onChange={(e) => setAuditSort(e.target.value)}
                  >
                    <option value="asc">Chronological (Oldest First)</option>
                    <option value="desc">Latest Activity First</option>
                  </select>
                  <button
                    onClick={fetchAuditTrail}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    disabled={isLoadingAudit}
                    title="Refresh audit history"
                  >
                    <RefreshCw size={12} className={isLoadingAudit ? 'spin' : ''} />
                    {isLoadingAudit ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {/* Loading State */}
              {isLoadingAudit && (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <Loader size={20} className="spin" style={{ margin: '0 auto 0.5rem', display: 'block', color: 'var(--primary)' }} />
                  Loading audit history...
                </div>
              )}

              {/* Error State */}
              {auditError && (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    padding: '0.75rem 1rem',
                    color: '#991b1b',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={16} />
                    <span>Failed to load audit history: {auditError}</span>
                  </div>
                  <button onClick={fetchAuditTrail} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
                    Retry
                  </button>
                </div>
              )}

              {/* Empty State */}
              {!isLoadingAudit && !auditError && auditEvents.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <History size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.4 }} />
                  <p style={{ margin: 0 }}>No audit events recorded for this document yet.</p>
                </div>
              )}

              {/* Audit Events Timeline / List */}
              {!isLoadingAudit && !auditError && auditEvents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {auditEvents.map((evt, idx) => (
                    <div
                      key={evt._id || idx}
                      style={{
                        border: '1px solid var(--border)',
                        borderLeft: `4px solid ${
                          evt.outcome === 'FAILURE' ? '#dc2626' : evt.action === 'STATUS_UPDATED' ? '#16a34a' : 'var(--primary)'
                        }`,
                        borderRadius: '6px',
                        padding: '0.75rem',
                        background: evt.outcome === 'FAILURE' ? '#fff5f5' : '#fcfcfc',
                        fontSize: '0.82rem'
                      }}
                    >
                      {/* Header Row: Action badge, Actor & Role, Timestamp, Outcome */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '0.35rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              background:
                                evt.action === 'STATUS_UPDATED'
                                  ? '#dcfce7'
                                  : evt.action === 'FIELD_EDITS_SAVED'
                                  ? '#e0e7ff'
                                  : evt.action === 'DOCUMENT_UPLOADED'
                                  ? '#e0f2fe'
                                  : evt.action === 'OCR_PROCESSING_FAILED'
                                  ? '#fee2e2'
                                  : '#f1f5f9',
                              color:
                                evt.action === 'STATUS_UPDATED'
                                  ? '#166534'
                                  : evt.action === 'FIELD_EDITS_SAVED'
                                  ? '#3730a3'
                                  : evt.action === 'DOCUMENT_UPLOADED'
                                  ? '#0369a1'
                                  : evt.action === 'OCR_PROCESSING_FAILED'
                                  ? '#991b1b'
                                  : '#334155'
                            }}
                          >
                            {evt.action.replace(/_/g, ' ')}
                          </span>

                          {/* Actor Badge */}
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
                            <span>
                              Actor: <strong>{evt.actor?.id || 'Anonymous'}</strong>
                              {evt.actor?.role ? ` (${evt.actor.role})` : ` [${evt.actor?.type || 'SYSTEM'}]`}
                            </span>
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              padding: '0.1rem 0.35rem',
                              borderRadius: '3px',
                              background: evt.outcome === 'FAILURE' ? '#fee2e2' : '#dcfce7',
                              color: evt.outcome === 'FAILURE' ? '#991b1b' : '#166534'
                            }}
                          >
                            {evt.outcome}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={12} />
                            {new Date(evt.timestamp).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {/* Description */}
                      <div style={{ color: 'var(--text-main)', marginBottom: evt.details?.diffs?.length ? '0.5rem' : '0.2rem' }}>
                        {evt.description}
                      </div>

                      {/* If there was an error message */}
                      {evt.errorMessage && (
                        <div style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 500, marginTop: '0.25rem' }}>
                          Error: {evt.errorMessage}
                        </div>
                      )}

                      {/* If there are field diffs, display them nicely */}
                      {evt.details?.diffs && evt.details.diffs.length > 0 && (
                        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '0.4rem 0.6rem', marginTop: '0.35rem' }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                            Changed Land Attributes:
                          </div>
                          <div style={{ display: 'grid', gap: '0.3rem' }}>
                            {evt.details.diffs.map((diff, dIdx) => (
                              <div key={dIdx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                                <span style={{ fontWeight: 600, minWidth: '120px' }}>{diff.label || diff.field}:</span>
                                <span style={{ color: '#991b1b', textDecoration: 'line-through', background: '#fee2e2', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>
                                  {diff.before || '(empty)'}
                                </span>
                                <span style={{ color: 'var(--text-muted)' }}>➔</span>
                                <span style={{ color: '#166534', fontWeight: 600, background: '#dcfce7', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>
                                  {diff.after || '(empty)'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* If status was changed */}
                      {evt.action === 'STATUS_UPDATED' && evt.details?.previousStatus && evt.details?.newStatus && (
                        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                          <span>Transition: </span>
                          <span style={{ textDecoration: 'line-through', color: '#64748b' }}>{evt.details.previousStatus}</span>
                          <span style={{ margin: '0 4px' }}>➔</span>
                          <strong style={{ color: '#16a34a' }}>{evt.details.newStatus}</strong>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
