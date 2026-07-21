import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, User, Send, Languages, ChevronRight, FileText, Lock } from "lucide-react";
import { useApp } from "../context/AppContext";

const API_BASE = "http://localhost:8000/api";

export default function ChatPage() {
  const { geminiKey, activeRepo, chatMessages, setChatMessages } = useApp();
  const [userInput, setUserInput] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [expandedSources, setExpandedSources] = useState({});
  const chatEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isAsking]);

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
      setChatMessages(prev => [...prev, { sender: "bot", text: data.answer, sources: data.sources || [] }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: "bot", text: `Something went wrong: ${err.message}`, isError: true }]);
    } finally {
      setIsAsking(false);
    }
  };

  const toggleSources = (idx) => setExpandedSources(prev => ({ ...prev, [idx]: !prev[idx] }));

  const sampleQuestions = [
    "What does AuthManager.login do?",
    "What happens if I change check_permission?",
    "Where is DEFAULT_TIMEOUT used?",
    "Why was check_permission built this way?"
  ];

  if (!activeRepo) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center">
        <Lock className="w-8 h-8 mb-3 opacity-40 mx-auto text-[#4A5062]" />
        <p className="text-sm text-[#8C93A3] mb-4">No repository selected yet.</p>
        <button onClick={() => navigate("/ingest")} className="text-sm text-[#E3A542] hover:text-[#F0B355] underline">
          Go ingest one first
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col h-[calc(100vh-140px)]">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <Languages className="w-8 h-8 text-[#E3A542] mb-4" />
            <h3 className="font-display text-xl font-medium">Start reading the codebase</h3>
            <p className="text-sm text-[#8C93A3] mt-2 leading-relaxed max-w-md">
              Ready on {activeRepo.owner}/{activeRepo.repo}. Ask about a feature, a decision, or what changing something would affect.
            </p>
            <div className="w-full mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-lg">
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
                    <button onClick={() => toggleSources(idx)} className="text-xs text-[#E3A542] hover:text-[#F0B355] font-medium flex items-center gap-1.5 font-mono-ledger">
                      <FileText className="w-3.5 h-3.5" />
                      {expandedSources[idx] ? "hide sources" : `${msg.sources.length} sources cited`}
                    </button>
                    {expandedSources[idx] && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {msg.sources.map((source, sIdx) => (
                          <div key={sIdx} className="ledger-note p-3 bg-[#10131A] rounded-r-md flex flex-col gap-1.5 text-xs pl-3">
                            <div className="flex justify-between items-start gap-2">
                              <span className="font-medium truncate max-w-[160px] font-mono-ledger">{source.file_path.split("/").pop()}</span>
                              <span className="text-[10px] text-[#8C93A3] font-mono-ledger">L{source.start_line}-{source.end_line}</span>
                            </div>
                            <p className="text-[10px] text-[#8C93A3] italic truncate">{source.function_name} · {source.type}</p>
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

      <form onSubmit={handleAsk} className="flex gap-3 pt-4 border-t border-[#2A2F3A]">
        <input
          type="text"
          placeholder="Ask about a function, a decision, or an impact..."
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          disabled={isAsking}
          className="flex-1 px-4 py-3 rounded-md bg-[#191D26] border border-[#2A2F3A] text-sm focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!userInput.trim() || isAsking}
          className="bg-[#E3A542] hover:bg-[#F0B355] disabled:bg-[#2A2F3A] disabled:text-[#4A5062] text-[#10131A] px-5 rounded-md flex items-center justify-center gap-2 transition-all font-medium text-sm"
        >
          <Send className="w-4 h-4" />
          Ask
        </button>
      </form>
    </div>
  );
}