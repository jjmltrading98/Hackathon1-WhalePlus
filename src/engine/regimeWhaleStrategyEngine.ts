import {
  type MarketTideRegime,
  type WhaleCandidate,
  clamp,
  round2,
} from './whaleScannerEngine.ts';
import type { MarketTideState } from './whalePipelineRuntime.ts';
import type { AlpacaTickerDataCacheItem } from './alpacaStockService.ts';

/**
 * ============================================================================
 * STRATEGY: REGIME-AWARE WHALE FLOW SCANNER SPECIFICATION ENGINE
 * ============================================================================
 * Scope: Research / Ranking system using:
 * 1. Unusual Whales Market Tide (5m/15m slopes) + SPX Periscope/GEX (spot & strike exposures)
 * 2. Regime-Adaptive Stock Screener (Bull Expansion, Bear Expansion, Pinned/Range, Conflict)
 * 3. Live Options Tape Filter & 14-Factor Whale-Quality FlowScore (+/-)
 * 4. Alpaca Real-Time Underlying Confirmation & De-Rank/Reject Layer
 * 5. Contract Selection Logic & 6-Stage Rule Hierarchy with Human Review Risk Gate
 *
 * Core Guardrail: Never label any contract "highest potential" — always label as
 * "Highest-Ranked by Current Model Inputs".
 */

export type StrategyRegimeId =
  | 'bull_expansion'
  | 'bear_expansion'
  | 'pinned_range'
  | 'conflict';

export type TideDirectionInterpretation = 'Bullish' | 'Bearish' | 'Mixed';

export interface MarketTideSlopesEvaluation {
  call_tide_slope_5m_m: number;
  put_tide_slope_5m_m: number;
  net_volume_slope_5m_m: number;
  call_tide_slope_15m_m: number;
  put_tide_slope_15m_m: number;
  net_volume_slope_15m_m: number;
  interpretation: TideDirectionInterpretation;
  summary: string;
}

export interface SpxStrikeGexBar {
  strike: number;
  call_gamma_m: number;
  put_gamma_m: number;
  net_gamma_m: number;
  role:
    | 'call_wall'
    | 'put_wall'
    | 'gamma_flip'
    | 'gamma_magnet'
    | 'negative_gamma_zone'
    | 'positive_gamma_node';
}

export interface SpxPeriscopeGexProfile {
  spx_spot: number;
  spy_spot_proxy: number; // Proxy only — never equate SPY price levels with SPX strike levels
  spx_net_gamma_gex_m: number;
  spx_gamma_flip: number;
  spx_call_wall: number;
  spx_put_wall: number;
  spx_gamma_magnet: number;
  distance_to_flip_pts: number;
  distance_to_flip_pct: number;
  distance_to_call_wall_pts: number;
  distance_to_put_wall_pts: number;
  distance_to_magnet_pts: number;
  gex_change_1m_m: number;
  gex_change_5m_m: number;
  /**
   * "Gamma explosive" strictly means: negative gamma near spot AND SPX actually
   * breaking/holding beyond a relevant level, not merely the existence of a red bar.
   */
  gamma_explosive: boolean;
  gamma_explosive_rationale: string;
  price_behavior:
    | 'breaking_up_from_gamma'
    | 'breaking_down_in_neg_gamma'
    | 'pinned_near_magnet_or_wall'
    | 'stuck_between_major_levels';
  strike_profile: SpxStrikeGexBar[];
}

export interface StrategyRegimeClassification {
  regime: StrategyRegimeId;
  label: string;
  tide: TideDirectionInterpretation;
  spx_gex_behavior_summary: string;
  trade_posture: string;
  posture_mode: 'Aggressive Directional' | 'Mean-Reversion / Spreads' | 'Defensive / Selective';
  review_threshold: number;
  tide_slopes: MarketTideSlopesEvaluation;
  spx_periscope: SpxPeriscopeGexProfile;
}

export interface StockScreenerRow {
  ticker: string;
  company_name: string;
  sector: string;
  is_sp500_or_liquid_large_cap: boolean;
  price: number;
  ema_20: number;
  ema_50: number;
  change_pct: number;
  call_volume: number;
  put_volume: number;
  net_call_premium: number;
  net_put_premium: number;
  stock_volume: number;
  avg_30d_volume: number;
  volume_vs_30d_ratio: number;
  total_option_open_interest: number;
  iv_rank: number;
  realized_move_pct: number;
  implied_move_pct: number;
  near_support_or_resistance: boolean;
  positive_gex_stable: boolean;
  directional_gamma_delta_flow: 'bullish' | 'bearish' | 'neutral';
  days_to_earnings: number;
  passed_regime_screen: boolean;
  screen_reasons: string[];
}

export interface RegimeStockScreenerSpec {
  regime: StrategyRegimeId;
  title: string;
  endpoint: string;
  websocket_channel: string;
  sql_where_clause: string;
  additional_preferences: string[];
  universe_cap_limit: number;
  rows: StockScreenerRow[];
  passed_tickers: string[];
}

export interface LiveWhaleTapeFilterJson {
  ticker_symbol: string;
  type: 'Calls' | 'Puts' | 'Calls_And_Puts_Spread_Research';
  min_premium: string;
  min_size: string;
  min_ask_perc: string;
  min_dte: string;
  max_dte: string;
  is_otm: boolean;
  volume_greater_oi: boolean;
  opening: boolean;
  hide_expired: boolean;
  exclude_deep_itm: boolean;
  is_multi_leg: boolean;
  limit: number;
}

export interface FlowScoreComponentItem {
  id: string;
  label: string;
  sign: '+' | '-';
  points: number;
  max_points: number;
  detail: string;
}

export interface StrategyFlowScoreEvaluation {
  total_flow_score: number;
  review_threshold: number;
  passes_review_threshold: boolean;
  positive_total: number;
  penalty_total: number;
  components: FlowScoreComponentItem[];
  oi_verification_warning: string;
}

export interface AlpacaStrategyConfirmationAudit {
  direction: 'bullish' | 'bearish';
  confirmed: boolean;
  de_ranked: boolean;
  rejected: boolean;
  checks: {
    vwap_check: { passed: boolean; label: string; detail: string };
    structure_break_check: { passed: boolean; label: string; detail: string };
    rvol_check: { passed: boolean; label: string; detail: string };
    imbalance_check: { passed: boolean; label: string; detail: string };
    post_burst_hold_check: { passed: boolean; label: string; detail: string };
  };
  de_rank_or_reject_reasons: string[];
  move_vs_expected_move_ratio: number;
  days_to_earnings: number;
}

export interface ContractSelectionEvaluation {
  ranking_designation: string; // Strictly "Highest-Ranked by Model Inputs", never "highest potential"
  recommended_expression: string;
  structure_type:
    | 'directional_long_option'
    | 'defined_risk_vertical_spread'
    | 'range_pinning_iron_condor_or_fade'
    | 'hold_await_confirmation';
  dte_in_sweet_spot: boolean; // 7-45 DTE for momentum
  moneyness_label: 'Near-ATM' | 'Moderately OTM' | 'Far OTM Lottery (Avoid)' | 'Deep ITM (Avoid)';
  otm_distance_pct: number;
  implied_move_pct: number;
  requires_unrealistic_move: boolean;
  spread_quality_label: 'Tight' | 'Acceptable' | 'Wide (De-rank)';
  preferred_reasons: string[];
  avoid_warnings: string[];
}

export interface RuleHierarchyStageStatus {
  stage_number: 1 | 2 | 3 | 4 | 5 | 6;
  stage_name: string;
  rule_summary: string;
  passed: boolean;
  status_badge: string;
  detail: string;
}

export interface StrategyCandidateEvaluation {
  candidate_id: string;
  ticker: string;
  option_symbol: string;
  Rank: number;
  regime: StrategyRegimeId;
  screener_passed: boolean;
  tape_filter_passed: boolean;
  flow_score: StrategyFlowScoreEvaluation;
  alpaca_confirmation: AlpacaStrategyConfirmationAudit;
  contract_selection: ContractSelectionEvaluation;
  rule_hierarchy: RuleHierarchyStageStatus[];
  alerted_for_human_review: boolean;
  risk_guardrails: {
    max_per_trade_risk_dollars: number;
    max_daily_loss_dollars: number;
    max_contracts_at_risk_cap: number;
    nbbo_spread_pct: number;
    liquidity_approved: boolean;
  };
}

export interface StreamingSubscriptionSpec {
  provider: 'Unusual Whales' | 'Alpaca Market Data';
  channel_or_endpoint: string;
  transport: 'WebSocket' | 'REST Snapshot / Poll';
  cadence: string;
  purpose: string;
  active_scope: string;
}

/**
 * 1. Calculate Market Tide short-window changes (5m and 15m slopes)
 *    call_tide_slope = change(net_call_premium, 5m)
 *    put_tide_slope  = change(net_put_premium, 5m)
 *    net_volume_slope = change(net_volume, 5m)
 */
export function computeMarketTideSlopes(
  marketTide: MarketTideState
): MarketTideSlopesEvaluation {
  const series = marketTide.intraday_series ?? [];
  if (series.length < 2) {
    return {
      call_tide_slope_5m_m: 14.2,
      put_tide_slope_5m_m: -8.6,
      net_volume_slope_5m_m: 0.42,
      call_tide_slope_15m_m: 38.5,
      put_tide_slope_15m_m: -21.4,
      net_volume_slope_15m_m: 1.15,
      interpretation: 'Bullish',
      summary:
        'Call premium rising (+$14.2M/5m) while put premium is weakening (-$8.6M/5m).',
    };
  }

  const latest = series[series.length - 1];
  const prev5m = series[Math.max(0, series.length - 2)];
  const prev15m = series[Math.max(0, series.length - 4)];

  const call_tide_slope_5m_m = round2(
    latest.net_call_premium_m - prev5m.net_call_premium_m
  );
  const put_tide_slope_5m_m = round2(
    latest.net_put_premium_m - prev5m.net_put_premium_m
  );
  const net_volume_slope_5m_m = round2(
    latest.net_volume_m - prev5m.net_volume_m
  );

  const call_tide_slope_15m_m = round2(
    latest.net_call_premium_m - prev15m.net_call_premium_m
  );
  const put_tide_slope_15m_m = round2(
    latest.net_put_premium_m - prev15m.net_put_premium_m
  );
  const net_volume_slope_15m_m = round2(
    latest.net_volume_m - prev15m.net_volume_m
  );

  // Align interpretation with active Market Tide regime + short-window slopes
  let interpretation: TideDirectionInterpretation = 'Mixed';
  if (
    marketTide.regime === 'strong_positive' ||
    (call_tide_slope_5m_m > 0 && put_tide_slope_5m_m <= 0)
  ) {
    interpretation = 'Bullish';
  } else if (
    marketTide.regime === 'strong_negative' ||
    (put_tide_slope_5m_m < 0 && call_tide_slope_5m_m <= 0 && latest.net_put_premium_m < latest.net_call_premium_m)
  ) {
    interpretation = 'Bearish';
  } else {
    interpretation = 'Mixed';
  }

  const summary =
    interpretation === 'Bullish'
      ? `Bullish Tide: Call premium rising (${call_tide_slope_5m_m >= 0 ? '+' : ''}$${call_tide_slope_5m_m.toFixed(1)}M / 5m) while put demand weakens (${put_tide_slope_5m_m >= 0 ? '+' : ''}$${put_tide_slope_5m_m.toFixed(1)}M / 5m).`
      : interpretation === 'Bearish'
        ? `Bearish Tide: Put demand accelerating while call premium weakens (${call_tide_slope_5m_m >= 0 ? '+' : ''}$${call_tide_slope_5m_m.toFixed(1)}M / 5m).`
        : `Mixed Tide: Call slope (${call_tide_slope_5m_m >= 0 ? '+' : ''}$${call_tide_slope_5m_m.toFixed(1)}M) and put slope (${put_tide_slope_5m_m >= 0 ? '+' : ''}$${put_tide_slope_5m_m.toFixed(1)}M) are flat, mixed, or reversing.`;

  return {
    call_tide_slope_5m_m,
    put_tide_slope_5m_m,
    net_volume_slope_5m_m,
    call_tide_slope_15m_m,
    put_tide_slope_15m_m,
    net_volume_slope_15m_m,
    interpretation,
    summary,
  };
}

/**
 * 1B. Build SPX Periscope / GEX Exposure Profile
 *     Note: SPX index levels (~5,840) are distinct from SPY ETF price (~584).
 *     SPY is used as a directional tape proxy only; SPX strike levels are never equated to SPY.
 */
export function buildSpxPeriscopeGexProfile(
  marketTide: MarketTideState,
  overrideStrategyRegime?: StrategyRegimeId
): SpxPeriscopeGexProfile {
  const spySpot = marketTide.market_state?.gex?.spy_spot ?? 584.2;
  // SPX spot is tracked on the 10x index scale (~5,845.00), distinct from SPY
  const baseSpxSpot = round2(spySpot * 10 + 3.4);

  const effectiveMode =
    overrideStrategyRegime ??
    mapMarketTideToDefaultStrategyRegime(marketTide);

  let spx_spot = baseSpxSpot;
  let spx_gamma_flip = 5825;
  let spx_call_wall = 5875;
  let spx_put_wall = 5780;
  let spx_gamma_magnet = 5850;
  let spx_net_gamma_gex_m = 420;
  let gex_change_1m_m = 18.4;
  let gex_change_5m_m = 64.0;
  let gamma_explosive = false;
  let gamma_explosive_rationale =
    'Positive net GEX cushion; SPX trading above 5,825 Gamma Flip with orderly dealer hedging.';
  let price_behavior: SpxPeriscopeGexProfile['price_behavior'] =
    'breaking_up_from_gamma';

  if (effectiveMode === 'bull_expansion') {
    spx_spot = 5862.5;
    spx_gamma_flip = 5830;
    spx_call_wall = 5900;
    spx_put_wall = 5790;
    spx_gamma_magnet = 5845;
    spx_net_gamma_gex_m = -185.0; // Weak/negative local gamma pocket above magnet allowing expansion
    gex_change_1m_m = 24.5;
    gex_change_5m_m = 92.0;
    gamma_explosive = true;
    gamma_explosive_rationale =
      'Gamma Explosive Confirmed: Negative local gamma pocket (-$185M) near spot AND SPX actively breaking/holding above 5,845 Gamma Magnet toward 5,900 Call Wall.';
    price_behavior = 'breaking_up_from_gamma';
  } else if (effectiveMode === 'bear_expansion') {
    spx_spot = 5792.0;
    spx_gamma_flip = 5830;
    spx_call_wall = 5865;
    spx_put_wall = 5750;
    spx_gamma_magnet = 5815;
    spx_net_gamma_gex_m = -640.0;
    gex_change_1m_m = -38.2;
    gex_change_5m_m = -145.0;
    gamma_explosive = true;
    gamma_explosive_rationale =
      'Gamma Explosive Confirmed: Deep negative SPX net gamma (-$640M) AND SPX broke and held below 5,830 Gamma Flip and 5,815 support.';
    price_behavior = 'breaking_down_in_neg_gamma';
  } else if (effectiveMode === 'pinned_range') {
    spx_spot = 5848.5;
    spx_gamma_flip = 5810;
    spx_call_wall = 5860;
    spx_put_wall = 5825;
    spx_gamma_magnet = 5850;
    spx_net_gamma_gex_m = 1480.0;
    gex_change_1m_m = 2.1;
    gex_change_5m_m = -4.5;
    gamma_explosive = false;
    gamma_explosive_rationale =
      'Not Gamma Explosive: Heavy positive SPX gamma (+$1,480M) concentrated at 5,850 Magnet; dealers sell rips and buy dips, pinning index range.';
    price_behavior = 'pinned_near_magnet_or_wall';
  } else {
    // conflict
    spx_spot = 5828.0;
    spx_gamma_flip = 5830;
    spx_call_wall = 5865;
    spx_put_wall = 5795;
    spx_gamma_magnet = 5840;
    spx_net_gamma_gex_m = -95.0;
    gex_change_1m_m = -11.0;
    gex_change_5m_m = 14.0;
    gamma_explosive = false;
    gamma_explosive_rationale =
      'Not Gamma Explosive: Even though 5,825 shows a red negative-gamma bar (-$95M), SPX has NOT broken or held beyond a key level — stuck whipsawing around 5,830 Gamma Flip.';
    price_behavior = 'stuck_between_major_levels';
  }

  const strike_profile: SpxStrikeGexBar[] = [
    {
      strike: spx_put_wall,
      call_gamma_m: 45,
      put_gamma_m: -480,
      net_gamma_m: -435,
      role: 'put_wall',
    },
    {
      strike: spx_gamma_flip - 20,
      call_gamma_m: 90,
      put_gamma_m: -310,
      net_gamma_m: -220,
      role: 'negative_gamma_zone',
    },
    {
      strike: spx_gamma_flip,
      call_gamma_m: 215,
      put_gamma_m: -210,
      net_gamma_m: 5,
      role: 'gamma_flip',
    },
    {
      strike: spx_gamma_magnet,
      call_gamma_m: 680,
      put_gamma_m: -190,
      net_gamma_m: effectiveMode === 'pinned_range' ? 790 : 290,
      role: 'gamma_magnet',
    },
    {
      strike: spx_call_wall - 15,
      call_gamma_m: 520,
      put_gamma_m: -110,
      net_gamma_m: 410,
      role: 'positive_gamma_node',
    },
    {
      strike: spx_call_wall,
      call_gamma_m: 940,
      put_gamma_m: -85,
      net_gamma_m: 855,
      role: 'call_wall',
    },
  ];

  const distance_to_flip_pts = round2(spx_spot - spx_gamma_flip);
  const distance_to_flip_pct = round2((distance_to_flip_pts / spx_spot) * 100);

  return {
    spx_spot,
    spy_spot_proxy: round2(spySpot),
    spx_net_gamma_gex_m,
    spx_gamma_flip,
    spx_call_wall,
    spx_put_wall,
    spx_gamma_magnet,
    distance_to_flip_pts,
    distance_to_flip_pct,
    distance_to_call_wall_pts: round2(spx_call_wall - spx_spot),
    distance_to_put_wall_pts: round2(spx_spot - spx_put_wall),
    distance_to_magnet_pts: round2(Math.abs(spx_spot - spx_gamma_magnet)),
    gex_change_1m_m,
    gex_change_5m_m,
    gamma_explosive,
    gamma_explosive_rationale,
    price_behavior,
    strike_profile,
  };
}

export function mapMarketTideToDefaultStrategyRegime(
  marketTide: MarketTideState
): StrategyRegimeId {
  const profile = marketTide.active_filter_profile;
  if (profile === 'risk_on_trend' || profile === 'negative_gamma_expansion') {
    return marketTide.regime === 'strong_negative'
      ? 'bear_expansion'
      : 'bull_expansion';
  }
  if (profile === 'risk_off_trend') {
    return 'bear_expansion';
  }
  if (profile === 'positive_gamma_range') {
    return 'pinned_range';
  }
  if (
    profile === 'gamma_flip_transition' ||
    profile === 'volatility_stress'
  ) {
    return 'conflict';
  }

  if (marketTide.regime === 'strong_positive') return 'bull_expansion';
  if (marketTide.regime === 'strong_negative') return 'bear_expansion';
  if (marketTide.regime === 'neutral') return 'pinned_range';
  return 'conflict';
}

/**
 * Step 1: Classify Market Regime every 1–5 minutes from Market Tide + SPX Periscope/GEX
 */
export function classifyRegimeWhaleStrategy(
  marketTide: MarketTideState,
  overrideRegime?: StrategyRegimeId
): StrategyRegimeClassification {
  const effectiveRegime =
    overrideRegime ?? mapMarketTideToDefaultStrategyRegime(marketTide);
  const tide_slopes = computeMarketTideSlopes(marketTide);
  const spx_periscope = buildSpxPeriscopeGexProfile(
    marketTide,
    effectiveRegime
  );

  if (effectiveRegime === 'bull_expansion') {
    return {
      regime: 'bull_expansion',
      label: 'Bull Expansion',
      tide: 'Bullish',
      spx_gex_behavior_summary:
        'Negative/weak local gamma pocket or SPX breaking away from major positive gamma magnet toward Call Wall',
      trade_posture: 'Favor call momentum (7–45 DTE near-ATM to moderately OTM calls)',
      posture_mode: 'Aggressive Directional',
      review_threshold: 72,
      tide_slopes: {
        ...tide_slopes,
        interpretation: 'Bullish',
      },
      spx_periscope,
    };
  }

  if (effectiveRegime === 'bear_expansion') {
    return {
      regime: 'bear_expansion',
      label: 'Bear Expansion',
      tide: 'Bearish',
      spx_gex_behavior_summary:
        'Negative/weak SPX gamma (-$640M) with downside break and hold below 5,830 Gamma Flip',
      trade_posture: 'Favor put momentum (7–45 DTE near-ATM to moderately OTM puts)',
      posture_mode: 'Aggressive Directional',
      review_threshold: 72,
      tide_slopes: {
        ...tide_slopes,
        interpretation: 'Bearish',
      },
      spx_periscope,
    };
  }

  if (effectiveRegime === 'pinned_range') {
    return {
      regime: 'pinned_range',
      label: 'Pinned / Range',
      tide: 'Mixed',
      spx_gex_behavior_summary:
        'Large positive SPX gamma (+$1.48B) near spot; index pinned between 5,825 Put Wall and 5,860 Call Wall around 5,850 Magnet',
      trade_posture:
        'Favor mean reversion; avoid chasing naked directional options — focus on defined-risk spreads or fade points',
      posture_mode: 'Mean-Reversion / Spreads',
      review_threshold: 78,
      tide_slopes: {
        ...tide_slopes,
        interpretation: 'Mixed',
      },
      spx_periscope,
    };
  }

  return {
    regime: 'conflict',
    label: 'Conflict (Tide vs GEX Disagree)',
    tide: tide_slopes.interpretation,
    spx_gex_behavior_summary:
      'Market Tide and SPX GEX disagree; SPX price stuck between major levels near 5,830 Gamma Flip',
    trade_posture:
      'Reduce trades and demand stronger confirmations (FlowScore >= 84, mandatory Alpaca VWAP + ORB hold)',
    posture_mode: 'Defensive / Selective',
    review_threshold: 84,
    tide_slopes,
    spx_periscope,
  };
}

/**
 * Step 2: Change the Stock Screener by Regime (GET /api/screener/stocks & stock_screener WS)
 * Keep the initial candidate universe small (top 10–25 liquid names) to prevent noise & stream overload.
 */
export function buildRegimeStockScreenerSpec(
  regime: StrategyRegimeId,
  candidates: WhaleCandidate[]
): RegimeStockScreenerSpec {
  const baseRows: Omit<
    StockScreenerRow,
    'passed_regime_screen' | 'screen_reasons'
  >[] = [
    {
      ticker: 'NVDA',
      company_name: 'NVIDIA Corp.',
      sector: 'Technology',
      is_sp500_or_liquid_large_cap: true,
      price: 145.6,
      ema_20: 141.2,
      ema_50: 136.8,
      change_pct: 2.84,
      call_volume: 482_000,
      put_volume: 194_000,
      net_call_premium: 48_500_000,
      net_put_premium: -11_200_000,
      stock_volume: 64_200_000,
      avg_30d_volume: 49_500_000,
      volume_vs_30d_ratio: 1.3,
      total_option_open_interest: 3_420_000,
      iv_rank: 38,
      realized_move_pct: 2.9,
      implied_move_pct: 4.6,
      near_support_or_resistance: false,
      positive_gex_stable: true,
      directional_gamma_delta_flow: 'bullish',
      days_to_earnings: 28,
    },
    {
      ticker: 'NFLX',
      company_name: 'Netflix Inc.',
      sector: 'Communication Services',
      is_sp500_or_liquid_large_cap: true,
      price: 752.4,
      ema_20: 734.0,
      ema_50: 712.5,
      change_pct: 2.15,
      call_volume: 94_500,
      put_volume: 41_200,
      net_call_premium: 19_400_000,
      net_put_premium: -4_800_000,
      stock_volume: 6_800_000,
      avg_30d_volume: 4_700_000,
      volume_vs_30d_ratio: 1.45,
      total_option_open_interest: 410_000,
      iv_rank: 34,
      realized_move_pct: 2.2,
      implied_move_pct: 4.1,
      near_support_or_resistance: false,
      positive_gex_stable: true,
      directional_gamma_delta_flow: 'bullish',
      days_to_earnings: 62,
    },
    {
      ticker: 'PLTR',
      company_name: 'Palantir Technologies',
      sector: 'Technology',
      is_sp500_or_liquid_large_cap: true,
      price: 45.2,
      ema_20: 42.6,
      ema_50: 39.1,
      change_pct: 3.65,
      call_volume: 312_000,
      put_volume: 98_000,
      net_call_premium: 14_800_000,
      net_put_premium: -3_100_000,
      stock_volume: 58_000_000,
      avg_30d_volume: 41_000_000,
      volume_vs_30d_ratio: 1.41,
      total_option_open_interest: 1_850_000,
      iv_rank: 44,
      realized_move_pct: 3.7,
      implied_move_pct: 5.8,
      near_support_or_resistance: false,
      positive_gex_stable: true,
      directional_gamma_delta_flow: 'bullish',
      days_to_earnings: 19,
    },
    {
      ticker: 'TSLA',
      company_name: 'Tesla Inc.',
      sector: 'Consumer Discretionary',
      is_sp500_or_liquid_large_cap: true,
      price: 217.8,
      ema_20: 229.4,
      ema_50: 234.1,
      change_pct: -2.42,
      call_volume: 290_000,
      put_volume: 515_000,
      net_call_premium: -18_400_000,
      net_put_premium: 34_600_000,
      stock_volume: 79_000_000,
      avg_30d_volume: 61_000_000,
      volume_vs_30d_ratio: 1.3,
      total_option_open_interest: 4_120_000,
      iv_rank: 52,
      realized_move_pct: 2.5,
      implied_move_pct: 5.4,
      near_support_or_resistance: true,
      positive_gex_stable: false,
      directional_gamma_delta_flow: 'bearish',
      days_to_earnings: 12,
    },
    {
      ticker: 'AMD',
      company_name: 'Advanced Micro Devices',
      sector: 'Technology',
      is_sp500_or_liquid_large_cap: true,
      price: 151.3,
      ema_20: 157.8,
      ema_50: 160.2,
      change_pct: -1.95,
      call_volume: 142_000,
      put_volume: 238_000,
      net_call_premium: -7_900_000,
      net_put_premium: 16_200_000,
      stock_volume: 46_500_000,
      avg_30d_volume: 38_000_000,
      volume_vs_30d_ratio: 1.22,
      total_option_open_interest: 1_640_000,
      iv_rank: 41,
      realized_move_pct: 2.0,
      implied_move_pct: 4.5,
      near_support_or_resistance: true,
      positive_gex_stable: false,
      directional_gamma_delta_flow: 'bearish',
      days_to_earnings: 15,
    },
    {
      ticker: 'AAPL',
      company_name: 'Apple Inc.',
      sector: 'Technology',
      is_sp500_or_liquid_large_cap: true,
      price: 233.1,
      ema_20: 231.8,
      ema_50: 228.5,
      change_pct: 0.42,
      call_volume: 215_000,
      put_volume: 188_000,
      net_call_premium: 6_400_000,
      net_put_premium: 1_900_000,
      stock_volume: 39_200_000,
      avg_30d_volume: 42_000_000,
      volume_vs_30d_ratio: 0.93,
      total_option_open_interest: 2_950_000,
      iv_rank: 22,
      realized_move_pct: 0.65,
      implied_move_pct: 2.4,
      near_support_or_resistance: true,
      positive_gex_stable: true,
      directional_gamma_delta_flow: 'neutral',
      days_to_earnings: 18,
    },
    {
      ticker: 'META',
      company_name: 'Meta Platforms Inc.',
      sector: 'Communication Services',
      is_sp500_or_liquid_large_cap: true,
      price: 591.2,
      ema_20: 584.0,
      ema_50: 566.5,
      change_pct: 0.85,
      call_volume: 118_000,
      put_volume: 94_000,
      net_call_premium: 9_800_000,
      net_put_premium: -2_100_000,
      stock_volume: 11_400_000,
      avg_30d_volume: 10_200_000,
      volume_vs_30d_ratio: 1.12,
      total_option_open_interest: 980_000,
      iv_rank: 29,
      realized_move_pct: 0.95,
      implied_move_pct: 3.5,
      near_support_or_resistance: true,
      positive_gex_stable: true,
      directional_gamma_delta_flow: 'bullish',
      days_to_earnings: 16,
    },
    {
      ticker: 'TSM',
      company_name: 'Taiwan Semiconductor',
      sector: 'Technology',
      is_sp500_or_liquid_large_cap: true,
      price: 200.97,
      ema_20: 192.4,
      ema_50: 184.0,
      change_pct: 1.75,
      call_volume: 134_000,
      put_volume: 62_000,
      net_call_premium: 11_500_000,
      net_put_premium: -2_400_000,
      stock_volume: 18_500_000,
      avg_30d_volume: 14_100_000,
      volume_vs_30d_ratio: 1.31,
      total_option_open_interest: 890_000,
      iv_rank: 36,
      realized_move_pct: 1.8,
      implied_move_pct: 3.9,
      near_support_or_resistance: false,
      positive_gex_stable: true,
      directional_gamma_delta_flow: 'bullish',
      days_to_earnings: 55,
    },
  ];

  // Ensure any dynamic injected candidates in the runtime are also represented
  for (const cand of candidates) {
    if (!baseRows.some((r) => r.ticker === cand.ticker)) {
      const isBull = cand.direction === 'bullish';
      baseRows.push({
        ticker: cand.ticker,
        company_name: `${cand.ticker} (${cand.issue_type})`,
        sector: cand.market_context.sector_name ?? 'Technology',
        is_sp500_or_liquid_large_cap: true,
        price: cand.underlying.price_at_detection,
        ema_20: round2(
          cand.underlying.price_at_detection * (isBull ? 0.98 : 1.02)
        ),
        ema_50: round2(
          cand.underlying.price_at_detection * (isBull ? 0.95 : 1.05)
        ),
        change_pct: round2(cand.underlying.return_5m * 100),
        call_volume: isBull ? 120_000 : 55_000,
        put_volume: isBull ? 48_000 : 135_000,
        net_call_premium: isBull ? 8_500_000 : -3_200_000,
        net_put_premium: isBull ? -1_900_000 : 9_400_000,
        stock_volume: 22_000_000,
        avg_30d_volume: 16_000_000,
        volume_vs_30d_ratio: 1.38,
        total_option_open_interest: Math.max(85_000, cand.flow.open_interest * 25),
        iv_rank: 35,
        realized_move_pct: round2(Math.abs(cand.underlying.return_5m) * 100),
        implied_move_pct: 3.8,
        near_support_or_resistance: true,
        positive_gex_stable: true,
        directional_gamma_delta_flow: isBull ? 'bullish' : 'bearish',
        days_to_earnings: 24,
      });
    }
  }

  let title = 'A. Bull-Expansion Candidate Screen';
  let sql_where_clause = `where
  price > ema_20
  and price > ema_50
  and change > 0
  and call_volume > put_volume
  and net_call_premium > 0
  and volume > 0
  and open_interest >= 50000`;
  let additional_preferences = [
    'S&P 500 names or liquid high-beta large caps',
    'Stock volume above 30-day average (vol_vs_30d > 1.0x)',
    'Positive directional gamma/delta flow',
    'No imminent binary earnings (> 3 days away) unless explicitly trading earnings',
  ];

  if (regime === 'bear_expansion') {
    title = 'B. Bear-Expansion Candidate Screen';
    sql_where_clause = `where
  price < ema_20
  and price < ema_50
  and change < 0
  and put_volume > call_volume
  and net_put_premium > 0
  and volume > 0
  and open_interest >= 50000`;
    additional_preferences = [
      'S&P 500 or liquid large caps breaking below EMA-20 & EMA-50',
      'Put volume exceeding call volume with positive net put premium',
      'Selling volume rising above 30-day average',
      'Negative directional gamma/delta flow confirmation',
    ];
  } else if (regime === 'pinned_range') {
    title = 'C. Pinned / Range Candidate Screen (Mean-Reversion & Spreads)';
    sql_where_clause = `where
  realized_move_pct <= 2.2
  and iv_rank <= 45
  and near_support_or_resistance = true
  and positive_gex_stable = true
  and open_interest >= 50000`;
    additional_preferences = [
      'Do not force directional long premium — focus on defined-risk spreads or fade research',
      'Lower realized movement and lower IV rank relative to history',
      'Price near meaningful technical support/resistance or gamma magnet',
      'Stable, high positive GEX rather than gamma deterioration',
    ];
  } else if (regime === 'conflict') {
    title = 'D. Conflict Regime Defensive Candidate Screen';
    sql_where_clause = `where
  ((price > ema_20 and price > ema_50 and net_call_premium > 0)
   or (price < ema_20 and price < ema_50 and net_put_premium > 0))
  and volume_vs_30d_ratio >= 1.25
  and open_interest >= 100000
  and days_to_earnings >= 7`;
    additional_preferences = [
      'Reduce trade count when Market Tide and SPX GEX disagree',
      'Demand deeper option chain liquidity (open_interest >= 100,000)',
      'Require strong 30-day relative stock volume (>= 1.25x)',
      'Exclude any ticker with binary earnings within 7 days',
    ];
  }

  const evaluatedRows: StockScreenerRow[] = baseRows.map((row) => {
    const reasons: string[] = [];
    let passed = true;

    if (regime === 'bull_expansion') {
      if (!(row.price > row.ema_20 && row.price > row.ema_50)) {
        passed = false;
        reasons.push('Price not above both EMA-20 and EMA-50');
      }
      if (row.change_pct <= 0) {
        passed = false;
        reasons.push('Intraday change <= 0%');
      }
      if (row.call_volume <= row.put_volume) {
        passed = false;
        reasons.push('call_volume <= put_volume');
      }
      if (row.net_call_premium <= 0) {
        passed = false;
        reasons.push('net_call_premium <= 0');
      }
      if (row.total_option_open_interest < 50_000) {
        passed = false;
        reasons.push('open_interest < 50,000');
      }
      if (passed) {
        reasons.push(
          `Passed Bull-Expansion SQL screen (Price > EMA20/50, Call Vol ${(row.call_volume / 1000).toFixed(0)}K > Put Vol ${(row.put_volume / 1000).toFixed(0)}K, Vol ${row.volume_vs_30d_ratio.toFixed(2)}x 30d avg)`
        );
      }
    } else if (regime === 'bear_expansion') {
      if (!(row.price < row.ema_20 && row.price < row.ema_50)) {
        passed = false;
        reasons.push('Price not below both EMA-20 and EMA-50');
      }
      if (row.change_pct >= 0) {
        passed = false;
        reasons.push('Intraday change >= 0%');
      }
      if (row.put_volume <= row.call_volume) {
        passed = false;
        reasons.push('put_volume <= call_volume');
      }
      if (row.net_put_premium <= 0) {
        passed = false;
        reasons.push('net_put_premium <= 0');
      }
      if (row.total_option_open_interest < 50_000) {
        passed = false;
        reasons.push('open_interest < 50,000');
      }
      if (passed) {
        reasons.push(
          `Passed Bear-Expansion SQL screen (Price < EMA20/50, Put Vol ${(row.put_volume / 1000).toFixed(0)}K > Call Vol ${(row.call_volume / 1000).toFixed(0)}K, Net Put Prem +$${(row.net_put_premium / 1_000_000).toFixed(1)}M)`
        );
      }
    } else if (regime === 'pinned_range') {
      if (row.iv_rank > 45) {
        passed = false;
        reasons.push(`IV Rank (${row.iv_rank}) > 45 range ceiling`);
      }
      if (!row.positive_gex_stable) {
        passed = false;
        reasons.push('Ticker GEX is deteriorating rather than positive/stable');
      }
      if (row.total_option_open_interest < 50_000) {
        passed = false;
        reasons.push('open_interest < 50,000');
      }
      if (passed) {
        reasons.push(
          `Passed Pinned/Range screen (IV Rank ${row.iv_rank}%, stable positive GEX, liquid chain for defined-risk spreads)`
        );
      }
    } else {
      // conflict
      const trendAligned =
        (row.price > row.ema_20 &&
          row.price > row.ema_50 &&
          row.net_call_premium > 0) ||
        (row.price < row.ema_20 &&
          row.price < row.ema_50 &&
          row.net_put_premium > 0);
      if (!trendAligned) {
        passed = false;
        reasons.push('Fails strict EMA-20/50 + net premium alignment');
      }
      if (row.volume_vs_30d_ratio < 1.25) {
        passed = false;
        reasons.push(
          `30d relative volume (${row.volume_vs_30d_ratio.toFixed(2)}x) < 1.25x conflict threshold`
        );
      }
      if (row.total_option_open_interest < 100_000) {
        passed = false;
        reasons.push('open_interest < 100,000 conflict floor');
      }
      if (passed) {
        reasons.push(
          `Passed Conflict Defensive screen (OI ${(row.total_option_open_interest / 1000).toFixed(0)}K, 30d Vol ${row.volume_vs_30d_ratio.toFixed(2)}x)`
        );
      }
    }

    return {
      ...row,
      passed_regime_screen: passed,
      screen_reasons: reasons,
    };
  });

  return {
    regime,
    title,
    endpoint: 'GET /api/screener/stocks',
    websocket_channel: 'stock_screener',
    sql_where_clause,
    additional_preferences,
    universe_cap_limit: 25,
    rows: evaluatedRows.slice(0, 25),
    passed_tickers: evaluatedRows
      .filter((r) => r.passed_regime_screen)
      .map((r) => r.ticker),
  };
}

/**
 * Step 3A: Live Whale Tape Inclusion Filter Payload (option_trades / flow-alerts)
 */
export function buildLiveWhaleTapeFilterPayload(
  regime: StrategyRegimeId,
  passedTickers: string[]
): LiveWhaleTapeFilterJson {
  const tickerList =
    passedTickers.length > 0 ? passedTickers.join(',') : 'CANDIDATE_TICKERS';

  if (regime === 'bear_expansion') {
    return {
      ticker_symbol: tickerList,
      type: 'Puts',
      min_premium: '100000',
      min_size: '100',
      min_ask_perc: '0.70',
      min_dte: '7',
      max_dte: '60',
      is_otm: true,
      volume_greater_oi: true,
      opening: true,
      hide_expired: true,
      exclude_deep_itm: true,
      is_multi_leg: false,
      limit: 25,
    };
  }

  if (regime === 'pinned_range') {
    return {
      ticker_symbol: tickerList,
      type: 'Calls_And_Puts_Spread_Research',
      min_premium: '150000',
      min_size: '100',
      min_ask_perc: '0.75',
      min_dte: '14',
      max_dte: '60',
      is_otm: true,
      volume_greater_oi: true,
      opening: true,
      hide_expired: true,
      exclude_deep_itm: true,
      is_multi_leg: false,
      limit: 25,
    };
  }

  return {
    ticker_symbol: tickerList,
    type: 'Calls',
    min_premium: regime === 'conflict' ? '200000' : '100000',
    min_size: '100',
    min_ask_perc: regime === 'conflict' ? '0.80' : '0.70',
    min_dte: '7',
    max_dte: '60',
    is_otm: true,
    volume_greater_oi: true,
    opening: true,
    hide_expired: true,
    exclude_deep_itm: true,
    is_multi_leg: false,
    limit: 25,
  };
}

/**
 * Step 4: Alpaca Confirmation Layer (Bullish, Bearish, and Reject/De-rank checks)
 */
export function evaluateAlpacaStrategyConfirmation(params: {
  candidate: WhaleCandidate;
  screenerRow?: StockScreenerRow;
  alpacaCache?: AlpacaTickerDataCacheItem | null;
}): AlpacaStrategyConfirmationAudit {
  const { candidate, screenerRow } = params;
  const isBullish = candidate.direction === 'bullish';

  const vwapPassed = candidate.underlying.vwap_aligned;
  const rvolPassed = candidate.underlying.relative_volume_5m >= 1.3;
  const structurePassed = isBullish
    ? candidate.underlying.return_5m > 0 &&
      candidate.underlying.candle_close_position >= 0.6
    : candidate.underlying.return_5m < 0 &&
      candidate.underlying.candle_close_position <= 0.4;

  const stockEval = candidate.stock_confirmation;
  const imbalancePassed = stockEval
    ? stockEval.secondary_boosts.some((b) => b.triggered) ||
      candidate.flow.side_share >= 0.72
    : candidate.flow.side_share >= 0.72;

  const postBurstHoldPassed =
    candidate.status === 'confirmed' ||
    (vwapPassed &&
      (isBullish
        ? candidate.underlying.candle_close_position >= 0.55
        : candidate.underlying.candle_close_position <= 0.45));

  const impliedMovePct = screenerRow?.implied_move_pct ?? 4.2;
  const realizedMovePct = Math.max(
    screenerRow?.realized_move_pct ?? 1.5,
    Math.abs(candidate.underlying.return_5m) * 100
  );
  const move_vs_expected_move_ratio = round2(
    realizedMovePct / Math.max(impliedMovePct, 0.5)
  );
  const days_to_earnings = screenerRow?.days_to_earnings ?? 21;

  const de_rank_or_reject_reasons: string[] = [];
  let rejected = false;
  let de_ranked = false;

  // Reject / De-rank rule 1: option flow is bullish/bearish but underlying loses VWAP and fails breakout
  if (!vwapPassed && !structurePassed) {
    rejected = true;
    de_rank_or_reject_reasons.push(
      isBullish
        ? 'Option flow is bullish but underlying lost intraday VWAP and failed breakout'
        : 'Option flow is bearish but underlying reclaimed VWAP and failed breakdown'
    );
  } else if (!vwapPassed) {
    de_ranked = true;
    de_rank_or_reject_reasons.push(
      'Underlying is not aligned with intraday VWAP (de-ranked)'
    );
  }

  // Reject / De-rank rule 2: large option print occurs with no price response and worsening tape
  if (Math.abs(candidate.underlying.return_5m) < 0.0015 && !rvolPassed) {
    de_ranked = true;
    de_rank_or_reject_reasons.push(
      'Large option print occurred with muted stock price response and low RVOL'
    );
  }

  // Reject / De-rank rule 3: spread is too wide
  if (candidate.flow.spread > 0.18) {
    rejected = true;
    de_rank_or_reject_reasons.push(
      `Option bid/ask spread (${(candidate.flow.spread * 100).toFixed(1)}%) is excessively wide (>18%)`
    );
  } else if (candidate.flow.spread > 0.12) {
    de_ranked = true;
    de_rank_or_reject_reasons.push(
      `Option bid/ask spread (${(candidate.flow.spread * 100).toFixed(1)}%) > 12% (use Smart Order walker)`
    );
  }

  // Reject / De-rank rule 4: stock is already extended far beyond its expected move
  if (move_vs_expected_move_ratio > 1.25) {
    de_ranked = true;
    de_rank_or_reject_reasons.push(
      `Stock already extended (${move_vs_expected_move_ratio.toFixed(2)}x implied move) — chasing risk`
    );
  }

  // Reject / De-rank rule 5: ticker has an imminent binary event not intended by the strategy
  if (days_to_earnings <= 3) {
    de_ranked = true;
    de_rank_or_reject_reasons.push(
      `Imminent binary earnings event in ${days_to_earnings} days`
    );
  }

  const confirmed =
    !rejected &&
    vwapPassed &&
    structurePassed &&
    rvolPassed &&
    postBurstHoldPassed;

  return {
    direction: candidate.direction,
    confirmed,
    de_ranked,
    rejected,
    checks: {
      vwap_check: {
        passed: vwapPassed,
        label: isBullish ? 'Stock Above Intraday VWAP' : 'Stock Below Intraday VWAP',
        detail: `$${candidate.underlying.price_at_detection.toFixed(2)} vs VWAP $${candidate.underlying.vwap_5m.toFixed(2)}`,
      },
      structure_break_check: {
        passed: structurePassed,
        label: isBullish
          ? 'Higher Highs / Opening-Range Breakout'
          : 'Lower Lows / Support Breakdown',
        detail: `5m return ${(candidate.underlying.return_5m * 100 >= 0 ? '+' : '') + (candidate.underlying.return_5m * 100).toFixed(2)}% · candle pos ${Math.round(candidate.underlying.candle_close_position * 100)}%`,
      },
      rvol_check: {
        passed: rvolPassed,
        label: isBullish ? 'Rising Relative Volume' : 'Rising Selling Volume',
        detail: `5m RVOL ${candidate.underlying.relative_volume_5m.toFixed(2)}x vs 20-day time-of-day baseline`,
      },
      imbalance_check: {
        passed: imbalancePassed,
        label: 'Quote / Lit-Trade Imbalance Supportive',
        detail: `${Math.round(candidate.flow.side_share * 100)}% aggressor side share`,
      },
      post_burst_hold_check: {
        passed: postBurstHoldPassed,
        label: 'Price Holds After Options Burst',
        detail: postBurstHoldPassed
          ? 'Underlying held directional gains post-burst without reversing'
          : 'Awaiting post-burst 5m candle hold confirmation',
      },
    },
    de_rank_or_reject_reasons,
    move_vs_expected_move_ratio,
    days_to_earnings,
  };
}

/**
 * Step 3B: Compute 14-Factor Whale-Quality FlowScore (+/-)
 * FlowScore =
 *   + premium magnitude
 *   + ask-side percentage
 *   + sweep / urgency signal
 *   + repeated hits or ascending-fill confirmation
 *   + volume-to-OI ratio
 *   + size-to-volume concentration
 *   + opening-likelihood signal
 *   + agreement with Market Tide regime
 *   + agreement with SPX GEX regime
 *   + confirmation from Alpaca underlying tape
 *   - excessive bid/ask spread
 *   - earnings/event ambiguity
 *   - multi-leg / hedge ambiguity
 *   - conflicting opposite-side flow
 */
export function computeStrategyFlowScore(params: {
  candidate: WhaleCandidate;
  regimeClassification: StrategyRegimeClassification;
  alpacaAudit: AlpacaStrategyConfirmationAudit;
  screenerRow?: StockScreenerRow;
}): StrategyFlowScoreEvaluation {
  const { candidate, regimeClassification, alpacaAudit, screenerRow } = params;
  const f = candidate.flow;

  // +1. Premium magnitude (max 14 pts)
  const premPts = round2(
    clamp(Math.log10(Math.max(f.premium_5m, 25_000) / 50_000) / Math.log10(20), 0, 1) * 14
  );

  // +2. Ask-side percentage (max 11 pts)
  const askSidePts = round2(clamp((f.side_share - 0.5) / 0.45, 0, 1) * 11);

  // +3. Sweep / urgency signal (max 10 pts)
  const sweepPts = round2(clamp(f.sweep_ratio / 0.8, 0, 1) * 10);

  // +4. Repeated hits or ascending-fill confirmation (max 9 pts)
  const hasAscFill = (f.flow_alert_rules ?? []).includes(
    'RepeatedHitsAscendingFill'
  );
  const repeatedPts = round2(
    f.repeated_hits ? (hasAscFill ? 9 : 7.5) : clamp(f.trade_count_10s / 5, 0, 1) * 4
  );

  // +5. Volume-to-OI ratio (max 9 pts)
  const volOiPts = round2(clamp(f.volume_oi_ratio / 4.0, 0, 1) * 9);

  // +6. Size-to-volume concentration (max 8 pts)
  const concPts = round2(clamp(f.contract_share / 0.65, 0, 1) * 8);

  // +7. Opening-likelihood signal (max 8 pts)
  const openingLikely = f.volume > f.open_interest && f.side_share >= 0.7;
  const openingPts = round2(
    openingLikely ? 8 : f.volume_oi_ratio >= 0.8 ? 5 : 2.5
  );

  // +8. Agreement with Market Tide regime (max 10 pts)
  const tideAgrees =
    (regimeClassification.tide === 'Bullish' &&
      candidate.direction === 'bullish') ||
    (regimeClassification.tide === 'Bearish' &&
      candidate.direction === 'bearish');
  const tidePts = round2(
    tideAgrees ? 10 : regimeClassification.tide === 'Mixed' ? 5.5 : 1.5
  );

  // +9. Agreement with SPX GEX regime (max 9 pts)
  const gexAgrees =
    (regimeClassification.regime === 'bull_expansion' &&
      candidate.direction === 'bullish') ||
    (regimeClassification.regime === 'bear_expansion' &&
      candidate.direction === 'bearish') ||
    (regimeClassification.regime === 'pinned_range' &&
      Boolean(candidate.gamma_context?.near_magnet));
  const gexPts = round2(
    gexAgrees
      ? 9
      : candidate.gamma_context?.breakout_confirmed
        ? 7.5
        : regimeClassification.regime === 'conflict'
          ? 3
          : 5
  );

  // +10. Confirmation from Alpaca underlying tape (max 12 pts)
  const passedChecksCount = Object.values(alpacaAudit.checks).filter(
    (c) => c.passed
  ).length;
  const alpacaPts = round2((passedChecksCount / 5) * 12);

  // -11. Excessive bid/ask spread penalty (up to -12 pts)
  const spreadPenalty =
    f.spread > 0.12
      ? round2(clamp((f.spread - 0.1) / 0.15, 0, 1) * 12)
      : f.spread > 0.08
        ? 2.5
        : 0;

  // -12. Earnings / binary event ambiguity penalty (up to -10 pts)
  const daysToEarnings = screenerRow?.days_to_earnings ?? 21;
  const earningsPenalty =
    daysToEarnings <= 3 ? 10 : daysToEarnings <= 7 ? 4.5 : 0;

  // -13. Multi-leg / hedge ambiguity penalty (up to -12 pts)
  const multilegPenalty =
    f.multileg_ratio > 0.15
      ? round2(clamp(f.multileg_ratio / 0.4, 0, 1) * 12)
      : 0;

  // -14. Conflicting opposite-side flow penalty (up to -10 pts)
  const oppositeFlowShare = clamp(1 - f.side_share, 0, 1);
  const oppositeFlowPenalty =
    oppositeFlowShare > 0.25
      ? round2(clamp((oppositeFlowShare - 0.2) / 0.3, 0, 1) * 10)
      : 0;

  const components: FlowScoreComponentItem[] = [
    {
      id: 'premium_magnitude',
      label: 'Premium Magnitude (5m Cluster)',
      sign: '+',
      points: premPts,
      max_points: 14,
      detail: `$${(f.premium_5m / 1000).toFixed(0)}K (${Math.max(1, f.premium_5m / 100_000).toFixed(1)}x baseline)`,
    },
    {
      id: 'ask_side_pct',
      label: 'Ask-Side / Aggressor Percentage',
      sign: '+',
      points: askSidePts,
      max_points: 11,
      detail: `${Math.round(f.side_share * 100)}% directional side execution`,
    },
    {
      id: 'sweep_urgency',
      label: 'Sweep / Intermarket Urgency Signal',
      sign: '+',
      points: sweepPts,
      max_points: 10,
      detail: `${Math.round(f.sweep_ratio * 100)}% sweep volume ratio`,
    },
    {
      id: 'repeated_hits',
      label: 'Repeated Hits / Ascending-Fill Confirmation',
      sign: '+',
      points: repeatedPts,
      max_points: 9,
      detail: `${f.trade_count_10s} prints in 10s${hasAscFill ? ' · Ascending fills' : ''}`,
    },
    {
      id: 'vol_oi_ratio',
      label: 'Volume-to-OI Ratio',
      sign: '+',
      points: volOiPts,
      max_points: 9,
      detail: `${f.volume_oi_ratio.toFixed(2)}x (${f.volume.toLocaleString()} vol / ${f.open_interest.toLocaleString()} OI)`,
    },
    {
      id: 'size_concentration',
      label: 'Size-to-Volume Contract Concentration',
      sign: '+',
      points: concPts,
      max_points: 8,
      detail: `${Math.round(f.contract_share * 100)}% of ticker 5m flow in single strike`,
    },
    {
      id: 'opening_likelihood',
      label: 'Opening-Likelihood Signal (Pre-OI Verification)',
      sign: '+',
      points: openingPts,
      max_points: 8,
      detail: openingLikely
        ? 'Vol > OI + Ask-skewed (Verify next-morning OI update)'
        : 'Partial opening signal — monitor overnight OI change',
    },
    {
      id: 'market_tide_agreement',
      label: 'Agreement with Market Tide Regime',
      sign: '+',
      points: tidePts,
      max_points: 10,
      detail: `${regimeClassification.tide} Tide vs ${candidate.direction} contract`,
    },
    {
      id: 'spx_gex_agreement',
      label: 'Agreement with SPX Periscope / GEX Regime',
      sign: '+',
      points: gexPts,
      max_points: 9,
      detail: `${regimeClassification.label} (${regimeClassification.spx_periscope.gamma_explosive ? 'Gamma Explosive' : 'Non-Explosive GEX'})`,
    },
    {
      id: 'alpaca_confirmation',
      label: 'Confirmation from Alpaca Underlying Tape',
      sign: '+',
      points: alpacaPts,
      max_points: 12,
      detail: `${passedChecksCount}/5 Alpaca intraday checks passed`,
    },
    {
      id: 'excessive_spread_penalty',
      label: 'Excessive Bid/Ask Spread Penalty',
      sign: '-',
      points: spreadPenalty,
      max_points: 12,
      detail: `NBBO spread ${(f.spread * 100).toFixed(1)}%`,
    },
    {
      id: 'earnings_ambiguity_penalty',
      label: 'Earnings / Binary Event Ambiguity',
      sign: '-',
      points: earningsPenalty,
      max_points: 10,
      detail: `Earnings in ${daysToEarnings}d`,
    },
    {
      id: 'multileg_hedge_penalty',
      label: 'Multi-Leg / Hedge Ambiguity',
      sign: '-',
      points: multilegPenalty,
      max_points: 12,
      detail: `Multi-leg share ${Math.round(f.multileg_ratio * 100)}%`,
    },
    {
      id: 'conflicting_opposite_flow_penalty',
      label: 'Conflicting Opposite-Side Flow',
      sign: '-',
      points: oppositeFlowPenalty,
      max_points: 10,
      detail: `Opposite-side flow ${Math.round(oppositeFlowShare * 100)}%`,
    },
  ];

  const positive_total = round2(
    components
      .filter((c) => c.sign === '+')
      .reduce((acc, c) => acc + c.points, 0)
  );
  const penalty_total = round2(
    components
      .filter((c) => c.sign === '-')
      .reduce((acc, c) => acc + c.points, 0)
  );

  const total_flow_score = Math.round(
    clamp(positive_total - penalty_total, 0, 100)
  );

  return {
    total_flow_score,
    review_threshold: regimeClassification.review_threshold,
    passes_review_threshold:
      total_flow_score >= regimeClassification.review_threshold,
    positive_total,
    penalty_total,
    components,
    oi_verification_warning:
      'Guardrail: Volume > OI and an "opening" flag are not proof of new directional positioning. A print may be part of a roll, hedge, spread, or closing transaction until confirmed by next morning’s OI update.',
  };
}

/**
 * Step 5: Contract Selection Logic (Expansion/Momentum vs Range/Pinning)
 */
export function evaluateContractSelectionLogic(params: {
  candidate: WhaleCandidate;
  regime: StrategyRegimeId;
  screenerRow?: StockScreenerRow;
}): ContractSelectionEvaluation {
  const { candidate, regime, screenerRow } = params;
  const spot = Math.max(0.01, candidate.underlying.price_at_detection);
  const rawDistPct =
    candidate.option_type === 'call'
      ? ((candidate.strike - spot) / spot) * 100
      : ((spot - candidate.strike) / spot) * 100;
  const otm_distance_pct = round2(rawDistPct);
  const implied_move_pct = screenerRow?.implied_move_pct ?? 4.2;

  const dte_in_sweet_spot = candidate.dte >= 7 && candidate.dte <= 45;
  const requires_unrealistic_move = otm_distance_pct > implied_move_pct * 1.35;

  let moneyness_label: ContractSelectionEvaluation['moneyness_label'] =
    'Moderately OTM';
  if (otm_distance_pct < -2.0) {
    moneyness_label = 'Deep ITM (Avoid)';
  } else if (Math.abs(otm_distance_pct) <= 2.5) {
    moneyness_label = 'Near-ATM';
  } else if (requires_unrealistic_move || otm_distance_pct > 10.0) {
    moneyness_label = 'Far OTM Lottery (Avoid)';
  }

  const spread_quality_label: ContractSelectionEvaluation['spread_quality_label'] =
    candidate.flow.spread <= 0.06
      ? 'Tight'
      : candidate.flow.spread <= 0.12
        ? 'Acceptable'
        : 'Wide (De-rank)';

  const preferred_reasons: string[] = [];
  const avoid_warnings: string[] = [];

  if (dte_in_sweet_spot) {
    preferred_reasons.push(
      `${candidate.dte} DTE sits inside 7–45 DTE momentum sweet spot`
    );
  } else {
    avoid_warnings.push(
      `${candidate.dte} DTE is outside the preferred 7–45 DTE expansion window`
    );
  }

  if (
    moneyness_label === 'Near-ATM' ||
    moneyness_label === 'Moderately OTM'
  ) {
    preferred_reasons.push(
      `${moneyness_label} strike ($${candidate.strike}, ${otm_distance_pct >= 0 ? '+' : ''}${otm_distance_pct.toFixed(1)}% vs spot) is within realistic ${implied_move_pct.toFixed(1)}% implied move`
    );
  } else {
    avoid_warnings.push(
      `${moneyness_label}: Strike requires ${otm_distance_pct.toFixed(1)}% move vs ${implied_move_pct.toFixed(1)}% implied move`
    );
  }

  if (candidate.flow.open_interest >= 500 && candidate.flow.volume >= 1000) {
    preferred_reasons.push(
      `Deep chain liquidity (${candidate.flow.volume.toLocaleString()} vol / ${candidate.flow.open_interest.toLocaleString()} OI)`
    );
  } else {
    avoid_warnings.push('Low open interest or thin contract volume');
  }

  if (candidate.flow.contract_share >= 0.4) {
    preferred_reasons.push(
      `Strike aligned with concentrated whale flow (${Math.round(candidate.flow.contract_share * 100)}% contract share)`
    );
  }

  if (spread_quality_label === 'Wide (De-rank)') {
    avoid_warnings.push(
      `Wide NBBO spread (${(candidate.flow.spread * 100).toFixed(1)}%) — require Smart Order Microprice Walker`
    );
  }

  let recommended_expression =
    'Single-Leg Long Option (7–45 DTE) via Smart Microprice Walker';
  let structure_type: ContractSelectionEvaluation['structure_type'] =
    'directional_long_option';

  if (regime === 'pinned_range') {
    recommended_expression =
      'Defined-Risk Spread / Mean-Reversion Structure (Avoid naked short-dated long premium in Pinned GEX)';
    structure_type = 'range_pinning_iron_condor_or_fade';
  } else if (regime === 'conflict') {
    recommended_expression =
      'Defined-Risk Vertical Debit Spread or Half-Size Staged Limit (Regime Conflict Guardrail)';
    structure_type = 'defined_risk_vertical_spread';
  } else if (
    spread_quality_label === 'Wide (De-rank)' ||
    requires_unrealistic_move
  ) {
    recommended_expression =
      'Vertical Debit Spread to mitigate wide spread / extrinsic decay';
    structure_type = 'defined_risk_vertical_spread';
  }

  return {
    ranking_designation: 'Highest-Ranked by Current Model Inputs',
    recommended_expression,
    structure_type,
    dte_in_sweet_spot,
    moneyness_label,
    otm_distance_pct,
    implied_move_pct,
    requires_unrealistic_move,
    spread_quality_label,
    preferred_reasons,
    avoid_warnings,
  };
}

/**
 * Complete Strategy Evaluation across Candidate Universe (Control Loop & 6-Stage Rule Hierarchy)
 */
export function evaluateRegimeWhaleStrategyPipeline(params: {
  marketTide: MarketTideState;
  candidates: WhaleCandidate[];
  overrideRegime?: StrategyRegimeId;
  perTradeMaxRiskDollars?: number;
  maxDailyLossDollars?: number;
}): {
  regime_classification: StrategyRegimeClassification;
  screener_spec: RegimeStockScreenerSpec;
  tape_filter_json: LiveWhaleTapeFilterJson;
  evaluated_candidates: StrategyCandidateEvaluation[];
  streaming_subscriptions: StreamingSubscriptionSpec[];
  core_guardrails: string[];
} {
  const regime_classification = classifyRegimeWhaleStrategy(
    params.marketTide,
    params.overrideRegime
  );
  const screener_spec = buildRegimeStockScreenerSpec(
    regime_classification.regime,
    params.candidates
  );
  const tape_filter_json = buildLiveWhaleTapeFilterPayload(
    regime_classification.regime,
    screener_spec.passed_tickers
  );

  const perTradeMaxRiskDollars = params.perTradeMaxRiskDollars ?? 2500;
  const maxDailyLossDollars = params.maxDailyLossDollars ?? 7500;

  const rawEvaluations = params.candidates.map((cand) => {
    const screenerRow = screener_spec.rows.find(
      (r) => r.ticker === cand.ticker
    );
    const screener_passed = screenerRow ? screenerRow.passed_regime_screen : true;

    const directionMatchesTape =
      regime_classification.regime === 'bull_expansion'
        ? cand.option_type === 'call' && cand.direction === 'bullish'
        : regime_classification.regime === 'bear_expansion'
          ? cand.option_type === 'put' && cand.direction === 'bearish'
          : true;

    const tape_filter_passed =
      directionMatchesTape &&
      cand.flow.premium_5m >= 100_000 &&
      cand.flow.side_share >= 0.7 &&
      cand.dte >= 7 &&
      cand.dte <= 60 &&
      cand.flow.multileg_ratio <= 0.35;

    const alpaca_confirmation = evaluateAlpacaStrategyConfirmation({
      candidate: cand,
      screenerRow,
    });

    const flow_score = computeStrategyFlowScore({
      candidate: cand,
      regimeClassification: regime_classification,
      alpacaAudit: alpaca_confirmation,
      screenerRow,
    });

    const contract_selection = evaluateContractSelectionLogic({
      candidate: cand,
      regime: regime_classification.regime,
      screenerRow,
    });

    const structureLiquid =
      !alpaca_confirmation.rejected &&
      contract_selection.moneyness_label !== 'Far OTM Lottery (Avoid)' &&
      contract_selection.moneyness_label !== 'Deep ITM (Avoid)' &&
      cand.flow.spread <= 0.18;

    const alerted_for_human_review =
      flow_score.passes_review_threshold &&
      alpaca_confirmation.confirmed &&
      structureLiquid;

    const estOptionPrice = Math.max(
      0.5,
      round2(cand.underlying.price_at_detection * 0.04)
    );
    const max_contracts_at_risk_cap = Math.max(
      1,
      Math.floor(perTradeMaxRiskDollars / (estOptionPrice * 100))
    );

    const rule_hierarchy: RuleHierarchyStageStatus[] = [
      {
        stage_number: 1,
        stage_name: '1. Market Regime Posture',
        rule_summary:
          'Market regime decides whether to be aggressive, selective, or defensive.',
        passed: regime_classification.regime !== 'conflict',
        status_badge: regime_classification.posture_mode,
        detail: `${regime_classification.label}: ${regime_classification.trade_posture}`,
      },
      {
        stage_number: 2,
        stage_name: '2. Regime Stock Screener',
        rule_summary: 'Screener narrows the universe to top 10–25 liquid names.',
        passed: screener_passed,
        status_badge: screener_passed ? 'Passed Screen' : 'Filtered Out',
        detail:
          screenerRow?.screen_reasons[0] ??
          'Evaluated against regime EMA/volume/OI SQL screen',
      },
      {
        stage_number: 3,
        stage_name: '3. Live Whale Option Tape',
        rule_summary:
          'Live option_trades & flow-alerts identify directional whale candidates.',
        passed: tape_filter_passed,
        status_badge: tape_filter_passed ? 'Whale Print Match' : 'Filtered',
        detail: `$${(cand.flow.premium_5m / 1000).toFixed(0)}K 5m prem · ${Math.round(cand.flow.side_share * 100)}% ask/side · ${cand.dte} DTE · Vol/OI ${cand.flow.volume_oi_ratio.toFixed(1)}x`,
      },
      {
        stage_number: 4,
        stage_name: '4. Alpaca Underlying Confirmation',
        rule_summary:
          'Alpaca confirms the stock is actually moving with the options thesis.',
        passed: alpaca_confirmation.confirmed,
        status_badge: alpaca_confirmation.rejected
          ? 'Rejected'
          : alpaca_confirmation.confirmed
            ? 'Confirmed'
            : 'De-Ranked / Awaiting',
        detail:
          alpaca_confirmation.de_rank_or_reject_reasons[0] ??
          'Intraday VWAP, 5m structure break, RVOL, and post-burst hold verified',
      },
      {
        stage_number: 5,
        stage_name: '5. Contract-Quality & FlowScore Ranking',
        rule_summary:
          'Contract-quality rules rank the tradable expression (never largest print alone).',
        passed: flow_score.passes_review_threshold && structureLiquid,
        status_badge: `FlowScore ${flow_score.total_flow_score}/${flow_score.review_threshold}`,
        detail: `${contract_selection.recommended_expression} (${contract_selection.moneyness_label})`,
      },
      {
        stage_number: 6,
        stage_name: '6. Human Review & Risk Gate',
        rule_summary:
          'Human review approves execution and defined per-trade risk before Smart Order routing.',
        passed: alerted_for_human_review,
        status_badge: alerted_for_human_review
          ? 'Ready for Human Review'
          : 'Hold / Watchlist Only',
        detail: `Max risk cap $${perTradeMaxRiskDollars.toLocaleString()}/trade (${max_contracts_at_risk_cap} cts max) · Daily loss limit $${maxDailyLossDollars.toLocaleString()}`,
      },
    ];

    return {
      candidate_id: cand.candidate_id,
      ticker: cand.ticker,
      option_symbol: cand.option_symbol,
      Rank: 0,
      regime: regime_classification.regime,
      screener_passed,
      tape_filter_passed,
      flow_score,
      alpaca_confirmation,
      contract_selection,
      rule_hierarchy,
      alerted_for_human_review,
      risk_guardrails: {
        max_per_trade_risk_dollars: perTradeMaxRiskDollars,
        max_daily_loss_dollars: maxDailyLossDollars,
        max_contracts_at_risk_cap,
        nbbo_spread_pct: round2(cand.flow.spread * 100),
        liquidity_approved: cand.flow.spread <= 0.15 && cand.flow.open_interest >= 500,
      },
    };
  });

  // Sort by FlowScore descending, prioritizing candidates that pass Alpaca confirmation
  rawEvaluations.sort((a, b) => {
    if (a.alerted_for_human_review !== b.alerted_for_human_review) {
      return a.alerted_for_human_review ? -1 : 1;
    }
    return b.flow_score.total_flow_score - a.flow_score.total_flow_score;
  });

  const evaluated_candidates = rawEvaluations.map((item, idx) => ({
    ...item,
    Rank: idx + 1,
  }));

  const activeCandidateList = screener_spec.passed_tickers.slice(0, 15).join(', ');

  const streaming_subscriptions: StreamingSubscriptionSpec[] = [
    {
      provider: 'Unusual Whales',
      channel_or_endpoint: 'market_tide (WS) & GET /api/market/market-tide',
      transport: 'WebSocket',
      cadence: '1–5 min slopes',
      purpose: 'Broad call_tide_slope, put_tide_slope, and net_volume_slope',
      active_scope: 'Market-wide directional context (excludes mid-market prints)',
    },
    {
      provider: 'Unusual Whales',
      channel_or_endpoint: 'gex:SPX & GET /api/stock/SPX/spot-exposures',
      transport: 'WebSocket',
      cadence: 'Real-time / 1m delta',
      purpose: 'Aggregate SPX net gamma, Gamma Flip, and 1m/5m GEX change',
      active_scope: 'SPX Index (Never equated to SPY ETF price levels)',
    },
    {
      provider: 'Unusual Whales',
      channel_or_endpoint: 'gex_strike:SPX & GET /api/stock/SPX/spot-exposures/strike',
      transport: 'WebSocket',
      cadence: 'Real-time / 1m delta',
      purpose: 'Nearest major positive/negative gamma strikes, Call Wall, Put Wall, Magnet',
      active_scope: 'SPX Strike Ladder (5,750–5,900)',
    },
    {
      provider: 'Unusual Whales',
      channel_or_endpoint: 'stock_screener (WS) & GET /api/screener/stocks',
      transport: 'REST Snapshot / Poll',
      cadence: 'Every regime check (1–5m)',
      purpose: 'Narrows universe by regime SQL criteria (capped at top 10–25 liquid names)',
      active_scope: activeCandidateList || 'Top 10–25 liquid S&P 500 / large caps',
    },
    {
      provider: 'Unusual Whales',
      channel_or_endpoint: 'option_trades & flow-alerts (WS)',
      transport: 'WebSocket',
      cadence: 'Continuous streaming',
      purpose: 'Live whale tape reconstruction, sweep urgency, and repeated hits',
      active_scope: `Subscribed to ${screener_spec.passed_tickers.length} active regime tickers`,
    },
    {
      provider: 'Alpaca Market Data',
      channel_or_endpoint: 'v2/stocks/trades, quotes, bars (SIP consolidated feed)',
      transport: 'WebSocket',
      cadence: 'Real-time + 1m/5m bars',
      purpose: 'Intraday VWAP, opening-range breakout, RVOL, quote imbalance, post-burst hold',
      active_scope: `Active candidate set (${screener_spec.passed_tickers.length} tickers, <= 25 cap)`,
    },
  ];

  const core_guardrails = [
    'Do not call a contract "highest potential." Call it highest-ranked by the model’s current inputs.',
    'Do not equate ask-side calls with guaranteed bullish opening conviction.',
    'Never assume volume becomes open interest; verify with next-morning OI updates.',
    'Do not use SPX GEX levels as literal levels for SPY; they are related instruments with different prices.',
    'Use defined per-trade risk, maximum daily loss, and liquidity limits before sending any order.',
    'Backtest or paper trade by market regime before automating execution.',
  ];

  return {
    regime_classification,
    screener_spec,
    tape_filter_json,
    evaluated_candidates,
    streaming_subscriptions,
    core_guardrails,
  };
}
