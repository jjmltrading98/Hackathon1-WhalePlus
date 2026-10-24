import React, { useMemo, useState } from 'react';
import {
  DECISION_METADATA,
  type LlmTradeDecisionRecord,
  type LlmTradeGateDecision,
} from '../engine/llmTradeDecisionEngine';
import {
  DEFAULT_RISK_POLICY_CONFIG,
  type RiskPolicyConfig,
  SPEC_25K_EXAMPLE_RISK_POLICY,
  buildStage2LlmRiskAssessmentPrompts,
  evaluateRiskFirstExecutionPlan,
} from '../engine/riskFirstExecutionEngine';
import type { WhaleCandidate } from '../engine/whaleScannerEngine';
import type { LlmEngineConfig } from '../engine/whalePipelineRuntime';
import { isLocalhostLmStudioEndpoint } from '../engine/lmStudioClient';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  FileJson,
  Layers,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCheck,
  XCircle,
  Zap,
} from 'lucide-react';

interface LlmTradeDecisionViewProps {
  records: LlmTradeDecisionRecord[];
  candidates: WhaleCandidate[];
  llmEngineConfig: LlmEngineConfig;
  riskPolicyConfig?: RiskPolicyConfig;
  onEvaluateCandidate: (params: {
    candidate_id?: string;
    stress_scenario?:
      | 'default'
      | 'force_execute_aligned'
      | 'force_watch_vwap'
      | 'force_skip_contradicted'
      | 'force_human_review_ambiguity';
    execution_mode?: 'auto' | 'live_endpoint_only' | 'deterministic_synthesis';
    auto_fulfill_smart_order?: boolean;
  }) => Promise<LlmTradeDecisionRecord | null>;
  onApproveAction: (params: {
    decision_id: string;
    action:
      | 'approve_and_stage_smart_order'
      | 'move_to_watchlist'
      | 'reject_decision';
  }) => Promise<void>;
  onRunStage2RiskAndFulfill?: (params: {
    decision_id: string;
    fulfill_smart_order?: boolean;
    client_raw_stage2_llm_content?: string | null;
  }) => Promise<LlmTradeDecisionRecord | null>;
  onUpdateRiskPolicy?: (
    patch: Partial<RiskPolicyConfig>
  ) => Promise<RiskPolicyConfig>;
  onRecalculateRiskForDecision?: (params: {
    decision_id: string;
    policy?: Partial<RiskPolicyConfig>;
    planned_entry_override?: number;
    contract_stop_override?: number;
  }) => Promise<LlmTradeDecisionRecord | null>;
  onOpenSmartOrderMonitor: () => void;
  onOpenLlmSettings: () => void;
  onRunAutoPipelineCycle?: () => Promise<void>;
  runningAutoCycle?: boolean;
}

const DECISION_STYLES: Record<
  LlmTradeGateDecision,
  {
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
    cardBorder: string;
    cardAccent: string;
  }
> = {
  EXECUTE: {
    badgeBg: 'bg-emerald-950/60',
    badgeBorder: 'border-emerald-500/50',
    badgeText: 'text-emerald-300',
    cardBorder: 'border-emerald-500/40',
    cardAccent: 'text-emerald-400',
  },
  WATCH: {
    badgeBg: 'bg-amber-950/60',
    badgeBorder: 'border-amber-500/50',
    badgeText: 'text-amber-300',
    cardBorder: 'border-amber-500/40',
    cardAccent: 'text-amber-400',
  },
  SKIP: {
    badgeBg: 'bg-rose-950/60',
    badgeBorder: 'border-rose-500/50',
    badgeText: 'text-rose-300',
    cardBorder: 'border-rose-500/40',
    cardAccent: 'text-rose-400',
  },
  'HUMAN REVIEW': {
    badgeBg: 'bg-purple-950/60',
    badgeBorder: 'border-purple-500/50',
    badgeText: 'text-purple-300',
    cardBorder: 'border-purple-500/40',
    cardAccent: 'text-purple-300',
  },
};

const INTENT_LABELS: Record<string, string> = {
  likely_opening_directional: 'Likely Opening Directional',
  potential_hedge_or_collar: 'Potential Hedge / Collar',
  multi_leg_or_spread_leg: 'Multi-Leg / Spread Leg',
  late_chase_or_closing_flow: 'Late Chase / Closing Flow',
  ambiguous_institutional_print: 'Ambiguous Institutional Print',
};

const APPROVAL_STATUS_LABELS: Record<
  LlmTradeDecisionRecord['approval_status'],
  { label: string; colorClass: string }
> = {
  pending_gate_review: {
    label: 'Auto-Processing via Stage-2 Risk Sizer',
    colorClass: 'text-sky-300 border-sky-500/40 bg-sky-950/30',
  },
  approved_staged_to_smart_order: {
    label: 'Auto-Approved · Dispatched to Smart Order Engine',
    colorClass: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/30',
  },
  queued_on_watchlist: {
    label: 'Auto-Queued on Confirmation Watchlist',
    colorClass: 'text-amber-300 border-amber-500/40 bg-amber-950/30',
  },
  rejected_by_operator_or_risk_gate: {
    label: 'Auto-Filtered / Blocked by Risk Gate',
    colorClass: 'text-rose-300 border-rose-500/40 bg-rose-950/30',
  },
};

export const LlmTradeDecisionView: React.FC<LlmTradeDecisionViewProps> = ({
  records,
  candidates,
  llmEngineConfig,
  riskPolicyConfig = DEFAULT_RISK_POLICY_CONFIG,
  onEvaluateCandidate,
  onApproveAction,
  onRunStage2RiskAndFulfill,
  onUpdateRiskPolicy,
  onRecalculateRiskForDecision,
  onOpenSmartOrderMonitor,
  onOpenLlmSettings,
  onRunAutoPipelineCycle,
  runningAutoCycle = false,
}) => {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    () => candidates[0]?.candidate_id ?? ''
  );
  const [stressScenario, setStressScenario] = useState<
    | 'default'
    | 'force_execute_aligned'
    | 'force_watch_vwap'
    | 'force_skip_contradicted'
    | 'force_human_review_ambiguity'
  >('default');
  const [executionMode, setExecutionMode] = useState<
    'auto' | 'live_endpoint_only' | 'deterministic_synthesis'
  >('auto');
  const [autoFulfillSmartOrder, setAutoFulfillSmartOrder] =
    useState<boolean>(true);
  const [evaluating, setEvaluating] = useState(false);
  const [runningStage2Id, setRunningStage2Id] = useState<string | null>(null);
  const [stage2Notice, setStage2Notice] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [decisionFilter, setDecisionFilter] = useState<
    'ALL' | LlmTradeGateDecision
  >('ALL');
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(
    () => records[0]?.decision_id ?? null
  );
  const [inspectorTab, setInspectorTab] = useState<
    | 'decision_gate'
    | 'risk_execution_plan'
    | 'packet_a_d'
    | 'packet_e_g'
    | 'raw_json'
  >('decision_gate');
  const [copiedPacket, setCopiedPacket] = useState(false);
  const [localRiskPolicy, setLocalRiskPolicy] =
    useState<RiskPolicyConfig>(riskPolicyConfig);
  const [plannedEntryOverride, setPlannedEntryOverride] = useState<
    number | undefined
  >(undefined);
  const [contractStopOverride, setContractStopOverride] = useState<
    number | undefined
  >(undefined);

  React.useEffect(() => {
    setLocalRiskPolicy(riskPolicyConfig);
  }, [riskPolicyConfig]);

  const handleApplyRiskPolicyPatch = async (
    patch: Partial<RiskPolicyConfig>
  ) => {
    const next = { ...localRiskPolicy, ...patch };
    setLocalRiskPolicy(next);
    if (onUpdateRiskPolicy) {
      await onUpdateRiskPolicy(patch);
    }
  };

  const counts = useMemo(() => {
    return {
      total: records.length,
      EXECUTE: records.filter((r) => r.llm_output.decision === 'EXECUTE').length,
      WATCH: records.filter((r) => r.llm_output.decision === 'WATCH').length,
      SKIP: records.filter((r) => r.llm_output.decision === 'SKIP').length,
      'HUMAN REVIEW': records.filter(
        (r) => r.llm_output.decision === 'HUMAN REVIEW'
      ).length,
      approved: records.filter(
        (r) => r.approval_status === 'approved_staged_to_smart_order'
      ).length,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (decisionFilter === 'ALL') return records;
    return records.filter((r) => r.llm_output.decision === decisionFilter);
  }, [records, decisionFilter]);

  const activeRecord = useMemo(() => {
    return (
      filteredRecords.find((r) => r.decision_id === selectedDecisionId) ??
      records.find((r) => r.decision_id === selectedDecisionId) ??
      filteredRecords[0] ??
      records[0] ??
      null
    );
  }, [filteredRecords, records, selectedDecisionId]);

  const handleRunEvaluation = async (
    overrideScenario?:
      | 'default'
      | 'force_execute_aligned'
      | 'force_watch_vwap'
      | 'force_skip_contradicted'
      | 'force_human_review_ambiguity'
  ) => {
    setEvaluating(true);
    try {
      const scenarioToUse = overrideScenario ?? stressScenario;
      if (overrideScenario) {
        setStressScenario(overrideScenario);
      }
      const created = await onEvaluateCandidate({
        candidate_id: selectedCandidateId || candidates[0]?.candidate_id,
        stress_scenario: scenarioToUse,
        execution_mode: executionMode,
        auto_fulfill_smart_order: autoFulfillSmartOrder,
      });
      if (created) {
        setSelectedDecisionId(created.decision_id);
        setDecisionFilter('ALL');
        const stg2 =
          created.risk_first_execution_plan?.stage2_llm_risk_assessment;
        if (stg2) {
          setStage2Notice(
            `Stage-1 LLM: ${created.llm_output.decision} → Stage-2 LLM Risk & Size: ${stg2.decision} (${stg2.quantity} contract${stg2.quantity === 1 ? '' : 's'} @ $${stg2.entry_limit.toFixed(2)}, Max Risk $${stg2.maximum_planned_loss.toFixed(0)})${created.staged_smart_order_id ? ` → Sent to Smart Order Engine (${created.staged_smart_order_id})` : ''}`
          );
          setTimeout(() => setStage2Notice(null), 7000);
        }
      }
    } finally {
      setEvaluating(false);
    }
  };

  const handleRunStage2RiskAndFulfill = async (
    record: LlmTradeDecisionRecord,
    fulfillSmartOrder = true
  ) => {
    setRunningStage2Id(record.decision_id);
    setStage2Notice(null);
    try {
      let clientRawStage2: string | null = null;
      // Only attempt direct browser -> LM Studio fetch if target is localhost/127.0.0.1; remote endpoints route via backend proxy
      if (
        llmEngineConfig.enabled &&
        llmEngineConfig.modelId.trim() &&
        executionMode !== 'deterministic_synthesis' &&
        isLocalhostLmStudioEndpoint(llmEngineConfig.endpointUrl)
      ) {
        try {
          const plan = evaluateRiskFirstExecutionPlan({
            packet: record.evidence_packet,
            llmDecision: record.llm_output.decision,
            policy: localRiskPolicy,
            plannedEntryOverride,
            contractStopOverride,
          });
          const stage2Prompts = buildStage2LlmRiskAssessmentPrompts({
            plan,
            modelId: llmEngineConfig.modelId,
            endpointUrl: llmEngineConfig.endpointUrl,
            temperature: llmEngineConfig.temperature,
            topP: llmEngineConfig.topP,
            maxTokens: llmEngineConfig.maxTokens,
            maxTokensEnabled: llmEngineConfig.maxTokensEnabled ?? true,
            thinkingMode: llmEngineConfig.thinkingMode ?? 'no_think',
          });
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            Math.min(Math.max(llmEngineConfig.timeoutMs || 30000, 3000), 90000)
          );
          const resp = await fetch(stage2Prompts.endpoint_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stage2Prompts.request_body),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (resp.ok) {
            const data = await resp.json();
            clientRawStage2 = data?.choices?.[0]?.message?.content ?? null;
          }
        } catch {
          // Fallback to server Stage-2 evaluation
        }
      }

      if (onRunStage2RiskAndFulfill) {
        const updated = await onRunStage2RiskAndFulfill({
          decision_id: record.decision_id,
          fulfill_smart_order: fulfillSmartOrder,
          client_raw_stage2_llm_content: clientRawStage2,
        });
        if (updated) {
          const stg2 =
            updated.risk_first_execution_plan.stage2_llm_risk_assessment;
          setStage2Notice(
            `Stage-2 LLM Risk & Size Assessment: ${stg2.decision} (${stg2.quantity}x @ $${stg2.entry_limit.toFixed(2)}, Stop $${stg2.premium_stop.toFixed(2)}, Max Loss $${stg2.maximum_planned_loss.toFixed(0)})${updated.staged_smart_order_id ? ` — Dispatched to Smart Order Engine (${updated.staged_smart_order_id})` : ''}`
          );
          setTimeout(() => setStage2Notice(null), 7000);
        }
      } else {
        const res = await fetch(
          '/api/llm-decision-pipeline/stage2-risk-fulfill',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision_id: record.decision_id,
              fulfill_smart_order: fulfillSmartOrder,
              client_raw_stage2_llm_content: clientRawStage2,
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const stg2 =
            data.decision_record?.risk_first_execution_plan
              ?.stage2_llm_risk_assessment;
          if (stg2) {
            setStage2Notice(
              `Stage-2 LLM Risk & Size Assessment: ${stg2.decision} (${stg2.quantity}x @ $${stg2.entry_limit.toFixed(2)}) — Sent to Smart Order Engine`
            );
            setTimeout(() => setStage2Notice(null), 7000);
          }
        }
      }
    } finally {
      setRunningStage2Id(null);
    }
  };

  const handleOperatorGateAction = async (
    decisionId: string,
    action:
      | 'approve_and_stage_smart_order'
      | 'move_to_watchlist'
      | 'reject_decision'
  ) => {
    setApprovingId(decisionId);
    try {
      await onApproveAction({ decision_id: decisionId, action });
    } finally {
      setApprovingId(null);
    }
  };

  const handleCopyEvidencePacket = async () => {
    if (!activeRecord) return;
    try {
      await navigator.clipboard.writeText(
        activeRecord.prompt_payload.evidence_packet_json
      );
      setCopiedPacket(true);
      setTimeout(() => setCopiedPacket(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Automated 2-Stage LLM Risk-First Execution Banner */}
      <header className="p-5 rounded-lg border border-slate-800 bg-[#111726] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-sky-400" />
            <h1 className="text-base font-bold tracking-tight text-slate-100">
              2-Stage LLM Trade-Decision &amp; Risk-First Smart Order Pipeline
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-300 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              <span>
                {autoFulfillSmartOrder
                  ? 'AUTO-ORDER FULFILLMENT ACTIVE'
                  : 'MANUAL GATE MODE'}
              </span>
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-4xl">
            Scans ranked option contracts, runs{' '}
            <span className="text-slate-200 font-semibold">
              Stage-1 LLM Trade Decision
            </span>{' '}
            (<span className="font-mono text-emerald-400">EXECUTE</span> /{' '}
            <span className="font-mono text-amber-400">WATCH</span> /{' '}
            <span className="font-mono text-rose-400">SKIP</span>), verifies
            Alpaca account equity &amp; position limits, runs{' '}
            <span className="text-sky-300 font-semibold">
              Stage-2 LLM Risk &amp; Contract Sizing
            </span>
            , and automatically dispatches approved limit orders to the{' '}
            <span className="text-emerald-300 font-semibold">
              Smart Order Engine
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onRunAutoPipelineCycle && (
            <button
              type="button"
              data-testid="gate-auto-scan-execute-btn"
              disabled={runningAutoCycle}
              onClick={onRunAutoPipelineCycle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>
                {runningAutoCycle
                  ? 'Running Pipeline...'
                  : 'Auto-Scan, Analyze & Place Orders'}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSmartOrderMonitor}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Smart Execution Ledger ({counts.approved} Orders)</span>
          </button>
          <button
            type="button"
            onClick={onOpenLlmSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>
              LM Studio ({llmEngineConfig.modelId || 'Configure'})
            </span>
          </button>
        </div>
      </header>

      {/* 4-State Decision KPI Cards */}
      <section
        aria-label="4-State LLM Decision Summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
      >
        {(
          ['EXECUTE', 'WATCH', 'HUMAN REVIEW', 'SKIP'] as LlmTradeGateDecision[]
        ).map((decisionKey) => {
          const meta = DECISION_METADATA[decisionKey];
          const style = DECISION_STYLES[decisionKey];
          const isSelected = decisionFilter === decisionKey;
          return (
            <button
              key={decisionKey}
              type="button"
              onClick={() =>
                setDecisionFilter((prev) =>
                  prev === decisionKey ? 'ALL' : decisionKey
                )
              }
              className={`text-left p-4 rounded-lg border transition-colors ${
                isSelected
                  ? `${style.badgeBorder} ${style.badgeBg}`
                  : 'border-slate-800 bg-[#111726] hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${style.badgeBorder} ${style.badgeBg} ${style.badgeText}`}
                >
                  {decisionKey}
                </span>
                <span className="text-xl font-mono font-bold text-slate-100">
                  {counts[decisionKey]}
                </span>
              </div>
              <div className="text-xs font-semibold text-slate-200 mt-2">
                {meta.shortDescription}
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                {meta.operatorActionGuidance}
              </p>
            </button>
          );
        })}
      </section>

      {/* Interactive Evidence Packet Builder & LLM Decision Gate Runner */}
      <section
        aria-label="LLM Decision Gate Dispatcher"
        className="p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Dispatch Structured Evidence Packet to LLM Decision Gate
            </h2>
            <p className="text-xs text-slate-400">
              Compiles Sections A–G (Unusual Whales Contract/Flow, Alpaca
              Underlying Confirmation, Ticker &amp; SPX GEX, Market/Sector Tide,
              IV/Skew, Catalysts &amp; Smart Execution Risk) and evaluates the
              4-state decision gate.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleRunEvaluation('force_execute_aligned')}
              className="px-2.5 py-1 text-[11px] font-mono rounded border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 transition-colors"
            >
              Test EXECUTE Packet
            </button>
            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleRunEvaluation('force_watch_vwap')}
              className="px-2.5 py-1 text-[11px] font-mono rounded border border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 text-amber-300 transition-colors"
            >
              Test WATCH Packet
            </button>
            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleRunEvaluation('force_human_review_ambiguity')}
              className="px-2.5 py-1 text-[11px] font-mono rounded border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/40 text-purple-300 transition-colors"
            >
              Test HUMAN REVIEW Packet
            </button>
            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleRunEvaluation('force_skip_contradicted')}
              className="px-2.5 py-1 text-[11px] font-mono rounded border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 transition-colors"
            >
              Test SKIP Packet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label
              htmlFor="llm-gate-candidate-select"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Ranked Whale Candidate (Highest-Ranked by Current Model Inputs)
            </label>
            <select
              id="llm-gate-candidate-select"
              value={selectedCandidateId}
              onChange={(e) => setSelectedCandidateId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-700 bg-[#0B0F17] text-slate-100"
            >
              {candidates.map((c) => (
                <option key={c.candidate_id} value={c.candidate_id}>
                  {c.ticker} · {c.option_symbol} ({c.direction.toUpperCase()}) ·
                  Whale {c.whale_score} · 5m $
                  {(c.flow.premium_5m / 1000).toFixed(0)}K · Spread{' '}
                  {(c.flow.spread * 100).toFixed(1)}%
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label
              htmlFor="llm-gate-scenario-select"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Evidence Packet Profile / Stress Test
            </label>
            <select
              id="llm-gate-scenario-select"
              value={stressScenario}
              onChange={(e) =>
                setStressScenario(
                  e.target.value as
                    | 'default'
                    | 'force_execute_aligned'
                    | 'force_watch_vwap'
                    | 'force_skip_contradicted'
                    | 'force_human_review_ambiguity'
                )
              }
              className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-700 bg-[#0B0F17] text-slate-100"
            >
              <option value="default">
                Live Candidate Telemetry (Unmodified)
              </option>
              <option value="force_execute_aligned">
                Aligned Opening Sweep + Alpaca VWAP Breakout (EXECUTE)
              </option>
              <option value="force_watch_vwap">
                Inside Opening Range / Testing VWAP (WATCH)
              </option>
              <option value="force_human_review_ambiguity">
                Multi-Leg / 48h Binary Event Ambiguity (HUMAN REVIEW)
              </option>
              <option value="force_skip_contradicted">
                Lost VWAP + Opposing Flow + Wide Spread (SKIP)
              </option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="llm-gate-mode-select"
              className="block text-xs font-medium text-slate-300 mb-1"
            >
              Evaluation Engine
            </label>
            <select
              id="llm-gate-mode-select"
              value={executionMode}
              onChange={(e) =>
                setExecutionMode(
                  e.target.value as
                    | 'auto'
                    | 'live_endpoint_only'
                    | 'deterministic_synthesis'
                )
              }
              className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-700 bg-[#0B0F17] text-slate-100"
            >
              <option value="auto">Auto (LM Studio / Deterministic Gate)</option>
              <option value="deterministic_synthesis">
                Deterministic Institutional Gate
              </option>
              <option value="live_endpoint_only">Live LM Studio Endpoint</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <button
              type="button"
              disabled={evaluating}
              onClick={() => handleRunEvaluation()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors disabled:opacity-50"
            >
              {evaluating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>
                {evaluating ? 'Evaluating...' : 'Evaluate Trade Gate'}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Master-Detail Split View: Decision Ledger (5 cols) + 7-Section Evidence & Approval Inspector (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Decision Gate Queue */}
        <section
          aria-label="LLM Trade Decision Queue"
          className="lg:col-span-5 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Evaluated Contract Queue ({filteredRecords.length})
              </h2>
              <p className="text-xs text-slate-400">
                Select any record to inspect its 7-section Evidence Packet and
                Human/Risk Gate status.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  'ALL',
                  'EXECUTE',
                  'WATCH',
                  'HUMAN REVIEW',
                  'SKIP',
                ] as const
              ).map((flt) => (
                <button
                  key={flt}
                  type="button"
                  onClick={() => setDecisionFilter(flt)}
                  className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                    decisionFilter === flt
                      ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                      : 'border-slate-700 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {flt}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1">
            {filteredRecords.map((rec) => {
              const isSelected = activeRecord?.decision_id === rec.decision_id;
              const style = DECISION_STYLES[rec.llm_output.decision];
              const approvalMeta = APPROVAL_STATUS_LABELS[rec.approval_status];
              const a = rec.evidence_packet.section_a_contract_and_whale_flow;
              const b = rec.evidence_packet.section_b_underlying_confirmation;

              return (
                <button
                  key={rec.decision_id}
                  type="button"
                  onClick={() => setSelectedDecisionId(rec.decision_id)}
                  className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-sky-500/70 bg-sky-950/20'
                      : 'border-slate-800 bg-[#0B0F17] hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono text-slate-100">
                        {rec.ticker}
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {rec.option_symbol}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${style.badgeBorder} ${style.badgeBg} ${style.badgeText}`}
                    >
                      {rec.llm_output.decision}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-2 text-[11px] font-mono text-slate-300">
                    <div>
                      <span className="text-slate-500">FlowScore:</span>{' '}
                      <strong className="text-sky-400">
                        {rec.evidence_packet.flow_score}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">5m Prem:</span> $
                      {(a.premium_5m_dollars / 1000).toFixed(0)}K
                    </div>
                    <div>
                      <span className="text-slate-500">Spread:</span>{' '}
                      <span
                        className={
                          a.spread_pct <= 8.5
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        {a.spread_pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80 text-[11px]">
                    <span className="text-slate-400 font-mono">
                      Intent:{' '}
                      <strong className="text-slate-200">
                        {INTENT_LABELS[rec.llm_output.whale_intent] ??
                          rec.llm_output.whale_intent}
                      </strong>
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${approvalMeta.colorClass}`}
                    >
                      {approvalMeta.label}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 mt-1.5 truncate">
                    Alpaca: {b.alpaca_confirmation_status} (${b.last_trade_price.toFixed(2)} vs VWAP ${b.vwap.toFixed(2)})
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Right: Deep Evidence Packet & Non-Autonomous Gate Inspector */}
        <aside
          aria-label="LLM Evidence Packet and Approval Inspector"
          className="lg:col-span-7 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          {activeRecord ? (
            <>
              {/* Active Record Header */}
              <div className="p-4 rounded-lg border border-slate-800 bg-[#0B0F17] space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold font-mono text-slate-100">
                        {activeRecord.ticker} · {activeRecord.option_symbol}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] font-mono rounded border border-sky-500/40 bg-sky-950/30 text-sky-300">
                        {activeRecord.evidence_packet.model_rank_designation}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono">
                      Recommended Expression:{' '}
                      <strong className="text-slate-200">
                        {activeRecord.llm_output.recommended_structure}
                      </strong>{' '}
                      · Confidence:{' '}
                      <strong className="text-sky-400">
                        {activeRecord.llm_output.confidence_pct}%
                      </strong>{' '}
                      · Intent:{' '}
                      <strong className="text-slate-200">
                        {INTENT_LABELS[activeRecord.llm_output.whale_intent]}
                      </strong>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`inline-block px-3 py-1 text-xs font-mono font-bold rounded border ${
                        DECISION_STYLES[activeRecord.llm_output.decision]
                          .badgeBorder
                      } ${
                        DECISION_STYLES[activeRecord.llm_output.decision]
                          .badgeBg
                      } ${
                        DECISION_STYLES[activeRecord.llm_output.decision]
                          .badgeText
                      }`}
                    >
                      LLM GATE: {activeRecord.llm_output.decision}
                    </span>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {activeRecord.llm_output.decision_badge_subtitle}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-200 leading-relaxed p-2.5 rounded border border-slate-800 bg-[#111726]">
                  {activeRecord.llm_output.thesis_summary}
                </p>

                {/* Automated 2-Stage LLM + Deterministic Risk Execution Status Bar */}
                <div className="p-3 rounded-md border border-slate-800 bg-[#111726] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        Automated 2-Stage LLM &amp; Deterministic Risk Execution Gate
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Pipeline Status:{' '}
                      <strong className="text-slate-200">
                        {
                          APPROVAL_STATUS_LABELS[activeRecord.approval_status]
                            .label
                        }
                      </strong>
                      {activeRecord.staged_smart_order_id && (
                        <span className="ml-2 font-mono text-emerald-400">
                          (Smart Order {activeRecord.staged_smart_order_id})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="auto-reevaluate-sync-order-btn"
                      disabled={runningStage2Id === activeRecord.decision_id}
                      onClick={() =>
                        handleRunStage2RiskAndFulfill(activeRecord, true)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors disabled:opacity-40"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {runningStage2Id === activeRecord.decision_id
                          ? 'Auto-Executing...'
                          : 'Auto-Verify Risk & Dispatch Smart Order'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={onOpenSmartOrderMonitor}
                      className="px-2.5 py-1.5 text-xs font-medium rounded border border-sky-500/40 bg-sky-950/30 hover:bg-sky-900/40 text-sky-300 transition-colors"
                    >
                      Inspect Smart Execution Ledger &rarr;
                    </button>
                  </div>
                </div>
              </div>

              {/* Inspector Navigation Tabs */}
              <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setInspectorTab('decision_gate')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    inspectorTab === 'decision_gate'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200 bg-[#0B0F17]'
                  }`}
                >
                  1. Decision Scorecard &amp; Risk Gate
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('risk_execution_plan')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    inspectorTab === 'risk_execution_plan'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200 bg-[#0B0F17]'
                  }`}
                >
                  2. Risk-First Execution Plan (Alpaca Sizing)
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('packet_a_d')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    inspectorTab === 'packet_a_d'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200 bg-[#0B0F17]'
                  }`}
                >
                  3. Evidence Packet A–D (UW Flow, Alpaca, GEX, Tide)
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('packet_e_g')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    inspectorTab === 'packet_e_g'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200 bg-[#0B0F17]'
                  }`}
                >
                  4. Evidence Packet E–G (IV/Skew, Catalysts, Smart Order)
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('raw_json')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    inspectorTab === 'raw_json'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200 bg-[#0B0F17]'
                  }`}
                >
                  5. Structured Evidence Packet JSON
                </button>
              </div>

              {/* TAB 1: Decision Scorecard & Deterministic Risk Engine Gate */}
              {inspectorTab === 'decision_gate' && (() => {
                const liveRiskPlan = evaluateRiskFirstExecutionPlan({
                  packet: activeRecord.evidence_packet,
                  llmDecision: activeRecord.llm_output.decision,
                  policy: localRiskPolicy,
                  plannedEntryOverride,
                  contractStopOverride,
                });
                return (
                <div className="space-y-4">
                  {/* Simplified Risk-First Execution Summary Strip */}
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          Simplified Risk-First Execution Plan (Alpaca Account Sizing Gate)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${
                            liveRiskPlan.execution_action === 'SUBMIT_LIMIT_ORDER'
                              ? 'border-emerald-500/50 bg-emerald-950/50 text-emerald-300'
                              : liveRiskPlan.execution_action === 'REDUCE_AND_SUBMIT'
                                ? 'border-amber-500/50 bg-amber-950/50 text-amber-300'
                                : 'border-rose-500/50 bg-rose-950/50 text-rose-300'
                          }`}
                        >
                          {liveRiskPlan.execution_action}
                        </span>
                        <button
                          type="button"
                          onClick={() => setInspectorTab('risk_execution_plan')}
                          className="px-2 py-0.5 text-[11px] font-mono rounded border border-sky-500/40 bg-sky-950/30 text-sky-300 hover:bg-sky-900/40"
                        >
                          Open Position Sizer &rarr;
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Account Equity</div>
                        <div className="text-slate-100 font-bold">
                          ${liveRiskPlan.budgets.effective_equity_dollars.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Risk {liveRiskPlan.policy.risk_per_trade_pct.toFixed(2)}% (${liveRiskPlan.budgets.max_dollar_risk_per_trade.toFixed(0)})
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Planned Entry / Stop</div>
                        <div className="text-slate-100 font-bold">
                          ${liveRiskPlan.trade_plan.planned_entry_price.toFixed(2)} / ${liveRiskPlan.trade_plan.contract_stop_price.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          T1: ${liveRiskPlan.trade_plan.contract_first_target_price.toFixed(2)} ({liveRiskPlan.trade_plan.reward_to_risk_ratio.toFixed(2)}R)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Cost / Stop Risk</div>
                        <div className="text-slate-100 font-bold">
                          ${liveRiskPlan.trade_plan.contract_cost_dollars.toFixed(0)} / ${liveRiskPlan.trade_plan.risk_per_contract_dollars.toFixed(0)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          per contract (×100)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Qty Caps (Risk / Alloc)</div>
                        <div className="text-sky-300 font-bold">
                          {liveRiskPlan.sizing.qty_by_dollar_risk}x / {liveRiskPlan.sizing.qty_by_option_allocation}x
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Max Outlay ${liveRiskPlan.budgets.max_premium_outlay_per_trade.toFixed(0)}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Permitted Quantity</div>
                        <div
                          className={`font-bold ${
                            liveRiskPlan.sizing.permitted_qty >= 1
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {liveRiskPlan.sizing.permitted_qty} contract(s)
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Risk ${liveRiskPlan.sizing.total_trade_dollar_risk.toFixed(0)} · Outlay ${liveRiskPlan.sizing.deployed_premium_dollars.toFixed(0)}
                        </div>
                      </div>
                    </div>

                    {/* Stage-2 LLM Risk & Order Size Assessment -> Smart Order Engine Fulfillment Banner */}
                    {liveRiskPlan.stage2_llm_risk_assessment && (
                      <div className="p-3 rounded-md border border-sky-500/30 bg-[#111726] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                            <span className="text-xs font-semibold text-slate-100">
                              Stage-2 LLM Risk &amp; Order Size Assessment → Smart Order Engine
                            </span>
                            <span
                              className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded border ${
                                liveRiskPlan.stage2_llm_risk_assessment.decision ===
                                'APPROVED'
                                  ? 'border-emerald-500/50 bg-emerald-950/60 text-emerald-300'
                                  : 'border-rose-500/50 bg-rose-950/60 text-rose-300'
                              }`}
                            >
                              {liveRiskPlan.stage2_llm_risk_assessment.decision} ·{' '}
                              {liveRiskPlan.stage2_llm_risk_assessment.quantity}x Contracts
                            </span>
                          </div>
                          <button
                            type="button"
                            data-testid="run-stage2-llm-risk-fulfill-btn"
                            disabled={runningStage2Id === activeRecord.decision_id}
                            onClick={() =>
                              handleRunStage2RiskAndFulfill(activeRecord, true)
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-semibold rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors"
                          >
                            <Zap className="w-3 h-3" />
                            <span>
                              {runningStage2Id === activeRecord.decision_id
                                ? 'Assessing Risk & Fulfilling...'
                                : `Run Stage-2 LLM Risk & Send ${liveRiskPlan.stage2_llm_risk_assessment.quantity}x to Smart Order Engine`}
                            </span>
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {liveRiskPlan.stage2_llm_risk_assessment.llm_risk_narrative}
                        </p>
                        {liveRiskPlan.stage2_llm_risk_assessment
                          .initial_trading_strategy && (
                          <div
                            data-testid="stage2-initial-trading-strategy-card"
                            className="p-2.5 rounded border border-slate-800 bg-[#0B0F17] space-y-1.5 text-[11px]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-emerald-300 font-mono">
                                Initial Trading Strategy:{' '}
                                {
                                  liveRiskPlan.stage2_llm_risk_assessment
                                    .initial_trading_strategy.strategy_name
                                }
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono text-[10px]">
                                Reward/Risk:{' '}
                                {liveRiskPlan.stage2_llm_risk_assessment.initial_trading_strategy.reward_to_risk_ratio.toFixed(
                                  2
                                )}
                                R
                              </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-300">
                              <div>
                                <span className="text-slate-400 font-mono">
                                  Entry Plan:{' '}
                                </span>
                                {
                                  liveRiskPlan.stage2_llm_risk_assessment
                                    .initial_trading_strategy
                                    .entry_execution_plan
                                }
                              </div>
                              <div>
                                <span className="text-slate-400 font-mono">
                                  Profit Targets:{' '}
                                </span>
                                {
                                  liveRiskPlan.stage2_llm_risk_assessment
                                    .initial_trading_strategy.profit_target_plan
                                }
                              </div>
                              <div>
                                <span className="text-slate-400 font-mono">
                                  Stop &amp; Invalidation:{' '}
                                </span>
                                {
                                  liveRiskPlan.stage2_llm_risk_assessment
                                    .initial_trading_strategy
                                    .stop_and_invalidation_plan
                                }
                              </div>
                              <div>
                                <span className="text-slate-400 font-mono">
                                  Time &amp; Theta:{' '}
                                </span>
                                {
                                  liveRiskPlan.stage2_llm_risk_assessment
                                    .initial_trading_strategy
                                    .time_and_theta_plan
                                }
                              </div>
                            </div>
                          </div>
                        )}
                        {stage2Notice && (
                          <div className="p-2 rounded bg-emerald-950/50 border border-emerald-500/40 text-[11px] font-mono text-emerald-200">
                            {stage2Notice}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 6-Pillar Scorecard */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-200">
                      6-Pillar Evidence Alignment Scorecard
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {activeRecord.llm_output.pillar_scorecard.map((pillar) => (
                        <div
                          key={pillar.pillar_id}
                          className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-100">
                              {pillar.label}
                            </span>
                            <span
                              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                pillar.status === 'ALIGNED'
                                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/40'
                                  : pillar.status === 'WATCH_NEEDS_CONFIRMATION'
                                    ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                                    : pillar.status === 'AMBIGUOUS_HUMAN_REVIEW'
                                      ? 'bg-purple-950/60 text-purple-300 border border-purple-500/40'
                                      : 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {pillar.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {pillar.finding}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Deterministic Risk Engine 5 Hard Checks */}
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                        <span>
                          Deterministic Risk Engine Pre-Execution Checks (Non-LLM
                          Hard Gate)
                        </span>
                      </span>
                      <span
                        className={`text-xs font-mono font-bold ${
                          activeRecord.deterministic_risk_gate
                            .passed_all_hard_gates
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {activeRecord.deterministic_risk_gate
                          .passed_all_hard_gates
                          ? 'ALL 5 HARD GATES PASSED'
                          : `${activeRecord.deterministic_risk_gate.blockers.length} RISK GATE FLAG(S)`}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {activeRecord.deterministic_risk_gate.checks.map((chk) => (
                        <div
                          key={chk.id}
                          className="flex items-center justify-between gap-2 text-xs p-2 rounded bg-[#111726]"
                        >
                          <div className="flex items-center gap-1.5">
                            {chk.passed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            )}
                            <span className="text-slate-200 font-medium">
                              {chk.label}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400">
                            {chk.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Supporting Reasons, Contradictions & Watch Triggers */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-1.5">
                      <div className="text-xs font-semibold text-emerald-400">
                        Supporting Institutional Evidence
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {activeRecord.llm_output.supporting_reasons.map((r) => (
                          <li key={r}>• {r}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-1.5">
                      <div className="text-xs font-semibold text-amber-400">
                        Contradictions, Watch Triggers &amp; Invalidation
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {activeRecord.llm_output.contradictions_and_risks.map(
                          (c) => (
                            <li key={c}>• {c}</li>
                          )
                        )}
                        {activeRecord.llm_output.watch_confirmation_triggers.map(
                          (w) => (
                            <li key={w} className="text-sky-300">
                              → Watch Trigger: {w}
                            </li>
                          )
                        )}
                      </ul>
                      <div className="pt-1.5 mt-1.5 border-t border-slate-800 text-[11px] font-mono text-rose-300">
                        Invalidation: {activeRecord.llm_output.invalidation_level}
                      </div>
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* TAB 2: Simplified Risk-First Execution Plan & Alpaca Position Sizer */}
              {inspectorTab === 'risk_execution_plan' && (() => {
                const plan = evaluateRiskFirstExecutionPlan({
                  packet: activeRecord.evidence_packet,
                  llmDecision: activeRecord.llm_output.decision,
                  policy: localRiskPolicy,
                  plannedEntryOverride,
                  contractStopOverride,
                });
                const tp = plan.trade_plan;
                const b = plan.budgets;
                const sz = plan.sizing;
                const snap = plan.alpaca_snapshot;

                return (
                  <div className="space-y-4 text-xs">
                    {/* 1. Minimal 7-Step Risk-First Workflow Pipeline */}
                    <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-100">
                            1. Minimal 7-Step Risk-First Execution Workflow
                          </div>
                          <div className="text-[11px] text-slate-400">
                            The LLM chooses EXECUTE / WATCH / SKIP. The deterministic risk engine decides whether you can afford the trade and how many contracts to buy.
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 text-xs font-mono font-bold rounded border ${
                            plan.execution_action === 'SUBMIT_LIMIT_ORDER'
                              ? 'border-emerald-500/50 bg-emerald-950/60 text-emerald-300'
                              : plan.execution_action === 'REDUCE_AND_SUBMIT'
                                ? 'border-amber-500/50 bg-amber-950/60 text-amber-300'
                                : 'border-rose-500/50 bg-rose-950/60 text-rose-300'
                          }`}
                        >
                          {plan.execution_action}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-[11px]">
                        {plan.workflow_steps.map((step) => (
                          <div
                            key={step.step_number}
                            className="p-2.5 rounded border border-slate-800 bg-[#111726] space-y-1"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-slate-300 font-semibold">
                                {step.step_number}. {step.title}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 text-[10px] rounded font-bold ${
                                  step.status === 'PASSED'
                                    ? 'bg-emerald-950/60 text-emerald-300'
                                    : step.status === 'REDUCED'
                                      ? 'bg-amber-950/60 text-amber-300'
                                      : 'bg-rose-950/60 text-rose-300'
                                }`}
                              >
                                {step.status}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug">
                              {step.summary}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 2. Simple Risk Policy Configurator (Account Equity & Constants) */}
                    <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-sky-400">
                            2. Simple Account-Level Risk Policy Constants
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Trade must satisfy both: maximum loss if stopped AND maximum premium/capital allocated.
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPlannedEntryOverride(undefined);
                              setContractStopOverride(undefined);
                              handleApplyRiskPolicyPatch(
                                DEFAULT_RISK_POLICY_CONFIG
                              );
                            }}
                            className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                              localRiskPolicy.equity_source === 'alpaca_account' &&
                              plannedEntryOverride === undefined
                                ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                                : 'border-slate-700 bg-[#111726] text-slate-300 hover:text-white'
                            }`}
                          >
                            Live Alpaca Account ($105,976)
                          </button>
                          <button
                            type="button"
                            data-testid="apply-25k-spec-example-btn"
                            onClick={() => {
                              setPlannedEntryOverride(5.0);
                              setContractStopOverride(3.75);
                              handleApplyRiskPolicyPatch({
                                ...SPEC_25K_EXAMPLE_RISK_POLICY,
                                desired_contracts: 1,
                              });
                            }}
                            className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                              localRiskPolicy.equity_source ===
                                'custom_equity' &&
                              localRiskPolicy.custom_equity_dollars === 25000 &&
                              plannedEntryOverride === 5.0
                                ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                                : 'border-slate-700 bg-[#111726] text-slate-300 hover:text-white'
                            }`}
                          >
                            Spec Example ($25,000 · Entry $5.00 · Stop $3.75 · 1x)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPlannedEntryOverride(undefined);
                              setContractStopOverride(undefined);
                              handleApplyRiskPolicyPatch(
                                SPEC_25K_EXAMPLE_RISK_POLICY
                              );
                            }}
                            className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                              localRiskPolicy.equity_source ===
                                'custom_equity' &&
                              plannedEntryOverride === undefined
                                ? 'border-rose-400 bg-rose-500/20 text-rose-300'
                                : 'border-slate-700 bg-[#111726] text-slate-300 hover:text-white'
                            }`}
                          >
                            Test $25K Reject ($766 &gt; $750 Cap)
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 font-mono text-[11px]">
                        <label className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-1 block">
                          <div className="flex justify-between text-slate-400">
                            <span>risk_per_trade_pct</span>
                            <strong className="text-emerald-400">
                              {localRiskPolicy.risk_per_trade_pct.toFixed(2)}%
                            </strong>
                          </div>
                          <input
                            type="range"
                            min={0.25}
                            max={1.0}
                            step={0.05}
                            aria-label="risk_per_trade_pct"
                            value={localRiskPolicy.risk_per_trade_pct}
                            onChange={(e) =>
                              handleApplyRiskPolicyPatch({
                                risk_per_trade_pct: Number(e.target.value),
                              })
                            }
                            className="w-full accent-emerald-400"
                          />
                          <div className="text-[10px] text-slate-400">
                            Max Dollar Risk: <strong className="text-slate-100">${b.max_dollar_risk_per_trade.toFixed(0)}</strong> (0.25%–1.00%)
                          </div>
                        </label>

                        <label className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-1 block">
                          <div className="flex justify-between text-slate-400">
                            <span>max_option_allocation</span>
                            <strong className="text-sky-400">
                              {localRiskPolicy.max_option_allocation_pct.toFixed(2)}%
                            </strong>
                          </div>
                          <input
                            type="range"
                            min={2.0}
                            max={5.0}
                            step={0.25}
                            aria-label="max_option_allocation"
                            value={localRiskPolicy.max_option_allocation_pct}
                            onChange={(e) =>
                              handleApplyRiskPolicyPatch({
                                max_option_allocation_pct: Number(e.target.value),
                              })
                            }
                            className="w-full accent-sky-400"
                          />
                          <div className="text-[10px] text-slate-400">
                            Max Premium Outlay: <strong className="text-slate-100">${b.max_premium_outlay_per_trade.toFixed(0)}</strong> (2%–5%)
                          </div>
                        </label>

                        <label className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-1 block">
                          <div className="flex justify-between text-slate-400">
                            <span>max_total_open_risk</span>
                            <strong className="text-amber-400">
                              {localRiskPolicy.max_total_open_risk_pct.toFixed(2)}%
                            </strong>
                          </div>
                          <input
                            type="range"
                            min={1.0}
                            max={3.0}
                            step={0.25}
                            aria-label="max_total_open_risk"
                            value={localRiskPolicy.max_total_open_risk_pct}
                            onChange={(e) =>
                              handleApplyRiskPolicyPatch({
                                max_total_open_risk_pct: Number(e.target.value),
                              })
                            }
                            className="w-full accent-amber-400"
                          />
                          <div className="text-[10px] text-slate-400">
                            Remaining Cap: <strong className="text-slate-100">${b.remaining_total_open_risk_dollars.toFixed(0)}</strong> (1%–3%)
                          </div>
                        </label>

                        <label className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-1 block">
                          <div className="flex justify-between text-slate-400">
                            <span>max_same_ticker_pct</span>
                            <strong className="text-purple-300">
                              {localRiskPolicy.max_same_ticker_pct.toFixed(1)}%
                            </strong>
                          </div>
                          <input
                            type="range"
                            min={2.0}
                            max={10.0}
                            step={0.5}
                            aria-label="max_same_ticker_pct"
                            value={localRiskPolicy.max_same_ticker_pct}
                            onChange={(e) =>
                              handleApplyRiskPolicyPatch({
                                max_same_ticker_pct: Number(e.target.value),
                              })
                            }
                            className="w-full accent-purple-400"
                          />
                          <div className="text-[10px] text-slate-400">
                            Ticker Cap: <strong className="text-slate-100">${b.max_same_ticker_dollars.toFixed(0)}</strong> (Default 5%)
                          </div>
                        </label>

                        <label className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-1 block">
                          <div className="flex justify-between text-slate-400">
                            <span>desired_contracts</span>
                            <strong className="text-slate-100">
                              {localRiskPolicy.desired_contracts}x
                            </strong>
                          </div>
                          <input
                            type="range"
                            min={1}
                            max={20}
                            step={1}
                            aria-label="desired_contracts"
                            value={localRiskPolicy.desired_contracts}
                            onChange={(e) =>
                              handleApplyRiskPolicyPatch({
                                desired_contracts: Number(e.target.value),
                              })
                            }
                            className="w-full accent-sky-400"
                          />
                          <div className="text-[10px] text-slate-400">
                            Permitted: <strong className="text-emerald-400">{sz.permitted_qty}x</strong> (Max {sz.raw_permitted_qty}x)
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* 3. Entry, Stop, First Target & Risk Per Contract */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                        <div className="font-semibold text-emerald-400">
                          3. Entry, Stop, First Target &amp; Risk Per Contract (×100)
                        </div>
                        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">Planned Limit Entry</div>
                            <div className="text-slate-100 font-bold text-sm">
                              ${tp.planned_entry_price.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              contract_cost = ${tp.planned_entry_price.toFixed(2)} × 100 = <strong className="text-slate-200">${tp.contract_cost_dollars.toFixed(0)}</strong>
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">Option Stop Price</div>
                            <div className="text-rose-400 font-bold text-sm">
                              ${tp.contract_stop_price.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Spot Invalidation: <strong className="text-rose-300">${tp.underlying_invalidation_stop.toFixed(2)}</strong> ({tp.underlying_stop_distance_pct.toFixed(2)}%)
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">risk_per_contract</div>
                            <div className="text-amber-300 font-bold text-sm">
                              ${tp.risk_per_contract_dollars.toFixed(0)} / contract
                            </div>
                            <div className="text-[10px] text-slate-400">
                              (${tp.planned_entry_price.toFixed(2)} - ${tp.contract_stop_price.toFixed(2)}) × 100 ({tp.stop_loss_pct_of_premium.toFixed(0)}% of premium)
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">First Target (T1)</div>
                            <div className="text-emerald-400 font-bold text-sm">
                              ${tp.contract_first_target_price.toFixed(2)} ({tp.reward_to_risk_ratio.toFixed(2)}R)
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Underlying T1: <strong className="text-emerald-300">${tp.underlying_first_target.toFixed(2)}</strong> (+${tp.reward_per_contract_dollars.toFixed(0)}/ct)
                            </div>
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          Stop Method: {tp.stop_calculation_method}
                        </div>
                      </div>

                      {/* 4. Permitted Quantity & Binding Constraint Calculation */}
                      <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                        <div className="font-semibold text-sky-400">
                          4. Permitted Quantity Calculation (Dual Risk &amp; Capital Caps)
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">By Max Dollar Risk</div>
                            <div className="text-emerald-400 font-bold text-sm">
                              {sz.qty_by_dollar_risk}x
                            </div>
                            <div className="text-[10px] text-slate-400">
                              floor(${b.max_dollar_risk_per_trade.toFixed(0)} / ${tp.risk_per_contract_dollars.toFixed(0)})
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">By Capital Alloc</div>
                            <div className="text-sky-400 font-bold text-sm">
                              {sz.qty_by_option_allocation}x
                            </div>
                            <div className="text-[10px] text-slate-400">
                              floor(${b.max_premium_outlay_per_trade.toFixed(0)} / ${tp.contract_cost_dollars.toFixed(0)})
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">By Open Risk / Ticker</div>
                            <div className="text-slate-200 font-bold text-sm">
                              {sz.qty_by_total_open_risk}x / {sz.qty_by_same_ticker_cap}x
                            </div>
                            <div className="text-[10px] text-slate-400">
                              BP Cap: {sz.qty_by_buying_power}x
                            </div>
                          </div>
                        </div>

                        <div className="p-2.5 rounded border border-slate-800 bg-[#111726] font-mono text-[11px] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">
                              Final Permitted Contracts (Req {sz.desired_contracts}x):
                            </span>
                            <strong
                              className={`text-sm ${
                                sz.permitted_qty >= 1
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {sz.permitted_qty} contract(s)
                            </strong>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Binding Constraint: <span className="text-sky-300">{sz.binding_constraint_explanation}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 5. Alpaca Account, Entitlements & Open Position Data */}
                    <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100">
                          5. Alpaca Trading API Account &amp; Entitlement Snapshot
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {snap.endpoints_queried.join(' · ')}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-[11px]">
                        <div className="p-2 rounded bg-[#111726]">
                          <div className="text-slate-400">equity / portfolio</div>
                          <div className="text-slate-100 font-bold">
                            ${snap.equity.toLocaleString()}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#111726]">
                          <div className="text-slate-400">cash / option_bp</div>
                          <div className="text-emerald-400 font-bold">
                            ${snap.cash.toLocaleString()} / ${snap.option_buying_power.toLocaleString()}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#111726]">
                          <div className="text-slate-400">buying_power / regt</div>
                          <div className="text-slate-100 font-bold">
                            ${snap.buying_power.toLocaleString()} / ${snap.regt_buying_power.toLocaleString()}
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#111726]">
                          <div className="text-slate-400">options_approved_level</div>
                          <div className="text-sky-400 font-bold">
                            Level {snap.options_approved_level} (PDT: {String(snap.pattern_day_trader)})
                          </div>
                        </div>
                        <div className="p-2 rounded bg-[#111726]">
                          <div className="text-slate-400">trading / acct_blocked</div>
                          <div className="text-emerald-400 font-bold">
                            {String(snap.trading_blocked)} / {String(snap.account_blocked)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 6. Staged Limit Order Payload & Execution Gate Action */}
                    <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-100">
                            6. Deterministic Order Gate Decision: {plan.action_headline}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {plan.action_rationale}
                          </div>
                        </div>
                        {plan.limit_order_payload && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-300">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>
                                {activeRecord.staged_smart_order_id
                                  ? `AUTO-SUBMITTED (${activeRecord.staged_smart_order_id} · ${sz.permitted_qty}x @ $${tp.planned_entry_price.toFixed(2)})`
                                  : `AUTO-ELIGIBLE (${sz.permitted_qty}x @ $${tp.planned_entry_price.toFixed(2)})`}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={onOpenLlmSettings}
                              className="text-[11px] text-sky-400 hover:underline"
                            >
                              Approval Policy in Settings →
                            </button>
                          </div>
                        )}
                      </div>

                      {plan.limit_order_payload ? (
                        <pre className="p-3 rounded border border-slate-800 bg-[#111726] text-[11px] font-mono text-emerald-300 overflow-x-auto">
                          {JSON.stringify(plan.limit_order_payload, null, 2)}
                        </pre>
                      ) : (
                        <div className="p-3 rounded border border-rose-500/40 bg-rose-950/20 text-rose-300 font-mono text-[11px]">
                          ORDER REJECTED BY RISK ENGINE: {plan.hard_reject_reasons.join(' · ') || sz.binding_constraint_explanation}
                        </div>
                      )}
                    </div>

                    {/* 7. Stage-2 LLM Risk & Order Size Assessment + Section 10 Input/Output Contract */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      <div className="p-3.5 rounded-md border border-sky-500/40 bg-[#0B0F17] space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-semibold text-sky-400 flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>
                                7. Stage-2 LLM Risk &amp; Order Size Assessment
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Runs after Initial Stage-1 EXECUTE to assess risk &amp; order size before Smart Order Engine fulfillment
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={runningStage2Id === activeRecord.decision_id}
                            onClick={() =>
                              handleRunStage2RiskAndFulfill(activeRecord, true)
                            }
                            className="px-2.5 py-1 text-[11px] font-mono font-semibold rounded bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors"
                          >
                            {runningStage2Id === activeRecord.decision_id
                              ? 'Running Stage-2...'
                              : 'Assess Risk & Fulfill Smart Order'}
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">Stage-2 Decision</div>
                            <div
                              className={`font-bold ${
                                plan.stage2_llm_risk_assessment.decision ===
                                'APPROVED'
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {plan.stage2_llm_risk_assessment.decision}
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">Approved Quantity</div>
                            <div className="text-slate-100 font-bold">
                              {plan.stage2_llm_risk_assessment.quantity} contract(s)
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#111726]">
                            <div className="text-slate-400">Smart Algo</div>
                            <div className="text-sky-300 font-bold truncate">
                              {plan.stage2_llm_risk_assessment.recommended_smart_algo}
                            </div>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {plan.stage2_llm_risk_assessment.llm_risk_narrative}
                        </p>
                        {plan.stage2_llm_risk_assessment
                          .initial_trading_strategy && (
                          <div className="p-2.5 rounded border border-slate-800 bg-[#111726] space-y-1 text-[11px]">
                            <div className="font-mono font-semibold text-emerald-300">
                              Strategy:{' '}
                              {
                                plan.stage2_llm_risk_assessment
                                  .initial_trading_strategy.strategy_name
                              }{' '}
                              (
                              {plan.stage2_llm_risk_assessment.initial_trading_strategy.reward_to_risk_ratio.toFixed(
                                2
                              )}
                              R)
                            </div>
                            <div className="text-slate-300">
                              <strong className="text-slate-400">Entry:</strong>{' '}
                              {
                                plan.stage2_llm_risk_assessment
                                  .initial_trading_strategy.entry_execution_plan
                              }
                            </div>
                            <div className="text-slate-300">
                              <strong className="text-slate-400">
                                Targets:
                              </strong>{' '}
                              {
                                plan.stage2_llm_risk_assessment
                                  .initial_trading_strategy.profit_target_plan
                              }
                            </div>
                            <div className="text-slate-300">
                              <strong className="text-slate-400">Stop:</strong>{' '}
                              {
                                plan.stage2_llm_risk_assessment
                                  .initial_trading_strategy
                                  .stop_and_invalidation_plan
                              }
                            </div>
                            <div className="text-slate-300">
                              <strong className="text-slate-400">
                                Time/Theta:
                              </strong>{' '}
                              {
                                plan.stage2_llm_risk_assessment
                                  .initial_trading_strategy.time_and_theta_plan
                              }
                            </div>
                          </div>
                        )}
                        <div className="text-[11px] font-mono text-emerald-300">
                          {plan.stage2_llm_risk_assessment.execution_notes}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2.5">
                        <div className="font-semibold text-emerald-400">
                          8. Section 10 Input &amp; Output Risk Contract
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <div className="text-[10px] font-mono text-slate-400 mb-1">
                              Input Contract
                            </div>
                            <pre
                              data-testid="risk-engine-input-contract"
                              className="p-2 rounded border border-slate-800 bg-[#111726] text-[10px] font-mono text-sky-300 overflow-x-auto max-h-44"
                            >
                              {JSON.stringify(plan.input_contract, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[10px] font-mono text-slate-400 mb-1">
                              Output Contract
                            </div>
                            <pre
                              data-testid="risk-engine-output-contract"
                              className="p-2 rounded border border-slate-800 bg-[#111726] text-[10px] font-mono text-emerald-300 overflow-x-auto max-h-44"
                            >
                              {JSON.stringify(plan.output_contract, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* TAB 2: Required LLM Data Packet Sections A, B, C, D */}
              {inspectorTab === 'packet_a_d' && (
                <div className="space-y-3.5 text-xs">
                  {/* Section A: Contract & Whale-Flow Evidence */}
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-sky-400">
                        A. Contract &amp; Whale-Flow Evidence (Unusual Whales)
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {activeRecord.evidence_packet.section_a_contract_and_whale_flow.uw_endpoints_used.join(
                          ' · '
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">5m / 15m Premium</div>
                        <div className="text-slate-100 font-bold">
                          $
                          {(
                            activeRecord.evidence_packet
                              .section_a_contract_and_whale_flow
                              .premium_5m_dollars / 1000
                          ).toFixed(0)}
                          K / $
                          {(
                            activeRecord.evidence_packet
                              .section_a_contract_and_whale_flow
                              .premium_15m_dollars / 1000
                          ).toFixed(0)}
                          K
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Ask / Bid Side %</div>
                        <div className="text-emerald-400 font-bold">
                          {activeRecord.evidence_packet.section_a_contract_and_whale_flow.ask_side_pct.toFixed(
                            0
                          )}
                          % Ask /{' '}
                          {activeRecord.evidence_packet.section_a_contract_and_whale_flow.bid_side_pct.toFixed(
                            0
                          )}
                          % Bid
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Vol / OI Ratio</div>
                        <div className="text-slate-100 font-bold">
                          {activeRecord.evidence_packet.section_a_contract_and_whale_flow.greeks_and_oi.volume_oi_ratio.toFixed(
                            2
                          )}
                          x (
                          {activeRecord.evidence_packet.section_a_contract_and_whale_flow.greeks_and_oi.volume.toLocaleString()}{' '}
                          /{' '}
                          {activeRecord.evidence_packet.section_a_contract_and_whale_flow.greeks_and_oi.open_interest.toLocaleString()}
                          )
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">
                          Single-Leg vs Opposing
                        </div>
                        <div className="text-slate-100 font-bold">
                          Multileg{' '}
                          {(
                            activeRecord.evidence_packet
                              .section_a_contract_and_whale_flow
                              .structure_and_intent.multileg_ratio * 100
                          ).toFixed(0)}
                          % · Opp{' '}
                          {(
                            activeRecord.evidence_packet
                              .section_a_contract_and_whale_flow
                              .structure_and_intent
                              .same_ticker_opposing_flow_ratio * 100
                          ).toFixed(0)}
                          %
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-300 font-mono">
                      WS Live Follow-Through:{' '}
                      <span className="text-sky-300">
                        {
                          activeRecord.evidence_packet
                            .section_a_contract_and_whale_flow
                            .ws_live_follow_through.summary
                        }
                      </span>
                    </div>

                    {activeRecord.evidence_packet
                      .section_a_contract_and_whale_flow
                      .contract_aggregation && (
                      <div className="p-2.5 rounded border border-sky-500/30 bg-[#111726] text-[11px] font-mono text-slate-200 space-y-1">
                        <div className="flex items-center justify-between text-sky-300 font-semibold">
                          <span>
                            Contract Activity Aggregation (
                            {
                              activeRecord.evidence_packet
                                .section_a_contract_and_whale_flow
                                .contract_aggregation.aggregated_print_count
                            }{' '}
                            Prints)
                          </span>
                          <span>
                            VWAP $
                            {activeRecord.evidence_packet.section_a_contract_and_whale_flow.contract_aggregation.vwap_fill_price.toFixed(
                              2
                            )}{' '}
                            ·{' '}
                            {activeRecord.evidence_packet.section_a_contract_and_whale_flow.contract_aggregation.price_progression.replace(
                              /_/g,
                              ' '
                            )}
                          </span>
                        </div>
                        <div className="text-slate-400">
                          {
                            activeRecord.evidence_packet
                              .section_a_contract_and_whale_flow
                              .contract_aggregation.aggregation_summary
                          }
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section B: Alpaca Underlying Price Confirmation */}
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-emerald-400">
                        B. Underlying Price Confirmation (Alpaca Market Data)
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {activeRecord.evidence_packet.section_b_underlying_confirmation.alpaca_endpoints_used
                          .slice(0, 3)
                          .join(' · ')}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Last Price vs VWAP</div>
                        <div className="text-slate-100 font-bold">
                          $
                          {activeRecord.evidence_packet.section_b_underlying_confirmation.last_trade_price.toFixed(
                            2
                          )}{' '}
                          vs $
                          {activeRecord.evidence_packet.section_b_underlying_confirmation.vwap.toFixed(
                            2
                          )}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Opening Range (ORB)</div>
                        <div className="text-slate-100 font-bold">
                          $
                          {activeRecord.evidence_packet.section_b_underlying_confirmation.opening_range_low.toFixed(
                            2
                          )}
                          –$
                          {activeRecord.evidence_packet.section_b_underlying_confirmation.opening_range_high.toFixed(
                            2
                          )}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Intraday RVOL</div>
                        <div className="text-sky-400 font-bold">
                          {activeRecord.evidence_packet.section_b_underlying_confirmation.relative_volume_vs_intraday_norm.toFixed(
                            2
                          )}
                          x
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Short-Term Trend</div>
                        <div className="text-slate-100 font-bold">
                          {activeRecord.evidence_packet.section_b_underlying_confirmation.short_term_trend.replace(
                            /_/g,
                            ' '
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-300">
                      {
                        activeRecord.evidence_packet
                          .section_b_underlying_confirmation.confirmation_summary
                      }
                    </div>
                  </div>

                  {/* Section C: Ticker Gamma / Dealer Positioning */}
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-purple-300">
                        C. Ticker Gamma / Dealer Positioning &amp; SPX Context
                        (Unusual Whales)
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        Regime:{' '}
                        {
                          activeRecord.evidence_packet
                            .section_c_ticker_gamma_positioning
                            .dealer_gamma_regime
                        }
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Ticker Call Wall</div>
                        <div className="text-emerald-400 font-bold">
                          $
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.call_wall.toFixed(
                            2
                          )}{' '}
                          (
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.distance_to_call_wall_pct.toFixed(
                            2
                          )}
                          %)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Ticker Put Wall</div>
                        <div className="text-rose-400 font-bold">
                          $
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.put_wall.toFixed(
                            2
                          )}{' '}
                          (
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.distance_to_put_wall_pct.toFixed(
                            2
                          )}
                          %)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Gamma Flip / Magnet</div>
                        <div className="text-slate-100 font-bold">
                          $
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.gamma_flip.toFixed(
                            2
                          )}{' '}
                          / $
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.gamma_magnet.toFixed(
                            2
                          )}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">SPX Index Context</div>
                        <div className="text-amber-300 font-bold">
                          SPX{' '}
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.spx_index_context.spx_spot.toFixed(
                            0
                          )}{' '}
                          (Flip{' '}
                          {activeRecord.evidence_packet.section_c_ticker_gamma_positioning.spx_index_context.spx_gamma_flip.toFixed(
                            0
                          )}
                          )
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-amber-200/90 font-mono">
                      Guardrail:{' '}
                      {
                        activeRecord.evidence_packet
                          .section_c_ticker_gamma_positioning.spx_index_context
                          .spx_vs_spy_guardrail_note
                      }
                    </div>
                  </div>

                  {/* Section D: Market-Regime Context */}
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-amber-400">
                        D. Market-Regime, Sector &amp; Benchmark ETF Tide Context
                      </span>
                      <span className="text-[11px] font-mono text-slate-300">
                        {
                          activeRecord.evidence_packet
                            .section_d_market_regime_context
                            .active_strategy_regime_label
                        }
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">
                          Market Tide 5m Call/Put
                        </div>
                        <div className="text-slate-100 font-bold">
                          $
                          {activeRecord.evidence_packet.section_d_market_regime_context.call_tide_slope_5m_m.toFixed(
                            1
                          )}
                          M / $
                          {activeRecord.evidence_packet.section_d_market_regime_context.put_tide_slope_5m_m.toFixed(
                            1
                          )}
                          M
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Sector Tide</div>
                        <div className="text-slate-100 font-bold">
                          {
                            activeRecord.evidence_packet
                              .section_d_market_regime_context.ticker_sector
                          }{' '}
                          (
                          {
                            activeRecord.evidence_packet
                              .section_d_market_regime_context
                              .sector_tide_alignment
                          }
                          )
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">SPY / QQQ Tide</div>
                        <div className="text-slate-100 font-bold">
                          {
                            activeRecord.evidence_packet
                              .section_d_market_regime_context.etf_holdings_tide
                              .SPY.bias
                          }{' '}
                          /{' '}
                          {
                            activeRecord.evidence_packet
                              .section_d_market_regime_context.etf_holdings_tide
                              .QQQ.bias
                          }
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">SPX GEX Posture</div>
                        <div className="text-sky-300 font-bold">
                          {
                            activeRecord.evidence_packet
                              .section_d_market_regime_context.spx_gex_regime
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Sections E, F, G */}
              {inspectorTab === 'packet_e_g' && (
                <div className="space-y-3.5 text-xs">
                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="font-semibold text-sky-400">
                      E. Volatility, Term-Structure &amp; Skew Context
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Contract IV / Rank</div>
                        <div className="text-slate-100 font-bold">
                          {(
                            activeRecord.evidence_packet
                              .section_e_volatility_and_skew.contract_iv * 100
                          ).toFixed(1)}
                          % (IVR{' '}
                          {activeRecord.evidence_packet.section_e_volatility_and_skew.iv_rank_pct.toFixed(
                            0
                          )}
                          %)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">
                          Front/Back IV Ratio
                        </div>
                        <div className="text-slate-100 font-bold">
                          {activeRecord.evidence_packet.section_e_volatility_and_skew.front_back_iv_ratio.toFixed(
                            2
                          )}
                          x
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">IV Crush Risk</div>
                        <div className="text-amber-300 font-bold">
                          {
                            activeRecord.evidence_packet
                              .section_e_volatility_and_skew.iv_crush_risk
                          }
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-300">
                      {
                        activeRecord.evidence_packet
                          .section_e_volatility_and_skew.volatility_summary
                      }
                    </p>
                  </div>

                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="font-semibold text-purple-300">
                      F. Catalyst, Binary Earnings &amp; Dark-Pool Context
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Days to Earnings</div>
                        <div className="text-slate-100 font-bold">
                          {
                            activeRecord.evidence_packet
                              .section_f_catalyst_and_dark_pool.days_to_earnings
                          }
                          d
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">
                          Dark Pool Support / Res
                        </div>
                        <div className="text-slate-100 font-bold">
                          $
                          {activeRecord.evidence_packet.section_f_catalyst_and_dark_pool.dark_pool_nearest_support.toFixed(
                            2
                          )}{' '}
                          / $
                          {activeRecord.evidence_packet.section_f_catalyst_and_dark_pool.dark_pool_nearest_resistance.toFixed(
                            2
                          )}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Dark Pool Bias</div>
                        <div className="text-emerald-400 font-bold">
                          {activeRecord.evidence_packet.section_f_catalyst_and_dark_pool.dark_pool_block_bias.replace(
                            /_/g,
                            ' '
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="font-semibold text-emerald-400">
                      G. Smart Execution Microstructure &amp; Risk Budget
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">
                          Smart Target Limit
                        </div>
                        <div className="text-emerald-400 font-bold">
                          $
                          {activeRecord.evidence_packet.section_g_execution_and_risk_gate.smart_order_target_limit_price.toFixed(
                            2
                          )}{' '}
                          (Theo $
                          {activeRecord.evidence_packet.section_g_execution_and_risk_gate.delta_adjusted_fair_value.toFixed(
                            2
                          )}
                          )
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">Recommended Size</div>
                        <div className="text-slate-100 font-bold">
                          {
                            activeRecord.evidence_packet
                              .section_g_execution_and_risk_gate
                              .recommended_contracts
                          }{' '}
                          contracts ($
                          {activeRecord.evidence_packet.section_g_execution_and_risk_gate.estimated_total_risk_dollars.toLocaleString()}{' '}
                          risk)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-[#111726]">
                        <div className="text-slate-400">
                          Expected Slippage Saved
                        </div>
                        <div className="text-sky-400 font-bold">
                          $
                          {activeRecord.evidence_packet.section_g_execution_and_risk_gate.expected_slippage_saved_per_contract_dollars.toFixed(
                            0
                          )}
                          /contract
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Structured Evidence Packet JSON */}
              {inspectorTab === 'raw_json' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      <FileJson className="w-3.5 h-3.5 text-sky-400" />
                      <span>
                        Structured LLM Evidence Packet JSON (Sections A–G)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyEvidencePacket}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200"
                    >
                      {copiedPacket ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied JSON</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-sky-400" />
                          <span>Copy Evidence Packet</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] text-[11px] font-mono text-slate-300 max-h-[420px] overflow-y-auto">
                    {activeRecord.prompt_payload.evidence_packet_json}
                  </pre>
                </div>
              )}
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
};
