import os
import shutil
import tempfile
import git
import sys
import io
from dotenv import load_dotenv

# Force UTF-8 stdout for Windows consoles
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Load environment
load_dotenv()

# Import services
from app.services.git_service import GitService
from app.services.chunker import CodeChunker
from app.services.translator import LanguageNormalizer
from app.services.chroma_service import ChromaService
from app.services.agent import CodeMateAgent
from app.config import GEMINI_API_KEY

def create_mock_git_repo() -> str:
    temp_dir = tempfile.mkdtemp(prefix="mock_agent_repo_")
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

def check_permission(username: str) -> bool:
    # check if user has admin access
    # admin validation logic romba mukkiyam
    return username == "admin"
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

def main():
    print(f"Loaded GEMINI_API_KEY: {'[PRESENT]' if GEMINI_API_KEY and GEMINI_API_KEY != 'your_gemini_api_key_here' else '[MISSING OR DEFAULT]'}")
    
    mock_repo_path = None
    repo_url = "https://github.com/mock/agent-repo"
    
    try:
        mock_repo_path = create_mock_git_repo()
        
        # 1. Ingest Mock Repo into Vector DB
        cloned_path = GitService.clone_repo(mock_repo_path)
        commits = GitService.get_commit_history(cloned_path)
        
        file_commit_map = {}
        for commit in commits:
            for f in commit["files_changed"]:
                if f not in file_commit_map:
                    file_commit_map[f] = []
                file_commit_map[f].append(commit)

        code_files = CodeChunker.get_all_code_files(cloned_path)
        chroma_chunks = []
        chunk_counter = 0
        
        for file_path in code_files:
            rel_path = os.path.relpath(file_path, cloned_path).replace("\\", "/")
            file_commits = file_commit_map.get(rel_path, [])
            commit_messages = [c["message"] for c in file_commits]
            
            normalized_commit_msgs = []
            for msg in commit_messages:
                norm_msg = LanguageNormalizer.detect_and_normalize(msg)
                normalized_commit_msgs.append(norm_msg["normalized_text"])
            
            file_chunks = CodeChunker.chunk_file(cloned_path, file_path)
            for chunk in file_chunks:
                comments = LanguageNormalizer.extract_comments(chunk["code"], file_path)
                _, normalized_comments_text = LanguageNormalizer.normalize_comments_list(comments)
                
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
                    "id": f"agent_chunk_{chunk_counter}",
                    "document": combined_doc,
                    "metadata": {
                        "file_path": chunk["file_path"],
                        "function_name": chunk["name"],
                        "type": chunk["type"],
                        "start_line": chunk["start_line"],
                        "end_line": chunk["end_line"],
                        "original_language": "Mixed",
                        "commit_hash": first_commit.get("hash", ""),
                        "commit_author": first_commit.get("author", ""),
                        "commit_date": first_commit.get("date", ""),
                        "pr_link": ""
                    }
                })
                chunk_counter += 1
                
        ChromaService.delete_repo_chunks(repo_url)
        ChromaService.add_chunks(repo_url, chroma_chunks)
        
        # 2. Test Q&A Reasoning
        print("\n=== STEP 5: Testing Q&A Reasoning ===")
        desc_question = "Explain how authentication login is handled and which class contains it?"
        print(f"Question: '{desc_question}'")
        res_qa = CodeMateAgent.ask_question(repo_url, cloned_path, desc_question)
        print("\nAgent Answer:")
        print(res_qa["answer"])
        print("-" * 50)
        
        # 3. Test Agentic Dependency Check
        print("\n=== STEP 6: Testing Agentic Dependency / Impact Check ===")
        impact_question = "What happens if I change check_permission function?"
        print(f"Question: '{impact_question}'")
        res_impact = CodeMateAgent.ask_question(repo_url, cloned_path, impact_question)
        print("\nAgent Answer with Warning:")
        print(res_impact["answer"])
        print("-" * 50)
        
        print("\nImpact Analysis JSON Object:")
        print(res_impact["impact_analysis"])
        
    finally:
        if mock_repo_path and os.path.exists(mock_repo_path):
            shutil.rmtree(mock_repo_path, ignore_errors=True)

if __name__ == "__main__":
    main()
