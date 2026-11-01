import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { assignDocument, fetchDocumentById, fetchUsers, getDocumentFileUrl, processDocument, reviewDocument, verifyDocumentIntegrity } from '../services/api';
import { useAuth } from '../context/auth-context';
import DocumentViewer from '../components/DocumentViewer';
import StatusBadge from '../components/StatusBadge';
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
  ChevronUp
} from 'lucide-react';

const defaultField = {
  value: '',
  rawOcrText: null,
  confidence: null,
  isFlagged: false,
  reviewStatus: 'Unreviewed'
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
  const [isVerifyingIntegrity, setIsVerifyingIntegrity] = useState(false);
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
    } catch (err) {
      setProcessingError(err.message || 'Failed to process document.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyIntegrity = async () => {
    if (!record?._id) return;
    setIsVerifyingIntegrity(true);
    try {
      const result = await verifyDocumentIntegrity(record._id);
      setIntegrityCheck(result);
    } catch {
      setIntegrityCheck({
        status: 'HASH_UNAVAILABLE',
        calculatedHash: null,
        verifiedAt: new Date().toISOString()
      });
    } finally {
      setIsVerifyingIntegrity(false);
    }
  };

  const handleCopyRawText = () => {
    if (record?.ocrResult?.fullText) {
      navigator.clipboard.writeText(record.ocrResult.fullText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
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
              <span title={record.fileMetadata?.sha256Hash}>
                SHA-256: <code>{record.fileMetadata?.sha256Hash?.substring(0, 16)}...</code>
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

        {/* Right Pane: Editable Fields & OCR Text */}
        <div className="form-pane">
          <div style={{ padding: '0.85rem 1.25rem', background: '#f8fafc', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: '0.95rem' }}>Extracted Land Attributes</strong>
              {record.ocrResult?.engine && (
                <div style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 600 }}>
                  Extracted via: {record.ocrResult.engine}
                </div>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Yellow fields flag empty or low-confidence attributes
            </span>
          </div>

          <div className="form-body">
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
          </div>
        </div>
      </div>
    </div>
  );
}
