import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Layers, ArrowRight, RefreshCw, CheckCircle, AlertTriangle,
  History, BookOpen, Code2, Trash2, Lock
} from "lucide-react";
import { useApp } from "../context/AppContext";

const API_BASE = "http://localhost:8000/api";

export default function IngestPage() {
  const {
    geminiKey, repoUrl, setRepoUrl, activeRepo,
    historyRepos, saveReposToHistory, setActiveRepo,
    ingestJob, setIngestJob, setChatMessages,
    selectActiveRepo, deleteRepoFromHistory
  } = useApp();
  const navigate = useNavigate();

  const parseRepoUrl = (url) => {
    let clean = url.trim();
    if (clean.endsWith(".git")) clean = clean.slice(0, -4);
    const match = clean.match(/github\.com[:/]([^/]+)\/([^/]+)/);
    if (match) return { owner: match[1], repo: match[2] };
    const parts = clean.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
    return { owner: "unknown", repo: "repo" };
  };

  useEffect(() => {
    let timer;
    if (ingestJob.status !== "idle" && ingestJob.status !== "completed" && ingestJob.status !== "failed") {
      timer = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/ingest/status?repo_url=${encodeURIComponent(repoUrl)}`);
          if (res.ok) {
            const data = await res.json();
            setIngestJob(data);
            if (data.status === "completed") {
              clearInterval(timer);
              const parsed = parseRepoUrl(repoUrl);
              const repoInfo = { url: repoUrl, owner: parsed.owner, repo: parsed.repo, total_chunks: data.total_chunks };
              const exists = historyRepos.find(r => r.url === repoUrl);
              let updatedHistory = [...historyRepos];
              if (!exists) {
                updatedHistory = [repoInfo, ...historyRepos];
                saveReposToHistory(updatedHistory);
              }
              setActiveRepo(repoInfo);
              setChatMessages([{
                sender: "bot",
                text: `Indexed ${data.total_chunks} functions and classes. Mixed-language comments and commit messages have been read and normalized to English. Head to Ask to start, or Impact to trace dependencies.`,
                isSystem: true
              }]);
            } else if (data.status === "failed") {
              clearInterval(timer);
            }
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [ingestJob.status, repoUrl]);

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    if (!geminiKey.trim()) {
      setIngestJob({ status: "failed", progress: "Add your Gemini API key first.", total_chunks: 0, error: "Missing API key" });
      return;
    }
    setIngestJob({ status: "queued", progress: "Queuing ingestion request...", total_chunks: 0, error: null });
    try {
      const res = await fetch(`${API_BASE}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl.trim(), api_key: geminiKey || null })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to trigger ingestion pipeline.");
      }
      const data = await res.json();
      setIngestJob(prev => ({ ...prev, status: data.status }));
    } catch (err) {
      setIngestJob({ status: "failed", progress: "Failed to initialize pipeline.", total_chunks: 0, error: err.message });
    }
  };

  const isBusy = ingestJob.status !== "idle" && ingestJob.status !== "completed" && ingestJob.status !== "failed";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-6">

      {!geminiKey && (
        <div className="ledger-note-danger p-4 bg-[#D9634B]/5 text-[#D9634B] flex items-center gap-3 text-xs pl-4">
          <Lock className="w-4 h-4 shrink-0" />
          <span>You haven't added a Gemini API key yet. <button onClick={() => navigate("/setup")} className="underline font-medium">Add one first</button>.</span>
        </div>
      )}

      <div className="bg-[#191D26] border border-[#2A2F3A] rounded-lg p-6 flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium flex items-center gap-2">
          <Layers className="w-5 h-5 text-[#E3A542]" />
          Ingest a repository
        </h2>
        <p className="text-sm text-[#8C93A3] leading-relaxed">
          Paste a public GitHub URL. Comments and commit messages written in Tamil, Hindi, or mixed-language script are detected and normalized automatically.
        </p>

        <form onSubmit={handleIngest} className="flex flex-col gap-3">
          <div className="relative">
            <input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={isBusy}
              className="w-full pl-4 pr-12 py-3 rounded-md bg-[#10131A] border border-[#2A2F3A] text-sm font-mono-ledger focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!repoUrl.trim() || isBusy}
              className="absolute right-1.5 top-1.5 bg-[#E3A542] hover:bg-[#F0B355] disabled:bg-[#2A2F3A] disabled:text-[#4A5062] text-[#10131A] p-2 rounded transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {ingestJob.status !== "idle" && (
          <div className="mt-1 p-4 rounded-md bg-[#10131A] border border-[#2A2F3A] flex flex-col gap-3">
            <div className="flex justify-between items-center text-xs font-mono-ledger">
              <span className="uppercase text-[#8C93A3] flex items-center gap-1.5 tracking-wide">
                {isBusy && <RefreshCw className="w-3 h-3 text-[#E3A542] animate-spin" />}
                {ingestJob.status === "completed" && <CheckCircle className="w-3 h-3 text-[#5FA8A0]" />}
                {ingestJob.status === "failed" && <AlertTriangle className="w-3 h-3 text-[#D9634B]" />}
                {ingestJob.status}
              </span>
              {ingestJob.total_chunks > 0 && <span className="text-[#8C93A3]">{ingestJob.total_chunks} chunks</span>}
            </div>
            <p className="text-xs text-[#8C93A3] italic font-display">{ingestJob.progress}</p>
            <div className="w-full bg-[#2A2F3A] rounded-full h-1 overflow-hidden">
              <div className={`h-full transition-all duration-500 ${
                ingestJob.status === "failed" ? "bg-[#D9634B] w-full"
                : ingestJob.status === "completed" ? "bg-[#5FA8A0] w-full"
                : ingestJob.status === "indexing" ? "bg-[#E3A542] w-[85%]"
                : ingestJob.status === "chunking" ? "bg-[#E3A542] w-[55%]"
                : ingestJob.status === "history" ? "bg-[#E3A542] w-[30%]"
                : "bg-[#E3A542] w-[15%]"
              }`}></div>
            </div>
            {ingestJob.error && (
              <div className="mt-1 p-2 bg-[#D9634B]/10 border border-[#D9634B]/30 rounded text-[11px] text-[#D9634B] font-mono-ledger">
                {ingestJob.error}
              </div>
            )}
            {ingestJob.status === "completed" && (
              <button
                onClick={() => navigate("/chat")}
                className="mt-1 bg-[#5FA8A0]/10 hover:bg-[#5FA8A0]/20 text-[#5FA8A0] border border-[#5FA8A0]/30 px-4 py-2 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-all"
              >
                Go ask the codebase
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#191D26] border border-[#2A2F3A] rounded-lg p-6 flex flex-col gap-4">
        <h2 className="font-display text-lg font-medium flex items-center gap-2">
          <History className="w-4 h-4 text-[#8C93A3]" />
          Ingested codebases
        </h2>
        {historyRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-[#4A5062] p-6">
            <BookOpen className="w-7 h-7 mb-2 opacity-40" />
            <p className="text-xs">Nothing ingested yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {historyRepos.map((repo, idx) => (
              <div
                key={idx}
                onClick={() => selectActiveRepo(repo)}
                className={`group p-3 rounded-md border transition-all cursor-pointer flex items-center justify-between ${
                  activeRepo && activeRepo.url === repo.url
                    ? "bg-[#E3A542]/10 border-[#E3A542]/40"
                    : "bg-[#10131A] border-[#2A2F3A] hover:border-[#4A5062]"
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <Code2 className={`w-4 h-4 shrink-0 ${activeRepo && activeRepo.url === repo.url ? "text-[#E3A542]" : "text-[#4A5062]"}`} />
                  <div className="text-left overflow-hidden">
                    <p className="text-sm font-medium truncate">{repo.owner}/{repo.repo}</p>
                    <p className="text-[10px] text-[#8C93A3] font-mono-ledger truncate">{repo.total_chunks} chunks</p>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRepoFromHistory(repo.url); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-[#8C93A3] hover:text-[#D9634B] rounded transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}