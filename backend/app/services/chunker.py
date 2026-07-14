import ast
import os
import re
from typing import Dict, List, Any, Tuple

class CodeChunker:
    # Extensions that we want to parse
    SUPPORTED_EXTENSIONS = {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cpp", ".h", ".c", ".cs", ".go", ".rs"
    }
    
    # Binary and folder exclusions
    EXCLUDED_DIRS = {
        ".git", ".venv", "venv", "node_modules", "__pycache__", "build", "dist",
        "target", "bin", "obj", ".idea", ".vscode", "out"
    }

    @classmethod
    def get_all_code_files(cls, repo_path: str) -> List[str]:
        """
        Walks through the repository and finds all supported code files.
        """
        code_files = []
        for root, dirs, files in os.walk(repo_path):
            # Prune excluded directories in place
            dirs[:] = [d for d in dirs if d not in cls.EXCLUDED_DIRS]
            
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in cls.SUPPORTED_EXTENSIONS:
                    code_files.append(os.path.join(root, file))
        return code_files

    @classmethod
    def chunk_file(cls, repo_path: str, absolute_file_path: str) -> List[Dict[str, Any]]:
        """
        Chunks a code file into functions, classes, and module-level chunks.
        Returns a list of chunks, each with code, metadata, and position.
        """
        relative_path = os.path.relpath(absolute_file_path, repo_path).replace("\\", "/")
        ext = os.path.splitext(absolute_file_path)[1].lower()
        
        try:
            with open(absolute_file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            print(f"Error reading file {absolute_file_path}: {e}")
            return []

        if not content.strip():
            return []

        if ext == ".py":
            return cls._chunk_python_file(content, relative_path)
        elif ext in {".js", ".jsx", ".ts", ".tsx", ".java", ".cpp", ".h", ".c", ".cs"}:
            return cls._chunk_brace_file(content, relative_path, ext)
        else:
            # For go, rs, or fallback
            return cls._fallback_chunk_file(content, relative_path)

    @classmethod
    def _chunk_python_file(cls, content: str, relative_path: str) -> List[Dict[str, Any]]:
        """
        Parses python files using AST to extract functions, classes, and module-level code.
        """
        chunks = []
        lines = content.splitlines()
        
        try:
            tree = ast.parse(content)
        except Exception as e:
            print(f"AST parsing failed for {relative_path}: {e}. Using fallback chunker.")
            return cls._fallback_chunk_file(content, relative_path)

        # Track which lines have been claimed by classes/functions
        claimed_lines = set()

        class ASTVisitor(ast.NodeVisitor):
            def visit_ClassDef(self, node: ast.ClassDef):
                # Class definition chunk
                start = node.lineno
                end = node.end_lineno if hasattr(node, "end_lineno") and node.end_lineno else len(lines)
                
                # Check for class docstring/header block (from start line to start of first function/class)
                class_body_start = start
                constructor_only = ""
                
                # We can also chunk the class methods
                for body_item in node.body:
                    if isinstance(body_item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        f_start = body_item.lineno
                        f_end = body_item.end_lineno if hasattr(body_item, "end_lineno") and body_item.end_lineno else f_start
                        f_code = "\n".join(lines[f_start - 1 : f_end])
                        
                        chunks.append({
                            "type": "function",
                            "name": f"{node.name}.{body_item.name}",
                            "code": f_code,
                            "start_line": f_start,
                            "end_line": f_end,
                            "file_path": relative_path,
                            "parent_class": node.name
                        })
                        # Claim lines for functions
                        for l in range(f_start, f_end + 1):
                            claimed_lines.add(l)
                    elif isinstance(body_item, ast.ClassDef):
                        # Nested class
                        self.visit(body_item)
                
                # The class chunk itself (everything not claimed inside it, or the whole class skeleton)
                class_code = "\n".join(lines[start - 1 : end])
                chunks.append({
                    "type": "class",
                    "name": node.name,
                    "code": class_code,
                    "start_line": start,
                    "end_line": end,
                    "file_path": relative_path,
                    "parent_class": None
                })
                
                # Claim all lines of the class
                for l in range(start, end + 1):
                    claimed_lines.add(l)
                
                # Don't recurse manually into methods as we already handled them
                # But do visit other nodes inside the class (like nested classes)
                for item in node.body:
                    if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        self.visit(item)

            def visit_FunctionDef(self, node: ast.FunctionDef):
                start = node.lineno
                end = node.end_lineno if hasattr(node, "end_lineno") and node.end_lineno else len(lines)
                code = "\n".join(lines[start - 1 : end])
                
                chunks.append({
                    "type": "function",
                    "name": node.name,
                    "code": code,
                    "start_line": start,
                    "end_line": end,
                    "file_path": relative_path,
                    "parent_class": None
                })
                for l in range(start, end + 1):
                    claimed_lines.add(l)

            def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
                self.visit_FunctionDef(node)

        visitor = ASTVisitor()
        visitor.visit(tree)

        # Collect module-level (unclaimed) lines in contiguous blocks
        unclaimed_blocks = []
        current_block = []
        for i, line in enumerate(lines, 1):
            if i not in claimed_lines:
                current_block.append((i, line))
            else:
                if current_block:
                    unclaimed_blocks.append(current_block)
                    current_block = []
        if current_block:
            unclaimed_blocks.append(current_block)

        # Create chunks for module level blocks
        for block in unclaimed_blocks:
            if not block:
                continue
            start_l = block[0][0]
            end_l = block[-1][0]
            block_code = "\n".join([line for _, line in block])
            if block_code.strip():
                chunks.append({
                    "type": "module_level",
                    "name": "module_globals",
                    "code": block_code,
                    "start_line": start_l,
                    "end_line": end_l,
                    "file_path": relative_path,
                    "parent_class": None
                })

        return chunks

    @classmethod
    def _chunk_brace_file(cls, content: str, relative_path: str, ext: str) -> List[Dict[str, Any]]:
        """
        Heuristic brace matcher for JS/TS/Java/C++/C# functions and classes.
        """
        chunks = []
        lines = content.splitlines()
        n_lines = len(lines)
        claimed_lines = set()

        # Regular expressions to spot function/class starts
        # e.g., class Account {
        # e.g., function getBalance() {
        # e.g., const add = (x, y) => {
        # e.g., getTransactions(user) {
        # e.g., public void execute() {
        patterns = [
            # Class definition
            (r"(?:export\s+)?(?:default\s+)?class\s+(\w+)", "class"),
            # Standard function
            (r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(", "function"),
            # Arrow function
            (r"(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(.*?\)\s*=>\s*\{", "function"),
            # Method/Function syntax like: login(req, res) {
            (r"^\s*(?:public|private|protected|static|async)?\s*(\w+)\s*\([^)]*\)\s*\{", "function")
        ]

        # Scan for brackets and extract blocks
        i = 0
        while i < n_lines:
            line = lines[i]
            matched = False
            for pattern, chunk_type in patterns:
                match = re.search(pattern, line)
                if match:
                    name = match.group(1)
                    # Try to find the opening brace in this or subsequent lines
                    start_line = i + 1
                    brace_count = 0
                    found_brace = False
                    end_line = -1
                    
                    # Search forward to match braces
                    for j in range(i, n_lines):
                        search_line = lines[j]
                        if not found_brace:
                            if "{" in search_line:
                                found_brace = True
                                brace_count += search_line.count("{") - search_line.count("}")
                                if brace_count == 0:
                                    end_line = j + 1
                                    break
                        else:
                            brace_count += search_line.count("{") - search_line.count("}")
                            if brace_count <= 0:
                                end_line = j + 1
                                break
                    
                    if found_brace and end_line != -1:
                        # Extract code block
                        block_code = "\n".join(lines[start_line - 1 : end_line])
                        chunks.append({
                            "type": chunk_type,
                            "name": name,
                            "code": block_code,
                            "start_line": start_line,
                            "end_line": end_line,
                            "file_path": relative_path,
                            "parent_class": None # simplified
                        })
                        for l in range(start_line, end_line + 1):
                            claimed_lines.add(l)
                        
                        # Advance iterator past this block
                        i = end_line - 1
                        matched = True
                        break
            if not matched:
                i += 1

        # Collect unclaimed lines
        unclaimed_blocks = []
        current_block = []
        for idx, line in enumerate(lines, 1):
            if idx not in claimed_lines:
                current_block.append((idx, line))
            else:
                if current_block:
                    unclaimed_blocks.append(current_block)
                    current_block = []
        if current_block:
            unclaimed_blocks.append(current_block)

        # Create chunks for unclaimed blocks
        for block in unclaimed_blocks:
            if not block:
                continue
            start_l = block[0][0]
            end_l = block[-1][0]
            block_code = "\n".join([line for _, line in block])
            if block_code.strip():
                chunks.append({
                    "type": "module_level",
                    "name": "module_globals",
                    "code": block_code,
                    "start_line": start_l,
                    "end_line": end_l,
                    "file_path": relative_path,
                    "parent_class": None
                })

        # If we couldn't find any blocks (e.g. minified or weird syntax), use fallback
        if not chunks or len(chunks) == 1 and chunks[0]["type"] == "module_level":
            return cls._fallback_chunk_file(content, relative_path)

        return chunks

    @classmethod
    def _fallback_chunk_file(cls, content: str, relative_path: str, chunk_size_lines: int = 50, overlap_lines: int = 10) -> List[Dict[str, Any]]:
        """
        Fallback chunker that splits file contents into sliding window blocks.
        """
        chunks = []
        lines = content.splitlines()
        n_lines = len(lines)
        
        i = 0
        chunk_idx = 1
        while i < n_lines:
            end = min(i + chunk_size_lines, n_lines)
            chunk_code = "\n".join(lines[i:end])
            
            chunks.append({
                "type": "code_block",
                "name": f"block_{chunk_idx}",
                "code": chunk_code,
                "start_line": i + 1,
                "end_line": end,
                "file_path": relative_path,
                "parent_class": None
            })
            
            chunk_idx += 1
            if end == n_lines:
                break
            i += (chunk_size_lines - overlap_lines)
            
        return chunks
