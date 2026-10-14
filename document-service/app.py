"""
DigiBhoomi Document Processing Service
FastAPI microservice featuring Google Gemini multimodal document understanding as the primary engine,
with an offline local OCR fallback pipeline for English, Hindi, Telugu, Marathi, and Tamil.
"""

import os
import sys
import time

# Ensure Windows UTF-8 encoding for multilingual console output
if sys.platform.startswith("win"):
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any

# Load environment variables from document-service/.env and server/.env
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "server", ".env"))

from gemini_extractor import extract_with_gemini
from ocr_engine import process_document_ocr
from extractor import extract_structured_fields

app = FastAPI(
    title="DigiBhoomi Document Processing Microservice",
    description="Multimodal Land Record Extraction using Google Gemini & Local OCR (SIH 26018)",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED_LANGUAGES = ["English", "Hindi", "Telugu", "Marathi", "Tamil"]


def reload_env():
    """Safely loads or reloads environment variables from .env files with override."""
    load_dotenv(override=True)
    server_env = os.path.join(os.path.dirname(__file__), "..", "server", ".env")
    if os.path.exists(server_env):
        load_dotenv(server_env, override=True)

reload_env()


@app.get("/health")
def health_check():
    """Health check endpoint reporting Gemini configuration status and available engines."""
    reload_env()
    has_gemini_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    gemini_model = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")

    return {
        "status": "healthy",
        "service": "DigiBhoomi Document OCR & Extraction Service",
        "primaryEngine": "Google Gemini",
        "geminiConfigured": has_gemini_key,
        "geminiModel": gemini_model,
        "fallbackEngine": "EasyOCR (Local CPU)",
        "supportedLanguages": SUPPORTED_LANGUAGES,
        "primaryTested": ["English", "Hindi", "Telugu"],
        "additionalSupported": ["Marathi", "Tamil"]
    }


@app.post("/process")
async def process_document(
    file: UploadFile = File(...),
    engine: str = Form("gemini"),
    language: str = Form("auto")
):
    """
    Multimodal document processing endpoint.
    - engine='gemini' (default): Uses Google Gemini 3.5 Flash Lite for high-fidelity extraction.
    - engine='local': Uses offline local OCR engine.
    """
    reload_env()
    mime = (file.content_type or "").lower()
    filename = (file.filename or "").lower()

    # Double check extension and MIME
    is_pdf = "pdf" in mime or filename.endswith(".pdf")
    is_image = any(img_type in mime for img_type in ["png", "jpeg", "jpg"]) or any(
        filename.endswith(ext) for ext in [".png", ".jpg", ".jpeg"]
    )

    if not is_pdf and not is_image:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported document format '{file.content_type}'. Permitted types: PDF, PNG, JPG/JPEG."
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty (0 bytes).")

    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds maximum processing limit of 15 MB.")

    start_time = time.time()
    effective_mime = "application/pdf" if is_pdf else (file.content_type or "image/png")

    # Strategy 1: Google Gemini (Primary Engine)
    if engine.lower() == "gemini":
        has_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
        if not has_key:
            raise HTTPException(
                status_code=400,
                detail="GEMINI_API_KEY is not configured in server/.env or environment. Configure your Gemini API key or select 'Local Engine' on the review screen."
            )

        try:
            gemini_result = extract_with_gemini(content, effective_mime)
            elapsed_ms = int((time.time() - start_time) * 1000)

            return {
                "success": True,
                "filename": file.filename,
                "processingTimeMs": elapsed_ms,
                "ocrResult": {
                    "fullText": gemini_result["fullText"],
                    "detectedLanguage": gemini_result["detectedLanguage"],
                    "engine": gemini_result["engine"],
                    "model": gemini_result["model"],
                    "processedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "processingTimeMs": elapsed_ms
                },
                "landDetails": gemini_result["landDetails"]
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Gemini document processing error: {str(e)}")

    # Strategy 2: Local OCR Engine (Offline Fallback)
    elif engine.lower() == "local":
        try:
            l = (language or "").lower()
            if "te" in l or "telugu" in l:
                lang_code = "te"
            elif "hi" in l or "hindi" in l or "devanagari" in l:
                lang_code = "hi"
            elif "mr" in l or "marathi" in l:
                lang_code = "mr"
            elif "ta" in l or "tamil" in l:
                lang_code = "ta"
            else:
                lang_code = "en"
            ocr_output = process_document_ocr(content, effective_mime, lang_code)
            structured_fields = extract_structured_fields(ocr_output["lines"])
            elapsed_ms = int((time.time() - start_time) * 1000)

            return {
                "success": True,
                "filename": file.filename,
                "processingTimeMs": elapsed_ms,
                "ocrResult": {
                    "fullText": ocr_output["fullText"],
                    "detectedLanguage": ocr_output["language"].upper(),
                    "engine": ocr_output["engine"],
                    "model": "EasyOCR",
                    "pageCount": ocr_output["pageCount"],
                    "meanConfidence": ocr_output["meanConfidence"],
                    "processedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "processingTimeMs": elapsed_ms
                },
                "landDetails": structured_fields
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Local OCR processing error: {str(e)}")

    else:
        raise HTTPException(status_code=400, detail=f"Unknown processing engine '{engine}'. Choose 'gemini' or 'local'.")
