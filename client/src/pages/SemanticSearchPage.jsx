import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Sparkles,
  ExternalLink,
  Loader,
  AlertCircle,
  Database,
  RefreshCw,
  Info,
  MapPin,
  User,
  CheckCircle2,
  ShieldCheck,
  Building
} from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import {
  searchSemanticRecords,
  fetchSearchIndexStatus,
  triggerBackfillIndex
} from '../services/searchApi';
import { useAuth } from '../context/auth-context';

const SUGGESTED_QUERIES = [
  'Find land records belonging to Ramesh in Rangareddy',
  'రమేష్ కుమార్ రంగారెడ్డి (Ramesh Kumar in Telugu)',
  'Show agricultural properties in Shamshabad village',
  'వ్యవసాయ భూమి శంషాబాద్ (Agricultural land in Telugu)',
  'कृषि भूमि शामशाबाद (Agricultural land in Hindi)',
  'Find records related to residential plots in Hyderabad'
];

export default function SemanticSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [indexStatus, setIndexStatus] = useState(null);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState(null);

  const { user } = useAuth();

  const loadIndexStatus = async () => {
    try {
      const data = await fetchSearchIndexStatus();
      setIndexStatus(data);
    } catch (err) {
      console.warn('[Semantic Search] Could not load index status:', err.message);
    }
  };

  useEffect(() => {
    loadIndexStatus();
  }, []);

  const handleSearch = async (searchQuery = query) => {
    const q = searchQuery.trim();
    if (!q) {
      setError('Please enter a natural-language search query.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setBackfillMessage(null);

    try {
      const data = await searchSemanticRecords({
        query: q,
        limit: 10
      });

      setResults(data.results || []);
      setHasSearched(true);
    } catch (err) {
      setError(err.message || 'Semantic search failed. Please try again.');
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    handleSearch();
  };

  const handleChipClick = (suggestion) => {
    setQuery(suggestion);
    handleSearch(suggestion);
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    setError(null);
    setBackfillMessage(null);
    try {
      const res = await triggerBackfillIndex({
        force: false
      });
      const s = res.summary || {};
      setBackfillMessage(`Backfill complete: ${s.indexedCount || 0} indexed, ${s.skippedUnchangedCount || 0} unchanged, ${s.failedCount || 0} failed, ${s.totalDocuments || 0} total.`);
      await loadIndexStatus();
      if (query.trim()) {
        await handleSearch();
      }
    } catch (err) {
      setError(err.message || 'Backfill indexing failed.');
    } finally {
      setIsBackfilling(false);
    }
  };

  const formatRelevance = (score) => {
    if (typeof score !== 'number') return '0%';
    return `${(score * 100).toFixed(1)}%`;
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.25rem' }}>
            <h1 className="page-title">Semantic Land Record Search</h1>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'var(--primary-light)',
                color: 'var(--primary)',
                padding: '2px 8px',
                borderRadius: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              Vector AI
            </span>
          </div>
          <p className="page-description">
            Search land records across English, Telugu, and Hindi using multilingual semantic vector search.
            Powered locally by multilingual-e5-base (768 dimensions).
          </p>
        </div>

        {/* Index Status & Backfill Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div
            style={{
              fontSize: '0.82rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'white',
              padding: '0.4rem 0.75rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)'
            }}
          >
            <Database size={15} style={{ color: 'var(--primary)' }} />
            <span>Indexed Records: <strong>{indexStatus?.totalIndexed ?? '...'}</strong></span>
            {indexStatus?.dimensions && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                ({indexStatus.dimensions}d)
              </span>
            )}
            {indexStatus?.needsMigration && (
              <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#b45309', padding: '1px 6px', borderRadius: '4px', marginLeft: '6px' }}>
                {indexStatus.totalLegacy} legacy
              </span>
            )}
          </div>

          {user?.role === 'Admin' && (
            <button
              onClick={handleBackfill}
              disabled={isBackfilling}
              className="btn btn-secondary"
              title="Index all existing MongoDB documents"
              style={{ fontSize: '0.82rem' }}
            >
              <RefreshCw size={14} className={isBackfilling ? 'spin' : ''} />
              {isBackfilling ? 'Indexing...' : 'Index Records'}
            </button>
          )}
        </div>
      </div>

      {/* Authenticated Identity & Permissions Info */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '0.75rem 1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          fontSize: '0.85rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldCheck size={16} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Authenticated as:</span>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
            {user?.displayName || 'User'}
          </span>
          <span style={{ fontSize: '0.75rem', background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
            {user?.role || 'Citizen'}
          </span>
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          {user?.role === 'Admin'
            ? 'Administrator: Full global visibility across all land records.'
            : user?.role === 'Officer'
              ? 'Revenue Officer: Authorized to search assigned land records.'
              : 'Citizen: Authorized to search your own land records.'}
        </div>
      </div>

      {/* Backfill Message Banner */}
      {backfillMessage && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.88rem'
          }}
        >
          <CheckCircle2 size={18} />
          <span>{backfillMessage}</span>
        </div>
      )}

      {/* Search Input Box */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <form onSubmit={handleFormSubmit}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)'
                }}
              />
              <input
                type="text"
                className="field-input"
                placeholder="Ask in natural language (e.g. 'Show agricultural land owned by Ramesh in Rangareddy')..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  paddingLeft: '2.5rem',
                  fontSize: '1rem',
                  height: '46px',
                  borderRadius: 'var(--radius)'
                }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading || !query.trim()}
              style={{ height: '46px', padding: '0 1.5rem', fontSize: '0.95rem' }}
            >
              {isLoading ? (
                <>
                  <Loader size={18} className="spin" /> Searching...
                </>
              ) : (
                <>
                  <Sparkles size={18} /> Search Records
                </>
              )}
            </button>
          </div>
        </form>

        {/* Query Suggestion Chips */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 500 }}>
            TRY ASKING:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {SUGGESTED_QUERIES.map((suggestion, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleChipClick(suggestion)}
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)',
                  fontSize: '0.8rem',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.background = 'var(--primary-light)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.background = 'var(--bg-main)';
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
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
            <span><strong>Search Error:</strong> {error}</span>
          </div>
          <button
            onClick={() => handleSearch()}
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div
          className="card"
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem'
          }}
        >
          <Loader size={36} className="spin" style={{ color: 'var(--primary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.25rem' }}>
              Searching Semantic Vector Space...
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Computing vector embeddings and cosine similarity against indexed land records.
            </div>
          </div>
        </div>
      )}

      {/* Results List */}
      {!isLoading && hasSearched && results.length > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem'
            }}
          >
            <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
              Found <strong>{results.length}</strong> contextually relevant land record{results.length > 1 ? 's' : ''}
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Info size={14} />
              <span>Ranked by vector cosine similarity</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {results.map((rec) => {
              const details = rec.landDetails || {};
              const scorePct = formatRelevance(rec.relevanceScore);

              return (
                <div key={rec.documentId} className="card" style={{ padding: '1.5rem' }}>
                  {/* Result Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      marginBottom: '1rem',
                      gap: '1rem'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: '1.15rem', margin: 0 }}>
                          {details.ownerName || rec.filename}
                        </h3>
                        <StatusBadge status={rec.status} />
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        File: <code>{rec.filename}</code>
                      </div>
                    </div>

                    {/* Relevance Score Badge */}
                    <div
                      style={{
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: '2px'
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          fontWeight: 600
                        }}
                      >
                        Relevance score
                      </div>
                      <div
                        style={{
                          fontSize: '1.25rem',
                          fontWeight: 700,
                          color: rec.relevanceScore >= 0.55 ? 'var(--primary)' : 'var(--text-main)',
                          background: rec.relevanceScore >= 0.55 ? 'var(--primary-light)' : '#f1f5f9',
                          padding: '2px 10px',
                          borderRadius: '16px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Sparkles size={14} />
                        {scorePct}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        ({rec.relevanceScore.toFixed(4)})
                      </div>
                    </div>
                  </div>

                  {/* Match Explanation Highlight Box */}
                  {rec.matchExplanation && (
                    <div
                      style={{
                        background: '#f0fdf4',
                        borderLeft: '4px solid var(--primary)',
                        padding: '0.65rem 0.9rem',
                        borderRadius: '0 6px 6px 0',
                        marginBottom: '1.2rem',
                        fontSize: '0.86rem',
                        color: '#166534',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '8px'
                      }}
                    >
                      <div>
                        <strong>Why it matched:</strong> {rec.matchExplanation}
                      </div>

                      {/* Matched Fields Tags */}
                      {rec.matchedFields && rec.matchedFields.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {rec.matchedFields.map((field) => (
                            <span
                              key={field}
                              style={{
                                background: '#dcfce7',
                                color: '#15803d',
                                fontSize: '0.72rem',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 500
                              }}
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Key Land Details Grid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '0.75rem',
                      background: 'var(--bg-main)',
                      padding: '0.85rem',
                      borderRadius: 'var(--radius)',
                      marginBottom: '1rem',
                      fontSize: '0.85rem'
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>
                        Owner Name
                      </span>
                      <strong>{details.ownerName || '—'}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>
                        Survey / Khasra No.
                      </span>
                      <strong>
                        {details.surveyNumber || details.khasraNumber
                          ? `${details.surveyNumber || ''} ${details.khasraNumber ? `(Khasra: ${details.khasraNumber})` : ''}`
                          : '—'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>
                        Location (Village / Tehsil / District)
                      </span>
                      <strong>
                        {[details.village, details.tehsil, details.district].filter(Boolean).join(', ') || '—'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>
                        Land Classification & Area
                      </span>
                      <strong>
                        {[details.landClassification, details.landArea].filter(Boolean).join(' • ') || '—'}
                      </strong>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderTop: '1px solid var(--border)',
                      paddingTop: '0.75rem',
                      fontSize: '0.82rem'
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>
                      Khata: <strong>{details.khataNumber || '—'}</strong>
                    </span>

                    <Link
                      to={`/records/${rec.documentId}`}
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem' }}
                    >
                      <span>Open in Review & Verification</span>
                      <ExternalLink size={14} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Technical Note / Disclaimer */}
          <div
            style={{
              marginTop: '2rem',
              padding: '1rem',
              borderRadius: 'var(--radius)',
              background: '#f8fafc',
              border: '1px solid var(--border)',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start'
            }}
          >
            <Info size={16} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--text-muted)' }} />
            <div>
              <strong>Relevance Ranking Disclaimer:</strong> Relevance scores reflect mathematical vector cosine similarity between the query and synthesized land record representations. Numerical constraints (such as land parcel acreage or legal boundary distances) are ranked by semantic proximity and must be independently verified by revenue officers against physical cadastre maps.
            </div>
          </div>
        </div>
      )}

      {/* Empty Results State */}
      {!isLoading && hasSearched && results.length === 0 && (
        <div
          className="card"
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem'
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              background: '#f1f5f9',
              color: 'var(--text-muted)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Search size={28} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No Contextually Similar Records Found</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '500px', margin: '0 auto' }}>
              We could not find any indexed land records matching "{query}".
              Try searching with village names, owner names, or general descriptions like "agricultural land in Rangareddy".
            </p>
          </div>
          {(indexStatus?.totalIndexed === 0) && (
            <div style={{ marginTop: '0.5rem' }}>
              <button onClick={handleBackfill} className="btn btn-primary" disabled={isBackfilling}>
                <RefreshCw size={16} className={isBackfilling ? 'spin' : ''} />
                Index Existing Documents Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* Initial Landing State */}
      {!isLoading && !hasSearched && (
        <div
          className="card"
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            background: 'linear-gradient(to bottom, #ffffff, #f8fafc)'
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem'
            }}
          >
            <Sparkles size={28} />
          </div>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>
            Natural Language Land Record Retrieval
          </h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '540px', margin: '0 auto 1.5rem', fontSize: '0.9rem' }}>
            DigiBhoomi Semantic Search maps land governance concepts across English and vernacular transliterations.
            Click any query prompt above or type your own question to begin.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
              maxWidth: '800px',
              margin: '0 auto',
              textAlign: 'left',
              fontSize: '0.85rem'
            }}
          >
            <div style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={15} style={{ color: 'var(--primary)' }} /> Owner & Holding
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Finds records even if spelling variations exist in name or transliteration.
              </div>
            </div>

            <div style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MapPin size={15} style={{ color: 'var(--primary)' }} /> Cadastral Location
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Understands hierarchical administrative divisions: Village, Tehsil, and District.
              </div>
            </div>

            <div style={{ background: 'white', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Building size={15} style={{ color: 'var(--primary)' }} /> Land Use Type
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Differentiates agricultural, residential, wet land, and commercial classifications.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
