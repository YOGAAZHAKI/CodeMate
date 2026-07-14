import os
import re
import json
from typing import Dict, List, Any, Optional, Tuple
import google.generativeai as genai
from app.config import GEMINI_API_KEY, GEMINI_MODEL_NAME
from app.services.chroma_service import ChromaService
from app.services.chunker import CodeChunker

# Configuration now happens per-request using the user-provided key

class CodeMateAgent:
    @staticmethod
    def search_references(repo_path: str, function_name: str, defining_file: str = "") -> List[Dict[str, Any]]:
        """
        Searches the codebase for references to a given function or class name.
        Uses regex word boundaries to find matches.
        """
        references = []
        code_files = CodeChunker.get_all_code_files(repo_path)
        
        # Word boundary pattern for the function name
        pattern = re.compile(rf"\b{re.escape(function_name)}\b")
        
        for file_path in code_files:
            rel_path = os.path.relpath(file_path, repo_path).replace("\\", "/")
            
            # Skip checking the file where it's defined (optional, let's keep it if we want to show external impacts)
            if defining_file and rel_path == defining_file:
                continue
                
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
            except Exception:
                continue
                
            for idx, line in enumerate(lines, 1):
                if pattern.search(line):
                    # Skip comment-only lines if they are not docs, but include code calls
                    stripped = line.strip()
                    # Check if it's a comment line
                    if stripped.startswith("#") or stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                        is_comment = True
                    else:
                        is_comment = False
                        
                    references.append({
                        "file_path": rel_path,
                        "line_number": idx,
                        "line_content": stripped,
                        "is_comment": is_comment
                    })
        return references

    @classmethod
    def analyze_impact(cls, repo_path: str, function_name: str) -> Dict[str, Any]:
        """
        Retrieves references and formats an impact analysis report.
        """
        # Find where it is referenced
        refs = cls.search_references(repo_path, function_name)
        
        external_refs = [r for r in refs if not r["is_comment"]]
        comment_refs = [r for r in refs if r["is_comment"]]
        
        files_impacted = list(set([r["file_path"] for r in external_refs]))
        
        return {
            "function_name": function_name,
            "total_references": len(refs),
            "code_references_count": len(external_refs),
            "comment_references_count": len(comment_refs),
            "files_impacted_count": len(files_impacted),
            "files_impacted": files_impacted,
            "references": refs
        }

    @classmethod
    def ask_question(cls, repo_url: str, repo_path: str, question: str, api_key: str = None) -> Dict[str, Any]:
        """
        Answers a user question based on ChromaDB context and Gemini 1.5 Flash.
        Proactively triggers dependency checks if a change query is detected.
        """
        # 1. Query vector database for relevant code chunks
        chunks = ChromaService.query_chunks(repo_url, question, top_k=5)
        
        # 2. Extract potential function/class names from question to see if they match impact triggers
        # Match common patterns: "what happens if I change X", "if I modify X", "updating X", "impact of X"
        impact_trigger_patterns = [
            r"change\s+(\w+)",
            r"modify\s+(\w+)",
            r"update\s+(\w+)",
            r"delete\s+(\w+)",
            r"break\s+(\w+)",
            r"rewrite\s+(\w+)",
            r"impact\s+of\s+(\w+)",
            r"what\s+happens\s+if\s+I\s+(\w+)",
        ]
        
        target_entity = None
        for pattern in impact_trigger_patterns:
            match = re.search(pattern, question, re.IGNORECASE)
            if match:
                target_entity = match.group(1)
                break
                
        # If no regex match, we check if any extracted words match a known function in the retrieved chunk metadata
        if not target_entity:
            words = re.findall(r"\b\w+\b", question)
            # Find if any word matches a function name in chunks
            for word in words:
                if len(word) > 3:  # avoid short words
                    for c in chunks:
                        fn_name = c["metadata"].get("function_name", "")
                        # Handle dotted names (e.g. Class.method)
                        base_fn_name = fn_name.split(".")[-1]
                        if word == base_fn_name or word == fn_name:
                            target_entity = fn_name
                            break
                    if target_entity:
                        break
        
        # Run impact analysis if target function/class detected
        impact_analysis = None
        impact_warning_text = ""
        if target_entity:
            print(f"Agentic trigger activated! Analyzing impact for: {target_entity}")
            # Clean dotted notation if searching the codebase
            search_name = target_entity.split(".")[-1]
            impact_analysis = cls.analyze_impact(repo_path, search_name)
            
            # Format impact warning to append to LLM prompt or output
            if impact_analysis["code_references_count"] > 0:
                impact_warning_text = f"\n\n⚠️ **Proactive Dependency Warning**: Changing '{target_entity}' will impact {impact_analysis['code_references_count']} reference(s) across {len(impact_analysis['files_impacted'])} file(s):\n"
                for ref in impact_analysis["references"]:
                    if not ref["is_comment"]:
                        impact_warning_text += f"- `{ref['file_path']}:L{ref['line_number']}`: `{ref['line_content']}`\n"
            else:
                impact_warning_text = f"\n\nℹ️ **Proactive Dependency Warning**: No active code calls to '{target_entity}' were detected in other files."

        # 3. Format context for Gemini Q&A
        context_blocks = []
        for c in chunks:
            meta = c["metadata"]
            block = f"""---
Source File: {meta['file_path']}
Identifier: {meta['function_name']} ({meta['type']})
Lines: {meta['start_line']}-{meta['end_line']}
Git Commit: {meta['commit_hash']}
Git Author: {meta['commit_author']}
Git Date: {meta['commit_date']}

Code Content:
{c['document']}
---"""
            context_blocks.append(block)
            
        context_str = "\n\n".join(context_blocks)
        
        # 4. Construct System prompt
        system_prompt = """You are "CodeMate", a premium AI-powered Codebase Onboarding Agent.
Your job is to answer questions about a codebase using the provided context (which includes code files, normalized comments, and Git history).

Follow these rules:
1. Explain WHAT the code does clearly and concisely.
2. Explain WHY it was built this way using the provided commit and PR context.
3. Be transparent and cite file locations and commit hashes. Always link back to the specific file/lines/commit (e.g. `auth.py:L10-15` or commit `c235e84b`) as evidence.
4. ONLY use the provided context. If the question cannot be answered using the context, state: "I cannot answer this question based on the ingested codebase context."
5. Never hallucinate code or facts outside of the provided context.
"""

        user_prompt = f"""Question: {question}

Retrieved Codebase Context:
{context_str}

Please provide your grounded response:
"""

        effective_key = api_key or GEMINI_API_KEY
        answer = ""
        if not effective_key:
            answer = "Please provide your Gemini API key to get an AI-generated answer. Here is the retrieved raw context:\n\n" + context_str
        else:
            try:
                genai.configure(api_key=effective_key)
                model = genai.GenerativeModel(
                    model_name=GEMINI_MODEL_NAME,
                    system_instruction=system_prompt
                )
                response = model.generate_content(user_prompt)
                answer = response.text
            except Exception as e:
                if "API_KEY_INVALID" in str(e) or "API key not valid" in str(e):
                    answer = "That Gemini API key doesn't look valid. Please check it and try again."
                else:
                    answer = f"Error calling Gemini: {e}\n\nRetrieved Context:\n{context_str}"
                
        # Append the proactive warning if generated
        if impact_warning_text:
            answer += impact_warning_text

        # Format sources to send to frontend
        sources = []
        for c in chunks:
            meta = c["metadata"]
            sources.append({
                "file_path": meta["file_path"],
                "function_name": meta["function_name"],
                "type": meta["type"],
                "start_line": meta["start_line"],
                "end_line": meta["end_line"],
                "commit_hash": meta["commit_hash"],
                "commit_author": meta["commit_author"],
                "commit_date": meta["commit_date"]
            })

        return {
            "answer": answer,
            "sources": sources,
            "impact_analysis": impact_analysis
        }
