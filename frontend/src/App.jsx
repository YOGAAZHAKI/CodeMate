import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  User,
  Send,
  Code2,
  Cpu,
  Layers,
  AlertTriangle,
  CheckCircle,
  Search,
  FileText,
  ArrowRight,
  RefreshCw,
  BookOpen,
  ChevronRight,
  History,
  Trash2,
  Lock,
  Languages
} from "lucide-react";

const API_BASE = "https://codemate-production-949a.up.railway.app";

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [activeRepo, setActiveRepo] = useState(null);
  const [historyRepos, setHistoryRepos] = useState([]);
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem("codemate_gemini_key") || "");

  const handleSaveKey = (key) => {
    setGeminiKey(key);
    localStorage.setItem("codemate_gemini_key", key);
  };

  const [ingestJob, setIngestJob] = useState({
    status: "idle",
    progress: "Not started.",
    total_chunks: 0,
    error: null
  });

  const [chatMessages, setChatMessages] = useState([]);
  const [userInput, setUserInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);

  const [impactQuery, setImpactQuery] = useState("");
  const [impactResult, setImpactResult] = useState(null);
  const [isAnalyzingImpact, setIsAnalyzingImpact] = useState(false);
  const [impactError, setImpactError] = useState(null);

  const [activeTab, setActiveTab] = useState("chat");
  const [expandedSources, setExpandedSources] = useState({});

  const chatEndRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem("codemate_repos");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHistoryRepos(parsed);
        if (parsed.length > 0) setActiveRepo(parsed[0]);
      } catch (e) {
        console.error("Failed to parse history repos", e);
      }
    }
  }, []);

  const saveReposToHistory = (newRepos) => {
    setHistoryRepos(newRepos);
    localStorage.setItem("codemate_repos", JSON.stringify(newRepos));
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isAsking]);

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
              setChatMessages(prev => [
                ...prev,
                {
                  sender: "bot",
                  text: `Indexed ${data.total_chunks} functions and classes. Mixed-language comments and commit messages have been read and normalized to English. Ask me anything about this codebase, or open Dependency Impact to trace what a change would break.`,
                  isSystem: true
                }
              ]);
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
  }, [ingestJob.status, repoUrl, historyRepos]);

  const parseRepoUrl = (url) => {
    let clean = url.trim();
    if (clean.endsWith(".git")) clean = clean.slice(0, -4);
    const match = clean.match(/github\.com[:/]([^/]+)\/([^/]+)/);
    if (match) return { owner: match[1], repo: match[2] };
    const parts = clean.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
    return { owner: "unknown", repo: "repo" };
  };

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    if (!geminiKey.trim()) {
      setIngestJob({ status: "failed", progress: "Add your Gemini API key above first.", total_chunks: 0, error: "Missing API key" });
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

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!userInput.trim() || !activeRepo || isAsking) return;
    const userQ = userInput.trim();
    setUserInput("");
    setChatMessages(prev => [...prev, { sender: "user", text: userQ }]);
    setIsAsking(true);
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: activeRepo.url, question: userQ, api_key: geminiKey || null })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Server error processing query.");
      }
      const data = await res.json();
      setChatMessages(prev => [...prev, {
        sender: "bot",
        text: data.answer,
        sources: data.sources || [],
        impactAnalysis: data.impact_analysis
      }]);
    } catch (err) {
      setChatMessages(prev => [...prev, {
        sender: "bot",
        text: `Something went wrong: ${err.message}. Check that the backend is running and the Gemini API key is valid.`,
        isError: true
      }]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleDirectImpactCheck = async (e) => {
    e.preventDefault();
    if (!impactQuery.trim() || !activeRepo || isAnalyzingImpact) return;
    setIsAnalyzingImpact(true);
    setImpactResult(null);
    setImpactError(null);
    try {
      const res = await fetch(`${API_BASE}/impact/${encodeURIComponent(impactQuery.trim())}?repo_url=${encodeURIComponent(activeRepo.url)}`);
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to analyze impact.");
      }
      const data = await res.json();
      setImpactResult(data);
    } catch (err) {
      setImpactError(err.message);
    } finally {
      setIsAnalyzingImpact(false);
    }
  };

  const deleteRepoFromHistory = (urlToDelete) => {
    const updated = historyRepos.filter(r => r.url !== urlToDelete);
    saveReposToHistory(updated);
    if (activeRepo && activeRepo.url === urlToDelete) {
      setActiveRepo(updated.length > 0 ? updated[0] : null);
    }
  };

  const selectActiveRepo = (repo) => {
    setActiveRepo(repo);
    setRepoUrl(repo.url);
    setChatMessages([
      { sender: "bot", text: `Switched to ${repo.owner}/${repo.repo}. Ask me anything about this codebase.`, isSystem: true }
    ]);
  };

  const toggleSources = (msgIndex) => {
    setExpandedSources(prev => ({ ...prev, [msgIndex]: !prev[msgIndex] }));
  };

  const sampleQuestions = [
    "What does AuthManager.login do?",
    "What happens if I change check_permission?",
    "Where is DEFAULT_TIMEOUT used?",
    "Why was check_permission built this way?"
  ];

  return (
    <div className="min-h-screen bg-[#10131A] text-[#EDEAE3] font-['Inter']">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .font-display { font-family: 'Newsreader', serif; }
        .font-mono-ledger { font-family: 'JetBrains Mono', monospace; }
        .ledger-note { border-left: 2px solid #E3A542; }
        .ledger-note-teal { border-left: 2px solid #5FA8A0; }
        .ledger-note-danger { border-left: 2px solid #D9634B; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #10131A; }
        ::-webkit-scrollbar-thumb { background: #2A2F3A; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <header className="border-b border-[#2A2F3A] px-6 py-5 flex items-center justify-between bg-[#0D0F15]">
        <div className="flex items-center gap-3">
          <div className="bg-[#E3A542] text-[#10131A] p-2 rounded-md">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight flex items-center gap-2.5">
              CodeMate
              <span className="text-[10px] font-mono-ledger tracking-wide text-[#8C93A3] border border-[#2A2F3A] px-1.5 py-0.5 rounded">v1.0.0</span>
            </h1>
            <p className="text-xs text-[#8C93A3] mt-0.5">Reads a codebase's history, in any language it was written in</p>
          </div>
        </div>

        {activeRepo && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded border border-[#2A2F3A] bg-[#191D26] text-sm font-mono-ledger">
            <Code2 className="w-3.5 h-3.5 text-[#8C93A3]" />
            <span className="text-[#8C93A3]">active</span>
            <span className="text-[#EDEAE3]">{activeRepo.owner}/{activeRepo.repo}</span>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

        {/* Left Panel */}
        <section className="lg:col-span-4 flex flex-col gap-6">

          <div className="ledger-note bg-[#191D26] rounded-r-lg p-5 flex flex-col gap-3 pl-5">
            <h2 className="font-display text-base font-medium flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#E3A542]" />
              Your Gemini API key
            </h2>
            <p className="text-xs text-[#8C93A3] leading-relaxed">
              CodeMate runs on your own key, so nothing is shared and nobody waits on someone else's quota. Kept only in this browser.
            </p>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={geminiKey}
              onChange={(e) => handleSaveKey(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-[#10131A] border border-[#2A2F3A] text-sm font-mono-ledger focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062]"
            />
            <p className="text-[10px] text-[#8C93A3]">
              Free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[#E3A542] hover:text-[#F0B355] underline">aistudio.google.com</a>
            </p>
          </div>

          <div className="bg-[#191D26] border border-[#2A2F3A] rounded-lg p-5 flex flex-col gap-4">
            <h2 className="font-display text-lg font-medium flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#E3A542]" />
              Ingest a repository
            </h2>
            <p className="text-xs text-[#8C93A3] leading-relaxed">
              Paste a public GitHub URL. Comments and commit messages written in Tamil, Hindi, or mixed-language script are detected and normalized automatically.
            </p>

            <form onSubmit={handleIngest} className="flex flex-col gap-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  disabled={ingestJob.status !== "idle" && ingestJob.status !== "completed" && ingestJob.status !== "failed"}
                  className="w-full pl-3 pr-10 py-2.5 rounded-md bg-[#10131A] border border-[#2A2F3A] text-sm font-mono-ledger focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062] disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!repoUrl.trim() || (ingestJob.status !== "idle" && ingestJob.status !== "completed" && ingestJob.status !== "failed")}
                  className="absolute right-1.5 top-1.5 bg-[#E3A542] hover:bg-[#F0B355] disabled:bg-[#2A2F3A] disabled:text-[#4A5062] text-[#10131A] p-1.5 rounded transition-colors"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>

            {ingestJob.status !== "idle" && (
              <div className="mt-1 p-4 rounded-md bg-[#10131A] border border-[#2A2F3A] flex flex-col gap-3">
                <div className="flex justify-between items-center text-xs font-mono-ledger">
                  <span className="uppercase text-[#8C93A3] flex items-center gap-1.5 tracking-wide">
                    {ingestJob.status !== "completed" && ingestJob.status !== "failed" && (
                      <RefreshCw className="w-3 h-3 text-[#E3A542] animate-spin" />
                    )}
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
              </div>
            )}
          </div>

          <div className="bg-[#191D26] border border-[#2A2F3A] rounded-lg p-5 flex-1 flex flex-col gap-4 max-h-[350px] lg:max-h-none overflow-hidden">
            <h2 className="font-display text-lg font-medium flex items-center gap-2">
              <History className="w-4 h-4 text-[#8C93A3]" />
              Ingested codebases
            </h2>

            {historyRepos.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-[#4A5062] p-6">
                <BookOpen className="w-7 h-7 mb-2 opacity-40" />
                <p className="text-xs">Nothing ingested yet.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2">
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
        </section>

        {/* Right Panel */}
        <section className="lg:col-span-8 bg-[#191D26] border border-[#2A2F3A] rounded-lg overflow-hidden flex flex-col">

          <div className="flex border-b border-[#2A2F3A]">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 py-3.5 px-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-all ${
                activeTab === "chat" ? "border-[#E3A542] text-[#EDEAE3]" : "border-transparent text-[#8C93A3] hover:text-[#EDEAE3]"
              }`}
            >
              <Bot className="w-4 h-4" />
              Ask the codebase
            </button>
            <button
              onClick={() => setActiveTab("impact")}
              className={`flex-1 py-3.5 px-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-all ${
                activeTab === "impact" ? "border-[#E3A542] text-[#EDEAE3]" : "border-transparent text-[#8C93A3] hover:text-[#EDEAE3]"
              }`}
            >
              <Layers className="w-4 h-4" />
              Dependency impact
            </button>
          </div>

          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col min-h-[500px] max-h-[650px] overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-xl mx-auto">
                    <div className="text-[#E3A542] mb-4">
                      <Languages className="w-8 h-8" />
                    </div>
                    <h3 className="font-display text-xl font-medium">Start reading the codebase</h3>
                    <p className="text-sm text-[#8C93A3] mt-2 leading-relaxed">
                      {activeRepo
                        ? `Ready on ${activeRepo.owner}/${activeRepo.repo}. Ask about a feature, a decision, or what changing something would affect.`
                        : "Ingest a repository on the left, or select one already indexed, to begin."}
                    </p>
                    {activeRepo && (
                      <div className="w-full mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                        {sampleQuestions.map((q, idx) => (
                          <button
                            key={idx}
                            onClick={() => setUserInput(q)}
                            className="p-3 text-xs bg-[#10131A] border border-[#2A2F3A] hover:border-[#E3A542]/50 rounded-md text-[#8C93A3] hover:text-[#EDEAE3] transition-all text-left flex items-start gap-2 font-mono-ledger"
                          >
                            <ChevronRight className="w-3.5 h-3.5 text-[#E3A542] mt-0.5 shrink-0" />
                            <span>{q}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 max-w-[85%] ${msg.sender === "user" ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                      <div className={`p-2 rounded-md shrink-0 h-8 w-8 flex items-center justify-center ${
                        msg.sender === "user" ? "bg-[#5FA8A0]/20 text-[#5FA8A0]"
                        : msg.isSystem ? "bg-[#2A2F3A] text-[#8C93A3]"
                        : "bg-[#E3A542]/20 text-[#E3A542]"
                      }`}>
                        {msg.sender === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className={`p-4 rounded-md text-sm leading-relaxed whitespace-pre-wrap ${
                          msg.sender === "user" ? "bg-[#5FA8A0]/10 border border-[#5FA8A0]/20 text-[#EDEAE3]"
                          : msg.isSystem ? "bg-[#10131A] border border-[#2A2F3A] text-[#8C93A3] font-display italic"
                          : msg.isError ? "ledger-note-danger bg-[#D9634B]/5 text-[#D9634B] font-mono-ledger pl-4"
                          : "ledger-note bg-[#10131A] text-[#EDEAE3] pl-4"
                        }`}>
                          {msg.text}
                        </div>

                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-1">
                            <button
                              onClick={() => toggleSources(idx)}
                              className="text-xs text-[#E3A542] hover:text-[#F0B355] font-medium flex items-center gap-1.5 font-mono-ledger"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              {expandedSources[idx] ? "hide sources" : `${msg.sources.length} sources cited`}
                            </button>

                            {expandedSources[idx] && (
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {msg.sources.map((source, sIdx) => (
                                  <div key={sIdx} className="ledger-note p-3 bg-[#10131A] rounded-r-md flex flex-col gap-1.5 text-xs pl-3">
                                    <div className="flex justify-between items-start gap-2">
                                      <span className="font-medium truncate max-w-[160px] font-mono-ledger" title={source.file_path}>
                                        {source.file_path.split("/").pop()}
                                      </span>
                                      <span className="text-[10px] text-[#8C93A3] font-mono-ledger">L{source.start_line}-{source.end_line}</span>
                                    </div>
                                    <p className="text-[10px] text-[#8C93A3] italic truncate">{source.function_name} · {source.type}</p>
                                    <div className="mt-1 flex items-center justify-between border-t border-[#2A2F3A] pt-1.5 text-[9px] text-[#8C93A3] font-mono-ledger">
                                      <span>{source.commit_hash.slice(0, 7)}</span>
                                      <span className="truncate max-w-[90px]">{source.commit_author}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {isAsking && (
                  <div className="flex gap-3 max-w-[85%] mr-auto items-center">
                    <div className="p-2 rounded-md shrink-0 h-8 w-8 flex items-center justify-center bg-[#E3A542]/20 text-[#E3A542]">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="flex items-center gap-1.5 p-4 bg-[#10131A] border border-[#2A2F3A] rounded-md">
                      <span className="w-1.5 h-1.5 bg-[#E3A542] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-[#E3A542] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-[#E3A542] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      <span className="text-xs text-[#8C93A3] ml-2 font-mono-ledger">reading the history...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 border-t border-[#2A2F3A] bg-[#10131A]/50">
                <form onSubmit={handleAsk} className="flex gap-3">
                  <input
                    type="text"
                    placeholder={activeRepo ? "Ask about a function, a decision, or an impact..." : "Select or ingest a repository first..."}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    disabled={!activeRepo || isAsking}
                    className="flex-1 px-4 py-3 rounded-md bg-[#191D26] border border-[#2A2F3A] text-sm focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062] disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!userInput.trim() || !activeRepo || isAsking}
                    className="bg-[#E3A542] hover:bg-[#F0B355] disabled:bg-[#2A2F3A] disabled:text-[#4A5062] text-[#10131A] px-5 rounded-md flex items-center justify-center gap-2 transition-all font-medium text-sm"
                  >
                    <Send className="w-4 h-4" />
                    Ask
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === "impact" && (
            <div className="flex-1 p-6 flex flex-col gap-6 overflow-y-auto max-h-[750px]">
              <div className="flex flex-col gap-2">
                <h3 className="font-display text-xl font-medium flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[#E3A542]" />
                  Dependency impact
                </h3>
                <p className="text-xs text-[#8C93A3] leading-relaxed">
                  Enter a function, variable, or class name to see who calls it, and what might break if it changes.
                </p>
              </div>

              <form onSubmit={handleDirectImpactCheck} className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3.5 w-4 h-4 text-[#4A5062]" />
                  <input
                    type="text"
                    placeholder="e.g. check_permission"
                    value={impactQuery}
                    onChange={(e) => setImpactQuery(e.target.value)}
                    disabled={!activeRepo || isAnalyzingImpact}
                    className="w-full pl-9 pr-4 py-3 rounded-md bg-[#10131A] border border-[#2A2F3A] text-sm font-mono-ledger focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062] disabled:opacity-50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!impactQuery.trim() || !activeRepo || isAnalyzingImpact}
                  className="bg-[#E3A542] hover:bg-[#F0B355] disabled:bg-[#2A2F3A] disabled:text-[#4A5062] text-[#10131A] px-6 rounded-md flex items-center justify-center gap-2 transition-all font-medium text-sm shrink-0"
                >
                  {isAnalyzingImpact ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                  Analyze
                </button>
              </form>

              {impactError && (
                <div className="ledger-note-danger p-4 bg-[#D9634B]/5 text-xs text-[#D9634B] font-mono-ledger pl-4">
                  {impactError}
                </div>
              )}

              {impactResult && (
                <div className="flex flex-col gap-5 border-t border-[#2A2F3A] pt-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "query", value: impactResult.function_name, mono: true },
                      { label: "code calls", value: impactResult.code_references_count },
                      { label: "files impacted", value: impactResult.files_impacted_count },
                      { label: "comment refs", value: impactResult.comment_references_count }
                    ].map((stat, i) => (
                      <div key={i} className="p-3 bg-[#10131A] border border-[#2A2F3A] rounded-md text-center">
                        <p className="text-[10px] uppercase font-mono-ledger text-[#8C93A3] tracking-wide">{stat.label}</p>
                        <p className={`text-lg font-medium mt-1 ${stat.mono ? "font-mono-ledger text-sm truncate" : "font-display text-[#E3A542]"}`}>{stat.value}</p>
                      </div>
                    ))}
                  </div>

                  {impactResult.code_references_count > 0 ? (
                    <div className="ledger-note p-4 bg-[#E3A542]/5 text-[#E3A542] flex items-start gap-3 text-xs leading-relaxed pl-4">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div><span className="font-medium">This has active dependents.</span> Other files call this directly — keep the signature backward-compatible or update every occurrence below.</div>
                    </div>
                  ) : (
                    <div className="ledger-note-teal p-4 bg-[#5FA8A0]/5 text-[#5FA8A0] flex items-start gap-3 text-xs leading-relaxed pl-4">
                      <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div><span className="font-medium">Safe to change.</span> No active code references found elsewhere in the repository.</div>
                    </div>
                  )}

                  {impactResult.references.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <h4 className="text-sm font-medium font-display">References</h4>
                      <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto pr-1">
                        {impactResult.references.map((ref, idx) => (
                          <div key={idx} className={`p-3 bg-[#10131A] border rounded-md flex flex-col gap-2 ${ref.is_comment ? "border-[#2A2F3A]" : "border-[#4A5062]"}`}>
                            <div className="flex items-center justify-between text-[10px] font-mono-ledger">
                              <span className="text-[#8C93A3] flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5" />
                                {ref.file_path}
                              </span>
                              <span className="text-[#8C93A3]">L{ref.line_number}</span>
                            </div>
                            <div className="p-2 bg-[#191D26] rounded text-xs font-mono-ledger overflow-x-auto whitespace-pre">
                              {ref.line_content}
                            </div>
                            <span className={`text-[9px] font-mono-ledger uppercase w-fit px-1.5 py-0.5 rounded ${ref.is_comment ? "text-[#8C93A3]" : "text-[#E3A542] bg-[#E3A542]/10"}`}>
                              {ref.is_comment ? "comment mention" : "active call"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!impactResult && !isAnalyzingImpact && !activeRepo && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#4A5062]">
                  <Lock className="w-7 h-7 mb-2 opacity-40" />
                  <p className="text-xs">Select or ingest a repository first.</p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="py-4 border-t border-[#2A2F3A] text-center text-xs text-[#4A5062] font-mono-ledger">
        CodeMate — codebase intelligence, across languages
      </footer>
    </div>
  );
}