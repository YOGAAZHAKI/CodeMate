import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, Search, RefreshCw, AlertTriangle, CheckCircle, FileText, Lock } from "lucide-react";
import { useApp } from "../context/AppContext";

const API_BASE = "http://localhost:8000/api";

export default function ImpactPage() {
  const { activeRepo } = useApp();
  const [impactQuery, setImpactQuery] = useState("");
  const [impactResult, setImpactResult] = useState(null);
  const [isAnalyzingImpact, setIsAnalyzingImpact] = useState(false);
  const [impactError, setImpactError] = useState(null);
  const navigate = useNavigate();

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
    <div className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-2xl font-medium flex items-center gap-2">
          <Layers className="w-5 h-5 text-[#E3A542]" />
          Dependency impact
        </h3>
        <p className="text-sm text-[#8C93A3] leading-relaxed">
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
            disabled={isAnalyzingImpact}
            className="w-full pl-9 pr-4 py-3 rounded-md bg-[#191D26] border border-[#2A2F3A] text-sm font-mono-ledger focus:outline-none focus:border-[#E3A542] transition-colors placeholder:text-[#4A5062] disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!impactQuery.trim() || isAnalyzingImpact}
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
              <div key={i} className="p-3 bg-[#191D26] border border-[#2A2F3A] rounded-md text-center">
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
              <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
                {impactResult.references.map((ref, idx) => (
                  <div key={idx} className={`p-3 bg-[#191D26] border rounded-md flex flex-col gap-2 ${ref.is_comment ? "border-[#2A2F3A]" : "border-[#4A5062]"}`}>
                    <div className="flex items-center justify-between text-[10px] font-mono-ledger">
                      <span className="text-[#8C93A3] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        {ref.file_path}
                      </span>
                      <span className="text-[#8C93A3]">L{ref.line_number}</span>
                    </div>
                    <div className="p-2 bg-[#10131A] rounded text-xs font-mono-ledger overflow-x-auto whitespace-pre">
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
    </div>
  );
}