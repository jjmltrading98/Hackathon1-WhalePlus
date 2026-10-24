import React, { useMemo, useState } from 'react';
import {
  type StrategyRegimeId,
  evaluateRegimeWhaleStrategyPipeline,
} from '../engine/regimeWhaleStrategyEngine';
import type { WhaleCandidate } from '../engine/whaleScannerEngine';
import type { MarketTideState } from '../engine/whalePipelineRuntime';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Check,
  CheckCircle2,
  Copy,
  Crosshair,
  Database,
  Filter,
  Layers,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  TrendingDown,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';

interface RegimeStrategyViewProps {
  marketTide: MarketTideState;
  candidates: WhaleCandidate[];
  syncingAlpaca: boolean;
  onSyncAlpaca: () => Promise<void>;
  onStageSmartOrderOnCandidate: (candidate: WhaleCandidate) => void;
  onRunAiAnalysisOnCandidate: (candidate: WhaleCandidate) => void;
  onInspectCandidateInScanner: (candidateId: string) => void;
  onOpenLlmDecisionGate?: (candidate: WhaleCandidate) => void;
}

const REGIME_CARDS: Record<
  StrategyRegimeId,
  {
    name: string;
    tideBadge: string;
    posture: string;
    accentBorder: string;
    accentText: string;
    accentBg: string;
  }
> = {
  bull_expansion: {
    name: 'Bull Expansion',
    tideBadge: 'Bullish Tide + Weak/Breakout GEX',
    posture: 'Favor Call Momentum (7–45 DTE)',
    accentBorder: 'border-emerald-500/50',
    accentText: 'text-emerald-400',
    accentBg: 'bg-emerald-950/25',
  },
  bear_expansion: {
    name: 'Bear Expansion',
    tideBadge: 'Bearish Tide + Negative GEX Break',
    posture: 'Favor Put Momentum (7–45 DTE)',
    accentBorder: 'border-rose-500/50',
    accentText: 'text-rose-400',
    accentBg: 'bg-rose-950/25',
  },
  pinned_range: {
    name: 'Pinned / Range',
    tideBadge: 'Mixed Tide + Heavy Positive SPX GEX',
    posture: 'Mean Reversion & Defined-Risk Spreads',
    accentBorder: 'border-amber-500/50',
    accentText: 'text-amber-400',
    accentBg: 'bg-amber-950/25',
  },
  conflict: {
    name: 'Conflict (Tide vs GEX)',
    tideBadge: 'Tide & GEX Disagree / Stuck at Flip',
    posture: 'Reduce Trades · Demand Strong Confirmation',
    accentBorder: 'border-purple-500/50',
    accentText: 'text-purple-300',
    accentBg: 'bg-purple-950/25',
  },
};

export const RegimeStrategyView: React.FC<RegimeStrategyViewProps> = ({
  marketTide,
  candidates,
  syncingAlpaca,
  onSyncAlpaca,
  onStageSmartOrderOnCandidate,
  onRunAiAnalysisOnCandidate,
  onInspectCandidateInScanner,
  onOpenLlmDecisionGate,
}) => {
  const [overrideRegime, setOverrideRegime] = useState<
    StrategyRegimeId | undefined
  >(undefined);
  const [perTradeMaxRisk, setPerTradeMaxRisk] = useState<number>(2500);
  const [maxDailyLoss, setMaxDailyLoss] = useState<number>(7500);
  const [screenerFilterMode, setScreenerFilterMode] = useState<
    'passed' | 'all'
  >('all');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(
    candidates[0]?.candidate_id ?? ''
  );
  const [detailTab, setDetailTab] = useState<
    'flow_score' | 'alpaca_audit' | 'hierarchy_streams'
  >('flow_score');
  const [copiedTapeJson, setCopiedTapeJson] = useState(false);

  const strategyOutput = useMemo(
    () =>
      evaluateRegimeWhaleStrategyPipeline({
        marketTide,
        candidates,
        overrideRegime,
        perTradeMaxRiskDollars: perTradeMaxRisk,
        maxDailyLossDollars: maxDailyLoss,
      }),
    [marketTide, candidates, overrideRegime, perTradeMaxRisk, maxDailyLoss]
  );

  const {
    regime_classification,
    screener_spec,
    tape_filter_json,
    evaluated_candidates,
    streaming_subscriptions,
    core_guardrails,
  } = strategyOutput;

  const activeEval = useMemo(() => {
    return (
      evaluated_candidates.find(
        (c) => c.candidate_id === selectedCandidateId
      ) ??
      evaluated_candidates[0] ??
      null
    );
  }, [evaluated_candidates, selectedCandidateId]);

  const activeRawCandidate = useMemo(() => {
    if (!activeEval) return null;
    return (
      candidates.find((c) => c.candidate_id === activeEval.candidate_id) ?? null
    );
  }, [candidates, activeEval]);

  const displayedScreenerRows = useMemo(() => {
    if (screenerFilterMode === 'passed') {
      return screener_spec.rows.filter((r) => r.passed_regime_screen);
    }
    return screener_spec.rows;
  }, [screener_spec.rows, screenerFilterMode]);

  const handleCopyTapeJson = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(tape_filter_json, null, 2)
      );
      setCopiedTapeJson(true);
      setTimeout(() => setCopiedTapeJson(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const alertedCount = evaluated_candidates.filter(
    (c) => c.alerted_for_human_review
  ).length;

  return (
    <div className="space-y-6">
      {/* Page Header & Control Loop Banner */}
      <header className="p-5 rounded-lg border border-slate-800 bg-[#111726] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" />
            <h1 className="text-base font-bold tracking-tight text-slate-100">
              Strategy: Regime-Aware Whale Flow Scanner (Market Tide + SPX
              Periscope/GEX + Alpaca Confirmation)
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-4xl">
            Research &amp; ranking architecture that determines broad market
            regime every 1–5 minutes, adapts the stock universe screener,
            scores live whale options tape on a 14-factor{' '}
            <span className="text-slate-200 font-mono">FlowScore</span>, and
            validates intraday price action with Alpaca before human review.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setOverrideRegime(undefined)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              overrideRegime === undefined
                ? 'border-sky-400 bg-sky-500/20 text-sky-300'
                : 'border-slate-700 bg-[#0B0F17] text-slate-300 hover:text-slate-100'
            }`}
          >
            Auto-Classify from Live Tide
          </button>

          <button
            type="button"
            onClick={onSyncAlpaca}
            disabled={syncingAlpaca}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-sky-400 ${
                syncingAlpaca ? 'animate-spin' : ''
              }`}
            />
            <span>
              {syncingAlpaca
                ? 'Syncing Alpaca...'
                : 'Sync Alpaca Confirmation'}
            </span>
          </button>
        </div>
      </header>

      {/* Step 1: Regime Classifier & 4-Posture Selector Strip */}
      <section
        aria-label="Step 1 Market Regime Classifier"
        className="p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Step 1: Determine Market Regime Every 1–5 Minutes (Market Tide
              Slopes + SPX Periscope/GEX)
            </h2>
            <p className="text-xs text-slate-400">
              Market regime decides whether to be aggressive (Bull/Bear
              Expansion), mean-reverting (Pinned/Range), or defensive (Conflict).
            </p>
          </div>
          <div className="text-xs font-mono text-slate-300">
            Active Posture:{' '}
            <strong className="text-sky-400">
              {regime_classification.label}
            </strong>{' '}
            · Review Threshold{' '}
            <strong className="text-emerald-400">
              FlowScore &ge; {regime_classification.review_threshold}
            </strong>
          </div>
        </div>

        {/* 4 Strategy Regime Posture Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.keys(REGIME_CARDS) as StrategyRegimeId[]).map((regId) => {
            const meta = REGIME_CARDS[regId];
            const isActive = regime_classification.regime === regId;
            return (
              <button
                key={regId}
                type="button"
                onClick={() => setOverrideRegime(regId)}
                className={`text-left p-3.5 rounded-lg border transition-colors ${
                  isActive
                    ? `${meta.accentBorder} ${meta.accentBg}`
                    : 'border-slate-800 bg-[#0B0F17] hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-100">
                    {meta.name}
                  </span>
                  {isActive && (
                    <span
                      className={`text-[10px] font-mono font-semibold ${meta.accentText}`}
                    >
                      ACTIVE
                    </span>
                  )}
                </div>
                <div
                  className={`text-[11px] font-mono mt-1 ${meta.accentText}`}
                >
                  {meta.tideBadge}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {meta.posture}
                </p>
              </button>
            );
          })}
        </div>

        {/* Market Tide Slopes (5 cols) + SPX Periscope / GEX Strike Profile (7 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Market Tide Short-Window Slopes */}
          <div className="lg:col-span-5 p-4 rounded-lg border border-slate-800 bg-[#0B0F17] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                <span>Market Tide 5m &amp; 15m Slopes</span>
              </span>
              <span
                className={`text-xs font-mono font-bold ${
                  regime_classification.tide === 'Bullish'
                    ? 'text-emerald-400'
                    : regime_classification.tide === 'Bearish'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                }`}
              >
                {regime_classification.tide.toUpperCase()} TIDE
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-xs font-mono">
              <div className="p-2.5 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  call_tide_slope (5m)
                </div>
                <div
                  className={`text-sm font-bold mt-0.5 ${
                    regime_classification.tide_slopes.call_tide_slope_5m_m >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {regime_classification.tide_slopes.call_tide_slope_5m_m >= 0
                    ? '+'
                    : ''}
                  $
                  {regime_classification.tide_slopes.call_tide_slope_5m_m.toFixed(
                    1
                  )}
                  M
                </div>
                <div className="text-[10px] text-slate-400">
                  15m:{' '}
                  {regime_classification.tide_slopes.call_tide_slope_15m_m >= 0
                    ? '+'
                    : ''}
                  $
                  {regime_classification.tide_slopes.call_tide_slope_15m_m.toFixed(
                    1
                  )}
                  M
                </div>
              </div>

              <div className="p-2.5 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  put_tide_slope (5m)
                </div>
                <div
                  className={`text-sm font-bold mt-0.5 ${
                    regime_classification.tide_slopes.put_tide_slope_5m_m <= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {regime_classification.tide_slopes.put_tide_slope_5m_m >= 0
                    ? '+'
                    : ''}
                  $
                  {regime_classification.tide_slopes.put_tide_slope_5m_m.toFixed(
                    1
                  )}
                  M
                </div>
                <div className="text-[10px] text-slate-400">
                  15m:{' '}
                  {regime_classification.tide_slopes.put_tide_slope_15m_m >= 0
                    ? '+'
                    : ''}
                  $
                  {regime_classification.tide_slopes.put_tide_slope_15m_m.toFixed(
                    1
                  )}
                  M
                </div>
              </div>

              <div className="p-2.5 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  net_volume_slope
                </div>
                <div className="text-sm font-bold text-sky-400 mt-0.5">
                  {regime_classification.tide_slopes.net_volume_slope_5m_m >= 0
                    ? '+'
                    : ''}
                  {regime_classification.tide_slopes.net_volume_slope_5m_m.toFixed(
                    2
                  )}
                  M
                </div>
                <div className="text-[10px] text-slate-400">
                  15m:{' '}
                  {regime_classification.tide_slopes.net_volume_slope_15m_m >= 0
                    ? '+'
                    : ''}
                  {regime_classification.tide_slopes.net_volume_slope_15m_m.toFixed(
                    2
                  )}
                  M
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {regime_classification.tide_slopes.summary}
            </p>
            <div className="text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/80">
              Note: Market Tide ignores mid-market transactions; treated as a
              directional context measure, not total positioning.
            </div>
          </div>

          {/* SPX Periscope / GEX Exposure by Strike */}
          <div className="lg:col-span-7 p-4 rounded-lg border border-slate-800 bg-[#0B0F17] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  SPX Periscope / GEX Strike Profile (gex:SPX &amp;
                  gex_strike:SPX)
                </span>
                <span
                  className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded border ${
                    regime_classification.spx_periscope.gamma_explosive
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {regime_classification.spx_periscope.gamma_explosive
                    ? 'GAMMA EXPLOSIVE: YES'
                    : 'GAMMA EXPLOSIVE: NO'}
                </span>
              </div>

              <span className="text-[11px] font-mono text-amber-400">
                Guardrail: SPX {regime_classification.spx_periscope.spx_spot.toFixed(1)} ≠ SPY{' '}
                ${regime_classification.spx_periscope.spy_spot_proxy.toFixed(2)} (Proxy Only)
              </span>
            </div>

            {/* SPX Key GEX Levels Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
              <div className="p-2 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">SPX Index Spot</div>
                <div className="text-slate-100 font-bold">
                  {regime_classification.spx_periscope.spx_spot.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400">
                  Flip Δ{' '}
                  {regime_classification.spx_periscope.distance_to_flip_pts >= 0
                    ? '+'
                    : ''}
                  {regime_classification.spx_periscope.distance_to_flip_pts} pts
                </div>
              </div>

              <div className="p-2 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">SPX Gamma Flip</div>
                <div className="text-amber-400 font-bold">
                  {regime_classification.spx_periscope.spx_gamma_flip}
                </div>
                <div className="text-[10px] text-slate-400">
                  Zero-GEX boundary
                </div>
              </div>

              <div className="p-2 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  Call Wall / Put Wall
                </div>
                <div className="text-slate-100 font-bold">
                  {regime_classification.spx_periscope.spx_call_wall} /{' '}
                  {regime_classification.spx_periscope.spx_put_wall}
                </div>
                <div className="text-[10px] text-slate-400">
                  Magnet {regime_classification.spx_periscope.spx_gamma_magnet}
                </div>
              </div>

              <div className="p-2 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  Aggregate SPX GEX
                </div>
                <div
                  className={`font-bold ${
                    regime_classification.spx_periscope.spx_net_gamma_gex_m >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {regime_classification.spx_periscope.spx_net_gamma_gex_m >= 0
                    ? '+'
                    : ''}
                  ${regime_classification.spx_periscope.spx_net_gamma_gex_m}M
                </div>
                <div className="text-[10px] text-slate-400">
                  Net index exposure
                </div>
              </div>

              <div className="p-2 rounded border border-slate-800 bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  1m / 5m GEX Δ
                </div>
                <div className="text-sky-400 font-bold">
                  {regime_classification.spx_periscope.gex_change_1m_m >= 0
                    ? '+'
                    : ''}
                  {regime_classification.spx_periscope.gex_change_1m_m}M
                </div>
                <div className="text-[10px] text-slate-400">
                  5m:{' '}
                  {regime_classification.spx_periscope.gex_change_5m_m >= 0
                    ? '+'
                    : ''}
                  {regime_classification.spx_periscope.gex_change_5m_m}M
                </div>
              </div>
            </div>

            {/* Periscope Strike Bars */}
            <div className="grid grid-cols-6 gap-2 pt-1">
              {regime_classification.spx_periscope.strike_profile.map((bar, idx) => {
                const isPos = bar.net_gamma_m >= 0;
                const widthPct = Math.min(
                  100,
                  Math.max(15, Math.round((Math.abs(bar.net_gamma_m) / 900) * 100))
                );
                return (
                  <div
                    key={`${bar.strike}-${bar.role}-${idx}`}
                    className="p-2 rounded border border-slate-800/90 bg-[#111726] text-[11px] font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200">
                        {bar.strike}
                      </span>
                      <span
                        className={
                          isPos ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {isPos ? '+' : ''}
                        {bar.net_gamma_m}M
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-900 rounded overflow-hidden">
                      <div
                        className={`h-full ${
                          isPos ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {bar.role.replace(/_/g, ' ')}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-slate-300">
              {regime_classification.spx_periscope.gamma_explosive_rationale}
            </p>
          </div>
        </div>
      </section>

      {/* Step 2: Regime-Driven Stock Screener & Step 3A: Live Whale Tape Inclusion Filter */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Step 2: Stock Universe Screener (7 cols) */}
        <section
          aria-label="Step 2 Regime Stock Screener"
          className="lg:col-span-7 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Step 2: Regime-Adaptive Stock Screener ({screener_spec.title})
              </h2>
              <p className="text-xs text-slate-400">
                Narrows universe via{' '}
                <code className="text-sky-400 font-mono">
                  {screener_spec.endpoint}
                </code>{' '}
                &amp;{' '}
                <code className="text-sky-400 font-mono">
                  {screener_spec.websocket_channel}
                </code>{' '}
                stream (capped at &le;{screener_spec.universe_cap_limit} liquid
                names).
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#0B0F17] rounded-md text-xs">
              <button
                type="button"
                onClick={() => setScreenerFilterMode('all')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  screenerFilterMode === 'all'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Universe ({screener_spec.rows.length})
              </button>
              <button
                type="button"
                onClick={() => setScreenerFilterMode('passed')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  screenerFilterMode === 'passed'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Passed Regime Screen ({screener_spec.passed_tickers.length})
              </button>
            </div>
          </div>

          {/* Active SQL WHERE Query Box */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17]">
              <div className="text-[11px] font-mono text-sky-400 mb-1">
                Active Screener Query ({regime_classification.label}):
              </div>
              <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap leading-relaxed">
                {screener_spec.sql_where_clause}
              </pre>
            </div>

            <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-1.5">
              <div className="text-[11px] font-mono text-slate-300">
                Additional Regime Preferences:
              </div>
              <ul className="space-y-1 text-[11px] text-slate-400">
                {screener_spec.additional_preferences.map((pref) => (
                  <li key={pref} className="flex items-start gap-1.5">
                    <span className="text-sky-400">•</span>
                    <span>{pref}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Stock Screener Evaluation Table */}
          <div className="overflow-x-auto max-h-[320px] overflow-y-auto border border-slate-800 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B0F17] border-b border-slate-800 text-slate-400 whitespace-nowrap">
                <tr>
                  <th className="py-2 px-2 font-medium">Ticker</th>
                  <th className="py-2 px-1.5 font-medium text-right">
                    Price / EMA
                  </th>
                  <th className="py-2 px-1.5 font-medium text-right">
                    Call / Put Vol
                  </th>
                  <th className="py-2 px-1.5 font-medium text-right">
                    Net Call/Put
                  </th>
                  <th className="py-2 px-1.5 font-medium text-right">
                    OI / IVR
                  </th>
                  <th className="py-2 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono">
                {displayedScreenerRows.map((r) => (
                  <tr
                    key={r.ticker}
                    className={`whitespace-nowrap ${
                      r.passed_regime_screen
                        ? 'hover:bg-slate-800/40'
                        : 'opacity-60 bg-slate-950/40'
                    }`}
                  >
                    <td className="py-2 px-2">
                      <div className="font-bold text-slate-100">{r.ticker}</div>
                      <div className="text-[10px] text-slate-400 font-sans">
                        {r.volume_vs_30d_ratio.toFixed(2)}x 30d vol
                      </div>
                    </td>
                    <td className="py-2 px-1.5 text-right tabular-nums">
                      <div
                        className={
                          r.change_pct >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        ${r.price.toFixed(2)} ({r.change_pct >= 0 ? '+' : ''}
                        {r.change_pct.toFixed(1)}%)
                      </div>
                      <div className="text-[10px] text-slate-400">
                        E20 ${r.ema_20.toFixed(0)} · E50 ${r.ema_50.toFixed(0)}
                      </div>
                    </td>
                    <td className="py-2 px-1.5 text-right tabular-nums">
                      <div className="text-slate-200">
                        {(r.call_volume / 1000).toFixed(0)}K /{' '}
                        {(r.put_volume / 1000).toFixed(0)}K
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Earn: {r.days_to_earnings}d
                      </div>
                    </td>
                    <td className="py-2 px-1.5 text-right tabular-nums">
                      <div className="text-emerald-400">
                        C: {r.net_call_premium >= 0 ? '+' : ''}$
                        {(r.net_call_premium / 1_000_000).toFixed(1)}M
                      </div>
                      <div className="text-[10px] text-rose-400">
                        P: {r.net_put_premium >= 0 ? '+' : ''}$
                        {(r.net_put_premium / 1_000_000).toFixed(1)}M
                      </div>
                    </td>
                    <td className="py-2 px-1.5 text-right tabular-nums">
                      <div className="text-slate-200">
                        {(r.total_option_open_interest / 1_000_000).toFixed(2)}M
                      </div>
                      <div className="text-[10px] text-slate-400">
                        IVR {r.iv_rank}%
                      </div>
                    </td>
                    <td className="py-2 px-2 font-sans">
                      {r.passed_regime_screen ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Passed</span>
                        </span>
                      ) : (
                        <span
                          title={r.screen_reasons.join('; ')}
                          className="inline-flex items-center gap-1 text-slate-500"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[95px]">
                            {r.screen_reasons[0]}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Step 3A: Live Whale Tape Inclusion Filter & Risk Gate Config (5 cols) */}
        <section
          aria-label="Step 3 Live Whale Tape Filter"
          className="lg:col-span-5 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Step 3: Live Whale Tape Inclusion Filter
              </h2>
              <p className="text-xs text-slate-400">
                Streams{' '}
                <code className="text-sky-400 font-mono">option_trades</code>{' '}
                &amp;{' '}
                <code className="text-sky-400 font-mono">flow-alerts</code> for
                the {screener_spec.passed_tickers.length} regime-qualified
                tickers.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyTapeJson}
              className="inline-flex items-center gap-1 text-xs font-mono text-sky-400 hover:text-sky-300"
            >
              {copiedTapeJson ? (
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
          </div>

          <pre className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] text-[11px] font-mono text-sky-300 overflow-x-auto leading-relaxed">
            {JSON.stringify(tape_filter_json, null, 2)}
          </pre>

          {/* Pre-Trade Risk Guardrail Inputs (Core Guardrail #5) */}
          <div className="p-3.5 rounded-md border border-slate-800 bg-[#0B0F17] space-y-3">
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Human Review Risk Guardrails (Defined Before Any Order)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="strategy-per-trade-risk"
                  className="block text-[11px] text-slate-400"
                >
                  Per-Trade Max Risk ($)
                </label>
                <input
                  id="strategy-per-trade-risk"
                  type="number"
                  step="250"
                  min={250}
                  max={100000}
                  value={perTradeMaxRisk}
                  onChange={(e) =>
                    setPerTradeMaxRisk(Math.max(250, Number(e.target.value) || 2500))
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#111726] border border-slate-800 rounded text-slate-100"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="strategy-max-daily-loss"
                  className="block text-[11px] text-slate-400"
                >
                  Max Daily Loss Limit ($)
                </label>
                <input
                  id="strategy-max-daily-loss"
                  type="number"
                  step="500"
                  min={500}
                  max={250000}
                  value={maxDailyLoss}
                  onChange={(e) =>
                    setMaxDailyLoss(Math.max(500, Number(e.target.value) || 7500))
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#111726] border border-slate-800 rounded text-slate-100"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Step 3B, Step 4 & Step 5: Master-Detail Ranked Candidates (FlowScore + Alpaca Confirmation + Contract Selection) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 6 Cols: Ranked Contracts Table */}
        <section
          aria-label="Ranked Whale Candidates by Model Inputs"
          className="lg:col-span-6 border border-slate-800 bg-[#111726] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Highest-Ranked Contracts by Current Model Inputs
              </h2>
              <p className="text-xs text-slate-400">
                Ranked by 14-factor{' '}
                <span className="font-mono text-slate-200">FlowScore</span>,
                Alpaca confirmation, and contract liquidity — never by raw
                print size alone.
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-400 whitespace-nowrap">
              {alertedCount}/{evaluated_candidates.length} Pass Review Gate
            </span>
          </div>

          <div className="overflow-x-auto max-h-[680px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B0F17] border-b border-slate-800 text-slate-400 whitespace-nowrap">
                <tr>
                  <th className="py-2.5 px-2 font-medium">Rank / Contract</th>
                  <th className="py-2.5 px-1.5 font-medium text-right">
                    FlowScore
                  </th>
                  <th className="py-2.5 px-1.5 font-medium">Alpaca Tape</th>
                  <th className="py-2.5 px-1.5 font-medium">Expression</th>
                  <th className="py-2.5 px-2 font-medium">Review Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {evaluated_candidates.map((ev) => {
                  const isSelected =
                    ev.candidate_id === activeEval?.candidate_id;
                  return (
                    <tr
                      key={ev.candidate_id}
                      onClick={() => setSelectedCandidateId(ev.candidate_id)}
                      aria-selected={isSelected}
                      className={`cursor-pointer transition-colors whitespace-nowrap ${
                        isSelected
                          ? 'bg-sky-950/40 hover:bg-sky-950/50'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-2 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sky-400 font-bold">
                            #{ev.Rank}
                          </span>
                          <span className="font-bold text-slate-100">
                            {ev.ticker}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            {ev.option_symbol}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-sans">
                          {ev.contract_selection.moneyness_label} · Sprd{' '}
                          {ev.risk_guardrails.nbbo_spread_pct.toFixed(1)}%
                        </div>
                      </td>

                      <td className="py-2.5 px-1.5 text-right font-mono tabular-nums">
                        <div
                          className={`text-sm font-bold ${
                            ev.flow_score.passes_review_threshold
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {ev.flow_score.total_flow_score}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          +{ev.flow_score.positive_total.toFixed(0)}/-
                          {ev.flow_score.penalty_total.toFixed(0)}
                        </div>
                      </td>

                      <td className="py-2.5 px-1.5">
                        {ev.alpaca_confirmation.confirmed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Confirmed</span>
                          </span>
                        ) : ev.alpaca_confirmation.rejected ? (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Rejected</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>De-Ranked</span>
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-1.5 max-w-[125px] truncate text-slate-300">
                        {ev.contract_selection.structure_type ===
                        'directional_long_option'
                          ? 'Long Option (7–45d)'
                          : ev.contract_selection.structure_type ===
                              'range_pinning_iron_condor_or_fade'
                            ? 'Defined-Risk Spread'
                            : 'Vertical Spread'}
                      </td>

                      <td className="py-2.5 px-2">
                        {ev.alerted_for_human_review ? (
                          <span className="text-emerald-400 font-semibold font-mono text-[11px]">
                            ALERT REVIEW
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">
                            WATCHLIST
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right 6 Cols: Selected Contract Strategy Inspector (14-Factor FlowScore, Alpaca Confirmation, 6-Stage Rule Hierarchy) */}
        <aside
          aria-label="Strategy Candidate Inspector"
          className="lg:col-span-6 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
        >
          {activeEval && activeRawCandidate ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-sky-400 font-bold">
                      RANK #{activeEval.Rank}
                    </span>
                    <span>·</span>
                    <span className="font-bold text-slate-100 text-sm">
                      {activeEval.ticker} {activeEval.option_symbol}
                    </span>
                    <span>·</span>
                    <span className="text-emerald-400">
                      {activeEval.contract_selection.ranking_designation}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Recommended Expression:{' '}
                    <strong className="text-sky-300">
                      {activeEval.contract_selection.recommended_expression}
                    </strong>
                  </p>
                </div>

                {/* Human Review Action Buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onStageSmartOrderOnCandidate(activeRawCandidate)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-sky-400 hover:bg-sky-300 text-slate-950 transition-colors"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>
                      Approve &amp; Stage Smart Order (&le;
                      {activeEval.risk_guardrails.max_contracts_at_risk_cap}x)
                    </span>
                  </button>

                  {onOpenLlmDecisionGate && (
                    <button
                      type="button"
                      onClick={() => onOpenLlmDecisionGate(activeRawCandidate)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded border border-emerald-500/40 bg-emerald-950/25 hover:bg-emerald-950/40 text-emerald-300 transition-colors"
                    >
                      <BrainCircuit className="w-3.5 h-3.5 text-emerald-400" />
                      <span>LLM Decision Gate</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      onRunAiAnalysisOnCandidate(activeRawCandidate)
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border border-purple-500/40 bg-purple-950/25 hover:bg-purple-950/40 text-purple-200 transition-colors"
                  >
                    <BrainCircuit className="w-3.5 h-3.5 text-purple-400" />
                    <span>AI Brief</span>
                  </button>
                </div>
              </div>

              {/* Detail Inspector Tabs */}
              <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2">
                {(
                  [
                    {
                      id: 'flow_score',
                      label: `14-Factor FlowScore (${activeEval.flow_score.total_flow_score}/100)`,
                    },
                    {
                      id: 'alpaca_audit',
                      label: 'Step 4 & 5: Alpaca Confirmation & Contract Logic',
                    },
                    {
                      id: 'hierarchy_streams',
                      label: 'Rule Hierarchy (1–6) & Streams',
                    },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDetailTab(t.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      detailTab === t.id
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab 1: 14-Factor Whale-Quality FlowScore Breakdown */}
              {detailTab === 'flow_score' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2.5 text-xs font-mono">
                    <div className="p-2.5 rounded border border-slate-800 bg-[#0B0F17]">
                      <div className="text-[10px] text-slate-400">
                        Positive Factors (10)
                      </div>
                      <div className="text-emerald-400 font-bold text-sm mt-0.5">
                        +{activeEval.flow_score.positive_total.toFixed(1)} pts
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-800 bg-[#0B0F17]">
                      <div className="text-[10px] text-slate-400">
                        Ambiguity Penalties (4)
                      </div>
                      <div className="text-rose-400 font-bold text-sm mt-0.5">
                        -{activeEval.flow_score.penalty_total.toFixed(1)} pts
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-800 bg-[#0B0F17]">
                      <div className="text-[10px] text-slate-400">
                        Net FlowScore vs Gate
                      </div>
                      <div className="text-sky-400 font-bold text-sm mt-0.5">
                        {activeEval.flow_score.total_flow_score} /{' '}
                        {activeEval.flow_score.review_threshold} min
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                    {activeEval.flow_score.components.map((comp) => (
                      <div
                        key={comp.id}
                        className="p-2 rounded border border-slate-800/80 bg-[#0B0F17] flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-200 truncate">
                            <span
                              className={`font-mono font-bold mr-1.5 ${
                                comp.sign === '+'
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {comp.sign}
                            </span>
                            {comp.label}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400 truncate">
                            {comp.detail}
                          </div>
                        </div>
                        <span
                          className={`font-mono font-bold whitespace-nowrap ${
                            comp.sign === '+'
                              ? 'text-emerald-400'
                              : comp.points > 0
                                ? 'text-rose-400'
                                : 'text-slate-500'
                          }`}
                        >
                          {comp.sign}
                          {comp.points.toFixed(1)} / {comp.max_points}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="p-2.5 rounded border border-amber-500/40 bg-amber-950/20 text-[11px] text-amber-200">
                    {activeEval.flow_score.oi_verification_warning}
                  </div>
                </div>
              )}

              {/* Tab 2: Step 4 Alpaca Confirmation Layer & Step 5 Contract Selection Logic */}
              {detailTab === 'alpaca_audit' && (
                <div className="space-y-3.5">
                  <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">
                        Step 4: Alpaca Underlying Confirmation Layer (
                        {activeEval.alpaca_confirmation.direction.toUpperCase()}
                        )
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        Move vs Implied:{' '}
                        {activeEval.alpaca_confirmation.move_vs_expected_move_ratio.toFixed(
                          2
                        )}
                        x
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {Object.values(activeEval.alpaca_confirmation.checks).map(
                        (chk) => (
                          <div
                            key={chk.label}
                            className="flex items-center justify-between gap-2 text-xs p-1.5 rounded bg-[#111726]"
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
                        )
                      )}
                    </div>

                    {activeEval.alpaca_confirmation.de_rank_or_reject_reasons
                      .length > 0 && (
                      <div className="p-2 rounded border border-amber-500/40 bg-amber-950/25 text-[11px] text-amber-200 space-y-1">
                        <div className="font-semibold text-amber-300">
                          De-Rank / Reject Triggers:
                        </div>
                        {activeEval.alpaca_confirmation.de_rank_or_reject_reasons.map(
                          (reason) => (
                            <div key={reason}>• {reason}</div>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  {/* Step 5: Contract Selection Logic */}
                  <div className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-2">
                    <div className="text-xs font-semibold text-slate-200">
                      Step 5: Contract Selection &amp; Structure Evaluation
                    </div>
                    <div className="space-y-1 text-xs">
                      {activeEval.contract_selection.preferred_reasons.map(
                        (r) => (
                          <div
                            key={r}
                            className="flex items-start gap-1.5 text-emerald-300"
                          >
                            <span>✓</span>
                            <span>{r}</span>
                          </div>
                        )
                      )}
                      {activeEval.contract_selection.avoid_warnings.map((w) => (
                        <div
                          key={w}
                          className="flex items-start gap-1.5 text-amber-300"
                        >
                          <span>!</span>
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: 6-Stage Rule Hierarchy & Streaming Subscriptions */}
              {detailTab === 'hierarchy_streams' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    {activeEval.rule_hierarchy.map((st) => (
                      <div
                        key={st.stage_number}
                        className="p-2.5 rounded border border-slate-800 bg-[#0B0F17] space-y-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-100">
                            {st.stage_name}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              st.passed ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {st.status_badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {st.detail}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded border border-slate-800 bg-[#0B0F17] space-y-1.5">
                    <div className="text-xs font-semibold text-slate-200">
                      Core Strategy Guardrails
                    </div>
                    <ul className="space-y-1 text-[11px] text-slate-400">
                      {core_guardrails.map((g) => (
                        <li key={g}>• {g}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </aside>
      </div>

      {/* Streaming Subscription Architecture Matrix */}
      <section
        aria-label="Strategy Streaming Subscriptions"
        className="p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-sky-400" />
              <span>
                Active Streaming Subscriptions (Unusual Whales + Alpaca Market
                Data)
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Candidate universe is strictly capped at the top 10–25 liquid
              names to prevent stream overload and noise.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {streaming_subscriptions.map((sub) => (
            <div
              key={sub.channel_or_endpoint}
              className="p-3 rounded-md border border-slate-800 bg-[#0B0F17] space-y-1"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-sky-400 font-mono">
                  {sub.provider}
                </span>
                <span className="text-[11px] font-mono text-emerald-400">
                  {sub.transport} · {sub.cadence}
                </span>
              </div>
              <div className="text-xs font-mono font-bold text-slate-100">
                {sub.channel_or_endpoint}
              </div>
              <p className="text-[11px] text-slate-400">{sub.purpose}</p>
              <div className="text-[10px] font-mono text-slate-500 pt-1">
                Scope: {sub.active_scope}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
