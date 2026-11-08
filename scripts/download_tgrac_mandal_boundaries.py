#!/usr/bin/env python3
"""
TGRAC Telangana Mandal Boundaries Downloader & Converter
========================================================

Downloads Mandal Boundary features (Layer 26) from the Telangana Remote
Sensing Applications Centre (TGRAC) ArcGIS REST MapServer service:
https://tgrac.telangana.gov.in/arcgis/rest/services/AdministrativeInfoSystem_Folder/Administrative_Information_System/MapServer/26

Workflow:
1. Retrieve all Object IDs using `returnIdsOnly=true`.
2. Check if native GeoJSON (`f=geojson`) is supported; if not, download Esri JSON (`f=json`).
3. Download features in batches of 50 using `objectIds` and `outSR=4326`.
4. Convert Esri polygon rings to standard GeoJSON Polygon / MultiPolygon geometries,
   correctly preserving polygon holes and multipart geometries using topological containment.
5. Preserve essential administrative attributes (OBJECTID, District, Mandal, Village, Mandal_Type, Area, etc.).
6. Validate geometry rings, coordinate ranges, and completeness against initial Object IDs.
7. Save the GeoJSON FeatureCollection to `server/data/telangana_mandal_boundaries.geojson`.
8. Save metadata to `server/data/telangana_mandal_boundaries_metadata.json`.

Disclaimer:
These boundaries represent administrative Mandal units from TGRAC.
They are NOT cadastral land parcel boundaries and must not be used for
property boundary verification or legal land title determinations.
"""

import argparse
import datetime
import hashlib
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.validation import make_valid

# --- Constants & Defaults ---
DEFAULT_LAYER_URL = (
    "https://tgrac.telangana.gov.in/arcgis/rest/services/"
    "AdministrativeInfoSystem_Folder/Administrative_Information_System/MapServer/26"
)
DEFAULT_OUTPUT_GEOJSON = os.path.join("server", "data", "telangana_mandal_boundaries.geojson")
DEFAULT_OUTPUT_METADATA = os.path.join("server", "data", "telangana_mandal_boundaries_metadata.json")
DEFAULT_BATCH_SIZE = 50
DEFAULT_TIMEOUT = 30
DEFAULT_MAX_RETRIES = 3

REQUIRED_ATTRIBUTES = [
    "OBJECTID",
    "District",
    "Mandal",
    "Village",
    "Mandal_Type",
    "Area",
]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and convert Telangana Mandal boundary polygons from TGRAC ArcGIS REST service."
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_LAYER_URL,
        help=f"ArcGIS Layer URL (default: {DEFAULT_LAYER_URL})",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_GEOJSON,
        help=f"Output GeoJSON file path (default: {DEFAULT_OUTPUT_GEOJSON})",
    )
    parser.add_argument(
        "--metadata",
        default=DEFAULT_OUTPUT_METADATA,
        help=f"Output metadata JSON path (default: {DEFAULT_OUTPUT_METADATA})",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"Batch size for querying features (default: {DEFAULT_BATCH_SIZE})",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=f"HTTP request timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_MAX_RETRIES,
        help=f"Maximum HTTP retry attempts per batch (default: {DEFAULT_MAX_RETRIES})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing output files without prompting or confirmation",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Disable SSL certificate verification (not recommended unless CA issues occur)",
    )
    return parser.parse_args()


def fetch_layer_metadata(
    session: requests.Session, layer_url: str, timeout: int, verify: bool
) -> Dict[str, Any]:
    """Retrieve layer metadata and attribute field definitions."""
    url = f"{layer_url}?f=json"
    response = session.get(url, timeout=timeout, verify=verify)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise RuntimeError(f"ArcGIS service returned error: {data['error']}")
    return data


def extract_source_spatial_reference(layer_meta: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract the source spatial reference from ArcGIS layer metadata.

    ArcGIS REST MapServer layers may define spatial reference at:
    1. layer_meta['spatialReference']
    2. layer_meta['sourceSpatialReference']
    3. layer_meta['extent']['spatialReference'] (standard fallback when layer spatialReference is null)
    4. layer_meta['fullExtent']['spatialReference'] or layer_meta['initialExtent']['spatialReference']
    """
    if not isinstance(layer_meta, dict):
        return {}

    candidates = [
        layer_meta.get("spatialReference"),
        layer_meta.get("sourceSpatialReference"),
        layer_meta.get("extent", {}).get("spatialReference") if isinstance(layer_meta.get("extent"), dict) else None,
        layer_meta.get("fullExtent", {}).get("spatialReference") if isinstance(layer_meta.get("fullExtent"), dict) else None,
        layer_meta.get("initialExtent", {}).get("spatialReference") if isinstance(layer_meta.get("initialExtent"), dict) else None,
    ]

    for candidate in candidates:
        if isinstance(candidate, dict) and (
            candidate.get("wkid") is not None
            or candidate.get("latestWkid") is not None
            or candidate.get("wkt") is not None
        ):
            return candidate

    return {}


def check_native_geojson_support(
    session: requests.Session, layer_url: str, test_oid: int, timeout: int, verify: bool
) -> bool:
    """Test if the service supports native f=geojson output."""
    query_url = f"{layer_url}/query"
    params = {
        "objectIds": str(test_oid),
        "outSR": "4326",
        "returnGeometry": "true",
        "f": "geojson",
    }
    try:
        response = session.get(query_url, params=params, timeout=timeout, verify=verify)
        if response.status_code == 200:
            data = response.json()
            if data.get("type") == "FeatureCollection" and data.get("features"):
                return True
    except Exception:
        pass
    return False


def fetch_all_object_ids(
    session: requests.Session, layer_url: str, timeout: int, verify: bool
) -> List[int]:
    """Retrieve all Object IDs using returnIdsOnly=true."""
    query_url = f"{layer_url}/query"
    params = {
        "where": "1=1",
        "returnIdsOnly": "true",
        "f": "json",
    }
    response = session.get(query_url, params=params, timeout=timeout, verify=verify)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise RuntimeError(f"Failed to retrieve Object IDs: {data['error']}")

    object_ids = data.get("objectIds", [])
    if not object_ids:
        raise RuntimeError("No Object IDs returned by the ArcGIS layer.")

    return sorted(object_ids)


def convert_esri_rings_to_geojson(rings: List[List[List[float]]]) -> Tuple[Optional[Dict[str, Any]], bool]:
    """
    Convert Esri JSON polygon rings to a GeoJSON Polygon or MultiPolygon geometry.

    Correctly identifies exterior shells vs interior holes using topological containment:
    - Rings are first validated, closed, and cleaned.
    - Outer shells have an even nesting depth (0, 2, ...); holes have an odd nesting depth (1, 3, ...).
    - Preserves holes inside multipart polygons or single polygons.
    - Returns (geojson_geometry_dict, has_holes_flag).
    """
    if not rings:
        return None, False

    # Clean and close all rings
    cleaned_rings: List[List[List[float]]] = []
    for r in rings:
        if not r or len(r) < 3:
            continue
        ring_pts = [list(pt) for pt in r]
        # Ensure closed ring
        if ring_pts[0] != ring_pts[-1]:
            ring_pts.append(ring_pts[0])
        if len(ring_pts) >= 4:
            cleaned_rings.append(ring_pts)

    if not cleaned_rings:
        return None, False

    # Single ring -> straightforward single Polygon without holes
    if len(cleaned_rings) == 1:
        p = Polygon(cleaned_rings[0])
        if not p.is_valid:
            p = make_valid(p)
        return mapping(p), False

    # Multiple rings: classify into outer boundaries and inner holes using topological containment
    ring_polys = []
    for r in cleaned_rings:
        p = Polygon(r)
        ring_polys.append({
            "coords": r,
            "poly": p,
            "area": p.area,
        })

    # Sort descending by area so largest containing boundaries come first
    ring_polys.sort(key=lambda x: x["area"], reverse=True)

    # Calculate containment relationships
    for i, item_i in enumerate(ring_polys):
        item_i["contained_in"] = []
        for j, item_j in enumerate(ring_polys):
            if i != j and item_j["poly"].contains(item_i["poly"]):
                item_i["contained_in"].append(j)

    # Outer shells have even containment depth (0, 2); holes have odd containment depth (1, 3)
    exteriors: Dict[int, List[List[List[float]]]] = {}
    for i, item in enumerate(ring_polys):
        if len(item["contained_in"]) % 2 == 0:
            exteriors[i] = []

    has_holes = False
    for i, item in enumerate(ring_polys):
        if len(item["contained_in"]) % 2 == 1:
            has_holes = True
            # Associate hole with its immediate containing parent (smallest containing outer ring)
            parent_idx = min(item["contained_in"], key=lambda idx: ring_polys[idx]["area"])
            if parent_idx in exteriors:
                exteriors[parent_idx].append(item["coords"])
            else:
                first_ext = next(iter(exteriors.keys()))
                exteriors[first_ext].append(item["coords"])

    constructed_polys: List[Polygon] = []
    for ext_idx, hole_rings in exteriors.items():
        ext_coords = ring_polys[ext_idx]["coords"]
        p = Polygon(ext_coords, hole_rings)
        if not p.is_valid:
            p = make_valid(p)
        if p.geom_type == "Polygon":
            constructed_polys.append(p)
        elif p.geom_type == "MultiPolygon":
            constructed_polys.extend(list(p.geoms))

    if not constructed_polys:
        return None, has_holes
    elif len(constructed_polys) == 1:
        return mapping(constructed_polys[0]), has_holes
    else:
        return mapping(MultiPolygon(constructed_polys)), has_holes


def download_batch_with_retry(
    session: requests.Session,
    query_url: str,
    params: Dict[str, Any],
    timeout: int,
    max_retries: int,
    verify: bool,
) -> Dict[str, Any]:
    """Execute a batch request with exponential backoff retry on network/server errors."""
    last_exception: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            response = session.get(query_url, params=params, timeout=timeout, verify=verify)
            response.raise_for_status()
            data = response.json()
            if "error" in data:
                raise RuntimeError(f"ArcGIS error: {data['error']}")
            return data
        except (requests.exceptions.RequestException, RuntimeError, json.JSONDecodeError) as e:
            last_exception = e
            if attempt < max_retries:
                backoff = 2 ** attempt
                print(f"      [Retry Warning] Attempt {attempt} failed: {e}. Retrying in {backoff}s...")
                time.sleep(backoff)
            else:
                print(f"      [Batch Error] Attempt {attempt} failed permanently: {e}")

    raise RuntimeError(f"Batch request failed after {max_retries} attempts: {last_exception}")


def validate_coordinates_and_rings(
    geometry: Dict[str, Any],
    lon_min: float = 76.0,
    lon_max: float = 83.0,
    lat_min: float = 14.5,
    lat_max: float = 21.0,
) -> Tuple[bool, List[str]]:
    """Verify coordinate bounds and ring closure for GeoJSON geometry."""
    warnings: List[str] = []
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates", [])

    if geom_type == "Polygon":
        polygons = [coords]
    elif geom_type == "MultiPolygon":
        polygons = coords
    else:
        return False, [f"Invalid geometry type: {geom_type}"]

    for p_idx, poly_rings in enumerate(polygons):
        for r_idx, ring in enumerate(poly_rings):
            if len(ring) < 4:
                warnings.append(f"Ring {r_idx} in part {p_idx} has fewer than 4 coordinates ({len(ring)})")
            if ring[0] != ring[-1]:
                warnings.append(f"Ring {r_idx} in part {p_idx} is not closed: start {ring[0]} != end {ring[-1]}")
            for pt in ring:
                lon, lat = pt[0], pt[1]
                if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
                    warnings.append(f"Coordinate ({lon}, {lat}) out of expected Telangana bounds [{lon_min}-{lon_max}, {lat_min}-{lat_max}]")

    is_valid = len([w for w in warnings if "fewer than 4" in w or "not closed" in w]) == 0
    return is_valid, warnings


def main() -> int:
    args = parse_arguments()
    verify_ssl = not args.insecure

    print("=" * 76)
    print("DigiBhoomi - TGRAC Telangana Mandal Boundaries Downloader")
    print("=" * 76)
    print(f"Source URL   : {args.url}")
    print(f"Output File  : {args.output}")
    print(f"Metadata File: {args.metadata}")
    print(f"Batch Size   : {args.batch_size}")
    print(f"Verify SSL   : {verify_ssl}")
    print("-" * 76)

    # 1. Overwrite Protection
    if os.path.exists(args.output) and not args.force:
        print(f"[ABORT] Target output file already exists:\n  '{args.output}'")
        print("Explicit confirmation required. Use --force to allow overwriting.")
        return 1

    session = requests.Session()
    session.headers.update({
        "User-Agent": "DigiBhoomi-GIS-Downloader/1.0 (+https://github.com/DigiBhoomi)",
        "Accept": "application/json",
    })

    # 2. Fetch Layer Metadata
    print("\n[Step 1/5] Querying layer metadata...")
    try:
        layer_meta = fetch_layer_metadata(session, args.url, args.timeout, verify_ssl)
        layer_name = layer_meta.get("name", "Unknown Layer")
        source_sr = extract_source_spatial_reference(layer_meta)
        all_fields = [f.get("name") for f in layer_meta.get("fields", []) if f.get("name")]
        print(f"  Layer Name     : {layer_name}")
        print(f"  Geometry Type  : {layer_meta.get('geometryType')}")
        print(f"  Source SR      : {source_sr}")
        print(f"  Available Fields: {len(all_fields)} fields")
    except Exception as e:
        print(f"[ERROR] Could not fetch layer metadata: {e}")
        return 1

    # 3. Retrieve Object IDs
    print("\n[Step 2/5] Retrieving all Object IDs (returnIdsOnly=true)...")
    try:
        all_object_ids = fetch_all_object_ids(session, args.url, args.timeout, verify_ssl)
        total_oids = len(all_object_ids)
        print(f"  Successfully retrieved {total_oids} Object IDs (Range: {all_object_ids[0]} to {all_object_ids[-1]})")
    except Exception as e:
        print(f"[ERROR] Could not retrieve Object IDs: {e}")
        return 1

    # 4. Check native GeoJSON support
    print("\n[Step 3/5] Testing native GeoJSON (f=geojson) support...")
    native_geojson = check_native_geojson_support(session, args.url, all_object_ids[0], args.timeout, verify_ssl)
    if native_geojson:
        print("  Service natively supports f=geojson output.")
    else:
        print("  Service does NOT support f=geojson (HTTP 400/unsupported).")
        print("  -> Using Esri JSON (f=json) with topological Shapely ring-to-GeoJSON converter.")

    # 5. Download in batches
    print(f"\n[Step 4/5] Downloading {total_oids} features in batches of {args.batch_size}...")
    query_url = f"{args.url}/query"
    total_batches = (total_oids + args.batch_size - 1) // args.batch_size

    downloaded_features: List[Dict[str, Any]] = []
    downloaded_oids: Set[int] = set()
    failed_oids: List[int] = []
    conversion_warnings: List[str] = []
    features_with_holes_count = 0
    geom_type_counts: Dict[str, int] = {"Polygon": 0, "MultiPolygon": 0}
    duplicate_count = 0

    bbox = {
        "min_lon": 180.0,
        "max_lon": -180.0,
        "min_lat": 90.0,
        "max_lat": -90.0,
    }

    start_time = time.time()

    for batch_idx in range(total_batches):
        start_idx = batch_idx * args.batch_size
        end_idx = min(start_idx + args.batch_size, total_oids)
        batch_oids = all_object_ids[start_idx:end_idx]
        batch_oids_str = ",".join(map(str, batch_oids))
        batch_num = batch_idx + 1

        params: Dict[str, Any] = {
            "objectIds": batch_oids_str,
            "outFields": "*",
            "outSR": "4326",
            "returnGeometry": "true",
            "f": "geojson" if native_geojson else "json",
        }

        try:
            batch_data = download_batch_with_retry(
                session, query_url, params, args.timeout, args.max_retries, verify_ssl
            )

            if native_geojson:
                batch_features = batch_data.get("features", [])
            else:
                batch_features = batch_data.get("features", [])

            for raw_feature in batch_features:
                if native_geojson:
                    properties = raw_feature.get("properties", {})
                    geometry = raw_feature.get("geometry")
                    oid = properties.get("OBJECTID")
                else:
                    properties = raw_feature.get("attributes", {})
                    esri_geom = raw_feature.get("geometry", {})
                    oid = properties.get("OBJECTID")
                    rings = esri_geom.get("rings", []) if esri_geom else []
                    geometry, has_holes = convert_esri_rings_to_geojson(rings)
                    if has_holes:
                        features_with_holes_count += 1

                # Validation & deduplication
                if oid is None:
                    conversion_warnings.append(f"Batch {batch_num}: Feature without OBJECTID encountered")
                    continue

                if oid in downloaded_oids:
                    duplicate_count += 1
                    conversion_warnings.append(f"Duplicate feature detected for OBJECTID {oid}")
                    continue

                if not geometry or not geometry.get("coordinates"):
                    conversion_warnings.append(f"OBJECTID {oid}: Missing or empty geometry")
                    failed_oids.append(oid)
                    continue

                # Coordinate bounds & ring validation
                is_valid_rings, geom_warnings = validate_coordinates_and_rings(geometry)
                if not is_valid_rings:
                    conversion_warnings.extend(
                        [f"OBJECTID {oid}: {gw}" for gw in geom_warnings]
                    )

                # Track geometry type
                g_type = geometry.get("type", "Unknown")
                geom_type_counts[g_type] = geom_type_counts.get(g_type, 0) + 1

                # Ensure required attributes exist
                for req_attr in REQUIRED_ATTRIBUTES:
                    if req_attr not in properties:
                        properties[req_attr] = None

                # Update bounding box
                def update_bbox(coords_list):
                    for item in coords_list:
                        if isinstance(item[0], (int, float)):
                            lon, lat = item[0], item[1]
                            bbox["min_lon"] = min(bbox["min_lon"], lon)
                            bbox["max_lon"] = max(bbox["max_lon"], lon)
                            bbox["min_lat"] = min(bbox["min_lat"], lat)
                            bbox["max_lat"] = max(bbox["max_lat"], lat)
                        else:
                            update_bbox(item)

                update_bbox(geometry.get("coordinates", []))

                geojson_feature = {
                    "type": "Feature",
                    "id": oid,
                    "geometry": geometry,
                    "properties": properties,
                }
                downloaded_features.append(geojson_feature)
                downloaded_oids.add(oid)

            pct = (len(downloaded_features) / total_oids) * 100
            print(
                f"  [Batch {batch_num:02d}/{total_batches:02d}] "
                f"Downloaded {len(batch_features)} features (OIDs {batch_oids[0]}-{batch_oids[-1]}). "
                f"Progress: {len(downloaded_features)}/{total_oids} ({pct:.1f}%)"
            )

        except Exception as e:
            print(f"  [Batch {batch_num:02d}/{total_batches:02d}] FAILED: {e}")
            failed_oids.extend(batch_oids)
            conversion_warnings.append(f"Batch {batch_num} failed completely: {e}")

    elapsed_time = time.time() - start_time
    print(f"\nDownload completed in {elapsed_time:.1f}s.")

    # 6. Verification of Coverage
    print("\n[Step 5/5] Verifying completeness and dataset integrity...")
    missing_oids = set(all_object_ids) - downloaded_oids
    print(f"  Initial Object IDs       : {total_oids}")
    print(f"  Successfully Downloaded  : {len(downloaded_features)}")
    print(f"  Failed Object IDs        : {len(failed_oids)}")
    print(f"  Missing Object IDs       : {len(missing_oids)}")
    print(f"  Duplicates Detected      : {duplicate_count}")
    print(f"  Geometry Breakdown       : {dict(geom_type_counts)}")
    print(f"  Features with Holes      : {features_with_holes_count}")
    print(f"  Bounding Box (Lon/Lat)   : [{bbox['min_lon']:.4f}, {bbox['min_lat']:.4f}] to [{bbox['max_lon']:.4f}, {bbox['max_lat']:.4f}]")

    if missing_oids:
        print(f"  [WARNING] Unaccounted Object IDs: {sorted(list(missing_oids))[:10]}...")

    # 7. Write GeoJSON Output
    print(f"\nWriting GeoJSON dataset to '{args.output}'...")
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    feature_collection = {
        "type": "FeatureCollection",
        "name": "telangana_mandal_boundaries",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": downloaded_features,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(feature_collection, f, ensure_ascii=False)

    geojson_size_mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"  GeoJSON saved successfully ({geojson_size_mb:.2f} MB).")

    # Compute SHA-256 hash of the generated GeoJSON file
    hasher = hashlib.sha256()
    with open(args.output, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    geojson_sha256 = hasher.hexdigest()
    print(f"  GeoJSON SHA-256 fingerprint: {geojson_sha256}")

    # 8. Write Metadata JSON Output
    print(f"Writing metadata to '{args.metadata}'...")
    os.makedirs(os.path.dirname(os.path.abspath(args.metadata)), exist_ok=True)

    retrieval_date = datetime.datetime.now(datetime.timezone.utc).isoformat()
    metadata = {
        "source_url": args.url,
        "layer_id": 26,
        "layer_name": layer_name,
        "retrieval_date": retrieval_date,
        "coordinate_reference_system": "EPSG:4326 (WGS84)",
        "source_spatial_reference": source_sr,
        "geojson_sha256": geojson_sha256,
        "total_object_ids_in_service": total_oids,
        "successfully_downloaded_features": len(downloaded_features),
        "failed_features_count": len(failed_oids),
        "failed_object_ids": failed_oids,
        "missing_object_ids_count": len(missing_oids),
        "duplicate_features_detected": duplicate_count,
        "geometry_type_breakdown": geom_type_counts,
        "features_with_holes_count": features_with_holes_count,
        "bounding_box": {
            "min_longitude": bbox["min_lon"],
            "min_latitude": bbox["min_lat"],
            "max_longitude": bbox["max_lon"],
            "max_latitude": bbox["max_lat"],
        },
        "original_source_attributes": all_fields,
        "required_attributes_preserved": REQUIRED_ATTRIBUTES,
        "boundary_type_disclaimer": (
            "These boundaries represent administrative Mandal units from the Telangana Remote "
            "Sensing Applications Centre (TGRAC). They are administrative reference boundaries, "
            "NOT cadastral land parcel boundaries, and must not be used for property boundary "
            "verification or legal land title determinations."
        ),
        "licensing_notice": (
            "Source: Telangana Remote Sensing Applications Centre (TGRAC) Administrative "
            "Information System MapServer (Layer 26: Mandal Boundary). Publicly accessible service. "
            "Specific open-data redistribution or commercial terms are not stated by TGRAC; data is "
            "acquired for demonstration, administrative reference, and educational evaluation."
        ),
        "conversion_and_validation_warnings": conversion_warnings[:50],
        "total_warnings_count": len(conversion_warnings),
    }

    with open(args.metadata, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

    print("  Metadata saved successfully.")
    print("\n" + "=" * 76)
    print("Download and conversion finished successfully!")
    print("=" * 76)
    return 0


if __name__ == "__main__":
    sys.exit(main())
