"""
DigiBhoomi Structured Field Extractor
Extracts domain-specific land record attributes using multilingual regex, keyword labels,
and line pattern heuristics across English, Hindi, Telugu, Marathi, and Tamil.
"""

import re
from typing import Dict, Any, List, Optional

# Keywords and regex patterns mapped to standard land attributes
PATTERNS = {
    'ownerName': [
        # English
        r'(?:owner(?:\s*name)?|pattadar(?:\s*name)?|khatedar|landholder|name\s*of\s*owner)\s*[:\-\.]\s*([^\n\r,;]+)',
        # Hindi / Devanagari
        r'(?:खातेदार(?:\s*का\s*नाम)?|भूमिधर(?:\s*का\s*नाम)?|पट्टेदार(?:\s*का\s*नाम)?|मालिक(?:\s*का\s*नाम)?|काश्तकार)\s*[:\-\.]\s*([^\n\r,;]+)',
        # Telugu
        r'(?:పట్టాదారు(?:\s*పేరు)?|రైతు(?:\s*పేరు)?|భూమి\s*యజమాని|పేరు)\s*[:\-\.]\s*([^\n\r,;]+)',
        # Marathi
        r'(?:खातेदाराचे\s*नाव|भोगवटादाराचे\s*नाव|जमीनधारकाचे\s*नाव)\s*[:\-\.]\s*([^\n\r,;]+)'
    ],
    'surveyNumber': [
        # English
        r'(?:survey(?:\s*no|\s*number)?|khasra(?:\s*no|\s*number)?|sy\s*no|plot\s*no)\s*[:\-\.]\s*([0-9]+(?:\s*[/\\-]\s*[0-9]+[A-Za-z]*)?)',
        # Hindi
        r'(?:खसरा(?:\s*संख्या|\s*नं)?|सर्वे(?:\s*संख्या|\s*नंबर)?)\s*[:\-\.]\s*([0-9]+(?:\s*[/\\-]\s*[0-9]+[A-Za-z]*)?)',
        # Telugu
        r'(?:సర్వే(?:\s*నంబరు|\s*నం)?|ఖస్రా(?:\s*నంబరు|\s*నం)?)\s*[:\-\.]\s*([0-9]+(?:\s*[/\\-]\s*[0-9]+[A-Za-z]*)?)',
        # Marathi
        r'(?:सर्व्हे(?:\s*नंबर|\s*क्र)?|गट(?:\s*नंबर|\s*क्र)?)\s*[:\-\.]\s*([0-9]+(?:\s*[/\\-]\s*[0-9]+[A-Za-z]*)?)'
    ],
    'khataNumber': [
        # English
        r'(?:khata(?:\s*no|\s*number)?|khewat(?:\s*no|\s*number)?|khatauni(?:\s*no|\s*number)?|passbook(?:\s*no)?)\s*[:\-\.]\s*([0-9A-Za-z\-/]+)',
        # Hindi
        r'(?:खाता(?:\s*संख्या|\s*नं)?|खेवट(?:\s*संख्या|\s*नं)?|खतौनी(?:\s*संख्या|\s*नं)?)\s*[:\-\.]\s*([0-9A-Za-z\-/]+)',
        # Telugu
        r'(?:ఖాతా(?:\s*నంబరు|\s*నం)?|పాస్\s*పుస్తకం\s*నం)\s*[:\-\.]\s*([0-9A-Za-z\-/]+)',
        # Marathi
        r'(?:खाते(?:\s*क्रमांक|\s*क्र)?)\s*[:\-\.]\s*([0-9A-Za-z\-/]+)'
    ],
    'village': [
        # English
        r'(?:village|mauza|gram)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Hindi
        r'(?:ग्राम|गाँव|मौजा)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Telugu
        r'(?:గ్రామం|గ్రామము|మౌజా)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Marathi
        r'(?:गाव|मौजे)\s*[:\-\.]\s*([^\n\r,;0-9]+)'
    ],
    'tehsil': [
        # English
        r'(?:tehsil|taluk|mandal|anchal|block)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Hindi
        r'(?:तहसील|अंचल|तालुका)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Telugu
        r'(?:మండలం|తాలూకా|తహసీల్)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Marathi
        r'(?:तालुका)\s*[:\-\.]\s*([^\n\r,;0-9]+)'
    ],
    'district': [
        # English
        r'(?:district|dist)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Hindi
        r'(?:जिला|जनपद)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Telugu
        r'(?:జిల్లా)\s*[:\-\.]\s*([^\n\r,;0-9]+)',
        # Marathi
        r'(?:जिल्हा)\s*[:\-\.]\s*([^\n\r,;0-9]+)'
    ],
    'landClassification': [
        # English
        r'(?:classification|land\s*type|nature\s*of\s*land|land\s*classification)\s*[:\-\.]\s*([^\n\r,;]+)',
        # Hindi
        r'(?:भूमि(?:\s*की)?\s*श्रेणी|भूमि\s*का\s*प्रकार|जमीन\s*का\s*प्रकार)\s*[:\-\.]\s*([^\n\r,;]+)',
        # Telugu
        r'(?:భూమి\s*రకం|భూమి\s*స్వభావం)\s*[:\-\.]\s*([^\n\r,;]+)',
        # Marathi
        r'(?:जमिनीचा\s*प्रकार|धारणा\s*पद्धती)\s*[:\-\.]\s*([^\n\r,;]+)'
    ]
}

# Regex to capture land area value and unit
AREA_PATTERN = re.compile(
    r'(?:area|extent|total\s*area|क्षेत्रफल|रकबा|విస్తీర్ణం|విస్తీర్ణము|क्षेत्रफळ)\s*[:\-\.]\s*([0-9\.\-/]+)\s*([A-Za-z\u0900-\u097F\u0C00-\u0C7F]+)?',
    re.IGNORECASE
)

# Known area units mapping
UNIT_NORMALIZATION = {
    'ac': 'Acre', 'acre': 'Acre', 'acres': 'Acre', 'ఎకరాలు': 'Acre',
    'ha': 'Hectare', 'hec': 'Hectare', 'hectare': 'Hectare', 'हे.': 'Hectare', 'హెక్టార్లు': 'Hectare', 'हेक्टर': 'Hectare',
    'bigha': 'Bigha', 'बीघा': 'Bigha',
    'biswa': 'Biswa', 'बिस्वा': 'Biswa',
    'gunta': 'Gunta', 'గుంటలు': 'Gunta', 'गुंठा': 'Gunta',
    'sq yards': 'Sq Yards', 'sq.yd': 'Sq Yards'
}


def _create_field_result(value: Optional[str], raw_text: Optional[str], confidence: Optional[float] = None) -> Dict[str, Any]:
    """Helper to structure extracted field attributes following the record schema."""
    cleaned_val = value.strip() if value else ""
    is_valid = bool(cleaned_val)
    return {
        'value': cleaned_val if is_valid else "",
        'rawText': raw_text.strip() if raw_text else None,
        'rawOcrText': raw_text.strip() if raw_text else None,
        'confidence': round(confidence, 2) if (confidence is not None and is_valid) else None,
        'confidenceSource': 'OCR_ENGINE' if (confidence is not None and is_valid) else ('HEURISTIC' if is_valid else None),
        'isFlagged': not is_valid or (confidence is not None and confidence < 0.70),
        'reviewStatus': 'Unreviewed'
    }


def extract_structured_fields(ocr_lines: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Parses OCR lines (each line with text and confidence) to extract standard land fields.
    Does NOT invent values. Missing fields return empty value with flagged status.
    """
    full_text = "\n".join([line['text'] for line in ocr_lines])
    
    extracted = {
        'ownerName': _create_field_result(None, None),
        'surveyNumber': _create_field_result(None, None),
        'khasraNumber': _create_field_result(None, None),
        'khataNumber': _create_field_result(None, None),
        'area': _create_field_result(None, None),
        'areaUnit': _create_field_result(None, None),
        'landArea': {
            'value': '',
            'unit': 'Acre',
            'rawText': None,
            'rawOcrText': None,
            'confidence': None,
            'confidenceSource': None,
            'isFlagged': True,
            'reviewStatus': 'Unreviewed'
        },
        'village': _create_field_result(None, None),
        'tehsil': _create_field_result(None, None),
        'district': _create_field_result(None, None),
        'landClassification': _create_field_result(None, None)
    }

    # Extract standard fields by scanning lines and regex patterns
    for field_name, patterns in PATTERNS.items():
        found = False
        for line in ocr_lines:
            text = line['text']
            conf = line.get('confidence', 0.85)

            for pattern in patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    val = match.group(1).strip()
                    if val:
                        res = _create_field_result(val, text, conf)
                        extracted[field_name] = res
                        if field_name == 'surveyNumber':
                            extracted['khasraNumber'] = res
                        found = True
                        break
            if found:
                break

    # Extract Land Area & Unit specifically
    for line in ocr_lines:
        text = line['text']
        conf = line.get('confidence', 0.85)

        area_match = AREA_PATTERN.search(text)
        if area_match:
            val = area_match.group(1).strip()
            raw_unit = (area_match.group(2) or '').strip().lower()
            normalized_unit = UNIT_NORMALIZATION.get(raw_unit, 'Acre')

            extracted['landArea'] = {
                'value': val,
                'unit': normalized_unit,
                'rawText': text,
                'rawOcrText': text,
                'confidence': round(conf, 2),
                'confidenceSource': 'OCR_ENGINE',
                'isFlagged': conf < 0.70,
                'reviewStatus': 'Unreviewed'
            }
            extracted['area'] = {
                'value': val,
                'rawText': text,
                'rawOcrText': text,
                'confidence': round(conf, 2),
                'confidenceSource': 'OCR_ENGINE',
                'isFlagged': conf < 0.70,
                'reviewStatus': 'Unreviewed'
            }
            extracted['areaUnit'] = {
                'value': normalized_unit,
                'rawText': text,
                'confidence': round(conf, 2),
                'confidenceSource': 'OCR_ENGINE',
                'isFlagged': False,
                'reviewStatus': 'Unreviewed'
            }
            break

    return extracted
