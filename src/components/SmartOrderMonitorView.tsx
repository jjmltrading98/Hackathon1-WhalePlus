import React, { useMemo, useState, useEffect } from 'react';
import {
  type SmartExecutionAlgoId,
  type SmartOrderEngineConfig,
  type SmartOrderExecutionTicket,
  type SmartOrderSide,
  computeSmartOrderPortfolioMetrics,
} from '../engine/smartOrderEngine';
import type { WhaleCandidate } from '../engine/whaleScannerEngine';
import type { MarketTideState } from '../engine/whalePipelineRuntime';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crosshair,
  FastForward,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';

interface SmartOrderMonitorViewProps {
  tickets: SmartOrderExecutionTicket[];
  config: SmartOrderEngineConfig;
  candidates: WhaleCandidate[];
  marketTide: MarketTideState;
  preselectedCandidateId?: string | null;
  onSaveConfig: (
    patch: Partial<SmartOrderEngineConfig>
  ) => Promise<SmartOrderEngineConfig>;
  onExecuteSmartOrder: (params: {
    candidate_id?: string;
    ticker?: string;
    side?: SmartOrderSide;
    qty?: number;
    algo?: SmartExecutionAlgoId;
    simulate_mode?:
      | 'auto_fill'
      | 'working_walk'
      | 'wide_spread_guard'
      | 'broker_reject';
    bid_override?: number;
    ask_override?: number;
    sync_live_alpaca?: boolean;
  }) => Promise<SmartOrderExecutionTicket | null>;
  onAdvanceTicket: (
    orderId: string,
    action: 'step_walk' | 'complete_at_fair_value' | 'cancel_order'
  ) => Promise<SmartOrderExecutionTicket | null>;
  onRefreshState: () => Promise<void>;
  onClearTickets: () => Promise<void>;
}

const ALGO_SPECS: Record<
  SmartExecutionAlgoId,
  { name: string; badge: string; summary: string }
> = {
  adaptive_microprice_walk: {
    name: 'Adaptive Microprice Walker',
    badge: 'Stoikov + Book Imbalance',
    summary:
      'Anchors initial passive limit at Bid + 28% of spread, then walks toward Stoikov book/flow microprice in timed increments.',
  },
  delta_pegged_mid: {
    name: 'Alpaca Delta-Pegged Fair Value',
    badge: 'Live SIP Spot Δ/Γ Peg',
    summary:
      'Continuously reprices option limit order (PATCH /v2/orders) as Alpaca 1m/5m underlying stock ticks, preventing stale-quote adverse selection.',
  },
  uw_flow_urgency_sweep: {
    name: 'UW Flow-Urgency Adaptive Cross',
    badge: 'Sweep & Z-Score Weighted',
    summary:
      'Scales initial limit placement dynamically between sub-mid and fair value based on Unusual Whales 5m sweep ratio and burst Z-score.',
  },
  liquidity_sniper_twap: {
    name: 'Wide-Spread Liquidity Sniper',
    badge: 'Spread Compression Gate',
    summary:
      'Holds passive sub-mid slices when NBBO spread is wide and only releases child limit slices when MM spread compresses below guardrail.',
  },
};

const SIDE_LABELS: Record<SmartOrderSide, string> = {
  buy_to_open: 'BUY TO OPEN (Long)',
  sell_to_close: 'SELL TO CLOSE (Exit)',
  sell_to_open: 'SELL TO OPEN (Short)',
  buy_to_close: 'BUY TO CLOSE (Cover)',
};

export const SmartOrderMonitorView: React.FC<SmartOrderMonitorViewProps> = ({
  tickets,
  config,
  preselectedCandidateId,
  onSaveConfig,
  onAdvanceTicket,
  onRefreshState,
  onClearTickets,
}) => {
  // Filter out synthetic seed demo tickets whenever real executed tickets exist, sorted newest first
  const realTickets = useMemo(() => {
    const nonSeed = tickets.filter((t) => !t.order_id.startsWith('smo-seed-'));
    const base = nonSeed.length > 0 ? nonSeed : tickets;
    return [...base].sort(
      (a, b) =>
        (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
    );
  }, [tickets]);

  const [syncingQuote, setSyncingQuote] = useState(false);

  // Guardrail Settings Drawer State
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [draftMaxSpreadPct, setDraftMaxSpreadPct] = useState<number>(
    config.maxSpreadPctGuardrail
  );
  const [draftMaxCrossFrac, setDraftMaxCrossFrac] = useState<number>(
    Math.round(config.maxSpreadCrossFraction * 100)
  );
  const [draftWalkIntervalMs, setDraftWalkIntervalMs] = useState<number>(
    config.walkStepIntervalMs
  );
  const [draftDeltaThreshold, setDraftDeltaThreshold] = useState<number>(
    config.deltaPegStockThresholdDollars
  );
  const [draftEnableDeltaPeg, setDraftEnableDeltaPeg] = useState<boolean>(
    config.enableAlpacaDeltaPeg
  );
  const [draftEnableUwBoost, setDraftEnableUwBoost] = useState<boolean>(
    config.enableUwFlowUrgencyBoost
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSavedBanner, setConfigSavedBanner] = useState(false);

  // Ledger Filter & Inspector State
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'filled' | 'working' | 'guard_error'
  >('all');
  const [algoFilter, setAlgoFilter] = useState<SmartExecutionAlgoId | 'ALL'>(
    'ALL'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(
    realTickets[0]?.order_id ?? null
  );
  const [inspectorTab, setInspectorTab] = useState<
    'ladder' | 'input_json' | 'output_json'
  >('ladder');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedCandidateId) {
      const matched = realTickets.find(
        (t) => t.candidate_id === preselectedCandidateId
      );
      if (matched) {
        setSelectedTicketId(matched.order_id);
      }
    }
  }, [preselectedCandidateId, realTickets]);

  const portfolioMetrics = useMemo(
    () => computeSmartOrderPortfolioMetrics(realTickets),
    [realTickets]
  );

  const filteredTickets = useMemo(() => {
    return realTickets.filter((t) => {
      if (statusFilter === 'filled' && t.status !== 'filled') return false;
      if (
        statusFilter === 'working' &&
        t.status !== 'working_walking' &&
        t.status !== 'partially_filled'
      ) {
        return false;
      }
      if (
        statusFilter === 'guard_error' &&
        t.status !== 'spread_guard_paused' &&
        t.status !== 'rejected_error'
      ) {
        return false;
      }
      if (algoFilter !== 'ALL' && t.Algo !== algoFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        const match =
          t.ticker.toLowerCase().includes(q) ||
          t.option_symbol.toLowerCase().includes(q) ||
          t.Algo.toLowerCase().includes(q) ||
          (t.error_message ?? '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [realTickets, statusFilter, algoFilter, searchQuery]);

  const selectedTicket = useMemo(() => {
    return (
      filteredTickets.find((t) => t.order_id === selectedTicketId) ??
      filteredTickets[0] ??
      null
    );
  }, [filteredTickets, selectedTicketId]);

  const handleSaveEngineGuardrails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      await onSaveConfig({
        maxSpreadPctGuardrail: draftMaxSpreadPct,
        maxSpreadCrossFraction: draftMaxCrossFrac / 100,
        walkStepIntervalMs: draftWalkIntervalMs,
        deltaPegStockThresholdDollars: draftDeltaThreshold,
        enableAlpacaDeltaPeg: draftEnableDeltaPeg,
        enableUwFlowUrgencyBoost: draftEnableUwBoost,
      });
      setConfigSavedBanner(true);
      setTimeout(() => setConfigSavedBanner(false), 3000);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSyncLiveQuoteAndFlow = async () => {
    setSyncingQuote(true);
    try {
      await onRefreshState();
    } finally {
      setSyncingQuote(false);
    }
  };

  const handleCopyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Compute relative percentage positions along [nbbo_bid .. nbbo_ask] for the visual spread ruler
  const getSpreadPositionPct = (
    price: number,
    bid: number,
    ask: number
  ): number => {
    const span = Math.max(0.01, ask - bid);
    return Math.min(100, Math.max(0, ((price - bid) / span) * 100));
  };

  const formatSmartOrderTimestamp = (isoStr?: string | null) => {
    if (!isoStr) {
      return {
        dateStr: '—',
        timeStr: '—',
        timeWithMsStr: '—',
        fullLabel: '—',
      };
    }
    const parsedMs = Date.parse(isoStr);
    if (!Number.isFinite(parsedMs)) {
      return {
        dateStr: isoStr.slice(0, 10) || '—',
        timeStr: isoStr.slice(11, 19) || isoStr,
        timeWithMsStr: isoStr.slice(11, 23) || isoStr,
        fullLabel: isoStr,
      };
    }
    const dt = new Date(parsedMs);
    const dateStr = /^\d{4}-\d{2}-\d{2}/.test(isoStr)
      ? isoStr.slice(0, 10)
      : dt.toISOString().slice(0, 10);
    let etHms = '';
    try {
      etHms = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(dt);
    } catch {
      etHms = dt.toISOString().slice(11, 19);
    }
    const msStr = String(dt.getUTCMilliseconds()).padStart(3, '0');
    const timeStr = `${etHms} ET`;
    const timeWithMsStr = `${etHms}.${msStr} ET`;
    return {
      dateStr,
      timeStr,
      timeWithMsStr,
      fullLabel: `${dateStr} ${timeWithMsStr}`,
    };
  };

  const computeStepElapsedMs = (
    ticketCreatedAt: string,
    stepTimestamp: string,
    stepIndex: number
  ): number => {
    const startMs = Date.parse(ticketCreatedAt);
    const stepMs = Date.parse(stepTimestamp);
    if (Number.isFinite(startMs) && Number.isFinite(stepMs) && stepMs >= startMs) {
      return Math.round(stepMs - startMs);
    }
    return Math.max(0, (stepIndex - 1) * 420);
  };

  const selectedMicro = selectedTicket?.microstructure ?? null;
  const effectiveFillOrLimit = selectedTicket
    ? (selectedTicket.avg_fill_price ?? selectedTicket.active_limit_price)
    : 0;

  return (
    <div className="space-y-5">
      {/* Top Header & Guardrail Controls */}
      <section
        aria-label="Smart Order Engine Header"
        className="p-4 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-sky-400" />
            <h1 className="text-lg font-bold tracking-tight text-slate-100">
              Smart Options Order Execution &amp; Spread-Capture Ledger
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-3xl">
            Real-time execution ledger of automated smart option orders. Click
            any order on the left to inspect its{' '}
            <strong className="text-slate-200">
              Bid-Ask Spread Decomposition &amp; Fill Pricing Waterfall
            </strong>
            , step-by-step price-walking ladder, and live Alpaca + Unusual
            Whales execution telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSyncLiveQuoteAndFlow}
            disabled={syncingQuote}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-sky-400 ${syncingQuote ? 'animate-spin' : ''}`}
            />
            <span>
              {syncingQuote ? 'Refreshing Orders...' : 'Refresh Order Ledger'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowSettingsDrawer((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors ${
              showSettingsDrawer
                ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                : 'border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span>
              Spread Guardrails (Max {config.maxSpreadPctGuardrail.toFixed(1)}%)
            </span>
          </button>

          <button
            type="button"
            onClick={onClearTickets}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-800 bg-[#0B0F17] hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Ledger</span>
          </button>
        </div>
      </section>

      {/* Collapsible Engine Guardrail & Algorithm Settings Drawer */}
      {showSettingsDrawer && (
        <form
          onSubmit={handleSaveEngineGuardrails}
          aria-label="Smart Order Engine Guardrail Configuration"
          className="p-5 rounded-lg border border-sky-500/40 bg-[#111726] space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Smart Spread-Walker &amp; Risk Guardrail Configuration
              </h2>
              <p className="text-xs text-slate-400">
                Persisted to the backend database and applied to all automated
                option orders.
              </p>
            </div>
            {configSavedBanner && (
              <span className="inline-flex items-center gap-1 text-xs font-mono text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved to Database</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1">
              <label
                htmlFor="guard-max-spread"
                className="block text-xs font-medium text-slate-300"
              >
                Max NBBO Spread % Guardrail
              </label>
              <input
                id="guard-max-spread"
                type="number"
                step="0.5"
                min={2}
                max={50}
                value={draftMaxSpreadPct}
                onChange={(e) => setDraftMaxSpreadPct(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
              />
              <p className="text-[11px] text-slate-400">
                Pauses aggressive walking if (Ask-Bid)/Mid exceeds ceiling.
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="guard-max-cross"
                className="block text-xs font-medium text-slate-300"
              >
                Max Spread Cross Ceiling (%)
              </label>
              <input
                id="guard-max-cross"
                type="number"
                step="1"
                min={30}
                max={95}
                value={draftMaxCrossFrac}
                onChange={(e) => setDraftMaxCrossFrac(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
              />
              <p className="text-[11px] text-slate-400">
                Hard reservation cap (e.g. 68% = never pay top 32% of spread).
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="guard-walk-interval"
                className="block text-xs font-medium text-slate-300"
              >
                Price-Walk Step Interval (ms)
              </label>
              <input
                id="guard-walk-interval"
                type="number"
                step="250"
                min={500}
                max={30000}
                value={draftWalkIntervalMs}
                onChange={(e) => setDraftWalkIntervalMs(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
              />
              <p className="text-[11px] text-slate-400">
                Resting duration at each limit step before walking $0.01–$0.05.
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="guard-delta-thresh"
                className="block text-xs font-medium text-slate-300"
              >
                Alpaca Delta-Peg Stock Trigger ($)
              </label>
              <input
                id="guard-delta-thresh"
                type="number"
                step="0.01"
                min={0.01}
                max={5.0}
                value={draftDeltaThreshold}
                onChange={(e) =>
                  setDraftDeltaThreshold(Number(e.target.value))
                }
                className="w-full px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100"
              />
              <p className="text-[11px] text-slate-400">
                Re-anchors option limit when Alpaca stock spot moves by ΔS.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftEnableDeltaPeg}
                  onChange={(e) => setDraftEnableDeltaPeg(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                />
                <span>
                  Enable Live Alpaca Stock Delta-Gamma Fair Value Pegging
                </span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftEnableUwBoost}
                  onChange={(e) => setDraftEnableUwBoost(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                />
                <span>
                  Enable Unusual Whales Sweep &amp; Burst Z-Score Urgency Shift
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={savingConfig}
              className="px-4 py-1.5 text-xs font-semibold rounded-md bg-sky-400 hover:bg-sky-300 text-slate-950 transition-colors"
            >
              {savingConfig
                ? 'Saving Guardrails...'
                : 'Save Guardrail Configuration'}
            </button>
          </div>
        </form>
      )}

      {/* 4-Card Execution & Spread Capture KPI Strip */}
      <section
        aria-label="Smart Order Portfolio KPIs"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="p-4 rounded-lg border border-slate-800 bg-[#111726]">
          <div className="text-xs text-slate-400">
            Smart Orders &amp; Contracts Filled
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
              {portfolioMetrics.filled_orders}/{portfolioMetrics.total_orders}
            </span>
            <span className="text-xs font-mono text-sky-400">
              {portfolioMetrics.total_contracts_filled} cts ·{' '}
              {portfolioMetrics.working_orders} walking
            </span>
          </div>
        </div>

        <div className="p-4 rounded-lg border border-slate-800 bg-[#111726]">
          <div className="text-xs text-slate-400">
            Avg Arrival Spread vs Spread Captured
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {portfolioMetrics.avg_spread_captured_pct.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-slate-400">
              of {portfolioMetrics.avg_arrival_spread_pct.toFixed(2)}% avg NBBO
            </span>
          </div>
        </div>

        <div className="p-4 rounded-lg border border-slate-800 bg-[#111726]">
          <div className="text-xs text-slate-400">
            Total Slippage Saved vs Crossing Ask
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              +${portfolioMetrics.total_dollars_saved_vs_ask.toLocaleString()}
            </span>
            <span className="text-xs font-mono text-emerald-400/90">
              avg {portfolioMetrics.avg_walk_steps_to_fill.toFixed(1)} walk
              steps
            </span>
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter((prev) =>
              prev === 'guard_error' ? 'all' : 'guard_error'
            )
          }
          className="p-4 rounded-lg border border-slate-800 hover:border-amber-500/50 bg-[#111726] cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Spread Guardrail &amp; Rejections</span>
            <span className="text-[11px] font-mono text-amber-400 underline">
              {statusFilter === 'guard_error' ? 'Show All' : 'Filter Holds'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                portfolioMetrics.paused_or_error_orders > 0
                  ? 'text-amber-400'
                  : 'text-slate-200'
              }`}
            >
              {portfolioMetrics.paused_or_error_orders}
            </span>
            <span className="text-xs font-mono text-slate-400">
              Max spread &le;{config.maxSpreadPctGuardrail.toFixed(1)}%
            </span>
          </div>
        </div>
      </section>

      {/* Filter Bar for Smart Order Execution Ledger */}
      <section
        aria-label="Smart Order Ledger Filters"
        className="p-3.5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Filter Smart Orders by Status"
            className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-md"
          >
            {(
              [
                { id: 'all', label: `All Orders (${realTickets.length})` },
                {
                  id: 'filled',
                  label: `Filled (${portfolioMetrics.filled_orders})`,
                },
                {
                  id: 'working',
                  label: `Walking (${portfolioMetrics.working_orders})`,
                },
                {
                  id: 'guard_error',
                  label: `Guard / Hold (${portfolioMetrics.paused_or_error_orders})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  statusFilter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by Execution Algorithm"
            value={algoFilter}
            onChange={(e) =>
              setAlgoFilter(e.target.value as SmartExecutionAlgoId | 'ALL')
            }
            className="px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200"
          >
            <option value="ALL">All Execution Algorithms</option>
            <option value="adaptive_microprice_walk">
              Adaptive Microprice Walker
            </option>
            <option value="delta_pegged_mid">
              Alpaca Delta-Pegged Fair Value
            </option>
            <option value="uw_flow_urgency_sweep">
              UW Flow-Urgency Adaptive Cross
            </option>
            <option value="liquidity_sniper_twap">
              Wide-Spread Liquidity Sniper
            </option>
          </select>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search Smart Orders"
            placeholder="Search ticker, contract, or algo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500"
          />
        </div>
      </section>

      {/* Master-Detail Split: Smart Order Execution Ledger Table (5 cols) + Order Detail & Bid-Ask Fill Waterfall Graphic (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 5 Cols: Real Smart Order Execution Ledger Table */}
        <section
          aria-label="Smart Order Execution Ledger"
          className="lg:col-span-5 border border-slate-800 bg-[#111726] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Smart Order Execution Ledger
              </h2>
              <p className="text-xs text-slate-400">
                Select any order to visualize its NBBO spread fill waterfall and
                walking steps.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
              {filteredTickets.length} orders
            </span>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-300">
                No smart order tickets match the active filter.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setAlgoFilter('ALL');
                  setSearchQuery('');
                }}
                className="px-3.5 py-2 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[820px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0B0F17] border-b border-slate-800 text-slate-400 whitespace-nowrap">
                  <tr>
                    <th className="py-2.5 px-2.5 font-medium">
                      Contract / Algo
                    </th>
                    <th className="py-2.5 px-2 font-medium">
                      Timestamp
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      NBBO &amp; Spread
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      Fill / Limit
                    </th>
                    <th className="py-2.5 px-2 font-medium text-right">
                      Saved vs Ask
                    </th>
                    <th className="py-2.5 px-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredTickets.map((t) => {
                    const isSelected =
                      t.order_id === selectedTicket?.order_id;
                    const createdTs = formatSmartOrderTimestamp(t.created_at);
                    const updatedTs = formatSmartOrderTimestamp(t.updated_at);
                    return (
                      <tr
                        key={t.order_id}
                        onClick={() => setSelectedTicketId(t.order_id)}
                        aria-selected={isSelected}
                        className={`cursor-pointer transition-colors whitespace-nowrap ${
                          isSelected
                            ? 'bg-sky-950/40 hover:bg-sky-950/50'
                            : t.status === 'spread_guard_paused' ||
                                t.status === 'rejected_error'
                              ? 'bg-amber-950/10 hover:bg-amber-950/20'
                              : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold font-mono text-slate-100">
                              {t.ticker}
                            </span>
                            <span className="font-mono text-slate-300">
                              ${t.strike}
                              {t.option_type === 'call' ? 'C' : 'P'}
                            </span>
                            <span className="text-[11px] font-mono text-sky-400">
                              {t.filled_qty}/{t.requested_qty}x
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate max-w-[145px]">
                            {ALGO_SPECS[t.Algo]?.name ?? t.Algo}
                          </div>
                        </td>

                        <td
                          data-testid="smart-order-row-timestamp"
                          className="py-2.5 px-2 font-mono tabular-nums"
                        >
                          <div className="text-slate-200 text-[11px]">
                            {createdTs.dateStr}
                          </div>
                          <div className="text-[10px] text-sky-300 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                            <span>{createdTs.timeStr}</span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-400">{t.latency_ms}ms</span>
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                          <div className="text-slate-200">
                            ${t.arrival_bid.toFixed(2)}×$
                            {t.arrival_ask.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-amber-400">
                            ${t.arrival_spread_dollars.toFixed(2)} (
                            {t.arrival_spread_pct.toFixed(1)}%)
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                          <div className="font-semibold text-sky-400">
                            $
                            {(
                              t.avg_fill_price ?? t.active_limit_price
                            ).toFixed(2)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Theo ${t.theo_fair_value.toFixed(2)} ·{' '}
                            {t.walk_steps_count} stp
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono tabular-nums">
                          {t.total_dollars_saved > 0 ? (
                            <>
                              <div className="font-semibold text-emerald-400">
                                +${t.total_dollars_saved.toFixed(0)}
                              </div>
                              <div className="text-[10px] text-emerald-400/90">
                                {t.spread_captured_pct.toFixed(0)}% captured
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        <td className="py-2.5 px-2.5">
                          <div>
                            {t.status === 'filled' && (
                              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Filled</span>
                              </span>
                            )}
                            {(t.status === 'working_walking' ||
                              t.status === 'partially_filled') && (
                              <span className="inline-flex items-center gap-1 text-sky-400 font-medium">
                                <Clock className="w-3.5 h-3.5" />
                                <span>
                                  {t.status === 'partially_filled'
                                    ? 'Partial Walk'
                                    : 'Walking'}
                                </span>
                              </span>
                            )}
                            {t.status === 'spread_guard_paused' && (
                              <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                <span>Spread Guard</span>
                              </span>
                            )}
                            {t.status === 'rejected_error' && (
                              <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Rejected</span>
                              </span>
                            )}
                            {t.status === 'cancelled' && (
                              <span className="text-slate-500">Cancelled</span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {updatedTs.timeStr}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right 7 Cols: Selected Order Detail with Embedded Bid-Ask Spread Decomposition & Fill Waterfall Graphic */}
        <aside
          aria-label="Smart Order Ticket Inspector"
          className="lg:col-span-7 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-5"
        >
          {selectedTicket && selectedMicro ? (
            <>
              {/* Order Detail Header + Savings vs Crossing Spread */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                    <span className="font-bold text-slate-100 text-sm">
                      {selectedTicket.ticker}
                    </span>
                    <span>·</span>
                    <span className="text-sky-400">
                      {selectedTicket.option_symbol}
                    </span>
                    <span>·</span>
                    <span>
                      ${selectedTicket.strike}{' '}
                      {selectedTicket.option_type.toUpperCase()} ·{' '}
                      {selectedTicket.dte} DTE
                    </span>
                    <span>·</span>
                    <span className="text-emerald-400 font-semibold">
                      {SIDE_LABELS[selectedTicket.side] ??
                        selectedTicket.side.toUpperCase()}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-slate-100 mt-1">
                    Order Fill Bid-Ask Spread Decomposition &amp; Fair-Value
                    Pricing Waterfall
                  </h2>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Algo:{' '}
                    <strong className="text-slate-200">
                      {ALGO_SPECS[selectedTicket.Algo]?.name ??
                        selectedTicket.Algo}
                    </strong>{' '}
                    · Filled{' '}
                    <strong className="text-sky-400">
                      {selectedTicket.filled_qty}/{selectedTicket.requested_qty}{' '}
                      cts
                    </strong>{' '}
                    @{' '}
                    <strong className="text-emerald-400">
                      ${effectiveFillOrLimit.toFixed(2)}
                    </strong>{' '}
                    · {selectedTicket.walk_steps_count} walk steps ·{' '}
                    {selectedTicket.latency_ms} ms
                  </div>
                </div>

                <div className="text-right font-mono">
                  <div className="text-xs text-slate-400">
                    {selectedTicket.status === 'filled'
                      ? 'Actual Savings vs Crossing Spread'
                      : 'Target Savings vs Crossing Spread'}
                  </div>
                  <div className="text-base font-bold text-emerald-400">
                    +$
                    {(selectedTicket.total_dollars_saved > 0
                      ? selectedTicket.total_dollars_saved
                      : selectedMicro.estimated_savings_per_contract_dollars *
                        selectedTicket.requested_qty
                    ).toLocaleString()}{' '}
                    total (+$
                    {(selectedTicket.price_improvement_per_contract > 0
                      ? selectedTicket.price_improvement_per_contract
                      : selectedMicro.estimated_savings_per_contract_dollars
                    ).toFixed(0)}
                    /ct ·{' '}
                    {(selectedTicket.spread_captured_pct > 0
                      ? selectedTicket.spread_captured_pct
                      : selectedMicro.estimated_spread_capture_pct
                    ).toFixed(1)}
                    % spread captured)
                  </div>
                </div>
              </div>

              {/* Execution Timestamp & Latency Telemetry Strip */}
              {(() => {
                const submittedTs = formatSmartOrderTimestamp(
                  selectedTicket.created_at
                );
                const updatedTs = formatSmartOrderTimestamp(
                  selectedTicket.updated_at
                );
                return (
                  <div
                    data-testid="smart-order-detail-timestamps"
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-md border border-slate-800 bg-[#0B0F17] text-xs font-mono"
                  >
                    <div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-sky-400" />
                        <span>Submitted At (Arrival)</span>
                      </div>
                      <div className="text-slate-100 font-semibold mt-0.5">
                        {submittedTs.fullLabel}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>
                          {selectedTicket.status === 'filled'
                            ? 'Filled At (Completed)'
                            : 'Last Updated At'}
                        </span>
                      </div>
                      <div className="text-emerald-300 font-semibold mt-0.5">
                        {updatedTs.fullLabel}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400">
                        Execution Latency &amp; Cadence
                      </div>
                      <div className="text-sky-300 font-semibold mt-0.5">
                        {selectedTicket.latency_ms} ms ·{' '}
                        {selectedTicket.walk_steps_count} steps
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400">
                        Broker Order ID
                      </div>
                      <div className="text-slate-300 font-semibold mt-0.5 truncate">
                        {selectedTicket.alpaca_broker_order_id}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Interactive Step-Walk Controls for Working / Paused Orders */}
              {selectedTicket.status !== 'filled' &&
                selectedTicket.status !== 'cancelled' && (
                  <div className="p-3 rounded-md border border-sky-500/30 bg-[#0B0F17] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono text-sky-300">
                      Order is currently{' '}
                      <strong>{selectedTicket.status.toUpperCase()}</strong> at
                      limit{' '}
                      <strong>
                        ${selectedTicket.active_limit_price.toFixed(2)}
                      </strong>{' '}
                      ({selectedTicket.filled_qty}/
                      {selectedTicket.requested_qty} cts filled)
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onAdvanceTicket(selectedTicket.order_id, 'step_walk')
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-sky-300 transition-colors"
                      >
                        <FastForward className="w-3.5 h-3.5" />
                        <span>Walk Next Step</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onAdvanceTicket(
                            selectedTicket.order_id,
                            'complete_at_fair_value'
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-300 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Fill @ Fair Value</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          onAdvanceTicket(
                            selectedTicket.order_id,
                            'cancel_order'
                          )
                        }
                        className="px-2 py-1.5 text-xs font-medium rounded border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

              {/* Error / Guardrail Diagnostic Banner */}
              {selectedTicket.error_message && (
                <div className="p-3 rounded-md border border-amber-500/50 bg-amber-950/30 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>
                      Smart Execution Guardrail / Gateway Diagnostic
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-amber-100/90">
                    {selectedTicket.error_message}
                  </p>
                </div>
              )}

              {/* Embedded Graphic: Visual NBBO Spread Ruler & Order Fill Waterfall */}
              <div
                data-testid="order-detail-spread-waterfall-graphic"
                className="p-4 rounded-lg border border-slate-800 bg-[#0B0F17] space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div>
                    <span className="text-emerald-400 font-semibold">
                      NBBO BID: ${selectedTicket.arrival_bid.toFixed(2)}
                    </span>
                    <span className="text-slate-400 ml-2">
                      ({selectedMicro.bid_size} cts)
                    </span>
                  </div>
                  <div className="text-slate-300">
                    Spread:{' '}
                    <strong className="text-amber-400">
                      ${selectedTicket.arrival_spread_dollars.toFixed(2)} (
                      {selectedTicket.arrival_spread_pct.toFixed(2)}%)
                    </strong>{' '}
                    · Mid: ${selectedTicket.arrival_mid.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-rose-400 font-semibold">
                      NBBO ASK: ${selectedTicket.arrival_ask.toFixed(2)}
                    </span>
                    <span className="text-slate-400 ml-2">
                      ({selectedMicro.ask_size} cts)
                    </span>
                  </div>
                </div>

                {/* Horizontal Spread Spectrum Bar showing Exact Fill & Walk Steps */}
                <div className="relative h-9 rounded-md bg-slate-900 border border-slate-800 overflow-hidden">
                  {/* Favorable Sub-Cap Execution Zone */}
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/20 via-sky-500/25 to-amber-500/20"
                    style={{
                      width: `${getSpreadPositionPct(
                        selectedTicket.reservation_cap_price,
                        selectedTicket.arrival_bid,
                        selectedTicket.arrival_ask
                      )}%`,
                    }}
                  />

                  {/* Midpoint Marker */}
                  <div
                    title={`NBBO Midpoint: $${selectedTicket.arrival_mid.toFixed(2)}`}
                    className="absolute inset-y-0 w-0.5 bg-slate-500"
                    style={{ left: '50%' }}
                  />

                  {/* Step 1 Initial Passive Peg Marker */}
                  <div
                    title={`1. Passive Anchor (Step 1): $${selectedTicket.initial_limit_price.toFixed(2)}`}
                    className="absolute inset-y-0 w-1 bg-emerald-400"
                    style={{
                      left: `${getSpreadPositionPct(
                        selectedTicket.initial_limit_price,
                        selectedTicket.arrival_bid,
                        selectedTicket.arrival_ask
                      )}%`,
                    }}
                  />

                  {/* Walk Step Intermediate Markers */}
                  {selectedTicket.walk_ladder.map((step) => {
                    const stepTs = formatSmartOrderTimestamp(step.timestamp);
                    return (
                      <div
                        key={step.step_index}
                        title={`Step ${step.step_index} (${step.action}) @ ${stepTs.fullLabel}: Limit $${step.limit_price_submitted.toFixed(2)} · Filled ${step.filled_qty} cts`}
                        className="absolute top-1.5 bottom-1.5 w-1 rounded-full bg-sky-300/70"
                        style={{
                          left: `${getSpreadPositionPct(
                            step.limit_price_submitted,
                            selectedTicket.arrival_bid,
                            selectedTicket.arrival_ask
                          )}%`,
                        }}
                      />
                    );
                  })}

                  {/* Alpaca Delta-Gamma Theoretical Fair Value Marker */}
                  <div
                    title={`3. Alpaca Δ/Γ Theo Fair Value: $${selectedTicket.theo_fair_value.toFixed(2)}`}
                    className="absolute inset-y-0 w-1 bg-purple-400"
                    style={{
                      left: `${getSpreadPositionPct(
                        selectedTicket.theo_fair_value,
                        selectedTicket.arrival_bid,
                        selectedTicket.arrival_ask
                      )}%`,
                    }}
                  />

                  {/* Actual Avg Fill / Active Limit Marker */}
                  <div
                    title={`4. ${selectedTicket.avg_fill_price !== null ? 'Actual Avg Fill' : 'Active Limit'}: $${effectiveFillOrLimit.toFixed(2)}`}
                    className="absolute inset-y-0 w-1.5 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)]"
                    style={{
                      left: `${getSpreadPositionPct(
                        effectiveFillOrLimit,
                        selectedTicket.arrival_bid,
                        selectedTicket.arrival_ask
                      )}%`,
                    }}
                  />

                  {/* Hard Reservation Cap Marker */}
                  <div
                    title={`5. Hard Reservation Cap: $${selectedTicket.reservation_cap_price.toFixed(2)}`}
                    className="absolute inset-y-0 w-1 bg-amber-400"
                    style={{
                      left: `${getSpreadPositionPct(
                        selectedTicket.reservation_cap_price,
                        selectedTicket.arrival_bid,
                        selectedTicket.arrival_ask
                      )}%`,
                    }}
                  />
                </div>

                {/* 5-Stage Order Fill & Pricing Waterfall Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs font-mono">
                  <div className="p-2.5 rounded border border-emerald-500/30 bg-emerald-950/15">
                    <div className="text-[10px] text-emerald-400">
                      1. Passive Anchor
                    </div>
                    <div className="text-sm font-bold text-slate-100 mt-0.5">
                      ${selectedTicket.initial_limit_price.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Step 1 Limit
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-slate-800 bg-[#111726]">
                    <div className="text-[10px] text-slate-400">
                      2. Stoikov Micro
                    </div>
                    <div className="text-sm font-bold text-slate-100 mt-0.5">
                      ${selectedMicro.microprice.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Imb: {selectedMicro.book_imbalance >= 0 ? '+' : ''}
                      {selectedMicro.book_imbalance.toFixed(2)}
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-purple-500/30 bg-purple-950/15">
                    <div className="text-[10px] text-purple-300">
                      3. Alpaca Δ/Γ Theo
                    </div>
                    <div className="text-sm font-bold text-slate-100 mt-0.5">
                      ${selectedTicket.theo_fair_value.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Δ={selectedMicro.delta.toFixed(2)} · Γ=
                      {selectedMicro.gamma.toFixed(3)}
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-sky-400/50 bg-sky-950/25">
                    <div className="text-[10px] text-sky-300 font-semibold">
                      {selectedTicket.avg_fill_price !== null
                        ? '4. Actual Avg Fill'
                        : '4. Smart Target Fill'}
                    </div>
                    <div className="text-sm font-bold text-sky-400 mt-0.5">
                      ${effectiveFillOrLimit.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-emerald-400">
                      Saves $
                      {(selectedTicket.price_improvement_per_contract > 0
                        ? selectedTicket.price_improvement_per_contract
                        : selectedMicro.estimated_savings_per_contract_dollars
                      ).toFixed(0)}
                      /ct
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-amber-500/30 bg-amber-950/15">
                    <div className="text-[10px] text-amber-300">
                      5. Reservation Cap
                    </div>
                    <div className="text-sm font-bold text-slate-100 mt-0.5">
                      ${selectedTicket.reservation_cap_price.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Max {(config.maxSpreadCrossFraction * 100).toFixed(0)}%
                      cross
                    </div>
                  </div>
                </div>
              </div>

              {/* Dual Live Feed Telemetry for this Order: Alpaca Underlying + Unusual Whales Flow */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-lg border border-slate-800 bg-[#0B0F17] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Alpaca Live Underlying Stock Feed</span>
                    </span>
                    <span className="font-mono text-[11px] text-emerald-400">
                      {selectedMicro.alpaca_data_source}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
                    <div>
                      <div className="text-[10px] text-slate-400">
                        Spot / Δ Tick
                      </div>
                      <div className="text-slate-100 font-semibold">
                        ${selectedMicro.alpaca_underlying_spot.toFixed(2)}{' '}
                        <span
                          className={
                            selectedMicro.alpaca_spot_tick_delta >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          ({selectedMicro.alpaca_spot_tick_delta >= 0 ? '+' : ''}
                          {selectedMicro.alpaca_spot_tick_delta.toFixed(2)})
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400">
                        Session VWAP
                      </div>
                      <div className="text-slate-100 font-semibold">
                        ${selectedMicro.alpaca_vwap.toFixed(2)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400">
                        5m RVOL / ATR
                      </div>
                      <div className="text-slate-100 font-semibold">
                        {selectedMicro.alpaca_rvol_5m.toFixed(2)}x · $
                        {selectedMicro.alpaca_atr_5m.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-slate-800 bg-[#0B0F17] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-sky-400" />
                      <span>Unusual Whales Flow Urgency Signal</span>
                    </span>
                    <span className="font-mono text-[11px] text-sky-400">
                      Urgency {selectedMicro.flow_urgency_score}/100
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1">
                    <div>
                      <div className="text-[10px] text-slate-400">
                        Sweep / Side %
                      </div>
                      <div className="text-slate-100 font-semibold">
                        {Math.round(selectedMicro.uw_sweep_ratio * 100)}% swp ·{' '}
                        {Math.round(selectedMicro.uw_side_share * 100)}%
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400">
                        Burst Z / Vol:OI
                      </div>
                      <div className="text-slate-100 font-semibold">
                        z={selectedMicro.uw_burst_zscore.toFixed(1)} ·{' '}
                        {selectedMicro.uw_vol_oi_ratio.toFixed(1)}x
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-400">
                        5m Prem / Tide
                      </div>
                      <div className="text-slate-100 font-semibold">
                        ${(selectedMicro.uw_premium_5m / 1000).toFixed(0)}K ·{' '}
                        {selectedMicro.uw_whale_score}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Inspector View Selector Tabs (Price-Walking Fill Ladder + Payloads) */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-2 pt-1">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      {
                        id: 'ladder',
                        label: `Step-by-Step Fill & Price-Walk Ladder (${selectedTicket.walk_ladder.length})`,
                      },
                      { id: 'input_json', label: 'Order Input Payload' },
                      { id: 'output_json', label: 'Execution Output JSON' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setInspectorTab(t.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        inspectorTab === t.id
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {inspectorTab !== 'ladder' && (
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        inspectorTab,
                        inspectorTab === 'input_json'
                          ? selectedTicket.input_payload_json
                          : selectedTicket.output_payload_json
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-mono text-sky-400 hover:text-sky-300"
                  >
                    {copiedKey === inspectorTab ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Tab 1: Step-by-Step Price-Walking & Delta Re-Pegging Timeline */}
              {inspectorTab === 'ladder' && (
                <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                  {selectedTicket.walk_ladder.map((step) => {
                    const fillPct = Math.min(
                      100,
                      Math.round(
                        (step.cumulative_filled_qty /
                          Math.max(1, selectedTicket.requested_qty)) *
                          100
                      )
                    );
                    const stepTs = formatSmartOrderTimestamp(step.timestamp);
                    const elapsedMs = computeStepElapsedMs(
                      selectedTicket.created_at,
                      step.timestamp,
                      step.step_index
                    );
                    return (
                      <div
                        key={step.step_index}
                        className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sky-400">
                              Step {step.step_index}: {step.action}
                            </span>
                            <span
                              data-testid="smart-order-step-timestamp"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-slate-800/90 border border-slate-700 text-slate-300"
                            >
                              <Clock className="w-2.5 h-2.5 text-sky-400" />
                              <span>{stepTs.fullLabel}</span>
                              <span className="text-sky-400">
                                (+{elapsedMs}ms)
                              </span>
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-300">
                              Limit{' '}
                              <strong className="text-slate-100">
                                ${step.limit_price_submitted.toFixed(2)}
                              </strong>
                            </span>
                            {step.filled_qty > 0 && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                                +{step.filled_qty} cts filled @ $
                                {step.limit_price_submitted.toFixed(2)}
                              </span>
                            )}
                          </div>
                          <span
                            className={`font-semibold ${
                              step.status === 'Filled'
                                ? 'text-emerald-400'
                                : step.status === 'Paused (Wide Spread)'
                                  ? 'text-amber-400'
                                  : 'text-sky-400'
                            }`}
                          >
                            {step.status} ({step.cumulative_filled_qty}/
                            {selectedTicket.requested_qty} cts · {fillPct}%)
                          </span>
                        </div>

                        <div className="text-[11px] font-mono text-slate-400">
                          Alpaca Spot ${step.underlying_spot.toFixed(2)} · NBBO
                          ${step.nbbo_bid.toFixed(2)}×$
                          {step.nbbo_ask.toFixed(2)} · Theo Fair Value $
                          {step.theo_fair_value.toFixed(2)}
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed">
                          {step.rationale}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tab 2: Order Input Payload JSON */}
              {inspectorTab === 'input_json' && (
                <pre className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] text-[11px] font-mono text-slate-200 overflow-x-auto max-h-[360px] overflow-y-auto">
                  {selectedTicket.input_payload_json}
                </pre>
              )}

              {/* Tab 3: Execution Output JSON */}
              {inspectorTab === 'output_json' && (
                <pre className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] text-[11px] font-mono text-slate-200 overflow-x-auto max-h-[360px] overflow-y-auto">
                  {selectedTicket.output_payload_json}
                </pre>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-sm text-slate-400">
              Select a Smart Order ticket from the ledger to inspect its
              bid-ask spread fill waterfall and price-walking steps.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
