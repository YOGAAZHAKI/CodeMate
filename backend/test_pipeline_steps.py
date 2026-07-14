import os
import shutil
import tempfile
from pathlib import Path
import git

# Import services
from app.services.git_service import GitService
from app.services.chunker import CodeChunker

def create_mock_git_repo() -> str:
    """
    Creates a temporary local directory, writes some code files,
    initializes a Git repository, and commits them.
    Returns the path to the local repository.
    """
    temp_dir = tempfile.mkdtemp(prefix="mock_repo_")
    print(f"Creating mock git repo at: {temp_dir}")
    
    # 1. Write a python file with classes, functions, globals and mixed language comments
    py_code = """# This is a module level comment
# Global database configuration settings
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
    
    # 2. Write a JS/TS file with functions and mixed comments
    js_code = """// User utilities module
const DEFAULT_TIMEOUT = 5000; // 5 seconds wait karega

// Function to fetch user details
function fetchUser(userId) {
    // API call karo user details fetch karne ke liye
    console.log("Fetching user:", userId);
    return { id: userId, role: "admin" };
}

class Logger {
    constructor(prefix) {
        this.prefix = prefix;
    }
    
    log(msg) {
        // message print pannu console-la
        console.log(`[${this.prefix}] ${msg}`);
    }
}
"""

    # Write files
    with open(os.path.join(temp_dir, "auth.py"), "w", encoding="utf-8") as f:
        f.write(py_code)
        
    with open(os.path.join(temp_dir, "utils.js"), "w", encoding="utf-8") as f:
        f.write(js_code)

    # Initialize Git repo
    repo = git.Repo.init(temp_dir)
    repo.index.add(["auth.py", "utils.js"])
    repo.index.commit("Initial commit with auth and utils modules. #pehle_commit")
    
    # Let's make another commit changing auth.py to check commit history
    with open(os.path.join(temp_dir, "auth.py"), "a", encoding="utf-8") as f:
        f.write("\n# Final authorization check function\ndef is_authorized() -> bool:\n    return True\n")
    
    repo.index.add(["auth.py"])
    repo.index.commit("Add is_authorized function and finalize auth logic.")

    return temp_dir

def main():
    mock_repo_path = None
    try:
        # Step 1: Create Mock Repo
        mock_repo_path = create_mock_git_repo()
        
        # Step 2: Use GitService to clone (or copy) mock repo
        # Since GitService clones repository URLs, we can pass the path as a file:// url or direct path
        print("\n--- Testing GitService Cloning ---")
        cloned_path = GitService.clone_repo(mock_repo_path)
        print(f"Repository cloned to: {cloned_path}")
        
        # Step 3: Fetch Commit History
        print("\n--- Testing Git History Extraction ---")
        commits = GitService.get_commit_history(cloned_path)
        print(f"Total commits fetched: {len(commits)}")
        for c in commits:
            print(f"Commit: {c['hash'][:8]} | Author: {c['author']} | Msg: {c['message']}")
            print(f"Files modified: {c['files_changed']}")
            print("-" * 30)

        # Step 4: Chunk Files
        print("\n--- Testing Code Chunker ---")
        code_files = CodeChunker.get_all_code_files(cloned_path)
        print(f"Code files found: {code_files}")
        
        for file_path in code_files:
            print(f"\nFile: {os.path.basename(file_path)}")
            chunks = CodeChunker.chunk_file(cloned_path, file_path)
            print(f"Chunks generated: {len(chunks)}")
            for idx, chunk in enumerate(chunks, 1):
                print(f"  Chunk {idx}:")
                print(f"    Type: {chunk['type']}")
                print(f"    Name: {chunk['name']}")
                print(f"    Lines: {chunk['start_line']}-{chunk['end_line']}")
                print(f"    Code snippet (first 3 lines):")
                snippet = "\n".join(chunk['code'].strip().splitlines()[:3])
                print(f"      {snippet.replace(chr(10), chr(10)+'      ')}")
                print("    " + "."*40)
                
    finally:
        # Cleanup mock repo
        if mock_repo_path and os.path.exists(mock_repo_path):
            shutil.rmtree(mock_repo_path, ignore_errors=True)

if __name__ == "__main__":
    main()
