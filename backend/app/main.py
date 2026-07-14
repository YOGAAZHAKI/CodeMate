import os
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List, Any, Optional

# Import services
from app.services.git_service import GitService
from app.services.chunker import CodeChunker
from app.services.translator import LanguageNormalizer
from app.services.chroma_service import ChromaService
from app.services.agent import CodeMateAgent
from app.config import REPO_DIR

app = FastAPI(
    title="CodeMate API",
    description="Backend API for CodeMate — AI-powered Codebase Onboarding Agent",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to Vite origin (e.g. http://localhost:5173)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory ingestion job tracking
# Key: repo_url, Value: { "status": str, "progress": str, "total_chunks": int, "error": str }
ingest_jobs: Dict[str, Dict[str, Any]] = {}

class IngestRequest(BaseModel):
    repo_url: str
    api_key: str = None

class AskRequest(BaseModel):
    repo_url: str
    question: str
    api_key: str = None

def run_ingestion_pipeline(repo_url: str, api_key: str = None):
    """
    Background worker task to run the full ingestion pipeline.
    """
    try:
        # Step 1: Cloning
        ingest_jobs[repo_url] = {
            "status": "cloning",
            "progress": "Cloning repository locally...",
            "total_chunks": 0,
            "error": None
        }
        print(f"Background Ingest: Cloning {repo_url}...")
        local_path = GitService.clone_repo(repo_url)
        
        # Step 2: Git History
        ingest_jobs[repo_url]["status"] = "history"
        ingest_jobs[repo_url]["progress"] = "Extracting git history & commit logs..."
        print(f"Background Ingest: Fetching commit history for {repo_url}...")
        commits = GitService.get_commit_history(local_path)
        
        # Map files to commits
        file_commit_map = {}
        for commit in commits:
            for f in commit["files_changed"]:
                if f not in file_commit_map:
                    file_commit_map[f] = []
                file_commit_map[f].append(commit)

        # Optional: fetch GitHub PRs if possible (best effort)
        # prs = GitService.get_github_prs(repo_url)
        
        # Step 3: Chunking & Normalization
        ingest_jobs[repo_url]["status"] = "chunking"
        ingest_jobs[repo_url]["progress"] = "Walking codebase and chunking classes & functions..."
        print(f"Background Ingest: Chunking files in {local_path}...")
        code_files = CodeChunker.get_all_code_files(local_path)
        
        chroma_chunks = []
        chunk_counter = 0
        total_files = len(code_files)
        
        for idx, file_path in enumerate(code_files, 1):
            rel_path = os.path.relpath(file_path, local_path).replace("\\", "/")
            ingest_jobs[repo_url]["progress"] = f"Processing file ({idx}/{total_files}): {rel_path}..."
            
            # File history & translation
            file_commits = file_commit_map.get(rel_path, [])
            commit_messages = [c["message"] for c in file_commits]
            
            normalized_commit_msgs = []
            for msg in commit_messages:
                norm_msg = LanguageNormalizer.detect_and_normalize(msg, api_key=api_key)
                normalized_commit_msgs.append(norm_msg["normalized_text"])
                
            # Chunk file
            file_chunks = CodeChunker.chunk_file(local_path, file_path)
            
            for chunk in file_chunks:
                # Extract comments
                comments = LanguageNormalizer.extract_comments(chunk["code"], file_path)
                
                # Normalize comments
                norm_comments_data, normalized_comments_text = LanguageNormalizer.normalize_comments_list(comments, api_key=api_key)                
                # Language detection metadata
                orig_lang = "English"
                for nc in norm_comments_data:
                    if nc["is_mixed_or_non_english"]:
                        orig_lang = nc["original_language"]
                        break
                
                # Combined document body
                combined_doc = f"""File: {chunk['file_path']}
Name: {chunk['name']}
Type: {chunk['type']}

Code:
{chunk['code']}

Normalized Comments:
{normalized_comments_text}

Git History Context:
{" | ".join(normalized_commit_msgs)}
"""
                first_commit = file_commits[0] if file_commits else {}
                
                chroma_chunks.append({
                    "id": f"{repo_url}_{chunk_counter}",
                    "document": combined_doc,
                    "metadata": {
                        "file_path": chunk["file_path"],
                        "function_name": chunk["name"],
                        "type": chunk["type"],
                        "start_line": chunk["start_line"],
                        "end_line": chunk["end_line"],
                        "original_language": orig_lang,
                        "commit_hash": first_commit.get("hash", ""),
                        "commit_author": first_commit.get("author", ""),
                        "commit_date": first_commit.get("date", ""),
                        "pr_link": ""
                    }
                })
                chunk_counter += 1
        
        # Step 4: Indexing in ChromaDB
        ingest_jobs[repo_url]["status"] = "indexing"
        ingest_jobs[repo_url]["progress"] = f"Generating vector embeddings for {chunk_counter} code chunks..."
        print(f"Background Ingest: Indexing {chunk_counter} chunks in ChromaDB...")
        
        # Clear previous indexing for this repo to avoid duplicates
        ChromaService.delete_repo_chunks(repo_url)
        ChromaService.add_chunks(repo_url, chroma_chunks)
        
        # Step 5: Completed
        ingest_jobs[repo_url] = {
            "status": "completed",
            "progress": "Ingestion completed successfully!",
            "total_chunks": chunk_counter,
            "error": None
        }
        print(f"Background Ingest: Successfully completed ingestion for {repo_url}.")
        
    except Exception as e:
        print(f"Background Ingest Exception for {repo_url}: {e}")
        import traceback
        traceback.print_exc()
        ingest_jobs[repo_url] = {
            "status": "failed",
            "progress": "Ingestion failed.",
            "total_chunks": 0,
            "error": str(e)
        }

@app.post("/api/ingest")
def start_ingestion(request: IngestRequest, background_tasks: BackgroundTasks):
    repo_url = request.repo_url.strip()
    if not repo_url:
        raise HTTPException(status_code=400, detail="Repository URL is required.")
        
    # If already running or completed, let the client know (or allow re-ingestion)
    job = ingest_jobs.get(repo_url)
    if job and job["status"] in {"cloning", "history", "chunking", "indexing"}:
        return {"status": job["status"], "message": "Ingestion is already in progress.", "repo_url": repo_url}
        
    # Start ingestion in the background
    # Start ingestion in the background
    background_tasks.add_task(run_ingestion_pipeline, repo_url, request.api_key)
    
    ingest_jobs[repo_url] = {
        "status": "queued",
        "progress": "Queued for processing...",
        "total_chunks": 0,
        "error": None
    }
    
    return {"status": "queued", "message": "Ingestion pipeline triggered.", "repo_url": repo_url}

@app.get("/api/ingest/status")
def get_ingestion_status(repo_url: str = Query(..., description="The repository URL to check")):
    repo_url = repo_url.strip()
    job = ingest_jobs.get(repo_url)
    if not job:
        return {"status": "idle", "progress": "Not started.", "total_chunks": 0, "error": None}
    return job

@app.post("/api/ask")
def ask_question(request: AskRequest):
    repo_url = request.repo_url.strip()
    question = request.question.strip()
    
    if not repo_url or not question:
        raise HTTPException(status_code=400, detail="Both repo_url and question are required.")
        
    # Resolve local repository folder name
    info = GitService.parse_repo_url(repo_url)
    local_dir = os.path.join(REPO_DIR, f"{info['owner']}_{info['repo']}")
    
    if not os.path.exists(local_dir):
        raise HTTPException(
            status_code=404,
            detail="Repository not found locally. Please ingest the repository first."
        )
        
    try:
        result = CodeMateAgent.ask_question(repo_url, local_dir, question, api_key=request.api_key)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process Q&A query: {str(e)}")

@app.get("/api/impact/{function_name}")
def get_impact_analysis(
    function_name: str,
    repo_url: str = Query(..., description="The repository URL to analyze")
):
    repo_url = repo_url.strip()
    function_name = function_name.strip()
    
    info = GitService.parse_repo_url(repo_url)
    local_dir = os.path.join(REPO_DIR, f"{info['owner']}_{info['repo']}")
    
    if not os.path.exists(local_dir):
        raise HTTPException(
            status_code=404,
            detail="Repository not found locally. Please ingest the repository first."
        )
        
    try:
        report = CodeMateAgent.analyze_impact(local_dir, function_name)
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute impact analysis: {str(e)}")

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}
