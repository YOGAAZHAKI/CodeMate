import React, { createContext, useContext, useState, useEffect } from "react";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [geminiKey, setGeminiKeyState] = useState(() => localStorage.getItem("codemate_gemini_key") || "");
  const [repoUrl, setRepoUrl] = useState("");
  const [activeRepo, setActiveRepo] = useState(null);
  const [historyRepos, setHistoryRepos] = useState([]);
  const [ingestJob, setIngestJob] = useState({
    status: "idle",
    progress: "Not started.",
    total_chunks: 0,
    error: null
  });
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    const saved = localStorage.getItem("codemate_repos");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHistoryRepos(parsed);
        if (parsed.length > 0) {
          setActiveRepo(parsed[0]);
          setRepoUrl(parsed[0].url);
        }
      } catch (e) {
        console.error("Failed to parse history repos", e);
      }
    }
  }, []);

  const setGeminiKey = (key) => {
    setGeminiKeyState(key);
    localStorage.setItem("codemate_gemini_key", key);
  };

  const saveReposToHistory = (newRepos) => {
    setHistoryRepos(newRepos);
    localStorage.setItem("codemate_repos", JSON.stringify(newRepos));
  };

  const selectActiveRepo = (repo) => {
    setActiveRepo(repo);
    setRepoUrl(repo.url);
    setChatMessages([
      { sender: "bot", text: `Switched to ${repo.owner}/${repo.repo}. Ask me anything about this codebase.`, isSystem: true }
    ]);
  };

  const deleteRepoFromHistory = (urlToDelete) => {
    const updated = historyRepos.filter(r => r.url !== urlToDelete);
    saveReposToHistory(updated);
    if (activeRepo && activeRepo.url === urlToDelete) {
      setActiveRepo(updated.length > 0 ? updated[0] : null);
      setRepoUrl(updated.length > 0 ? updated[0].url : "");
    }
  };

  return (
    <AppContext.Provider value={{
      geminiKey, setGeminiKey,
      repoUrl, setRepoUrl,
      activeRepo, setActiveRepo,
      historyRepos, setHistoryRepos, saveReposToHistory,
      ingestJob, setIngestJob,
      chatMessages, setChatMessages,
      selectActiveRepo, deleteRepoFromHistory
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}