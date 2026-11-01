import React from 'react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[DigiBhoomi ErrorBoundary caught]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/records';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: '600px', margin: '3rem auto', padding: '1rem' }}>
          <div className="card" style={{ borderLeft: '4px solid #dc2626', padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', marginBottom: '0.75rem' }}>
              <AlertCircle size={22} />
              <strong style={{ fontSize: '1.15rem' }}>An error occurred while loading this view</strong>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              {this.state.error?.message || 'Unexpected application error.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={this.handleReset} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>
                <ArrowLeft size={16} /> Return to Records
              </button>
              <button
                onClick={() => window.location.reload()}
                className="btn btn-secondary"
                style={{ fontSize: '0.85rem' }}
              >
                <RefreshCw size={14} /> Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
