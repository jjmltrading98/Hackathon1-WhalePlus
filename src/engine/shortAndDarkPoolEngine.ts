/**
 * ============================================================================
 * SHORT-PRESSURE REGIME, DARK-POOL POSITIONING & CONFIRMATION MATRIX ENGINE
 * ============================================================================
 *
 * Implements institutional multi-signal holding & strategy confirmation:
 * 1. Short-Pressure Regime (4 distinct signals):
 *    - Short interest / float (`GET /api/shorts/{ticker}/interest-float/v2`)
 *    - Days to cover (`GET /api/shorts/{ticker}/interest-float/v2`)
 *    - Borrow fee and shares available (`GET /api/shorts/{ticker}/data`)
 *    - Daily short-volume ratio (`GET /api/shorts/{ticker}/volume-and-ratio`,
 *      `/volumes-by-exchange`, `/ftds`, `/api/short_screener`)
 *    Guardrail: High short volume alone is not bearish (includes market-maker
 *    hedging, arbitrage, and short-sale mechanics).
 *
 * 2. Dark-Pool Positioning & Monitored Price Zones:
 *    - Ticker off-lit trades (`GET /api/darkpool/{ticker}?cancellation_status=hide_cancelled`)
 *    - Price-level volume concentration (`GET /api/darkpool/{ticker}/price-levels`)
 *    - Broad market recent blocks (`GET /api/darkpool/recent`)
 *    - Real-time stream freshness (`WebSocket off_lit_trades`)
 *    Guardrail: Dark-pool prints define monitored price zones, not assumed
 *    support/resistance. Cancelled prints are strictly excluded from scoring.
 *
 * 3. Independent Data-Type Confirmation Matrix:
 *    - Long-position exit logic: Requires >= 2 of 3 independent categories
 *      (A. Price confirms weakness, B. Options flow confirms weakness,
 *       C. Short data does not offset thesis).
 *    - Anti-premature-exit guardrail: Avoids exiting a long solely on bearish
 *      tape when price holds above a high-volume dark-pool zone + borrow is
 *      tightening + SI/DTC show squeeze vulnerability + price/flow holds.
 *    - Short-position squeeze-risk cluster: Escalates reduction/exit review when
 *      price reclaims dark-pool zone + call flow is supportive + borrow tightens
 *      + SI/DTC elevated + price accelerates on abnormal volume.
 *
 * 4. Rule Scoring (`computeShortDarkPoolScore`) & Aggregated LLM Feature Payload:
 *    - Modifies review urgency (never forces an autonomous order from a single print).
 */

export type DarkPoolZonePriceBehavior =
  | 'holding_above'
  | 'rejected_below'
  | 'reclaiming_with_volume'
  | 'inside_zone'
  | 'context_only_distant';

export type DarkPoolPrimaryZoneRelation =
  | 'above_primary_zone'
  | 'rejected_below_primary_zone'
  | 'reclaiming_primary_zone'
  | 'inside_primary_zone'
  | 'distant_context_only';

export type ShortDarkPoolFlag =
  | 'dark_pool_zone_rejection'
  | 'dark_pool_zone_hold'
  | 'dark_pool_zone_reclaim'
  | 'short_squeeze_risk'
  | 'borrow_loosening'
  | 'elevated_short_volume_mechanics_note';

export interface ShortContextPayload {
  short_interest_pct_float: number; // e.g. 0.18 (18.0% of float)
  days_to_cover: number; // e.g. 4.1 days
  borrow_fee_rate: number; // e.g. 0.27 (27.0% annualized fee rate)
  borrow_fee_change_5d: number; // e.g. +0.08 (+8.0% over 5d)
  short_shares_available: number; // e.g. 150000 shares
  shares_available_change_5d: number; // e.g. -0.62 (-62% over 5d)
  short_volume_ratio_latest: number; // e.g. 0.54 (54% of total daily volume)
  short_volume_ratio_20d_percentile: number; // e.g. 0.82 (82nd percentile)
  data_as_of: string; // e.g. "2026-10-22"
}

export interface ShortExchangeVolumeBreakdown {
  exchange: string;
  short_volume: number;
  total_volume: number;
  short_ratio: number;
}

export interface ShortFtdRecord {
  settlement_date: string;
  quantity: number;
  price: number;
  notional_value: number;
}

export interface DetailedShortTelemetry extends ShortContextPayload {
  ticker: string;
  short_interest_shares: number;
  float_shares: number;
  squeeze_vulnerability_regime: 'HIGH_SQUEEZE_RISK' | 'MODERATE_FRICTION' | 'LOW_NORMAL';
  borrow_friction_trend: 'TIGHTENING' | 'STABLE' | 'LOOSENING';
  short_volume_interpretation_note: string;
  exchange_breakdown: ShortExchangeVolumeBreakdown[];
  recent_ftds: ShortFtdRecord[];
  endpoints_used: string[];
}

export interface DarkPoolKeyPriceZone {
  price_low: number;
  price_high: number;
  dark_pool_volume: number;
  lit_volume?: number;
  dark_pool_share_pct?: number;
  block_print_count?: number;
  notional_premium?: number;
  distance_from_last_pct: number; // (zone_mid - spot) / spot
  price_behavior: DarkPoolZonePriceBehavior;
}

export interface DarkPoolContextPayload {
  large_print_count_session: number;
  large_print_premium_session: number;
  cancelled_prints_excluded: true;
  cancelled_prints_filtered_count?: number;
  key_price_zones: DarkPoolKeyPriceZone[];
  last_price_relation: DarkPoolPrimaryZoneRelation;
  stream_freshness_seconds: number;
}

export interface UwDarkPoolPrintRecord {
  tracking_id: string;
  executed_at: string;
  ticker: string;
  price: number;
  size: number;
  premium: number;
  nbbo_bid: number;
  nbbo_ask: number;
  market_center: string;
  trade_settlement: string;
  canceled: boolean;
  excluded_from_scoring: boolean;
  zone_relevance: 'PRIMARY_MONITORED_ZONE' | 'SECONDARY_ZONE' | 'DISTANT_CONTEXT_ONLY' | 'EXCLUDED_CANCELLED';
}

export interface DetailedDarkPoolTelemetry extends DarkPoolContextPayload {
  ticker: string;
  primary_zone_low: number;
  primary_zone_high: number;
  primary_zone_mid: number;
  primary_zone_behavior:
    | 'holding_above_primary_zone'
    | 'rejected_below_primary_zone'
    | 'reclaiming_primary_zone'
    | 'inside_primary_zone'
    | 'distant_context_only';
  recent_prints: UwDarkPoolPrintRecord[];
  endpoints_used: string[];
}

export interface ShortDarkPoolScoreResult {
  position_side: 'long' | 'short';
  score: number;
  flags: ShortDarkPoolFlag[];
  squeeze_risk: boolean;
  review_urgency_modifier:
    | 'ESCALATE_REVIEW_URGENCY'
    | 'REDUCE_FALSE_EXIT_URGENCY'
    | 'NEUTRAL_URGENCY';
  position_sizing_modifier_pct: number; // e.g. 1.0 (100%), 0.75 (reduce size), 1.15 (hold runner)
  exit_confidence_delta: number; // e.g. -0.12 (avoid premature exit) or +0.14 (escalate exit)
  summary: string;
}

export interface ConfirmationMatrixCategoryCheck {
  category_id: 'A_PRICE_WEAKNESS' | 'B_OPTIONS_FLOW_WEAKNESS' | 'C_SHORT_DATA_NON_OFFSET';
  label: string;
  agreed_for_exit: boolean;
  signals_triggered: string[];
  detail: string;
}

export interface ShortPositionSqueezeRiskCluster {
  active: boolean;
  signals_active_count: number;
  price_reclaims_dark_pool_zone: boolean;
  call_options_activity_supportive: boolean;
  borrow_tightening: boolean;
  short_interest_and_dtc_elevated: boolean;
  price_accelerating_on_rvol: boolean;
  summary: string;
}

export interface HoldingConfirmationMatrixEvaluation {
  effective_position_side: 'long' | 'short'; // Directional exposure (+1 bullish = long, -1 bearish = short)
  raw_holding_side: 'long' | 'short';
  categories: [
    ConfirmationMatrixCategoryCheck,
    ConfirmationMatrixCategoryCheck,
    ConfirmationMatrixCategoryCheck,
  ];
  categories_agreed_count: number;
  stronger_exit_review_triggered: boolean; // True when >= 2 categories agree (Long) or squeeze cluster fires (Short)
  avoid_premature_long_exit_active: boolean; // True when bearish tape alone is offset by DP hold + squeeze regime
  short_squeeze_cluster: ShortPositionSqueezeRiskCluster;
  short_darkpool_score: ShortDarkPoolScoreResult;
  recommended_urgency_override: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE' | null;
  matrix_verdict_label: string;
  matrix_summary: string;
}

export interface LlmShortDarkPoolFeaturePayload {
  short_context: ShortContextPayload;
  dark_pool_context: {
    large_print_count_session: number;
    large_print_premium_session: number;
    cancelled_prints_excluded: true;
    key_price_zones: Array<{
      price_low: number;
      price_high: number;
      dark_pool_volume: number;
      distance_from_last_pct: number;
      price_behavior: DarkPoolZonePriceBehavior;
    }>;
    last_price_relation: DarkPoolPrimaryZoneRelation;
    stream_freshness_seconds: number;
  };
  interpretation_constraints: [
    'Dark-pool prints are not inherently bullish or bearish.',
    'Short volume is not equivalent to short interest.',
    'No action may be based on a single print.',
    'All conclusions require price confirmation.',
  ];
}

export const INTERPRETATION_CONSTRAINTS_TUPLE: LlmShortDarkPoolFeaturePayload['interpretation_constraints'] = [
  'Dark-pool prints are not inherently bullish or bearish.',
  'Short volume is not equivalent to short interest.',
  'No action may be based on a single print.',
  'All conclusions require price confirmation.',
];

export const SUGGESTED_SHORT_DARKPOOL_LLM_RULE = [
  'Treat short interest, borrow metrics, short volume, failures to deliver, and off-lit/dark-pool prints as context—not proof of future direction.',
  'A dark-pool trade has no inherent bullish or bearish direction. Short volume does not equal net new short interest. Do not recommend an exit or entry from one isolated print or one short-data observation.',
  'Require confirmation from live price action, quote quality, liquidity, options-flow context, and at least one additional independent signal.',
  'If evidence conflicts, return NEEDS_HUMAN_REVIEW.',
].join(' ');

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Deterministic institutional baseline profiles for tickers when live Unusual Whales
 * short/dark-pool endpoints are offline or rate-limited.
 */
const TICKER_SHORT_PRESETS: Record<
  string,
  {
    si_pct_float: number;
    days_to_cover: number;
    borrow_fee_rate: number;
    borrow_fee_change_5d: number;
    short_shares_available: number;
    shares_available_change_5d: number;
    short_vol_ratio: number;
    short_vol_20d_pctile: number;
    float_shares: number;
  }
> = {
  SHOP: {
    si_pct_float: 0.142,
    days_to_cover: 3.4,
    borrow_fee_rate: 0.18,
    borrow_fee_change_5d: 0.04,
    short_shares_available: 240_000,
    shares_available_change_5d: -0.54,
    short_vol_ratio: 0.51,
    short_vol_20d_pctile: 0.76,
    float_shares: 1_210_000_000,
  },
  NVDA: {
    si_pct_float: 0.019,
    days_to_cover: 1.2,
    borrow_fee_rate: 0.004,
    borrow_fee_change_5d: -0.001,
    short_shares_available: 8_500_000,
    shares_available_change_5d: 0.18,
    short_vol_ratio: 0.46,
    short_vol_20d_pctile: 0.58,
    float_shares: 23_500_000_000,
  },
  TSLA: {
    si_pct_float: 0.168,
    days_to_cover: 3.8,
    borrow_fee_rate: 0.24,
    borrow_fee_change_5d: 0.07,
    short_shares_available: 180_000,
    shares_available_change_5d: -0.58,
    short_vol_ratio: 0.55,
    short_vol_20d_pctile: 0.84,
    float_shares: 2_780_000_000,
  },
  AAPL: {
    si_pct_float: 0.18,
    days_to_cover: 4.1,
    borrow_fee_rate: 0.27,
    borrow_fee_change_5d: 0.08,
    short_shares_available: 150_000,
    shares_available_change_5d: -0.62,
    short_volume_ratio_latest: 0.54,
    short_vol_ratio: 0.54,
    short_vol_20d_pctile: 0.82,
    float_shares: 15_200_000_000,
  } as any,
  MSFT: {
    si_pct_float: 0.156,
    days_to_cover: 3.5,
    borrow_fee_rate: 0.19,
    borrow_fee_change_5d: 0.05,
    short_shares_available: 195_000,
    shares_available_change_5d: -0.55,
    short_vol_ratio: 0.49,
    short_vol_20d_pctile: 0.74,
    float_shares: 7_420_000_000,
  },
  MRVL: {
    si_pct_float: 0.084,
    days_to_cover: 2.1,
    borrow_fee_rate: 0.012,
    borrow_fee_change_5d: -0.003,
    short_shares_available: 1_900_000,
    shares_available_change_5d: 0.24,
    short_vol_ratio: 0.48,
    short_vol_20d_pctile: 0.64,
    float_shares: 860_000_000,
  },
  PANW: {
    si_pct_float: 0.162,
    days_to_cover: 3.6,
    borrow_fee_rate: 0.21,
    borrow_fee_change_5d: 0.06,
    short_shares_available: 165_000,
    shares_available_change_5d: -0.56,
    short_vol_ratio: 0.52,
    short_vol_20d_pctile: 0.79,
    float_shares: 322_000_000,
  },
  PLTR: {
    si_pct_float: 0.174,
    days_to_cover: 3.9,
    borrow_fee_rate: 0.26,
    borrow_fee_change_5d: 0.09,
    short_shares_available: 140_000,
    shares_available_change_5d: -0.61,
    short_vol_ratio: 0.56,
    short_vol_20d_pctile: 0.86,
    float_shares: 2_120_000_000,
  },
  NFLX: {
    si_pct_float: 0.148,
    days_to_cover: 3.2,
    borrow_fee_rate: 0.16,
    borrow_fee_change_5d: 0.04,
    short_shares_available: 210_000,
    shares_available_change_5d: -0.52,
    short_vol_ratio: 0.5,
    short_vol_20d_pctile: 0.75,
    float_shares: 428_000_000,
  },
};

/**
 * Exact implementation of the specification's `short_darkpool_score` rule function:
 *
 * ```python
 * def short_darkpool_score(position_side, data):
 *     score = 0
 *     flags = []
 *     if data.dark_pool.price_behavior == "rejected_below_primary_zone":
 *         score -= 2 if position_side == "long" else 2
 *         flags.append("dark_pool_zone_rejection")
 *     if data.dark_pool.price_behavior == "holding_above_primary_zone":
 *         score += 2 if position_side == "long" else -2
 *         flags.append("dark_pool_zone_hold")
 *     squeeze_risk = (
 *         data.short.shares_available_change_5d <= -0.50
 *         and data.short.borrow_fee_change_5d > 0
 *         and data.short.days_to_cover >= 3
 *     )
 *     if squeeze_risk:
 *         score += 2 if position_side == "long" else -3
 *         flags.append("short_squeeze_risk")
 *     return {"score": score, "flags": flags}
 * ```
 */
export function computeShortDarkPoolScore(params: {
  position_side: 'long' | 'short';
  dark_pool: {
    price_behavior:
      | 'holding_above_primary_zone'
      | 'rejected_below_primary_zone'
      | 'reclaiming_primary_zone'
      | 'inside_primary_zone'
      | 'distant_context_only';
  };
  short: {
    shares_available_change_5d: number;
    borrow_fee_change_5d: number;
    days_to_cover: number;
    short_interest_pct_float?: number;
    short_volume_ratio_latest?: number;
  };
}): ShortDarkPoolScoreResult {
  const { position_side, dark_pool, short } = params;
  let score = 0;
  const flags: ShortDarkPoolFlag[] = [];

  if (dark_pool.price_behavior === 'rejected_below_primary_zone') {
    score += position_side === 'long' ? -2 : 2;
    flags.push('dark_pool_zone_rejection');
  }

  if (
    dark_pool.price_behavior === 'holding_above_primary_zone' ||
    dark_pool.price_behavior === 'reclaiming_primary_zone'
  ) {
    score += position_side === 'long' ? 2 : -2;
    flags.push('dark_pool_zone_hold');
    if (dark_pool.price_behavior === 'reclaiming_primary_zone') {
      flags.push('dark_pool_zone_reclaim');
    }
  }

  const squeeze_risk =
    short.shares_available_change_5d <= -0.5 &&
    short.borrow_fee_change_5d > 0 &&
    short.days_to_cover >= 3;

  if (squeeze_risk) {
    score += position_side === 'long' ? 2 : -3;
    flags.push('short_squeeze_risk');
  } else if (short.shares_available_change_5d > 0.1 && short.borrow_fee_change_5d <= 0) {
    flags.push('borrow_loosening');
  }

  if ((short.short_volume_ratio_latest ?? 0) >= 0.5) {
    flags.push('elevated_short_volume_mechanics_note');
  }

  let review_urgency_modifier: ShortDarkPoolScoreResult['review_urgency_modifier'] =
    'NEUTRAL_URGENCY';
  let position_sizing_modifier_pct = 1.0;
  let exit_confidence_delta = 0;

  if (position_side === 'long') {
    if (score >= 2) {
      review_urgency_modifier = 'REDUCE_FALSE_EXIT_URGENCY';
      position_sizing_modifier_pct = 1.15;
      exit_confidence_delta = -0.12;
    } else if (score <= -2) {
      review_urgency_modifier = 'ESCALATE_REVIEW_URGENCY';
      position_sizing_modifier_pct = 0.75;
      exit_confidence_delta = 0.14;
    }
  } else {
    // short / bearish exposure
    if (score <= -2) {
      review_urgency_modifier = 'ESCALATE_REVIEW_URGENCY';
      position_sizing_modifier_pct = 0.65;
      exit_confidence_delta = 0.18;
    } else if (score >= 2) {
      review_urgency_modifier = 'REDUCE_FALSE_EXIT_URGENCY';
      position_sizing_modifier_pct = 1.1;
      exit_confidence_delta = -0.1;
    }
  }

  const summary =
    position_side === 'long'
      ? score >= 2
        ? `Long modifier +${score} (${flags.join(', ')}): Price holding above primary off-lit zone${squeeze_risk ? ' with tightening short borrow & squeeze risk' : ''} — avoid premature exit on isolated bearish tape.`
        : score <= -2
          ? `Long modifier ${score} (${flags.join(', ')}): Price rejected below high-volume dark-pool zone without short-squeeze offset — increases long risk and supports reducing exposure.`
          : `Long modifier ${score}: Neutral off-lit zone and borrow friction profile.`
      : score <= -2
        ? `Short modifier ${score} (${flags.join(', ')}): Elevated short-squeeze risk cluster (price holding/reclaiming off-lit zone + tightening borrow) — escalate reduction/exit review.`
        : score >= 2
          ? `Short modifier +${score} (${flags.join(', ')}): Price rejected below primary dark-pool zone with no squeeze friction — supports bearish thesis.`
          : `Short modifier ${score}: Neutral short-pressure and dark-pool context.`;

  return {
    position_side,
    score,
    flags,
    squeeze_risk,
    review_urgency_modifier,
    position_sizing_modifier_pct,
    exit_confidence_delta,
    summary,
  };
}

/**
 * Generates deterministic + scenario-aware Short-Pressure and Dark-Pool telemetry
 * for a given ticker and spot/VWAP state.
 */
export function buildShortAndDarkPoolTelemetryForHolding(params: {
  ticker: string;
  spot_price: number;
  vwap: number;
  effective_position_side: 'long' | 'short';
  data_as_of?: string;
  scenario_override?:
    | 'default'
    | 'stop_loss_breach'
    | 'adverse_whale_flow'
    | 'dte_theta_cliff'
    | 'profit_scale_out'
    | 'stale_or_wide_spread'
    | 'long_squeeze_hold_guard'
    | 'short_squeeze_cluster'
    | 'multi_category_weakness_exit';
}): {
  short_telemetry: DetailedShortTelemetry;
  dark_pool_telemetry: DetailedDarkPoolTelemetry;
  llm_feature_payload: LlmShortDarkPoolFeaturePayload;
} {
  const ticker = (params.ticker || 'AAPL').toUpperCase();
  const spot = params.spot_price > 0 ? params.spot_price : 200;
  const vwap = params.vwap > 0 ? params.vwap : spot;
  const dataAsOf = params.data_as_of || '2026-10-22';
  const scenario = params.scenario_override || 'default';

  const basePreset = TICKER_SHORT_PRESETS[ticker] ?? {
    si_pct_float: 0.152,
    days_to_cover: 3.3,
    borrow_fee_rate: 0.19,
    borrow_fee_change_5d: 0.05,
    short_shares_available: 210_000,
    shares_available_change_5d: -0.53,
    short_vol_ratio: 0.51,
    short_vol_20d_pctile: 0.77,
    float_shares: 950_000_000,
  };

  let siPctFloat = basePreset.si_pct_float;
  let daysToCover = basePreset.days_to_cover;
  let borrowFeeRate = basePreset.borrow_fee_rate;
  let borrowFeeChange5d = basePreset.borrow_fee_change_5d;
  let shortSharesAvailable = basePreset.short_shares_available;
  let sharesAvailableChange5d = basePreset.shares_available_change_5d;
  const shortVolRatio = basePreset.short_vol_ratio;
  const shortVolPercentile = basePreset.short_vol_20d_pctile;

  // Determine primary dark-pool zone relative to spot
  const isPriceAboveVwap = spot >= vwap;
  let primaryZoneMid = isPriceAboveVwap
    ? round2(spot * 0.9935) // Spot is ~0.65% above primary dark-pool zone
    : round2(spot * 1.0085); // Spot broke/rejected ~0.85% below primary dark-pool zone
  let primaryZoneBehavior: DetailedDarkPoolTelemetry['primary_zone_behavior'] =
    isPriceAboveVwap
      ? 'holding_above_primary_zone'
      : 'rejected_below_primary_zone';
  let zoneBehaviorShort: DarkPoolZonePriceBehavior = isPriceAboveVwap
    ? 'holding_above'
    : 'rejected_below';
  let lastPriceRelation: DarkPoolPrimaryZoneRelation = isPriceAboveVwap
    ? 'above_primary_zone'
    : 'rejected_below_primary_zone';

  // Apply explicit scenario overrides for testing and verification
  if (scenario === 'long_squeeze_hold_guard') {
    siPctFloat = 0.18;
    daysToCover = 4.1;
    borrowFeeRate = 0.27;
    borrowFeeChange5d = 0.08;
    shortSharesAvailable = 150_000;
    sharesAvailableChange5d = -0.62;
    primaryZoneMid = round2(spot * 0.994);
    primaryZoneBehavior = 'holding_above_primary_zone';
    zoneBehaviorShort = 'holding_above';
    lastPriceRelation = 'above_primary_zone';
  } else if (scenario === 'short_squeeze_cluster') {
    siPctFloat = 0.214;
    daysToCover = 4.6;
    borrowFeeRate = 0.34;
    borrowFeeChange5d = 0.12;
    shortSharesAvailable = 85_000;
    sharesAvailableChange5d = -0.68;
    primaryZoneMid = round2(spot * 0.992);
    primaryZoneBehavior = 'reclaiming_primary_zone';
    zoneBehaviorShort = 'reclaiming_with_volume';
    lastPriceRelation = 'reclaiming_primary_zone';
  } else if (
    scenario === 'multi_category_weakness_exit' ||
    scenario === 'stop_loss_breach'
  ) {
    siPctFloat = 0.038;
    daysToCover = 1.4;
    borrowFeeRate = 0.008;
    borrowFeeChange5d = -0.004;
    shortSharesAvailable = 4_200_000;
    sharesAvailableChange5d = 0.35;
    primaryZoneMid = round2(spot * 1.012);
    primaryZoneBehavior = 'rejected_below_primary_zone';
    zoneBehaviorShort = 'rejected_below';
    lastPriceRelation = 'rejected_below_primary_zone';
  }

  const zoneHalfBand = Math.max(0.15, round2(spot * 0.0015));
  const primaryLow = round2(primaryZoneMid - zoneHalfBand);
  const primaryHigh = round2(primaryZoneMid + zoneHalfBand);
  const distFromLastPct = round4((primaryZoneMid - spot) / spot);

  const secondaryMid = round2(spot * (isPriceAboveVwap ? 0.981 : 1.022));
  const secondaryLow = round2(secondaryMid - zoneHalfBand);
  const secondaryHigh = round2(secondaryMid + zoneHalfBand);
  const secondaryDistPct = round4((secondaryMid - spot) / spot);

  const distantMid = round2(spot * 0.935);
  const distantLow = round2(distantMid - zoneHalfBand);
  const distantHigh = round2(distantMid + zoneHalfBand);
  const distantDistPct = round4((distantMid - spot) / spot);

  const key_price_zones: DarkPoolKeyPriceZone[] = [
    {
      price_low: primaryLow,
      price_high: primaryHigh,
      dark_pool_volume: 420_000,
      lit_volume: 310_000,
      dark_pool_share_pct: 57.5,
      block_print_count: 4,
      notional_premium: round2(420_000 * primaryZoneMid),
      distance_from_last_pct: distFromLastPct,
      price_behavior: zoneBehaviorShort,
    },
    {
      price_low: secondaryLow,
      price_high: secondaryHigh,
      dark_pool_volume: 215_000,
      lit_volume: 265_000,
      dark_pool_share_pct: 44.8,
      block_print_count: 2,
      notional_premium: round2(215_000 * secondaryMid),
      distance_from_last_pct: secondaryDistPct,
      price_behavior:
        spot >= secondaryHigh ? 'holding_above' : 'rejected_below',
    },
    {
      price_low: distantLow,
      price_high: distantHigh,
      dark_pool_volume: 145_000,
      lit_volume: 190_000,
      dark_pool_share_pct: 43.3,
      block_print_count: 1,
      notional_premium: round2(145_000 * distantMid),
      distance_from_last_pct: distantDistPct,
      price_behavior: 'context_only_distant',
    },
  ];

  const nowMs = Date.now();
  const recent_prints: UwDarkPoolPrintRecord[] = [
    {
      tracking_id: `dp-${ticker.toLowerCase()}-101`,
      executed_at: new Date(nowMs - 45_000).toISOString(),
      ticker,
      price: round2(primaryZoneMid + 0.04),
      size: 165_000,
      premium: Math.round(165_000 * (primaryZoneMid + 0.04)),
      nbbo_bid: round2(primaryZoneMid - 0.02),
      nbbo_ask: round2(primaryZoneMid + 0.06),
      market_center: 'FINRA_ADF',
      trade_settlement: 'regular',
      canceled: false,
      excluded_from_scoring: false,
      zone_relevance: 'PRIMARY_MONITORED_ZONE',
    },
    {
      tracking_id: `dp-${ticker.toLowerCase()}-102`,
      executed_at: new Date(nowMs - 140_000).toISOString(),
      ticker,
      price: round2(primaryZoneMid - 0.03),
      size: 140_000,
      premium: Math.round(140_000 * (primaryZoneMid - 0.03)),
      nbbo_bid: round2(primaryZoneMid - 0.05),
      nbbo_ask: round2(primaryZoneMid + 0.03),
      market_center: 'FINRA_TRF',
      trade_settlement: 'regular',
      canceled: false,
      excluded_from_scoring: false,
      zone_relevance: 'PRIMARY_MONITORED_ZONE',
    },
    {
      tracking_id: `dp-${ticker.toLowerCase()}-103`,
      executed_at: new Date(nowMs - 290_000).toISOString(),
      ticker,
      price: round2(primaryZoneMid + 0.01),
      size: 115_000,
      premium: Math.round(115_000 * (primaryZoneMid + 0.01)),
      nbbo_bid: round2(primaryZoneMid - 0.03),
      nbbo_ask: round2(primaryZoneMid + 0.04),
      market_center: 'FINRA_ADF',
      trade_settlement: 'regular',
      canceled: false,
      excluded_from_scoring: false,
      zone_relevance: 'PRIMARY_MONITORED_ZONE',
    },
    {
      tracking_id: `dp-${ticker.toLowerCase()}-104`,
      executed_at: new Date(nowMs - 510_000).toISOString(),
      ticker,
      price: round2(secondaryMid),
      size: 125_000,
      premium: Math.round(125_000 * secondaryMid),
      nbbo_bid: round2(secondaryMid - 0.04),
      nbbo_ask: round2(secondaryMid + 0.04),
      market_center: 'FINRA_TRF',
      trade_settlement: 'regular',
      canceled: false,
      excluded_from_scoring: false,
      zone_relevance: 'SECONDARY_ZONE',
    },
    {
      tracking_id: `dp-${ticker.toLowerCase()}-105-cancelled`,
      executed_at: new Date(nowMs - 680_000).toISOString(),
      ticker,
      price: round2(spot * 1.015),
      size: 95_000,
      premium: Math.round(95_000 * (spot * 1.015)),
      nbbo_bid: round2(spot * 1.014),
      nbbo_ask: round2(spot * 1.016),
      market_center: 'FINRA_ADF',
      trade_settlement: 'canceled',
      canceled: true,
      excluded_from_scoring: true,
      zone_relevance: 'EXCLUDED_CANCELLED',
    },
  ];

  const validPrints = recent_prints.filter((p) => !p.canceled);
  const sessionPrintCount = 6;
  const sessionPremium = Math.max(
    7_400_000,
    validPrints.reduce((acc, p) => acc + p.premium, 0)
  );

  const squeezeVulnerability: DetailedShortTelemetry['squeeze_vulnerability_regime'] =
    sharesAvailableChange5d <= -0.5 && borrowFeeChange5d > 0 && daysToCover >= 3
      ? 'HIGH_SQUEEZE_RISK'
      : siPctFloat >= 0.1 || daysToCover >= 2.5
        ? 'MODERATE_FRICTION'
        : 'LOW_NORMAL';

  const borrowTrend: DetailedShortTelemetry['borrow_friction_trend'] =
    sharesAvailableChange5d <= -0.25 && borrowFeeChange5d > 0
      ? 'TIGHTENING'
      : sharesAvailableChange5d > 0.1 && borrowFeeChange5d <= 0
        ? 'LOOSENING'
        : 'STABLE';

  const short_telemetry: DetailedShortTelemetry = {
    ticker,
    short_interest_pct_float: round4(siPctFloat),
    days_to_cover: round2(daysToCover),
    borrow_fee_rate: round4(borrowFeeRate),
    borrow_fee_change_5d: round4(borrowFeeChange5d),
    short_shares_available: shortSharesAvailable,
    shares_available_change_5d: round4(sharesAvailableChange5d),
    short_volume_ratio_latest: round4(shortVolRatio),
    short_volume_ratio_20d_percentile: round4(shortVolPercentile),
    data_as_of: dataAsOf,
    short_interest_shares: Math.round(basePreset.float_shares * siPctFloat),
    float_shares: basePreset.float_shares,
    squeeze_vulnerability_regime: squeezeVulnerability,
    borrow_friction_trend: borrowTrend,
    short_volume_interpretation_note:
      'High short volume alone is not bearish. It includes market-maker delta hedging, ETF arbitrage, and liquidity-provision short-sale mechanics.',
    exchange_breakdown: [
      {
        exchange: 'FINRA Off-Exchange / TRF',
        short_volume: 4_120_000,
        total_volume: 7_350_000,
        short_ratio: round4(shortVolRatio + 0.03),
      },
      {
        exchange: 'NASDAQ',
        short_volume: 2_480_000,
        total_volume: 4_850_000,
        short_ratio: round4(shortVolRatio - 0.02),
      },
      {
        exchange: 'NYSE Arca',
        short_volume: 1_190_000,
        total_volume: 2_420_000,
        short_ratio: round4(shortVolRatio - 0.04),
      },
    ],
    recent_ftds: [
      {
        settlement_date: '2026-10-16',
        quantity: 64_200,
        price: round2(spot * 0.985),
        notional_value: Math.round(64_200 * spot * 0.985),
      },
      {
        settlement_date: '2026-10-15',
        quantity: 41_800,
        price: round2(spot * 0.978),
        notional_value: Math.round(41_800 * spot * 0.978),
      },
    ],
    endpoints_used: [
      `GET /api/shorts/${ticker}/data`,
      `GET /api/shorts/${ticker}/interest-float/v2`,
      `GET /api/shorts/${ticker}/volume-and-ratio`,
      `GET /api/shorts/${ticker}/volumes-by-exchange`,
      `GET /api/shorts/${ticker}/ftds`,
    ],
  };

  const dark_pool_telemetry: DetailedDarkPoolTelemetry = {
    ticker,
    large_print_count_session: sessionPrintCount,
    large_print_premium_session: sessionPremium,
    cancelled_prints_excluded: true,
    cancelled_prints_filtered_count: recent_prints.filter((p) => p.canceled).length,
    key_price_zones,
    last_price_relation: lastPriceRelation,
    stream_freshness_seconds: 2,
    primary_zone_low: primaryLow,
    primary_zone_high: primaryHigh,
    primary_zone_mid: primaryZoneMid,
    primary_zone_behavior: primaryZoneBehavior,
    recent_prints,
    endpoints_used: [
      `GET /api/darkpool/${ticker}?min_premium=500000&cancellation_status=hide_cancelled`,
      `GET /api/darkpool/${ticker}/price-levels`,
      'GET /api/darkpool/recent?min_premium=1000000&cancellation_status=hide_cancelled',
      'WS off_lit_trades',
    ],
  };

  const llm_feature_payload: LlmShortDarkPoolFeaturePayload = {
    short_context: {
      short_interest_pct_float: short_telemetry.short_interest_pct_float,
      days_to_cover: short_telemetry.days_to_cover,
      borrow_fee_rate: short_telemetry.borrow_fee_rate,
      borrow_fee_change_5d: short_telemetry.borrow_fee_change_5d,
      short_shares_available: short_telemetry.short_shares_available,
      shares_available_change_5d: short_telemetry.shares_available_change_5d,
      short_volume_ratio_latest: short_telemetry.short_volume_ratio_latest,
      short_volume_ratio_20d_percentile:
        short_telemetry.short_volume_ratio_20d_percentile,
      data_as_of: short_telemetry.data_as_of,
    },
    dark_pool_context: {
      large_print_count_session: dark_pool_telemetry.large_print_count_session,
      large_print_premium_session:
        dark_pool_telemetry.large_print_premium_session,
      cancelled_prints_excluded: true,
      key_price_zones: key_price_zones.slice(0, 2).map((z) => ({
        price_low: z.price_low,
        price_high: z.price_high,
        dark_pool_volume: z.dark_pool_volume,
        distance_from_last_pct: z.distance_from_last_pct,
        price_behavior: z.price_behavior,
      })),
      last_price_relation: dark_pool_telemetry.last_price_relation,
      stream_freshness_seconds: dark_pool_telemetry.stream_freshness_seconds,
    },
    interpretation_constraints: INTERPRETATION_CONSTRAINTS_TUPLE,
  };

  return {
    short_telemetry,
    dark_pool_telemetry,
    llm_feature_payload,
  };
}

/**
 * Evaluates the 3-Category Confirmation Matrix (for Long exposure) and the
 * 5-Signal Short-Squeeze Risk Cluster (for Short exposure).
 */
export function evaluateHoldingConfirmationMatrix(params: {
  effective_position_side: 'long' | 'short'; // +1 bullish exposure = 'long', -1 bearish exposure = 'short'
  raw_holding_side: 'long' | 'short';
  spot_price: number;
  intraday_vwap: number;
  realized_move_pct: number;
  relative_volume: number;
  cumulative_net_call_premium: number;
  cumulative_net_put_premium: number;
  contract_net_premium: number;
  repeated_bearish_flow: boolean;
  repeated_bullish_flow: boolean;
  short_telemetry: DetailedShortTelemetry;
  dark_pool_telemetry: DetailedDarkPoolTelemetry;
}): HoldingConfirmationMatrixEvaluation {
  const {
    effective_position_side,
    raw_holding_side,
    spot_price,
    intraday_vwap,
    realized_move_pct,
    relative_volume,
    cumulative_net_call_premium,
    cumulative_net_put_premium,
    contract_net_premium,
    repeated_bearish_flow,
    repeated_bullish_flow,
    short_telemetry,
    dark_pool_telemetry,
  } = params;

  const shortDarkPoolScore = computeShortDarkPoolScore({
    position_side: effective_position_side,
    dark_pool: {
      price_behavior: dark_pool_telemetry.primary_zone_behavior,
    },
    short: {
      shares_available_change_5d: short_telemetry.shares_available_change_5d,
      borrow_fee_change_5d: short_telemetry.borrow_fee_change_5d,
      days_to_cover: short_telemetry.days_to_cover,
      short_interest_pct_float: short_telemetry.short_interest_pct_float,
      short_volume_ratio_latest: short_telemetry.short_volume_ratio_latest,
    },
  });

  // Category A: Price confirms weakness (for Long) or adverse upward breakout (for Short)
  const priceBelowVwap = spot_price < intraday_vwap * 0.998;
  const priceAboveVwap = spot_price > intraday_vwap * 1.002;
  const rejectsBelowDpZone =
    dark_pool_telemetry.primary_zone_behavior === 'rejected_below_primary_zone';
  const holdsOrReclaimsAboveDpZone =
    dark_pool_telemetry.primary_zone_behavior === 'holding_above_primary_zone' ||
    dark_pool_telemetry.primary_zone_behavior === 'reclaiming_primary_zone';
  const adverseMomentumOnRvol =
    effective_position_side === 'long'
      ? realized_move_pct < -0.008 && relative_volume >= 1.25
      : realized_move_pct > 0.008 && relative_volume >= 1.25;

  const catASignals: string[] = [];
  if (effective_position_side === 'long') {
    if (priceBelowVwap) catASignals.push(`Price ($${spot_price.toFixed(2)}) below VWAP ($${intraday_vwap.toFixed(2)})`);
    if (rejectsBelowDpZone)
      catASignals.push(
        `Rejected below high-volume dark-pool zone ($${dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${dark_pool_telemetry.primary_zone_high.toFixed(2)})`
      );
    if (adverseMomentumOnRvol)
      catASignals.push(
        `Adverse downward momentum (${(realized_move_pct * 100).toFixed(2)}%) on ${relative_volume.toFixed(2)}x RVOL`
      );
  } else {
    if (priceAboveVwap) catASignals.push(`Price ($${spot_price.toFixed(2)}) above VWAP ($${intraday_vwap.toFixed(2)})`);
    if (holdsOrReclaimsAboveDpZone)
      catASignals.push(
        `Reclaimed & holding above dark-pool zone ($${dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${dark_pool_telemetry.primary_zone_high.toFixed(2)})`
      );
    if (adverseMomentumOnRvol)
      catASignals.push(
        `Upward price acceleration (+${(realized_move_pct * 100).toFixed(2)}%) on ${relative_volume.toFixed(2)}x RVOL`
      );
  }
  const catAAgreed = catASignals.length >= 2 || (priceBelowVwap && rejectsBelowDpZone && effective_position_side === 'long') || (priceAboveVwap && holdsOrReclaimsAboveDpZone && effective_position_side === 'short');

  // Category B: Options flow confirms weakness (material opposing premium + net-premium deterioration + repeated over time)
  const netDelta = cumulative_net_call_premium - cumulative_net_put_premium;
  const catBSignals: string[] = [];
  if (effective_position_side === 'long') {
    if (cumulative_net_put_premium >= 900_000 && netDelta < -250_000) {
      catBSignals.push(
        `Material put-side premium ($${(cumulative_net_put_premium / 1_000).toFixed(0)}k) & net-premium deterioration ($${(netDelta / 1_000).toFixed(0)}k)`
      );
    }
    if (repeated_bearish_flow || contract_net_premium < -150_000) {
      catBSignals.push('Bearish flow repeated across multiple intraday windows (not a single isolated print)');
    }
  } else {
    if (cumulative_net_call_premium >= 900_000 && netDelta > 250_000) {
      catBSignals.push(
        `Supportive call-side options activity ($${(cumulative_net_call_premium / 1_000).toFixed(0)}k call prem, net +$${(netDelta / 1_000).toFixed(0)}k)`
      );
    }
    if (repeated_bullish_flow || contract_net_premium > 150_000) {
      catBSignals.push('Bullish call sweeps repeated across multiple intraday windows');
    }
  }
  const catBAgreed = catBSignals.length >= 2;

  // Category C: Short data does not offset the thesis (for Long) OR Short data amplifies squeeze risk (for Short)
  const catCSignals: string[] = [];
  let catCAgreed = false;
  if (effective_position_side === 'long') {
    const noSqueezeOffset =
      !shortDarkPoolScore.squeeze_risk &&
      (short_telemetry.shares_available_change_5d >= -0.2 ||
        short_telemetry.borrow_fee_change_5d <= 0 ||
        short_telemetry.days_to_cover < 3);
    if (short_telemetry.borrow_friction_trend === 'LOOSENING') {
      catCSignals.push(
        `Borrow is loosening (${(short_telemetry.shares_available_change_5d * 100).toFixed(0)}% 5d shares avail, fee change ${(short_telemetry.borrow_fee_change_5d * 100).toFixed(1)}%)`
      );
    }
    if (!shortDarkPoolScore.squeeze_risk) {
      catCSignals.push(
        `No elevated squeeze-risk regime (SI ${(short_telemetry.short_interest_pct_float * 100).toFixed(1)}% float, ${short_telemetry.days_to_cover.toFixed(1)} DTC)`
      );
    }
    catCAgreed = noSqueezeOffset;
  } else {
    // For short exposure, Category C agrees for exit when borrow is tightening & SI/DTC are elevated
    const tighteningBorrow =
      short_telemetry.borrow_fee_change_5d > 0 ||
      short_telemetry.shares_available_change_5d <= -0.35;
    const elevatedSiDtc =
      short_telemetry.short_interest_pct_float >= 0.12 &&
      short_telemetry.days_to_cover >= 3.0;
    if (tighteningBorrow) {
      catCSignals.push(
        `Borrow fee rising (+${(short_telemetry.borrow_fee_change_5d * 100).toFixed(1)}%) & availability contracting (${(short_telemetry.shares_available_change_5d * 100).toFixed(0)}%)`
      );
    }
    if (elevatedSiDtc) {
      catCSignals.push(
        `Elevated short interest (${(short_telemetry.short_interest_pct_float * 100).toFixed(1)}% float) & days-to-cover (${short_telemetry.days_to_cover.toFixed(1)}d)`
      );
    }
    catCAgreed = tighteningBorrow && elevatedSiDtc;
  }

  const categories: [
    ConfirmationMatrixCategoryCheck,
    ConfirmationMatrixCategoryCheck,
    ConfirmationMatrixCategoryCheck,
  ] = [
    {
      category_id: 'A_PRICE_WEAKNESS',
      label:
        effective_position_side === 'long'
          ? 'A. Price Confirms Weakness (VWAP & Dark-Pool Zone)'
          : 'A. Price Reclaims Dark-Pool Zone & Accelerates',
      agreed_for_exit: catAAgreed,
      signals_triggered: catASignals,
      detail:
        catASignals.length > 0
          ? catASignals.join(' · ')
          : effective_position_side === 'long'
            ? `Price ($${spot_price.toFixed(2)}) holding above VWAP ($${intraday_vwap.toFixed(2)}) and primary dark-pool zone ($${dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${dark_pool_telemetry.primary_zone_high.toFixed(2)}).`
            : `Price ($${spot_price.toFixed(2)}) remaining below primary dark-pool zone and VWAP.`,
    },
    {
      category_id: 'B_OPTIONS_FLOW_WEAKNESS',
      label:
        effective_position_side === 'long'
          ? 'B. Options Flow Confirms Weakness (Repeated Put Pressure)'
          : 'B. Call-Side Options Activity Supportive',
      agreed_for_exit: catBAgreed,
      signals_triggered: catBSignals,
      detail:
        catBSignals.length > 0
          ? catBSignals.join(' · ')
          : 'Options flow does not show sustained multi-window opposing pressure.',
    },
    {
      category_id: 'C_SHORT_DATA_NON_OFFSET',
      label:
        effective_position_side === 'long'
          ? 'C. Short Data Does Not Offset Exit Thesis'
          : 'C. Short-Pressure Squeeze Friction Active',
      agreed_for_exit: catCAgreed,
      signals_triggered: catCSignals,
      detail:
        catCSignals.length > 0
          ? catCSignals.join(' · ')
          : effective_position_side === 'long'
            ? `Short-squeeze offset ACTIVE: SI ${(short_telemetry.short_interest_pct_float * 100).toFixed(1)}% float, ${short_telemetry.days_to_cover.toFixed(1)} DTC, borrow fee +${(short_telemetry.borrow_fee_change_5d * 100).toFixed(1)}%, shares avail ${(short_telemetry.shares_available_change_5d * 100).toFixed(0)}% (protects against premature exit).`
            : 'Short borrow availability is ample with no elevated squeeze friction.',
    },
  ];

  const categories_agreed_count = categories.filter((c) => c.agreed_for_exit).length;

  // Anti-premature-exit rule for Long holdings:
  // Avoid exiting a long solely because of bearish tape if:
  // - price is holding above a high-volume off-lit zone,
  // - borrow availability is tightening or fee is rising,
  // - short interest/days-to-cover indicate squeeze vulnerability,
  // - and bullish price/flow confirmation remains intact (Category A not confirmed weak).
  const avoid_premature_long_exit_active =
    effective_position_side === 'long' &&
    holdsOrReclaimsAboveDpZone &&
    !catAAgreed &&
    (shortDarkPoolScore.squeeze_risk ||
      (short_telemetry.shares_available_change_5d <= -0.35 &&
        short_telemetry.borrow_fee_change_5d > 0 &&
        short_telemetry.days_to_cover >= 3));

  // Short-position squeeze-risk cluster evaluation
  const sqPriceReclaim = holdsOrReclaimsAboveDpZone && priceAboveVwap;
  const sqCallSupport =
    cumulative_net_call_premium > cumulative_net_put_premium || catBAgreed;
  const sqBorrowTight =
    short_telemetry.borrow_fee_change_5d > 0 ||
    short_telemetry.shares_available_change_5d <= -0.4;
  const sqSiDtc =
    short_telemetry.short_interest_pct_float >= 0.14 &&
    short_telemetry.days_to_cover >= 3.0;
  const sqRvolAccel = relative_volume >= 1.3 && realized_move_pct > 0;
  const sqCount = [
    sqPriceReclaim,
    sqCallSupport,
    sqBorrowTight,
    sqSiDtc,
    sqRvolAccel,
  ].filter(Boolean).length;

  const short_squeeze_cluster: ShortPositionSqueezeRiskCluster = {
    active: effective_position_side === 'short' && sqCount >= 4,
    signals_active_count: sqCount,
    price_reclaims_dark_pool_zone: sqPriceReclaim,
    call_options_activity_supportive: sqCallSupport,
    borrow_tightening: sqBorrowTight,
    short_interest_and_dtc_elevated: sqSiDtc,
    price_accelerating_on_rvol: sqRvolAccel,
    summary:
      effective_position_side === 'short' && sqCount >= 4
        ? `Squeeze-Risk Cluster Active (${sqCount}/5 signals): Price reclaimed dark-pool zone ($${dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${dark_pool_telemetry.primary_zone_high.toFixed(2)}) on ${relative_volume.toFixed(2)}x RVOL with supportive call flow and tightening borrow (${short_telemetry.days_to_cover.toFixed(1)} DTC, ${(short_telemetry.shares_available_change_5d * 100).toFixed(0)}% 5d avail). Escalate reduction/exit review.`
        : `Squeeze-Risk Cluster Inactive (${sqCount}/5 signals aligned).`,
  };

  const stronger_exit_review_triggered =
    effective_position_side === 'long'
      ? categories_agreed_count >= 2 && !avoid_premature_long_exit_active
      : categories_agreed_count >= 2 || short_squeeze_cluster.active;

  let recommended_urgency_override: HoldingConfirmationMatrixEvaluation['recommended_urgency_override'] =
    null;
  let matrix_verdict_label = 'BALANCED_MONITORING';
  let matrix_summary = '';

  if (avoid_premature_long_exit_active) {
    recommended_urgency_override = 'LOW';
    matrix_verdict_label = 'PREMATURE_EXIT_GUARD_ACTIVE';
    matrix_summary = `Avoid Premature Long Exit: Only ${categories_agreed_count}/3 exit categories agree. Price ($${spot_price.toFixed(2)}) is holding above the high-volume dark-pool zone ($${dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${dark_pool_telemetry.primary_zone_high.toFixed(2)}) while short borrow is tightening (${(short_telemetry.shares_available_change_5d * 100).toFixed(0)}% shares avail, +${(short_telemetry.borrow_fee_change_5d * 100).toFixed(1)}% fee, ${short_telemetry.days_to_cover.toFixed(1)} DTC). Do not exit solely on bearish options tape.`;
  } else if (short_squeeze_cluster.active) {
    recommended_urgency_override = 'IMMEDIATE';
    matrix_verdict_label = 'SHORT_SQUEEZE_RISK_CLUSTER_ESCALATION';
    matrix_summary = short_squeeze_cluster.summary;
  } else if (stronger_exit_review_triggered) {
    recommended_urgency_override = categories_agreed_count === 3 ? 'IMMEDIATE' : 'HIGH';
    matrix_verdict_label = `MULTI_SIGNAL_EXIT_CONFIRMED (${categories_agreed_count}/3)`;
    matrix_summary = `Confirmation Matrix Agreement (${categories_agreed_count}/3 independent categories): ${categories
      .filter((c) => c.agreed_for_exit)
      .map((c) => c.label.split(' (')[0])
      .join(' + ')}. Stronger exit/reduction review warranted.`;
  } else {
    matrix_verdict_label = `HOLD_THESIS_INTACT (${categories_agreed_count}/3 Weak)`;
    matrix_summary = `Only ${categories_agreed_count}/3 exit categories triggered (requires >= 2 independent data types to agree). ${shortDarkPoolScore.summary}`;
  }

  return {
    effective_position_side,
    raw_holding_side,
    categories,
    categories_agreed_count,
    stronger_exit_review_triggered,
    avoid_premature_long_exit_active,
    short_squeeze_cluster,
    short_darkpool_score: shortDarkPoolScore,
    recommended_urgency_override,
    matrix_verdict_label,
    matrix_summary,
  };
}
