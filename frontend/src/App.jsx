import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import Navbar from "./components/Navbar";
import SetupPage from "./pages/SetupPage";
import IngestPage from "./pages/IngestPage";
import ChatPage from "./pages/ChatPage";
import ImpactPage from "./pages/ImpactPage";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
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

          <Navbar />

          <main>
            <Routes>
              <Route path="/" element={<Navigate to="/setup" replace />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/ingest" element={<IngestPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/impact" element={<ImpactPage />} />
            </Routes>
          </main>

          <footer className="py-4 border-t border-[#2A2F3A] text-center text-xs text-[#4A5062] font-mono-ledger">
            CodeMate — codebase intelligence, across languages
          </footer>
        </div>
      </BrowserRouter>
    </AppProvider>
  );
}