import os
from pathlib import Path
from dotenv import load_dotenv

# Load env variables from .env if present
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# Directories for data storage
CHROMA_DB_PATH = str(BASE_DIR / "chroma_db")
REPO_DIR = str(BASE_DIR / "repos")

# Ensure directories exist
os.makedirs(CHROMA_DB_PATH, exist_ok=True)
os.makedirs(REPO_DIR, exist_ok=True)

# API Keys and Models
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBEDDING_MODEL_NAME = "paraphrase-multilingual-mpnet-base-v2"
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash")

