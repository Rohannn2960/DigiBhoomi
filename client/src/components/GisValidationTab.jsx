import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Clock,
  Loader,
  ShieldAlert,
  Info,
  Database,
  Building
} from 'lucide-react';
import { fetchDocumentGis, validateDocumentGis } from '../services/api';
import GisBoundaryMap from './GisBoundaryMap';
import GisDiscrepancyList from './GisDiscrepancyList';

/**
 * Returns visual styling tokens for a GIS validation status string.
 */
function getGisStatusBadge(status) {
  switch (status) {
    case 'MATCHED':
      return {
        label: 'Matched',
        icon: CheckCircle,
        bg: '#dcfce7',
        text: '#15803d',
        border: '#bbf7d0'
      };
    case 'POTENTIAL_DISCREPANCY':
      return {
        label: 'Potential Discrepancy',
        icon: AlertTriangle,
        bg: '#fef3c7',
        text: '#b45309',
        border: '#fde68a'
      };
    case 'UNABLE_TO_VERIFY':
      return {
        label: 'Unable to Verify',
        icon: AlertCircle,
        bg: '#fee2e2',
        text: '#991b1b',
        border: '#fecaca'
      };
    case 'NOT_RUN':
    default:
      return {
        label: 'Not Run',
        icon: Clock,
        bg: '#f1f5f9',
        text: '#475569',
        border: '#cbd5e1'
      };
  }
}

/**
 * GisValidationTab
 * Complete administrative jurisdiction GIS validation panel inside ReviewPage.
 *
 * Responsibilities:
 * - Fetches live GIS validation data via GET /api/documents/:id/gis.
 * - Displays status badge (NOT_RUN, MATCHED, POTENTIAL_DISCREPANCY, UNABLE_TO_VERIFY).
 * - Displays matched boundary administrative metadata and TGRAC reference metadata.
 * - Handles stale dataset alerts with re-validation prompt.
 * - Renders GisBoundaryMap when valid geometry exists, or graceful empty state.
 * - Displays warning if MATCHED status lacks geometry in the database.
 * - Renders GisDiscrepancyList for detected variances.
 * - Renders exact mandatory limitation disclaimer returned by backend.
 * - Role-scoped validation action: enabled for Officers/Admins, informative for Citizens.
 */
export default function GisValidationTab({
  documentId,
  canValidate = false,
  onValidationComplete = null
}) {
  const [gisData, setGisData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState(null);

  const loadGisData = useCallback(async () => {
    if (!documentId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchDocumentGis(documentId);
      setGisData(res.gisValidation || null);
    } catch (err) {
      if (err.status === 404) {
        setError('Document record not found or access denied.');
      } else {
        setError(err.message || 'Failed to load administrative GIS validation details.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadGisData();
  }, [loadGisData]);

  const handleRunValidation = async () => {
    if (!documentId || isValidating || !canValidate) return;
    setIsValidating(true);
    setError(null);
    setActionSuccessMessage(null);
    try {
      const res = await validateDocumentGis(documentId);
      setGisData(res.gisValidation || null);

      const status = res.gisValidation?.status;
      if (status === 'MATCHED') {
        setActionSuccessMessage('Administrative jurisdiction verified: Exact Mandal boundary matched.');
      } else if (status === 'POTENTIAL_DISCREPANCY') {
        setActionSuccessMessage('Validation completed: Potential administrative discrepancies identified.');
      } else {
        setActionSuccessMessage('Validation completed: Unable to verify administrative jurisdiction.');
      }

      if (typeof onValidationComplete === 'function') {
        onValidationComplete(res);
      }
    } catch (err) {
      if (err.status === 403) {
        setError('Citizens are not permitted to execute official administrative GIS validation.');
      } else if (err.status === 404) {
        setError('Document record not found or access denied.');
      } else {
        setError(err.message || 'Failed to execute administrative GIS validation.');
      }
    } finally {
      setIsValidating(false);
    }
  };

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem',
          color: 'var(--text-muted)',
          gap: '0.75rem'
        }}
      >
        <Loader size={28} className="spin" color="var(--primary)" />
        <span style={{ fontSize: '0.88rem' }}>Loading administrative GIS verification data...</span>
      </div>
    );
  }

  const status = gisData?.status || 'NOT_RUN';
  const badgeTokens = getGisStatusBadge(status);
  const StatusIcon = badgeTokens.icon;
  const isStale = Boolean(gisData?.isStale);
  const hasBoundaryGeometry = Boolean(gisData?.boundary?.geometry?.coordinates?.length);
  const isMatchedWithoutGeometry = status === 'MATCHED' && !hasBoundaryGeometry;
  const meta = gisData?.datasetMetadata;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. Top Control & Summary Header */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '0.85rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius)',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <MapPin size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>
              Administrative Mandal Verification
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Telangana Remote Sensing Applications Centre (TGRAC) Boundary Dataset
            </div>
          </div>
        </div>

        {/* Status Badge & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              background: badgeTokens.bg,
              color: badgeTokens.text,
              border: `1px solid ${badgeTokens.border}`,
              padding: '0.25rem 0.65rem',
              borderRadius: '9999px'
            }}
          >
            <StatusIcon size={13} />
            <span>{badgeTokens.label}</span>
          </span>

          {/* Validation Action for Authorized Reviewers */}
          {canValidate ? (
            <button
              type="button"
              onClick={handleRunValidation}
              disabled={isValidating}
              className="btn btn-primary"
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Execute administrative boundary verification against TGRAC Mandal boundaries"
            >
              {isValidating ? (
                <>
                  <Loader size={14} className="spin" />
                  <span>Validating...</span>
                </>
              ) : status === 'NOT_RUN' ? (
                <>
                  <MapPin size={14} />
                  <span>Run GIS Validation</span>
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  <span>Re-run Validation</span>
                </>
              )}
            </button>
          ) : (
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: '#f8fafc',
                padding: '0.25rem 0.5rem',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)'
              }}
              title="Official GIS verification is restricted to assigned reviewing officers"
            >
              <Info size={13} />
              <span>Official verification is conducted by assigned officers</span>
            </div>
          )}

          <button
            type="button"
            onClick={loadGisData}
            disabled={isLoading || isValidating}
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.82rem' }}
            title="Refresh GIS details"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* 2. Success Feedback Notice */}
      {actionSuccessMessage && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <CheckCircle size={16} />
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* 3. Error Feedback Notice */}
      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadGisData}
            className="btn btn-secondary"
            style={{ padding: '2px 8px', fontSize: '0.72rem', height: '24px' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 4. Stale Dataset Warning Banner */}
      {isStale && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            padding: '0.7rem 1rem',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <RefreshCw size={16} />
          <div>
            <strong>Dataset Update Notice:</strong>{' '}
            {gisData.staleReason || 'The reference TGRAC mandal dataset has been updated since this document was validated.'}{' '}
            {canValidate && <span>Re-validation is recommended.</span>}
          </div>
        </div>
      )}

      {/* 5. Warning for MATCHED Status with Missing Geometry */}
      {isMatchedWithoutGeometry && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#92400e',
            padding: '0.7rem 1rem',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertTriangle size={16} />
          <span>
            <strong>Boundary Geometry Notice:</strong> Administrative match was confirmed for Mandal ID{' '}
            <code>{gisData.matchedMandalId}</code>, but boundary polygon coordinates are currently unavailable in the database.
          </span>
        </div>
      )}

      {/* 6. Main Content Layout: Spatial Map & Validation Attributes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Interactive Map Component */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Mandal Boundary Map
            </span>
            {hasBoundaryGeometry && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Polygon Bounds: EPSG:4326 (WGS84)
              </span>
            )}
          </div>
          <GisBoundaryMap boundary={gisData?.boundary} height="320px" />
        </div>

        {/* Validation Details Card */}
        {status === 'MATCHED' && (
          <div
            style={{
              background: '#ffffff',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '0.9rem 1rem'
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building size={15} color="var(--primary)" />
              <span>Verified Administrative Jurisdiction</span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem',
                fontSize: '0.82rem'
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>District (Verified)</span>
                <strong>{gisData.matchedDistrict || '-'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Mandal (Verified)</span>
                <strong>{gisData.matchedMandal || '-'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Mandal Type</span>
                <span>{gisData.mandalType || '-'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Revenue Division</span>
                <span>{gisData.revenueDivision || '-'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>TGRAC Object ID</span>
                <code>#{gisData.matchedMandalId || '-'}</code>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.72rem' }}>Validated At</span>
                <span>{gisData.validatedAt ? new Date(gisData.validatedAt).toLocaleString() : 'N/A'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Unrun Validation Explanatory Card */}
        {status === 'NOT_RUN' && (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text-muted)'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={16} />
              <span>Administrative GIS verification has not been performed yet.</span>
            </div>
            <div>
              {canValidate
                ? "Click 'Run GIS Validation' above to execute automated spatial containment verification of the document's District and Mandal against official Telangana TGRAC records."
                : "Official administrative jurisdiction verification will be performed by the assigned review officer during formal document inspection."}
            </div>
          </div>
        )}

        {/* Discrepancies Section (only rendered for actual discrepancies in evaluated states) */}
        {status !== 'NOT_RUN' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Jurisdiction Discrepancies
            </span>
            <GisDiscrepancyList discrepancies={gisData?.discrepancies || []} />
          </div>
        )}

        {/* 7. Reference Dataset Metadata Card */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '0.75rem 1rem',
            fontSize: '0.78rem'
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Database size={14} color="var(--primary)" />
            <span>Reference Dataset Specifications</span>
          </div>

          {meta ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.5rem',
                color: 'var(--text-muted)'
              }}
            >
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem' }}>Layer Service</span>
                <span style={{ color: 'var(--text-main)' }}>{meta.layerName || 'Mandal Boundary'} (ID {meta.layerId || 26})</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem' }}>Total Mandal Units</span>
                <span style={{ color: 'var(--text-main)' }}>{meta.featureCount || 621} Features</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem' }}>Coordinate System</span>
                <span style={{ color: 'var(--text-main)' }}>{meta.crs || 'EPSG:4326 (WGS84)'}</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.7rem' }}>Retrieval Timestamp</span>
                <span style={{ color: 'var(--text-main)' }}>
                  {meta.retrievalDate ? new Date(meta.retrievalDate).toLocaleDateString() : 'N/A'}
                </span>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ display: 'block', fontSize: '0.7rem' }}>GeoJSON SHA-256 Fingerprint</span>
                <code style={{ fontSize: '0.72rem', wordBreak: 'break-all', background: '#f8fafc', padding: '1px 4px', borderRadius: '3px' }}>
                  {meta.fingerprint || 'Unavailable'}
                </code>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>
              Dataset reference metadata is currently unavailable from server.
            </div>
          )}
        </div>

        {/* 8. Mandatory Limitation Disclaimer */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px'
          }}
        >
          <ShieldAlert size={16} color="#64748b" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            <strong>Administrative Jurisdiction Limitation:</strong>{' '}
            {gisData?.disclaimer ||
              'This validation checks administrative jurisdiction at the mandal level using the TGRAC Mandal Boundary dataset. Village-level boundaries, individual survey plots, cadastral ownership, and legal land title cannot be verified using this dataset.'}
          </div>
        </div>
      </div>
    </div>
  );
}
