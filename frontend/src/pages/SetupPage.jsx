import React from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ArrowRight, CheckCircle } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function SetupPage() {
  const { geminiKey, setGeminiKey } = useApp();
  const navigate = useNavigate();

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="ledger-note bg-[#191D26] rounded-r-lg p-6 flex flex-col gap-4 pl-6">
        <h2 className="font-display text-2xl font-medium flex items-center gap-2">
          <Lock className="w-5 h-5 text-[#E3A542]" />
          Your Gemini API key
        </h2>
        <p className="text-sm text-[#8C93A3] leading-relaxed">
          CodeMate runs on your own key, so nothing is shared and nobody waits on someone
          else's quota. It's kept only in this browser, never sent anywhere but Google's API.
        </p>

        <input
          type="password"
          placeholder="AIzaSy..."
          value={geminiKey}
          onChange={(e) => setGeminiKey(e.target.value)}
          className="w-full px-4 py-3 rounded-md bg-[#10131A] border border-[#2A2F3A] text-sm font-mono-ledger focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062]"
        />

        {geminiKey && (
          <div className="flex items-center gap-2 text-xs text-[#5FA8A0]">
            <CheckCircle className="w-3.5 h-3.5" />
            Key saved in this browser
          </div>
        )}

        <p className="text-xs text-[#8C93A3]">
          Free at{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-[#E3A542] hover:text-[#F0B355] underline"
          >
            aistudio.google.com
          </a>
        </p>

        <button
          onClick={() => navigate("/ingest")}
          disabled={!geminiKey.trim()}
          className="mt-2 bg-[#E3A542] hover:bg-[#F0B355] disabled:bg-[#2A2F3A] disabled:text-[#4A5062] text-[#10131A] px-5 py-3 rounded-md flex items-center justify-center gap-2 transition-all font-medium text-sm"
        >
          Continue to ingest a repository
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}