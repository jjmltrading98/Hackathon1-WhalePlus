import React, { useMemo, useState } from 'react';
import type {
  BacktestOutcomeClassification,
  FailureOrDropRootCauseCode,
  LearnedConditionRule,
  LearnedDirectiveType,
  PipelineActivityBacktestRecord,
  SelfLearningBacktestSummaryMetrics,
} from '../engine/selfLearningBacktestEngine';
import type { WhaleCandidate } from '../engine/whaleScannerEngine';
import type { LlmTradeGateDecision } from '../engine/llmTradeDecisionEngine';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  Cpu,
  Database,
  Filter,
  Layers,
  Play,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';

interface BacktestLearningViewProps {
  activities: PipelineActivityBacktestRecord[];
  learnedRules: LearnedConditionRule[];
  summary: SelfLearningBacktestSummaryMetrics;
  candidates: WhaleCandidate[];
  onRefreshState: () => Promise<void>;
  onQueryDeepTelemetry: (activityId: string) => Promise<void>;
  onAnalyzeWithLlm: (
    activityId: string,
    extractRule?: boolean
  ) => Promise<void>;
  onRunBatchBacktest: () => Promise<void>;
  onToggleRule: (ruleId: string, active: boolean) => Promise<void>;
  onUpsertRule: (input: {
    title: string;
    directive_type: LearnedDirectiveType;
    confidence_delta_pct: number;
    recommended_decision_override: LlmTradeGateDecision;
    condition_summary_human: string;
    prompt_injection_instruction: string;
    direction: 'bullish' | 'bearish' | 'any';
    vwap_relationship:
      | 'HOLDING_ABOVE_VWAP'
      | 'HOLDING_BELOW_VWAP'
      | 'RECLAIMING_VWAP'
      | 'LOST_VWAP_CONTRADICTION'
      | 'any';
    dealer_gamma_regime:
      | 'positive_pinning'
      | 'negative_acceleration'
      | 'neutral_transition'
      | 'any';
  }) => Promise<void>;
  onReEvaluateCandidateWithLearnedRules?: (
    candidateId: string,
    ticker: string
  ) => Promise<void>;
  onInspectCandidateChart?: (candidate: WhaleCandidate) => void;
}

type DispositionFilter =
  | 'all'
  | 'executed'
  | 'dropped_skipped'
  | 'watchlist'
  | 'hard_rejected';

type OutcomeFilter = 'all' | BacktestOutcomeClassification;

const fmtNum = (val: number | null | undefined, digits = 2): string =>
  (typeof val === 'number' && Number.isFinite(val) ? val : 0).toFixed(digits);

const fmtInt = (val: number | null | undefined): string =>
  (typeof val === 'number' && Number.isFinite(val) ? val : 0).toLocaleString();

export const BacktestLearningView: React.FC<BacktestLearningViewProps> = ({
  activities,
  learnedRules,
  summary,
  candidates,
  onRefreshState,
  onQueryDeepTelemetry,
  onAnalyzeWithLlm,
  onRunBatchBacktest,
  onToggleRule,
  onUpsertRule,
  onReEvaluateCandidateWithLearnedRules,
  onInspectCandidateChart,
}) => {
  const [dispositionFilter, setDispositionFilter] =
    useState<DispositionFilter>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [rootCauseFilter, setRootCauseFilter] = useState<
    'all' | FailureOrDropRootCauseCode
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedActivityId, setSelectedActivityId] = useState<string>(
    activities[0]?.activity_id ?? ''
  );

  const [isQueryingDeep, setIsQueryingDeep] = useState(false);
  const [isAnalyzingLlm, setIsAnalyzingLlm] = useState(false);
  const [isRunningBatch, setIsRunningBatch] = useState(false);
  const [isReEvaluatingGate, setIsReEvaluatingGate] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // New Custom Rule Form State
  const [showAddRuleForm, setShowAddRuleForm] = useState(false);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleDirective, setNewRuleDirective] =
    useState<LearnedDirectiveType>('BOOST_CONFIDENCE');
  const [newRuleConfidenceDelta, setNewRuleConfidenceDelta] = useState(8);
  const [newRuleOverrideDecision, setNewRuleOverrideDecision] =
    useState<LlmTradeGateDecision>('EXECUTE');
  const [newRuleDirection, setNewRuleDirection] = useState<
    'bullish' | 'bearish' | 'any'
  >('bullish');
  const [newRuleVwap, setNewRuleVwap] = useState<
    | 'HOLDING_ABOVE_VWAP'
    | 'HOLDING_BELOW_VWAP'
    | 'RECLAIMING_VWAP'
    | 'LOST_VWAP_CONTRADICTION'
    | 'any'
  >('HOLDING_ABOVE_VWAP');
  const [newRuleGamma, setNewRuleGamma] = useState<
    | 'positive_pinning'
    | 'negative_acceleration'
    | 'neutral_transition'
    | 'any'
  >('negative_acceleration');
  const [newRuleInstruction, setNewRuleInstruction] = useState('');
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);

  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      if (dispositionFilter === 'executed') {
        if (
          act.execution_or_drop_stage.disposition !==
            'ORDER_FILLED_ACTIVE_OR_CLOSED' &&
          act.execution_or_drop_stage.disposition !== 'ORDER_WORKING_OR_STAGED'
        ) {
          return false;
        }
      } else if (dispositionFilter === 'dropped_skipped') {
        if (
          act.execution_or_drop_stage.disposition !==
            'DROPPED_BY_AI_GATE_SKIP' &&
          act.execution_or_drop_stage.disposition !==
            'DROPPED_BY_RISK_GATE_REJECT' &&
          act.execution_or_drop_stage.disposition !==
            'DROPPED_BY_SCANNER_HARD_REJECT'
        ) {
          return false;
        }
      } else if (dispositionFilter === 'watchlist') {
        if (act.execution_or_drop_stage.disposition !== 'WATCHLIST_QUEUED') {
          return false;
        }
      } else if (dispositionFilter === 'hard_rejected') {
        if (
          act.execution_or_drop_stage.disposition !==
          'DROPPED_BY_SCANNER_HARD_REJECT'
        ) {
          return false;
        }
      }

      if (
        outcomeFilter !== 'all' &&
        act.grade_report.outcome_classification !== outcomeFilter
      ) {
        return false;
      }

      if (
        rootCauseFilter !== 'all' &&
        act.grade_report.root_cause_code !== rootCauseFilter
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toUpperCase();
        if (
          !act.ticker.toUpperCase().includes(q) &&
          !act.option_symbol.toUpperCase().includes(q) &&
          !act.grade_report.root_cause_title.toUpperCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    activities,
    dispositionFilter,
    outcomeFilter,
    rootCauseFilter,
    searchQuery,
  ]);

  const selectedActivity = useMemo(() => {
    return (
      filteredActivities.find((a) => a.activity_id === selectedActivityId) ??
      activities.find((a) => a.activity_id === selectedActivityId) ??
      filteredActivities[0] ??
      activities[0] ??
      null
    );
  }, [activities, filteredActivities, selectedActivityId]);

  const matchedCandidateForSelected = useMemo(() => {
    if (!selectedActivity) return null;
    return (
      candidates.find(
        (c) =>
          c.candidate_id === selectedActivity.candidate_id ||
          c.option_symbol === selectedActivity.option_symbol
      ) ?? null
    );
  }, [candidates, selectedActivity]);

  const handleDeepQueryClick = async () => {
    if (!selectedActivity || isQueryingDeep) return;
    setIsQueryingDeep(true);
    setStatusBanner(null);
    try {
      await onQueryDeepTelemetry(selectedActivity.activity_id);
      setStatusBanner(
        `Queried Alpaca Option/Stock Snapshots & Unusual Whales Post-Trade Flow for ${selectedActivity.option_symbol} (Inspection #${selectedActivity.post_trade_inspection.inspection_query_count + 1}).`
      );
    } finally {
      setIsQueryingDeep(false);
    }
  };

  const handleAnalyzeLlmClick = async () => {
    if (!selectedActivity || isAnalyzingLlm) return;
    setIsAnalyzingLlm(true);
    setStatusBanner(null);
    try {
      await onAnalyzeWithLlm(selectedActivity.activity_id, true);
      setStatusBanner(
        `Completed LLM Post-Mortem Grading (${selectedActivity.grade_report.grade}) & updated Self-Learning Rule for ${selectedActivity.option_symbol}.`
      );
    } finally {
      setIsAnalyzingLlm(false);
    }
  };

  const handleRunBatchClick = async () => {
    if (isRunningBatch) return;
    setIsRunningBatch(true);
    setStatusBanner(null);
    try {
      await onRunBatchBacktest();
      setStatusBanner(
        `Batch Bake-Test completed across pipeline activities — grades, root causes, and condition-matched AI rules synchronized.`
      );
    } finally {
      setIsRunningBatch(false);
    }
  };

  const handleReEvaluateInGateClick = async () => {
    if (
      !selectedActivity ||
      !onReEvaluateCandidateWithLearnedRules ||
      isReEvaluatingGate
    ) {
      return;
    }
    setIsReEvaluatingGate(true);
    setStatusBanner(null);
    try {
      await onReEvaluateCandidateWithLearnedRules(
        selectedActivity.candidate_id,
        selectedActivity.ticker
      );
      setStatusBanner(
        `Re-evaluated ${selectedActivity.option_symbol} through Stage-1 & Stage-2 AI Decision Gate with active Self-Learning Memory Rules injected.`
      );
    } finally {
      setIsReEvaluatingGate(false);
    }
  };

  const handleCreateCustomRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleTitle.trim()) {
      setRuleFormError('Rule title is required.');
      return;
    }
    if (!newRuleInstruction.trim()) {
      setRuleFormError('AI prompt injection instruction is required.');
      return;
    }
    setRuleFormError(null);
    const condSummary = `Direction = ${newRuleDirection.toUpperCase()} · VWAP = ${newRuleVwap} · Gamma = ${newRuleGamma}`;
    await onUpsertRule({
      title: newRuleTitle.trim(),
      directive_type: newRuleDirective,
      confidence_delta_pct: newRuleConfidenceDelta,
      recommended_decision_override: newRuleOverrideDecision,
      condition_summary_human: condSummary,
      prompt_injection_instruction: newRuleInstruction.trim(),
      direction: newRuleDirection,
      vwap_relationship: newRuleVwap,
      dealer_gamma_regime: newRuleGamma,
    });
    setNewRuleTitle('');
    setNewRuleInstruction('');
    setShowAddRuleForm(false);
    setStatusBanner(
      `Added new Self-Learning Condition Rule "${newRuleTitle.trim()}" to active AI Gate prompt injection bank.`
    );
  };

  const renderGradeColor = (grade: string) => {
    if (grade === 'A+' || grade === 'A') return 'text-emerald-400';
    if (grade === 'B') return 'text-sky-400';
    if (grade === 'C') return 'text-amber-400';
    return 'text-rose-400';
  };

  const renderOutcomeColor = (outcome: BacktestOutcomeClassification) => {
    switch (outcome) {
      case 'TRUE_POSITIVE_WIN':
        return 'text-emerald-400';
      case 'TRUE_NEGATIVE_DODGED_BULLET':
        return 'text-sky-400';
      case 'FALSE_NEGATIVE_MISSED_ALPHA':
        return 'text-amber-400';
      case 'FALSE_POSITIVE_LOSS':
        return 'text-rose-400';
      default:
        return 'text-slate-300';
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header & Primary Actions */}
      <section
        aria-label="Bake-Testing and Self-Learning Engine Header"
        className="bg-slate-900/90 border border-slate-800 rounded-xl p-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-sky-400 font-medium tracking-wide uppercase">
              <Award className="w-4 h-4" />
              <span>
                Closed-Loop Pipeline Retrospective · Alpaca API + Unusual Whales
                API + LLM Root-Cause Analyst
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-100 mt-1">
              5. Bake-Testing &amp; Self-Learning Attribution Lab
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-4xl">
              Collects every activity from Flow Discovery through AI Decision
              Gate to Smart Order Execution or Dropped/Skipped Analysis. Queries
              post-decision multi-horizon option &amp; stock telemetry from
              Alpaca and Unusual Whales, grades each decision (A+ to F),
              identifies winning patterns vs. failure root causes, and
              automatically injects condition-matched rules into future AI Gate
              processing to increase win rate over time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleRunBatchClick}
              disabled={isRunningBatch}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Cpu className={`w-3.5 h-3.5 ${isRunningBatch ? 'animate-spin' : ''}`} />
              <span>
                {isRunningBatch
                  ? 'Running Batch LLM Bake-Test...'
                  : 'Run Full Pipeline Bake-Test & LLM Grading'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void onRefreshState()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync Pipeline Telemetry</span>
            </button>
          </div>
        </div>

        {statusBanner && (
          <div
            role="status"
            className="mt-3 px-3.5 py-2 rounded-lg bg-sky-950/60 border border-sky-800/70 text-xs text-sky-200 flex items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
              <span>{statusBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1.5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Top 5 KPI Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
          <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 font-medium">
              Pipeline Activities Collected
            </div>
            <div className="text-2xl font-bold text-slate-100 tabular-nums mt-1">
              {summary.total_activities_collected}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              <span>{summary.executed_orders_count} Executed</span>
              <span className="mx-1.5">·</span>
              <span>{summary.dropped_or_skipped_count} Dropped</span>
              <span className="mx-1.5">·</span>
              <span>{summary.watchlist_count} Watch</span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 font-medium">
              Executed Order Win Rate
            </div>
            <div className="text-2xl font-bold text-emerald-400 tabular-nums mt-1">
              {fmtNum(summary.executed_win_rate_pct, 1)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              <span className="text-emerald-400">
                {summary.executed_win_count} Won
              </span>
              <span className="mx-1.5">·</span>
              <span className="text-rose-400">
                {summary.executed_loss_count} Lost (Root-Caused)
              </span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 font-medium">
              Dropped / Skipped Accuracy
            </div>
            <div className="text-2xl font-bold text-sky-400 tabular-nums mt-1">
              {fmtNum(summary.dropped_decision_accuracy_pct, 1)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              <span className="text-sky-400">
                {summary.dodged_bullets_count} Dodged Drawdowns
              </span>
              <span className="mx-1.5">·</span>
              <span className="text-amber-400">
                {summary.missed_alpha_count} Missed Alpha
              </span>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 font-medium">
              Active Self-Learning AI Rules
            </div>
            <div className="text-2xl font-bold text-indigo-400 tabular-nums mt-1">
              {summary.active_learned_rules_count}{' '}
              <span className="text-xs font-normal text-slate-400">
                / {learnedRules.length} rules
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              Injected {summary.total_prompt_injections_count}x into AI Decision
              Gate
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400 font-medium">
              Self-Learning Win-Rate Lift
            </div>
            <div className="text-2xl font-bold text-emerald-400 tabular-nums mt-1">
              +{fmtNum(summary.estimated_system_win_rate_lift_pct, 1)}%
            </div>
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              Baseline {fmtNum(summary.baseline_win_rate_pct, 1)}% →{' '}
              <span className="text-emerald-300 font-semibold">
                {fmtNum(summary.projected_learned_win_rate_pct, 1)}%
              </span>{' '}
              Learned
            </div>
          </div>
        </div>
      </section>

      {/* Filter & Search Bar */}
      <section
        aria-label="Pipeline Activity Filters"
        className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `All Activities (${activities.length})` },
              {
                id: 'executed',
                label: `Executed Orders (${summary.executed_orders_count})`,
              },
              {
                id: 'dropped_skipped',
                label: `Dropped / Skipped (${summary.dropped_or_skipped_count})`,
              },
              {
                id: 'watchlist',
                label: `Watchlist (${summary.watchlist_count})`,
              },
              {
                id: 'hard_rejected',
                label: 'Pre-Gate Hard Rejects',
              },
            ] as { id: DispositionFilter; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDispositionFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                dispositionFilter === tab.id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Outcome:</span>
            <select
              aria-label="Filter by Outcome Classification"
              value={outcomeFilter}
              onChange={(e) =>
                setOutcomeFilter(e.target.value as OutcomeFilter)
              }
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Outcome Classifications</option>
              <option value="TRUE_POSITIVE_WIN">
                Executed Winner (True Positive)
              </option>
              <option value="FALSE_POSITIVE_LOSS">
                Executed Loss (Root-Cause Failure)
              </option>
              <option value="TRUE_NEGATIVE_DODGED_BULLET">
                Dodged Drawdown (Correct Drop)
              </option>
              <option value="FALSE_NEGATIVE_MISSED_ALPHA">
                Missed Alpha (Tune Filter)
              </option>
            </select>
          </label>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search pipeline activity by ticker or contract"
              placeholder="Filter ticker or root cause..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 w-52"
            />
          </div>
        </div>
      </section>

      {/* Main Two-Column Workbench: Left = Pipeline Activity Ledger, Right = Deep Activity Inspector & LLM Analyst */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left Column: Pipeline Activity Table (7 cols) */}
        <section
          aria-label="Pipeline Activity Ledger"
          className="xl:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Pipeline Activity &amp; Decision Ledger (Flow Discovery → Order
                / Dropped)
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Click any activity row to inspect full 4-stage telemetry, Alpaca
                + UW post-trade price curve, and LLM root-cause grading.
              </p>
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              Showing {filteredActivities.length} of {activities.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-slate-950/60">
                  <th className="py-2.5 px-3 font-medium">Contract</th>
                  <th className="py-2.5 px-3 font-medium">
                    Pipeline Path (Scan → Gate → Terminal)
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    Decision → Latest Mark
                  </th>
                  <th className="py-2.5 px-3 font-medium text-right">
                    MFE / MAE
                  </th>
                  <th className="py-2.5 px-3 font-medium">
                    Grade &amp; Root-Cause Attribution
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredActivities.map((act) => {
                  const isSelected =
                    selectedActivity?.activity_id === act.activity_id;
                  const ret =
                    act.post_trade_inspection.realized_or_mark_return_pct;
                  const mfe =
                    act.post_trade_inspection.max_favorable_excursion_pct;
                  const mae =
                    act.post_trade_inspection.max_adverse_excursion_pct;

                  return (
                    <tr
                      key={act.activity_id}
                      onClick={() => setSelectedActivityId(act.activity_id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-sky-950/40 hover:bg-sky-950/50'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-3 align-top">
                        <div className="font-bold text-slate-100 flex items-center gap-1.5">
                          <span>{act.ticker}</span>
                          <span
                            className={`text-[11px] font-medium ${
                              act.direction === 'bullish'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {act.strike}
                            {act.option_type === 'call' ? 'C' : 'P'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {act.option_symbol}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                          DTE {act.dte}d · $
                          {fmtNum(
                            (act.discovery_stage.premium_5m_dollars ?? 0) / 1000,
                            0
                          )}
                          K 5m
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-200">
                          <span>
                            Score {act.discovery_stage.whale_score}
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                          <span
                            className={
                              act.ai_gate_stage.stage1_decision === 'EXECUTE'
                                ? 'text-emerald-400 font-semibold'
                                : act.ai_gate_stage.stage1_decision === 'WATCH'
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                            }
                          >
                            {act.ai_gate_stage.stage1_decision}
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                          <span className="text-slate-300">
                            {act.execution_or_drop_stage.order_placed
                              ? `Filled ${act.execution_or_drop_stage.filled_qty}x`
                              : act.execution_or_drop_stage.dropped_stage.replace(
                                  /_/g,
                                  ' '
                                )}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          <span>{act.discovery_stage.vwap_relationship}</span>
                          <span className="mx-1">·</span>
                          <span>
                            Vol/OI {fmtNum(act.discovery_stage.volume_oi_ratio, 2)}x
                          </span>
                          {act.ai_gate_stage.applied_learned_rule_ids.length >
                            0 && (
                            <>
                              <span className="mx-1">·</span>
                              <span className="text-indigo-400">
                                {
                                  act.ai_gate_stage.applied_learned_rule_ids
                                    .length
                                }{' '}
                                Learned Rule(s)
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top text-right tabular-nums">
                        <div className="text-slate-200 font-medium">
                          $
                          {fmtNum(
                            act.post_trade_inspection.decision_option_mark,
                            2
                          )}{' '}
                          → $
                          {fmtNum(
                            act.post_trade_inspection.latest_option_mark,
                            2
                          )}
                        </div>
                        <div
                          className={`text-[11px] font-semibold mt-0.5 ${
                            (ret ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {(ret ?? 0) >= 0 ? '+' : ''}
                          {fmtNum(ret, 1)}% (
                          {act.execution_or_drop_stage.order_placed
                            ? `${(act.post_trade_inspection.realized_or_mark_pnl_dollars ?? 0) >= 0 ? '+' : ''}$${fmtInt(act.post_trade_inspection.realized_or_mark_pnl_dollars)}`
                            : `CF ${(act.post_trade_inspection.counterfactual_10ct_pnl_dollars ?? 0) >= 0 ? '+' : ''}$${fmtInt(act.post_trade_inspection.counterfactual_10ct_pnl_dollars)}`}
                          )
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top text-right tabular-nums">
                        <div className="text-[11px] text-emerald-400">
                          Peak +{fmtNum(mfe, 1)}% ($
                          {fmtNum(
                            act.post_trade_inspection.session_option_high_mfe,
                            2
                          )}
                          )
                        </div>
                        <div className="text-[11px] text-rose-400 mt-0.5">
                          Low {fmtNum(mae, 1)}% ($
                          {fmtNum(
                            act.post_trade_inspection.session_option_low_mae,
                            2
                          )}
                          )
                        </div>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-extrabold tabular-nums ${renderGradeColor(
                              act.grade_report.grade
                            )}`}
                          >
                            {act.grade_report.grade}
                          </span>
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            ({act.grade_report.score_0_100}/100)
                          </span>
                          <span
                            className={`text-[11px] font-medium ${renderOutcomeColor(
                              act.grade_report.outcome_classification
                            )}`}
                          >
                            {act.grade_report.outcome_label}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                          {act.grade_report.root_cause_title}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right Column: Deep Activity Inspector & LLM Post-Mortem Workbench (5 cols) */}
        <section
          aria-label="Selected Activity Deep Inspector and LLM Root-Cause Analyst"
          className="xl:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4"
        >
          {selectedActivity ? (
            <>
              {/* Inspector Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-100">
                      {selectedActivity.ticker}{' '}
                      <span className="font-mono text-sm text-sky-400">
                        {selectedActivity.option_symbol}
                      </span>
                    </span>
                    <span
                      className={`text-sm font-extrabold ${renderGradeColor(
                        selectedActivity.grade_report.grade
                      )}`}
                    >
                      Grade {selectedActivity.grade_report.grade} (
                      {selectedActivity.grade_report.score_0_100}/100)
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    <span>{selectedActivity.grade_report.outcome_label}</span>
                    <span className="mx-1.5">·</span>
                    <span>
                      Evaluated via{' '}
                      {selectedActivity.grade_report.evaluated_by === 'llm_live'
                        ? 'LLM Post-Mortem Analyst'
                        : 'Deterministic Attribution Engine'}
                    </span>
                  </div>
                </div>

                {matchedCandidateForSelected && onInspectCandidateChart && (
                  <button
                    type="button"
                    onClick={() =>
                      onInspectCandidateChart(matchedCandidateForSelected)
                    }
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer shrink-0"
                  >
                    Open Event Chart
                  </button>
                )}
              </div>

              {/* Action Buttons for Deep Query + LLM Root-Cause + Re-Evaluate Gate */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeepQueryClick}
                  disabled={isQueryingDeep}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-800/70 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Database
                    className={`w-3.5 h-3.5 ${isQueryingDeep ? 'animate-pulse' : ''}`}
                  />
                  <span>
                    {isQueryingDeep
                      ? 'Querying Alpaca + UW...'
                      : 'Query Deeper Alpaca + UW Post-Trade Data'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleAnalyzeLlmClick}
                  disabled={isAnalyzingLlm}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Cpu
                    className={`w-3.5 h-3.5 ${isAnalyzingLlm ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isAnalyzingLlm
                      ? 'Running LLM Analysis...'
                      : 'Run LLM Root-Cause & Extract Rule'}
                  </span>
                </button>

                {onReEvaluateCandidateWithLearnedRules && (
                  <button
                    type="button"
                    onClick={handleReEvaluateInGateClick}
                    disabled={isReEvaluatingGate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-950/70 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/70 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>
                      {isReEvaluatingGate
                        ? 'Injecting into AI Gate...'
                        : 'Re-Test in AI Gate With Learned Rules'}
                    </span>
                  </button>
                )}
              </div>

              {/* 4-Stage Pipeline Trace Summary */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 space-y-2.5 text-xs">
                <div className="font-semibold text-slate-200 flex items-center justify-between">
                  <span>Full End-to-End Pipeline Activity Trace</span>
                  <span className="text-[11px] text-slate-400 font-normal tabular-nums">
                    Inspections Run:{' '}
                    {
                      selectedActivity.post_trade_inspection
                        .inspection_query_count
                    }
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="bg-slate-900/80 border border-slate-800/80 rounded p-2.5">
                    <div className="text-[11px] font-semibold text-sky-400">
                      1. Flow Discovery (UW + Alpaca)
                    </div>
                    <div className="text-slate-300 mt-1 space-y-0.5 tabular-nums">
                      <div>
                        WhaleScore {selectedActivity.discovery_stage.whale_score}{' '}
                        · FlowScore {selectedActivity.discovery_stage.flow_score}
                      </div>
                      <div>
                        Ask-Side{' '}
                        {fmtNum(selectedActivity.discovery_stage.ask_side_pct, 0)}
                        % · Vol/OI{' '}
                        {fmtNum(
                          selectedActivity.discovery_stage.volume_oi_ratio,
                          2
                        )}
                        x
                      </div>
                      <div>
                        Gamma:{' '}
                        {selectedActivity.discovery_stage.dealer_gamma_regime} ·
                        Call Wall $
                        {fmtNum(selectedActivity.discovery_stage.call_wall, 2)}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900/80 border border-slate-800/80 rounded p-2.5">
                    <div className="text-[11px] font-semibold text-indigo-400">
                      2. AI Decision &amp; Risk Gate
                    </div>
                    <div className="text-slate-300 mt-1 space-y-0.5 tabular-nums">
                      <div>
                        Stage-1:{' '}
                        <span className="font-semibold text-slate-100">
                          {selectedActivity.ai_gate_stage.stage1_decision}
                        </span>{' '}
                        ({selectedActivity.ai_gate_stage.stage1_confidence_pct}%
                        conf)
                      </div>
                      <div>
                        Stage-2 Risk:{' '}
                        {selectedActivity.ai_gate_stage.stage2_risk_action} (
                        {selectedActivity.ai_gate_stage.stage2_approved_qty}x
                        contracts)
                      </div>
                      <div>
                        Entry $
                        {fmtNum(
                          selectedActivity.ai_gate_stage.planned_entry_limit,
                          2
                        )}{' '}
                        · Stop $
                        {fmtNum(
                          selectedActivity.ai_gate_stage.planned_stop_price,
                          2
                        )}{' '}
                        · T1 $
                        {fmtNum(
                          selectedActivity.ai_gate_stage.planned_target1_price,
                          2
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900/80 border border-slate-800/80 rounded p-2.5">
                  <div className="text-[11px] font-semibold text-emerald-400">
                    3. Order Placement OR Dropped / Skipped Analysis
                  </div>
                  {selectedActivity.execution_or_drop_stage.order_placed ? (
                    <div className="text-slate-300 mt-1 tabular-nums">
                      Order{' '}
                      <span className="font-mono text-slate-100">
                        {selectedActivity.execution_or_drop_stage.order_id}
                      </span>{' '}
                      placed via{' '}
                      <span className="text-sky-300">
                        {selectedActivity.execution_or_drop_stage.smart_algo}
                      </span>{' '}
                      · Filled{' '}
                      {selectedActivity.execution_or_drop_stage.filled_qty}x @ $
                      {fmtNum(
                        selectedActivity.execution_or_drop_stage
                          .avg_fill_price ??
                          selectedActivity.post_trade_inspection
                            .decision_option_mark,
                        2
                      )}{' '}
                      (Saved $
                      {fmtNum(
                        selectedActivity.execution_or_drop_stage
                          .slippage_saved_dollars,
                        0
                      )}{' '}
                      slippage)
                    </div>
                  ) : (
                    <div className="text-slate-300 mt-1">
                      <div>
                        Dropped at:{' '}
                        <span className="text-amber-300 font-medium">
                          {selectedActivity.execution_or_drop_stage.dropped_stage.replace(
                            /_/g,
                            ' '
                          )}
                        </span>
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        Reason:{' '}
                        {selectedActivity.execution_or_drop_stage
                          .dropped_reasons[0] ?? 'Filtered by gate'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Multi-Horizon Alpaca + UW Post-Decision Curve */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">
                    4. Post-Decision Multi-Horizon Telemetry (Alpaca Snapshots +
                    UW Flow)
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    {
                      selectedActivity.post_trade_inspection
                        .post_decision_uw_flow_continuation
                    }
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px] tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-1.5 pr-2 font-medium">Horizon</th>
                        <th className="py-1.5 px-2 font-medium text-right">
                          Option Mark (Bid×Ask)
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right">
                          Option %
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right">
                          Spot / VWAP
                        </th>
                        <th className="py-1.5 pl-2 font-medium text-right">
                          UW Flow Δ
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selectedActivity.post_trade_inspection.horizon_curve.map(
                        (pt) => (
                          <tr key={pt.horizon_label}>
                            <td className="py-1.5 pr-2 font-medium text-slate-200">
                              {pt.horizon_label}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-200">
                              ${fmtNum(pt.option_mark_price, 2)}{' '}
                              <span className="text-slate-500">
                                ({fmtNum(pt.option_bid, 2)}×
                                {fmtNum(pt.option_ask, 2)})
                              </span>
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right font-semibold ${
                                (pt.option_return_pct ?? 0) >= 0
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {(pt.option_return_pct ?? 0) >= 0 ? '+' : ''}
                              {fmtNum(pt.option_return_pct, 1)}%
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300">
                              ${fmtNum(pt.underlying_spot_price, 2)} / $
                              {fmtNum(pt.underlying_vwap, 2)}
                            </td>
                            <td
                              className={`py-1.5 pl-2 text-right ${
                                (pt.uw_net_flow_delta_dollars ?? 0) >= 0
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {(pt.uw_net_flow_delta_dollars ?? 0) >= 0
                                ? '+'
                                : ''}
                              $
                              {fmtNum(
                                (pt.uw_net_flow_delta_dollars ?? 0) / 1000,
                                0
                              )}
                              K
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* LLM Grading, Root-Cause Diagnosis & Self-Learning Output */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-100">
                    Decision Grade &amp; Root-Cause Diagnosis
                  </div>
                  <span
                    className={`font-bold ${renderOutcomeColor(
                      selectedActivity.grade_report.outcome_classification
                    )}`}
                  >
                    {selectedActivity.grade_report.was_decision_correct
                      ? 'Decision Validated'
                      : 'Improvement Needed'}
                  </span>
                </div>

                <div className="text-slate-300 leading-relaxed">
                  <span className="text-slate-400 font-medium">
                    Root Cause ({selectedActivity.grade_report.root_cause_code}
                    ):{' '}
                  </span>
                  {selectedActivity.grade_report.root_cause_explanation}
                </div>

                {selectedActivity.grade_report.winning_factors.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-emerald-400">
                      Winning / Validated Factors:
                    </div>
                    <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                      {selectedActivity.grade_report.winning_factors.map(
                        (f, i) => (
                          <li key={i}>{f}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}

                {selectedActivity.grade_report.failure_or_miss_factors.length >
                  0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-rose-400">
                      Failure / Missed-Alpha Factors:
                    </div>
                    <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                      {selectedActivity.grade_report.failure_or_miss_factors.map(
                        (f, i) => (
                          <li key={i}>{f}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-semibold text-indigo-400">
                    Self-Learning Actionable Injection for Future AI Runs:
                  </div>
                  <div className="text-slate-200 mt-0.5 font-mono text-[11px] bg-slate-900 p-2 rounded border border-slate-800">
                    {selectedActivity.grade_report.improvement_recommendation}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400 py-8 text-center">
              Select a pipeline activity from the ledger to inspect its
              lifecycle and run LLM root-cause grading.
            </div>
          )}
        </section>
      </div>

      {/* Bottom Section: Active Self-Learning Knowledge Base (Injected into Future AI Processing) */}
      <section
        aria-label="Self-Learning Condition Rule Knowledge Base"
        className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-indigo-400 font-medium uppercase tracking-wide">
              <BookOpen className="w-4 h-4" />
              <span>
                Active Self-Learning Memory Bank · Injected Into Stage-1 &amp;
                Stage-2 AI Decision Gate
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-100 mt-0.5">
              Condition-Matched Rules Learned From Pipeline Bake-Testing (
              {learnedRules.filter((r) => r.active).length} Active)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Whenever a new candidate enters the AI Decision Gate with matching
              direction, Alpaca VWAP relationship, dealer gamma positioning, and
              Vol/OI profile, these learned instructions are automatically
              injected into the LLM prompt and confidence score.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAddRuleForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer shrink-0"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>
              {showAddRuleForm
                ? 'Close Custom Rule Form'
                : 'Add Custom Self-Learning Rule'}
            </span>
          </button>
        </div>

        {showAddRuleForm && (
          <form
            onSubmit={handleCreateCustomRuleSubmit}
            className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
          >
            <div className="font-semibold text-slate-200">
              Create Condition-Matched Self-Learning Rule for Future AI
              Processing
            </div>
            {ruleFormError && (
              <div className="text-rose-400 font-medium">{ruleFormError}</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-400">Rule Title</span>
                <input
                  type="text"
                  value={newRuleTitle}
                  onChange={(e) => setNewRuleTitle(e.target.value)}
                  placeholder="e.g., High Vol/OI Negative Gamma Breakout Boost"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-slate-400">AI Directive Type</span>
                <select
                  value={newRuleDirective}
                  onChange={(e) =>
                    setNewRuleDirective(e.target.value as LearnedDirectiveType)
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200"
                >
                  <option value="BOOST_CONFIDENCE">
                    BOOST_CONFIDENCE (Winning Pattern)
                  </option>
                  <option value="DOWNGRADE_TO_WATCH">
                    DOWNGRADE_TO_WATCH (Failure Guardrail)
                  </option>
                  <option value="HARD_SKIP_GUARD">
                    HARD_SKIP_GUARD (Validated Reject)
                  </option>
                  <option value="RELAX_WATCH_TO_EXECUTE">
                    RELAX_WATCH_TO_EXECUTE (Missed-Alpha Recovery)
                  </option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-400">
                  Confidence Delta (%) &amp; Override
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={-25}
                    max={20}
                    value={newRuleConfidenceDelta}
                    onChange={(e) =>
                      setNewRuleConfidenceDelta(Number(e.target.value))
                    }
                    className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 tabular-nums"
                  />
                  <select
                    value={newRuleOverrideDecision}
                    onChange={(e) =>
                      setNewRuleOverrideDecision(
                        e.target.value as LlmTradeGateDecision
                      )
                    }
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="EXECUTE">EXECUTE</option>
                    <option value="WATCH">WATCH</option>
                    <option value="SKIP">SKIP</option>
                  </select>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-400">Match Direction</span>
                <select
                  value={newRuleDirection}
                  onChange={(e) =>
                    setNewRuleDirection(
                      e.target.value as 'bullish' | 'bearish' | 'any'
                    )
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200"
                >
                  <option value="bullish">Bullish</option>
                  <option value="bearish">Bearish</option>
                  <option value="any">Any Direction</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-400">
                  Match Alpaca VWAP Relationship
                </span>
                <select
                  value={newRuleVwap}
                  onChange={(e) =>
                    setNewRuleVwap(e.target.value as typeof newRuleVwap)
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200"
                >
                  <option value="HOLDING_ABOVE_VWAP">HOLDING_ABOVE_VWAP</option>
                  <option value="HOLDING_BELOW_VWAP">HOLDING_BELOW_VWAP</option>
                  <option value="RECLAIMING_VWAP">RECLAIMING_VWAP</option>
                  <option value="LOST_VWAP_CONTRADICTION">
                    LOST_VWAP_CONTRADICTION
                  </option>
                  <option value="any">Any VWAP State</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-slate-400">
                  Match Dealer Gamma Regime
                </span>
                <select
                  value={newRuleGamma}
                  onChange={(e) =>
                    setNewRuleGamma(e.target.value as typeof newRuleGamma)
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200"
                >
                  <option value="negative_acceleration">
                    negative_acceleration
                  </option>
                  <option value="positive_pinning">positive_pinning</option>
                  <option value="neutral_transition">neutral_transition</option>
                  <option value="any">Any Gamma Regime</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-slate-400">
                Prompt Injection Instruction (Injected into Stage-1 &amp;
                Stage-2 AI Prompts)
              </span>
              <input
                type="text"
                value={newRuleInstruction}
                onChange={(e) => setNewRuleInstruction(e.target.value)}
                placeholder="e.g., LEARNED RULE: When bullish sweeps hold above Alpaca VWAP in negative gamma acceleration, boost confidence +8% and prioritize EXECUTE."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddRuleForm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
              >
                Save &amp; Activate Rule
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {learnedRules.map((rule) => {
            const matchingLiveActivities = activities.filter((a) =>
              a.ai_gate_stage.applied_learned_rule_ids.includes(rule.rule_id)
            );

            return (
              <div
                key={rule.rule_id}
                className={`rounded-xl border p-4 space-y-2.5 transition-colors ${
                  rule.active
                    ? 'bg-slate-950/90 border-slate-800'
                    : 'bg-slate-950/40 border-slate-800/50 opacity-65'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-medium">
                      <span
                        className={
                          rule.confidence_delta_pct >= 0
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }
                      >
                        {rule.directive_type} (
                        {rule.confidence_delta_pct >= 0 ? '+' : ''}
                        {rule.confidence_delta_pct}% Conf)
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400 tabular-nums">
                        Hist Accuracy {fmtNum(rule.historical_win_rate_pct, 1)}%
                        (n={rule.sample_size_trades})
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-indigo-400 tabular-nums">
                        Injected {rule.times_injected_into_ai}x
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-100 mt-0.5">
                      {rule.title}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => void onToggleRule(rule.rule_id, !rule.active)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer shrink-0 ${
                      rule.active
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/70 hover:bg-emerald-900/80'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {rule.active ? 'Active in AI Gate' : 'Paused'}
                  </button>
                </div>

                <div className="text-[11px] text-sky-300/90 font-mono bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800/80">
                  IF: {rule.condition_summary_human}
                </div>

                <div className="text-xs text-slate-300 font-mono bg-slate-900/60 p-2.5 rounded border border-slate-800/60 leading-relaxed">
                  {rule.prompt_injection_instruction}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                  <div>
                    Source Tickers: {rule.source_tickers.join(', ')} · Est.
                    Win-Rate Lift: +
                    {fmtNum(rule.estimated_win_rate_lift_pct, 1)}%
                  </div>
                  <div>
                    Currently Matching Pipeline Contracts:{' '}
                    <span className="text-slate-200 font-semibold">
                      {matchingLiveActivities.length > 0
                        ? matchingLiveActivities
                            .map((m) => m.ticker)
                            .join(', ')
                        : 'Standing by for match'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
