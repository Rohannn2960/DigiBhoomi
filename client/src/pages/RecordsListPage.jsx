import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from '../components/StatusBadge';
import { fetchDocuments } from '../services/api';
import { Upload, Eye, FileText, Search, X, Loader, AlertCircle, RefreshCw } from 'lucide-react';

export default function RecordsListPage() {
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

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
          <h1 className="page-title">Land Records Repository</h1>
          <p className="page-description">
            Digitized Jamabandi, Khasra, Khatauni, and 7/12 records stored in MongoDB.
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
          <Link to="/upload" className="btn btn-primary">
            <Upload size={16} /> Upload New Record
          </Link>
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
          <Link to="/upload" className="btn btn-primary">
            <Upload size={16} /> Upload First Document
          </Link>
        </div>
      ) : (
        /* Table of Real Documents */
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
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
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No matching records found for "{searchQuery}".
                  </td>
                </tr>
              ) : (
                filteredRecords.map(record => (
                  <tr key={record._id}>
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
                      <Link 
                        to={`/records/${record._id}`} 
                        className="btn btn-secondary" 
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        <Eye size={14} /> Review
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
