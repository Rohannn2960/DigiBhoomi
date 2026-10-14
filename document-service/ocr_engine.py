"""
DigiBhoomi OCR Processing Engine
Converts PDFs and images (PNG, JPG) to preprocessed frames and executes EasyOCR on CPU.
Supports English, Hindi, Telugu, Marathi, and Tamil with full Unicode fidelity.
"""

import socket
socket.setdefaulttimeout(10.0) # Prevent EasyOCR urllib from hanging indefinitely

import io
import os
import cv2
import numpy as np
from PIL import Image
from typing import List, Dict, Any, Tuple
import pypdfium2 as pdfium
import easyocr

# Maximum page limit for single PDF to avoid unbounded processing
MAX_PDF_PAGES = int(os.environ.get("MAX_OCR_PAGES", 5))

# Global reader cache by language tuple to avoid re-initializing PyTorch models
_READER_CACHE: Dict[str, easyocr.Reader] = {}


def get_ocr_reader(lang_code: str = "hi") -> easyocr.Reader:
    """
    Returns cached EasyOCR Reader for the requested Indian language + English.
    Downloads language model on first request (cached in ~/.EasyOCR).
    """
    # EasyOCR language pairs: always pair English with the regional language
    lang_map = {
        "en": ["en"],
        "hi": ["hi", "en"],
        "hindi": ["hi", "en"],
        "te": ["te", "en"],
        "telugu": ["te", "en"],
        "mr": ["mr", "en"],
        "marathi": ["mr", "en"],
        "ta": ["ta", "en"],
        "tamil": ["ta", "en"]
    }

    selected_langs = lang_map.get(lang_code.lower(), ["en"])
    cache_key = "_".join(selected_langs)

    if cache_key not in _READER_CACHE:
        try:
            print(f"[OCR Engine] Initializing EasyOCR CPU Reader for languages: {selected_langs}")
            _READER_CACHE[cache_key] = easyocr.Reader(selected_langs, gpu=False, verbose=False)
        except Exception as e:
            print(f"[OCR Engine] Regional language {selected_langs} reader load failed: {e}. Falling back to English reader.")
            if "en" not in _READER_CACHE:
                _READER_CACHE["en"] = easyocr.Reader(["en"], gpu=False, verbose=False)
            return _READER_CACHE["en"]

    return _READER_CACHE[cache_key]


def preprocess_image(pil_img: Image.Image) -> np.ndarray:
    """
    Applies standard document image preprocessing:
    - Normalizes resolution (resizes if exceeds 2000px on long edge)
    - Grayscale conversion
    - Contrast adjustment via adaptive histogram equalization (CLAHE)
    """
    # Convert PIL to OpenCV format (BGR)
    rgb_img = np.array(pil_img.convert("RGB"))
    cv_img = cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)

    # Resize if image is excessively large to keep CPU runtime fast
    height, width = cv_img.shape[:2]
    max_dim = 2000
    if max(height, width) > max_dim:
        scale = max_dim / float(max(height, width))
        cv_img = cv2.resize(cv_img, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)

    # Convert to grayscale
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

    # Adaptive contrast enhancement (improves faded text in legacy records)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    return enhanced


def convert_file_to_images(file_bytes: bytes, mime_type: str) -> List[Image.Image]:
    """
    Converts uploaded file (PDF, PNG, JPG) into a list of PIL Images.
    Enforces MAX_PDF_PAGES limit for PDFs.
    """
    mime = mime_type.lower()
    images: List[Image.Image] = []

    if "pdf" in mime:
        try:
            pdf = pdfium.PdfDocument(file_bytes)
            page_count = min(len(pdf), MAX_PDF_PAGES)
            for page_idx in range(page_count):
                page = pdf[page_idx]
                # Render at 200 DPI for high-accuracy OCR
                image = page.render(scale=2.0).to_pil()
                images.append(image)
        except Exception as e:
            raise ValueError(f"Failed to parse PDF document: {str(e)}")
    else:
        try:
            pil_img = Image.open(io.BytesIO(file_bytes))
            images.append(pil_img)
        except Exception as e:
            raise ValueError(f"Failed to decode image document: {str(e)}")

    if not images:
        raise ValueError("Document contains no readable pages or image data.")

    return images


def process_document_ocr(file_bytes: bytes, mime_type: str, language: str = "hi") -> Dict[str, Any]:
    """
    Main OCR pipeline:
    1. Extracts pages to PIL images
    2. Preprocesses each page
    3. Runs EasyOCR on CPU
    4. Aggregates lines, text, and mean confidence
    """
    images = convert_file_to_images(file_bytes, mime_type)
    reader = get_ocr_reader(language)

    all_lines: List[Dict[str, Any]] = []
    full_text_parts: List[str] = []

    for page_idx, img in enumerate(images):
        processed_np = preprocess_image(img)
        # Run EasyOCR detection & recognition
        results = reader.readtext(processed_np)

        for bbox, text, confidence in results:
            clean_text = text.strip()
            if clean_text:
                all_lines.append({
                    "text": clean_text,
                    "confidence": float(confidence),
                    "page": page_idx + 1
                })
                full_text_parts.append(clean_text)

    full_text = "\n".join(full_text_parts)
    mean_confidence = float(np.mean([line["confidence"] for line in all_lines])) if all_lines else 0.0

    return {
        "fullText": full_text,
        "lines": all_lines,
        "pageCount": len(images),
        "meanConfidence": round(mean_confidence, 2),
        "engine": "EasyOCR-CPU",
        "language": language
    }
