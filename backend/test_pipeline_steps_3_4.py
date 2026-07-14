import os
import shutil
import tempfile
import git
from typing import List, Dict, Any

# Import services
from app.services.git_service import GitService
from app.services.chunker import CodeChunker
from app.services.translator import LanguageNormalizer
from app.services.chroma_service import ChromaService

def create_mock_git_repo() -> str:
    """
    Creates a temporary local directory, writes some code files,
    initializes a Git repository, and commits them.
    Returns the path to the local repository.
    """
    temp_dir = tempfile.mkdtemp(prefix="mock_repo_34_")
    print(f"Creating mock git repo at: {temp_dir}")
    
    py_code = """# Global configuration settings
DB_HOST = "localhost"
DB_PORT = 5432 # default port hai boss

class AuthManager:
    \"\"\"
    AuthManager handles authentication and login sessions.
    \"\"\"
    def __init__(self, key: str):
        # API key store pannu
        self.key = key
        self.sessions = {}

    def login(self, username: str, password: str) -> bool:
        # Username aur password validation yahan karenge
        if username == "admin" and password == "secret":
            # Session token generate pannu
            token = f"token_{username}_{self.key}"
            self.sessions[username] = token
            return True
        return False
"""
    
    js_code = """// User utilities module
const DEFAULT_TIMEOUT = 5000; // 5 seconds wait karega

function fetchUser(userId) {
    // API call karo user details fetch karne ke liye
    console.log("Fetching user:", userId);
    return { id: userId, role: "admin" };
}
"""

    with open(os.path.join(temp_dir, "auth.py"), "w", encoding="utf-8") as f:
        f.write(py_code)
        
    with open(os.path.join(temp_dir, "utils.js"), "w", encoding="utf-8") as f:
        f.write(js_code)

    # Initialize Git repo
    repo = git.Repo.init(temp_dir)
    repo.index.add(["auth.py", "utils.js"])
    repo.index.commit("Initial commit. database connect check pannu. #pehle_commit")
    
    return temp_dir

def run_pipeline():
    mock_repo_path = None
    repo_url = "https://github.com/mock/test-repo" # Mock URL for DB keys
    try:
        mock_repo_path = create_mock_git_repo()
        
        # 1. Clone
        print("\n=== STEP 1: Cloning Mock Repo ===")
        cloned_path = GitService.clone_repo(mock_repo_path)
        
        # 2. Get Git commits to match against files
        print("\n=== STEP 2: Extracting Commit History ===")
        commits = GitService.get_commit_history(cloned_path)
        print(f"Extracted {len(commits)} commits.")
        
        # Build file-to-commit mapping
        file_commit_map = {}
        for commit in commits:
            for f in commit["files_changed"]:
                if f not in file_commit_map:
                    file_commit_map[f] = []
                file_commit_map[f].append(commit)

        # 3. Chunk and Translate
        print("\n=== STEP 3: Chunking & Language Normalization ===")
        code_files = CodeChunker.get_all_code_files(cloned_path)
        
        chroma_chunks = []
        chunk_counter = 0
        
        for file_path in code_files:
            rel_path = os.path.relpath(file_path, cloned_path).replace("\\", "/")
            print(f"Processing file: {rel_path}")
            
            # File history
            file_commits = file_commit_map.get(rel_path, [])
            commit_messages = [c["message"] for c in file_commits]
            
            # Translate commit messages
            normalized_commit_msgs = []
            for msg in commit_messages:
                norm_msg = LanguageNormalizer.detect_and_normalize(msg)
                normalized_commit_msgs.append(norm_msg["normalized_text"])
            
            # Extract and process chunks
            file_chunks = CodeChunker.chunk_file(cloned_path, file_path)
            for chunk in file_chunks:
                # Extract comments
                comments = LanguageNormalizer.extract_comments(chunk["code"], file_path)
                
                # Normalize comments
                norm_comments_data, normalized_comments_text = LanguageNormalizer.normalize_comments_list(comments)
                
                # Detect original language (take the most common non-english or just the first)
                orig_lang = "English"
                for nc in norm_comments_data:
                    if nc["is_mixed_or_non_english"]:
                        orig_lang = nc["original_language"]
                        break
                
                # Construct combined document for embedding
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
                # Fetch first commit details for metadata if available
                first_commit = file_commits[0] if file_commits else {}
                
                chroma_chunks.append({
                    "id": f"chunk_{chunk_counter}",
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
                
        # 4. Store in ChromaDB
        print("\n=== STEP 4: Storing in ChromaDB ===")
        # Delete old ones first
        ChromaService.delete_repo_chunks(repo_url)
        ChromaService.add_chunks(repo_url, chroma_chunks)
        
        # 5. Query ChromaDB to verify retrieval
        print("\n=== STEP 5: Querying Vector DB ===")
        queries = [
            "auth login sessions",          # Should match login function
            "default port hai boss",       # Should match DB_PORT (multilingual match)
            "database connection check"     # Should match commit msg context in utils.js
        ]
        
        for q in queries:
            print(f"\nQuery: '{q}'")
            results = ChromaService.query_chunks(repo_url, q, top_k=2)
            print(f"Results returned: {len(results)}")
            for idx, res in enumerate(results, 1):
                meta = res["metadata"]
                print(f"  Result {idx} (Score/Distance: {res['distance']:.4f}):")
                print(f"    File: {meta['file_path']} | Name: {meta['function_name']} ({meta['type']})")
                print(f"    Line Range: {meta['start_line']}-{meta['end_line']}")
                print(f"    Snippet:")
                snippet = "\n".join(res["document"].strip().splitlines()[:6])
                print(f"      {snippet.replace(chr(10), chr(10)+'      ')}")
                print("    " + "-"*40)
                
    finally:
        if mock_repo_path and os.path.exists(mock_repo_path):
            shutil.rmtree(mock_repo_path, ignore_errors=True)

if __name__ == "__main__":
    run_pipeline()
