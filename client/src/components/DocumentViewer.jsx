import React, { useState } from 'react';
import { FileText, Image as ImageIcon, ZoomIn, ZoomOut, AlertCircle } from 'lucide-react';

export default function DocumentViewer({ fileMetadata }) {
  const [zoom, setZoom] = useState(100);

  if (!fileMetadata || !fileMetadata.previewUrl) {
    return (
      <div style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>
        <FileText size={48} style={{ margin: '0 auto 1rem', display: 'block', opacity: 0.5 }} />
        <p>No document preview available</p>
      </div>
    );
  }

  const isPdf = fileMetadata.mimeType === 'application/pdf' || 
                fileMetadata.originalFilename.toLowerCase().endsWith('.pdf');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Zoom / Info Bar */}
      <div className="preview-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
          {isPdf ? <FileText size={16} color="var(--primary)" /> : <ImageIcon size={16} color="var(--primary)" />}
          <strong style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileMetadata.originalFilename}
          </strong>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            ({(fileMetadata.sizeBytes / 1024).toFixed(1)} KB)
          </span>
        </div>

        {!isPdf && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button 
              className="btn btn-secondary" 
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => setZoom(prev => Math.max(prev - 25, 50))}
            >
              <ZoomOut size={14} />
            </button>
            <span style={{ fontSize: '0.75rem', minWidth: '40px', textAlign: 'center' }}>{zoom}%</span>
            <button 
              className="btn btn-secondary" 
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
              onClick={() => setZoom(prev => Math.min(prev + 25, 200))}
            >
              <ZoomIn size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Actual Viewer Body */}
      <div className="preview-viewer">
        {isPdf ? (
          <iframe 
            src={fileMetadata.previewUrl} 
            title="PDF Document Preview"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img 
              src={fileMetadata.previewUrl} 
              alt="Land Record Preview"
              style={{ 
                width: `${zoom}%`, 
                maxHeight: zoom <= 100 ? '100%' : 'none',
                objectFit: 'contain', 
                transition: 'width 0.15s ease' 
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
