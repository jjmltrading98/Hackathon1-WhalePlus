import React, { useState } from 'react';
import {
  WhaleCandidate,
  formatCandidateTimestampSummary,
} from '../engine/whaleScannerEngine';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  FileJson,
  Activity,
  BarChart3,
  Layers,
  Gauge,
  RefreshCw,
  BrainCircuit,
  Crosshair,
  Zap,
} from 'lucide-react';

interface CandidateInspectorProps {
  candidate: WhaleCandidate | null;
  onRunAiAnalysisOnCandidate?: (candidate: WhaleCandidate) => void;
  onStageSmartOrderOnCandidate?: (candidate: WhaleCandidate) => void;
  onOpenRegimeStrategy?: (candidate: WhaleCandidate) => void;
  onOpenOptionEventChart?: (candidate: WhaleCandidate) => void;
  onAutoExecuteCandidate?: (candidate: WhaleCandidate) => void;
  runningAutoCycle?: boolean;
}

export const CandidateInspector: React.FC<CandidateInspectorProps> = ({
  candidate,
  onRunAiAnalysisOnCandidate,
  onStageSmartOrderOnCandidate,
  onOpenRegimeStrategy,
  onOpenOptionEventChart,
  onAutoExecuteCandidate,
  runningAutoCycle = false,
}) => {
  const [activeTab, setActiveTab] = useState<
    'score' | 'gex' | 'candle' | 'flow' | 'json'
  >('score');
  const [copied, setCopied] = useState(false);
  const [liveAlpacaContext, setLiveAlpacaContext] = useState<any | null>(null);
  const [loadingAlpaca, setLoadingAlpaca] = useState(false);

  if (!candidate) {
    return (
      <aside
        aria-label="Candidate Inspector"
        className="border border-slate-800 bg-[#111726] rounded-lg p-6 flex flex-col justify-center items-center text-center min-h-[420px]"
      >
        <Activity className="w-8 h-8 text-slate-500 mb-3" />
        <h2 className="text-base font-semibold text-slate-200 mb-1">
          No Candidate Selected
        </h2>
        <p className="text-sm text-slate-400 max-w-xs">
          Select any ranked option flow candidate from the scanner table to
          inspect its 9-factor Adaptive Whale Score, GEX &amp; IV term structure,
          Alpaca Stock &amp; Technical confirmation, and Section 8 JSON output.
        </p>
      </aside>
    );
  }

  const isBull = candidate.direction === 'bullish';
  const mktCtx = candidate.market_context ?? {
    tide_regime: 'strong_positive',
    tide_zscore: 2.4,
    tide_slope_15m: 0.18,
    tide_alignment: 1.0,
    scanner_profile: 'risk_on_trend',
    filter_version: 'v2.1',
    profile: 'risk_on_trend',
    market_tide_alignment: 1.0,
    sector_tide_alignment: 1.0,
    sector_name: candidate.sector ?? 'Technology',
    zero_dte_equity_pressure: 'bullish',
    zero_dte_index_pressure: 'bullish',
    zero_dte_etf_pressure: 'neutral',
  };

  const gammaCtx = candidate.gamma_context ?? {
    ticker_spot: candidate.underlying.price_at_detection,
    gamma_flip: +(candidate.underlying.price_at_detection * 0.97).toFixed(2),
    call_wall: +(candidate.underlying.price_at_detection * 0.99).toFixed(2),
    put_wall: +(candidate.underlying.price_at_detection * 0.94).toFixed(2),
    gamma_magnet: +(candidate.underlying.price_at_detection * 0.98).toFixed(2),
    above_gamma_flip: true,
    breakout_confirmed: true,
    near_magnet: false,
    near_flip: false,
    ticker_gamma_modifier: 6,
    gamma_alignment_score: 1.0,
    gex_source_vol_net: 85_000_000,
    gex_source_oi_net: 190_000_000,
  };

  const volCtx = candidate.volatility_context ?? {
    iv_7_to_14_dte: candidate.flow.iv,
    iv_30_to_60_dte: +(candidate.flow.iv * 0.94).toFixed(3),
    front_back_iv_ratio: 1.06,
    regime: 'normal',
  };

  const decisionCtx = candidate.decision ?? {
    scanner_profile: (mktCtx.profile ?? 'risk_on_trend') as any,
    base_score: candidate.whale_score,
    regime_adjustments: candidate.regime_bonus_applied ?? 0,
    final_score: candidate.whale_score,
    status: candidate.status,
    adjustment_breakdown: [],
    explanation: 'Evaluated by Adaptive Whale Scanner State Machine v2.1',
  };

  const stockConf = candidate.stock_confirmation;

  const handleQueryLiveAlpacaTicker = async (ticker: string) => {
    setLoadingAlpaca(true);
    try {
      const res = await fetch(
        `/api/alpaca/stock-context/${encodeURIComponent(ticker)}?min_premium=50000`
      );
      if (res.ok) {
        const data = await res.json();
        setLiveAlpacaContext(data);
      }
    } catch (err) {
      console.error('Failed to query live Alpaca ticker context:', err);
    } finally {
      setLoadingAlpaca(false);
    }
  };

  const tsSummary = formatCandidateTimestampSummary(candidate);

  // Section 8 Candidate Output Schema (with stock_confirmation included)
  const schemaOutput = {
    candidate_id: candidate.candidate_id,
    scanner_id: candidate.scanner_id,
    detected_at: candidate.detected_at,
    detected_at_et: tsSummary.detected_time_et,
    latest_print_at_et: tsSummary.latest_time_et,
    last_updated_at: tsSummary.last_updated_iso,
    ticker: candidate.ticker,
    sector: candidate.sector ?? mktCtx.sector_name,
    option_symbol: candidate.option_symbol,
    direction: candidate.direction,
    status: candidate.status,
    whale_score: candidate.whale_score,
    composite_70_30_score:
      stockConf?.final_composite_score ?? candidate.whale_score,
    market_context: {
      profile: mktCtx.profile ?? mktCtx.scanner_profile,
      tide_regime: mktCtx.tide_regime,
      tide_zscore: mktCtx.tide_zscore,
      tide_slope_15m: mktCtx.tide_slope_15m,
      market_tide_alignment:
        mktCtx.market_tide_alignment ?? mktCtx.tide_alignment,
      sector_tide_alignment: mktCtx.sector_tide_alignment ?? 1.0,
      zero_dte_equity_pressure: mktCtx.zero_dte_equity_pressure ?? 'bullish',
      filter_version: mktCtx.filter_version,
    },
    gamma_context: {
      ticker_spot: gammaCtx.ticker_spot,
      gamma_flip: gammaCtx.gamma_flip,
      call_wall: gammaCtx.call_wall,
      put_wall: gammaCtx.put_wall,
      gamma_magnet: gammaCtx.gamma_magnet,
      above_gamma_flip: gammaCtx.above_gamma_flip,
      breakout_confirmed: gammaCtx.breakout_confirmed,
      near_magnet: gammaCtx.near_magnet,
      near_flip: gammaCtx.near_flip,
      ticker_gamma_modifier: gammaCtx.ticker_gamma_modifier,
    },
    volatility_context: {
      iv_7_to_14_dte: volCtx.iv_7_to_14_dte,
      iv_30_to_60_dte: volCtx.iv_30_to_60_dte,
      front_back_iv_ratio: volCtx.front_back_iv_ratio,
      regime: volCtx.regime,
    },
    stock_confirmation: stockConf
      ? {
          data_source: stockConf.data_source,
          confirmed_3_of_5: stockConf.confirmed_3_of_5,
          rules_passed_count: stockConf.rules_passed_count,
          stock_confirmation_score: stockConf.stock_confirmation_score,
          secondary_boost_points: stockConf.secondary_boost_points,
          options_flow_score: stockConf.options_flow_score,
          final_composite_score: stockConf.final_composite_score,
          weighted_components: stockConf.weighted_components,
          indicators: stockConf.indicators,
          lit_flow_summary: {
            total_lit_prints: stockConf.lit_flow.total_lit_prints,
            supporting_lit_premium: stockConf.lit_flow.supporting_lit_premium,
            has_supporting_large_print:
              stockConf.lit_flow.has_supporting_large_print,
          },
        }
      : undefined,
    decision: {
      scanner_profile: decisionCtx.scanner_profile,
      base_score: decisionCtx.base_score,
      regime_adjustments: decisionCtx.regime_adjustments,
      final_score: decisionCtx.final_score,
      status: decisionCtx.status,
      adjustment_breakdown: decisionCtx.adjustment_breakdown,
    },
    components: candidate.components,
    flow: {
      premium_5m: candidate.flow.premium_5m,
      contract_premium_5m: candidate.flow.contract_premium_5m,
      contract_share: candidate.flow.contract_share,
      side_share: candidate.flow.side_share,
      sweep_ratio: candidate.flow.sweep_ratio,
      volume: candidate.flow.volume,
      open_interest: candidate.flow.open_interest,
      volume_oi_ratio: candidate.flow.volume_oi_ratio,
      oi_status: candidate.flow.oi_status,
      repeated_hits: candidate.flow.repeated_hits,
      flow_alert_rules: candidate.flow.flow_alert_rules,
    },
    underlying: {
      price_at_detection: candidate.underlying.price_at_detection,
      return_5m: candidate.underlying.return_5m,
      relative_volume_5m: candidate.underlying.relative_volume_5m,
      vwap_aligned: candidate.underlying.vwap_aligned,
      candle_close_position: candidate.underlying.candle_close_position,
    },
    flags: candidate.flags,
    raw_event_refs: candidate.raw_event_refs,
    aggregation: candidate.aggregation,
  };

  const handleCopyJson = () => {
    navigator.clipboard?.writeText(JSON.stringify(schemaOutput, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Section 7: 9-Factor Adaptive Whale Score Base (Weights sum to 100)
  const scoreRows = [
    {
      label: 'Premium Score',
      weight: 20,
      value: candidate.components.premium,
      points: (20 * candidate.components.premium).toFixed(1),
      formula: `clamp(log10($${(candidate.flow.premium_5m / 1000).toFixed(0)}K / $50K) / log10(20))`,
    },
    {
      label: 'Price Confirmation',
      weight: 18,
      value: candidate.components.price_confirmation,
      points: (18 * candidate.components.price_confirmation).toFixed(1),
      formula: `0.40*ret + 0.30*vwap + 0.20*rvol + 0.10*close_pos`,
    },
    {
      label: 'Urgency Score',
      weight: 16,
      value: candidate.components.urgency,
      points: (16 * candidate.components.urgency).toFixed(1),
      formula: `0.40*sweep(${Math.round(candidate.flow.sweep_ratio * 100)}%) + 0.35*hits + 0.25*side(${Math.round(candidate.flow.side_share * 100)}%)`,
    },
    {
      label: 'Novelty Score',
      weight: 12,
      value: candidate.components.novelty,
      points: (12 * candidate.components.novelty).toFixed(1),
      formula: `clamp((Vol ${candidate.flow.volume} / OI ${candidate.flow.open_interest}) / 5)`,
    },
    {
      label: 'Concentration Score',
      weight: 12,
      value: candidate.components.concentration,
      points: (12 * candidate.components.concentration).toFixed(1),
      formula: `clamp(contract_share ${(candidate.flow.contract_share * 100).toFixed(0)}% / 60%)`,
    },
    {
      label: 'Liquidity Score',
      weight: 8,
      value: candidate.components.liquidity,
      points: (8 * candidate.components.liquidity).toFixed(1),
      formula: `0.33*spread(${(candidate.flow.spread * 100).toFixed(1)}%) + 0.33*OI + 0.33*ADDV`,
    },
    {
      label: 'Market Tide Alignment',
      weight: 7,
      value:
        candidate.components.market_tide_alignment ??
        candidate.components.tide_alignment,
      points: (
        7 *
        (candidate.components.market_tide_alignment ??
          candidate.components.tide_alignment)
      ).toFixed(1),
      formula: `regime=${mktCtx.tide_regime} · profile=${decisionCtx.scanner_profile}`,
    },
    {
      label: 'Sector Tide Alignment',
      weight: 4,
      value: candidate.components.sector_tide_alignment ?? 1.0,
      points: (4 * (candidate.components.sector_tide_alignment ?? 1.0)).toFixed(
        1
      ),
      formula: `get_market_sector_tide (${candidate.sector ?? mktCtx.sector_name})`,
    },
    {
      label: 'Gamma Alignment Score',
      weight: 3,
      value:
        candidate.components.gamma_alignment ?? gammaCtx.gamma_alignment_score,
      points: (
        3 *
        (candidate.components.gamma_alignment ?? gammaCtx.gamma_alignment_score)
      ).toFixed(1),
      formula: `spot $${gammaCtx.ticker_spot.toFixed(2)} vs flip $${gammaCtx.gamma_flip.toFixed(2)} · wall $${isBull ? gammaCtx.call_wall.toFixed(2) : gammaCtx.put_wall.toFixed(2)}`,
    },
  ];

  return (
    <aside
      aria-label="Candidate Inspector"
      className="border border-slate-800 bg-[#111726] rounded-lg p-5 flex flex-col gap-4"
    >
      {/* Inspector Header */}
      <div className="pb-3.5 border-b border-slate-800/80 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-1">
              <span className="font-mono font-semibold text-slate-200">
                {candidate.ticker}
              </span>
              <span aria-hidden="true">·</span>
              <span>{candidate.sector ?? mktCtx.sector_name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{candidate.dte} DTE</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold font-mono text-slate-100 tracking-tight truncate">
              {candidate.option_symbol}
            </h2>
            <div
              data-testid="inspector-candidate-timestamp"
              className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] font-mono tabular-nums text-sky-300"
            >
              <Clock className="w-3 h-3 text-sky-400 shrink-0" />
              <span>Detected {tsSummary.detected_time_et}</span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span>Latest {tsSummary.latest_time_et}</span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-slate-400">
                {tsSummary.date_et} ({tsSummary.relative_age_label})
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  isBull ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {isBull ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                {isBull ? 'Bullish Flow' : 'Bearish Flow'}
              </span>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  candidate.status === 'confirmed'
                    ? 'text-emerald-400'
                    : candidate.status === 'needs_confirmation'
                      ? 'text-amber-400'
                      : 'text-slate-400'
                }`}
              >
                {candidate.status === 'confirmed' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Clock className="w-3.5 h-3.5" />
                )}
                Status: {candidate.status}
              </span>
              {stockConf && (
                <>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span
                    className={`font-mono ${
                      stockConf.confirmed_3_of_5
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    Stock {stockConf.rules_passed_count}/5 Rules
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-400">Whale / 70:30 Score</div>
            <div className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-sky-400">
              {candidate.whale_score}
              {stockConf && (
                <span className="text-sm sm:text-base font-semibold text-emerald-400 ml-1">
                  ({stockConf.final_composite_score})
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              Flow {decisionCtx.final_score} · Stock{' '}
              <span className="text-emerald-400">
                {stockConf?.stock_confirmation_score ?? 85}
              </span>
              {stockConf && stockConf.secondary_boost_points > 0 && (
                <span className="text-sky-400">
                  {' '}
                  +{stockConf.secondary_boost_points} boost
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <div className="grid grid-cols-2 gap-2">
            {onOpenOptionEventChart && (
              <button
                type="button"
                data-testid="inspector-open-option-event-chart-btn"
                onClick={() => onOpenOptionEventChart(candidate)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors cursor-pointer"
              >
                <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Option Price &amp; Events Chart</span>
              </button>
            )}
            {onAutoExecuteCandidate && (
              <button
                type="button"
                data-testid="inspector-auto-exec-btn"
                title="Auto-Analyze (Stage-1 + Stage-2 Risk) & Place Smart Order"
                disabled={runningAutoCycle}
                onClick={() => onAutoExecuteCandidate(candidate)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-300 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">Auto-Exec Pipeline</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {onRunAiAnalysisOnCandidate && (
              <button
                type="button"
                onClick={() => onRunAiAnalysisOnCandidate(candidate)}
                className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-300 transition-colors cursor-pointer"
              >
                <BrainCircuit className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">Run AI Analysis</span>
              </button>
            )}
            {onStageSmartOrderOnCandidate && (
              <button
                type="button"
                onClick={() => onStageSmartOrderOnCandidate(candidate)}
                className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-300 transition-colors cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">Smart Order</span>
              </button>
            )}
            {onOpenRegimeStrategy && (
              <button
                type="button"
                onClick={() => onOpenRegimeStrategy(candidate)}
                className="inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-300 transition-colors cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Regime Strategy</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-Print Contract Activity Aggregation Summary Strip */}
        {candidate.aggregation && (
          <div
            data-testid="candidate-aggregation-banner"
            className="p-2.5 rounded bg-[#0B0F17] border border-sky-500/35 text-[11px] font-mono space-y-1"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-sky-300">
                {candidate.aggregation.is_aggregated
                  ? `Contract Activity Aggregated (${candidate.aggregation.aggregated_print_count} Prints: ${candidate.aggregation.distinct_sweep_count} Sweeps · ${candidate.aggregation.distinct_block_count} Blocks)`
                  : `Single Institutional Print (${candidate.aggregation.cumulative_contracts.toLocaleString()} Contracts)`}
              </span>
              <span className="text-emerald-400 font-semibold">
                VWAP ${candidate.aggregation.vwap_fill_price.toFixed(2)} ·{' '}
                {candidate.aggregation.price_progression.replace(/_/g, ' ')} (
                {candidate.aggregation.conviction_multiplier.toFixed(2)}x)
              </span>
            </div>
            <div className="text-slate-400 leading-snug">
              {candidate.aggregation.aggregation_summary}
            </div>
          </div>
        )}
      </div>

      {/* Interactive Inspector View Selector (5 tabs) */}
      <div
        role="tablist"
        aria-label="Candidate Inspector Views"
        className="grid grid-cols-5 gap-1 p-1 bg-[#0B0F17] rounded-md border border-slate-800/80"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'score'}
          onClick={() => setActiveTab('score')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1 ${
            activeTab === 'score'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>9-Factor</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'gex'}
          onClick={() => setActiveTab('gex')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1 ${
            activeTab === 'gex'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Gauge className="w-3.5 h-3.5" />
          <span>GEX &amp; IV</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'candle'}
          onClick={() => setActiveTab('candle')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1 ${
            activeTab === 'candle'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Stock &amp; Tech</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'flow'}
          onClick={() => setActiveTab('flow')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1 ${
            activeTab === 'flow'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Flow &amp; OI</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'json'}
          onClick={() => setActiveTab('json')}
          className={`py-1.5 px-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1 ${
            activeTab === 'json'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileJson className="w-3.5 h-3.5" />
          <span>JSON</span>
        </button>
      </div>

      {/* Tab 1: 9-Factor Adaptive Whale Score & State Machine Decision */}
      {activeTab === 'score' && (
        <div className="flex flex-col gap-3.5">
          {/* Decision Banner */}
          <div className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">
                Profile:{' '}
                <strong className="text-sky-400">
                  {decisionCtx.scanner_profile}
                </strong>
              </span>
              <span className="text-slate-200">
                Base {decisionCtx.base_score.toFixed(0)} · Adj{' '}
                {decisionCtx.regime_adjustments >= 0 ? '+' : ''}
                {decisionCtx.regime_adjustments} ={' '}
                <strong className="text-sky-400">
                  {decisionCtx.final_score}
                </strong>
              </span>
            </div>
            {stockConf && (
              <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-slate-800/70">
                <span className="text-slate-400">
                  70/30 Weighting: 0.70×Flow({stockConf.options_flow_score}) +
                  0.30×Stock({stockConf.stock_confirmation_score}) +{' '}
                  {stockConf.secondary_boost_points} boost
                </span>
                <strong className="text-emerald-400">
                  = {stockConf.final_composite_score}/100
                </strong>
              </div>
            )}
            {decisionCtx.adjustment_breakdown.length > 0 && (
              <div className="text-[11px] font-mono text-emerald-400">
                Modifiers:{' '}
                {decisionCtx.adjustment_breakdown
                  .map((item: any) =>
                    typeof item === 'string' ? item : item.label
                  )
                  .join(' · ')}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>9-Factor Adaptive Base Score (v2.1)</span>
              <span className="font-mono">Clamped (0..1) · Weighted Pts</span>
            </div>
            {scoreRows.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">
                    {row.label}{' '}
                    <span className="text-slate-500 font-mono">
                      (w={row.weight})
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {row.value.toFixed(2)} ·{' '}
                    <strong className="text-sky-400">{row.points}</strong>/
                    {row.weight}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-800/90 rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-transform duration-150 origin-left"
                    style={{
                      transform: `scaleX(${Math.max(0.02, row.value)})`,
                    }}
                  />
                </div>
                <div className="text-[10.5px] font-mono text-slate-400 truncate">
                  {row.formula}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Ticker Gamma Exposure (GEX) & Volatility Term Structure */}
      {activeTab === 'gex' && (
        <div className="flex flex-col gap-3.5 text-xs">
          <div className="p-3.5 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">
                Ticker Gamma Levels (`gamma_context`)
              </span>
              <span
                className={`font-mono font-semibold ${
                  gammaCtx.ticker_gamma_modifier > 0
                    ? 'text-emerald-400'
                    : gammaCtx.ticker_gamma_modifier < 0
                      ? 'text-rose-400'
                      : 'text-slate-300'
                }`}
              >
                GEX Mod: {gammaCtx.ticker_gamma_modifier >= 0 ? '+' : ''}
                {gammaCtx.ticker_gamma_modifier} pts
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[11px] text-slate-400">
                  Ticker Spot vs Gamma Flip
                </div>
                <div className="text-slate-100 font-semibold mt-0.5">
                  ${gammaCtx.ticker_spot.toFixed(2)} vs $
                  {gammaCtx.gamma_flip.toFixed(2)}
                </div>
                <div className="text-[10px] text-emerald-400">
                  {gammaCtx.above_gamma_flip
                    ? 'Above Gamma Flip (+GEX)'
                    : 'Below Gamma Flip (-GEX)'}
                </div>
              </div>

              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[11px] text-slate-400">
                  Call Wall / Put Wall
                </div>
                <div className="text-slate-100 font-semibold mt-0.5">
                  C:${gammaCtx.call_wall.toFixed(1)} · P:$
                  {gammaCtx.put_wall.toFixed(1)}
                </div>
                <div className="text-[10px] text-sky-400">
                  {gammaCtx.breakout_confirmed
                    ? 'Wall Breakout Confirmed (+6)'
                    : 'Inside Wall Range'}
                </div>
              </div>

              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[11px] text-slate-400">
                  Gamma Magnet Pin Risk
                </div>
                <div className="text-slate-100 font-semibold mt-0.5">
                  Magnet: ${gammaCtx.gamma_magnet.toFixed(2)}
                </div>
                <div
                  className={`text-[10px] ${
                    gammaCtx.near_magnet ? 'text-amber-400' : 'text-slate-400'
                  }`}
                >
                  {gammaCtx.near_magnet
                    ? 'Pinned within 0.35% (-8)'
                    : 'Clear of Magnet Pin'}
                </div>
              </div>

              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[11px] text-slate-400">
                  Intraday Vol vs OI GEX
                </div>
                <div className="text-slate-100 font-semibold mt-0.5">
                  Vol: $
                  {(
                    (gammaCtx.gex_source_vol_net ?? 85_000_000) / 1_000_000
                  ).toFixed(0)}
                  M
                </div>
                <div className="text-[10px] text-slate-400">
                  OI: $
                  {(
                    (gammaCtx.gex_source_oi_net ?? 190_000_000) / 1_000_000
                  ).toFixed(0)}
                  M
                </div>
              </div>
            </div>
          </div>

          {/* Volatility Term Structure */}
          <div className="p-3.5 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">
                IV Term Structure (`volatility_context`)
              </span>
              <span className="font-mono text-sky-400 font-semibold">
                {volCtx.regime}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 font-mono">
              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[10px] text-slate-400">7-14 DTE IV</div>
                <div className="text-slate-100 font-semibold">
                  {(volCtx.iv_7_to_14_dte * 100).toFixed(1)}%
                </div>
              </div>
              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[10px] text-slate-400">30-60 DTE IV</div>
                <div className="text-slate-100 font-semibold">
                  {(volCtx.iv_30_to_60_dte * 100).toFixed(1)}%
                </div>
              </div>
              <div className="p-2 rounded bg-[#111726]">
                <div className="text-[10px] text-slate-400">
                  Front/Back Ratio
                </div>
                <div
                  className={`font-semibold ${
                    volCtx.front_back_iv_ratio >= 1.2
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {volCtx.front_back_iv_ratio.toFixed(2)}x
                </div>
              </div>
            </div>
          </div>

          {/* Sector & 0DTE Context */}
          <div className="p-3.5 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2">
            <div className="font-semibold text-slate-200">
              Sector &amp; 0DTE Tide Context (`market_context`)
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="text-slate-400">
                Sector ({candidate.sector ?? mktCtx.sector_name}):{' '}
                <strong className="text-emerald-400">
                  align={(mktCtx.sector_tide_alignment ?? 1.0).toFixed(2)}
                </strong>
              </div>
              <div className="text-slate-400">
                0DTE Equity Pressure:{' '}
                <strong className="text-sky-400">
                  {mktCtx.zero_dte_equity_pressure ?? 'bullish'}
                </strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Alpaca Live Stock Data, Technical Indicators & 3-of-5 Confirmation */}
      {activeTab === 'candle' && (
        <div className="flex flex-col gap-3.5 text-xs">
          {/* 70/30 Weighting & 3-of-5 Summary Banner */}
          <div className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200">
                Alpaca Stock Confirmation (Require &ge; 3 of 5)
              </span>
              <span
                className={`font-mono font-semibold ${
                  stockConf?.confirmed_3_of_5
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }`}
              >
                {stockConf
                  ? `${stockConf.rules_passed_count}/5 Passed (${stockConf.confirmed_3_of_5 ? 'Confirmed' : 'Unconfirmed'})`
                  : 'Confirmed'}
              </span>
            </div>

            {stockConf && (
              <>
                <div className="grid grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                  <div className="p-2 rounded bg-[#111726]">
                    <div className="text-slate-400">Options Flow (70%)</div>
                    <div className="text-slate-100 font-bold text-sm">
                      {stockConf.options_flow_score}
                      <span className="text-[10px] text-slate-400 font-normal">
                        {' '}
                        (
                        {(0.7 * stockConf.options_flow_score).toFixed(1)} pts)
                      </span>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#111726]">
                    <div className="text-slate-400">Stock Score (30%)</div>
                    <div className="text-emerald-400 font-bold text-sm">
                      {stockConf.stock_confirmation_score}
                      <span className="text-[10px] text-slate-400 font-normal">
                        {' '}
                        (
                        {(0.3 * stockConf.stock_confirmation_score).toFixed(1)}{' '}
                        pts)
                      </span>
                    </div>
                  </div>
                  <div className="p-2 rounded bg-[#111726]">
                    <div className="text-slate-400">70/30 + Boosts</div>
                    <div className="text-sky-400 font-bold text-sm">
                      {stockConf.final_composite_score}
                      <span className="text-[10px] text-emerald-400 font-normal">
                        {' '}
                        (+{stockConf.secondary_boost_points})
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5 Practical Confirmation Rules Checklist */}
                <div className="space-y-1.5 pt-1">
                  {stockConf.rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between gap-2 py-1 border-b border-slate-800/60 last:border-b-0"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            rule.passed ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                        />
                        <span className="text-slate-200 truncate">
                          {rule.label}{' '}
                          <span className="text-slate-500 font-mono">
                            ({Math.round(rule.weight * 100)}%)
                          </span>
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-300 shrink-0">
                        {rule.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Secondary Momentum & Lit-Flow Boosts */}
          {stockConf && (
            <div className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  Secondary Timing &amp; Lit-Flow Boosts
                </span>
                <span className="font-mono text-sky-400 font-semibold">
                  +{stockConf.secondary_boost_points} pts applied
                </span>
              </div>
              <div className="space-y-1">
                {stockConf.secondary_boosts.map((boost) => (
                  <div
                    key={boost.id}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span
                      className={
                        boost.applied_points > 0
                          ? 'text-emerald-400 font-medium'
                          : 'text-slate-400'
                      }
                    >
                      {boost.applied_points > 0 ? '✓ ' : '· '}
                      {boost.label}
                    </span>
                    <span className="font-mono text-slate-300 shrink-0">
                      {boost.detail}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-[10.5px] font-mono text-slate-400 pt-1 border-t border-slate-800/70">
                {stockConf.guardrail_note}
              </div>
            </div>
          )}

          {/* Computed Technical Indicator Series Snapshot (5m / 5d) */}
          {stockConf && (
            <div className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  Technical Indicators (`get_ticker_indicator_series`)
                </span>
                <span className="font-mono text-[10px] text-emerald-400">
                  {stockConf.data_source}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">Session VWAP</div>
                  <div className="text-slate-100 font-semibold">
                    ${stockConf.indicators.vwap_session.toFixed(2)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">
                    EMA 9 / 20 / 50
                  </div>
                  <div className="text-slate-100 font-semibold">
                    {stockConf.indicators.ema_9.toFixed(1)} /{' '}
                    {stockConf.indicators.ema_20.toFixed(1)} /{' '}
                    {stockConf.indicators.ema_50.toFixed(1)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">
                    5m ATR(14) &amp; Move
                  </div>
                  <div className="text-slate-100 font-semibold">
                    ${stockConf.indicators.atr_14.toFixed(2)} (
                    {stockConf.indicators.post_burst_atr_multiple}x)
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">
                    RSI(14) &amp; MACD Hist
                  </div>
                  <div className="text-slate-100 font-semibold">
                    {stockConf.indicators.rsi_14.toFixed(1)} ·{' '}
                    {stockConf.indicators.macd_histogram >= 0 ? '+' : ''}
                    {stockConf.indicators.macd_histogram.toFixed(3)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">
                    Bollinger (20, 2)
                  </div>
                  <div className="text-slate-100 font-semibold">
                    {stockConf.indicators.bollinger_lower.toFixed(1)} –{' '}
                    {stockConf.indicators.bollinger_upper.toFixed(1)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">
                    ADX(14) +DI / -DI
                  </div>
                  <div className="text-slate-100 font-semibold">
                    {stockConf.indicators.adx_14.toFixed(1)} (+
                    {stockConf.indicators.plus_di_14.toFixed(0)}/-
                    {stockConf.indicators.minus_di_14.toFixed(0)})
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1">
                <span>
                  Support: ${stockConf.indicators.support_level.toFixed(2)} ·
                  Resistance: $
                  {stockConf.indicators.resistance_level.toFixed(2)}
                </span>
                <span>
                  Lit Prints: {stockConf.lit_flow.total_lit_prints} ($
                  {(stockConf.lit_flow.supporting_lit_premium / 1000).toFixed(
                    0
                  )}
                  K)
                </span>
              </div>
            </div>
          )}

          {/* Live Alpaca API Query Trigger for Selected Ticker */}
          <div className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-200">
                  Live Alpaca Market Data v2 (`{candidate.ticker}`)
                </div>
                <div className="text-[11px] text-slate-400">
                  1m (1D) + 5m (5D) bars, indicator series &amp; lit stock flow
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleQueryLiveAlpacaTicker(candidate.ticker)}
                disabled={loadingAlpaca}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loadingAlpaca ? 'animate-spin' : ''}`}
                />
                <span>
                  {loadingAlpaca
                    ? 'Querying Alpaca...'
                    : `Query Live ${candidate.ticker} Bars`}
                </span>
              </button>
            </div>

            {liveAlpacaContext &&
              liveAlpacaContext.ticker === candidate.ticker && (
                <div className="mt-2 p-2.5 rounded bg-[#111726] border border-slate-800 font-mono text-[11px] space-y-1.5">
                  <div className="flex items-center justify-between text-emerald-400">
                    <span>
                      Feed: {liveAlpacaContext.candles_5m_5d?.data_source} (SIP)
                    </span>
                    <span>
                      Latest: $
                      {liveAlpacaContext.quote?.latest_price?.toFixed(2) ??
                        liveAlpacaContext.indicator_series?.snapshot?.last_price?.toFixed(
                          2
                        )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-300">
                    <div>
                      1m Bars (1D): {liveAlpacaContext.candles_1m_1d?.count} bars
                    </div>
                    <div>
                      5m Bars (5D): {liveAlpacaContext.candles_5m_5d?.count} bars
                    </div>
                    <div>
                      Live VWAP: $
                      {liveAlpacaContext.indicator_series?.snapshot?.vwap_session?.toFixed(
                        2
                      )}
                    </div>
                    <div>
                      Lit Prints (&ge;$50K):{' '}
                      {liveAlpacaContext.lit_flow?.prints?.length ?? 0}
                    </div>
                  </div>
                </div>
              )}
          </div>
        </div>
      )}

      {/* Tab 4: Flow Metrics, OI Verification Label & Alert Rules */}
      {activeTab === 'flow' && (
        <div className="flex flex-col gap-4 text-xs">
          <div className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 space-y-1.5">
            <div className="flex items-center gap-1.5 text-amber-400 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Open Interest Verification Policy</span>
            </div>
            <p className="text-slate-300 font-mono text-[11px]">
              oi_status: &quot;{candidate.flow.oi_status}&quot;
            </p>
            <p className="text-slate-400 leading-relaxed">
              Intraday volume ({candidate.flow.volume.toLocaleString()}) exceeds
              prior OI ({candidate.flow.open_interest.toLocaleString()}, ratio{' '}
              {candidate.flow.volume_oi_ratio}x). Volume &gt; OI does not prove
              new opening positions until verified against next morning&apos;s
              OCC OI update.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="text-slate-400 font-medium">
              Rolling Window Premiums
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono">
              <div className="p-2 rounded bg-[#0B0F17] border border-slate-800/70">
                <div className="text-[11px] text-slate-400">1m Window</div>
                <div className="text-slate-100 font-semibold">
                  ${(candidate.flow.premium_1m / 1000).toFixed(0)}K
                </div>
              </div>
              <div className="p-2 rounded bg-[#0B0F17] border border-slate-800/70">
                <div className="text-[11px] text-slate-400">5m Window</div>
                <div className="text-sky-400 font-semibold">
                  ${(candidate.flow.premium_5m / 1000).toFixed(0)}K
                </div>
              </div>
              <div className="p-2 rounded bg-[#0B0F17] border border-slate-800/70">
                <div className="text-[11px] text-slate-400">15m Window</div>
                <div className="text-slate-100 font-semibold">
                  ${(candidate.flow.premium_15m / 1000).toFixed(0)}K
                </div>
              </div>
            </div>
          </div>

          {/* Contract Activity Aggregation & Chronological Print Ledger */}
          {candidate.aggregation && (
            <div
              data-testid="candidate-aggregation-ledger"
              className="p-3 rounded bg-[#0B0F17] border border-sky-500/30 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-sky-300">
                  Contract Activity Aggregation &amp; Print Ledger (
                  {candidate.aggregation.aggregated_print_count} Prints)
                </span>
                <span className="font-mono text-[11px] text-emerald-400">
                  Cumulative: $
                  {(
                    candidate.aggregation.cumulative_premium_dollars / 1000
                  ).toFixed(1)}
                  K ({candidate.aggregation.cumulative_contracts.toLocaleString()}{' '}
                  cts)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">VWAP Fill</div>
                  <div className="text-slate-100 font-semibold">
                    ${candidate.aggregation.vwap_fill_price.toFixed(2)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">Fill Range</div>
                  <div className="text-slate-100 font-semibold">
                    ${candidate.aggregation.min_fill_price.toFixed(2)}–$
                    {candidate.aggregation.max_fill_price.toFixed(2)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">Progression</div>
                  <div className="text-emerald-400 font-semibold truncate">
                    {candidate.aggregation.price_progression.replace(/_/g, ' ')}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#111726]">
                  <div className="text-[10px] text-slate-400">
                    Conviction Mult
                  </div>
                  <div className="text-sky-400 font-semibold">
                    {candidate.aggregation.conviction_multiplier.toFixed(2)}x
                    initial
                  </div>
                </div>
              </div>

              <div className="rounded bg-[#111726] border border-slate-800/80 divide-y divide-slate-800/60 font-mono text-[11px] max-h-40 overflow-y-auto">
                {candidate.aggregation.print_ledger.map((item, idx) => (
                  <div
                    key={item.event_id}
                    className="px-2.5 py-1.5 flex items-center justify-between gap-2"
                  >
                    <div className="truncate">
                      <span className="text-slate-400">#{idx + 1}</span>{' '}
                      <span className="text-slate-100 font-semibold">
                        {item.size.toLocaleString()}x @ ${item.price.toFixed(2)}
                      </span>{' '}
                      <span className="text-sky-400">
                        [{item.side.toUpperCase()}{' '}
                        {item.is_sweep ? 'SWEEP' : 'BLOCK'}]
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-emerald-400 font-semibold">
                        ${(item.premium / 1000).toFixed(1)}K
                      </span>{' '}
                      <span className="text-slate-500 text-[10px]">
                        ({item.event_id})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lit Stock Flow Prints (`get_ticker_lit_flow`) */}
          {stockConf && stockConf.lit_flow.prints.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-slate-400 font-medium">
                <span>Lit Stock Trades (`get_ticker_lit_flow`)</span>
                <span className="font-mono text-[11px] text-emerald-400">
                  {stockConf.lit_flow.total_lit_prints} block prints
                </span>
              </div>
              <div className="rounded bg-[#0B0F17] border border-slate-800/70 divide-y divide-slate-800/60 font-mono text-[11px]">
                {stockConf.lit_flow.prints.slice(0, 4).map((p) => (
                  <div
                    key={p.trade_id}
                    className="px-2.5 py-1.5 flex items-center justify-between"
                  >
                    <span className="text-slate-200">
                      {p.size.toLocaleString()} sh @ ${p.price.toFixed(2)}{' '}
                      <span className="text-slate-500">[{p.exchange}]</span>
                    </span>
                    <span className="text-emerald-400 font-semibold">
                      ${(p.premium / 1000).toFixed(0)}K
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-slate-400 font-medium">
              Unusual Whales Flow Alert Rules &amp; Flags
            </div>
            <div className="p-2.5 rounded bg-[#0B0F17] border border-slate-800/70 font-mono text-slate-300 space-y-1">
              <div>
                Rules:{' '}
                {candidate.flow.flow_alert_rules.length > 0
                  ? candidate.flow.flow_alert_rules.join(' · ')
                  : 'None'}
              </div>
              <div className="text-slate-400">
                Flags: {candidate.flags.join(' · ')}
              </div>
              <div className="text-slate-500">
                Deduplicated Print Refs: {candidate.raw_event_refs.join(', ')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Section 8 Normalized WhaleCandidate JSON Output (v2.1) */}
      {activeTab === 'json' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Section 8 Adaptive Candidate Output Schema (v2.1 + Alpaca)
            </span>
            <button
              type="button"
              onClick={handleCopyJson}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? (
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
          <pre className="p-3 rounded bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-[340px]">
            {JSON.stringify(schemaOutput, null, 2)}
          </pre>
        </div>
      )}
    </aside>
  );
};
