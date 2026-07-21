import os
import re
import json
import time
from typing import Dict, List, Any, Optional, Tuple
import google.generativeai as genai
from langdetect import detect
from app.config import GEMINI_API_KEY, GEMINI_MODEL_NAME

# Global rate-limit circuit breaker cooldown timestamp
_RATE_LIMIT_UNTIL = 0

class LanguageNormalizer:
    @staticmethod
    def extract_comments(code: str, file_path: str) -> List[str]:
        """
        Extracts comments from code based on file extension.
        """
        ext = os.path.splitext(file_path)[1].lower()
        comments = []
        
        # Python comments and docstrings
        if ext == ".py":
            # Single line comments
            single_line = re.findall(r"(?:^|\s)#\s*(.*)$", code, re.MULTILINE)
            comments.extend([c.strip() for c in single_line if c.strip()])
            
            # Double/single triple-quoted docstrings
            docstrings = re.findall(r'\"\"\"(.*?)\"\"\"', code, re.DOTALL)
            docstrings.extend(re.findall(r"\'\'\'(.*?)\'\'\'", code, re.DOTALL))
            comments.extend([d.strip() for d in docstrings if d.strip()])
            
        # JS/TS/Java/C++/C# comments
        elif ext in {".js", ".jsx", ".ts", ".tsx", ".java", ".cpp", ".h", ".c", ".cs"}:
            # Single line comments //
            single_line = re.findall(r"//\s*(.*)$", code, re.MULTILINE)
            comments.extend([c.strip() for c in single_line if c.strip()])
            
            # Multi-line comments /* ... */
            multi_line = re.findall(r"/\*(.*?)\*/", code, re.DOTALL)
            comments.extend([m.strip() for m in multi_line if m.strip()])
            
        # Fallback regex for single-line comments in other languages
        else:
            single_line = re.findall(r"(?://|#)\s*(.*)$", code, re.MULTILINE)
            comments.extend([c.strip() for c in single_line if c.strip()])
            
        return comments

    @classmethod
    def _is_simple_english(cls, text: str) -> bool:
        """
        Fast heuristic to check if text is plain ASCII / English without needing Gemini API.
        """
        # If contains non-ASCII characters (e.g. Hindi, Tamil, Devanagari), definitely not simple English
        if not text.isascii():
            return False
        
        # Check basic langdetect fallback if short/plain
        try:
            lang = detect(text)
            if lang == "en":
                return True
        except Exception:
            pass
        return False

    @classmethod
    def detect_and_normalize(cls, text: str, api_key: str = None) -> Dict[str, Any]:
        """
        Detects if the text contains non-English / mixed language (Hinglish/Tanglish)
        and normalizes it to clean English using Gemini.
        """
        global _RATE_LIMIT_UNTIL
        text = text.strip()
        if not text:
            return {
                "is_mixed_or_non_english": False,
                "original_language": "English",
                "normalized_text": ""
            }

        # Fast path: Skip Gemini API call if text is already standard English
        if cls._is_simple_english(text):
            return {
                "is_mixed_or_non_english": False,
                "original_language": "English",
                "normalized_text": text
            }

        effective_key = api_key or GEMINI_API_KEY

        # Check if rate-limited or missing key
        if not effective_key or time.time() < _RATE_LIMIT_UNTIL:
            try:
                lang = detect(text)
            except Exception:
                lang = "unknown"
            return {
                "is_mixed_or_non_english": lang != "en" and lang != "unknown",
                "original_language": f"LocalDetect: {lang}",
                "normalized_text": text
            }

        prompt = f"""You are a multilingual software development assistant. 
Analyze the following code comment or git commit message:
\"\"\"{text}\"\"\"

1. Detect if the text contains non-English words, phrases, or mixed languages written in Latin/English script (e.g., Hinglish/Hindi-English mixed like "database reset karna", Tanglish/Tamil-English mixed like "conn check pannu") or native scripts (Devanagari, Tamil script, etc.).
2. If it is pure English, return it as-is and mark "is_mixed_or_non_english" as false.
3. If it contains mixed/non-English, translate and normalize it to clean, technical English. Preserve the technical meaning, terms, and context.
4. Output EXACTLY a JSON object with keys:
  - "is_mixed_or_non_english": boolean (true if it has non-English/mixed words, else false)
  - "original_language": string (e.g., "Hinglish", "Tanglish", "Hindi", "Tamil", "English")
  - "normalized_text": string (normalized English version)

Do not include any Markdown tags or comments in your response. Return ONLY the raw JSON string.
"""

        try:
            genai.configure(api_key=effective_key)
            model = genai.GenerativeModel(GEMINI_MODEL_NAME)
            response = model.generate_content(prompt)
            response_text = response.text.strip()
            
            if response_text.startswith("```"):
                response_text = re.sub(r"^```(?:json)?\n", "", response_text)
                response_text = re.sub(r"\n```$", "", response_text)
                response_text = response_text.strip()
                
            data = json.loads(response_text)
            return {
                "is_mixed_or_non_english": bool(data.get("is_mixed_or_non_english", False)),
                "original_language": str(data.get("original_language", "English")),
                "normalized_text": str(data.get("normalized_text", text))
            }
        except Exception as e:
            err_msg = str(e)
            _RATE_LIMIT_UNTIL = time.time() + 60  # Cooldown for 60 seconds on error
            if "429" in err_msg or "Quota exceeded" in err_msg:
                print("[Translator] Gemini API rate limit reached (429). Pausing API calls for 60s and using local language detection fallback.")
            else:
                print(f"[Translator] Gemini normalization error: {e}. Pausing API calls for 60s and using local language detection fallback.")

            
            try:
                lang = detect(text)
            except Exception:
                lang = "unknown"
            return {
                "is_mixed_or_non_english": lang != "en" and lang != "unknown",
                "original_language": f"Fallback: {lang}",
                "normalized_text": text
            }
            
    @classmethod
    def normalize_comments_list(cls, comments: List[str], api_key: str = None) -> Tuple[List[Dict[str, Any]], str]:
        """
        Normalizes a list of comments.
        Returns a list of normalization dicts and a combined normalized string.
        """
        normalized_comments = []
        combined_normalized = []
        
        for c in comments:
            norm = cls.detect_and_normalize(c, api_key=api_key)
            normalized_comments.append(norm)
            if norm.get("normalized_text"):
                combined_normalized.append(norm["normalized_text"])
            
        return normalized_comments, "\n".join(combined_normalized)

