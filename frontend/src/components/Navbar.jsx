import React from "react";
import { NavLink } from "react-router-dom";
import { Cpu, Lock, Layers, Bot, GitBranch, Code2 } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function Navbar() {
  const { activeRepo, geminiKey } = useApp();

  const linkClass = ({ isActive }) =>
    `px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2 transition-colors ${
      isActive ? "bg-[#E3A542]/10 text-[#E3A542]" : "text-[#8C93A3] hover:text-[#EDEAE3]"
    }`;

  return (
    <header className="border-b border-[#2A2F3A] bg-[#0D0F15]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-[#E3A542] text-[#10131A] p-2 rounded-md">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight">CodeMate</h1>
            <p className="text-xs text-[#8C93A3] -mt-0.5">Reads a codebase's history, in any language</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 bg-[#191D26] border border-[#2A2F3A] rounded-lg p-1">
          <NavLink to="/setup" className={linkClass}>
            <Lock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">API Key</span>
            {!geminiKey && <span className="w-1.5 h-1.5 rounded-full bg-[#D9634B]" />}
          </NavLink>
          <NavLink to="/ingest" className={linkClass}>
            <GitBranch className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ingest</span>
          </NavLink>
          <NavLink to="/chat" className={linkClass}>
            <Bot className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ask</span>
          </NavLink>
          <NavLink to="/impact" className={linkClass}>
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Impact</span>
          </NavLink>
        </nav>

        {activeRepo && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded border border-[#2A2F3A] bg-[#191D26] text-sm font-mono-ledger">
            <Code2 className="w-3.5 h-3.5 text-[#8C93A3]" />
            <span className="text-[#EDEAE3]">{activeRepo.owner}/{activeRepo.repo}</span>
          </div>
        )}
      </div>
    </header>
  );
}