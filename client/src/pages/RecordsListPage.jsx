import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { fetchDocuments } from '../services/api';
import { useAuth } from '../context/auth-context';
import { Upload, Eye, FileText, Search, X, Loader, AlertCircle, RefreshCw, GitCompare } from 'lucide-react';
import DocumentComparisonModal from '../components/DocumentComparisonModal';

export default function RecordsListPage() {
  const { user } = useAuth();
  const canUpload = ['Citizen', 'Admin'].includes(user?.role);
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Cross-Document Selection & Comparison State
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareDocA, setCompareDocA] = useState(null);
  const [compareDocB, setCompareDocB] = useState(null);

  const handleToggleSelect = (docId) => {
    setSelectedDocIds(prev => {
      if (prev.includes(docId)) {
        return prev.filter(id => id !== docId);
      }
      if (prev.length >= 2) {
        return [prev[0], docId];
      }
      return [...prev, docId];
    });
  };

  const handleClearSelection = () => {
    setSelectedDocIds([]);
  };

  const handleOpenCompareSelected = () => {
    if (selectedDocIds.length >= 2) {
      setCompareDocA(selectedDocIds[0]);
      setCompareDocB(selectedDocIds[1]);
      setIsCompareModalOpen(true);
    }
  };

  const handleQuickCompare = (record) => {
    setCompareDocA(record._id);
    const otherId = selectedDocIds.find(id => id !== record._id);
    setCompareDocB(otherId || null);
    setIsCompareModalOpen(true);
  };

  const loadDocuments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDocuments();
      setRecords(data);
    } catch (err) {
      setError(err.message || 'Failed to connect to database.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const filteredRecords = records.filter(rec => {
    // 1. Status Filter
    if (statusFilter !== 'ALL' && rec.status !== statusFilter) {
      return false;
    }

    // 2. Search Filter by Owner, Survey/Khasra, Village, District, or Filename
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const filename = rec.fileMetadata?.originalFilename?.toLowerCase() || '';
      const owner = rec.landDetails?.ownerName?.value?.toLowerCase() || '';
      const khasra = rec.landDetails?.khasraNumber?.value?.toLowerCase() || '';
      const village = rec.landDetails?.village?.value?.toLowerCase() || '';
      const district = rec.landDetails?.district?.value?.toLowerCase() || '';

      const matches = filename.includes(q) || owner.includes(q) || khasra.includes(q) || village.includes(q) || district.includes(q);
      if (!matches) return false;
    }

    return true;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{user?.role === 'Officer' ? 'Assigned Document Reviews' : 'Land Records Repository'}</h1>
          <p className="page-description">
            {user?.role === 'Officer'
              ? 'Documents assigned to your officer account.'
              : user?.role === 'Citizen'
                ? 'Your uploaded land records and their processing status.'
                : 'Authorized system-wide land records.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            onClick={loadDocuments} 
            className="btn btn-secondary" 
            title="Refresh records from database"
            disabled={isLoading}
          >
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} /> Refresh
          </button>
          {canUpload && (
            <Link to="/upload" className="btn btn-primary">
              <Upload size={16} /> Upload New Record
            </Link>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div 
          style={{ 
            background: '#fee2e2', 
            border: '1px solid #fecaca', 
            color: '#991b1b', 
            padding: '1rem', 
            borderRadius: 'var(--radius)', 
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={20} />
            <span><strong>Database Error:</strong> {error}</span>
          </div>
          <button onClick={loadDocuments} className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}>
            Try Again
          </button>
        </div>
      )}

      {/* Search Bar and Controls */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Search Input */}
        <div style={{ position: 'relative', minWidth: '320px', flex: '1', maxWidth: '460px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="field-input"
            style={{ paddingLeft: '38px', paddingRight: searchQuery ? '36px' : '12px' }}
            placeholder="Search by filename, owner, survey/khasra, village..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {[
            { label: 'All Records', value: 'ALL', count: records.length },
            { label: 'Uploaded', value: 'Uploaded', count: records.filter(r => r.status === 'Uploaded').length },
            { label: 'Processing', value: 'Processing', count: records.filter(r => r.status === 'Processing').length },
            { label: 'Needs Review', value: 'Needs review', count: records.filter(r => r.status === 'Needs review').length },
            { label: 'Verified', value: 'Verified', count: records.filter(r => r.status === 'Verified').length },
            { label: 'Rejected', value: 'Rejected', count: records.filter(r => r.status === 'Rejected').length },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`btn ${statusFilter === tab.value ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Document Selection & Comparison Action Bar */}
      {selectedDocIds.length > 0 && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 'var(--radius)',
            padding: '0.75rem 1.25rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
            <GitCompare size={18} color="#16a34a" />
            <span>
              {selectedDocIds.length === 1 ? (
                <span>
                  <strong>1 document selected.</strong> Select a second document from the table below to compare side by side.
                </span>
              ) : (
                <span>
                  <strong>2 documents selected for side-by-side comparison:</strong>{' '}
                  <em>{records.find(r => r._id === selectedDocIds[0])?.fileMetadata?.originalFilename || 'Document 1'}</em> vs{' '}
                  <em>{records.find(r => r._id === selectedDocIds[1])?.fileMetadata?.originalFilename || 'Document 2'}</em>
                </span>
              )}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleClearSelection}
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              Clear Selection
            </button>
            {selectedDocIds.length === 2 && (
              <button
                onClick={handleOpenCompareSelected}
                className="btn btn-primary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <GitCompare size={15} /> Compare Selected Documents
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-muted)' }}>
          <Loader size={32} className="spin" style={{ margin: '0 auto 1rem', display: 'block', color: 'var(--primary)' }} />
          <p>Connecting to database & loading stored land records...</p>
        </div>
      ) : records.length === 0 ? (
        /* Empty State */
        <div className="card" style={{ textAlign: 'center', padding: '3.5rem' }}>
          <FileText size={48} style={{ margin: '0 auto 1rem', display: 'block', color: 'var(--text-muted)', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No Land Records in Database</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '440px', margin: '0 auto 1.5rem' }}>
            No digitized land records have been uploaded to MongoDB yet. Upload a legacy land deed, Jamabandi, or Khatauni to get started.
          </p>
          {canUpload && (
            <Link to="/upload" className="btn btn-primary">
              <Upload size={16} /> Upload First Document
            </Link>
          )}
        </div>
      ) : (
        /* Table of Real Documents */
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '44px', textAlign: 'center' }}>
                  <span title="Select documents to compare">Select</span>
                </th>
                <th>Document Details</th>
                <th>Owner Name</th>
                <th>Khasra / Khata</th>
                <th>Village & Tehsil</th>
                <th>District</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No matching records found for "{searchQuery}".
                  </td>
                </tr>
              ) : (
                filteredRecords.map(record => (
                  <tr key={record._id} style={{ background: selectedDocIds.includes(record._id) ? '#f0fdf4' : 'inherit' }}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedDocIds.includes(record._id)}
                        onChange={() => handleToggleSelect(record._id)}
                        aria-label={`Select ${record.fileMetadata?.originalFilename || 'document'} for comparison`}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--primary)' }}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileText size={18} color="var(--primary)" />
                        <div>
                          <div style={{ fontWeight: 600 }}>{record.fileMetadata?.originalFilename}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {new Date(record.createdAt).toLocaleDateString()} • {((record.fileMetadata?.sizeBytes || 0) / 1024).toFixed(1)} KB
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {record.landDetails?.ownerName?.value ? (
                        <span style={{ fontWeight: 500 }}>{record.landDetails.ownerName.value}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Pending extraction</span>
                      )}
                    </td>
                    <td>
                      {record.landDetails?.khasraNumber?.value ? (
                        <span>
                          <strong>{record.landDetails.khasraNumber.value}</strong> 
                          {record.landDetails?.khataNumber?.value && ` (Khata ${record.landDetails.khataNumber.value})`}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {record.landDetails?.village?.value ? (
                        <span>{record.landDetails.village.value}, {record.landDetails?.tehsil?.value}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {record.landDetails?.district?.value || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>
                      <StatusBadge status={record.status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleQuickCompare(record)}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          title="Compare with another document"
                        >
                          <GitCompare size={13} /> Compare
                        </button>
                        <Link
                          to={`/records/${record._id}`}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                        >
                          <Eye size={14} /> {user?.role === 'Citizen' ? 'View Details' : 'Open Review'}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Side-by-Side Document Comparison Modal */}
      <DocumentComparisonModal
        isOpen={isCompareModalOpen}
        onClose={() => setIsCompareModalOpen(false)}
        initialDocA={compareDocA}
        initialDocB={compareDocB}
        availableDocuments={records}
      />
    </div>
  );
}
