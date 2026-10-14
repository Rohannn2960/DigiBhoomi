"""
DigiBhoomi Gemini Extraction Module
Uses the official Google Gen AI SDK (google-genai) to perform multimodal document
transcription and structured field extraction with strict JSON schema adherence.
"""

import os
import json
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

# Pydantic schema for structured output from Gemini
class ExtractedFieldItem(BaseModel):
    value: Optional[str] = Field(default=None, description="The extracted value, or null if not found")
    verbatim_raw_text: Optional[str] = Field(default=None, description="Exact text fragment from the document")

class LandAreaItem(BaseModel):
    value: Optional[str] = Field(default=None, description="Numerical area measurement, or null if not found")
    unit: Optional[str] = Field(default="Acre", description="Measurement unit e.g. Acre, Hectare, Bigha, Biswa, Gunta")
    verbatim_raw_text: Optional[str] = Field(default=None, description="Exact area text from the document")

class DocumentExtractionResult(BaseModel):
    full_transcribed_text: str = Field(description="Complete verbatim transcription of all text in the document in its native script")
    detected_language: str = Field(description="Primary language detected (e.g., English, Hindi, Telugu, Marathi, Tamil)")
    owner_name: ExtractedFieldItem = Field(description="Name of the landowner / pattadar / khatedar")
    survey_khasra_number: ExtractedFieldItem = Field(description="Survey number or Khasra number")
    khata_khewat_number: ExtractedFieldItem = Field(description="Khata / Khewat / Account number")
    land_area: LandAreaItem = Field(description="Total land area and unit")
    village: ExtractedFieldItem = Field(description="Village / Mauza / Gram")
    tehsil_mandal: ExtractedFieldItem = Field(description="Tehsil / Taluk / Mandal / Anchal")
    district: ExtractedFieldItem = Field(description="District / Zilla / Janpad")
    land_classification: ExtractedFieldItem = Field(description="Classification of land e.g. Agricultural, Dry, Wet, Commercial")


SYSTEM_PROMPT = """You are an expert Government Land Record Document Digitization AI for the Indian Ministry of Rural Development.
Analyze the provided scanned land record document (such as a Jamabandi, Khasra, Khatauni, Record of Rights (RoR), 7/12 Satbara, or Patta).

CRITICAL EXTRACTION RULES:
1. First, provide a complete verbatim transcription of all text in `full_transcribed_text` in its original script (Devanagari, Telugu, Tamil, Latin, etc.).
2. Extract the structured fields strictly based on the visible content.
3. NEVER invent, fabricate, or guess any names, numbers, or locations.
4. If a field is not found or is ambiguous, set both its `value` and `verbatim_raw_text` to null.
5. Preserve the exact original spelling, scripts, and numerals without arbitrary modifications.
6. Return only the requested structured JSON conforming to the schema."""


def extract_with_gemini(file_bytes: bytes, mime_type: str) -> Dict[str, Any]:
    """
    Submits document directly to Gemini multimodal API and returns structured land details.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError(
            "GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in server/.env or your environment."
        )

    model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

    # Initialize official GenAI client
    client = genai.Client(api_key=api_key)

    # Build document Part
    document_part = types.Part.from_bytes(
        data=file_bytes,
        mime_type=mime_type
    )

    # Configure structured JSON output with explicit Pydantic schema
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_json_schema=DocumentExtractionResult.model_json_schema(),
        temperature=0.1 # Low temperature for factual extraction
    )

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=[SYSTEM_PROMPT, document_part],
            config=config
        )
    except Exception as e:
        raise RuntimeError(f"Gemini API request failed: {str(e)}")

    if not response.text:
        raise RuntimeError("Gemini returned an empty response.")

    try:
        raw_result = json.loads(response.text)
    except Exception as e:
        raise RuntimeError(f"Failed to parse Gemini JSON response: {str(e)}")

    # Format into standard DigiBhoomi landDetails schema
    def _to_field(item: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        item = item or {}
        val = (item.get("value") or "").strip()
        raw = item.get("verbatim_raw_text")
        is_present = bool(val)
        return {
            "value": val if is_present else "",
            "rawText": raw if raw else None,
            "rawOcrText": raw if raw else None,
            "confidence": None, # Per guidelines: do not treat LLM output as calibrated probability
            "confidenceSource": "GEMINI_MULTIMODAL",
            "isFlagged": not is_present,
            "reviewStatus": "Unreviewed"
        }

    area_item = raw_result.get("land_area") or {}
    area_val = (area_item.get("value") or "").strip()
    area_unit = area_item.get("unit") or "Acre"
    area_raw = area_item.get("verbatim_raw_text")

    survey_field = _to_field(raw_result.get("survey_khasra_number"))

    land_details = {
        "ownerName": _to_field(raw_result.get("owner_name")),
        "surveyNumber": survey_field,
        "khasraNumber": survey_field,
        "khataNumber": _to_field(raw_result.get("khata_khewat_number")),
        "area": {
            "value": area_val,
            "rawText": area_raw if area_raw else None,
            "rawOcrText": area_raw if area_raw else None,
            "confidence": None,
            "confidenceSource": "GEMINI_MULTIMODAL",
            "isFlagged": not bool(area_val),
            "reviewStatus": "Unreviewed"
        },
        "areaUnit": {
            "value": area_unit,
            "rawText": area_raw if area_raw else None,
            "confidence": None,
            "confidenceSource": "GEMINI_MULTIMODAL",
            "reviewStatus": "Unreviewed"
        },
        "landArea": {
            "value": area_val,
            "unit": area_unit,
            "rawText": area_raw if area_raw else None,
            "rawOcrText": area_raw if area_raw else None,
            "confidence": None,
            "confidenceSource": "GEMINI_MULTIMODAL",
            "isFlagged": not bool(area_val),
            "reviewStatus": "Unreviewed"
        },
        "village": _to_field(raw_result.get("village")),
        "tehsil": _to_field(raw_result.get("tehsil_mandal")),
        "district": _to_field(raw_result.get("district")),
        "landClassification": _to_field(raw_result.get("landClassification") or raw_result.get("land_classification"))
    }

    return {
        "fullText": raw_result.get("full_transcribed_text", ""),
        "detectedLanguage": raw_result.get("detected_language", "Unknown"),
        "model": model_name,
        "engine": f"Google Gemini ({model_name})",
        "landDetails": land_details
    }
