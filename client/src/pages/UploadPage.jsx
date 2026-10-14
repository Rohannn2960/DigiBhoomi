import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { uploadDocument } from '../services/api';
import { UploadCloud, File, AlertCircle, CheckCircle, ArrowLeft, Loader, ArrowRight } from 'lucide-react';

export default function UploadPage() {
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState(null);
  const [error, setError] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(null);

  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit

  const handleFileChange = (e) => {
    setError(null);
    setUploadSuccess(null);
    const file = e.target.files[0];
    if (!file) return;

    // Check MIME type or file extension
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const isAllowedExt = ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext);

    if (!allowedTypes.includes(file.type) && !isAllowedExt) {
      setError('Invalid file type. Only PDF, PNG, JPG, and JPEG documents are permitted.');
      setSelectedFile(null);
      return;
    }

    if (file.size > maxSizeBytes) {
      setError('File size exceeds the 10 MB limit.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a file to upload first.');
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const createdRecord = await uploadDocument(selectedFile);
      setUploadSuccess(createdRecord);
      setSelectedFile(null);
    } catch (err) {
      setError(err.message || 'Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px', margin: '2rem auto 0 auto' }}>
      <button 
        onClick={() => navigate('/records')} 
        className="btn btn-secondary" 
        style={{ marginBottom: '1.25rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
      >
        <ArrowLeft size={16} /> Back to Records
      </button>

      <div className="card">
        <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem' }}>Upload Land Record Document</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          Upload scanned legacy deeds, Jamabandi, Khasra-Khatauni, or 7/12 extracts for digitization and validation.
        </p>

        {/* Success Banner */}
        {uploadSuccess && (
          <div 
            style={{ 
              background: '#f0fdf4', 
              border: '1px solid #bbf7d0', 
              color: '#166534', 
              padding: '1.25rem', 
              borderRadius: 'var(--radius)', 
              marginBottom: '1.5rem' 
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
              <CheckCircle size={20} color="#16a34a" />
              <strong style={{ fontSize: '1rem' }}>Document Uploaded Successfully!</strong>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: '1.6', marginBottom: '1rem' }}>
              <div><strong>Original Name:</strong> {uploadSuccess.fileMetadata?.originalFilename}</div>
              <div><strong>Record ID:</strong> <code>{uploadSuccess._id}</code></div>
              <div>
                <strong>SHA-256 Hash:</strong>{' '}
                <code style={{ fontSize: '0.78rem' }}>
                  {uploadSuccess.fileMetadata?.sha256Hash}
                </code>
              </div>
              <div><strong>Initial Status:</strong> <span className="badge badge-uploaded">Uploaded</span></div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Link to={`/records/${uploadSuccess._id}`} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>
                Review Document <ArrowRight size={14} />
              </Link>
              <button 
                onClick={() => setUploadSuccess(null)} 
                className="btn btn-secondary" 
                style={{ fontSize: '0.85rem' }}
              >
                Upload Another
              </button>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div 
            style={{ 
              background: '#fee2e2', 
              border: '1px solid #fecaca',
              color: '#991b1b', 
              padding: '0.75rem 1rem', 
              borderRadius: 'var(--radius)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              marginBottom: '1.25rem',
              fontSize: '0.85rem'
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {!uploadSuccess && (
          <form onSubmit={handleUploadSubmit}>
            <div 
              style={{ 
                border: '2px dashed var(--border)', 
                borderRadius: 'var(--radius)', 
                padding: '2.5rem 1.5rem', 
                textAlign: 'center',
                backgroundColor: '#f8fafc',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                marginBottom: '1.5rem',
                opacity: isUploading ? 0.6 : 1
              }}
              onClick={() => !isUploading && document.getElementById('file-upload-input').click()}
            >
              <input 
                id="file-upload-input" 
                type="file" 
                accept=".pdf,.png,.jpg,.jpeg" 
                style={{ display: 'none' }} 
                onChange={handleFileChange}
                disabled={isUploading}
              />

              <UploadCloud size={44} color="var(--primary)" style={{ margin: '0 auto 0.75rem', display: 'block' }} />
              <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.25rem' }}>
                {selectedFile ? 'Change selected file' : 'Click to select document'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Supports PDF, PNG, JPG/JPEG (Max size: 10MB)
              </div>
            </div>

            {/* Staged file display without falsely claiming it is uploaded yet */}
            {selectedFile && (
              <div 
                style={{ 
                  background: '#f8fafc', 
                  border: '1px solid var(--border)', 
                  padding: '0.85rem 1rem', 
                  borderRadius: 'var(--radius)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  marginBottom: '1.5rem',
                  fontSize: '0.85rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <File size={18} color="var(--primary)" />
                  <div>
                    <div style={{ fontWeight: 600 }}>{selectedFile.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB • Staged locally
                    </div>
                  </div>
                </div>

                <span className="badge badge-uploaded" style={{ fontSize: '0.72rem' }}>
                  Ready to Upload
                </span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button 
                type="button" 
                onClick={() => setSelectedFile(null)} 
                className="btn btn-secondary"
                disabled={isUploading || !selectedFile}
              >
                Clear
              </button>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={isUploading || !selectedFile}
              >
                {isUploading ? (
                  <>
                    <Loader size={16} className="spin" /> Uploading & Calculating Hash...
                  </>
                ) : (
                  'Upload to Server'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
