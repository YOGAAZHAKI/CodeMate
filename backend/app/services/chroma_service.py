import os
import json
from typing import Dict, List, Any, Optional
import chromadb
from chromadb.api.types import Documents, Embeddings
from sentence_transformers import SentenceTransformer
from app.config import CHROMA_DB_PATH, EMBEDDING_MODEL_NAME

class SentenceTransformerEmbeddingFunction(chromadb.EmbeddingFunction):
    def __init__(self, model_name: str):
        print(f"Loading SentenceTransformer model: {model_name}...")
        self.model = SentenceTransformer(model_name)
        print("Model loaded successfully.")

    def __call__(self, input: Documents) -> Embeddings:
        # Generate embeddings and convert to list of floats
        embeddings = self.model.encode(input, convert_to_numpy=True).tolist()
        return embeddings

class ChromaService:
    _client = None
    _embedding_function = None

    @classmethod
    def get_client(cls):
        if cls._client is None:
            cls._client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        return cls._client

    @classmethod
    def get_embedding_function(cls):
        if cls._embedding_function is None:
            cls._embedding_function = SentenceTransformerEmbeddingFunction(EMBEDDING_MODEL_NAME)
        return cls._embedding_function

    @classmethod
    def get_collection(cls, collection_name: str = "codemate_chunks"):
        client = cls.get_client()
        emb_fn = cls.get_embedding_function()
        return client.get_or_create_collection(
            name=collection_name,
            embedding_function=emb_fn,
            metadata={"hnsw:space": "cosine"} # Cosine similarity
        )

    @classmethod
    def add_chunks(cls, repo_url: str, chunks: List[Dict[str, Any]]):
        """
        Ingests a list of chunks into ChromaDB.
        Each chunk is expected to have:
          - id: unique string id
          - document: combined text (code + comments + commit context)
          - metadata: dict of metadata (file_path, function_name, type, start_line, end_line, language, etc.)
        """
        collection = cls.get_collection()
        
        ids = []
        documents = []
        metadatas = []
        
        for chunk in chunks:
            ids.append(chunk["id"])
            documents.append(chunk["document"])
            
            # Prepare metadata (ensure all values are primitives for ChromaDB)
            meta = {
                "repo_url": repo_url,
                "file_path": chunk["metadata"].get("file_path", ""),
                "function_name": chunk["metadata"].get("function_name", ""),
                "type": chunk["metadata"].get("type", ""),
                "start_line": int(chunk["metadata"].get("start_line", 0)),
                "end_line": int(chunk["metadata"].get("end_line", 0)),
                "original_language": chunk["metadata"].get("original_language", "English"),
                "commit_hash": chunk["metadata"].get("commit_hash", ""),
                "commit_author": chunk["metadata"].get("commit_author", ""),
                "commit_date": chunk["metadata"].get("commit_date", ""),
                "pr_link": chunk["metadata"].get("pr_link", "")
            }
            metadatas.append(meta)
            
        # Add to ChromaDB in batches to prevent payload errors if very large
        batch_size = 200
        for i in range(0, len(ids), batch_size):
            collection.add(
                ids=ids[i : i + batch_size],
                documents=documents[i : i + batch_size],
                metadatas=metadatas[i : i + batch_size]
            )
        print(f"Successfully added {len(ids)} chunks to ChromaDB.")

    @classmethod
    def query_chunks(cls, repo_url: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Queries ChromaDB for chunks matching the query.
        Filters by repo_url.
        """
        collection = cls.get_collection()
        
        results = collection.query(
            query_texts=[query],
            n_results=top_k,
            where={"repo_url": repo_url}
        )
        
        formatted_results = []
        if results and "documents" in results and results["documents"]:
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            ids = results["ids"][0]
            distances = results.get("distances", [[0]*len(docs)])[0]
            
            for i in range(len(docs)):
                formatted_results.append({
                    "id": ids[i],
                    "document": docs[i],
                    "metadata": metas[i],
                    "distance": distances[i]
                })
                
        return formatted_results

    @classmethod
    def delete_repo_chunks(cls, repo_url: str):
        """
        Deletes all chunks belonging to a repo.
        """
        collection = cls.get_collection()
        collection.delete(where={"repo_url": repo_url})
        print(f"Deleted all chunks for repo: {repo_url}")
