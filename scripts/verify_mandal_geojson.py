#!/usr/bin/env python3
"""
Verification script for downloaded Telangana Mandal boundaries GeoJSON.
"""
import json
import os
import sys

def verify():
    geojson_path = os.path.join("server", "data", "telangana_mandal_boundaries.geojson")
    meta_path = os.path.join("server", "data", "telangana_mandal_boundaries_metadata.json")

    print("Verifying GeoJSON file exists:", os.path.exists(geojson_path))
    print("Verifying Metadata file exists:", os.path.exists(meta_path))

    with open(geojson_path, "r", encoding="utf-8") as f:
        fc = json.load(f)

    # 1. FeatureCollection structure
    assert fc.get("type") == "FeatureCollection", f"Invalid root type: {fc.get('type')}"
    features = fc.get("features", [])
    print(f"Total features in FeatureCollection: {len(features)}")
    assert len(features) == 621, f"Expected 621 features, got {len(features)}"

    # 2. Polygon/MultiPolygon geometry & Closed rings & Lon/Lat ranges
    req_attrs = ["OBJECTID", "District", "Mandal", "Village", "Mandal_Type", "Area"]
    all_oids = set()
    polygon_count = 0
    multipolygon_count = 0
    unclosed_rings = 0
    invalid_coords = 0

    min_lon, max_lon = 180.0, -180.0
    min_lat, max_lat = 90.0, -90.0

    for f in features:
        assert f.get("type") == "Feature", f"Invalid feature type: {f.get('type')}"
        geom = f.get("geometry")
        props = f.get("properties", {})

        # Check required attributes
        for ra in req_attrs:
            assert ra in props, f"Missing required attribute {ra} in OID {props.get('OBJECTID')}"

        oid = props["OBJECTID"]
        all_oids.add(oid)

        gtype = geom.get("type")
        coords = geom.get("coordinates", [])
        if gtype == "Polygon":
            polygon_count += 1
            polys = [coords]
        elif gtype == "MultiPolygon":
            multipolygon_count += 1
            polys = coords
        else:
            raise AssertionError(f"Unexpected geometry type {gtype} in OID {oid}")

        for poly in polys:
            for ring in poly:
                assert len(ring) >= 4, f"Degenerate ring with len {len(ring)} in OID {oid}"
                if ring[0] != ring[-1]:
                    unclosed_rings += 1
                for pt in ring:
                    lon, lat = pt[0], pt[1]
                    min_lon = min(min_lon, lon)
                    max_lon = max(max_lon, lon)
                    min_lat = min(min_lat, lat)
                    max_lat = max(max_lat, lat)
                    if not (76.0 <= lon <= 83.0 and 14.5 <= lat <= 21.0):
                        invalid_coords += 1

    print(f"Geometry counts: {polygon_count} Polygons, {multipolygon_count} MultiPolygons")
    print(f"Unclosed rings: {unclosed_rings}")
    print(f"Out of bounds coordinates: {invalid_coords}")
    print(f"Coordinate bounds: Lon [{min_lon:.4f}, {max_lon:.4f}], Lat [{min_lat:.4f}, {max_lat:.4f}]")
    print(f"Unique Object IDs count: {len(all_oids)} (min={min(all_oids)}, max={max(all_oids)})")

    assert unclosed_rings == 0, f"Found {unclosed_rings} unclosed rings"
    assert invalid_coords == 0, f"Found {invalid_coords} invalid coordinates"
    assert len(all_oids) == 621, f"Expected 621 unique Object IDs, got {len(all_oids)}"

    # 3. Check metadata
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    print("Metadata loaded successfully.")
    print(f"Metadata downloaded features: {meta['successfully_downloaded_features']}/{meta['total_object_ids_in_service']}")
    print(f"Metadata disclaimer present: {'boundary_type_disclaimer' in meta}")
    print(f"Metadata licensing notice present: {'licensing_notice' in meta}")

    # 4. Check CRS metadata
    source_sr = meta.get("source_spatial_reference")
    output_crs = meta.get("coordinate_reference_system")
    assert isinstance(source_sr, dict), f"source_spatial_reference must be a JSON object, got {type(source_sr)}"
    assert source_sr.get("wkid") == 32644 or source_sr.get("latestWkid") == 32644, (
        f"Expected source spatial reference WKID 32644, got {source_sr}"
    )
    assert output_crs == "EPSG:4326 (WGS84)", f"Expected output CRS 'EPSG:4326 (WGS84)', got '{output_crs}'"
    print(f"Source Spatial Reference verified: {source_sr} (EPSG:32644)")
    print(f"Output Coordinate Reference System verified: {output_crs}")
    print("Verification result: ALL TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    verify()
