import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AiAnalysisActivityEntry,
  type AiAnalysisMetrics,
  type AiAnalysisStatus,
  type AiAnalysisType,
  computeAiAnalysisMetrics,
  computeLiveEntryElapsedMs,
  formatAnalysisDuration,
  formatElapsedCounter,
} from '../engine/activityMonitorEngine';
import type { LlmEngineConfig } from '../engine/whalePipelineRuntime';
import type { WhaleCandidate } from '../engine/whaleScannerEngine';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';

interface AiAnalysisMonitorViewProps {
  logs: AiAnalysisActivityEntry[];
  candidates: WhaleCandidate[];
  llmEngineConfig: LlmEngineConfig;
  onRunAiAnalysis: (params: {
    candidate_id?: string;
    ticker?: string;
    analysis_type?: AiAnalysisType;
    custom_instruction?: string;
    execution_mode?:
      | 'auto'
      | 'live_endpoint_only'
      | 'deterministic_synthesis'
      | 'simulate_error';
  }) => Promise<AiAnalysisActivityEntry | null>;
  onProcessPending?: (params?: {
    analysis_id?: string;
    candidate_id?: string;
    process_all?: boolean;
  }) => Promise<void>;
  onRefreshLogs: () => Promise<void>;
  onClearLogs: () => Promise<void>;
  onOpenLlmSettings: () => void;
}

const ANALYSIS_TYPE_LABELS: Record<AiAnalysisType, string> = {
  stage1_entry_decision: 'Stage-1 AI: Trade Entry Decision Gate',
  stage2_position_size_risk_strategy:
    'Stage-2 AI: Position Size, Risk & Initial Strategy',
  holding_stage1_risk_evaluation:
    'Holdings Stage-1 AI: Position Risk & Flow Evaluation',
  holding_stage2_exit_plan:
    'Holdings Stage-2 AI: Formulaic Exit / Hedge Execution Plan',
  whale_candidate_evaluation: 'Whale Candidate Evaluation',
  stock_technical_confirmation: 'Alpaca 5m Technical Confirmation',
  regime_tide_synthesis: 'Market Tide & GEX Synthesis',
  custom_prompt: 'Custom Operator Prompt',
};

const ANALYSIS_STAGE_BADGE: Record<
  AiAnalysisType,
  { label: string; className: string }
> = {
  stage1_entry_decision: {
    label: 'STAGE-1 ENTRY DECISION',
    className: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  },
  stage2_position_size_risk_strategy: {
    label: 'STAGE-2 SIZE / RISK / STRATEGY',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  },
  holding_stage1_risk_evaluation: {
    label: 'HOLDING STAGE-1 RISK GATE',
    className: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  },
  holding_stage2_exit_plan: {
    label: 'HOLDING STAGE-2 EXIT PLAN',
    className: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  },
  whale_candidate_evaluation: {
    label: 'CANDIDATE FLOW EVAL',
    className: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
  },
  stock_technical_confirmation: {
    label: 'ALPACA 5M TECH CONFIRM',
    className: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  },
  regime_tide_synthesis: {
    label: 'REGIME & TIDE SYNTHESIS',
    className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  },
  custom_prompt: {
    label: 'CUSTOM PROMPT',
    className: 'bg-slate-700/50 text-slate-300 border-slate-600',
  },
};

export const AiAnalysisMonitorView: React.FC<AiAnalysisMonitorViewProps> = ({
  logs,
  candidates,
  llmEngineConfig,
  onRunAiAnalysis,
  onProcessPending,
  onRefreshLogs,
  onClearLogs,
  onOpenLlmSettings,
}) => {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    () => candidates[0]?.candidate_id ?? ''
  );
  const [analysisType, setAnalysisType] = useState<AiAnalysisType>(
    'stage1_entry_decision'
  );
  const [executionMode, setExecutionMode] = useState<
    'auto' | 'live_endpoint_only' | 'deterministic_synthesis'
  >('auto');
  const [customInstruction, setCustomInstruction] = useState<string>('');
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [simulatingError, setSimulatingError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [processingQueueId, setProcessingQueueId] = useState<string | null>(
    null
  );
  const [autoPollEnabled, setAutoPollEnabled] = useState<boolean>(true);

  const [statusFilter, setStatusFilter] = useState<'all' | AiAnalysisStatus>(
    'all'
  );
  const [typeFilter, setTypeFilter] = useState<'ALL' | AiAnalysisType>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(
    () => logs[0]?.analysis_id ?? null
  );

  const [inputTab, setInputTab] = useState<
    'prompts' | 'request_json' | 'context'
  >('prompts');
  const [outputTab, setOutputTab] = useState<'formatted' | 'raw_json'>(
    'formatted'
  );
  const [copiedKey, setCopiedKey] = useState<'input' | 'output' | null>(null);

  // High-frequency client clock (100ms) for live ticking Elapsed Time Counter on currently processing rows in the Ledger
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const firstSeenStartMapRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const currentClock = Date.now();
    const activeIds = new Set<string>();
    for (const item of logs) {
      if (item.status === 'processing' || item.status === 'pending') {
        activeIds.add(item.analysis_id);
        if (!firstSeenStartMapRef.current.has(item.analysis_id)) {
          const iso =
            item.status === 'processing'
              ? item.queue_metadata?.started_at || item.timestamp
              : item.queue_metadata?.queued_at || item.timestamp;
          const parsed = iso ? Date.parse(iso) : NaN;
          const initialStart = Number.isFinite(parsed)
            ? Math.min(parsed, currentClock - Math.max(0, item.latency_ms))
            : currentClock - Math.max(50, item.latency_ms);
          firstSeenStartMapRef.current.set(item.analysis_id, initialStart);
        }
      }
    }
    for (const key of firstSeenStartMapRef.current.keys()) {
      if (!activeIds.has(key)) {
        firstSeenStartMapRef.current.delete(key);
      }
    }
  }, [logs]);

  useEffect(() => {
    const tickTimer = setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => clearInterval(tickTimer);
  }, []);

  // Automatic real-time polling so processing & pending activities update continuously
  useEffect(() => {
    if (!autoPollEnabled) return;
    const timer = setInterval(() => {
      void onRefreshLogs();
    }, 1500);
    return () => clearInterval(timer);
  }, [autoPollEnabled, onRefreshLogs]);

  const metrics: AiAnalysisMetrics = useMemo(
    () => computeAiAnalysisMetrics(logs),
    [logs]
  );

  // Live per-entry elapsed time map (100ms resolution)
  const liveElapsedByAnalysisId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of logs) {
      const fallbackStart = firstSeenStartMapRef.current.get(item.analysis_id);
      const elapsed = computeLiveEntryElapsedMs(item, nowMs, fallbackStart);
      map.set(item.analysis_id, elapsed);
    }
    return map;
  }, [logs, nowMs]);

  const processingItems = useMemo(
    () => logs.filter((item) => item.status === 'processing'),
    [logs]
  );

  const pendingItems = useMemo(
    () => logs.filter((item) => item.status === 'pending'),
    [logs]
  );

  // Per-contract / candidate cumulative analysis time across Stage-1 + Stage-2 + Holdings stages
  const contractTotalTimeMap = useMemo(() => {
    const map = new Map<
      string,
      { totalTimeMs: number; stageCount: number; completedTimeMs: number }
    >();
    for (const item of logs) {
      const key = item.option_symbol || item.candidate_id || item.ticker;
      const prev = map.get(key) ?? {
        totalTimeMs: 0,
        stageCount: 0,
        completedTimeMs: 0,
      };
      const itemMs =
        item.status === 'processing'
          ? (liveElapsedByAnalysisId.get(item.analysis_id) ??
            Math.max(0, item.latency_ms))
          : Math.max(0, item.latency_ms);
      prev.totalTimeMs += itemMs;
      if (itemMs > 0) {
        prev.stageCount += 1;
      }
      if (item.status === 'success' || item.status === 'error') {
        prev.completedTimeMs += itemMs;
      }
      map.set(key, prev);
    }
    return map;
  }, [logs, liveElapsedByAnalysisId]);

  const filteredLogs = useMemo(() => {
    return logs.filter((item) => {
      const isError =
        item.status === 'error' || item.error_details.has_error;
      if (statusFilter === 'processing' && item.status !== 'processing') {
        return false;
      }
      if (statusFilter === 'pending' && item.status !== 'pending') {
        return false;
      }
      if (
        statusFilter === 'success' &&
        (item.status !== 'success' || isError)
      ) {
        return false;
      }
      if (statusFilter === 'error' && !isError) {
        return false;
      }
      if (typeFilter !== 'ALL' && item.analysis_type !== typeFilter) {
        return false;
      }

      if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${item.ticker} ${item.option_symbol} ${item.model_id} ${item.endpoint_url} ${item.status} ${item.output_payload.verdict} ${item.queue_metadata?.queue_stage_label ?? ''} ${item.queue_metadata?.trigger_reason ?? ''} ${item.error_details.error_code ?? ''} ${item.error_details.error_message ?? ''} ${item.input_payload.user_prompt} ${item.output_payload.assistant_message}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, statusFilter, typeFilter, searchQuery]);

  const selectedEntry =
    filteredLogs.find((x) => x.analysis_id === selectedAnalysisId) ??
    logs.find((x) => x.analysis_id === selectedAnalysisId) ??
    filteredLogs[0] ??
    null;

  const handleTriggerAnalysis = async (forceError = false) => {
    if (forceError) {
      setSimulatingError(true);
    } else {
      setRunningAnalysis(true);
    }
    const quickRefresh1 = setTimeout(() => void onRefreshLogs(), 250);
    const quickRefresh2 = setTimeout(() => void onRefreshLogs(), 900);
    try {
      const created = await onRunAiAnalysis({
        candidate_id: selectedCandidateId || candidates[0]?.candidate_id,
        analysis_type: analysisType,
        custom_instruction: customInstruction,
        execution_mode: forceError ? 'simulate_error' : executionMode,
      });
      if (created) {
        setSelectedAnalysisId(created.analysis_id);
      }
    } finally {
      clearTimeout(quickRefresh1);
      clearTimeout(quickRefresh2);
      setRunningAnalysis(false);
      setSimulatingError(false);
      void onRefreshLogs();
    }
  };

  const handleProcessPendingItem = async (params?: {
    analysis_id?: string;
    candidate_id?: string;
    process_all?: boolean;
  }) => {
    const key = params?.analysis_id || params?.candidate_id || 'ALL';
    setProcessingQueueId(key);
    const quickRefresh1 = setTimeout(() => void onRefreshLogs(), 250);
    const quickRefresh2 = setTimeout(() => void onRefreshLogs(), 900);
    try {
      if (onProcessPending) {
        await onProcessPending(params);
      } else {
        await fetch('/api/activity/ai-analysis/process-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params ?? { process_all: true }),
        });
        await onRefreshLogs();
      }
    } finally {
      clearTimeout(quickRefresh1);
      clearTimeout(quickRefresh2);
      setProcessingQueueId(null);
      void onRefreshLogs();
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshLogs();
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopy = async (text: string, key: 'input' | 'output') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const activeInputText = useMemo(() => {
    if (!selectedEntry) return '';
    if (inputTab === 'prompts') {
      return `=== SYSTEM PROMPT ===\n${selectedEntry.input_payload.system_prompt}\n\n=== USER PROMPT ===\n${selectedEntry.input_payload.user_prompt}`;
    }
    if (inputTab === 'request_json') {
      return selectedEntry.input_payload.request_body;
    }
    return selectedEntry.input_payload.context_snapshot;
  }, [selectedEntry, inputTab]);

  const activeOutputText = useMemo(() => {
    if (!selectedEntry) return '';
    if (
      outputTab === 'formatted' &&
      selectedEntry.output_payload.assistant_message
    ) {
      return selectedEntry.output_payload.assistant_message;
    }
    return selectedEntry.output_payload.raw_response;
  }, [selectedEntry, outputTab]);

  return (
    <div className="space-y-6">
      {/* Header & Configured LM Studio Endpoint Status */}
      <section
        aria-label="AI Analysis Activity Monitor Header"
        className="p-5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-4"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <BrainCircuit className="w-4 h-4 text-sky-400" />
            <h1 className="text-base font-bold tracking-tight text-slate-100">
              AI Analysis Activity, Live Processing &amp; Pending Queue Monitor
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
              <span>
                {metrics.processing_count} Processing · {metrics.pending_count}{' '}
                Pending · {metrics.completed_count} Completed
              </span>
            </span>
            <span
              data-testid="ai-header-total-analysis-time"
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-mono tabular-nums font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
            >
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>
                Total Analysis Time:{' '}
                {formatAnalysisDuration(metrics.total_analysis_time_ms)}
              </span>
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Full visibility across all AI activities: in-flight LLM inferences being processed right now, pending Stage-1/Stage-2/Holdings evaluations in the queue, and cumulative analysis duration.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAutoPollEnabled((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border transition-colors ${
              autoPollEnabled
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                : 'border-slate-700 bg-[#0B0F17] text-slate-400'
            }`}
          >
            <Activity
              className={`w-3.5 h-3.5 ${
                autoPollEnabled ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
              }`}
            />
            <span>Live Poll: {autoPollEnabled ? 'ON (1.5s)' : 'PAUSED'}</span>
          </button>

          <div className="px-3 py-1.5 rounded-md bg-[#0B0F17] border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              Endpoint:{' '}
              <strong className="text-sky-400">
                {llmEngineConfig.endpointUrl}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span>
              Model:{' '}
              <strong className="text-emerald-400">
                {llmEngineConfig.modelId}
              </strong>
            </span>
            <span className="text-slate-600">·</span>
            <span>
              Concurrency:{' '}
              <strong className="text-sky-300">
                {llmEngineConfig.concurrentAnalyses ?? 3}x
              </strong>
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenLlmSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
            <span>LM Studio Settings</span>
          </button>
        </div>
      </section>

      {/* 5-Card KPI Strip (All, Processing, Pending, Completed, Errors/Latency) */}
      <section
        aria-label="AI Analysis KPI Summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
      >
        <div
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-lg border cursor-pointer transition-colors bg-[#111726] ${
            statusFilter === 'all'
              ? 'border-sky-500/60'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="text-xs text-slate-400">All AI Activity &amp; Queue</div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
              {metrics.total_analyses}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-emerald-400">
              Total:{' '}
              {(metrics.total_analysis_time_ms / 1000).toFixed(2)}s (
              {metrics.total_analysis_time_ms.toLocaleString()} ms)
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
            {metrics.stage1_count} Stg1 · {metrics.stage2_count} Stg2 ·{' '}
            {metrics.holdings_eval_count} Holdings
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter((prev) =>
              prev === 'processing' ? 'all' : 'processing'
            )
          }
          className={`p-4 rounded-lg border cursor-pointer transition-colors bg-[#111726] ${
            statusFilter === 'processing'
              ? 'border-sky-400 bg-sky-950/20'
              : 'border-slate-800 hover:border-sky-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
              <span>Being Processed Now</span>
            </span>
            <span className="text-[10px] font-mono text-sky-400 underline">
              {statusFilter === 'processing' ? 'Show All' : 'Filter'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-sky-400">
              {metrics.processing_count}
            </span>
            <span className="text-[11px] font-mono text-sky-300/90">
              In-Flight Workers
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
            {processingItems.length > 0
              ? `${processingItems.map((p) => p.ticker).join(', ')} (${processingItems.length}/${llmEngineConfig.concurrentAnalyses ?? 3} Workers)`
              : 'Idle / Ready for next stream'}
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter((prev) => (prev === 'pending' ? 'all' : 'pending'))
          }
          className={`p-4 rounded-lg border cursor-pointer transition-colors bg-[#111726] ${
            statusFilter === 'pending'
              ? 'border-amber-400 bg-amber-950/20'
              : 'border-slate-800 hover:border-amber-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Pending Activity Queue</span>
            </span>
            <span className="text-[10px] font-mono text-amber-400 underline">
              {statusFilter === 'pending' ? 'Show All' : 'Filter'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-amber-400">
              {metrics.pending_count}
            </span>
            <span className="text-[11px] font-mono text-amber-300/90">
              Queued Tasks
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
            Awaiting Stage-1 / Stage-2 / Exit Gate
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter((prev) => (prev === 'success' ? 'all' : 'success'))
          }
          className={`p-4 rounded-lg border cursor-pointer transition-colors bg-[#111726] ${
            statusFilter === 'success'
              ? 'border-emerald-400 bg-emerald-950/20'
              : 'border-slate-800 hover:border-emerald-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Completed Analyses</span>
            <span className="text-[10px] font-mono text-emerald-400 underline">
              {statusFilter === 'success' ? 'Show All' : 'Filter'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {metrics.success_count}
            </span>
            <span className="text-[11px] font-mono text-emerald-400/90">
              Total:{' '}
              {(metrics.completed_analysis_time_ms / 1000).toFixed(2)}s
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
            Avg {metrics.avg_latency_ms} ms ·{' '}
            {metrics.completed_analysis_time_ms.toLocaleString()} ms total ·{' '}
            {metrics.total_tokens_used.toLocaleString()} tok
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter((prev) => (prev === 'error' ? 'all' : 'error'))
          }
          className={`p-4 rounded-lg border cursor-pointer transition-colors bg-[#111726] ${
            statusFilter === 'error'
              ? 'border-rose-400 bg-rose-950/20'
              : 'border-slate-800 hover:border-rose-500/50'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Failed / Endpoint Errors</span>
            <span className="text-[10px] font-mono text-rose-400 underline">
              {statusFilter === 'error' ? 'Show All' : 'Filter'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                metrics.error_count > 0 ? 'text-rose-400' : 'text-slate-300'
              }`}
            >
              {metrics.error_count}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              ECONNREFUSED / 5xx
            </span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-slate-400 truncate">
            Auto-fallback to quant gate active
          </div>
        </div>
      </section>

      {/* Live AI Processing & Pending Queue Panel */}
      <section
        aria-label="Live AI Processing and Pending Queue"
        className="p-4 rounded-lg border border-sky-500/30 bg-[#111726] space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex flex-wrap items-center gap-2.5">
            <Layers className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold text-slate-100">
              Live In-Flight Processing ({processingItems.length}) &amp; Pending
              Analysis Queue ({pendingItems.length})
            </h2>
            <span className="text-xs text-slate-400">
              {llmEngineConfig.concurrentAnalyses ?? 3}x Concurrent LM Studio Dispatch · Click any active or queued item to inspect its live prompt &amp; context JSON.
            </span>
          </div>

          <button
            type="button"
            disabled={processingQueueId !== null || (processingItems.length >= (llmEngineConfig.concurrentAnalyses ?? 3) && pendingItems.length === 0)}
            onClick={() => handleProcessPendingItem({ process_all: true })}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-emerald-400 hover:bg-emerald-300 text-slate-950 transition-colors disabled:opacity-50"
          >
            {processingQueueId === 'ALL' || (processingItems.length >= (llmEngineConfig.concurrentAnalyses ?? 3) && pendingItems.length === 0) ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            <span>
              {processingQueueId === 'ALL'
                ? `Processing Queue (${llmEngineConfig.concurrentAnalyses ?? 3}x Concurrent)...`
                : pendingItems.length > 0
                  ? `Process Queued (${llmEngineConfig.concurrentAnalyses ?? 3}x Concurrent · ${pendingItems.length} Pending)`
                  : processingItems.length > 0
                    ? `Active in LM Studio (${processingItems.length}/${llmEngineConfig.concurrentAnalyses ?? 3} In-Flight)`
                    : 'Re-Queue Candidates for Evaluation'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Column 1: Currently Being Processed (In-Flight) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-sky-300">
              <span className="inline-flex items-center gap-1.5">
                <Loader2
                  className={`w-3.5 h-3.5 text-sky-400 ${
                    processingItems.length > 0 ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  Currently Being Processed ({processingItems.length}/{llmEngineConfig.concurrentAnalyses ?? 3})
                </span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {llmEngineConfig.concurrentAnalyses ?? 3}x Concurrent Worker Pool
              </span>
            </div>

            {processingItems.length === 0 ? (
              <div className="p-4 rounded-md border border-slate-800 bg-[#0B0F17] text-xs text-slate-400 font-mono">
                No active LM Studio HTTP request in flight right now.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {processingItems.map((item) => {
                  const isSelected =
                    selectedEntry?.analysis_id === item.analysis_id;
                  const badge = ANALYSIS_STAGE_BADGE[item.analysis_type];
                  const pct = item.queue_metadata?.progress_pct ?? 65;

                  return (
                    <div
                      key={item.analysis_id}
                      onClick={() => setSelectedAnalysisId(item.analysis_id)}
                      className={`p-3 rounded-md border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-sky-400 bg-sky-950/30'
                          : 'border-sky-500/30 bg-[#0B0F17] hover:border-sky-500/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono tabular-nums font-bold bg-sky-500/20 text-sky-300 border border-sky-400/50 animate-pulse">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>PROCESSING ({pct}%)</span>
                          </span>
                          <span className="font-bold font-mono text-xs text-slate-100">
                            {item.ticker}
                          </span>
                          <span className="text-[11px] font-mono text-slate-300">
                            {item.option_symbol}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            Active in LM Studio
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 text-[11px] text-slate-200 font-medium">
                        {item.queue_metadata?.queue_stage_label ??
                          ANALYSIS_TYPE_LABELS[item.analysis_type]}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {item.queue_metadata?.trigger_reason}
                      </div>

                      <div className="mt-2 w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-400 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Column 2: Pending Activity in Queue */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Pending Activity in Queue ({pendingItems.length})</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Stage-1 · Stage-2 · Holdings Exit Queue
              </span>
            </div>

            {pendingItems.length === 0 ? (
              <div className="p-4 rounded-md border border-slate-800 bg-[#0B0F17] text-xs text-slate-400 font-mono">
                All queued candidates and holdings have been processed for the current cycle.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {pendingItems.map((item) => {
                  const isSelected =
                    selectedEntry?.analysis_id === item.analysis_id;
                  const badge = ANALYSIS_STAGE_BADGE[item.analysis_type];

                  return (
                    <div
                      key={item.analysis_id}
                      onClick={() => setSelectedAnalysisId(item.analysis_id)}
                      className={`p-3 rounded-md border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-amber-400 bg-amber-950/25'
                          : 'border-amber-500/25 bg-[#0B0F17] hover:border-amber-500/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <Clock className="w-2.5 h-2.5" />
                            <span>PENDING</span>
                          </span>
                          <span className="font-bold font-mono text-xs text-slate-100">
                            {item.ticker}
                          </span>
                          <span className="text-[11px] font-mono text-slate-300">
                            {item.option_symbol}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <button
                            type="button"
                            disabled={processingQueueId !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleProcessPendingItem({
                                analysis_id: item.analysis_id,
                              });
                            }}
                            className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors disabled:opacity-50"
                          >
                            {processingQueueId === item.analysis_id
                              ? 'Processing...'
                              : 'Process Now'}
                          </button>
                        </div>
                      </div>

                      <div className="mt-1.5 text-[11px] text-slate-200 font-medium">
                        {item.queue_metadata?.queue_stage_label ??
                          ANALYSIS_TYPE_LABELS[item.analysis_type]}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {item.queue_metadata?.trigger_reason}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Run New AI Analysis Workbench */}
      <section
        aria-label="Dispatch New AI Analysis"
        className="p-4 rounded-lg border border-slate-800 bg-[#111726] space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Dispatch New AI Analysis on WhaleCandidate</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded border border-slate-800 bg-[#0B0F17] hover:bg-slate-800 text-slate-300 transition-colors"
            >
              <RefreshCw
                className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClearLogs}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded border border-slate-800 bg-[#0B0F17] hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Logs</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-3 space-y-1">
            <label
              htmlFor="ai-candidate-select"
              className="block text-[11px] font-medium text-slate-400"
            >
              Target WhaleCandidate
            </label>
            <select
              id="ai-candidate-select"
              aria-label="Target WhaleCandidate"
              value={selectedCandidateId}
              onChange={(e) => setSelectedCandidateId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
            >
              {candidates.map((cand) => (
                <option key={cand.candidate_id} value={cand.candidate_id}>
                  {cand.ticker} ${cand.strike}
                  {cand.option_type === 'call' ? 'C' : 'P'} ({cand.dte}d · Score{' '}
                  {cand.whale_score})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 space-y-1">
            <label
              htmlFor="ai-task-select"
              className="block text-[11px] font-medium text-slate-400"
            >
              Analysis Task Type
            </label>
            <select
              id="ai-task-select"
              aria-label="Analysis Task Type"
              value={analysisType}
              onChange={(e) =>
                setAnalysisType(e.target.value as AiAnalysisType)
              }
              className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
            >
              {(
                Object.entries(ANALYSIS_TYPE_LABELS) as Array<
                  [AiAnalysisType, string]
                >
              ).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 space-y-1">
            <label
              htmlFor="ai-exec-mode-select"
              className="block text-[11px] font-medium text-slate-400"
            >
              Execution Mode
            </label>
            <select
              id="ai-exec-mode-select"
              aria-label="Execution Mode"
              value={executionMode}
              onChange={(e) =>
                setExecutionMode(
                  e.target.value as
                    | 'auto'
                    | 'live_endpoint_only'
                    | 'deterministic_synthesis'
                )
              }
              className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
            >
              <option value="auto">Auto (LM Studio + Quant Fallback)</option>
              <option value="live_endpoint_only">
                Strict LM Studio Endpoint Only
              </option>
              <option value="deterministic_synthesis">
                Quantitative Flow Synthesis
              </option>
            </select>
          </div>

          <div className="md:col-span-4 space-y-1">
            <label
              htmlFor="ai-custom-instruction"
              className="block text-[11px] font-medium text-slate-400"
            >
              Optional Operator Prompt Instruction
            </label>
            <input
              id="ai-custom-instruction"
              type="text"
              aria-label="Optional Operator Prompt Instruction"
              placeholder="e.g. Check if 5m ATR move & VWAP confirm breakout..."
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => handleTriggerAnalysis(true)}
            disabled={simulatingError || runningAnalysis}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-rose-500/40 bg-rose-950/30 hover:bg-rose-950/50 text-rose-300 transition-colors disabled:opacity-50"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>
              {simulatingError
                ? 'Testing Error...'
                : 'Simulate Endpoint Error'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTriggerAnalysis(false)}
            disabled={runningAnalysis || simulatingError}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>
              {runningAnalysis ? 'Running AI Analysis...' : 'Run AI Analysis'}
            </span>
          </button>
        </div>
      </section>

      {/* Filter Bar */}
      <section
        aria-label="AI Analysis Log Filters"
        className="p-4 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter AI Logs by Status"
            className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-[#0B0F17] border border-slate-800"
          >
            {(
              [
                { id: 'all', label: `All (${logs.length})` },
                {
                  id: 'processing',
                  label: `Processing (${metrics.processing_count})`,
                },
                { id: 'pending', label: `Pending (${metrics.pending_count})` },
                {
                  id: 'success',
                  label: `Completed (${metrics.success_count})`,
                },
                { id: 'error', label: `Errors (${metrics.error_count})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  statusFilter === tab.id
                    ? tab.id === 'error'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : tab.id === 'processing'
                        ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50 font-semibold'
                        : tab.id === 'pending'
                          ? 'bg-amber-500/25 text-amber-200 border border-amber-400/50 font-semibold'
                          : 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by Analysis Type"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as 'ALL' | AiAnalysisType)
            }
            className="px-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200"
          >
            <option value="ALL">All Analysis Tasks ({logs.length})</option>
            {(
              Object.entries(ANALYSIS_TYPE_LABELS) as Array<
                [AiAnalysisType, string]
              >
            ).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search AI Analysis Logs"
            placeholder="Filter by ticker, contract, stage, status..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500"
          />
        </div>
      </section>

      {/* Main 12-Col Split: AI Activity Table (7 cols) + Input / Output / Error Inspector (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: AI Analysis Activity Table */}
        <section
          aria-label="AI Analysis Activity Table"
          className="lg:col-span-7 border border-slate-800 bg-[#111726] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Unified AI Analysis Execution &amp; Queue Ledger
              </h2>
              <p className="text-xs text-slate-400">
                Includes all in-flight processing, pending queue items, and completed Stage-1 / Stage-2 / Holdings AI runs.
              </p>
            </div>
            <div className="text-right font-mono tabular-nums text-xs">
              <div className="text-slate-300">{filteredLogs.length} entries</div>
              <div className="text-[11px] text-emerald-400">
                Total Time:{' '}
                {formatAnalysisDuration(metrics.total_analysis_time_ms)}
              </div>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-300">
                No AI analysis entries match the active filter criteria.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setTypeFilter('ALL');
                  setSearchQuery('');
                }}
                className="px-3.5 py-2 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[760px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0B0F17] border-b border-slate-800 text-slate-400 whitespace-nowrap">
                  <tr>
                    <th className="py-2.5 pl-3 pr-1.5 font-medium">Time</th>
                    <th className="py-2.5 px-1.5 font-medium">
                      Ticker / Contract
                    </th>
                    <th className="py-2.5 px-1.5 font-medium">Task &amp; Stage</th>
                    <th className="py-2.5 px-1.5 font-medium">
                      Status / Verdict
                    </th>
                    <th className="py-2.5 pl-1.5 pr-3 font-medium text-right">
                      Elapsed / Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredLogs.map((item) => {
                    const isSelected =
                      item.analysis_id === selectedEntry?.analysis_id;
                    const isProcessing = item.status === 'processing';
                    const isPending = item.status === 'pending';
                    const isOk =
                      item.status === 'success' &&
                      !item.error_details.has_error;
                    const isBull = item.direction === 'bullish';
                    const badge =
                      ANALYSIS_STAGE_BADGE[item.analysis_type] ??
                      ANALYSIS_STAGE_BADGE.custom_prompt;
                    const timeStr = new Date(item.timestamp).toLocaleTimeString(
                      [],
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      }
                    );

                    return (
                      <tr
                        key={item.analysis_id}
                        onClick={() => setSelectedAnalysisId(item.analysis_id)}
                        aria-selected={isSelected}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-sky-950/40 hover:bg-sky-950/50'
                            : isProcessing
                              ? 'bg-sky-950/20 hover:bg-sky-950/30'
                              : isPending
                                ? 'bg-amber-950/10 hover:bg-amber-950/20'
                                : !isOk
                                  ? 'bg-rose-950/15 hover:bg-rose-950/25'
                                  : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 pl-3 pr-1.5 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          {timeStr}
                        </td>

                        <td className="py-2.5 px-1.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span className="font-bold font-mono text-slate-100">
                              {item.ticker}
                            </span>
                            <span
                              className={`inline-flex items-center text-[11px] ${
                                isBull ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isBull ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {item.option_symbol}
                          </div>
                        </td>

                        <td className="py-2.5 px-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          <div className="text-slate-200 font-medium truncate max-w-[140px]">
                            {item.queue_metadata?.queue_stage_label ??
                              (ANALYSIS_TYPE_LABELS[item.analysis_type] ??
                                item.analysis_type)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate max-w-[140px]">
                            {item.model_id}
                          </div>
                        </td>

                        <td className="py-2.5 px-1.5 whitespace-nowrap">
                          {isProcessing ? (
                            <div>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 text-[10px] font-mono font-bold animate-pulse">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                <span>
                                  PROCESSING (
                                  {item.queue_metadata?.progress_pct ?? 65}%)
                                </span>
                              </span>
                              <div className="text-[10px] font-mono text-sky-300/80 mt-0.5">
                                In-Flight Inference
                              </div>
                            </div>
                          ) : isPending ? (
                            <div>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[10px] font-mono font-bold">
                                <Clock className="w-2.5 h-2.5" />
                                <span>PENDING IN QUEUE</span>
                              </span>
                              <div className="text-[10px] font-mono text-amber-300/80 mt-0.5">
                                Priority: {item.output_payload.confidence_score}
                                /100
                              </div>
                            </div>
                          ) : isOk ? (
                            <div>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-mono font-semibold">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                <span>
                                  {item.output_payload.verdict.replace(
                                    /_/g,
                                    ' '
                                  )}
                                </span>
                              </span>
                              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                                Conf: {item.output_payload.confidence_score}/100
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-mono font-semibold">
                                <XCircle className="w-2.5 h-2.5" />
                                <span>
                                  {item.error_details.error_code || 'ERROR'}
                                </span>
                              </span>
                              <div className="text-[10px] font-mono text-rose-300/90 mt-0.5 truncate max-w-[110px]">
                                Endpoint Error
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 pl-1.5 pr-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {(() => {
                            const liveItemElapsedMs =
                              liveElapsedByAnalysisId.get(item.analysis_id) ??
                              item.latency_ms;
                            const contractKey =
                              item.option_symbol ||
                              item.candidate_id ||
                              item.ticker;
                            const contractTiming = contractTotalTimeMap.get(
                              contractKey
                            ) ?? {
                              totalTimeMs: liveItemElapsedMs,
                              stageCount: 1,
                              completedTimeMs: item.latency_ms,
                            };

                            if (isProcessing) {
                              return (
                                <div className="space-y-1">
                                  <div
                                    data-testid={`ledger-elapsed-counter-${item.analysis_id}`}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/50 text-sky-200 text-[11px] font-mono tabular-nums font-bold"
                                  >
                                    <Clock className="w-3 h-3 text-sky-400 animate-pulse" />
                                    <span>
                                      {formatElapsedCounter(liveItemElapsedMs)}
                                    </span>
                                    <span className="text-[10px] font-normal text-sky-300/90">
                                      ({(liveItemElapsedMs / 1000).toFixed(1)}s)
                                    </span>
                                  </div>
                                  <div className="text-[10px] font-mono text-sky-300/90">
                                    Active in LM Studio
                                  </div>
                                </div>
                              );
                            }

                            if (isPending) {
                              return (
                                <div className="space-y-1">
                                  <button
                                    type="button"
                                    disabled={processingQueueId !== null}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleProcessPendingItem({
                                        analysis_id: item.analysis_id,
                                      });
                                    }}
                                    className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-amber-400 hover:bg-amber-300 text-slate-950 transition-colors"
                                  >
                                    {processingQueueId === item.analysis_id
                                      ? 'Running...'
                                      : 'Process Now'}
                                  </button>
                                  <div className="text-[10px] text-slate-400">
                                    {item.total_tokens} est tok
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <>
                                <div className="text-slate-100 font-semibold">
                                  {item.latency_ms} ms (
                                  {(item.latency_ms / 1000).toFixed(2)}s)
                                </div>
                                <div className="text-[10px] text-emerald-400">
                                  Total:{' '}
                                  {(contractTiming.totalTimeMs / 1000).toFixed(
                                    2
                                  )}
                                  s ({contractTiming.totalTimeMs} ms)
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {item.total_tokens} tok
                                </div>
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right 5 Cols: AI Analysis Input / Output / Error Inspector */}
        <aside
          aria-label="AI Analysis Input Output Inspector"
          className="lg:col-span-5 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
        >
          {!selectedEntry ? (
            <div className="py-12 text-center space-y-2">
              <BrainCircuit className="w-6 h-6 text-slate-500 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-200">
                No AI Analysis Selected
              </h3>
              <p className="text-xs text-slate-400">
                Select any row from the Unified AI Analysis Execution &amp; Queue Ledger to inspect its input prompt, context JSON, output completion, and status.
              </p>
            </div>
          ) : (
            <>
              {/* Inspector Header */}
              <div className="pb-3 border-b border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold font-mono text-slate-100">
                      {selectedEntry.ticker} · {selectedEntry.option_symbol}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                        selectedEntry.status === 'processing'
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40 animate-pulse'
                          : selectedEntry.status === 'pending'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                            : selectedEntry.status === 'success' &&
                                !selectedEntry.error_details.has_error
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {selectedEntry.status === 'processing'
                        ? `PROCESSING IN-FLIGHT (${selectedEntry.queue_metadata?.progress_pct ?? 65}%)`
                        : selectedEntry.status === 'pending'
                          ? `PENDING IN QUEUE · Priority ${selectedEntry.output_payload.confidence_score}/100`
                          : selectedEntry.status === 'success'
                            ? `COMPLETED · Conf ${selectedEntry.output_payload.confidence_score}/100`
                            : `ERROR · ${selectedEntry.error_details.error_code ?? 'FAILED'}`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono tabular-nums text-slate-400">
                    {(selectedEntry.status === 'processing' ||
                      selectedEntry.status === 'pending') && (
                      <button
                        type="button"
                        disabled={processingQueueId !== null}
                        onClick={() =>
                          handleProcessPendingItem({
                            analysis_id: selectedEntry.analysis_id,
                          })
                        }
                        className="px-2.5 py-1 text-[11px] font-mono font-semibold rounded bg-emerald-400 hover:bg-emerald-300 text-slate-950 transition-colors whitespace-nowrap shrink-0"
                      >
                        {processingQueueId === selectedEntry.analysis_id
                          ? 'Executing...'
                          : 'Execute Analysis Now'}
                      </button>
                    )}
                    {selectedEntry.status !== 'processing' &&
                      selectedEntry.status !== 'pending' && (
                        <span className="inline-flex items-center gap-1 text-slate-200 whitespace-nowrap">
                          <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span>
                            Step: {formatAnalysisDuration(selectedEntry.latency_ms)}
                          </span>
                        </span>
                      )}
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold whitespace-nowrap">
                      <span>
                        Total Contract Time:{' '}
                        {formatAnalysisDuration(
                          contractTotalTimeMap.get(
                            selectedEntry.option_symbol ||
                              selectedEntry.candidate_id ||
                              selectedEntry.ticker
                          )?.totalTimeMs ?? selectedEntry.latency_ms
                        )}
                      </span>
                    </span>
                    <span className="whitespace-nowrap">
                      {selectedEntry.prompt_tokens} in /{' '}
                      {selectedEntry.completion_tokens} out tok
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded bg-[#0B0F17] border border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-300">
                  <span className="truncate">
                    POST {selectedEntry.endpoint_url}
                  </span>
                  <span className="text-sky-400 shrink-0">
                    model: {selectedEntry.model_id} (
                    {selectedEntry.execution_mode})
                  </span>
                </div>

                {selectedEntry.queue_metadata && (
                  <div className="p-2.5 rounded bg-[#0B0F17] border border-slate-800 text-[11px] font-mono space-y-1">
                    <div className="flex items-center justify-between text-slate-200 font-semibold">
                      <span>{selectedEntry.queue_metadata.queue_stage_label}</span>
                      <span className="text-sky-400 uppercase">
                        {selectedEntry.queue_metadata.source_pipeline.replace(
                          /_/g,
                          ' '
                        )}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Trigger: {selectedEntry.queue_metadata.trigger_reason}
                    </div>
                  </div>
                )}
              </div>

              {/* Error Diagnostic Banner (shown if has_error is true) */}
              {(selectedEntry.status === 'error' ||
                selectedEntry.error_details.has_error) && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg border border-rose-500/40 bg-rose-950/30 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs font-bold text-rose-300">
                    <span className="inline-flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        AI Inference / Endpoint Error (
                        {selectedEntry.error_details.error_code || 'ERROR'})
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-rose-400">
                      {selectedEntry.error_details.endpoint_attempted}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-rose-200 leading-relaxed break-words">
                    {selectedEntry.error_details.error_message ||
                      'LM Studio inference request failed.'}
                  </p>
                </div>
              )}

              {/* INPUT PANEL: System/User Prompts, Request Body JSON, Context Snapshot */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200 mr-1">
                      Request Input:
                    </span>
                    {(
                      [
                        { id: 'prompts', label: 'Prompts (System + User)' },
                        { id: 'request_json', label: 'POST Body JSON' },
                        { id: 'context', label: 'Injected Context JSON' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setInputTab(t.id)}
                        className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                          inputTab === t.id
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                            : 'bg-[#0B0F17] text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(activeInputText, 'input')}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-400 hover:text-sky-300"
                  >
                    {copiedKey === 'input' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Input</span>
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-3 rounded-md bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words max-h-56 overflow-y-auto leading-relaxed">
                  {activeInputText}
                </pre>
              </div>

              {/* OUTPUT PANEL: Assistant Analysis / Raw Response JSON */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200 mr-1">
                      AI Response / Queue Status Output:
                    </span>
                    {(
                      [
                        { id: 'formatted', label: 'Structured AI Output' },
                        { id: 'raw_json', label: 'Raw Completion JSON' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setOutputTab(t.id)}
                        className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors ${
                          outputTab === t.id
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                            : 'bg-[#0B0F17] text-slate-400 hover:text-slate-200 border border-slate-800'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopy(activeOutputText, 'output')}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-400 hover:text-sky-300"
                  >
                    {copiedKey === 'output' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Output</span>
                      </>
                    )}
                  </button>
                </div>

                <pre
                  className={`p-3.5 rounded-md bg-[#0B0F17] border text-[11px] font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed ${
                    selectedEntry.status === 'error'
                      ? 'border-rose-500/30 text-rose-300'
                      : selectedEntry.status === 'processing'
                        ? 'border-sky-500/40 text-sky-300'
                        : selectedEntry.status === 'pending'
                          ? 'border-amber-500/40 text-amber-300'
                          : 'border-slate-800 text-emerald-300/95'
                  }`}
                >
                  {activeOutputText}
                </pre>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
