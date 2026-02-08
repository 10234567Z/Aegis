"use client";

import { Header } from "@/components/Header";
import { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AnalyzeEvent = {
  type: "analyze";
  address: string;
  is_fraud: boolean;
  score: number;
  verdict: "safe" | "suspicious" | "dangerous";
  recommendation: "approve" | "review" | "reject";
  timestamp: string;
};

type ReviewEvent = {
  type: "review";
  proposalId: string;
  mlAnalysis: { score: number; verdict: string; flagged: boolean };
  guardianStatus: {
    submitted: boolean;
    proposalId?: string;
    message: string;
    error?: string;
  };
  senderENS?: string;
  proposal?: {
    txHash: string;
    sender: string;
    target: string;
    value: string;
    amount: number;
    chainId: number;
  };
  timestamp: string;
};

type TxEntry = {
  id: string;
  address: string;
  ens?: string;
  txHash?: string;
  target?: string;
  value?: string;
  amount?: number;
  score: number;
  verdict: string;
  recommendation: string;
  isFraud: boolean;
  chainId?: number;
  timestamp: string;
  source: "analyze" | "review" | "execution";
};

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function scoreColor(score: number) {
  if (score <= 30) return "text-brand";          // green = safe
  if (score <= 60) return "text-yellow-400";     // yellow = mid
  return "text-red-400";                         // red = dangerous
}

function verdictBadge(verdict: string) {
  const base = "px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide";
  switch (verdict) {
    case "safe":
      return `${base} bg-brand/15 text-brand`;
    case "suspicious":
      return `${base} bg-yellow-500/15 text-yellow-400`;
    case "dangerous":
      return `${base} bg-red-500/15 text-red-400`;
    default:
      return `${base} bg-border text-muted`;
  }
}

function recBadge(rec: string) {
  const base = "px-2.5 py-0.5 rounded-full text-xs font-medium";
  switch (rec) {
    case "approve":
      return `${base} bg-brand/10 text-brand border border-brand/20`;
    case "review":
      return `${base} bg-yellow-500/10 text-yellow-400 border border-yellow-500/20`;
    case "reject":
      return `${base} bg-red-500/10 text-red-400 border border-red-500/20`;
    default:
      return `${base} bg-border text-muted`;
  }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function truncAddr(addr: string) {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function etherscanTxUrl(txHash: string, chainId?: number) {
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  return `https://etherscan.io/tx/${txHash}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ExplorerPage() {
  const [transactions, setTransactions] = useState<TxEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "safe" | "suspicious" | "dangerous">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "analyze" | "review" | "execution">("all");
  const eventSourceRef = useRef<EventSource | null>(null);
  const [sseStatus, setSseStatus] = useState<"connecting" | "open" | "error">("connecting");

  /* SSE connection */
  useEffect(() => {
    console.log("[SSE] Connecting to /api/events (proxy) ...");
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      console.log("[SSE] Connection opened, readyState:", es.readyState);
      setSseStatus("open");
    };
    es.onerror = (err) => {
      console.error("[SSE] Error, readyState:", es.readyState, err);
      setSseStatus("error");
    };

    es.addEventListener("analyze", (e) => {
      try {
        console.log("[SSE] analyze event received:", e.data);
        const data = JSON.parse(e.data) as Omit<AnalyzeEvent, "type" | "timestamp">;
        const entry: TxEntry = {
          id: `analyze-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          address: data.address,
          score: data.score,
          verdict: data.verdict,
          recommendation: data.recommendation,
          isFraud: data.is_fraud,
          timestamp: new Date().toISOString(),
          source: "analyze",
        };
        setTransactions((prev) => [entry, ...prev]);
      } catch { /* ignore malformed */ }
    });

    es.addEventListener("review", (e) => {
      try {
        console.log("[SSE] review event received:", e.data);
        const data = JSON.parse(e.data) as Omit<ReviewEvent, "type" | "timestamp">;
        const entry: TxEntry = {
          id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          address: data.proposal?.sender ?? "unknown",
          ens: data.senderENS,
          target: data.proposal?.target,
          value: data.proposal?.value,
          amount: data.proposal?.amount,
          score: data.mlAnalysis.score,
          verdict: data.mlAnalysis.verdict,
          recommendation: data.mlAnalysis.flagged ? "review" : "approve",
          isFraud: data.mlAnalysis.flagged,
          chainId: data.proposal?.chainId,
          timestamp: new Date().toISOString(),
          source: "review",
        };
        setTransactions((prev) => [entry, ...prev]);
      } catch { /* ignore malformed */ }
    });

    es.addEventListener("execution", (e) => {
      try {
        console.log("[SSE] execution event received:", e.data);
        const data = JSON.parse(e.data);
        const entry: TxEntry = {
          id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          address: data.sender ?? "unknown",
          ens: data.senderENS,
          txHash: data.txHash,
          target: data.target,
          value: data.value,
          amount: data.amount ? Number(data.amount) : undefined,
          score: data.score ?? 0,
          verdict: data.verdict ?? "safe",
          recommendation: data.recommendation ?? "approve",
          isFraud: data.isFraud ?? false,
          chainId: data.chainId,
          timestamp: new Date().toISOString(),
          source: "execution",
        };
        setTransactions((prev) => [entry, ...prev]);
      } catch { /* ignore malformed */ }
    });

    return () => es.close();
  }, []);

  /* Filtering */
  const filtered = transactions.filter((tx) => {
    if (filter !== "all" && tx.verdict !== filter) return false;
    if (sourceFilter !== "all" && tx.source !== sourceFilter) return false;
    return true;
  });

  /* Stats */
  const total = transactions.length;
  const safeCount = transactions.filter((t) => t.verdict === "safe").length;
  const suspCount = transactions.filter((t) => t.verdict === "suspicious").length;
  const dangCount = transactions.filter((t) => t.verdict === "dangerous").length;
  const avgScore = total > 0 ? Math.round(transactions.reduce((s, t) => s + t.score, 0) / total) : 0;

  return (
    <div className="relative flex size-full min-h-screen flex-col overflow-x-hidden bg-surface">
      <div className="layout-container flex h-full grow flex-col">
        <Header />
        <main className="px-4 md:px-10 lg:px-20 flex flex-1 flex-col py-8">
          <div className="w-full mx-auto">
            {/* Title row */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-white text-2xl font-bold mb-1">TX Explorer</h1>
                <p className="text-muted text-sm">
                  Live feed from the Aegis ML agent — every analyzed &amp; reviewed transaction.
                </p>
              </div>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                sseStatus === "open"
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : sseStatus === "error"
                  ? "border-red-500/40 bg-red-500/10 text-red-400"
                  : "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
              }`}>
                <span className={`inline-block w-2 h-2 rounded-full ${
                  sseStatus === "open" ? "bg-brand animate-pulse" : sseStatus === "error" ? "bg-red-400" : "bg-yellow-400 animate-pulse"
                }`} />
                {sseStatus === "open" ? "Live" : sseStatus === "error" ? "Disconnected" : "Connecting..."}
              </div>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {[
                { label: "Total TXs", value: total.toString(), color: "text-white" },
                { label: "Safe", value: safeCount.toString(), color: "text-brand" },
                { label: "Suspicious", value: suspCount.toString(), color: "text-yellow-400" },
                { label: "Dangerous", value: dangCount.toString(), color: "text-red-400" },
                { label: "Avg Score", value: avgScore.toString(), color: scoreColor(avgScore) },
              ].map(({ label, value, color }) => (
                <div key={label} className="p-3 border border-border rounded-xl bg-surfaceAlt">
                  <div className="text-muted text-xs mb-0.5">{label}</div>
                  <div className={`font-semibold text-lg ${color}`}>{value}</div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-muted text-xs uppercase tracking-wide mr-1">Verdict:</span>
              {(["all", "safe", "suspicious", "dangerous"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setFilter(v)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    filter === v
                      ? "border-brand/50 bg-brand/10 text-brand"
                      : "border-border bg-surfaceAlt text-muted hover:text-white"
                  }`}
                >
                  {v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}

              <span className="text-border mx-2">|</span>

              <span className="text-muted text-xs uppercase tracking-wide mr-1">Source:</span>
              {(["all", "analyze", "review", "execution"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    sourceFilter === s
                      ? "border-brand/50 bg-brand/10 text-brand"
                      : "border-border bg-surfaceAlt text-muted hover:text-white"
                  }`}
                >
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {/* Transaction table */}
            <div className="border border-border rounded-xl overflow-hidden bg-surfaceAlt">
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[900px]">
                  <thead>
                    <tr className="border-b border-border text-muted text-xs uppercase bg-input">
                      <th className="p-3 font-medium">Address / ENS</th>
                      <th className="p-3 font-medium">Score</th>
                      <th className="p-3 font-medium">Verdict</th>
                      <th className="p-3 font-medium">Action</th>
                      <th className="p-3 font-medium">Source</th>
                      <th className="p-3 font-medium">Tx Hash</th>
                      <th className="p-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-muted text-sm">
                          No transactions match the current filters.
                        </td>
                      </tr>
                    )}
                    {filtered.map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-b border-border last:border-0 text-sm hover:bg-input/50 transition-colors"
                      >
                        {/* Address */}
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="text-white font-medium font-mono text-xs">
                              {truncAddr(tx.address)}
                            </span>
                            {tx.ens && (
                              <span className="text-brand text-xs">{tx.ens}</span>
                            )}
                          </div>
                        </td>

                        {/* Score */}
                        <td className="p-3">
                          <span className={`font-bold text-base ${scoreColor(tx.score)}`}>
                            {tx.score}
                          </span>
                        </td>

                        {/* Verdict */}
                        <td className="p-3">
                          <span className={verdictBadge(tx.verdict)}>{tx.verdict}</span>
                        </td>

                        {/* Action / Recommendation */}
                        <td className="p-3">
                          <span className={recBadge(tx.recommendation)}>{tx.recommendation}</span>
                        </td>

                        {/* Source */}
                        <td className="p-3">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded ${
                              tx.source === "execution"
                                ? "bg-brand/10 text-brand"
                                : tx.source === "review"
                                  ? "bg-blue-500/10 text-blue-400"
                                  : "bg-border text-muted"
                            }`}
                          >
                            {tx.source}
                          </span>
                        </td>

                        {/* Tx Hash with Etherscan link */}
                        <td className="p-3 font-mono text-xs">
                          {tx.txHash ? (
                            <a
                              href={etherscanTxUrl(tx.txHash, tx.chainId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand hover:underline"
                            >
                              {truncAddr(tx.txHash)}
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        {/* Time */}
                        <td className="p-3 text-muted text-xs whitespace-nowrap">
                          {timeAgo(tx.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
