import React from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

/**
 * Maps discrepancy severity to visual styling tokens adhering to DigiBhoomi index.css conventions.
 */
function getSeverityTokens(severity = 'WARNING') {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      return {
        bg: '#fef2f2',
        border: '#fecaca',
        text: '#991b1b',
        badgeBg: '#fee2e2',
        badgeText: '#b91c1c',
        icon: AlertCircle,
        label: 'Critical'
      };
    case 'INFO':
      return {
        bg: '#f0f9ff',
        border: '#bae6fd',
        text: '#0369a1',
        badgeBg: '#e0f2fe',
        badgeText: '#0284c7',
        icon: Info,
        label: 'Info'
      };
    case 'WARNING':
    default:
      return {
        bg: '#fffbeb',
        border: '#fde68a',
        text: '#92400e',
        badgeBg: '#fef3c7',
        badgeText: '#b45309',
        icon: AlertTriangle,
        label: 'Warning'
      };
  }
}

/**
 * Formats field identifier into a human-readable title.
 */
function formatFieldLabel(field = '') {
  if (!field) return 'Administrative Field';
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * GisDiscrepancyList
 * Reusable component presenting administrative GIS discrepancies with severity styling.
 *
 * Requirements:
 * - Accepts discrepancies array as prop.
 * - Displays field name, document extracted value, verified GIS value, severity badge, and explanatory message.
 * - Visually distinguishes CRITICAL, WARNING, and INFO.
 * - Handles empty array and null/undefined values gracefully without inventing data.
 */
export default function GisDiscrepancyList({ discrepancies = [] }) {
  if (!Array.isArray(discrepancies) || discrepancies.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          color: '#15803d',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius)',
          fontSize: '0.85rem',
          fontWeight: 500
        }}
      >
        <CheckCircle2 size={16} />
        <span>No administrative jurisdiction discrepancies detected.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {discrepancies.map((disc, idx) => {
        const tokens = getSeverityTokens(disc.severity);
        const IconComponent = tokens.icon;
        const fieldName = formatFieldLabel(disc.field);
        const hasDocVal = typeof disc.documentValue === 'string' && disc.documentValue.trim().length > 0;
        const hasGisVal = typeof disc.gisValue === 'string' && disc.gisValue.trim().length > 0;

        return (
          <div
            key={idx}
            style={{
              background: tokens.bg,
              border: `1px solid ${tokens.border}`,
              borderRadius: 'var(--radius)',
              padding: '0.85rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              fontSize: '0.85rem'
            }}
          >
            {/* Header: Icon, Field, Severity Badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: tokens.text }}>
                <IconComponent size={16} />
                <span>{fieldName}</span>
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  background: tokens.badgeBg,
                  color: tokens.badgeText,
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px'
                }}
              >
                {tokens.label}
              </span>
            </div>

            {/* Explanatory Message */}
            <div style={{ color: tokens.text, lineHeight: 1.45 }}>
              {disc.message}
            </div>

            {/* Contextual Values Comparison (only rendered if at least one value is present) */}
            {(hasDocVal || hasGisVal) && (
              <div
                style={{
                  display: 'flex',
                  gap: '1.25rem',
                  marginTop: '0.2rem',
                  fontSize: '0.78rem',
                  color: tokens.text,
                  opacity: 0.9,
                  flexWrap: 'wrap'
                }}
              >
                {hasDocVal && (
                  <div>
                    <span style={{ fontWeight: 600 }}>Document value:</span>{' '}
                    <code style={{ background: 'rgba(0,0,0,0.05)', padding: '1px 4px', borderRadius: '3px' }}>
                      {disc.documentValue}
                    </code>
                  </div>
                )}
                {hasGisVal && (
                  <div>
                    <span style={{ fontWeight: 600 }}>GIS value:</span>{' '}
                    <code style={{ background: 'rgba(0,0,0,0.05)', padding: '1px 4px', borderRadius: '3px' }}>
                      {disc.gisValue}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
