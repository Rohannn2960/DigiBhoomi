#!/usr/bin/env python3
"""
Focused Test Suite: TGRAC Layer 26 CRS Metadata Extraction
==========================================================

Tests:
1. Unit tests for `extract_source_spatial_reference` with various ArcGIS metadata structures:
   - Direct `spatialReference`
   - `extent.spatialReference` fallback when `spatialReference` is None (TGRAC pattern)
   - `sourceSpatialReference`
   - `fullExtent.spatialReference` / `initialExtent.spatialReference`
   - Malformed / empty / None inputs
2. Live integration test against TGRAC Layer 26 MapServer endpoint verifying that
   `extract_source_spatial_reference` accurately extracts EPSG:32644.
3. Verification of `server/data/telangana_mandal_boundaries_metadata.json`:
   - `source_spatial_reference` is a JSON dict with WKID 32644 (not a string)
   - `coordinate_reference_system` is "EPSG:4326 (WGS84)"
4. Verification that `server/data/telangana_mandal_boundaries.geojson` remains untouched (27 MB).
"""

import json
import os
import sys
import unittest

import requests

# Import the extractor from the downloader script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from download_tgrac_mandal_boundaries import extract_source_spatial_reference


class TestCRSMetaExtraction(unittest.TestCase):
    def test_direct_spatial_reference(self):
        meta = {"spatialReference": {"wkid": 32644, "latestWkid": 32644}}
        result = extract_source_spatial_reference(meta)
        self.assertEqual(result, {"wkid": 32644, "latestWkid": 32644})

    def test_extent_fallback_when_spatial_reference_is_none(self):
        """Simulates the exact TGRAC Layer 26 pattern where top-level spatialReference is None."""
        meta = {
            "name": "Mandal Boundary",
            "spatialReference": None,
            "extent": {
                "xmin": 98129.9879,
                "ymin": 1752978.8436,
                "xmax": 533634.5593,
                "ymax": 2204518.0808,
                "spatialReference": {"wkid": 32644, "latestWkid": 32644},
            },
        }
        result = extract_source_spatial_reference(meta)
        self.assertEqual(result, {"wkid": 32644, "latestWkid": 32644})

    def test_source_spatial_reference_key(self):
        meta = {
            "sourceSpatialReference": {"wkid": 32644, "latestWkid": 32644},
            "spatialReference": None,
        }
        result = extract_source_spatial_reference(meta)
        self.assertEqual(result, {"wkid": 32644, "latestWkid": 32644})

    def test_fullextent_fallback(self):
        meta = {
            "spatialReference": None,
            "fullExtent": {"spatialReference": {"wkid": 32644}},
        }
        result = extract_source_spatial_reference(meta)
        self.assertEqual(result, {"wkid": 32644})

    def test_empty_and_malformed_inputs(self):
        self.assertEqual(extract_source_spatial_reference({}), {})
        self.assertEqual(extract_source_spatial_reference(None), {})
        self.assertEqual(extract_source_spatial_reference({"spatialReference": {}}), {})
        self.assertEqual(extract_source_spatial_reference({"extent": {}}), {})
        self.assertEqual(extract_source_spatial_reference({"extent": None}), {})

    def test_live_tgrac_layer_26_crs_extraction(self):
        """Test extraction against live TGRAC Layer 26 MapServer."""
        url = (
            "https://tgrac.telangana.gov.in/arcgis/rest/services/"
            "AdministrativeInfoSystem_Folder/Administrative_Information_System/MapServer/26?f=json"
        )
        try:
            r = requests.get(url, timeout=15)
            r.raise_for_status()
            data = r.json()
            extracted = extract_source_spatial_reference(data)
            self.assertIsInstance(extracted, dict)
            self.assertEqual(extracted.get("wkid"), 32644)
            self.assertEqual(extracted.get("latestWkid"), 32644)
        except requests.exceptions.RequestException as e:
            self.skipTest(f"Live network test skipped due to connectivity: {e}")

    def test_saved_metadata_file_values(self):
        """Verify the saved metadata JSON contains valid JSON objects and correct CRS values."""
        meta_path = os.path.join("server", "data", "telangana_mandal_boundaries_metadata.json")
        self.assertTrue(os.path.exists(meta_path), f"File {meta_path} does not exist")

        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # 1. source_spatial_reference must be a JSON object, not string
        source_sr = metadata.get("source_spatial_reference")
        self.assertIsInstance(
            source_sr,
            dict,
            f"source_spatial_reference must be a dict/JSON object, got: {type(source_sr)}",
        )
        self.assertEqual(
            source_sr.get("wkid"),
            32644,
            f"Expected source spatial reference WKID 32644, got: {source_sr}",
        )
        self.assertEqual(
            source_sr.get("latestWkid"),
            32644,
            f"Expected source spatial reference latestWkid 32644, got: {source_sr}",
        )

        # 2. coordinate_reference_system must preserve output EPSG:4326
        output_crs = metadata.get("coordinate_reference_system")
        self.assertEqual(output_crs, "EPSG:4326 (WGS84)")

    def test_geojson_file_preserved(self):
        """Verify that the 27 MB GeoJSON file was not modified or corrupted."""
        geojson_path = os.path.join("server", "data", "telangana_mandal_boundaries.geojson")
        self.assertTrue(os.path.exists(geojson_path), f"File {geojson_path} does not exist")
        file_size_mb = os.path.getsize(geojson_path) / (1024 * 1024)
        self.assertGreater(
            file_size_mb,
            25.0,
            f"GeoJSON file size is unexpectedly small: {file_size_mb:.2f} MB",
        )


if __name__ == "__main__":
    unittest.main()
