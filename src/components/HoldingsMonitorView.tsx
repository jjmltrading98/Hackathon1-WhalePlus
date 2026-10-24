import React, { useState, useEffect, useCallback } from 'react';
import type {
  HoldingMonitorMode,
  ImmutableAuditLogEntry,
  LlmStage1HoldingDecision,
  LlmStage2ExitExecutionPlan,
  MonitoredHolding,
  Stage1HoldingAction,
  TradingEnvironmentMode,
} from '../engine/holdingsMonitorEngine';
import type { AlpacaRecentOrder } from '../engine/alpacaAccountService';
import {
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  Play,
  FileText,
  Activity,
  Sliders,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
} from 'lucide-react';

interface HoldingsMonitorStatePayload {
  environment: TradingEnvironmentMode;
  live_mfa_verified: boolean;
  holdings: MonitoredHolding[];
  stage1_decisions: LlmStage1HoldingDecision[];
  stage2_plans: LlmStage2ExitExecutionPlan[];
  approval_queue: LlmStage2ExitExecutionPlan[];
  open_orders: AlpacaRecentOrder[];
  audit_logs: ImmutableAuditLogEntry[];
}

interface HoldingsMonitorViewProps {
  initialState?: HoldingsMonitorStatePayload;
  onSelectTickerInScanner?: (ticker: string) => void;
  onOpenSettings?: () => void;
}

type WorkbenchTab =
  | 'stage1_and_stage2_plan'
  | 'short_and_darkpool_matrix'
  | 'uw_flow_and_alpaca_bars'
  | 'approval_queue_and_orders'
  | 'immutable_audit_log';

function formatUsd(val: number | null | undefined, showSign = false): string {
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 0;
  const abs = Math.abs(safe).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (safe < -0.001) return `-$${abs}`;
  if (showSign && safe > 0.001) return `+$${abs}`;
  return `$${abs}`;
}

function formatCompactUsd(val: number | null | undefined, showSign = false): string {
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 0;
  const abs = Math.abs(safe);
  let text = '';
  if (abs >= 1_000_000) {
    text = `${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1_000) {
    text = `${(abs / 1_000).toFixed(0)}k`;
  } else {
    text = abs.toFixed(0);
  }
  if (safe < -0.001) return `-$${text}`;
  if (showSign && safe > 0.001) return `+$${text}`;
  return `$${text}`;
}

export const HoldingsMonitorView: React.FC<HoldingsMonitorViewProps> = ({
  initialState,
  onSelectTickerInScanner,
  onOpenSettings,
}) => {
  const [state, setState] = useState<HoldingsMonitorStatePayload | null>(
    initialState ?? null
  );
  const [loading, setLoading] = useState<boolean>(!initialState);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const [selectedHoldingId, setSelectedHoldingId] = useState<string>(
    initialState?.holdings[0]?.holding_id ?? 'hold-nvda-145c'
  );
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(
    'stage1_and_stage2_plan'
  );
  const [assetFilter, setAssetFilter] = useState<'ALL' | 'option' | 'stock'>(
    'ALL'
  );
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | Stage1HoldingAction>(
    'ALL'
  );
  const [simulateScenario, setSimulateScenario] = useState<
    | 'default'
    | 'stop_loss_breach'
    | 'adverse_whale_flow'
    | 'dte_theta_cliff'
    | 'profit_scale_out'
    | 'stale_or_wide_spread'
    | 'long_squeeze_hold_guard'
    | 'short_squeeze_cluster'
    | 'multi_category_weakness_exit'
  >('default');

  // Live Trading MFA Gate Controls
  const [showMfaPrompt, setShowMfaPrompt] = useState<boolean>(false);
  const [mfaCodeInput, setMfaCodeInput] = useState<string>('849204');
  const [operatorName, setOperatorName] = useState<string>(
    'Senior Portfolio Risk Officer'
  );
  const [limitOverrideInput, setLimitOverrideInput] = useState<string>('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [showRawEvidenceJson, setShowRawEvidenceJson] = useState<boolean>(false);

  const fetchHoldingsState = useCallback(
    async (forceRefresh = false) => {
      try {
        const url = forceRefresh
          ? '/api/holdings-monitor?refresh=true'
          : '/api/holdings-monitor';
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as HoldingsMonitorStatePayload;
        setState(data);
        if (
          data.holdings.length > 0 &&
          !data.holdings.some((h) => h.holding_id === selectedHoldingId)
        ) {
          const preferred =
            data.holdings.find((h) => h.latest_stage2_plan !== null) ??
            data.holdings[0];
          setSelectedHoldingId(preferred.holding_id);
        }
      } catch {
        // keep existing state
      } finally {
        setLoading(false);
      }
    },
    [selectedHoldingId]
  );

  useEffect(() => {
    void fetchHoldingsState(false);
  }, [fetchHoldingsState]);

  const holdings = state?.holdings ?? [];
  const filteredHoldings = holdings.filter((h) => {
    if (assetFilter !== 'ALL' && h.asset_class !== assetFilter) return false;
    if (
      decisionFilter !== 'ALL' &&
      h.latest_stage1_decision?.decision !== decisionFilter
    ) {
      return false;
    }
    return true;
  });

  const selectedHolding =
    holdings.find((h) => h.holding_id === selectedHoldingId) ??
    filteredHoldings[0] ??
    holdings[0] ??
    null;

  const handleEvaluateHolding = async (
    holdingId: string,
    overrideDecision?: Stage1HoldingAction,
    scenarioOverride?: typeof simulateScenario
  ) => {
    setBusyAction(`eval-${holdingId}`);
    setStatusBanner(null);
    try {
      const res = await fetch('/api/holdings-monitor/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holding_id: holdingId,
          override_decision: overrideDecision,
          simulate_scenario: scenarioOverride ?? simulateScenario,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: 'error',
          text: data.error || 'Failed to evaluate holding.',
        });
        return;
      }
      if (data.state) {
        setState(data.state);
      }
      const stg1: LlmStage1HoldingDecision | undefined = data.stage1_decision;
      const stg2: LlmStage2ExitExecutionPlan | undefined = data.stage2_plan;
      setStatusBanner({
        type: 'success',
        text: stg2
          ? stg2.approval_status === 'APPROVED_AND_SUBMITTED'
            ? `Stage-1 LLM chose ${stg1?.decision} → Stage-2 Execution Plan (${stg2.order_side.toUpperCase()} ${stg2.quantity_to_trade}x ${stg2.target_symbol} @ $${stg2.limit_price_logic.computed_initial_limit_price.toFixed(2)} limit) automatically validated & submitted to Alpaca (${stg2.submitted_order_id ?? 'AUTO'}).`
            : `Stage-1 LLM chose ${stg1?.decision} → Stage-2 Execution Plan (${stg2.order_side.toUpperCase()} ${stg2.quantity_to_trade}x ${stg2.target_symbol} @ $${stg2.limit_price_logic.computed_initial_limit_price.toFixed(2)} limit) generated (${stg2.approval_status}).`
          : `Stage-1 LLM evaluated ${stg1?.symbol ?? holdingId} → ${stg1?.decision} (${stg1?.primary_risk_driver}).`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateMonitorMode = async (
    holdingId: string,
    mode: HoldingMonitorMode
  ) => {
    setBusyAction(`mode-${holdingId}`);
    try {
      const res = await fetch('/api/holdings-monitor/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holding_id: holdingId, mode }),
      });
      const data = await res.json();
      if (res.ok && data.state) {
        setState(data.state);
        setStatusBanner({
          type: 'success',
          text: `Updated holding monitor mode to ${mode} (Advisory LLM never submits orders directly without Risk Validator & Policy approval).`,
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleSwitchEnvironment = async (
    targetEnv: TradingEnvironmentMode,
    mfaCode?: string
  ) => {
    if (targetEnv === 'live' && !mfaCode) {
      setShowMfaPrompt(true);
      return;
    }
    setBusyAction('env-switch');
    try {
      const res = await fetch('/api/holdings-monitor/environment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: targetEnv,
          mfa_code: mfaCode,
        }),
      });
      const data = (await res.json()) as HoldingsMonitorStatePayload;
      if (res.ok) {
        setState(data);
        setShowMfaPrompt(false);
        setStatusBanner({
          type: targetEnv === 'live' ? 'warning' : 'success',
          text:
            targetEnv === 'live'
              ? `LIVE Trading Mode enabled with verified MFA session. Per-order human approval and broker buying-power checks strictly enforced.`
              : `Switched to default Alpaca PAPER Trading environment.`,
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleApproveOrRejectPlan = async (
    planId: string,
    action: 'approve' | 'reject'
  ) => {
    setBusyAction(`plan-${planId}-${action}`);
    setStatusBanner(null);
    try {
      const parsedOverride = limitOverrideInput.trim()
        ? Number.parseFloat(limitOverrideInput.trim())
        : undefined;
      const res = await fetch('/api/holdings-monitor/approve-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          action,
          operator_name: operatorName,
          mfa_code: mfaCodeInput,
          limit_price_override:
            parsedOverride && Number.isFinite(parsedOverride)
              ? parsedOverride
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusBanner({
          type: 'error',
          text: data.error || 'Order approval failed.',
        });
        return;
      }
      if (data.state) {
        setState(data.state);
      }
      setLimitOverrideInput('');
      if (action === 'approve') {
        setStatusBanner({
          type: 'success',
          text: `Approved & submitted Alpaca Limit Order ${data.submitted_order?.id ?? ''} (${data.plan?.alpaca_order_payload?.side?.toUpperCase()} ${data.plan?.alpaca_order_payload?.qty}x ${data.plan?.alpaca_order_payload?.symbol} @ $${data.plan?.alpaca_order_payload?.limit_price}). Recorded in Immutable Audit Log.`,
        });
      } else {
        setStatusBanner({
          type: 'warning',
          text: `Rejected Stage-2 Execution Plan ${planId}. No order was transmitted to Alpaca.`,
        });
      }
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Approval request failed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancelOpenOrder = async (orderId: string) => {
    setBusyAction(`cancel-${orderId}`);
    try {
      const res = await fetch(
        `/api/holdings-monitor/orders/${encodeURIComponent(orderId)}`,
        {
          method: 'DELETE',
        }
      );
      const data = await res.json();
      if (res.ok && data.state) {
        setState(data.state);
        setStatusBanner({
          type: 'warning',
          text: `Cancelled open Alpaca order ${orderId} (DELETE /v2/orders/${orderId}) and logged to Immutable Audit Trail.`,
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && !state) {
    return (
      <div className="p-6 border border-slate-800 rounded-lg bg-slate-900/50 text-slate-300 text-sm">
        Loading Real-Time Holdings Monitor, Unusual Whales Flow &amp; LLM Exit Plans...
      </div>
    );
  }

  const totalMarketValue = holdings.reduce((acc, h) => acc + h.market_value, 0);
  const totalCostBasis = holdings.reduce((acc, h) => acc + h.cost_basis, 0);
  const totalUnrealizedPl = holdings.reduce((acc, h) => acc + h.unrealized_pl, 0);
  const totalIntradayPl = holdings.reduce((acc, h) => acc + h.intraday_pl, 0);
  const activeRiskEventsCount = holdings.filter(
    (h) => h.evaluation_event_active
  ).length;
  const pendingApprovalCount = state?.approval_queue.length ?? 0;
  const openOrdersCount =
    state?.open_orders.filter((o) => o.status !== 'canceled').length ?? 0;

  const activeStage1 = selectedHolding?.latest_stage1_decision ?? null;
  const activeStage2 = selectedHolding?.latest_stage2_plan ?? null;

  return (
    <div className="space-y-6">
      {/* Section Header & Safety Environment Gate */}
      <div className="border border-slate-800 rounded-lg bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-100 tracking-tight">
              Holdings Monitor · Unusual Whales Flow, Alpaca &amp; Automated Two-Stage LLM Exit Plans
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Continuous automated monitoring of Alpaca stock and OSI-normalized option holdings, intraday VWAP &amp; bars, Unusual Whales options tape, flow alerts, and cumulative net premium ticks. Two-stage LLM exit plans are automatically evaluated and executed when deterministic risk checks pass.
            </p>
          </div>

          {/* Automated Execution Policy Indicator + Sync Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3 py-1.5 text-xs font-mono rounded border border-emerald-500/30 bg-emerald-950/30 text-emerald-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Mode: {state?.environment === 'live' ? 'LIVE' : 'PAPER'} AUTO-EXECUTION
              </span>
            </div>

            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-sky-300 flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Approval Policy in Settings</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void fetchHoldingsState(true)}
              className="px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync Holdings &amp; Quotes</span>
            </button>
          </div>
        </div>

        {/* Key Portfolio & Risk Telemetry Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-5 pt-4 border-t border-slate-800/80 font-mono tabular-nums">
          <div>
            <div className="text-[11px] font-sans text-slate-400">
              Monitored Holdings
            </div>
            <div className="text-base font-semibold text-slate-100 mt-0.5">
              {holdings.length} Positions
            </div>
            <div className="text-[11px] text-slate-400">
              {holdings.filter((h) => h.asset_class === 'option').length} Options ·{' '}
              {holdings.filter((h) => h.asset_class === 'stock').length} Stock
            </div>
          </div>

          <div>
            <div className="text-[11px] font-sans text-slate-400">
              Holdings Market Value
            </div>
            <div className="text-base font-semibold text-slate-100 mt-0.5">
              {formatUsd(totalMarketValue)}
            </div>
            <div className="text-[11px] text-slate-400">
              Cost Basis: {formatUsd(totalCostBasis)}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-sans text-slate-400">
              Open Unrealized P&amp;L
            </div>
            <div
              className={`text-base font-semibold mt-0.5 ${
                totalUnrealizedPl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatUsd(totalUnrealizedPl, true)}
            </div>
            <div className="text-[11px] text-slate-400">
              Intraday P/L:{' '}
              <span
                className={
                  totalIntradayPl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                {formatUsd(totalIntradayPl, true)}
              </span>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-sans text-slate-400">
              Rule Evaluation Events
            </div>
            <div className="text-base font-semibold text-amber-400 mt-0.5">
              {activeRiskEventsCount} Active
            </div>
            <div className="text-[11px] text-slate-400">
              Deterministic risk triggers
            </div>
          </div>

          <div>
            <div className="text-[11px] font-sans text-slate-400">
              Auto-Executed Exit Plans
            </div>
            <div className="text-base font-semibold text-emerald-400 mt-0.5">
              {
                (state?.stage2_plans ?? []).filter(
                  (p) => p.approval_status === 'APPROVED_AND_SUBMITTED'
                ).length
              }{' '}
              Auto-Submitted
            </div>
            <div className="text-[11px] text-slate-400">
              {pendingApprovalCount > 0
                ? `${pendingApprovalCount} awaiting Settings approval`
                : 'No manual approval required'}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-sans text-slate-400">
              Open Orders &amp; Audit Trail
            </div>
            <div className="text-base font-semibold text-slate-100 mt-0.5">
              {openOrdersCount} Open · {state?.audit_logs.length ?? 0} Logs
            </div>
            <div className="text-[11px] text-slate-400">
              SHA-256 immutable ledger
            </div>
          </div>
        </div>
      </div>

      {/* Status Notification Banner */}
      {statusBanner && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            statusBanner.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : statusBanner.type === 'warning'
                ? 'border-amber-500/40 bg-amber-950/30 text-amber-200'
                : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-slate-200 text-xs whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Portfolio Holdings Master Table */}
      <div className="border border-slate-800 rounded-lg bg-slate-900/60 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              01. Active Portfolio Holdings &amp; Real-Time Risk Telemetry
            </h3>
            <p className="text-xs text-slate-400">
              Click any holding row to inspect its Unusual Whales options tape, net premium ticks, deterministic risk rules, and Two-Stage LLM Exit Plan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Asset Class Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-md">
              {(['ALL', 'option', 'stock'] as const).map((cls) => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => setAssetFilter(cls)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    assetFilter === cls
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cls === 'ALL'
                    ? 'All Assets'
                    : cls === 'option'
                      ? 'Options (OSI)'
                      : 'Common Stock'}
                </button>
              ))}
            </div>

            {/* Stage-1 Decision Filter */}
            <select
              aria-label="Filter by Stage-1 LLM Recommendation"
              value={decisionFilter}
              onChange={(e) =>
                setDecisionFilter(e.target.value as 'ALL' | Stage1HoldingAction)
              }
              className="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-md text-slate-200"
            >
              <option value="ALL">All Stage-1 Actions</option>
              <option value="EXIT">EXIT</option>
              <option value="REDUCE">REDUCE</option>
              <option value="HEDGE">HEDGE</option>
              <option value="ROLL">ROLL</option>
              <option value="HOLD">HOLD</option>
              <option value="NEEDS_HUMAN_REVIEW">NEEDS_HUMAN_REVIEW</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-slate-950/50">
                <th className="py-2.5 px-4">Holding / OSI Symbol</th>
                <th className="py-2.5 px-3 text-right">Qty / Entry / Last</th>
                <th className="py-2.5 px-3 text-right">Unrealized P&amp;L</th>
                <th className="py-2.5 px-3 text-right">Spot vs VWAP</th>
                <th className="py-2.5 px-3 text-right">DTE · Greeks · Spread</th>
                <th className="py-2.5 px-3 text-right">UW Net Prem &amp; Vol/OI</th>
                <th className="py-2.5 px-3">Short &amp; Dark-Pool Matrix</th>
                <th className="py-2.5 px-3">Safety &amp; Risk Rules</th>
                <th className="py-2.5 px-3">Stage-1 LLM Action</th>
                <th className="py-2.5 px-4 text-right">Auto-Execution Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs font-mono tabular-nums">
              {filteredHoldings.map((h) => {
                const isSelected = h.holding_id === selectedHolding?.holding_id;
                const stg1 = h.latest_stage1_decision?.decision ?? 'HOLD';
                const latestNet =
                  h.uw_net_prem_ticks[h.uw_net_prem_ticks.length - 1];
                const triggeredCount = h.triggered_rules.filter(
                  (r) => r.triggered
                ).length;

                return (
                  <tr
                    key={h.holding_id}
                    onClick={() => setSelectedHoldingId(h.holding_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-sky-950/30 hover:bg-sky-950/40'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-3 px-4 font-sans whitespace-nowrap">
                      <div className="font-semibold text-slate-100 flex items-center gap-1.5 whitespace-nowrap">
                        <span>{h.display_label}</span>
                        <span className="text-[11px] font-mono text-slate-400">
                          · {h.asset_class.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5 whitespace-nowrap">
                        {h.osi_canonical_symbol} · Exp:{' '}
                        {(h.portfolio_exposure_pct * 100).toFixed(1)}%
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="text-slate-100 font-semibold">
                        {h.quantity} {h.asset_class === 'option' ? 'ct' : 'sh'} ·{' '}
                        {formatUsd(h.market_value)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        ${h.avg_entry_price.toFixed(2)} → $
                        {h.current_price.toFixed(2)}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div
                        className={`font-semibold ${
                          h.unrealized_pl >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {formatUsd(h.unrealized_pl, true)} (
                        {(h.unrealized_plpc * 100).toFixed(2)}%)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Intraday:{' '}
                        <span
                          className={
                            h.intraday_pl >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {formatUsd(h.intraday_pl, true)} (
                          {(h.intraday_plpc * 100).toFixed(2)}%)
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="text-slate-100">
                        ${h.underlying_snapshot.spot_price.toFixed(2)}{' '}
                        <span className="text-slate-400">vs</span> $
                        {h.underlying_snapshot.intraday_vwap.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Move {(h.underlying_snapshot.realized_move_pct * 100).toFixed(2)}%
                        · {h.underlying_snapshot.relative_volume.toFixed(2)}x RVOL
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right">
                      {h.option_snapshot ? (
                        <>
                          <div className="text-slate-100">
                            {h.option_snapshot.dte}DTE · Δ{' '}
                            {h.option_snapshot.delta.toFixed(2)} · Θ{' '}
                            {h.option_snapshot.theta.toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            ${h.option_snapshot.option_bid.toFixed(2)}×$
                            {h.option_snapshot.option_ask.toFixed(2)} (
                            {(h.option_snapshot.spread_pct * 100).toFixed(1)}%)
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-slate-300">Equity Δ 1.00</div>
                          <div className="text-[11px] text-slate-400">
                            ${h.underlying_snapshot.bid.toFixed(2)}×$
                            {h.underlying_snapshot.ask.toFixed(2)}
                          </div>
                        </>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div
                        className={
                          (latestNet?.cumulative_net_flow_delta ?? 0) >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        Net:{' '}
                        {formatCompactUsd(
                          latestNet?.cumulative_net_flow_delta ?? 0,
                          true
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {h.option_snapshot ? (
                          <>
                            Vol/OI {h.option_snapshot.volume_over_oi_ratio.toFixed(2)}x
                            {h.safety_flags.volume_over_oi_unconfirmed
                              ? ' (Unconf.)'
                              : ''}
                          </>
                        ) : (
                          `Alerts: ${h.uw_flow_alerts.length}`
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-sans">
                      {h.confirmation_matrix ? (
                        <div>
                          <div className="flex items-center gap-1.5 font-mono text-xs">
                            <span
                              className={`font-semibold ${
                                h.confirmation_matrix.avoid_premature_long_exit_active
                                  ? 'text-emerald-400'
                                  : h.confirmation_matrix.short_squeeze_cluster.active ||
                                      h.confirmation_matrix.stronger_exit_review_triggered
                                    ? 'text-rose-400'
                                    : 'text-sky-300'
                              }`}
                            >
                              Score{' '}
                              {h.confirmation_matrix.short_darkpool_score.score >= 0
                                ? `+${h.confirmation_matrix.short_darkpool_score.score}`
                                : h.confirmation_matrix.short_darkpool_score.score}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-[11px] text-slate-300">
                              {h.confirmation_matrix.categories_agreed_count}/3 Matrix
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 truncate max-w-[205px]">
                            SI {(h.short_telemetry.short_interest_pct_float * 100).toFixed(1)}% ·{' '}
                            {h.short_telemetry.days_to_cover.toFixed(1)} DTC · DP $
                            {h.dark_pool_telemetry.primary_zone_low.toFixed(1)}–$
                            {h.dark_pool_telemetry.primary_zone_high.toFixed(1)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="py-3 px-3 font-sans">
                      <div className="text-slate-200 font-medium">
                        {triggeredCount > 0 ? (
                          <span className="text-amber-400">
                            {triggeredCount} Rule{triggeredCount === 1 ? '' : 's'}{' '}
                            Triggered
                          </span>
                        ) : (
                          <span className="text-emerald-400">Nominal</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[190px]">
                        {h.safety_flags.active_flag_descriptions[0] ??
                          'Fresh quotes · Tight spread'}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-sans">
                      <span
                        className={`font-mono font-semibold text-xs ${
                          stg1 === 'EXIT'
                            ? 'text-rose-400'
                            : stg1 === 'REDUCE' || stg1 === 'ROLL'
                              ? 'text-amber-400'
                              : stg1 === 'HEDGE'
                                ? 'text-sky-400'
                                : stg1 === 'NEEDS_HUMAN_REVIEW'
                                  ? 'text-purple-400'
                                  : 'text-emerald-400'
                        }`}
                      >
                        {stg1}
                      </span>
                      <div className="text-[11px] text-slate-400">
                        {h.latest_stage2_plan
                          ? h.latest_stage2_plan.approval_status ===
                            'PENDING_HUMAN_APPROVAL'
                            ? 'Stage-2 Plan Pending'
                            : h.latest_stage2_plan.approval_status ===
                                'APPROVED_AND_SUBMITTED'
                              ? 'Order Submitted'
                              : h.latest_stage2_plan.approval_status
                          : 'No exit order needed'}
                      </div>
                    </td>

                    <td
                      className="py-3 px-4 text-right font-sans"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span
                          className={`text-[11px] font-mono ${
                            h.monitor_config.mode === 'paper_auto'
                              ? 'text-emerald-400'
                              : h.monitor_config.mode === 'approval_required'
                                ? 'text-amber-400'
                                : 'text-slate-400'
                          }`}
                        >
                          {h.monitor_config.mode === 'paper_auto'
                            ? 'AUTO-EXEC'
                            : h.monitor_config.mode === 'approval_required'
                              ? 'MANUAL GATE'
                              : 'ALERT ONLY'}
                        </span>
                        <button
                          type="button"
                          disabled={busyAction === `eval-${h.holding_id}`}
                          onClick={() => void handleEvaluateHolding(h.holding_id)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
                        >
                          {busyAction === `eval-${h.holding_id}`
                            ? 'Evaluating...'
                            : 'Re-Run AI'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Holding Deep-Dive Workbench */}
      {selectedHolding && (
        <div className="border border-slate-800 rounded-lg bg-slate-900/60 overflow-hidden">
          {/* Sub-Header & Navigation Tabs */}
          <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-slate-950/40">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Selected Holding</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-200">
                  {selectedHolding.osi_canonical_symbol}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Underlying {selectedHolding.underlying_symbol} Spot $
                  {selectedHolding.underlying_snapshot.spot_price.toFixed(2)} (VWAP $
                  {selectedHolding.underlying_snapshot.intraday_vwap.toFixed(2)})
                </span>
              </div>
              <h3 className="text-base font-semibold text-slate-100 mt-0.5">
                {selectedHolding.display_label} — Two-Stage LLM Exit Plan &amp; Flow Telemetry
              </h3>
            </div>

            {/* Interactive Segmented Tab Controls */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-md">
              <button
                type="button"
                onClick={() => setActiveTab('stage1_and_stage2_plan')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'stage1_and_stage2_plan'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Stage-1 &amp; Stage-2 LLM Exit Plan
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('short_and_darkpool_matrix')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'short_and_darkpool_matrix'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Short-Pressure, Dark-Pool Zones &amp; Confirmation Matrix
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('uw_flow_and_alpaca_bars')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'uw_flow_and_alpaca_bars'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Unusual Whales Flow &amp; Alpaca Bars
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('approval_queue_and_orders')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'approval_queue_and_orders'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Executed Plans ({state?.stage2_plans.length ?? 0}) &amp; Open Orders (
                {openOrdersCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('immutable_audit_log')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'immutable_audit_log'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Immutable Audit Log ({state?.audit_logs.length ?? 0})
              </button>
            </div>
          </div>

          {/* TAB 1: Stage-1 Decision & Stage-2 Structured Execution Plan */}
          {activeTab === 'stage1_and_stage2_plan' && (
            <div className="p-5 space-y-6">
              {/* Rule Simulation & Auto-Triggered LLM Toolbar */}
              <div className="p-4 rounded-md border border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs text-slate-300 flex items-center gap-2">
                    <span className="font-medium">Risk Event Scenario (Auto-Triggers):</span>
                    <select
                      aria-label="Select Risk Event Scenario"
                      value={simulateScenario}
                      onChange={(e) => {
                        const nextScenario = e.target
                          .value as typeof simulateScenario;
                        setSimulateScenario(nextScenario);
                        void handleEvaluateHolding(
                          selectedHolding.holding_id,
                          undefined,
                          nextScenario
                        );
                      }}
                      className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-slate-100"
                    >
                      <option value="default">
                        Current Live Telemetry (Default)
                      </option>
                      <option value="long_squeeze_hold_guard">
                        Simulate Long Squeeze Hold Guard (Bearish Tape + DP Hold + Tightening Borrow → Avoid Premature Exit)
                      </option>
                      <option value="short_squeeze_cluster">
                        Simulate Short-Squeeze Risk Cluster (5/5 Signals: DP Reclaim + Call Flow + Tight Borrow → Escalate Exit)
                      </option>
                      <option value="multi_category_weakness_exit">
                        Simulate 3/3 Confirmation Matrix Agreement (Price + Options Flow + Loosening Borrow → EXIT)
                      </option>
                      <option value="stop_loss_breach">
                        Simulate Hard Stop Breach (-24% P&amp;L → EXIT)
                      </option>
                      <option value="adverse_whale_flow">
                        Simulate Opposing $3.0M UW Put Sweep (→ EXIT/HEDGE)
                      </option>
                      <option value="dte_theta_cliff">
                        Simulate 3-DTE Theta Cliff + Earnings (→ ROLL)
                      </option>
                      <option value="profit_scale_out">
                        Simulate +38% Gain + Peak Giveback (→ REDUCE)
                      </option>
                      <option value="stale_or_wide_spread">
                        Simulate Stale Quote (28s) + 14% Spread (→ NEEDS_HUMAN_REVIEW)
                      </option>
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      void handleEvaluateHolding(
                        selectedHolding.holding_id,
                        undefined,
                        simulateScenario
                      )
                    }
                    className="px-3 py-1.5 text-xs font-medium rounded bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Re-Run Rule Engine &amp; Two-Stage LLM</span>
                  </button>
                </div>

                {/* Quick Test Any Stage-1 Action */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 mr-1">
                    Force Stage-1 Action:
                  </span>
                  {(
                    [
                      'EXIT',
                      'REDUCE',
                      'HEDGE',
                      'ROLL',
                      'HOLD',
                      'NEEDS_HUMAN_REVIEW',
                    ] as Stage1HoldingAction[]
                  ).map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() =>
                        void handleEvaluateHolding(
                          selectedHolding.holding_id,
                          act,
                          simulateScenario
                        )
                      }
                      className="px-2 py-1 text-[11px] font-mono rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 whitespace-nowrap shrink-0"
                    >
                      {act}
                    </button>
                  ))}
                </div>
              </div>

              {/* Compact Confirmation Matrix & Short/Dark-Pool Summary Banner inside Tab 1 */}
              {selectedHolding.confirmation_matrix && (
                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/60 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-mono text-slate-400">
                        INDEPENDENT DATA-TYPE CONFIRMATION MATRIX · SHORT_DARKPOOL_SCORE
                      </div>
                      <div className="text-sm font-semibold text-slate-100 mt-0.5 flex flex-wrap items-center gap-2">
                        <span>{selectedHolding.confirmation_matrix.matrix_verdict_label}</span>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-sky-400">
                          short_darkpool_score:{' '}
                          {selectedHolding.confirmation_matrix.short_darkpool_score.score >= 0
                            ? `+${selectedHolding.confirmation_matrix.short_darkpool_score.score}`
                            : selectedHolding.confirmation_matrix.short_darkpool_score.score}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-xs text-slate-300">
                          Flags:{' '}
                          {selectedHolding.confirmation_matrix.short_darkpool_score.flags.join(
                            ', '
                          ) || 'none'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('short_and_darkpool_matrix')}
                      className="px-3 py-1.5 text-xs font-medium rounded border border-sky-500/40 bg-sky-950/30 hover:bg-sky-900/40 text-sky-300 whitespace-nowrap shrink-0"
                    >
                      Inspect Full Short &amp; Dark-Pool Telemetry →
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {selectedHolding.confirmation_matrix.matrix_summary}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80 text-xs">
                    {selectedHolding.confirmation_matrix.categories.map((cat) => (
                      <div
                        key={cat.category_id}
                        className="p-2.5 rounded border border-slate-800 bg-slate-900/40 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">
                            {cat.label}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-semibold shrink-0 ${
                              cat.agreed_for_exit ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {cat.agreed_for_exit ? 'AGREES EXIT' : 'HOLDS / OFFSETS'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 leading-snug">
                          {cat.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deterministic Risk Rules & Safety Flags Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left 5 cols: Deterministic Rules & Safety Flags + Stage-1 Decision */}
                <div className="lg:col-span-5 space-y-5">
                  <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-semibold text-slate-200">
                        Deterministic Risk Rules &amp; Safety Gates
                      </h4>
                      <span className="text-[11px] font-mono text-slate-400">
                        {
                          selectedHolding.triggered_rules.filter(
                            (r) => r.triggered
                          ).length
                        }
                        /6 Triggered
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {selectedHolding.triggered_rules.map((rule) => (
                        <div
                          key={rule.rule_id}
                          className="pb-2.5 border-b border-slate-800/70 last:border-b-0 last:pb-0 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-200">
                              {rule.rule_name}
                            </span>
                            <span
                              className={`font-mono text-[11px] ${
                                rule.triggered
                                  ? rule.severity === 'CRITICAL'
                                    ? 'text-rose-400 font-semibold'
                                    : 'text-amber-400 font-semibold'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {rule.triggered
                                ? `${rule.severity} TRIGGERED`
                                : 'PASS'}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            Observed: {rule.observed_value} · Threshold:{' '}
                            {rule.threshold_value}
                          </div>
                          <div className="text-[11px] text-slate-300 mt-0.5">
                            {rule.evidence_summary}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stage-1 LLM Recommendation Card */}
                  {activeStage1 && (
                    <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[11px] text-slate-400">
                            Stage-1 Advisory LLM Decision
                          </div>
                          <div className="text-base font-bold font-mono text-slate-100 mt-0.5">
                            {activeStage1.decision} · {activeStage1.urgency}{' '}
                            URGENCY
                          </div>
                        </div>
                        <div className="text-right font-mono text-xs">
                          <div className="text-sky-400 font-semibold">
                            {(activeStage1.confidence_score * 100).toFixed(0)}%
                            Confidence
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {activeStage1.latency_ms}ms · {activeStage1.model_id}
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-slate-300 leading-relaxed">
                        <strong className="text-slate-100">
                          Primary Driver ({activeStage1.primary_risk_driver}):
                        </strong>{' '}
                        {activeStage1.rationale}
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          Stage-2 Execution Plan Required:{' '}
                          <strong className="text-slate-200">
                            {activeStage1.requires_stage2_plan ? 'YES' : 'NO'}
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setShowRawEvidenceJson((prev) => !prev)
                          }
                          className="text-[11px] text-sky-400 hover:underline"
                        >
                          {showRawEvidenceJson
                            ? 'Hide Stage-1 Evidence JSON'
                            : 'Inspect Stage-1 Evidence Packet JSON'}
                        </button>
                      </div>

                      {showRawEvidenceJson && (
                        <pre className="p-3 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-60">
                          {JSON.stringify(
                            activeStage1.evidence_packet,
                            null,
                            2
                          )}
                        </pre>
                      )}
                    </div>
                  )}
                </div>

                {/* Right 7 cols: Stage-2 Structured Execution Plan + Deterministic Risk Validator + Approval Gate */}
                <div className="lg:col-span-7 space-y-5">
                  {activeStage2 ? (
                    <div className="border border-slate-800 rounded-md p-5 bg-slate-950/40 space-y-5">
                      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
                        <div>
                          <div className="text-xs text-slate-400">
                            Stage-2 Structured Execution Plan · Advisory Only
                          </div>
                          <h4 className="text-base font-semibold text-slate-100 mt-0.5">
                            {activeStage2.recommended_action}:{' '}
                            {activeStage2.order_side.toUpperCase()}{' '}
                            {activeStage2.quantity_to_trade}x{' '}
                            {activeStage2.target_symbol} (
                            {activeStage2.percentage_of_position}% of Position)
                          </h4>
                          {activeStage2.secondary_leg_symbol && (
                            <div className="text-xs font-mono text-sky-400 mt-0.5">
                              Roll Target Leg: Buy-to-Open{' '}
                              {activeStage2.secondary_leg_symbol}
                            </div>
                          )}
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-xs text-slate-400">
                            Approval Status
                          </div>
                          <div
                            className={`text-xs font-semibold mt-0.5 ${
                              activeStage2.approval_status ===
                              'APPROVED_AND_SUBMITTED'
                                ? 'text-emerald-400'
                                : activeStage2.approval_status ===
                                    'PENDING_HUMAN_APPROVAL'
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                            }`}
                          >
                            {activeStage2.approval_status}
                          </div>
                        </div>
                      </div>

                      {/* Formulaic Limit-Price Logic (Not a fabricated exact price) */}
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-200">
                          Quote-Anchored Limit-Price Calculation Logic (Non-Fabricated)
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums text-xs p-3 rounded border border-slate-800 bg-slate-900/50">
                          <div>
                            <div className="text-[11px] font-sans text-slate-400">
                              Live NBBO Bid × Ask
                            </div>
                            <div className="text-slate-100 font-semibold mt-0.5">
                              $
                              {activeStage2.limit_price_logic.reference_bid.toFixed(
                                2
                              )}{' '}
                              × $
                              {activeStage2.limit_price_logic.reference_ask.toFixed(
                                2
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-slate-400">
                              Live NBBO Midpoint
                            </div>
                            <div className="text-slate-100 font-semibold mt-0.5">
                              $
                              {activeStage2.limit_price_logic.reference_mid.toFixed(
                                2
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-slate-400">
                              Initial Limit Price
                            </div>
                            <div className="text-emerald-400 font-semibold mt-0.5">
                              $
                              {activeStage2.limit_price_logic.computed_initial_limit_price.toFixed(
                                2
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-sans text-slate-400">
                              Worst Acceptable Limit
                            </div>
                            <div className="text-amber-400 font-semibold mt-0.5">
                              $
                              {activeStage2.limit_price_logic.worst_acceptable_limit_price.toFixed(
                                2
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-mono text-sky-300 bg-slate-950 p-2.5 rounded border border-slate-800">
                          Formula ({activeStage2.limit_price_logic.formula_type}
                          ): {activeStage2.limit_price_logic.formula_expression}
                        </div>
                        <p className="text-xs text-slate-300">
                          {activeStage2.limit_price_logic.explanation}
                        </p>
                      </div>

                      {/* Time-in-Force, Retry/Cancel Logic & Risk Constraints */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800">
                        <div className="space-y-1.5 text-xs">
                          <div className="font-semibold text-slate-200">
                            Time-in-Force &amp; Retry / Cancel Logic
                          </div>
                          <div className="font-mono text-slate-300 space-y-1 text-[11px]">
                            <div>
                              Order Type / TIF: {activeStage2.order_type.toUpperCase()}{' '}
                              · {activeStage2.time_in_force.toUpperCase()}
                            </div>
                            <div>
                              Reprice Walk:{' '}
                              {
                                activeStage2.retry_and_cancel_logic
                                  .max_reprice_attempts
                              }{' '}
                              steps every{' '}
                              {
                                activeStage2.retry_and_cancel_logic
                                  .reprice_interval_seconds
                              }
                              s (
                              {
                                activeStage2.retry_and_cancel_logic
                                  .step_towards_market_bps
                              }{' '}
                              bps/step)
                            </div>
                            <div>
                              Cancel Unfilled After:{' '}
                              {
                                activeStage2.retry_and_cancel_logic
                                  .cancel_if_unfilled_after_seconds
                              }
                              s
                            </div>
                            <div>
                              Abort if Spread &gt;{' '}
                              {(
                                activeStage2.retry_and_cancel_logic
                                  .cancel_if_spread_exceeds_pct * 100
                              ).toFixed(1)}
                              % or Quote Age &gt;{' '}
                              {
                                activeStage2.retry_and_cancel_logic
                                  .stale_quote_abort_seconds
                              }
                              s
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div className="font-semibold text-slate-200">
                            Risk Constraints &amp; Post-Trade Target
                          </div>
                          <div className="font-mono text-slate-300 space-y-1 text-[11px]">
                            <div>
                              Max Slippage from Mid:{' '}
                              {(
                                activeStage2.risk_constraints
                                  .max_slippage_from_mid_pct * 100
                              ).toFixed(2)}
                              %
                            </div>
                            <div>
                              Min Credit / Contract: $
                              {activeStage2.risk_constraints.min_acceptable_credit_per_contract.toFixed(
                                0
                              )}
                            </div>
                            <div>
                              Post-Trade Delta Target:{' '}
                              {activeStage2.risk_constraints.post_trade_delta_target.toFixed(
                                2
                              )}
                            </div>
                            <div>
                              Market Orders Disallowed:{' '}
                              {activeStage2.risk_constraints
                                .disallow_market_orders
                                ? 'STRICTLY ENFORCED'
                                : 'NO'}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Rationale & Confidence Qualifiers */}
                      <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
                        <div className="font-semibold text-slate-200">
                          Execution Rationale &amp; Confidence Qualifiers
                        </div>
                        <p className="text-slate-300 leading-relaxed">
                          {activeStage2.rationale}
                        </p>
                        <ul className="space-y-1 text-[11px] text-slate-400 list-disc list-inside">
                          {activeStage2.confidence_qualifiers.map((q, idx) => (
                            <li key={idx}>{q}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Deterministic Risk Engine Validation Checklist */}
                      <div className="pt-3 border-t border-slate-800 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200">
                            Deterministic Risk Engine Validation
                          </span>
                          <span
                            className={`font-mono font-semibold ${
                              activeStage2.risk_validation.passed
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {activeStage2.risk_validation.passed
                              ? 'ALL SAFETY CHECKS PASSED'
                              : 'BLOCKED BY RISK ENGINE'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          {activeStage2.risk_validation.checks.map((chk) => (
                            <div
                              key={chk.check_name}
                              className="p-2 rounded border border-slate-800 bg-slate-900/40 flex items-start gap-2"
                            >
                              {chk.passed ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <div className="font-medium text-slate-200">
                                  {chk.check_name}
                                </div>
                                <div className="text-slate-400">{chk.detail}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Staged Alpaca Order Request JSON & Human Approval Bar */}
                      <div className="pt-4 border-t border-slate-800 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200">
                            Staged Alpaca Order Payload (`POST /v2/orders`)
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            client_order_id:{' '}
                            {activeStage2.alpaca_order_payload.client_order_id}
                          </span>
                        </div>

                        <pre className="p-3 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto">
                          {JSON.stringify(
                            activeStage2.alpaca_order_payload,
                            null,
                            2
                          )}
                        </pre>

                        <div className="p-3 rounded border border-emerald-500/30 bg-emerald-950/20 text-xs text-slate-200 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>
                              Execution Status:{' '}
                              <strong className="font-mono text-emerald-300">
                                {activeStage2.approval_status ===
                                'APPROVED_AND_SUBMITTED'
                                  ? 'AUTOMATICALLY EXECUTED & SUBMITTED TO ALPACA'
                                  : activeStage2.approval_status}
                              </strong>
                              {activeStage2.submitted_order_id &&
                                ` · Broker Order ID: ${activeStage2.submitted_order_id}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400">
                            <span>
                              Engine:{' '}
                              {activeStage2.approved_by ||
                                'AUTO_PAPER_EXECUTION_ENGINE'}
                            </span>
                            {onOpenSettings && (
                              <button
                                type="button"
                                onClick={onOpenSettings}
                                className="text-sky-400 hover:underline font-sans"
                              >
                                Manage Approval Policy in Settings →
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-800 rounded-md p-6 bg-slate-950/40 text-xs text-slate-300 space-y-2">
                      <div className="text-sm font-semibold text-slate-100">
                        Stage-2 Structured Execution Plan Not Triggered (Stage-1 ={' '}
                        {activeStage1?.decision ?? 'HOLD'})
                      </div>
                      <p className="text-slate-400">
                        Stage-2 rich data collection and limit order planning only trigger when Stage-1 recommends EXIT, REDUCE, HEDGE, or ROLL. Use the scenario selector or Force Stage-1 Action buttons above to simulate an exit, reduce, hedge, or roll plan on this holding.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 1B: Short-Pressure Regime, Dark-Pool Positioning & Confirmation Matrix */}
          {activeTab === 'short_and_darkpool_matrix' && (
            <div className="p-5 space-y-6">
              {/* Top Row: Confirmation Matrix (3 Independent Categories) + Short-Squeeze Cluster & Rule Scoring */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-100">
                        Multi-Signal Confirmation Matrix (Requires &gt;= 2 of 3 Independent Categories to Agree)
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Reduces false exits by requiring agreement across Price Action, Options Flow, and Short-Pressure Regime.
                      </p>
                    </div>
                    <span
                      className={`font-mono text-xs font-semibold ${
                        selectedHolding.confirmation_matrix.avoid_premature_long_exit_active
                          ? 'text-emerald-400'
                          : selectedHolding.confirmation_matrix.stronger_exit_review_triggered
                            ? 'text-rose-400'
                            : 'text-sky-400'
                      }`}
                    >
                      {selectedHolding.confirmation_matrix.categories_agreed_count}/3 Categories Agree
                    </span>
                  </div>

                  <div className="space-y-3">
                    {selectedHolding.confirmation_matrix.categories.map((cat) => (
                      <div
                        key={cat.category_id}
                        className="p-3 rounded border border-slate-800 bg-slate-900/50 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100">
                            {cat.label}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              cat.agreed_for_exit ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {cat.agreed_for_exit
                              ? 'CONFIRMED ADVERSE (EXIT SIGNAL)'
                              : 'INTACT / OFFSETTING'}
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          {cat.detail}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded border border-slate-800 bg-slate-900/70 text-xs space-y-1">
                    <div className="font-mono text-[11px] text-sky-400 font-semibold">
                      Matrix Verdict: {selectedHolding.confirmation_matrix.matrix_verdict_label}
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {selectedHolding.confirmation_matrix.matrix_summary}
                    </p>
                  </div>
                </div>

                {/* Right 5 cols: short_darkpool_score Rule Scoring & Short-Position Squeeze Risk Cluster */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-100">
                          Rule Scoring (`short_darkpool_score`)
                        </h4>
                        <div className="text-[11px] text-slate-400">
                          Modifies review urgency &amp; sizing — never forces an autonomous order
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div
                          className={`text-lg font-bold ${
                            selectedHolding.confirmation_matrix.short_darkpool_score.score > 0
                              ? 'text-emerald-400'
                              : selectedHolding.confirmation_matrix.short_darkpool_score.score < 0
                                ? 'text-rose-400'
                                : 'text-slate-200'
                          }`}
                        >
                          Score:{' '}
                          {selectedHolding.confirmation_matrix.short_darkpool_score.score >= 0
                            ? `+${selectedHolding.confirmation_matrix.short_darkpool_score.score}`
                            : selectedHolding.confirmation_matrix.short_darkpool_score.score}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Exposure:{' '}
                          {selectedHolding.confirmation_matrix.effective_position_side.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
                      <div className="p-2.5 rounded border border-slate-800 bg-slate-900/40">
                        <div className="text-[11px] font-sans text-slate-400">
                          Urgency Modifier
                        </div>
                        <div className="text-slate-100 font-semibold mt-0.5 text-[11px]">
                          {
                            selectedHolding.confirmation_matrix.short_darkpool_score
                              .review_urgency_modifier
                          }
                        </div>
                      </div>
                      <div className="p-2.5 rounded border border-slate-800 bg-slate-900/40">
                        <div className="text-[11px] font-sans text-slate-400">
                          Sizing / Confidence Mod
                        </div>
                        <div className="text-slate-100 font-semibold mt-0.5">
                          {(
                            selectedHolding.confirmation_matrix.short_darkpool_score
                              .position_sizing_modifier_pct * 100
                          ).toFixed(0)}
                          % size ·{' '}
                          {selectedHolding.confirmation_matrix.short_darkpool_score
                            .exit_confidence_delta >= 0
                            ? `+${(
                                selectedHolding.confirmation_matrix.short_darkpool_score
                                  .exit_confidence_delta * 100
                              ).toFixed(0)}%`
                            : `${(
                                selectedHolding.confirmation_matrix.short_darkpool_score
                                  .exit_confidence_delta * 100
                              ).toFixed(0)}%`}{' '}
                          exit conf
                        </div>
                      </div>
                    </div>

                    <div className="text-xs font-mono text-slate-300">
                      Active Rule Flags:{' '}
                      {selectedHolding.confirmation_matrix.short_darkpool_score.flags.length >
                      0
                        ? selectedHolding.confirmation_matrix.short_darkpool_score.flags.join(
                            ' · '
                          )
                        : 'none'}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {selectedHolding.confirmation_matrix.short_darkpool_score.summary}
                    </p>
                  </div>

                  {/* Short-Position Squeeze-Risk Cluster */}
                  <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-slate-100">
                        Short-Position Squeeze-Risk Cluster Check
                      </h4>
                      <span
                        className={`font-mono text-xs font-semibold ${
                          selectedHolding.confirmation_matrix.short_squeeze_cluster.active
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {
                          selectedHolding.confirmation_matrix.short_squeeze_cluster
                            .signals_active_count
                        }
                        /5 Signals
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {selectedHolding.confirmation_matrix.short_squeeze_cluster.summary}
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 text-[11px] font-mono text-slate-300 pt-1">
                      <div>
                        [
                        {selectedHolding.confirmation_matrix.short_squeeze_cluster
                          .price_reclaims_dark_pool_zone
                          ? '✓'
                          : '·'}
                        ] Price reclaims &amp; holds above high-volume off-lit zone
                      </div>
                      <div>
                        [
                        {selectedHolding.confirmation_matrix.short_squeeze_cluster
                          .call_options_activity_supportive
                          ? '✓'
                          : '·'}
                        ] Call-side options activity supportive
                      </div>
                      <div>
                        [
                        {selectedHolding.confirmation_matrix.short_squeeze_cluster
                          .borrow_tightening
                          ? '✓'
                          : '·'}
                        ] Borrow fee rising materially or availability contracting
                      </div>
                      <div>
                        [
                        {selectedHolding.confirmation_matrix.short_squeeze_cluster
                          .short_interest_and_dtc_elevated
                          ? '✓'
                          : '·'}
                        ] Short interest &amp; days-to-cover elevated
                      </div>
                      <div>
                        [
                        {selectedHolding.confirmation_matrix.short_squeeze_cluster
                          .price_accelerating_on_rvol
                          ? '✓'
                          : '·'}
                        ] Price action accelerating upward on abnormal volume
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Middle Row: 1. Short-Pressure Regime (4 Signals) & 2. Dark-Pool Positioning & Price Levels */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. Short-Pressure Regime */}
                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-100">
                        1. Short-Pressure Regime — 4 Distinct Signals (
                        {selectedHolding.underlying_symbol})
                      </h4>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        Endpoints: /api/shorts/{selectedHolding.underlying_symbol}/data · /interest-float/v2 · /volume-and-ratio · /ftds
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold text-amber-400">
                      {selectedHolding.short_telemetry.squeeze_vulnerability_regime}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums text-xs">
                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Short Interest / Float
                      </div>
                      <div className="text-sm font-semibold text-slate-100 mt-0.5">
                        {(
                          selectedHolding.short_telemetry.short_interest_pct_float * 100
                        ).toFixed(1)}
                        %
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Structural squeeze potential
                      </div>
                    </div>

                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Days to Cover
                      </div>
                      <div className="text-sm font-semibold text-slate-100 mt-0.5">
                        {selectedHolding.short_telemetry.days_to_cover.toFixed(1)}d
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Exit difficulty (not catalyst)
                      </div>
                    </div>

                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Borrow Fee &amp; Avail
                      </div>
                      <div className="text-sm font-semibold text-amber-400 mt-0.5">
                        {(selectedHolding.short_telemetry.borrow_fee_rate * 100).toFixed(1)}%
                        fee
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {selectedHolding.short_telemetry.short_shares_available.toLocaleString()}{' '}
                        sh (
                        {(
                          selectedHolding.short_telemetry.shares_available_change_5d * 100
                        ).toFixed(0)}
                        % 5d)
                      </div>
                    </div>

                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Daily Short-Vol Ratio
                      </div>
                      <div className="text-sm font-semibold text-sky-400 mt-0.5">
                        {(
                          selectedHolding.short_telemetry.short_volume_ratio_latest * 100
                        ).toFixed(1)}
                        %
                      </div>
                      <div className="text-[11px] text-slate-400">
                        20d Pctile:{' '}
                        {(
                          selectedHolding.short_telemetry
                            .short_volume_ratio_20d_percentile * 100
                        ).toFixed(0)}
                        th
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-amber-500/30 bg-amber-950/20 text-[11px] text-amber-200">
                    <strong>Guardrail:</strong>{' '}
                    {selectedHolding.short_telemetry.short_volume_interpretation_note}
                  </div>

                  {/* Exchange Breakdown & FTDs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800 text-xs font-mono tabular-nums">
                    <div>
                      <div className="font-sans font-semibold text-slate-300 mb-1.5">
                        Short Volume by Exchange (`/volumes-by-exchange`)
                      </div>
                      <div className="space-y-1 text-[11px]">
                        {selectedHolding.short_telemetry.exchange_breakdown.map(
                          (ex) => (
                            <div
                              key={ex.exchange}
                              className="flex items-center justify-between text-slate-300"
                            >
                              <span>{ex.exchange}</span>
                              <span>
                                {(ex.short_ratio * 100).toFixed(1)}% (
                                {(ex.short_volume / 1_000_000).toFixed(2)}M)
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="font-sans font-semibold text-slate-300 mb-1.5">
                        Recent Failures to Deliver (`/ftds`)
                      </div>
                      <div className="space-y-1 text-[11px]">
                        {selectedHolding.short_telemetry.recent_ftds.map((ftd) => (
                          <div
                            key={ftd.settlement_date}
                            className="flex items-center justify-between text-slate-300"
                          >
                            <span>{ftd.settlement_date}</span>
                            <span>
                              {ftd.quantity.toLocaleString()} sh (
                              {formatCompactUsd(ftd.notional_value)})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Dark-Pool Positioning & Monitored Price Zones */}
                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-100">
                        2. Dark-Pool Positioning &amp; Monitored Price Zones (
                        {selectedHolding.underlying_symbol})
                      </h4>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        Endpoints: /api/darkpool/{selectedHolding.underlying_symbol} · /price-levels · WS off_lit_trades
                      </div>
                    </div>
                    <span className="font-mono text-xs text-emerald-400">
                      Cancelled Prints Excluded (
                      {selectedHolding.dark_pool_telemetry.cancelled_prints_filtered_count ??
                        1}{' '}
                      filtered)
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 font-mono tabular-nums text-xs">
                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Session Block Prints
                      </div>
                      <div className="text-sm font-semibold text-slate-100 mt-0.5">
                        {selectedHolding.dark_pool_telemetry.large_print_count_session}{' '}
                        prints ·{' '}
                        {formatCompactUsd(
                          selectedHolding.dark_pool_telemetry
                            .large_print_premium_session
                        )}
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Primary Off-Lit Zone
                      </div>
                      <div className="text-sm font-semibold text-sky-400 mt-0.5">
                        ${selectedHolding.dark_pool_telemetry.primary_zone_low.toFixed(2)}–$
                        {selectedHolding.dark_pool_telemetry.primary_zone_high.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-800 bg-slate-900/50">
                      <div className="text-[11px] font-sans text-slate-400">
                        Last Price Relation
                      </div>
                      <div className="text-xs font-semibold text-slate-100 mt-0.5">
                        {selectedHolding.dark_pool_telemetry.last_price_relation}
                      </div>
                    </div>
                  </div>

                  {/* Monitored Key Price Zones Table */}
                  <div>
                    <div className="text-xs font-semibold text-slate-200 mb-2">
                      Monitored Off-Lit Price-Level Concentration (`/price-levels`)
                    </div>
                    <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-sans">
                          <th className="py-1.5">Monitored Zone</th>
                          <th className="py-1.5 text-right">DP Vol (Share)</th>
                          <th className="py-1.5 text-right">Dist from Last</th>
                          <th className="py-1.5 text-right">Price Behavior</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {selectedHolding.dark_pool_telemetry.key_price_zones.map(
                          (z, i) => (
                            <tr key={i}>
                              <td className="py-2 text-slate-200 font-semibold">
                                ${z.price_low.toFixed(2)} – ${z.price_high.toFixed(2)}
                              </td>
                              <td className="py-2 text-right text-slate-300">
                                {z.dark_pool_volume.toLocaleString()} (
                                {(z.dark_pool_share_pct ?? 50).toFixed(1)}%)
                              </td>
                              <td className="py-2 text-right text-slate-300">
                                {(z.distance_from_last_pct * 100).toFixed(2)}%
                              </td>
                              <td
                                className={`py-2 text-right font-semibold ${
                                  z.price_behavior === 'holding_above' ||
                                  z.price_behavior === 'reclaiming_with_volume'
                                    ? 'text-emerald-400'
                                    : z.price_behavior === 'rejected_below'
                                      ? 'text-rose-400'
                                      : 'text-slate-400'
                                }`}
                              >
                                {z.price_behavior}
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Bottom Row: Aggregated LLM Feature Payload (`short_context`, `dark_pool_context`, `interpretation_constraints`) */}
              <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-100">
                      Aggregated Feature Payload for the LLM (`llm_short_darkpool_payload`)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Raw dark-pool prints are aggregated into structured zones and paired with explicit `interpretation_constraints` before LLM inference.
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-400">
                    cancelled_prints_excluded: true
                  </span>
                </div>
                <pre className="p-3 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-sky-300 overflow-x-auto max-h-64">
                  {JSON.stringify(
                    selectedHolding.llm_short_darkpool_payload,
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 2: Unusual Whales Options Tape, Flow Alerts, Net Prem Ticks & Alpaca Intraday Bars */}
          {activeTab === 'uw_flow_and_alpaca_bars' && (
            <div className="p-5 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Unusual Whales Intraday Net Premium Ticks */}
                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-200">
                      Unusual Whales Net Premium Ticks (`/api/stock/
                      {selectedHolding.underlying_symbol}/net-prem-ticks`)
                    </h4>
                    {onSelectTickerInScanner && (
                      <button
                        type="button"
                        onClick={() =>
                          onSelectTickerInScanner(
                            selectedHolding.underlying_symbol
                          )
                        }
                        className="text-[11px] text-sky-400 hover:underline"
                      >
                        Open {selectedHolding.underlying_symbol} in Whale Scanner →
                      </button>
                    )}
                  </div>
                  <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-sans">
                        <th className="py-1.5">Tick Time</th>
                        <th className="py-1.5 text-right">Cum Call Prem</th>
                        <th className="py-1.5 text-right">Cum Put Prem</th>
                        <th className="py-1.5 text-right">Call / Put Vol</th>
                        <th className="py-1.5 text-right">Cum Net Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selectedHolding.uw_net_prem_ticks.map((pt) => (
                        <tr key={pt.timestamp}>
                          <td className="py-2 text-slate-300">{pt.timestamp}</td>
                          <td className="py-2 text-right text-emerald-400">
                            {formatCompactUsd(pt.cumulative_net_call_premium, true)}
                          </td>
                          <td className="py-2 text-right text-rose-400">
                            {formatCompactUsd(pt.cumulative_net_put_premium, true)}
                          </td>
                          <td className="py-2 text-right text-slate-300">
                            {pt.net_call_volume.toLocaleString()} /{' '}
                            {pt.net_put_volume.toLocaleString()}
                          </td>
                          <td
                            className={`py-2 text-right font-semibold ${
                              pt.cumulative_net_flow_delta >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {formatCompactUsd(pt.cumulative_net_flow_delta, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Alpaca Underlying Intraday Bars & VWAP */}
                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-200">
                      Alpaca Underlying Intraday Bars &amp; VWAP (
                      {selectedHolding.underlying_symbol})
                    </h4>
                    <span className="text-[11px] font-mono text-slate-400">
                      RVOL: {selectedHolding.underlying_snapshot.relative_volume.toFixed(2)}x
                    </span>
                  </div>
                  <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-sans">
                        <th className="py-1.5">Bar Time</th>
                        <th className="py-1.5 text-right">Open</th>
                        <th className="py-1.5 text-right">High / Low</th>
                        <th className="py-1.5 text-right">Close</th>
                        <th className="py-1.5 text-right">VWAP</th>
                        <th className="py-1.5 text-right">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {selectedHolding.underlying_snapshot.intraday_bars.map(
                        (bar) => (
                          <tr key={bar.timestamp}>
                            <td className="py-2 text-slate-300">
                              {bar.timestamp}
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              ${bar.open.toFixed(2)}
                            </td>
                            <td className="py-2 text-right text-slate-400">
                              ${bar.high.toFixed(2)} / ${bar.low.toFixed(2)}
                            </td>
                            <td className="py-2 text-right text-slate-100 font-semibold">
                              ${bar.close.toFixed(2)}
                            </td>
                            <td className="py-2 text-right text-sky-400">
                              ${bar.vwap.toFixed(2)}
                            </td>
                            <td className="py-2 text-right text-slate-300">
                              {bar.volume.toLocaleString()}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unusual Whales Live Options Tape & Flow Alerts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-200">
                      Unusual Whales Live Options Tape (`/api/option-trades`)
                    </h4>
                    <span className="text-[11px] text-amber-300">
                      Vol &gt; OI treated as unconfirmed until next-day OI
                    </span>
                  </div>
                  <div className="space-y-2">
                    {selectedHolding.uw_options_tape.map((pt) => (
                      <div
                        key={pt.trade_id}
                        className="p-2.5 rounded border border-slate-800 bg-slate-900/40 text-xs font-mono tabular-nums space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-slate-100 font-semibold">
                            {pt.osi_symbol} · {pt.size}x @ ${pt.price.toFixed(2)}
                          </span>
                          <span
                            className={
                              pt.sentiment === 'BULLISH'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {formatUsd(pt.premium)} ({pt.side_aggressor})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-sans">
                          Vol {pt.volume.toLocaleString()} vs OI{' '}
                          {pt.open_interest.toLocaleString()} ·{' '}
                          {pt.unconfirmed_opening_disclaimer}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-slate-200">
                      Flow Alerts (`/api/option-trades/flow-alerts`) &amp; Roll/Hedge Chain
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      Supporting aggregation evidence
                    </span>
                  </div>
                  <div className="space-y-2">
                    {selectedHolding.uw_flow_alerts.map((fa) => (
                      <div
                        key={fa.alert_id}
                        className="p-2.5 rounded border border-slate-800 bg-slate-900/40 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span className="text-slate-100 font-semibold">
                            {fa.osi_symbol} · {fa.rule_name}
                          </span>
                          <span className="text-amber-400">
                            {formatUsd(fa.total_premium)} (
                            {(fa.ask_side_perc * 100).toFixed(0)}% Ask)
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {fa.supporting_evidence_note}
                        </div>
                      </div>
                    ))}

                    <div className="pt-2 text-xs font-semibold text-slate-300">
                      Screener Chain Alternatives (`/api/screener/option-contracts`):
                    </div>
                    {selectedHolding.uw_contract_flow.hottest_chain_alternatives.map(
                      (alt) => (
                        <div
                          key={alt.osi_symbol}
                          className="p-2 rounded border border-slate-800 bg-slate-900/30 text-xs font-mono flex items-center justify-between"
                        >
                          <div>
                            <span className="text-sky-400 font-semibold">
                              [{alt.role}]
                            </span>{' '}
                            {alt.osi_symbol} ({alt.dte}DTE · Δ{' '}
                            {alt.delta.toFixed(2)})
                          </div>
                          <div className="text-slate-200">
                            ${alt.bid.toFixed(2)} × ${alt.ask.toFixed(2)} (Mid $
                            {alt.mid.toFixed(2)})
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Automated Execution Plans & Open Alpaca Orders */}
          {activeTab === 'approval_queue_and_orders' && (
            <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Automated Stage-2 Execution Plans */}
              <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200">
                    Stage-2 Automated Execution Plans ({state?.stage2_plans.length ?? 0})
                  </h4>
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="text-[11px] text-sky-400 hover:underline"
                    >
                      Approval Policy in Settings →
                    </button>
                  )}
                </div>
                {(state?.stage2_plans.length ?? 0) === 0 ? (
                  <div className="text-xs text-slate-400 py-4">
                    No Stage-2 exit/reduce/hedge/roll plans generated yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {state?.stage2_plans.map((plan) => (
                      <div
                        key={plan.plan_id}
                        className="p-3 rounded border border-slate-800 bg-slate-900/50 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span className="font-semibold text-slate-100">
                            {plan.recommended_action} ·{' '}
                            {plan.order_side.toUpperCase()}{' '}
                            {plan.quantity_to_trade}x {plan.target_symbol}
                          </span>
                          <span className="text-emerald-400">
                            Limit $
                            {plan.limit_price_logic.computed_initial_limit_price.toFixed(
                              2
                            )}{' '}
                            (NBBO ${plan.limit_price_logic.reference_bid.toFixed(2)}×$
                            {plan.limit_price_logic.reference_ask.toFixed(2)})
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300">
                          {plan.rationale}
                        </p>
                        <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-400 border-t border-slate-800/60">
                          <span className="text-emerald-400">
                            {plan.approval_status}
                          </span>
                          <span>
                            Order ID: {plan.submitted_order_id ?? 'AUTO-ROUTED'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Open / Session Alpaca Orders */}
              <div className="border border-slate-800 rounded-md p-4 bg-slate-950/40 space-y-3">
                <h4 className="text-xs font-semibold text-slate-200">
                  Alpaca Open &amp; Session Orders (`GET /v2/orders?status=open`)
                </h4>
                {state?.open_orders.length === 0 ? (
                  <div className="text-xs text-slate-400 py-4">
                    No session orders submitted yet. Approve an exit plan on the left to submit a limit order to Alpaca.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {state?.open_orders.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3 rounded border border-slate-800 bg-slate-900/50 flex items-center justify-between gap-3 text-xs font-mono"
                      >
                        <div>
                          <div className="text-slate-100 font-semibold">
                            {ord.side.toUpperCase()} {ord.qty}x {ord.symbol} @ $
                            {(ord.limit_price ?? 0).toFixed(2)} Limit
                          </div>
                          <div className="text-[11px] text-slate-400">
                            ID: {ord.id} · Status: {ord.status.toUpperCase()}
                          </div>
                        </div>
                        {ord.status !== 'canceled' && (
                          <button
                            type="button"
                            disabled={busyAction === `cancel-${ord.id}`}
                            onClick={() => void handleCancelOpenOrder(ord.id)}
                            className="px-2.5 py-1 text-[11px] font-sans font-medium rounded border border-rose-500/40 text-rose-300 hover:bg-rose-950/40 flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Cancel Order</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: Immutable Audit Log */}
          {activeTab === 'immutable_audit_log' && (
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">
                    Immutable Cryptographic Audit Trail (`audit_logs`)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Every rule trigger, source snapshot, LLM system/user prompt, Stage-1 &amp; Stage-2 JSON output, human approval, and Alpaca order payload is permanently recorded.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {state?.audit_logs.map((log) => {
                  const isExp = expandedAuditId === log.audit_id;
                  return (
                    <div
                      key={log.audit_id}
                      className="border border-slate-800 rounded-md bg-slate-950/50 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-sky-400 font-semibold">
                            [{log.event_type}]
                          </span>
                          <span className="text-slate-200">{log.symbol}</span>
                          <span className="text-slate-400">· {log.actor}</span>
                        </div>
                        <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                          <span>{log.immutable_hash}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAuditId(isExp ? null : log.audit_id)
                            }
                            className="text-sky-400 hover:underline font-sans"
                          >
                            {isExp ? 'Hide Payload' : 'Inspect Payload'}
                          </button>
                        </div>
                      </div>
                      <div className="text-slate-300 mt-1">{log.summary}</div>

                      {isExp && (
                        <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-3 font-mono text-[11px]">
                          <div>
                            <div className="text-slate-400 mb-1">
                              Source Data &amp; Prompts:
                            </div>
                            <pre className="p-2.5 rounded bg-slate-950 border border-slate-800 text-slate-300 overflow-x-auto max-h-56">
                              {JSON.stringify(
                                {
                                  source_data: log.source_data_snapshot,
                                  prompts: log.prompts,
                                },
                                null,
                                2
                              )}
                            </pre>
                          </div>
                          <div>
                            <div className="text-slate-400 mb-1">
                              LLM JSON Output, Approval &amp; Order Payload:
                            </div>
                            <pre className="p-2.5 rounded bg-slate-950 border border-slate-800 text-emerald-300 overflow-x-auto max-h-56">
                              {JSON.stringify(
                                {
                                  llm_json_output: log.llm_json_output,
                                  approval_metadata: log.approval_metadata,
                                  order_payload: log.order_payload,
                                },
                                null,
                                2
                              )}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
