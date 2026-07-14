import os
import re
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional
import git
import requests
from app.config import REPO_DIR

class GitService:
    @staticmethod
    def parse_repo_url(url: str) -> Dict[str, str]:
        """
        Parses a git URL (e.g., https://github.com/owner/repo.git or git@github.com:owner/repo.git)
        to extract the owner and repo name.
        """
        # Clean URL
        url_clean = url.strip()
        if url_clean.endswith(".git"):
            url_clean = url_clean[:-4]
        
        # Match HTTPS or SSH patterns
        match = re.search(r"github\.com[:/]([^/]+)/([^/]+)", url_clean)
        if match:
            return {"owner": match.group(1), "repo": match.group(2)}
        
        # Fallback split
        parts = [p for p in url_clean.split("/") if p]
        if len(parts) >= 2:
            return {"owner": parts[-2], "repo": parts[-1]}
        
        return {"owner": "unknown", "repo": "unknown"}

    @classmethod
    def clone_repo(cls, repo_url: str) -> str:
        """
        Clones a repository to the REPO_DIR.
        Returns the local directory path.
        """
        info = cls.parse_repo_url(repo_url)
        local_dir = os.path.join(REPO_DIR, f"{info['owner']}_{info['repo']}")
        
        if os.path.exists(local_dir):
            try:
                # If it exists, let's open it and try to pull to see if it's a valid git repo
                repo = git.Repo(local_dir)
                origin = repo.remotes.origin
                origin.pull()
                print(f"Repository already exists, pulled latest changes: {local_dir}")
                return local_dir
            except Exception as e:
                print(f"Error updating existing repository: {e}. Re-cloning...")
                shutil.rmtree(local_dir, ignore_errors=True)
        
        print(f"Cloning {repo_url} into {local_dir}...")
        git.Repo.clone_from(repo_url, local_dir)
        return local_dir

    @staticmethod
    def get_commit_history(repo_path: str) -> List[Dict[str, Any]]:
        """
        Gets the commit history of a repository.
        """
        repo = git.Repo(repo_path)
        commits = []
        for commit in repo.iter_commits():
            # Get modified files in this commit
            files_changed = list(commit.stats.files.keys())
            commits.append({
                "hash": commit.hexsha,
                "author": commit.author.name,
                "email": commit.author.email,
                "date": commit.committed_datetime.isoformat(),
                "message": commit.message.strip(),
                "files_changed": files_changed
            })
        return commits

    @staticmethod
    def get_file_history(repo_path: str, relative_file_path: str) -> List[Dict[str, Any]]:
        """
        Gets the commit history that modified a specific file.
        """
        repo = git.Repo(repo_path)
        commits = []
        try:
            for commit in repo.iter_commits(paths=relative_file_path):
                commits.append({
                    "hash": commit.hexsha,
                    "author": commit.author.name,
                    "date": commit.committed_datetime.isoformat(),
                    "message": commit.message.strip()
                })
        except Exception as e:
            print(f"Error getting history for {relative_file_path}: {e}")
        return commits

    @classmethod
    def get_github_prs(cls, repo_url: str) -> List[Dict[str, Any]]:
        """
        Best effort to fetch Pull Requests from GitHub API.
        Requires GITHUB_TOKEN in environment for non-rate-limited access.
        """
        info = cls.parse_repo_url(repo_url)
        owner = info["owner"]
        repo_name = info["repo"]
        
        if owner == "unknown" or repo_name == "unknown":
            return []
        
        url = f"https://api.github.com/repos/{owner}/{repo_name}/pulls"
        headers = {
            "Accept": "application/vnd.github+json"
        }
        token = os.getenv("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"token {token}"
            
        params = {
            "state": "all",
            "per_page": 50
        }
        
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            if response.status_code == 200:
                prs = response.json()
                results = []
                for pr in prs:
                    results.append({
                        "number": pr.get("number"),
                        "title": pr.get("title"),
                        "body": pr.get("body") or "",
                        "state": pr.get("state"),
                        "merge_commit_sha": pr.get("merge_commit_sha"),
                        "html_url": pr.get("html_url"),
                        "creator": pr.get("user", {}).get("login")
                    })
                return results
            else:
                print(f"GitHub API returned status {response.status_code}: {response.text}")
        except Exception as e:
            print(f"Failed to fetch PRs from GitHub: {e}")
            
        return []
