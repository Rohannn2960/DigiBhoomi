import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPinOff } from 'lucide-react';

/**
 * Validates whether a GeoJSON object has a non-empty Polygon or MultiPolygon geometry.
 */
function isValidBoundaryFeature(feature) {
  if (!feature || typeof feature !== 'object') return false;
  const geom = feature.geometry;
  if (!geom || typeof geom !== 'object') return false;
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return false;
  if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) return false;
  return true;
}

/**
 * GisBoundaryMap
 * Reusable Leaflet map component rendering official administrative boundary polygons.
 *
 * Requirements:
 * - Uses vanilla Leaflet directly (compatible with React 19).
 * - Accepts GeoJSON boundary Feature as prop.
 * - Automatically fits bounds to polygon with sensible padding.
 * - Proper OpenStreetMap attribution and usage compliance.
 * - Safe against React StrictMode and unmount race conditions.
 * - Avoids full map re-initialization when only the boundary changes.
 * - Handles null or invalid geometry gracefully with an informative placeholder.
 */
export default function GisBoundaryMap({ boundary, height = '340px' }) {
  const containerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const geoJsonLayerRef = useRef(null);

  const hasValidGeometry = isValidBoundaryFeature(boundary);

  // Initialize Leaflet map instance once when container mounts
  useEffect(() => {
    if (!containerRef.current || !hasValidGeometry) return;

    // Prevent duplicate initialization on StrictMode remounts
    if (mapInstanceRef.current) return;

    // Initialize map
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false // Prevent accidental scrolling capture on document review page
    });
    mapInstanceRef.current = map;

    // OpenStreetMap standard tile provider with required attribution
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Invalidate size once layout stabilizes
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        geoJsonLayerRef.current = null;
      }
    };
  }, [hasValidGeometry]); // Only re-run if geometry validity status changes

  // Update GeoJSON layer without destroying map instance when boundary prop changes
  useEffect(() => {
    if (!mapInstanceRef.current || !hasValidGeometry) return;

    // Remove existing boundary layer
    if (geoJsonLayerRef.current) {
      mapInstanceRef.current.removeLayer(geoJsonLayerRef.current);
      geoJsonLayerRef.current = null;
    }

    // Add updated boundary layer
    const geoJsonLayer = L.geoJSON(boundary, {
      style: {
        color: '#0f766e',
        weight: 2.5,
        opacity: 0.9,
        fillColor: '#0f766e',
        fillOpacity: 0.22
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const mandal = props.mandal || 'Mandal';
        const district = props.district || '';
        const mandalType = props.mandalType || '';
        const revenueDivision = props.revenueDivision || '';

        layer.bindTooltip(
          `<div style="font-family: inherit; font-size: 12px; line-height: 1.4;">
            <strong>${mandal}</strong><br/>
            <span>District: ${district}</span><br/>
            <span>Type: ${mandalType}</span>
            ${revenueDivision ? `<br/><span>Division: ${revenueDivision}</span>` : ''}
          </div>`,
          { sticky: true }
        );
      }
    }).addTo(mapInstanceRef.current);
    geoJsonLayerRef.current = geoJsonLayer;

    const bounds = geoJsonLayer.getBounds();
    if (bounds.isValid()) {
      mapInstanceRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    }
  }, [boundary, hasValidGeometry]);

  // Graceful empty state placeholder when boundary is missing or geometry is unavailable
  if (!hasValidGeometry) {
    return (
      <div
        style={{
          height,
          minHeight: '260px',
          background: '#f8fafc',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)'
        }}
      >
        <MapPinOff size={36} color="#94a3b8" />
        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '0.6rem', fontSize: '0.92rem' }}>
          No Boundary Polygon Available
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '340px', marginTop: '0.25rem' }}>
          Administrative mandal boundary geometry is displayed only when an official compound match is confirmed.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        height,
        minHeight: '260px',
        width: '100%',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)'
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
