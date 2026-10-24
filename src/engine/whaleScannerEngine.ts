/**
 * Whale-Activity Scanner Specification - Core Pure Engine (v2.1 Market Tide + Alpaca Stock Confirmation)
 * Scope: Scanner only. Produces ranked normalized WhaleCandidate records
 * for review; does not execute trades or claim to predict profit.
 */

import {
  type AlpacaOhlcvBar,
  type LitStockTradePrint,
  type StockConfirmationEvaluation,
  type StockConfirmationRuleItem,
  type StockSecondaryBoostItem,
  type TechnicalIndicatorPoint,
  type TechnicalIndicatorSnapshot,
  computeAdxDiSeries,
  computeAtrSeries,
  computeBollingerSeries,
  computeEmaSeries,
  computeMacdSeries,
  computeRsiSeries,
  computeTechnicalIndicatorsFromBars,
  evaluateStockConfirmation,
} from './stockConfirmationEngine.ts';


export {
  type AlpacaOhlcvBar,
  type LitStockTradePrint,
  type StockConfirmationEvaluation,
  type StockConfirmationRuleItem,
  type StockSecondaryBoostItem,
  type TechnicalIndicatorPoint,
  type TechnicalIndicatorSnapshot,
  computeAdxDiSeries,
  computeAtrSeries,
  computeBollingerSeries,
  computeEmaSeries,
  computeMacdSeries,
  computeRsiSeries,
  computeTechnicalIndicatorsFromBars,
  evaluateStockConfirmation,
};

export type OptionType = 'call' | 'put';
export type PrintSide = 'ask' | 'bid' | 'mid' | 'unknown';
export type FlowDirection = 'bullish' | 'bearish' | 'ambiguous';

export type CandidateStatus =
  | 'new'
  | 'needs_confirmation'
  | 'confirmed'
  | 'expired'
  | 'invalidated';
export type ScannerModeId =
  | 'directional_momentum'
  | 'accumulation_watch'
  | 'urgent_flow';
export type IssueType = 'Common Stock' | 'ADR' | 'ETF' | 'Index';

export type MarketTideRegime =
  | 'strong_positive'
  | 'strong_negative'
  | 'neutral'
  | 'mixed'
  | 'reversing';

export type FlowAlertRule =
  | 'RepeatedHits'
  | 'RepeatedHitsAscendingFill'
  | 'RepeatedHitsDescendingFill'
  | 'SweepsFollowedByFloor'
  | 'VolumeOverOi'
  | 'FloorTradeLargeCap';

export interface NormalizedOptionPrint {
  event_id: string;
  executed_at_ms: number;
  ticker: string;
  option_symbol: string;
  option_type: OptionType;
  strike: number;
  expiry: string; // YYYY-MM-DD
  dte: number;
  size: number;
  price: number;
  premium: number;
  volume: number;
  open_interest: number;
  side: PrintSide;
  is_sweep: boolean;
  is_multi_leg: boolean;
  is_opening: boolean | null;
  underlying_price: number;
  iv: number;
  delta: number;
  spread: number; // e.g. 0.08 for 8%
  exchange?: string;
  trade_code?: string;
  is_canceled?: boolean;
  issue_type?: IssueType;
  avg_daily_dollar_volume?: number;
  tags?: string[];
  flow_alert_rules?: FlowAlertRule[];
  days_of_oi_increases?: number;
  ask_side_perc_7_day?: number;
}

export interface ContractScreenerSnapshot {
  ticker: string;
  option_symbol: string;
  option_type: OptionType;
  strike: number;
  expiry: string;
  dte: number;
  premium: number;
  volume: number;
  open_interest: number;
  ask_pct: number;
  bid_pct: number;
  otm: boolean;
  multileg_volume_ratio: number;
  spread: number;
  issue_type: IssueType;
  underlying_price: number;
  avg_daily_dollar_volume: number;
  updated_at_ms: number;
}

export interface UnderlyingCandle5m {
  ticker: string;
  window_end_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  relative_volume_5m: number; // e.g., 1.8 for 1.8x
  return_5m: number; // e.g., 0.0124 for +1.24%
}

export interface HistoricalPremiumBaseline {
  ticker: string;
  direction: 'bullish' | 'bearish';
  /** Prior 20 sessions matching 5-minute time-of-day window premiums */
  historical_windows: number[];
}

export interface MarketTideFeaturesInput {
  call_premium_5m: number;
  put_premium_5m: number;
  call_premium_30m: number;
  put_premium_30m: number;
  /** Last >= 3 5-minute net premium observations (in USD or millions) */
  net_premium_5m_series: number[];
  /** Prior 20 sessions same time-of-day 5m net premium observations */
  trailing_20_sessions_same_time_window: number[];
}

export interface MarketTideRegimeEvaluation {
  net_premium_5m: number;
  net_premium_30m: number;
  tide_slope_15m: number;
  tide_zscore: number;
  regime: MarketTideRegime;
  extreme_tide: boolean;
  scanner_profile: string;
  filter_version: string;
}

export interface RegimeScannerFilterSpec {
  regime: MarketTideRegime;
  scanner_profile: string;
  filter_version: string;
  emphasis: string;
  what_to_tighten: string;
  allowed_directions: ('bullish' | 'bearish')[];
  min_premium: number;
  min_directional_side_pct: number;
  min_ask_side_pct?: number;
  min_sweep_ratio: number;
  min_contract_share?: number;
  min_whale_score: number;
  require_vwap_alignment: boolean;
  require_price_confirmation: boolean;
  require_sector_alignment?: boolean;
  max_dte?: number;
  confirmation_window_minutes: number;
  expiry_minutes: number;
  direction_bonus_points: number;
}

export type AdaptiveFilterProfileId =
  | 'risk_on_trend'
  | 'risk_off_trend'
  | 'positive_gamma_range'
  | 'negative_gamma_expansion'
  | 'gamma_flip_transition'
  | 'volatility_stress';

export type MarketStateRegime =
  | 'positive_trend'
  | 'negative_trend'
  | 'positive_gamma_pinning'
  | 'negative_gamma_expansion'
  | 'gamma_flip_transition'
  | 'volatility_stress';

export type ZeroDtePressure = 'bullish' | 'bearish' | 'neutral';
export type GammaRegime =
  | 'positive_gamma'
  | 'negative_gamma'
  | 'near_gamma_flip';
export type VolatilityRegime = 'calm' | 'normal' | 'event_or_stress';

export interface CandidateMarketContext {
  tide_regime: MarketTideRegime;
  tide_zscore: number;
  tide_slope_15m: number;
  tide_alignment: number;
  scanner_profile: string;
  filter_version: string;
  extreme_tide?: boolean;
  hedge_risk_flagged?: boolean;
  /** v2.0 Adaptive State Machine fields */
  profile?: AdaptiveFilterProfileId;
  market_tide_alignment?: number;
  sector_tide_alignment?: number;
  sector_name?: string;
  zero_dte_equity_pressure?: ZeroDtePressure;
  zero_dte_index_pressure?: ZeroDtePressure;
  zero_dte_etf_pressure?: ZeroDtePressure;
}

export interface CandidateGammaContext {
  ticker_spot: number;
  gamma_flip: number;
  call_wall: number;
  put_wall: number;
  gamma_magnet: number;
  spot_vs_flip: 'above' | 'below' | 'near_flip';
  above_gamma_flip: boolean;
  near_magnet: boolean;
  near_gamma_flip: boolean;
  near_flip: boolean;
  breakout_confirmed: boolean;
  gamma_alignment_score: number;
  ticker_gamma_modifier: number;
  require_stronger_confirmation: boolean;
  gex_source_vol_net: number;
  gex_source_oi_net: number;
}

export interface CandidateVolatilityContext {
  iv_7_to_14_dte: number;
  iv_30_to_60_dte: number;
  front_back_iv_ratio: number;
  regime: VolatilityRegime;
}

export interface CandidateDecisionTrace {
  scanner_profile: AdaptiveFilterProfileId;
  base_score: number;
  regime_adjustments: number;
  final_score: number;
  status: CandidateStatus;
  adjustment_breakdown: { label: string; delta: number }[];
  explanation: string;
}

export interface ScannerConfig {
  scanner_id: string;
  name: string;
  mode: ScannerModeId;
  enabled: boolean;
  allow_0dte?: boolean;
  universe: {
    issue_types: IssueType[];
    min_market_cap: number;
    min_underlying_price: number;
    min_avg_daily_dollar_volume: number;
  };
  contract_filters: {
    min_premium: number;
    min_dte: number;
    max_dte: number;
    is_otm: boolean;
    min_volume_oi_ratio: number;
    min_skew: number;
    max_multileg_ratio: number;
    max_spread: number;
    min_ask_side_perc_7_day?: number;
    min_days_of_oi_increases?: number;
    min_sweep_volume_ratio?: number;
    require_repeated_hits_or_sweep?: boolean;
  };
  burst_rules: {
    premium_window_seconds: number;
    min_premium_burst: number;
    premium_multiple_vs_baseline: number;
    min_robust_zscore: number;
    min_contract_share: number;
    min_sweep_ratio: number;
    min_repeated_prints_10s: number;
  };
  confirmation: {
    enabled: boolean;
    candle_minutes: number;
    min_relative_volume: number;
    require_vwap_alignment: boolean;
  };
  min_whale_score: number;
}

export interface WhaleScoreComponents {
  premium: number;
  urgency: number;
  novelty: number;
  concentration: number;
  price_confirmation: number;
  liquidity: number;
  tide_alignment: number;
  market_tide_alignment?: number;
  sector_tide_alignment?: number;
  gamma_alignment?: number;
}

export interface WhaleCandidate {
  candidate_id: string;
  scanner_id: string;
  dedup_key: string;
  detected_at: string;
  detected_at_ms: number;
  last_updated_ms: number;
  ticker: string;
  sector?: string;
  option_symbol: string;
  option_type: OptionType;
  strike: number;
  expiry: string;
  dte: number;
  issue_type: IssueType;
  direction: 'bullish' | 'bearish';
  status: CandidateStatus;
  whale_score: number;
  regime_bonus_applied?: number;
  components: WhaleScoreComponents;
  market_context: CandidateMarketContext;
  gamma_context?: CandidateGammaContext;
  volatility_context?: CandidateVolatilityContext;
  decision?: CandidateDecisionTrace;
  stock_confirmation?: StockConfirmationEvaluation;
  bursts: {

    premium_burst: boolean;
    concentration_burst: boolean;
    urgency_burst: boolean;
    sweep_burst: boolean;
    robust_zscore: number;
    baseline_5m: number;
  };
  flow: {
    premium_1m: number;
    premium_5m: number;
    premium_15m: number;
    contract_premium_5m: number;
    contract_share: number;
    side_share: number;
    sweep_ratio: number;
    multileg_ratio: number;
    volume: number;
    open_interest: number;
    volume_oi_ratio: number;
    oi_status: 'unconfirmed_until_next_oi_update' | 'verified_next_day_oi';
    repeated_hits: boolean;
    trade_count_10s: number;
    aggregate_premium_10s: number;
    flow_alert_rules: FlowAlertRule[];
    spread: number;
    iv: number;
    delta: number;
  };
  underlying: {
    price_at_detection: number;
    return_5m: number;
    relative_volume_5m: number;
    vwap_5m: number;
    vwap_aligned: boolean;
    candle_close_position: number;
    avg_daily_dollar_volume: number;
    high_5m: number;
    low_5m: number;
    open_5m: number;
  };
  flags: string[];
  raw_event_refs: string[];
  aggregation?: ContractActivityAggregation;
}

export interface AggregatedContractPrintItem {
  event_id: string;
  executed_at_ms: number;
  executed_at_iso: string;
  size: number;
  price: number;
  premium: number;
  side: PrintSide;
  is_sweep: boolean;
  is_multi_leg: boolean;
  exchange: string;
  underlying_price: number;
}

export interface ContractActivityAggregation {
  is_aggregated: boolean;
  option_symbol: string;
  aggregated_print_count: number;
  distinct_sweep_count: number;
  distinct_block_count: number;
  first_print_at_ms: number;
  latest_print_at_ms: number;
  aggregation_window_seconds: number;
  cumulative_contracts: number;
  cumulative_premium_dollars: number;
  initial_print_premium_dollars: number;
  latest_print_premium_dollars: number;
  vwap_fill_price: number;
  min_fill_price: number;
  max_fill_price: number;
  price_progression:
    | 'ascending_fills'
    | 'descending_fills'
    | 'steady_accumulation'
    | 'single_print';
  ask_side_contracts_pct: number;
  sweep_premium_pct: number;
  conviction_multiplier: number;
  aggregation_summary: string;
  print_ledger: AggregatedContractPrintItem[];
}

export interface HardRejectEvaluation {
  rejected: boolean;
  reasons: string[];
}

export function clamp(val: number, min = 0, max = 1): number {
  if (Number.isNaN(val)) return min;
  return Math.min(Math.max(val, min), max);
}

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Linear regression slope of last 3 points (normalized in $10M units if values are large USD)
 * tide_slope_15m = linear_regression_slope(net_premium_5m_series[-3:])
 */
export function computeLinearRegressionSlope(series: number[]): number {
  const tail = series.slice(-3);
  if (tail.length < 2) return 0;
  const n = tail.length;
  // Normalize large dollar series by 10_000_000 so slope is readable (e.g. 0.18) while preserving exact sign
  const maxAbs = Math.max(...tail.map((v) => Math.abs(v)), 1);
  const scale = maxAbs > 100_000 ? 10_000_000 : 1;
  const norm = tail.map((v) => v / scale);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += norm[i];
    sumXY += i * norm[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return round2((n * sumXY - sumX * sumY) / denom);
}

/**
 * Standard Z-Score against trailing 20 sessions same time window
 */
export function computeStandardZScore(
  value: number,
  trailingSeries: number[]
): number {
  if (!trailingSeries || trailingSeries.length === 0) return 0;
  const mean =
    trailingSeries.reduce((acc, v) => acc + v, 0) / trailingSeries.length;
  const variance =
    trailingSeries.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
    trailingSeries.length;
  const stdDev = Math.max(Math.sqrt(variance), 1);
  return round2((value - mean) / stdDev);
}

/**
 * Recommended Market Tide Regime Definitions:
 * net_premium_5m = call_premium_5m - put_premium_5m
 * net_premium_30m = call_premium_30m - put_premium_30m
 * tide_slope_15m = linear_regression_slope(net_premium_5m_series[-3:])
 * tide_zscore = zscore(net_premium_5m, trailing_20_sessions_same_time_window)
 *
 * if tide_zscore >= 2 and tide_slope_15m > 0: regime = "strong_positive"
 * elif tide_zscore <= -2 and tide_slope_15m < 0: regime = "strong_negative"
 * elif abs(tide_zscore) < 0.75: regime = "neutral"
 * elif sign(net_premium_5m) != sign(net_premium_30m): regime = "reversing"
 * else: regime = "mixed"
 */
export function evaluateMarketTideFeatures(
  input: MarketTideFeaturesInput
): MarketTideRegimeEvaluation {
  const net_premium_5m = input.call_premium_5m - input.put_premium_5m;
  const net_premium_30m = input.call_premium_30m - input.put_premium_30m;
  const tide_slope_15m = computeLinearRegressionSlope(
    input.net_premium_5m_series
  );
  const tide_zscore = computeStandardZScore(
    net_premium_5m,
    input.trailing_20_sessions_same_time_window
  );

  let regime: MarketTideRegime;
  if (tide_zscore >= 2 && tide_slope_15m > 0) {
    regime = 'strong_positive';
  } else if (tide_zscore <= -2 && tide_slope_15m < 0) {
    regime = 'strong_negative';
  } else if (Math.abs(tide_zscore) < 0.75) {
    regime = 'neutral';
  } else if (Math.sign(net_premium_5m) !== Math.sign(net_premium_30m)) {
    regime = 'reversing';
  } else {
    regime = 'mixed';
  }

  const extreme_tide = Math.abs(tide_zscore) >= 3.0;
  const profileSpec = REGIME_SCANNER_PROFILES[regime];

  return {
    net_premium_5m,
    net_premium_30m,
    tide_slope_15m,
    tide_zscore,
    regime,
    extreme_tide,
    scanner_profile: profileSpec.scanner_profile,
    filter_version: profileSpec.filter_version,
  };
}

/**
 * Regime-Specific Scanner Filter Profiles (v1.1)
 */
export const REGIME_SCANNER_PROFILES: Record<
  MarketTideRegime,
  RegimeScannerFilterSpec
> = {
  strong_positive: {
    regime: 'strong_positive',
    scanner_profile: 'risk_on_directional',
    filter_version: 'v1.1',
    emphasis: 'Bullish call flow',
    what_to_tighten: 'Ask-side calls, upward price/VWAP confirmation',
    allowed_directions: ['bullish'],
    min_premium: 75_000,
    min_directional_side_pct: 0.7,
    min_ask_side_pct: 0.7,
    min_sweep_ratio: 0.3,
    min_whale_score: 65,
    require_vwap_alignment: true,
    require_price_confirmation: true,
    max_dte: 45,
    confirmation_window_minutes: 5,
    expiry_minutes: 30,
    direction_bonus_points: 8,
  },
  strong_negative: {
    regime: 'strong_negative',
    scanner_profile: 'risk_off_directional',
    filter_version: 'v1.1',
    emphasis: 'Bearish put flow',
    what_to_tighten:
      'Ask-side puts or bid-side calls, downside VWAP & weak candle close confirmation',
    allowed_directions: ['bearish'],
    min_premium: 75_000,
    min_directional_side_pct: 0.7,
    min_sweep_ratio: 0.3,
    min_whale_score: 65,
    require_vwap_alignment: true,
    require_price_confirmation: true,
    max_dte: 45,
    confirmation_window_minutes: 5,
    expiry_minutes: 30,
    direction_bonus_points: 8,
  },
  neutral: {
    regime: 'neutral',
    scanner_profile: 'idiosyncratic_single_name',
    filter_version: 'v1.1',
    emphasis: 'Idiosyncratic flow only',
    what_to_tighten:
      'Larger premium ($200K+), higher score (75+), stronger ticker-relative move & contract share (>=45%)',
    allowed_directions: ['bullish', 'bearish'],
    min_premium: 200_000,
    min_directional_side_pct: 0.8,
    min_sweep_ratio: 0.5,
    min_contract_share: 0.45,
    min_whale_score: 75,
    require_vwap_alignment: true,
    require_price_confirmation: true,
    require_sector_alignment: true,
    confirmation_window_minutes: 5,
    expiry_minutes: 30,
    direction_bonus_points: 0,
  },
  mixed: {
    regime: 'mixed',
    scanner_profile: 'idiosyncratic_single_name',
    filter_version: 'v1.1',
    emphasis: 'Idiosyncratic flow only',
    what_to_tighten:
      'Larger premium ($200K+), higher score (75+), stronger ticker-relative move & contract share (>=45%)',
    allowed_directions: ['bullish', 'bearish'],
    min_premium: 200_000,
    min_directional_side_pct: 0.8,
    min_sweep_ratio: 0.5,
    min_contract_share: 0.45,
    min_whale_score: 75,
    require_vwap_alignment: true,
    require_price_confirmation: true,
    require_sector_alignment: true,
    confirmation_window_minutes: 5,
    expiry_minutes: 30,
    direction_bonus_points: 0,
  },
  reversing: {
    regime: 'reversing',
    scanner_profile: 'reversing_short_momentum',
    filter_version: 'v1.1',
    emphasis: 'Short-lived momentum only',
    what_to_tighten:
      'Shorter event windows (3m confirmation, 15m expiry); require $250K+ premium & immediate price confirmation',
    allowed_directions: ['bullish', 'bearish'],
    min_premium: 250_000,
    min_directional_side_pct: 0.8,
    min_sweep_ratio: 0.5,
    min_whale_score: 80,
    require_vwap_alignment: true,
    require_price_confirmation: true,
    confirmation_window_minutes: 3,
    expiry_minutes: 15,
    direction_bonus_points: 0,
  },
};

export function getRegimeScannerProfile(
  regime: MarketTideRegime
): RegimeScannerFilterSpec {
  return REGIME_SCANNER_PROFILES[regime] ?? REGIME_SCANNER_PROFILES.neutral;
}

/**
 * Tide-Alignment Score:
 * tide_alignment = 0.5  # neutral baseline
 * if market_regime == "strong_positive" and direction == "bullish": tide_alignment = 1.0
 * elif market_regime == "strong_negative" and direction == "bearish": tide_alignment = 1.0
 * elif market_regime in ["strong_positive", "strong_negative"]: tide_alignment = 0.0
 * elif market_regime == "reversing": tide_alignment = 0.25
 */
export function computeTideAlignmentScore(
  market_regime: MarketTideRegime,
  direction: 'bullish' | 'bearish'
): number {
  if (market_regime === 'strong_positive' && direction === 'bullish') {
    return 1.0;
  }
  if (market_regime === 'strong_negative' && direction === 'bearish') {
    return 1.0;
  }
  if (
    market_regime === 'strong_positive' ||
    market_regime === 'strong_negative'
  ) {
    return 0.0;
  }
  if (market_regime === 'reversing') {
    return 0.25;
  }
  return 0.5;
}

/**
 * Deterministic trade deduplication ID generator when provider event_id is absent:
 * option_symbol + executed_at_ms + price + size + exchange + trade_code
 */
export function computePrintEventId(
  print: Partial<NormalizedOptionPrint>
): string {
  if (print.event_id && print.event_id.trim().length > 0) {
    return print.event_id.trim();
  }
  const raw = [
    print.option_symbol ?? '',
    String(print.executed_at_ms ?? 0),
    String(print.price ?? 0),
    String(print.size ?? 0),
    print.exchange ?? 'UNK',
    print.trade_code ?? 'REG',
  ].join('|');

  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `hash-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Section 5: Direction Mapping
 */
export function classifyPrintDirection(
  option_type: OptionType,
  side: PrintSide
): FlowDirection {
  if (option_type === 'call' && side === 'ask') return 'bullish';
  if (option_type === 'put' && side === 'ask') return 'bearish';
  if (option_type === 'call' && side === 'bid') return 'bearish';
  if (option_type === 'put' && side === 'bid') return 'bullish';
  return 'ambiguous';
}

/**
 * Section 4A: Contract Screener Consumer Filter (30-minute TTL cache eligibility)
 */
export function passesContractScreenerFilter(
  snapshot: ContractScreenerSnapshot
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const volOiRatio = snapshot.volume / Math.max(snapshot.open_interest, 1);
  const maxSidePct = Math.max(snapshot.ask_pct, snapshot.bid_pct);

  if (snapshot.premium < 50_000) {
    reasons.push('premium < $50,000');
  }
  if (snapshot.volume < 200) {
    reasons.push('volume < 200');
  }
  if (volOiRatio < 1.0) {
    reasons.push('volume / max(OI, 1) < 1.0');
  }
  if (maxSidePct < 0.7) {
    reasons.push('max(ask_pct, bid_pct) < 0.70');
  }
  if (snapshot.dte < 7 || snapshot.dte > 60) {
    reasons.push('DTE outside 7..60 range');
  }
  if (!snapshot.otm) {
    reasons.push('OTM !== true');
  }
  if (snapshot.multileg_volume_ratio > 0.35) {
    reasons.push('multileg_volume_ratio > 0.35');
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Median helper for historical baseline & MAD calculations
 */
export function computeMedian(values: number[]): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function computeRobustZScore(
  value: number,
  baseline: number,
  mad: number
): number {
  const denom = Math.max(mad * 1.4826, 1);
  return (value - baseline) / denom;
}

/**
 * Section 5A: Premium Burst
 */
export function evaluatePremiumBurst(
  premium_5m: number,
  historicalWindows?: number[]
): {
  premium_burst: boolean;
  baseline: number;
  mad: number;
  robust_zscore: number;
  used_fallback: boolean;
} {
  if (!historicalWindows || historicalWindows.length < 5) {
    return {
      premium_burst: premium_5m >= 250_000,
      baseline: 0,
      mad: 0,
      robust_zscore: premium_5m >= 250_000 ? 4.0 : round2(premium_5m / 62_500),
      used_fallback: true,
    };
  }

  const baseline = computeMedian(historicalWindows);
  const deviations = historicalWindows.map((x) => Math.abs(x - baseline));
  const mad = computeMedian(deviations);
  const zscore = computeRobustZScore(premium_5m, baseline, mad);

  const premium_burst =
    premium_5m >= 100_000 &&
    premium_5m >= 4 * Math.max(baseline, 1) &&
    zscore >= 3;

  return {
    premium_burst,
    baseline: Math.round(baseline),
    mad: Math.round(mad),
    robust_zscore: round2(zscore),
    used_fallback: false,
  };
}

/**
 * Section 5B: Contract Concentration Burst
 */
export function evaluateConcentrationBurst(
  contract_directional_premium_5m: number,
  ticker_directional_premium_5m: number
): {
  concentration_burst: boolean;
  contract_share: number;
} {
  const contract_share =
    ticker_directional_premium_5m > 0
      ? contract_directional_premium_5m / ticker_directional_premium_5m
      : 0;
  const concentration_burst =
    contract_share >= 0.35 && contract_directional_premium_5m >= 50_000;
  return {
    concentration_burst,
    contract_share: round2(contract_share),
  };
}

/**
 * Section 5C: Execution Urgency Burst
 */
export function evaluateUrgencyBurst(
  trade_count_same_contract_10s: number,
  aggregate_premium_same_contract_10s: number,
  dominant_side_share: number,
  flow_alert_rules: FlowAlertRule[] = []
): {
  urgency_burst: boolean;
  boosted_by_alert: boolean;
} {
  const highPriorityAlerts: FlowAlertRule[] = [
    'RepeatedHits',
    'RepeatedHitsAscendingFill',
    'RepeatedHitsDescendingFill',
    'SweepsFollowedByFloor',
  ];
  const boosted_by_alert = flow_alert_rules.some((r) =>
    highPriorityAlerts.includes(r)
  );
  const urgency_burst =
    trade_count_same_contract_10s >= 3 &&
    aggregate_premium_same_contract_10s >= 100_000 &&
    dominant_side_share >= 0.7;

  return {
    urgency_burst,
    boosted_by_alert,
  };
}

/**
 * Section 5D: Sweep Burst
 */
export function evaluateSweepBurst(
  sweep_premium_5m: number,
  directional_premium_5m: number
): {
  sweep_burst: boolean;
  sweep_ratio: number;
} {
  const sweep_ratio =
    directional_premium_5m > 0
      ? sweep_premium_5m / directional_premium_5m
      : 0;
  const sweep_burst = sweep_premium_5m >= 100_000 && sweep_ratio >= 0.5;
  return {
    sweep_burst,
    sweep_ratio: round2(sweep_ratio),
  };
}

/**
 * Section 5E: Underlying Candle Confirmation
 * close_position = (close - low) / max(high - low, 0.0001)
 */
export function evaluateCandleConfirmation(
  direction: 'bullish' | 'bearish',
  candle: UnderlyingCandle5m
): {
  confirmed: boolean;
  close_position: number;
  directionally_correct_return: number;
  vwap_alignment: number;
  relative_volume_confirmation: number;
  candle_close_position_confirmation: number;
} {
  const close_position = clamp(
    (candle.close - candle.low) / Math.max(candle.high - candle.low, 0.0001),
    0,
    1
  );

  const isBullish = direction === 'bullish';
  const returnOk = isBullish ? candle.return_5m > 0 : candle.return_5m < 0;
  const vwapOk = isBullish
    ? candle.close > candle.vwap
    : candle.close < candle.vwap;
  const rvolOk = candle.relative_volume_5m >= 1.5;
  const posOk = isBullish ? close_position >= 0.65 : close_position <= 0.35;

  const confirmed = returnOk && vwapOk && rvolOk && posOk;

  const directionally_correct_return = returnOk
    ? clamp(Math.abs(candle.return_5m) / 0.006, 0.6, 1.0)
    : 0;
  const vwap_alignment = vwapOk ? 1.0 : 0.0;
  const relative_volume_confirmation = rvolOk
    ? 1.0
    : clamp(candle.relative_volume_5m / 1.5, 0, 0.85);
  const candle_close_position_confirmation = posOk
    ? 1.0
    : isBullish
      ? clamp(close_position / 0.65, 0, 0.8)
      : clamp((1 - close_position) / 0.65, 0, 0.8);

  return {
    confirmed,
    close_position: round2(close_position),
    directionally_correct_return: round2(directionally_correct_return),
    vwap_alignment: round2(vwap_alignment),
    relative_volume_confirmation: round2(relative_volume_confirmation),
    candle_close_position_confirmation: round2(
      candle_close_position_confirmation
    ),
  };
}

/**
 * Section 6 (v1.1): Deterministic 7-Factor Whale Score (0-100) with Market Tide Alignment
 *
 * Standard Reweighted Formula:
 * whale_score = (
 *   0.22 * premium_score
 * + 0.18 * urgency_score
 * + 0.14 * novelty_score
 * + 0.14 * concentration_score
 * + 0.17 * price_confirmation_score
 * + 0.08 * liquidity_score
 * + 0.07 * tide_alignment
 * ) * 100
 *
 * In a neutral regime, ticker-level price confirmation is weighted higher than tide alignment:
 * price_confirmation weight = 0.21, tide_alignment weight = 0.03.
 *
 * Bonus scoring:
 * - Strong positive tide & bullish: +8 points
 * - Strong negative tide & bearish: +8 points
 */
export function computeWhaleScore(params: {
  premium_5m: number;
  sweep_ratio: number;
  repeated_hit_flag: boolean;
  dominant_side_share: number;
  volume: number;
  open_interest: number;
  contract_share: number;
  direction: 'bullish' | 'bearish';
  candle: UnderlyingCandle5m;
  spread: number;
  avg_daily_dollar_volume: number;
  market_regime?: MarketTideRegime;
}): {
  whale_score: number;
  regime_bonus_applied: number;
  components: WhaleScoreComponents;
  price_confirmed: boolean;
  close_position: number;
  vwap_aligned: boolean;
} {
  // 1. Premium score: clamp(log10(premium_5m / 50_000) / log10(20), 0, 1)
  const rawPremRatio = Math.max(params.premium_5m / 50_000, 0.0001);
  const premium_score = clamp(
    Math.log10(rawPremRatio) / Math.log10(20),
    0,
    1
  );

  // 2. Urgency score: 0.40 * sweep_ratio + 0.35 * repeated_hit_flag + 0.25 * dominant_side_share
  const urgency_score = clamp(
    0.4 * clamp(params.sweep_ratio, 0, 1) +
      0.35 * (params.repeated_hit_flag ? 1 : 0) +
      0.25 * clamp(params.dominant_side_share, 0, 1),
    0,
    1
  );

  // 3. Novelty score: clamp((volume / max(open_interest, 1)) / 5, 0, 1)
  const volOiRatio = params.volume / Math.max(params.open_interest, 1);
  const novelty_score = clamp(volOiRatio / 5, 0, 1);

  // 4. Concentration score: clamp(contract_share / 0.60, 0, 1)
  const concentration_score = clamp(params.contract_share / 0.6, 0, 1);

  // 5. Price-confirmation score
  const candleEval = evaluateCandleConfirmation(
    params.direction,
    params.candle
  );
  const price_confirmation_score = clamp(
    0.4 * candleEval.directionally_correct_return +
      0.3 * candleEval.vwap_alignment +
      0.2 * candleEval.relative_volume_confirmation +
      0.1 * candleEval.candle_close_position_confirmation,
    0,
    1
  );

  // 6. Liquidity score
  const tight_contract_spread =
    params.spread <= 0.15
      ? 1.0
      : clamp((0.25 - params.spread) / 0.1, 0, 1);
  const minimum_open_interest =
    params.open_interest >= 500
      ? 1.0
      : clamp(params.open_interest / 500, 0, 1);
  const minimum_underlying_volume =
    params.avg_daily_dollar_volume >= 20_000_000
      ? 1.0
      : clamp(params.avg_daily_dollar_volume / 20_000_000, 0, 1);

  const liquidity_score = clamp(
    0.5 * tight_contract_spread +
      0.25 * minimum_open_interest +
      0.25 * minimum_underlying_volume,
    0,
    1
  );

  // 7. Tide-alignment score
  const regime = params.market_regime ?? 'strong_positive';
  const tide_alignment = computeTideAlignmentScore(regime, params.direction);

  // In a neutral regime, make ticker-level price confirmation more important than tide alignment
  const isNeutralRegime = regime === 'neutral';
  const priceWeight = isNeutralRegime ? 21 : 17;
  const tideWeight = isNeutralRegime ? 3 : 7;

  let rawTotal =
    22 * premium_score +
    18 * urgency_score +
    14 * novelty_score +
    14 * concentration_score +
    priceWeight * price_confirmation_score +
    8 * liquidity_score +
    tideWeight * tide_alignment;

  let regime_bonus_applied = 0;
  if (regime === 'strong_positive' && params.direction === 'bullish') {
    regime_bonus_applied = 8;
    rawTotal += 8;
  } else if (regime === 'strong_negative' && params.direction === 'bearish') {
    regime_bonus_applied = 8;
    rawTotal += 8;
  }

  return {
    whale_score: Math.round(clamp(rawTotal, 0, 100)),
    regime_bonus_applied,
    components: {
      premium: round2(premium_score),
      urgency: round2(urgency_score),
      novelty: round2(novelty_score),
      concentration: round2(concentration_score),
      price_confirmation: round2(price_confirmation_score),
      liquidity: round2(liquidity_score),
      tide_alignment: round2(tide_alignment),
    },
    price_confirmed: candleEval.confirmed,
    close_position: candleEval.close_position,
    vwap_aligned: candleEval.vwap_alignment === 1.0,
  };
}

/**
 * Evaluate whether a candidate satisfies the active Market Tide Regime filter rules (v1.1)
 * Note:
 * - Strong positive tide prioritizes bullish names, but does not automatically reject puts
 *   if they exhibit exceptional contrarian/hedge conviction (premium >= $300K, side_share >= 0.80, price_confirmed).
 * - Strong negative tide prioritizes bearish ask-side puts and bid-side calls, requiring
 *   the underlying to be below VWAP and closing weakly within its candle (or exceptional contrarian conviction).
 */
export function evaluateCandidateAgainstRegimeFilters(
  candidate: WhaleCandidate,
  regime: MarketTideRegime,
  extremeTide = false
): { passed: boolean; reasons: string[] } {
  const spec = getRegimeScannerProfile(regime);
  const reasons: string[] = [];

  if (candidate.flow.premium_5m < spec.min_premium) {
    reasons.push(
      `5m premium ($${(candidate.flow.premium_5m / 1000).toFixed(0)}K) < regime min ($${(spec.min_premium / 1000).toFixed(0)}K)`
    );
  }

  if (candidate.flow.side_share < spec.min_directional_side_pct) {
    reasons.push(
      `Directional side share (${Math.round(candidate.flow.side_share * 100)}%) < regime min (${Math.round(spec.min_directional_side_pct * 100)}%)`
    );
  }

  if (candidate.flow.sweep_ratio < spec.min_sweep_ratio) {
    reasons.push(
      `Sweep ratio (${Math.round(candidate.flow.sweep_ratio * 100)}%) < regime min (${Math.round(spec.min_sweep_ratio * 100)}%)`
    );
  }

  if (
    spec.min_contract_share !== undefined &&
    candidate.flow.contract_share < spec.min_contract_share
  ) {
    reasons.push(
      `Contract share (${Math.round(candidate.flow.contract_share * 100)}%) < regime min (${Math.round(spec.min_contract_share * 100)}%)`
    );
  }

  if (spec.max_dte !== undefined && candidate.dte > spec.max_dte) {
    reasons.push(`DTE (${candidate.dte}) > regime max (${spec.max_dte})`);
  }

  if (candidate.whale_score < spec.min_whale_score) {
    reasons.push(
      `Whale score (${candidate.whale_score}) < regime min (${spec.min_whale_score})`
    );
  }

  if (spec.require_vwap_alignment && !candidate.underlying.vwap_aligned) {
    reasons.push('Underlying 5m close is not aligned with 5m VWAP');
  }

  if (spec.require_price_confirmation && candidate.status !== 'confirmed') {
    reasons.push('Candidate lacks required 5m underlying price confirmation');
  }

  if (!spec.allowed_directions.includes(candidate.direction)) {
    reasons.push(
      `Direction (${candidate.direction}) not in regime allowed_directions [${spec.allowed_directions.join(', ')}]`
    );
  }

  // In strong_negative, bearish candidates must be below VWAP and closing weakly within their candle (<= 0.35)
  if (regime === 'strong_negative' && candidate.direction === 'bearish') {
    if (
      !candidate.underlying.vwap_aligned ||
      candidate.underlying.candle_close_position > 0.35
    ) {
      reasons.push(
        'Strong negative tide requires underlying below VWAP and closing weakly within candle (<= 0.35)'
      );
    }
  }

  // Extreme tide demands stronger liquidity (spread <= 0.08, OI >= 800)
  if (extremeTide) {
    if (candidate.flow.spread > 0.08 || candidate.flow.open_interest < 700) {
      reasons.push(
        'Extreme tide demands tighter spread (<=8%) and deeper open interest (>=700)'
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Section 7: Hard Reject Rules
 */
export function evaluateHardRejectRules(params: {
  is_canceled?: boolean;
  premium: number;
  spread: number;
  dte: number;
  underlying_price: number;
  avg_daily_dollar_volume: number;
  multileg_directional_share: number;
  tags?: string[];
  allow_0dte?: boolean;
  direction: FlowDirection;
  dominant_side_share: number;
}): HardRejectEvaluation {
  const reasons: string[] = [];

  if (params.is_canceled) {
    reasons.push('Canceled trade print');
  }
  if (!params.premium || params.premium <= 0) {
    reasons.push('Unknown or zero option premium');
  }
  if (params.spread > 0.25) {
    reasons.push(
      `Option spread (${(params.spread * 100).toFixed(1)}%) exceeds 25% hard limit`
    );
  }
  if (params.dte < 0) {
    reasons.push('Option contract is expired (DTE < 0)');
  }
  if (!params.underlying_price || params.underlying_price <= 0) {
    reasons.push('Contract has no reliable underlying price');
  }
  if (params.avg_daily_dollar_volume < 10_000_000) {
    reasons.push('Underlying average daily dollar volume < $10M');
  }
  if (params.multileg_directional_share > 0.5) {
    reasons.push('Multi-leg prints exceed 50% of directional premium');
  }

  const excludedTags = ['dividend', 'arbitrage', 'volatility'];
  if (
    params.tags &&
    params.tags.some((t) => excludedTags.includes(t.toLowerCase()))
  ) {
    reasons.push('Dividend, arbitrage, or volatility strategy tags dominate');
  }

  if (params.dte === 0 && !params.allow_0dte) {
    reasons.push(
      'Contract is 0DTE and scanner mode does not explicitly permit 0DTE'
    );
  }

  if (params.direction === 'ambiguous' || params.dominant_side_share < 0.5) {
    reasons.push(
      'No-sided or midpoint prints dominate; directional classification is ambiguous'
    );
  }

  return {
    rejected: reasons.length > 0,
    reasons,
  };
}

/**
 * Section 8: Default Scanner Modes
 */
export const DEFAULT_SCANNER_MODES: Record<ScannerModeId, ScannerConfig> = {
  directional_momentum: {
    scanner_id: 'scn-directional-momentum-v1',
    name: 'Directional Momentum',
    mode: 'directional_momentum',
    enabled: true,
    allow_0dte: false,
    universe: {
      issue_types: ['Common Stock', 'ADR'],
      min_market_cap: 2_000_000_000,
      min_underlying_price: 10,
      min_avg_daily_dollar_volume: 20_000_000,
    },
    contract_filters: {
      min_premium: 100_000,
      min_dte: 7,
      max_dte: 65,
      is_otm: true,
      min_volume_oi_ratio: 1.0,
      min_skew: 0.7,
      max_multileg_ratio: 0.35,
      max_spread: 0.15,
    },
    burst_rules: {
      premium_window_seconds: 300,
      min_premium_burst: 100_000,
      premium_multiple_vs_baseline: 4,
      min_robust_zscore: 3,
      min_contract_share: 0.35,
      min_sweep_ratio: 0.5,
      min_repeated_prints_10s: 3,
    },
    confirmation: {
      enabled: true,
      candle_minutes: 5,
      min_relative_volume: 1.5,
      require_vwap_alignment: true,
    },
    min_whale_score: 70,
  },
  accumulation_watch: {
    scanner_id: 'scn-accumulation-watch-v1',
    name: 'Accumulation Watch',
    mode: 'accumulation_watch',
    enabled: true,
    allow_0dte: false,
    universe: {
      issue_types: ['Common Stock', 'ADR'],
      min_market_cap: 2_000_000_000,
      min_underlying_price: 10,
      min_avg_daily_dollar_volume: 20_000_000,
    },
    contract_filters: {
      min_premium: 50_000,
      min_dte: 10,
      max_dte: 90,
      is_otm: true,
      min_volume_oi_ratio: 0.75,
      min_skew: 0.7,
      max_multileg_ratio: 0.35,
      max_spread: 0.15,
      min_ask_side_perc_7_day: 0.7,
      min_days_of_oi_increases: 2,
    },
    burst_rules: {
      premium_window_seconds: 300,
      min_premium_burst: 50_000,
      premium_multiple_vs_baseline: 2.5,
      min_robust_zscore: 2,
      min_contract_share: 0.3,
      min_sweep_ratio: 0.25,
      min_repeated_prints_10s: 2,
    },
    confirmation: {
      enabled: false,
      candle_minutes: 5,
      min_relative_volume: 1.2,
      require_vwap_alignment: false,
    },
    min_whale_score: 62,
  },
  urgent_flow: {
    scanner_id: 'scn-urgent-flow-v1',
    name: 'Urgent Flow',
    mode: 'urgent_flow',
    enabled: true,
    allow_0dte: false,
    universe: {
      issue_types: ['Common Stock', 'ADR'],
      min_market_cap: 2_000_000_000,
      min_underlying_price: 10,
      min_avg_daily_dollar_volume: 20_000_000,
    },
    contract_filters: {
      min_premium: 250_000,
      min_dte: 7,
      max_dte: 45,
      is_otm: true,
      min_volume_oi_ratio: 1.0,
      min_skew: 0.8,
      max_multileg_ratio: 0.35,
      max_spread: 0.15,
      min_sweep_volume_ratio: 0.5,
      require_repeated_hits_or_sweep: true,
    },
    burst_rules: {
      premium_window_seconds: 300,
      min_premium_burst: 250_000,
      premium_multiple_vs_baseline: 4,
      min_robust_zscore: 3.5,
      min_contract_share: 0.4,
      min_sweep_ratio: 0.5,
      min_repeated_prints_10s: 3,
    },
    confirmation: {
      enabled: true,
      candle_minutes: 5,
      min_relative_volume: 1.5,
      require_vwap_alignment: true,
    },
    min_whale_score: 75,
  },
};

/**
 * Candidate lifecycle transition logic:
 * new -> needs_confirmation -> confirmed -> expired -> invalidated
 * Supports regime-specific confirmation_window_minutes and expiry_minutes (e.g. reversing tide: 3m confirm / 15m expiry)
 */
export function resolveCandidateLifecycleStatus(params: {
  whale_score: number;
  min_whale_score: number;
  price_confirmed: boolean;
  require_price_confirmation: boolean;
  age_minutes: number;
  confirmation_window_minutes?: number;
  expiry_minutes?: number;
  conflicting_opposite_flow_ratio?: number;
  conflicting_price_reversal?: boolean;
}): CandidateStatus {
  if (
    (params.conflicting_opposite_flow_ratio &&
      params.conflicting_opposite_flow_ratio > 0.65) ||
    params.conflicting_price_reversal
  ) {
    return 'invalidated';
  }

  const expiryMins = params.expiry_minutes ?? 30;
  const confirmWinMins = params.confirmation_window_minutes ?? 30;

  if (params.age_minutes > expiryMins && !params.price_confirmed) {
    return 'expired';
  }

  // In reversing tide, do not elevate a candidate if the underlying fails to move in the intended direction within confirmation_window_minutes
  if (
    params.require_price_confirmation &&
    !params.price_confirmed &&
    params.age_minutes > confirmWinMins
  ) {
    return 'expired';
  }

  if (params.price_confirmed && params.whale_score >= params.min_whale_score) {
    return 'confirmed';
  }

  if (!params.price_confirmed) {
    return 'needs_confirmation';
  }

  return 'new';
}

/**
 * Build Initial Market-Wide Server Filter URL per Section 3
 */
export function buildUnusualActivityDiscoveryUrl(
  baseUrl = 'https://api.unusualwhales.com/api'
): string {
  const params = new URLSearchParams();
  params.set('min_premium', '50000');
  params.set('min_dte', '7');
  params.set('max_dte', '60');
  params.set('min_volume_oi_ratio', '1.0');
  params.set('min_skew_perc', '0.70');
  params.set('max_multileg_volume_ratio', '0.35');
  params.append('issue_types[]', 'Common Stock');
  params.append('issue_types[]', 'ADR');
  params.set('order', 'premium');
  params.set('order_direction', 'desc');
  params.set('limit', '200');
  return `${baseUrl}/option-activity/unusual?${params.toString()}`;
}

/**
 * ============================================================================
 * ADAPTIVE WHALE SCANNER: MARKET-REGIME FILTER SYSTEM (v2.0 STATE MACHINE)
 * ============================================================================
 */

export interface AdaptiveRefreshLayerSpec {
  layer: string;
  api_or_stream: string;
  refresh: string;
  purpose: string;
}

export const ADAPTIVE_INPUT_REFRESH_SCHEDULE: AdaptiveRefreshLayerSpec[] = [
  {
    layer: 'Market flow',
    api_or_stream: 'get_market_tide / market_tide stream',
    refresh: '1–5 min',
    purpose: 'Net call/put premium 5m & 30m, slope_15m, zscore_5m, persistence',
  },
  {
    layer: 'Sector flow',
    api_or_stream: 'get_market_sector_tide',
    refresh: '5 min',
    purpose: 'Sector-level alignment validation for single-stock candidates',
  },
  {
    layer: 'ETF-holdings flow',
    api_or_stream: 'get_market_etf_tide',
    refresh: '5 min',
    purpose: 'Benchmark ETF underlying basket options pressure',
  },
  {
    layer: '0DTE pressure',
    api_or_stream: 'get_expiry_tide',
    refresh: '5 min',
    purpose:
      'Isolate index_pressure, etf_pressure, and equity_pressure to filter index hedge distortion',
  },
  {
    layer: 'Market gamma levels',
    api_or_stream: 'get_gex_levels (SPY, QQQ, IWM)',
    refresh: 'Open + hourly',
    purpose:
      'Spot vs gamma_flip, call_wall, put_wall, gamma_magnet (source="vol" & source="oi")',
  },
  {
    layer: 'Ticker GEX profile',
    api_or_stream:
      'get_greek_exposure_by_strike, get_greek_exposure_by_expiry',
    refresh: 'On candidate creation',
    purpose:
      'Breakout above call wall / below put wall (+6), magnet pinning (-8), flip instability (-5)',
  },
  {
    layer: 'Ticker volatility',
    api_or_stream: 'get_implied_volatility_term_structure',
    refresh: 'On candidate creation',
    purpose: 'front_back_iv_ratio = iv_7_to_14_dte / iv_30_to_60_dte',
  },
  {
    layer: 'Raw prints',
    api_or_stream: 'get_option_trades / live flow WebSocket',
    refresh: 'Continuous',
    purpose: 'Real-time ask/bid print ingestion and event deduplication',
  },
  {
    layer: 'Rule clusters',
    api_or_stream: 'get_flow_alerts',
    refresh: 'Continuous / 5 min',
    purpose:
      'RepeatedHits, AscendingFill, SweepsFollowedByFloor cluster triggers',
  },
  {
    layer: 'Underlying candles',
    api_or_stream: 'get_ticker_candles_by_range',
    refresh: '1–5 min',
    purpose: '5m return, relative volume, VWAP alignment, and range breakout',
  },
  {
    layer: 'Broad contract discovery',
    api_or_stream: 'get_options_screener',
    refresh: '5 min',
    purpose: 'Market-wide unusual contract seed and OTM/skew filtering',
  },
  {
    layer: 'OI validation',
    api_or_stream: 'get_open_interest_changes',
    refresh: 'Daily, after OI updates',
    purpose:
      'Next-session verification of true opening positions vs intraday churn',
  },
];

export interface MarketStateObject {
  as_of: string;
  market_regime: MarketStateRegime;
  market_tide: {
    net_premium_5m: number;
    net_premium_30m: number;
    zscore_5m: number;
    slope_15m: number;
    persistence: number;
    bullish_minutes_last_30m: number;
    bearish_minutes_last_30m: number;
    tide_direction: -1 | 0 | 1;
    persistent_bullish_tide: boolean;
    persistent_bearish_tide: boolean;
  };
  zero_dte: {
    index_pressure: ZeroDtePressure;
    etf_pressure: ZeroDtePressure;
    equity_pressure: ZeroDtePressure;
    index_dominates_total_flow: boolean;
  };
  gex: {
    spy_spot: number;
    spy_gamma_flip: number;
    spy_call_wall: number;
    spy_put_wall: number;
    spy_gamma_magnet: number;
    qqq_spot: number;
    qqq_gamma_flip: number;
    iwm_spot: number;
    iwm_gamma_flip: number;
    distance_to_flip_pct: number;
    regime: GammaRegime;
    source_vol_net_gex_m: number;
    source_oi_net_gex_m: number;
    near_magnet_or_wall: boolean;
    realized_intraday_range_elevated: boolean;
  };
  volatility_regime: VolatilityRegime;
  front_back_iv_ratio: number;
  iv_7_to_14_dte: number;
  iv_30_to_60_dte: number;
  active_filter_profile: AdaptiveFilterProfileId;
  sector_tides: Record<
    string,
    {
      sector: string;
      net_premium_5m: number;
      direction: 'bullish' | 'bearish' | 'neutral';
      strongly_opposes_bullish: boolean;
      strongly_opposes_bearish: boolean;
    }
  >;
}

export interface AdaptiveFilterProfileSpec {
  profile: AdaptiveFilterProfileId;
  title: string;
  market_regime: MarketStateRegime;
  activation_summary: string;
  focus_summary: string;
  directions: ('bullish' | 'bearish' | 'ambiguous')[];
  min_premium: number;
  min_ask_perc?: number;
  min_directional_side_perc: number;
  min_volume_oi_ratio: number;
  min_dte: number;
  max_dte: number;
  is_otm: boolean;
  max_multileg_ratio: number;
  min_sweep_ratio?: number;
  min_contract_share?: number;
  require_repeated_hits_or_sweep?: boolean;
  min_whale_score: number;
  candidate_ttl_minutes: number;
  price_confirmation: {
    required: boolean;
    above_vwap?: boolean;
    below_vwap?: boolean;
    breakout_or_breakdown_required?: boolean;
    confirmation_window_minutes?: number;
    relative_volume_min: number;
    must_break_5m_range?: boolean;
    must_hold_beyond_gamma_flip?: boolean;
  };
  labels?: string[];
}

export const ADAPTIVE_FILTER_PROFILES: Record<
  AdaptiveFilterProfileId,
  AdaptiveFilterProfileSpec
> = {
  risk_on_trend: {
    profile: 'risk_on_trend',
    title: 'Profile A — Risk-On Trend',
    market_regime: 'positive_trend',
    activation_summary:
      'Persistent positive tide (z >= 1.5, slope > 0, >=20/30m bullish) AND SPY above gamma flip AND equity-only 0DTE tide not strongly bearish',
    focus_summary:
      'Bullish single-stock continuation flow; boost candidates where sector tide agrees.',
    directions: ['bullish'],
    min_premium: 75_000,
    min_ask_perc: 0.7,
    min_directional_side_perc: 0.7,
    min_volume_oi_ratio: 1.0,
    min_dte: 7,
    max_dte: 60,
    is_otm: true,
    max_multileg_ratio: 0.35,
    min_sweep_ratio: 0.25,
    min_whale_score: 65,
    candidate_ttl_minutes: 30,
    price_confirmation: {
      required: true,
      above_vwap: true,
      relative_volume_min: 1.25,
    },
  },
  risk_off_trend: {
    profile: 'risk_off_trend',
    title: 'Profile B — Risk-Off Trend',
    market_regime: 'negative_trend',
    activation_summary:
      'Persistent negative tide (z <= -1.5, slope < 0, >=20/30m bearish) AND SPY below gamma flip AND index/ETF 0DTE tide is bearish',
    focus_summary:
      'Bearish continuation flow (ask-side puts & bid-side calls below VWAP).',
    directions: ['bearish'],
    min_premium: 75_000,
    min_directional_side_perc: 0.7,
    min_volume_oi_ratio: 1.0,
    min_dte: 7,
    max_dte: 60,
    is_otm: true,
    max_multileg_ratio: 0.35,
    min_sweep_ratio: 0.25,
    min_whale_score: 65,
    candidate_ttl_minutes: 30,
    price_confirmation: {
      required: true,
      below_vwap: true,
      relative_volume_min: 1.25,
    },
  },
  positive_gamma_range: {
    profile: 'positive_gamma_range',
    title: 'Profile C — Positive-Gamma Range / Pinning',
    market_regime: 'positive_gamma_pinning',
    activation_summary:
      'Market tide is neutral or mixed AND spot is above gamma flip AND spot is near gamma magnet or major wall',
    focus_summary:
      'Avoid chasing short-dated bursts; require higher-quality, longer-dated (21–120 DTE) accumulation with sector agreement.',
    directions: ['bullish', 'bearish'],
    min_premium: 200_000,
    min_directional_side_perc: 0.8,
    min_volume_oi_ratio: 1.25,
    min_dte: 21,
    max_dte: 120,
    is_otm: true,
    max_multileg_ratio: 0.25,
    min_contract_share: 0.4,
    min_whale_score: 78,
    candidate_ttl_minutes: 45,
    price_confirmation: {
      required: true,
      breakout_or_breakdown_required: true,
      relative_volume_min: 1.75,
    },
  },
  negative_gamma_expansion: {
    profile: 'negative_gamma_expansion',
    title: 'Profile D — Negative-Gamma Expansion',
    market_regime: 'negative_gamma_expansion',
    activation_summary:
      'SPY is below gamma flip OR market is rapidly moving away from gamma flip AND realized intraday range is elevated',
    focus_summary:
      'Rapid, aligned flows with immediate 3-minute price confirmation; 15-minute candidate TTL.',
    directions: ['bullish', 'bearish'],
    min_premium: 125_000,
    min_directional_side_perc: 0.75,
    min_volume_oi_ratio: 1.0,
    min_dte: 3,
    max_dte: 45,
    is_otm: true,
    max_multileg_ratio: 0.3,
    min_sweep_ratio: 0.35,
    min_whale_score: 72,
    candidate_ttl_minutes: 15,
    price_confirmation: {
      required: true,
      confirmation_window_minutes: 3,
      relative_volume_min: 1.5,
      must_break_5m_range: true,
    },
  },
  gamma_flip_transition: {
    profile: 'gamma_flip_transition',
    title: 'Profile E — Gamma-Flip Transition',
    market_regime: 'gamma_flip_transition',
    activation_summary:
      'Price is within ±0.30% of gamma flip AND tide is mixed, reversing, or accelerating',
    focus_summary:
      'Regime instability near gamma flip; avoid false positives and surface only exceptional ($300K+, score >= 85) flow.',
    directions: ['bullish', 'bearish'],
    min_premium: 300_000,
    min_directional_side_perc: 0.85,
    min_volume_oi_ratio: 1.5,
    min_dte: 7,
    max_dte: 45,
    is_otm: true,
    max_multileg_ratio: 0.2,
    min_sweep_ratio: 0.5,
    require_repeated_hits_or_sweep: true,
    min_whale_score: 85,
    candidate_ttl_minutes: 15,
    price_confirmation: {
      required: true,
      confirmation_window_minutes: 3,
      relative_volume_min: 2.0,
      must_break_5m_range: true,
      must_hold_beyond_gamma_flip: true,
    },
  },
  volatility_stress: {
    profile: 'volatility_stress',
    title: 'Profile F — Event / Volatility-Stress',
    market_regime: 'volatility_stress',
    activation_summary:
      'Front-term IV materially above back-term IV (ratio >= 1.20) OR sharp tide shock OR 0DTE index flow dominates total tide',
    focus_summary:
      'Detect institutional flow but label as possible_hedge / event_sensitive; avoid treating short-dated index puts as single-name bearish thesis.',
    directions: ['bullish', 'bearish', 'ambiguous'],
    min_premium: 250_000,
    min_directional_side_perc: 0.8,
    min_volume_oi_ratio: 1.5,
    min_dte: 14,
    max_dte: 90,
    is_otm: true,
    max_multileg_ratio: 0.2,
    min_contract_share: 0.4,
    min_whale_score: 80,
    candidate_ttl_minutes: 30,
    price_confirmation: {
      required: true,
      relative_volume_min: 2.0,
    },
    labels: ['possible_hedge', 'event_sensitive'],
  },
};

/**
 * Section 3A: Tide direction and persistence
 */
export function evaluateTidePersistence(params: {
  net_call_premium_30m: number;
  net_put_premium_30m: number;
  tide_zscore_5m: number;
  tide_slope_15m: number;
  bullish_minutes_last_30m: number;
  bearish_minutes_last_30m: number;
}): {
  tide_direction: -1 | 0 | 1;
  persistent_bullish_tide: boolean;
  persistent_bearish_tide: boolean;
  persistence: number;
} {
  const diff30 = params.net_call_premium_30m - params.net_put_premium_30m;
  const tide_direction: -1 | 0 | 1 = diff30 > 0 ? 1 : diff30 < 0 ? -1 : 0;

  const persistent_bullish_tide =
    params.tide_zscore_5m >= 1.5 &&
    params.tide_slope_15m > 0 &&
    params.bullish_minutes_last_30m >= 20;

  const persistent_bearish_tide =
    params.tide_zscore_5m <= -1.5 &&
    params.tide_slope_15m < 0 &&
    params.bearish_minutes_last_30m >= 20;

  const dominantMinutes = Math.max(
    params.bullish_minutes_last_30m,
    params.bearish_minutes_last_30m
  );
  const persistence = round2(clamp(dominantMinutes / 30, 0, 1));

  return {
    tide_direction,
    persistent_bullish_tide,
    persistent_bearish_tide,
    persistence,
  };
}

/**
 * Section 3B: Gamma regime classification
 */
export function evaluateGammaRegime(
  spotPrice: number,
  gammaFlip: number
): {
  positive_gamma: boolean;
  negative_gamma: boolean;
  near_gamma_flip: boolean;
  distance_to_flip_pct: number;
  regime: GammaRegime;
} {
  if (spotPrice <= 0) {
    return {
      positive_gamma: false,
      negative_gamma: false,
      near_gamma_flip: true,
      distance_to_flip_pct: 0,
      regime: 'near_gamma_flip',
    };
  }
  const signedDist = (spotPrice - gammaFlip) / spotPrice;
  const absDist = Math.abs(signedDist);
  const near_gamma_flip = absDist < 0.003;
  const positive_gamma = spotPrice > gammaFlip && absDist >= 0.003;
  const negative_gamma = spotPrice < gammaFlip && absDist >= 0.003;

  const regime: GammaRegime = near_gamma_flip
    ? 'near_gamma_flip'
    : positive_gamma
      ? 'positive_gamma'
      : 'negative_gamma';

  return {
    positive_gamma,
    negative_gamma,
    near_gamma_flip,
    distance_to_flip_pct: round2(signedDist * 100),
    regime,
  };
}

/**
 * Section 3C: Volatility regime classification
 */
export function evaluateVolatilityRegime(
  iv7to14Dte: number,
  iv30to60Dte: number
): {
  front_back_iv_ratio: number;
  volatility_regime: VolatilityRegime;
} {
  const safeBack = Math.max(iv30to60Dte, 0.01);
  const front_back_iv_ratio = round2(iv7to14Dte / safeBack);
  let volatility_regime: VolatilityRegime = 'normal';
  if (front_back_iv_ratio >= 1.2) {
    volatility_regime = 'event_or_stress';
  } else if (front_back_iv_ratio <= 0.85) {
    volatility_regime = 'calm';
  }
  return {
    front_back_iv_ratio,
    volatility_regime,
  };
}

/**
 * Section 3 & 4: State Machine — Classify market state and activate matching filter profile
 */
export function classifyMarketStateAndProfile(params: {
  net_premium_5m: number;
  net_call_premium_30m: number;
  net_put_premium_30m: number;
  zscore_5m: number;
  slope_15m: number;
  bullish_minutes_last_30m: number;
  bearish_minutes_last_30m: number;
  zero_dte_index_pressure: ZeroDtePressure;
  zero_dte_etf_pressure: ZeroDtePressure;
  zero_dte_equity_pressure: ZeroDtePressure;
  index_dominates_total_flow?: boolean;
  spy_spot: number;
  spy_gamma_flip: number;
  spy_call_wall: number;
  spy_put_wall: number;
  spy_gamma_magnet: number;
  qqq_spot?: number;
  qqq_gamma_flip?: number;
  iwm_spot?: number;
  iwm_gamma_flip?: number;
  source_vol_net_gex_m?: number;
  source_oi_net_gex_m?: number;
  near_magnet_or_wall?: boolean;
  realized_intraday_range_elevated?: boolean;
  iv_7_to_14_dte: number;
  iv_30_to_60_dte: number;
}): {
  market_regime: MarketStateRegime;
  active_filter_profile: AdaptiveFilterProfileId;
  gamma_eval: ReturnType<typeof evaluateGammaRegime>;
  vol_eval: ReturnType<typeof evaluateVolatilityRegime>;
  tide_eval: ReturnType<typeof evaluateTidePersistence>;
} {
  const tide_eval = evaluateTidePersistence({
    net_call_premium_30m: params.net_call_premium_30m,
    net_put_premium_30m: params.net_put_premium_30m,
    tide_zscore_5m: params.zscore_5m,
    tide_slope_15m: params.slope_15m,
    bullish_minutes_last_30m: params.bullish_minutes_last_30m,
    bearish_minutes_last_30m: params.bearish_minutes_last_30m,
  });

  const gamma_eval = evaluateGammaRegime(
    params.spy_spot,
    params.spy_gamma_flip
  );
  const vol_eval = evaluateVolatilityRegime(
    params.iv_7_to_14_dte,
    params.iv_30_to_60_dte
  );

  // 1. Profile F — Event / volatility-stress
  if (
    vol_eval.volatility_regime === 'event_or_stress' ||
    Boolean(params.index_dominates_total_flow)
  ) {
    return {
      market_regime: 'volatility_stress',
      active_filter_profile: 'volatility_stress',
      gamma_eval,
      vol_eval,
      tide_eval,
    };
  }

  // 2. Profile E — Gamma-flip transition (within +-0.30% of gamma flip)
  if (gamma_eval.near_gamma_flip) {
    return {
      market_regime: 'gamma_flip_transition',
      active_filter_profile: 'gamma_flip_transition',
      gamma_eval,
      vol_eval,
      tide_eval,
    };
  }

  // 3. Profile A — Risk-on trend
  if (
    tide_eval.persistent_bullish_tide &&
    gamma_eval.positive_gamma &&
    params.zero_dte_equity_pressure !== 'bearish'
  ) {
    return {
      market_regime: 'positive_trend',
      active_filter_profile: 'risk_on_trend',
      gamma_eval,
      vol_eval,
      tide_eval,
    };
  }

  // 4. Profile B — Risk-off trend
  if (
    tide_eval.persistent_bearish_tide &&
    gamma_eval.negative_gamma &&
    (params.zero_dte_index_pressure === 'bearish' ||
      params.zero_dte_etf_pressure === 'bearish')
  ) {
    return {
      market_regime: 'negative_trend',
      active_filter_profile: 'risk_off_trend',
      gamma_eval,
      vol_eval,
      tide_eval,
    };
  }

  // 5. Profile D — Negative-gamma expansion
  if (
    gamma_eval.negative_gamma ||
    Boolean(params.realized_intraday_range_elevated)
  ) {
    return {
      market_regime: 'negative_gamma_expansion',
      active_filter_profile: 'negative_gamma_expansion',
      gamma_eval,
      vol_eval,
      tide_eval,
    };
  }

  // 6. Profile C — Positive-gamma range / pinning
  return {
    market_regime: 'positive_gamma_pinning',
    active_filter_profile: 'positive_gamma_range',
    gamma_eval,
    vol_eval,
    tide_eval,
  };
}

/**
 * Section 5: Sector alignment layer
 */
export function computeSectorTideAlignment(params: {
  candidate_direction: 'bullish' | 'bearish';
  sector_tide_direction: 'bullish' | 'bearish' | 'neutral';
  sector_tide_strongly_opposes?: boolean;
}): number {
  if (
    params.candidate_direction === 'bullish' &&
    params.sector_tide_direction === 'bullish'
  ) {
    return 1.0;
  }
  if (
    params.candidate_direction === 'bearish' &&
    params.sector_tide_direction === 'bearish'
  ) {
    return 1.0;
  }
  if (params.sector_tide_strongly_opposes) {
    return 0.0;
  }
  if (
    (params.candidate_direction === 'bullish' &&
      params.sector_tide_direction === 'bearish') ||
    (params.candidate_direction === 'bearish' &&
      params.sector_tide_direction === 'bullish')
  ) {
    return 0.0;
  }
  return 0.5;
}

/**
 * Section 6: Ticker-level gamma rules
 * - Confirm directional breakout (+6 if bullish > call_wall or bearish < put_wall)
 * - Downgrade likely pinning behavior (-8 if abs(price - gamma_magnet)/price < 0.003)
 * - Regime instability (-5 if abs(price - gamma_flip)/price < 0.003 and require_stronger_confirmation = true)
 */
export function evaluateTickerGammaRules(params: {
  direction: 'bullish' | 'bearish';
  ticker_spot: number;
  gamma_flip: number;
  call_wall: number;
  put_wall: number;
  gamma_magnet: number;
  gex_source_vol_net?: number;
  gex_source_oi_net?: number;
}): CandidateGammaContext {
  const price = Math.max(params.ticker_spot, 0.01);
  const near_magnet = Math.abs(price - params.gamma_magnet) / price < 0.003;
  const near_gamma_flip = Math.abs(price - params.gamma_flip) / price < 0.003;

  const spot_vs_flip: 'above' | 'below' | 'near_flip' = near_gamma_flip
    ? 'near_flip'
    : price > params.gamma_flip
      ? 'above'
      : 'below';

  let breakout_confirmed = false;
  let ticker_gamma_modifier = 0;

  if (params.direction === 'bullish' && price > params.call_wall) {
    breakout_confirmed = true;
    ticker_gamma_modifier += 6;
  }
  if (params.direction === 'bearish' && price < params.put_wall) {
    breakout_confirmed = true;
    ticker_gamma_modifier += 6;
  }

  if (near_magnet) {
    ticker_gamma_modifier -= 8;
  }

  let require_stronger_confirmation = false;
  if (near_gamma_flip) {
    ticker_gamma_modifier -= 5;
    require_stronger_confirmation = true;
  }

  // Normalized 0..1 gamma alignment score for the 0.03 weight in Section 7
  let gamma_alignment_score = 0.5;
  if (breakout_confirmed && !near_magnet && !near_gamma_flip) {
    gamma_alignment_score = 1.0;
  } else if (
    (params.direction === 'bullish' && spot_vs_flip === 'above') ||
    (params.direction === 'bearish' && spot_vs_flip === 'below')
  ) {
    gamma_alignment_score = near_magnet ? 0.35 : 0.85;
  } else if (near_gamma_flip || near_magnet) {
    gamma_alignment_score = 0.2;
  } else {
    gamma_alignment_score = 0.4;
  }

  return {
    ticker_spot: round2(price),
    gamma_flip: round2(params.gamma_flip),
    call_wall: round2(params.call_wall),
    put_wall: round2(params.put_wall),
    gamma_magnet: round2(params.gamma_magnet),
    spot_vs_flip,
    above_gamma_flip: price > params.gamma_flip,
    near_magnet,
    near_gamma_flip,
    near_flip: near_gamma_flip,
    breakout_confirmed,
    gamma_alignment_score: round2(gamma_alignment_score),
    ticker_gamma_modifier,
    require_stronger_confirmation,
    gex_source_vol_net: params.gex_source_vol_net ?? 0,
    gex_source_oi_net: params.gex_source_oi_net ?? 0,
  };
}

/**
 * Section 7: Adaptive 9-Factor Scoring + Regime & Ticker Gamma Penalties/Bonuses
 */
export function computeAdaptiveWhaleScore(params: {
  premium_5m: number;
  sweep_ratio: number;
  repeated_hit_flag: boolean;
  dominant_side_share: number;
  volume: number;
  open_interest: number;
  contract_share: number;
  direction: 'bullish' | 'bearish';
  candle: UnderlyingCandle5m;
  spread: number;
  avg_daily_dollar_volume: number;
  multileg_ratio: number;
  dte: number;
  active_profile: AdaptiveFilterProfileId;
  market_tide_alignment: number;
  sector_tide_alignment: number;
  gamma_context: CandidateGammaContext;
  conflicts_with_market_regime: boolean;
}): {
  base_score: number;
  regime_adjustments: number;
  final_score: number;
  adjustment_breakdown: { label: string; delta: number }[];
  components: WhaleScoreComponents;
  price_confirmed: boolean;
  close_position: number;
  vwap_aligned: boolean;
} {
  const premium_score = clamp(
    Math.log10(Math.max(params.premium_5m, 1) / 50_000) / Math.log10(20),
    0,
    1
  );

  const urgency_score = clamp(
    0.4 * params.sweep_ratio +
      0.35 * (params.repeated_hit_flag ? 1 : 0) +
      0.25 * params.dominant_side_share,
    0,
    1
  );

  const volOiRatio = params.volume / Math.max(params.open_interest, 100);
  const novelty_score = clamp(volOiRatio / 5.0, 0, 1);

  const concentration_score = clamp(params.contract_share / 0.6, 0, 1);

  const candleEval = evaluateCandleConfirmation(
    params.direction,
    params.candle
  );
  const directionalReturn =
    params.direction === 'bullish'
      ? Math.max(0, params.candle.return_5m)
      : Math.max(0, -params.candle.return_5m);

  const price_confirmation_score = clamp(
    0.4 * clamp(directionalReturn / 0.01, 0, 1) +
      0.3 * candleEval.vwap_alignment +
      0.2 * clamp((params.candle.relative_volume_5m - 1.0) / 1.5, 0, 1) +
      0.1 * candleEval.candle_close_position_confirmation,
    0,
    1
  );

  const spread_quality = clamp(1 - params.spread / 0.2, 0, 1);
  const oi_depth_quality = clamp(params.open_interest / 1000, 0, 1);
  const underlying_liquidity_quality = clamp(
    params.avg_daily_dollar_volume / 50_000_000,
    0,
    1
  );
  const liquidity_score = clamp(
    (spread_quality + oi_depth_quality + underlying_liquidity_quality) / 3,
    0,
    1
  );

  const market_tide_alignment = clamp(params.market_tide_alignment, 0, 1);
  const sector_tide_alignment = clamp(params.sector_tide_alignment, 0, 1);
  const gamma_alignment = clamp(
    params.gamma_context.gamma_alignment_score,
    0,
    1
  );

  // Section 7 base_score formula
  const rawBase =
    (0.2 * premium_score +
      0.16 * urgency_score +
      0.12 * novelty_score +
      0.12 * concentration_score +
      0.18 * price_confirmation_score +
      0.08 * liquidity_score +
      0.07 * market_tide_alignment +
      0.04 * sector_tide_alignment +
      0.03 * gamma_alignment) *
    100;

  const base_score = Math.round(clamp(rawBase, 0, 100));
  const adjustment_breakdown: { label: string; delta: number }[] = [];

  // Ticker-level gamma rules (Section 6)
  if (params.gamma_context.breakout_confirmed) {
    adjustment_breakdown.push({
      label:
        params.direction === 'bullish'
          ? 'Breakout above ticker Call Wall (+6)'
          : 'Breakdown below ticker Put Wall (+6)',
      delta: 6,
    });
  }
  if (params.gamma_context.near_magnet) {
    adjustment_breakdown.push({
      label: 'Pinning risk near ticker Gamma Magnet (-8)',
      delta: -8,
    });
  }
  if (params.gamma_context.near_gamma_flip) {
    adjustment_breakdown.push({
      label: 'Near Gamma Flip instability (-5)',
      delta: -5,
    });
  }

  // Sector alignment boost in risk_on_trend / risk_off_trend (Section 4A)
  if (
    (params.active_profile === 'risk_on_trend' ||
      params.active_profile === 'risk_off_trend') &&
    sector_tide_alignment === 1.0 &&
    !params.conflicts_with_market_regime
  ) {
    adjustment_breakdown.push({
      label: 'Sector tide agrees with trend continuation (+4)',
      delta: 4,
    });
  }

  // Regime penalties (Section 7)
  if (params.conflicts_with_market_regime) {
    adjustment_breakdown.push({
      label: 'Conflicts with active Market Regime (-12)',
      delta: -12,
    });
  }

  const is_short_dated = params.dte < 21;
  if (is_short_dated && params.active_profile === 'positive_gamma_range') {
    adjustment_breakdown.push({
      label: 'Short-dated flow in positive_gamma_range (-15)',
      delta: -15,
    });
  }

  if (params.multileg_ratio > 0.35) {
    adjustment_breakdown.push({
      label: 'Multi-leg ratio > 35% penalty (-20)',
      delta: -20,
    });
  }

  const regime_adjustments = adjustment_breakdown.reduce(
    (sum, item) => sum + item.delta,
    0
  );
  const final_score = Math.round(
    clamp(base_score + regime_adjustments, 0, 100)
  );

  return {
    base_score,
    regime_adjustments,
    final_score,
    adjustment_breakdown,
    components: {
      premium: round2(premium_score),
      urgency: round2(urgency_score),
      novelty: round2(novelty_score),
      concentration: round2(concentration_score),
      price_confirmation: round2(price_confirmation_score),
      liquidity: round2(liquidity_score),
      tide_alignment: round2(market_tide_alignment),
      market_tide_alignment: round2(market_tide_alignment),
      sector_tide_alignment: round2(sector_tide_alignment),
      gamma_alignment: round2(gamma_alignment),
    },
    price_confirmed: candleEval.confirmed,
    close_position: candleEval.close_position,
    vwap_aligned: candleEval.vwap_alignment === 1.0,
  };
}

/**
 * Evaluate a candidate against the active v2.0 AdaptiveFilterProfileSpec + Section 5 Sector Policy
 * Note: "It should downgrade or reject flow that conflicts with the regime unless the single-name evidence is exceptional."
 */
export function evaluateCandidateAgainstAdaptiveProfile(
  candidate: WhaleCandidate,
  profileId: AdaptiveFilterProfileId
): { passed: boolean; reasons: string[]; exceptional_override: boolean } {
  const spec = ADAPTIVE_FILTER_PROFILES[profileId];
  const reasons: string[] = [];

  if (candidate.flow.premium_5m < spec.min_premium) {
    reasons.push(
      `5m premium ($${(candidate.flow.premium_5m / 1000).toFixed(0)}K) < profile min ($${(spec.min_premium / 1000).toFixed(0)}K)`
    );
  }

  if (candidate.flow.side_share < spec.min_directional_side_perc) {
    reasons.push(
      `Directional side share (${Math.round(candidate.flow.side_share * 100)}%) < profile min (${Math.round(spec.min_directional_side_perc * 100)}%)`
    );
  }

  if (candidate.flow.volume_oi_ratio < spec.min_volume_oi_ratio) {
    reasons.push(
      `Vol/OI (${candidate.flow.volume_oi_ratio}x) < profile min (${spec.min_volume_oi_ratio}x)`
    );
  }

  if (candidate.dte < spec.min_dte || candidate.dte > spec.max_dte) {
    reasons.push(
      `DTE (${candidate.dte}) outside profile window (${spec.min_dte}–${spec.max_dte}d)`
    );
  }

  if (candidate.flow.multileg_ratio > spec.max_multileg_ratio) {
    reasons.push(
      `Multi-leg ratio (${Math.round(candidate.flow.multileg_ratio * 100)}%) > profile max (${Math.round(spec.max_multileg_ratio * 100)}%)`
    );
  }

  if (
    spec.min_sweep_ratio !== undefined &&
    candidate.flow.sweep_ratio < spec.min_sweep_ratio
  ) {
    reasons.push(
      `Sweep ratio (${Math.round(candidate.flow.sweep_ratio * 100)}%) < profile min (${Math.round(spec.min_sweep_ratio * 100)}%)`
    );
  }

  if (
    spec.min_contract_share !== undefined &&
    candidate.flow.contract_share < spec.min_contract_share
  ) {
    reasons.push(
      `Contract share (${Math.round(candidate.flow.contract_share * 100)}%) < profile min (${Math.round(spec.min_contract_share * 100)}%)`
    );
  }

  if (
    spec.require_repeated_hits_or_sweep &&
    !candidate.flow.repeated_hits &&
    candidate.flow.sweep_ratio < 0.5
  ) {
    reasons.push('Profile requires repeated hits or sweep ratio >= 50%');
  }

  if (candidate.whale_score < spec.min_whale_score) {
    reasons.push(
      `Adaptive score (${candidate.whale_score}) < profile min (${spec.min_whale_score})`
    );
  }

  if (
    spec.price_confirmation.required &&
    candidate.underlying.relative_volume_5m <
      spec.price_confirmation.relative_volume_min
  ) {
    reasons.push(
      `5m relative volume (${candidate.underlying.relative_volume_5m}x) < profile min (${spec.price_confirmation.relative_volume_min}x)`
    );
  }

  if (
    spec.price_confirmation.above_vwap &&
    candidate.direction === 'bullish' &&
    !candidate.underlying.vwap_aligned
  ) {
    reasons.push('Profile requires bullish price above 5m VWAP');
  }

  if (
    spec.price_confirmation.below_vwap &&
    candidate.direction === 'bearish' &&
    !candidate.underlying.vwap_aligned
  ) {
    reasons.push('Profile requires bearish price below 5m VWAP');
  }

  // Section 5: Sector Alignment Policy
  const sectorAlign = candidate.market_context.sector_tide_alignment ?? 1.0;
  if (
    (profileId === 'risk_on_trend' || profileId === 'risk_off_trend') &&
    sectorAlign === 0.0 &&
    candidate.whale_score < 85
  ) {
    reasons.push(
      'Sector tide opposes candidate in trend regime and whale_score < 85'
    );
  }
  if (profileId === 'positive_gamma_range' && sectorAlign < 1.0) {
    reasons.push(
      'Neutral/range regime (positive_gamma_range) requires mandatory sector tide agreement (1.0)'
    );
  }

  // Direction vs Profile check — allow exceptional single-name override (score >= 86, premium >= $500K, breakout confirmed)
  let exceptional_override = false;
  if (!spec.directions.includes(candidate.direction)) {
    const isExceptionalSingleName =
      candidate.whale_score >= 86 &&
      candidate.flow.premium_5m >= 500_000 &&
      Boolean(candidate.gamma_context?.breakout_confirmed) &&
      candidate.status === 'confirmed';

    if (isExceptionalSingleName) {
      exceptional_override = true;
    } else {
      reasons.push(
        `Direction (${candidate.direction}) conflicts with ${profileId} allowed directions [${spec.directions.join(', ')}]`
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    exceptional_override,
  };
}

/**
 * Pure aggregation engine for multiple option prints on the same OCC contract.
 * Computes volume-weighted average fill price (VWAP), fill price progression
 * (ascending/descending/steady), cumulative contracts & premium, sweep share,
 * conviction multiplier, and a chronological print ledger.
 */
export function aggregateContractPrints(
  prints: NormalizedOptionPrint[]
): ContractActivityAggregation {
  if (!prints || prints.length === 0) {
    return {
      is_aggregated: false,
      option_symbol: '',
      aggregated_print_count: 0,
      distinct_sweep_count: 0,
      distinct_block_count: 0,
      first_print_at_ms: 0,
      latest_print_at_ms: 0,
      aggregation_window_seconds: 0,
      cumulative_contracts: 0,
      cumulative_premium_dollars: 0,
      initial_print_premium_dollars: 0,
      latest_print_premium_dollars: 0,
      vwap_fill_price: 0,
      min_fill_price: 0,
      max_fill_price: 0,
      price_progression: 'single_print',
      ask_side_contracts_pct: 0,
      sweep_premium_pct: 0,
      conviction_multiplier: 1.0,
      aggregation_summary: 'No contract prints recorded.',
      print_ledger: [],
    };
  }

  // Deduplicate by event_id and sort chronologically (oldest -> newest)
  const byEventId = new Map<string, NormalizedOptionPrint>();
  for (const p of prints) {
    if (p && p.event_id) {
      byEventId.set(p.event_id, p);
    }
  }
  const sorted = Array.from(byEventId.values()).sort(
    (a, b) => a.executed_at_ms - b.executed_at_ms
  );

  const optionSymbol = sorted[0].option_symbol;
  const count = sorted.length;
  const firstMs = sorted[0].executed_at_ms;
  const latestMs = sorted[count - 1].executed_at_ms;
  let burstSpanMs = 0;
  for (let i = 1; i < count; i++) {
    const gap = Math.max(0, sorted[i].executed_at_ms - sorted[i - 1].executed_at_ms);
    burstSpanMs += gap > 300_000 ? 3200 : gap;
  }
  const windowSec = Math.max(0, Math.round(burstSpanMs / 1000));

  let totalContracts = 0;
  let totalPremium = 0;
  let weightedPriceSum = 0;
  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = Number.NEGATIVE_INFINITY;
  let sweepCount = 0;
  let blockCount = 0;
  let askContracts = 0;
  let sweepPremium = 0;

  const ledger: AggregatedContractPrintItem[] = sorted.map((p) => {
    const sz = Math.max(1, p.size);
    const prem = p.premium > 0 ? p.premium : Math.round(sz * p.price * 100);
    totalContracts += sz;
    totalPremium += prem;
    weightedPriceSum += sz * p.price;
    if (p.price < minPrice) minPrice = p.price;
    if (p.price > maxPrice) maxPrice = p.price;
    if (p.is_sweep) {
      sweepCount += 1;
      sweepPremium += prem;
    } else {
      blockCount += 1;
    }
    if (p.side === 'ask') {
      askContracts += sz;
    }
    return {
      event_id: p.event_id,
      executed_at_ms: p.executed_at_ms,
      executed_at_iso: new Date(p.executed_at_ms).toISOString(),
      size: sz,
      price: round2(p.price),
      premium: prem,
      side: p.side,
      is_sweep: p.is_sweep,
      is_multi_leg: p.is_multi_leg,
      exchange: p.exchange ?? (p.is_sweep ? 'CBOE' : 'PHLX'),
      underlying_price: round2(p.underlying_price),
    };
  });

  const vwapFillPrice =
    totalContracts > 0 ? round2(weightedPriceSum / totalContracts) : 0;
  const firstPrice = sorted[0].price;
  const lastPrice = sorted[count - 1].price;
  let priceProgression: ContractActivityAggregation['price_progression'] =
    'single_print';
  if (count > 1) {
    if (lastPrice > firstPrice * 1.008) {
      priceProgression = 'ascending_fills';
    } else if (lastPrice < firstPrice * 0.992) {
      priceProgression = 'descending_fills';
    } else {
      priceProgression = 'steady_accumulation';
    }
  }

  const askSidePct =
    totalContracts > 0 ? round2((askContracts / totalContracts) * 100) : 0;
  const sweepPremPct =
    totalPremium > 0 ? round2((sweepPremium / totalPremium) * 100) : 0;
  const initialPrem = ledger[0].premium;
  const latestPrem = ledger[count - 1].premium;
  const convictionMultiplier =
    initialPrem > 0 ? round2(totalPremium / initialPrem) : 1.0;

  const progressionLabel =
    priceProgression === 'ascending_fills'
      ? `Ascending Fills ($${firstPrice.toFixed(2)} → $${lastPrice.toFixed(2)})`
      : priceProgression === 'descending_fills'
        ? `Descending Fills ($${firstPrice.toFixed(2)} → $${lastPrice.toFixed(2)})`
        : priceProgression === 'steady_accumulation'
          ? `Steady Accumulation (@ $${vwapFillPrice.toFixed(2)} VWAP)`
          : `Single Print (@ $${vwapFillPrice.toFixed(2)})`;

  const summary =
    count > 1
      ? `Aggregated ${count} prints (${sweepCount} sweeps, ${blockCount} blocks) on ${optionSymbol} over ${windowSec}s: ${totalContracts.toLocaleString()} total contracts ($${(totalPremium / 1000).toFixed(1)}K cumulative premium, ${convictionMultiplier.toFixed(2)}x initial print) · VWAP $${vwapFillPrice.toFixed(2)} · ${progressionLabel}.`
      : `Single institutional print on ${optionSymbol}: ${totalContracts.toLocaleString()} contracts @ $${vwapFillPrice.toFixed(2)} ($${(totalPremium / 1000).toFixed(1)}K).`;

  return {
    is_aggregated: count > 1,
    option_symbol: optionSymbol,
    aggregated_print_count: count,
    distinct_sweep_count: sweepCount,
    distinct_block_count: blockCount,
    first_print_at_ms: firstMs,
    latest_print_at_ms: latestMs,
    aggregation_window_seconds: windowSec,
    cumulative_contracts: totalContracts,
    cumulative_premium_dollars: totalPremium,
    initial_print_premium_dollars: initialPrem,
    latest_print_premium_dollars: latestPrem,
    vwap_fill_price: vwapFillPrice,
    min_fill_price: round2(minPrice),
    max_fill_price: round2(maxPrice),
    price_progression: priceProgression,
    ask_side_contracts_pct: askSidePct,
    sweep_premium_pct: sweepPremPct,
    conviction_multiplier: convictionMultiplier,
    aggregation_summary: summary,
    print_ledger: ledger,
  };
}

/**
 * Merges two WhaleCandidate records for the same option_symbol into a single
 * aggregated WhaleCandidate, combining rolling premiums, volume, trade counts,
 * raw_event_refs, and ContractActivityAggregation metadata.
 */
export function mergeCandidatesForSameContract(
  existing: WhaleCandidate,
  incoming: WhaleCandidate
): WhaleCandidate {
  const existingLedger = existing.aggregation?.print_ledger ?? [];
  const incomingLedger = incoming.aggregation?.print_ledger ?? [];
  const combinedPrints: NormalizedOptionPrint[] = [
    ...existingLedger,
    ...incomingLedger,
  ].map((item) => ({
    event_id: item.event_id,
    executed_at_ms: item.executed_at_ms,
    ticker: existing.ticker,
    option_symbol: existing.option_symbol,
    option_type: existing.option_type,
    strike: existing.strike,
    expiry: existing.expiry,
    dte: existing.dte,
    size: item.size,
    price: item.price,
    premium: item.premium,
    volume: existing.flow.volume,
    open_interest: existing.flow.open_interest,
    side: item.side,
    is_sweep: item.is_sweep,
    is_multi_leg: item.is_multi_leg,
    is_opening: null,
    underlying_price: item.underlying_price,
    iv: existing.flow.iv,
    delta: existing.flow.delta,
    spread: existing.flow.spread,
    exchange: item.exchange,
  }));

  const mergedAggregation = aggregateContractPrints(combinedPrints);
  const mergedRefs = Array.from(
    new Set([...existing.raw_event_refs, ...incoming.raw_event_refs])
  );
  const mergedRules = Array.from(
    new Set([
      ...existing.flow.flow_alert_rules,
      ...incoming.flow.flow_alert_rules,
      ...(mergedAggregation.price_progression === 'ascending_fills'
        ? (['RepeatedHitsAscendingFill', 'RepeatedHits'] as FlowAlertRule[])
        : (['RepeatedHits'] as FlowAlertRule[])),
    ])
  );
  const mergedFlags = Array.from(
    new Set([
      ...existing.flags,
      ...incoming.flags,
      'multi_print_contract_aggregated',
    ])
  );

  const combinedContractPrem5m = Math.max(
    mergedAggregation.cumulative_premium_dollars,
    existing.flow.contract_premium_5m + incoming.flow.contract_premium_5m
  );
  const combinedPrem5m = Math.max(
    combinedContractPrem5m,
    existing.flow.premium_5m + incoming.flow.contract_premium_5m
  );
  const combinedVolume = Math.max(
    existing.flow.volume +
      (incoming.aggregation?.cumulative_contracts ?? 100),
    incoming.flow.volume
  );
  const volOiRatio = round2(
    combinedVolume / Math.max(existing.flow.open_interest, 1)
  );
  const boostedScore = Math.min(
    99,
    Math.max(existing.whale_score, incoming.whale_score) +
      (mergedAggregation.aggregated_print_count >= 3 ? 3 : 2)
  );

  return {
    ...existing,
    ...incoming,
    candidate_id: existing.candidate_id,
    detected_at: existing.detected_at,
    detected_at_ms: Math.min(existing.detected_at_ms, incoming.detected_at_ms),
    last_updated_ms: Math.max(
      existing.last_updated_ms,
      incoming.last_updated_ms
    ),
    whale_score: boostedScore,
    flow: {
      ...existing.flow,
      ...incoming.flow,
      premium_1m: existing.flow.premium_1m + incoming.flow.premium_1m,
      premium_5m: combinedPrem5m,
      premium_15m: Math.max(
        combinedPrem5m,
        existing.flow.premium_15m + incoming.flow.contract_premium_5m
      ),
      contract_premium_5m: combinedContractPrem5m,
      volume: combinedVolume,
      volume_oi_ratio: volOiRatio,
      repeated_hits: true,
      trade_count_10s:
        existing.flow.trade_count_10s + incoming.flow.trade_count_10s,
      aggregate_premium_10s:
        existing.flow.aggregate_premium_10s +
        incoming.flow.aggregate_premium_10s,
      flow_alert_rules: mergedRules,
    },
    flags: mergedFlags,
    raw_event_refs: mergedRefs,
    aggregation: mergedAggregation,
  };
}

export interface AutoScannerModeResolution {
  mode: ScannerModeId;
  mode_label: string;
  adaptive_profile: AdaptiveFilterProfileId;
  tide_regime: MarketTideRegime;
  default_min_score: number;
  auto_reason: string;
}

/**
 * Automatically selects the optimal ScannerModeId based on live Market Tide regime,
 * adaptive state-machine filter profile, and volatility conditions so the user never
 * has to manually switch scanner modes.
 */
export function resolveAutoScannerMode(params: {
  tide_regime?: MarketTideRegime;
  adaptive_profile?: AdaptiveFilterProfileId;
  volatility_regime?: VolatilityRegime;
  extreme_tide?: boolean;
}): AutoScannerModeResolution {
  const tideRegime: MarketTideRegime = params.tide_regime ?? 'strong_positive';
  const defaultProfileMap: Record<MarketTideRegime, AdaptiveFilterProfileId> = {
    strong_positive: 'risk_on_trend',
    strong_negative: 'risk_off_trend',
    neutral: 'positive_gamma_range',
    mixed: 'negative_gamma_expansion',
    reversing: 'gamma_flip_transition',
  };
  const adaptiveProfile: AdaptiveFilterProfileId =
    params.adaptive_profile ?? defaultProfileMap[tideRegime];

  if (
    adaptiveProfile === 'volatility_stress' ||
    adaptiveProfile === 'gamma_flip_transition' ||
    tideRegime === 'reversing' ||
    params.volatility_regime === 'event_or_stress'
  ) {
    return {
      mode: 'urgent_flow',
      mode_label: 'Urgent Flow',
      adaptive_profile: adaptiveProfile,
      tide_regime: tideRegime,
      default_min_score: 75,
      auto_reason:
        'Auto-routed to Urgent Flow mode: rapid Market Tide reversal, gamma-flip transition, or elevated IV stress requires high-urgency sweeps ($250K+, >=80% dominant skew).',
    };
  }

  if (
    adaptiveProfile === 'positive_gamma_range' ||
    tideRegime === 'neutral'
  ) {
    return {
      mode: 'accumulation_watch',
      mode_label: 'Accumulation Watch',
      adaptive_profile: adaptiveProfile,
      tide_regime: tideRegime,
      default_min_score: 60,
      auto_reason:
        'Auto-routed to Accumulation Watch mode: range-bound / positive-gamma pinning market conditions favor steady ask-side accumulation and multi-day OI buildup.',
    };
  }

  return {
    mode: 'directional_momentum',
    mode_label: 'Directional Momentum',
    adaptive_profile: adaptiveProfile,
    tide_regime: tideRegime,
    default_min_score: 60,
    auto_reason:
      'Auto-routed to Directional Momentum mode: active directional Market Tide & gamma trend favors 7–45 DTE OTM momentum sweeps with 5m candle confirmation.',
  };
}

export interface CandidateTimestampSummary {
  detected_time_et: string;
  latest_time_et: string;
  date_et: string;
  detected_iso: string;
  last_updated_iso: string;
  relative_age_label: string;
  window_span_label: string;
  is_multi_print_span: boolean;
}

const ET_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const ET_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatEtTimeString(epochMs: number): string {
  const safeMs = Number.isFinite(epochMs) && epochMs > 0 ? epochMs : Date.now();
  return `${ET_TIME_FORMATTER.format(new Date(safeMs))} ET`;
}

export function formatEtDateString(epochMs: number): string {
  const safeMs = Number.isFinite(epochMs) && epochMs > 0 ? epochMs : Date.now();
  return ET_DATE_FORMATTER.format(new Date(safeMs));
}

export function formatCandidateTimestampSummary(
  candidate: Pick<
    WhaleCandidate,
    'detected_at' | 'detected_at_ms' | 'last_updated_ms' | 'aggregation'
  >,
  referenceNowMs?: number
): CandidateTimestampSummary {
  const parsedDetected = candidate.detected_at
    ? Date.parse(candidate.detected_at)
    : NaN;
  const fallbackMs = Number.isFinite(parsedDetected)
    ? parsedDetected
    : Date.now();

  const detectedMs =
    candidate.aggregation && candidate.aggregation.first_print_at_ms > 0
      ? candidate.aggregation.first_print_at_ms
      : candidate.detected_at_ms > 0
        ? candidate.detected_at_ms
        : fallbackMs;

  const latestMs =
    candidate.aggregation && candidate.aggregation.latest_print_at_ms > 0
      ? Math.max(
          candidate.aggregation.latest_print_at_ms,
          candidate.last_updated_ms || 0
        )
      : candidate.last_updated_ms > 0
        ? candidate.last_updated_ms
        : detectedMs;

  const nowMs =
    referenceNowMs !== undefined && Number.isFinite(referenceNowMs)
      ? referenceNowMs
      : Date.now();
  const diffMs = Math.max(0, nowMs - latestMs);

  let relativeAgeLabel: string;
  if (diffMs < 5_000) {
    relativeAgeLabel = 'just now';
  } else if (diffMs < 60_000) {
    relativeAgeLabel = `${Math.max(1, Math.round(diffMs / 1000))}s ago`;
  } else if (diffMs < 3_600_000) {
    relativeAgeLabel = `${Math.max(1, Math.round(diffMs / 60_000))}m ago`;
  } else if (diffMs < 86_400_000) {
    const hrs = Math.floor(diffMs / 3_600_000);
    const mins = Math.round((diffMs % 3_600_000) / 60_000);
    relativeAgeLabel = mins > 0 ? `${hrs}h ${mins}m ago` : `${hrs}h ago`;
  } else {
    const days = Math.max(1, Math.round(diffMs / 86_400_000));
    relativeAgeLabel = `${days}d ago`;
  }

  const printCount = candidate.aggregation?.aggregated_print_count ?? 1;
  const spanSec =
    candidate.aggregation?.aggregation_window_seconds ??
    Math.max(0, Math.round((latestMs - detectedMs) / 1000));
  const isMultiPrintSpan = Boolean(candidate.aggregation && printCount > 1);
  const windowSpanLabel = isMultiPrintSpan
    ? `+${spanSec}s (${printCount} prints)`
    : 'Single print';

  return {
    detected_time_et: formatEtTimeString(detectedMs),
    latest_time_et: formatEtTimeString(latestMs),
    date_et: formatEtDateString(latestMs),
    detected_iso: new Date(detectedMs).toISOString(),
    last_updated_iso: new Date(latestMs).toISOString(),
    relative_age_label: relativeAgeLabel,
    window_span_label: windowSpanLabel,
    is_multi_print_span: isMultiPrintSpan,
  };
}

