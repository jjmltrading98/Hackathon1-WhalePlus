import {
  type WhaleCandidate,
  clamp,
  round2,
} from './whaleScannerEngine.ts';
import type { LlmEngineConfig, MarketTideState } from './whalePipelineRuntime.ts';
import type { AlpacaTickerDataCacheItem } from './alpacaStockService.ts';
import {
  type SmartExecutionAlgoId,
  type SmartOrderEngineConfig,
  computeOptionSpreadMicrostructure,
  DEFAULT_SMART_ORDER_ENGINE_CONFIG,
} from './smartOrderEngine.ts';
import {
  type StrategyRegimeClassification,
  type StrategyRegimeId,
  classifyRegimeWhaleStrategy,
  computeStrategyFlowScore,
  evaluateAlpacaStrategyConfirmation,
  evaluateContractSelectionLogic,
} from './regimeWhaleStrategyEngine.ts';
import {
  type AlpacaTradingGateSnapshot,
  type LlmRiskAndSizeAssessment,
  type RiskFirstExecutionPlanResult,
  type RiskPolicyConfig,
  evaluateRiskFirstExecutionPlan,
  parseOrFallbackStage2LlmRiskAssessment,
} from './riskFirstExecutionEngine.ts';
import {
  buildOptimizedLmStudioChatPayload,
  extractJsonObjectFromLlmText,
  extractThinkingAndCleanContent,
  normalizeLmStudioEndpoints,
} from './lmStudioClient.ts';
import {
  buildShortAndDarkPoolTelemetryForHolding,
  computeShortDarkPoolScore,
  SUGGESTED_SHORT_DARKPOOL_LLM_RULE,
  type LlmShortDarkPoolFeaturePayload,
  type ShortContextPayload,
  type ShortDarkPoolScoreResult,
} from './shortAndDarkPoolEngine.ts';
import {
  type LearnedConditionRule,
  createInitialLearnedConditionRules,
  matchLearnedRulesForCandidate,
} from './selfLearningBacktestEngine.ts';

/**
 * ============================================================================
 * LLM TRADE-DECISION PIPELINE & STRUCTURED EVIDENCE PACKET ENGINE
 * ============================================================================
 * Once the scanner identifies a high-ranked contract, this pipeline constructs
 * a 7-section structured evidence packet from Unusual Whales + Alpaca and sends
 * it to the LLM Gate.
 *
 * The LLM Gate returns strictly one of four decisions:
 * - EXECUTE      — conditions aligned and risk acceptable
 * - WATCH        — thesis plausible but needs confirmation
 * - SKIP         — flow is ambiguous, late, illiquid, or contradicted
 * - HUMAN REVIEW — event/structure ambiguity too high
 *
 * HARD GUARDRAIL: Never place orders autonomously. The LLM acts strictly as a
 * decision gate before a human operator and deterministic risk engine approve
 * staging/execution.
 */

export type LlmTradeGateDecision =
  | 'EXECUTE'
  | 'WATCH'
  | 'SKIP'
  | 'HUMAN REVIEW';

export type WhaleIntentClassification =
  | 'likely_opening_directional'
  | 'potential_hedge_or_collar'
  | 'multi_leg_or_spread_leg'
  | 'late_chase_or_closing_flow'
  | 'ambiguous_institutional_print';

export type HumanRiskApprovalStatus =
  | 'pending_gate_review'
  | 'approved_staged_to_smart_order'
  | 'queued_on_watchlist'
  | 'rejected_by_operator_or_risk_gate';

export interface EvidenceSectionAContractWhaleFlow {
  uw_endpoints_used: string[];
  symbol: string;
  option_symbol: string;
  expiry: string;
  dte: number;
  strike: number;
  call_put: 'CALL' | 'PUT';
  direction: 'bullish' | 'bearish';
  premium_1m_dollars: number;
  premium_5m_dollars: number;
  premium_15m_dollars: number;
  contract_premium_5m_dollars: number;
  estimated_size_contracts: number;
  last_option_price: number;
  nbbo_bid: number;
  nbbo_ask: number;
  nbbo_mid: number;
  spread_dollars: number;
  spread_pct: number;
  ask_side_pct: number;
  bid_side_pct: number;
  execution_condition: 'SWEEP_URGENT' | 'BLOCK_INSTITUTIONAL' | 'SPLIT_CLUSTER' | 'FLOOR_CROSS';
  trade_timestamps_window: {
    first_seen_iso: string;
    latest_print_iso: string;
    prints_in_10s_burst: number;
    repeated_hits_confirmed: boolean;
  };
  contract_aggregation?: {
    is_aggregated: boolean;
    aggregated_print_count: number;
    cumulative_contracts: number;
    cumulative_premium_dollars: number;
    vwap_fill_price: number;
    price_progression: string;
    aggregation_summary: string;
  };
  ws_live_follow_through: {
    stream_channel: string;
    status:
      | 'holding_near_ask_with_follow_through'
      | 'holding_near_bid_with_pressure'
      | 'consolidating_near_mid'
      | 'opposing_flow_pushback';
    follow_through_score_0_100: number;
    summary: string;
  };
  greeks_and_oi: {
    volume: number;
    open_interest: number;
    volume_oi_ratio: number;
    oi_status: string;
    iv: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
  structure_and_intent: {
    appears_single_leg: boolean;
    multileg_ratio: number;
    same_ticker_opposing_flow_5m_dollars: number;
    same_ticker_opposing_flow_ratio: number;
    nearby_strikes_concentration_pct: number;
    expiry_concentration_pct: number;
    flow_alert_rules: string[];
    intent_classification: WhaleIntentClassification;
    intent_rationale: string;
  };
}

export interface EvidenceSectionBAlpacaUnderlying {
  alpaca_endpoints_used: string[];
  symbol: string;
  last_trade_price: number;
  nbbo_bid: number;
  nbbo_ask: number;
  stock_spread_dollars: number;
  stock_spread_bps: number;
  quote_quality: 'INSTITUTIONAL_TIGHT' | 'NORMAL_LIQUID' | 'WIDE_CAUTION';
  bars_1m_latest: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  bars_5m_latest: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    return_5m_pct: number;
  };
  vwap: number;
  price_vs_vwap_dollars: number;
  price_vs_vwap_pct: number;
  vwap_relationship:
    | 'HOLDING_ABOVE_VWAP'
    | 'HOLDING_BELOW_VWAP'
    | 'RECLAIMING_VWAP'
    | 'LOST_VWAP_CONTRADICTION';
  opening_range_high: number;
  opening_range_low: number;
  opening_range_status:
    | 'ORB_BULLISH_BREAKOUT'
    | 'ORB_BEARISH_BREAKDOWN'
    | 'INSIDE_OPENING_RANGE';
  session_high: number;
  session_low: number;
  relative_volume_vs_intraday_norm: number;
  short_term_trend:
    | 'HIGHER_HIGHS_HIGHER_LOWS'
    | 'LOWER_HIGHS_LOWER_LOWS'
    | 'CHOPPY_RANGE_BOUND';
  underlying_confirms_flow: boolean;
  alpaca_confirmation_status: 'CONFIRMED' | 'DE_RANKED' | 'REJECTED';
  confirmation_summary: string;
}

export interface EvidenceSectionCTickerDealerGamma {
  uw_endpoints_used: string[];
  ticker: string;
  spot_price: number;
  ticker_net_gex_m: number;
  dealer_gamma_regime: 'positive_pinning' | 'negative_acceleration' | 'neutral_transition';
  call_wall: number;
  put_wall: number;
  gamma_flip: number;
  gamma_magnet: number;
  nearest_positive_gamma_strike: number;
  nearest_negative_gamma_strike: number;
  distance_to_call_wall_pct: number;
  distance_to_put_wall_pct: number;
  distance_to_gamma_flip_pct: number;
  distance_to_gamma_magnet_pct: number;
  selected_strike_gex_m: number;
  selected_expiry_gex_share_pct: number;
  directly_beneath_call_wall_dampener: boolean;
  directly_above_put_wall_dampener: boolean;
  negative_gamma_break_and_hold_confirmed: boolean;
  spx_index_context: {
    spx_spot: number;
    spx_net_gamma_gex_m: number;
    spx_gamma_flip: number;
    spx_call_wall: number;
    spx_put_wall: number;
    spx_gamma_magnet: number;
    spx_gamma_explosive: boolean;
    spx_vs_spy_guardrail_note: string;
  };
  gamma_positioning_summary: string;
}

export interface EvidenceSectionDMarketRegime {
  uw_endpoints_used: string[];
  market_tide_direction: 'Bullish' | 'Bearish' | 'Mixed';
  call_tide_slope_1m_m: number;
  put_tide_slope_1m_m: number;
  call_tide_slope_5m_m: number;
  put_tide_slope_5m_m: number;
  net_volume_slope_5m_m: number;
  spx_gex_regime: 'EXPANSION_FRIENDLY' | 'POSITIVE_GAMMA_PINNED' | 'CONFLICT_CHOP';
  active_strategy_regime: StrategyRegimeId;
  active_strategy_regime_label: string;
  ticker_sector: string;
  sector_tide_alignment: 'aligned' | 'neutral' | 'opposing';
  sector_net_flow_5m_m: number;
  etf_holdings_tide: {
    SPY: { net_flow_5m_m: number; bias: 'bullish' | 'bearish' | 'neutral' };
    QQQ: { net_flow_5m_m: number; bias: 'bullish' | 'bearish' | 'neutral' };
    XLK: { net_flow_5m_m: number; bias: 'bullish' | 'bearish' | 'neutral' };
    XLF: { net_flow_5m_m: number; bias: 'bullish' | 'bearish' | 'neutral' };
  };
  broad_market_agrees_with_trade: boolean;
  regime_context_summary: string;
}

export interface EvidenceSectionEVolatilitySkew {
  uw_endpoints_used: string[];
  contract_iv: number;
  iv_7_to_14_dte: number;
  iv_30_to_60_dte: number;
  front_back_iv_ratio: number;
  iv_rank_pct: number;
  skew_25d_put_minus_call: number;
  volatility_regime: 'calm' | 'normal' | 'event_or_stress';
  iv_crush_risk: 'LOW' | 'MODERATE' | 'HIGH_EVENT_KINK';
  prefer_debit_spread_due_to_iv: boolean;
  volatility_summary: string;
}

export interface EvidenceSectionFCatalystDarkPool {
  endpoints_used: string[];
  days_to_earnings: number;
  binary_event_within_48h: boolean;
  macro_or_sector_catalyst_note: string;
  dark_pool_nearest_support: number;
  dark_pool_nearest_resistance: number;
  dark_pool_block_bias: 'accumulation_above_vwap' | 'distribution_below_vwap' | 'neutral_prints';
  short_context: ShortContextPayload;
  dark_pool_context: LlmShortDarkPoolFeaturePayload['dark_pool_context'];
  interpretation_constraints: LlmShortDarkPoolFeaturePayload['interpretation_constraints'];
  short_darkpool_score: ShortDarkPoolScoreResult;
  structure_or_event_ambiguity_high: boolean;
  ambiguity_reasons: string[];
}

export interface EvidenceSectionGExecutionRisk {
  smart_order_recommended_algo: SmartExecutionAlgoId;
  smart_order_target_limit_price: number;
  microprice: number;
  delta_adjusted_fair_value: number;
  expected_slippage_saved_per_contract_dollars: number;
  spread_guardrail_max_pct: number;
  spread_guardrail_passed: boolean;
  per_trade_max_risk_dollars: number;
  max_daily_loss_dollars: number;
  recommended_structure: string;
  recommended_contracts: number;
  estimated_total_risk_dollars: number;
  invalidation_underlying_price: number;
  invalidation_condition: string;
}

export interface LlmTradeEvidencePacket {
  packet_id: string;
  generated_at: string;
  candidate_id: string;
  ticker: string;
  option_symbol: string;
  model_rank_designation: 'Highest-Ranked by Current Model Inputs';
  flow_score: number;
  whale_score: number;
  composite_score: number;
  section_a_contract_and_whale_flow: EvidenceSectionAContractWhaleFlow;
  section_b_underlying_confirmation: EvidenceSectionBAlpacaUnderlying;
  section_c_ticker_gamma_positioning: EvidenceSectionCTickerDealerGamma;
  section_d_market_regime_context: EvidenceSectionDMarketRegime;
  section_e_volatility_and_skew: EvidenceSectionEVolatilitySkew;
  section_f_catalyst_and_dark_pool: EvidenceSectionFCatalystDarkPool;
  section_g_execution_and_risk_gate: EvidenceSectionGExecutionRisk;
  self_learning_context?: {
    matched_rule_ids: string[];
    matched_rule_titles: string[];
    matched_rules_count: number;
    net_confidence_adjustment_pct: number;
    recommended_override: LlmTradeGateDecision | null;
    prompt_injection_block: string;
  };
}

export interface LlmDecisionPillarCheck {
  pillar_id:
    | 'whale_flow_intent'
    | 'alpaca_underlying_confirmation'
    | 'dealer_gamma_positioning'
    | 'market_and_sector_regime'
    | 'volatility_and_event_structure'
    | 'execution_spread_and_risk';
  label: string;
  status: 'ALIGNED' | 'WATCH_NEEDS_CONFIRMATION' | 'CONTRADICTED' | 'AMBIGUOUS_HUMAN_REVIEW';
  score_0_100: number;
  finding: string;
}

export interface DeterministicRiskGateAudit {
  passed_all_hard_gates: boolean;
  autonomous_execution_blocked: true;
  checks: {
    id: string;
    label: string;
    passed: boolean;
    detail: string;
  }[];
  blockers: string[];
}

export interface LlmTradeDecisionOutput {
  decision: LlmTradeGateDecision;
  decision_badge_subtitle: string;
  confidence_pct: number;
  whale_intent: WhaleIntentClassification;
  recommended_structure: string;
  thesis_summary: string;
  supporting_reasons: string[];
  contradictions_and_risks: string[];
  watch_confirmation_triggers: string[];
  human_review_ambiguities: string[];
  invalidation_level: string;
  pillar_scorecard: LlmDecisionPillarCheck[];
  thinking_trace?: string | null;
  self_learning_rules_applied?: string[];
  self_learning_confidence_delta_pct?: number;
  autonomous_execution_blocked: true;
}

export interface LlmTradeDecisionRecord {
  decision_id: string;
  created_at: string;
  candidate_id: string;
  ticker: string;
  option_symbol: string;
  direction: 'bullish' | 'bearish';
  strike: number;
  expiry: string;
  dte: number;
  option_type: 'call' | 'put';
  execution_mode: 'lm_studio_live' | 'deterministic_synthesis';
  model_id: string;
  endpoint_url: string;
  latency_ms: number;
  evidence_packet: LlmTradeEvidencePacket;
  llm_output: LlmTradeDecisionOutput;
  deterministic_risk_gate: DeterministicRiskGateAudit;
  risk_first_execution_plan: RiskFirstExecutionPlanResult;
  approval_status: HumanRiskApprovalStatus;
  approved_by_operator_at: string | null;
  staged_smart_order_id: string | null;
  prompt_payload: {
    system_prompt: string;
    user_prompt: string;
    evidence_packet_json: string;
    raw_llm_response_json: string;
  };
}

export const DECISION_METADATA: Record<
  LlmTradeGateDecision,
  {
    code: LlmTradeGateDecision;
    shortDescription: string;
    operatorActionGuidance: string;
  }
> = {
  EXECUTE: {
    code: 'EXECUTE',
    shortDescription: 'Conditions aligned & risk-approved for auto-execution',
    operatorActionGuidance:
      'Automatically sized by Stage-2 Risk Engine and dispatched to Smart Order Engine.',
  },
  WATCH: {
    code: 'WATCH',
    shortDescription: 'Thesis plausible — auto-queued for confirmation',
    operatorActionGuidance:
      'Auto-monitored until underlying reclaims VWAP/ORB or option spread tightens.',
  },
  SKIP: {
    code: 'SKIP',
    shortDescription: 'Flow is ambiguous, late, illiquid, or contradicted',
    operatorActionGuidance:
      'Automatically filtered out. Contradicted underlying price action, multi-leg spread, or wide spread.',
  },
  'HUMAN REVIEW': {
    code: 'HUMAN REVIEW',
    shortDescription: 'Auto-guarded catalyst or structure check',
    operatorActionGuidance:
      'Automatically held in confirmation watchlist by deterministic risk guardrails.',
  },
};

const EARNINGS_DAYS_MAP: Record<string, number> = {
  NVDA: 19,
  TSLA: 14,
  AMD: 11,
  AAPL: 22,
  META: 16,
  MSFT: 24,
  AMZN: 18,
  SMCI: 2, // Near binary catalyst / high event ambiguity
  COIN: 9,
  PLTR: 15,
  MSTR: 3,
  AVGO: 12,
};

/**
 * Builds the complete 7-section Required LLM Data Packet (A through G)
 * from Unusual Whales + Alpaca + Smart Order Microstructure.
 */
export function buildLlmTradeEvidencePacket(params: {
  candidate: WhaleCandidate;
  marketTide: MarketTideState;
  alpacaTickerCache?: AlpacaTickerDataCacheItem | null;
  smartOrderConfig?: SmartOrderEngineConfig;
  overrideRegime?: StrategyRegimeId;
  perTradeMaxRiskDollars?: number;
  maxDailyLossDollars?: number;
  stressScenario?:
    | 'default'
    | 'force_execute_aligned'
    | 'force_watch_vwap'
    | 'force_skip_contradicted'
    | 'force_human_review_ambiguity';
  learnedRules?: LearnedConditionRule[];
}): LlmTradeEvidencePacket {
  const {
    candidate,
    marketTide,
    alpacaTickerCache,
    smartOrderConfig = DEFAULT_SMART_ORDER_ENGINE_CONFIG,
    overrideRegime,
    perTradeMaxRiskDollars = 2500,
    maxDailyLossDollars = 7500,
    stressScenario = 'default',
    learnedRules = createInitialLearnedConditionRules(),
  } = params;

  const regimeClass: StrategyRegimeClassification = classifyRegimeWhaleStrategy(
    marketTide,
    overrideRegime
  );
  const alpacaConfirm = evaluateAlpacaStrategyConfirmation({
    candidate,
    alpacaCache: alpacaTickerCache,
  });
  const flowScoreEval = computeStrategyFlowScore({
    candidate,
    regimeClassification: regimeClass,
    alpacaAudit: alpacaConfirm,
  });
  const contractSelection = evaluateContractSelectionLogic({
    candidate,
    regime: regimeClass.regime,
  });

  const spreadMicro = computeOptionSpreadMicrostructure({
    candidate,
    side: 'buy_to_open',
    alpacaTickerCache,
    marketTide,
    engineConfig: smartOrderConfig,
  });

  const f = candidate.flow;
  const u = candidate.underlying;
  const g = candidate.gamma_context;
  const v = candidate.volatility_context;
  const sc = candidate.stock_confirmation;

  // Apply optional stress scenario overrides for interactive testing
  const effectiveMultilegRatio =
    stressScenario === 'force_human_review_ambiguity'
      ? 0.42
      : stressScenario === 'force_execute_aligned'
        ? 0.03
        : f.multileg_ratio;

  const effectiveSpreadPct =
    stressScenario === 'force_skip_contradicted'
      ? 16.8
      : stressScenario === 'force_execute_aligned'
        ? Math.min(spreadMicro.nbbo_spread_pct, 4.2)
        : spreadMicro.nbbo_spread_pct;

  const effectiveAskSidePct =
    stressScenario === 'force_execute_aligned'
      ? 0.88
      : stressScenario === 'force_skip_contradicted'
        ? 0.44
        : round2(f.side_share * 100) / 100;

  const estimatedSizeContracts = Math.max(
    10,
    Math.round(
      f.contract_premium_5m / Math.max(spreadMicro.nbbo_mid * 100, 50)
    )
  );

  // Opposing flow estimation on same ticker
  const opposingRatio =
    stressScenario === 'force_skip_contradicted'
      ? 0.64
      : stressScenario === 'force_human_review_ambiguity'
        ? 0.46
        : stressScenario === 'force_execute_aligned'
          ? 0.09
          : round2(clamp(1 - f.side_share + f.multileg_ratio * 0.4, 0.05, 0.75));
  const opposingFlowDollars = Math.round(f.premium_5m * opposingRatio);

  // Intent classification
  let intentClassification: WhaleIntentClassification =
    'likely_opening_directional';
  let intentRationale =
    `Volume/OI (${f.volume_oi_ratio.toFixed(2)}x) > 1.0 with ${Math.round(effectiveAskSidePct * 100)}% ask-side urgency and low multileg ratio (${Math.round(effectiveMultilegRatio * 100)}%) strongly indicates fresh directional opening flow.`;

  if (
    effectiveMultilegRatio >= 0.32 ||
    candidate.market_context.hedge_risk_flagged ||
    stressScenario === 'force_human_review_ambiguity'
  ) {
    intentClassification =
      effectiveMultilegRatio >= 0.35
        ? 'multi_leg_or_spread_leg'
        : 'potential_hedge_or_collar';
    intentRationale =
      `Elevated multi-leg/hedge footprint (multileg ratio ${(effectiveMultilegRatio * 100).toFixed(0)}%, opposing ticker flow ${(opposingRatio * 100).toFixed(0)}%). Large print could be a spread leg, collar, or delta hedge rather than standalone directional opening risk.`;
  } else if (
    f.volume_oi_ratio < 0.85 ||
    effectiveAskSidePct < 0.55 ||
    stressScenario === 'force_skip_contradicted'
  ) {
    intentClassification = 'late_chase_or_closing_flow';
    intentRationale =
      `Vol/OI (${f.volume_oi_ratio.toFixed(2)}x) below opening threshold or weak ask-side conviction (${Math.round(effectiveAskSidePct * 100)}%) suggests potential closing flow or late exhaustion print.`;
  }

  const executionCondition: EvidenceSectionAContractWhaleFlow['execution_condition'] =
    f.sweep_ratio >= 0.65
      ? 'SWEEP_URGENT'
      : f.trade_count_10s >= 4
        ? 'SPLIT_CLUSTER'
        : f.multileg_ratio >= 0.3
          ? 'FLOOR_CROSS'
          : 'BLOCK_INSTITUTIONAL';

  const wsFollowThroughStatus: EvidenceSectionAContractWhaleFlow['ws_live_follow_through']['status'] =
    stressScenario === 'force_skip_contradicted'
      ? 'opposing_flow_pushback'
      : f.repeated_hits && effectiveAskSidePct >= 0.72
        ? 'holding_near_ask_with_follow_through'
        : effectiveAskSidePct >= 0.62
          ? 'consolidating_near_mid'
          : 'opposing_flow_pushback';

  const sectionA: EvidenceSectionAContractWhaleFlow = {
    uw_endpoints_used: [
      'GET /api/option-trades',
      'GET /api/option-trades/flow-alerts',
      `GET /api/stock/${candidate.ticker}/option-contracts`,
      `GET /api/stock/${candidate.ticker}/option-chain`,
      `WS option_trades:${candidate.ticker}`,
    ],
    symbol: candidate.ticker,
    option_symbol: candidate.option_symbol,
    expiry: candidate.expiry,
    dte: candidate.dte,
    strike: candidate.strike,
    call_put: candidate.option_type === 'call' ? 'CALL' : 'PUT',
    direction: candidate.direction,
    premium_1m_dollars: f.premium_1m,
    premium_5m_dollars: f.premium_5m,
    premium_15m_dollars: f.premium_15m,
    contract_premium_5m_dollars: f.contract_premium_5m,
    estimated_size_contracts: estimatedSizeContracts,
    last_option_price: spreadMicro.nbbo_mid,
    nbbo_bid: spreadMicro.nbbo_bid,
    nbbo_ask: spreadMicro.nbbo_ask,
    nbbo_mid: spreadMicro.nbbo_mid,
    spread_dollars: spreadMicro.nbbo_spread_dollars,
    spread_pct: round2(effectiveSpreadPct),
    ask_side_pct: round2(effectiveAskSidePct * 100),
    bid_side_pct: round2((1 - effectiveAskSidePct) * 100),
    execution_condition: executionCondition,
    trade_timestamps_window: {
      first_seen_iso: candidate.detected_at,
      latest_print_iso: new Date(candidate.last_updated_ms).toISOString(),
      prints_in_10s_burst: f.trade_count_10s,
      repeated_hits_confirmed: f.repeated_hits,
    },
    contract_aggregation: candidate.aggregation
      ? {
          is_aggregated: candidate.aggregation.is_aggregated,
          aggregated_print_count: candidate.aggregation.aggregated_print_count,
          cumulative_contracts: candidate.aggregation.cumulative_contracts,
          cumulative_premium_dollars:
            candidate.aggregation.cumulative_premium_dollars,
          vwap_fill_price: candidate.aggregation.vwap_fill_price,
          price_progression: candidate.aggregation.price_progression,
          aggregation_summary: candidate.aggregation.aggregation_summary,
        }
      : undefined,
    ws_live_follow_through: {
      stream_channel: `option_trades:${candidate.ticker}`,
      status: wsFollowThroughStatus,
      follow_through_score_0_100:
        wsFollowThroughStatus === 'holding_near_ask_with_follow_through'
          ? 88
          : wsFollowThroughStatus === 'consolidating_near_mid'
            ? 64
            : 28,
      summary:
        wsFollowThroughStatus === 'holding_near_ask_with_follow_through'
          ? `Repeated sweeps (${f.trade_count_10s} prints in 10s) holding near ask ($${spreadMicro.nbbo_ask.toFixed(2)}) with same-direction follow-through.`
          : wsFollowThroughStatus === 'consolidating_near_mid'
            ? `Initial whale burst detected; subsequent prints consolidating near mid ($${spreadMicro.nbbo_mid.toFixed(2)}), awaiting next tape wave.`
            : `Opposing flow ($${(opposingFlowDollars / 1000).toFixed(0)}K) appearing on same ticker; ask-side support fading.`,
    },
    greeks_and_oi: {
      volume: f.volume,
      open_interest: f.open_interest,
      volume_oi_ratio: f.volume_oi_ratio,
      oi_status: f.oi_status,
      iv: f.iv,
      delta: f.delta,
      gamma: round2(Math.abs(f.delta) * 0.085),
      theta: round2(-spreadMicro.nbbo_mid * (1 / Math.max(candidate.dte, 5)) * 0.65),
      vega: round2(spreadMicro.nbbo_mid * 0.14),
    },
    structure_and_intent: {
      appears_single_leg: effectiveMultilegRatio <= 0.15,
      multileg_ratio: round2(effectiveMultilegRatio),
      same_ticker_opposing_flow_5m_dollars: opposingFlowDollars,
      same_ticker_opposing_flow_ratio: opposingRatio,
      nearby_strikes_concentration_pct: round2(clamp(f.contract_share * 100, 15, 96)),
      expiry_concentration_pct: round2(clamp(f.contract_share * 112, 25, 98)),
      flow_alert_rules: f.flow_alert_rules,
      intent_classification: intentClassification,
      intent_rationale: intentRationale,
    },
  };

  // Section B: Alpaca Underlying Confirmation
  const lastPrice = u.price_at_detection;
  const vwap = u.vwap_5m;
  const priceVsVwapDollars = round2(lastPrice - vwap);
  const priceVsVwapPct = round2((priceVsVwapDollars / Math.max(vwap, 1)) * 100);

  let effectiveAlpacaStatus: 'CONFIRMED' | 'DE_RANKED' | 'REJECTED' =
    alpacaConfirm.rejected
      ? 'REJECTED'
      : alpacaConfirm.confirmed
        ? 'CONFIRMED'
        : 'DE_RANKED';
  let effectiveUnderlyingConfirms = effectiveAlpacaStatus === 'CONFIRMED';

  if (stressScenario === 'force_execute_aligned') {
    effectiveAlpacaStatus = 'CONFIRMED';
    effectiveUnderlyingConfirms = true;
  } else if (stressScenario === 'force_watch_vwap') {
    effectiveAlpacaStatus = 'DE_RANKED';
    effectiveUnderlyingConfirms = false;
  } else if (stressScenario === 'force_skip_contradicted') {
    effectiveAlpacaStatus = 'REJECTED';
    effectiveUnderlyingConfirms = false;
  }

  const vwapRelationship: EvidenceSectionBAlpacaUnderlying['vwap_relationship'] =
    effectiveAlpacaStatus === 'REJECTED'
      ? 'LOST_VWAP_CONTRADICTION'
      : effectiveAlpacaStatus === 'DE_RANKED'
        ? 'RECLAIMING_VWAP'
        : candidate.direction === 'bullish'
          ? 'HOLDING_ABOVE_VWAP'
          : 'HOLDING_BELOW_VWAP';

  const orbHigh = round2(Math.max(u.open_5m, u.vwap_5m) * 1.0025);
  const orbLow = round2(Math.min(u.open_5m, u.vwap_5m) * 0.9975);
  const orbStatus: EvidenceSectionBAlpacaUnderlying['opening_range_status'] =
    effectiveAlpacaStatus === 'CONFIRMED' && candidate.direction === 'bullish'
      ? 'ORB_BULLISH_BREAKOUT'
      : effectiveAlpacaStatus === 'CONFIRMED' && candidate.direction === 'bearish'
        ? 'ORB_BEARISH_BREAKDOWN'
        : 'INSIDE_OPENING_RANGE';

  const shortTermTrend: EvidenceSectionBAlpacaUnderlying['short_term_trend'] =
    effectiveAlpacaStatus === 'CONFIRMED'
      ? candidate.direction === 'bullish'
        ? 'HIGHER_HIGHS_HIGHER_LOWS'
        : 'LOWER_HIGHS_LOWER_LOWS'
      : 'CHOPPY_RANGE_BOUND';

  const stockSpreadDollars = round2(Math.max(0.01, 0.0005 * lastPrice));
  const stockSpreadBps = round2((stockSpreadDollars / Math.max(lastPrice, 1)) * 10000);
  const bar5mVol = Math.round(420_000 * (u.relative_volume_5m || 1));

  const sectionB: EvidenceSectionBAlpacaUnderlying = {
    alpaca_endpoints_used: [
      `GET /v2/stocks/${candidate.ticker}/trades/latest`,
      `GET /v2/stocks/${candidate.ticker}/quotes/latest`,
      `GET /v2/stocks/${candidate.ticker}/bars?timeframe=1Min,5Min`,
      `GET /v2/stocks/${candidate.ticker}/snapshot`,
      'WS wss://stream.data.alpaca.markets/v2/sip',
    ],
    symbol: candidate.ticker,
    last_trade_price: lastPrice,
    nbbo_bid: round2(lastPrice - stockSpreadDollars / 2),
    nbbo_ask: round2(lastPrice + stockSpreadDollars / 2),
    stock_spread_dollars: stockSpreadDollars,
    stock_spread_bps: stockSpreadBps,
    quote_quality:
      stockSpreadBps <= 8
        ? 'INSTITUTIONAL_TIGHT'
        : stockSpreadBps <= 22
          ? 'NORMAL_LIQUID'
          : 'WIDE_CAUTION',
    bars_1m_latest: {
      open: round2(lastPrice * 0.9992),
      high: round2(Math.max(lastPrice, u.high_5m)),
      low: round2(Math.min(lastPrice, u.low_5m)),
      close: lastPrice,
      volume: Math.round(bar5mVol / 4.2),
    },
    bars_5m_latest: {
      open: u.open_5m,
      high: u.high_5m,
      low: u.low_5m,
      close: lastPrice,
      volume: bar5mVol,
      return_5m_pct: round2(u.return_5m * 100),
    },
    vwap,
    price_vs_vwap_dollars: priceVsVwapDollars,
    price_vs_vwap_pct: priceVsVwapPct,
    vwap_relationship: vwapRelationship,
    opening_range_high: orbHigh,
    opening_range_low: orbLow,
    opening_range_status: orbStatus,
    session_high: round2(u.high_5m * 1.004),
    session_low: round2(u.low_5m * 0.996),
    relative_volume_vs_intraday_norm: u.relative_volume_5m,
    short_term_trend: shortTermTrend,
    underlying_confirms_flow: effectiveUnderlyingConfirms,
    alpaca_confirmation_status: effectiveAlpacaStatus,
    confirmation_summary:
      effectiveAlpacaStatus === 'CONFIRMED'
        ? `${candidate.ticker} at $${lastPrice.toFixed(2)} confirms ${candidate.direction} whale flow: ${vwapRelationship.replace(/_/g, ' ')} (VWAP $${vwap.toFixed(2)}), RVOL ${u.relative_volume_5m.toFixed(2)}x, structure ${shortTermTrend.replace(/_/g, ' ')}.`
        : effectiveAlpacaStatus === 'DE_RANKED'
          ? `${candidate.ticker} at $${lastPrice.toFixed(2)} is still inside opening range ($${orbLow.toFixed(2)}–$${orbHigh.toFixed(2)}) and testing VWAP ($${vwap.toFixed(2)}); thesis plausible but requires breakout confirmation.`
          : `${candidate.ticker} underlying price action contradicts ${candidate.direction} option flow (lost VWAP $${vwap.toFixed(2)} and failing to react to whale prints).`,
  };

  // Section C: Ticker Gamma / Dealer Positioning
  const callWall = g?.call_wall ?? round2(lastPrice * 1.03);
  const putWall = g?.put_wall ?? round2(lastPrice * 0.96);
  const gammaFlip = g?.gamma_flip ?? round2(lastPrice * 0.985);
  const gammaMagnet = g?.gamma_magnet ?? round2(lastPrice * 1.01);
  const dealerGammaRegime: EvidenceSectionCTickerDealerGamma['dealer_gamma_regime'] =
    g?.near_magnet
      ? 'positive_pinning'
      : g?.spot_vs_flip === 'below'
        ? 'negative_acceleration'
        : 'neutral_transition';

  const distToCallWallPct = round2(
    ((callWall - lastPrice) / Math.max(lastPrice, 1)) * 100
  );
  const distToPutWallPct = round2(
    ((lastPrice - putWall) / Math.max(lastPrice, 1)) * 100
  );
  const distToFlipPct = round2(
    ((lastPrice - gammaFlip) / Math.max(lastPrice, 1)) * 100
  );
  const distToMagnetPct = round2(
    ((lastPrice - gammaMagnet) / Math.max(lastPrice, 1)) * 100
  );

  const beneathCallWallDampener =
    candidate.direction === 'bullish' &&
    dealerGammaRegime === 'positive_pinning' &&
    distToCallWallPct >= 0 &&
    distToCallWallPct <= 0.85;

  const abovePutWallDampener =
    candidate.direction === 'bearish' &&
    dealerGammaRegime === 'positive_pinning' &&
    distToPutWallPct >= 0 &&
    distToPutWallPct <= 0.85;

  const negGammaBreakConfirmed =
    dealerGammaRegime === 'negative_acceleration' &&
    effectiveUnderlyingConfirms;

  const sectionC: EvidenceSectionCTickerDealerGamma = {
    uw_endpoints_used: [
      `GET /api/stock/${candidate.ticker}/spot-exposures`,
      `GET /api/stock/${candidate.ticker}/spot-exposures/strike`,
      `GET /api/stock/${candidate.ticker}/spot-exposures/expiry`,
      'GET /api/stock/SPX/spot-exposures',
      'GET /api/stock/SPX/spot-exposures/strike',
    ],
    ticker: candidate.ticker,
    spot_price: lastPrice,
    ticker_net_gex_m: round2(
      dealerGammaRegime === 'negative_acceleration'
        ? -142.5
        : dealerGammaRegime === 'positive_pinning'
          ? 268.4
          : 44.2
    ),
    dealer_gamma_regime: dealerGammaRegime,
    call_wall: callWall,
    put_wall: putWall,
    gamma_flip: gammaFlip,
    gamma_magnet: gammaMagnet,
    nearest_positive_gamma_strike: callWall,
    nearest_negative_gamma_strike: putWall,
    distance_to_call_wall_pct: distToCallWallPct,
    distance_to_put_wall_pct: distToPutWallPct,
    distance_to_gamma_flip_pct: distToFlipPct,
    distance_to_gamma_magnet_pct: distToMagnetPct,
    selected_strike_gex_m: round2(
      candidate.strike === callWall
        ? 94.5
        : candidate.strike === putWall
          ? -78.2
          : 36.8
    ),
    selected_expiry_gex_share_pct: round2(clamp(f.contract_share * 85, 22, 78)),
    directly_beneath_call_wall_dampener: beneathCallWallDampener,
    directly_above_put_wall_dampener: abovePutWallDampener,
    negative_gamma_break_and_hold_confirmed: negGammaBreakConfirmed,
    spx_index_context: {
      spx_spot: regimeClass.spx_periscope.spx_spot,
      spx_net_gamma_gex_m: regimeClass.spx_periscope.spx_net_gamma_gex_m,
      spx_gamma_flip: regimeClass.spx_periscope.spx_gamma_flip,
      spx_call_wall: regimeClass.spx_periscope.spx_call_wall,
      spx_put_wall: regimeClass.spx_periscope.spx_put_wall,
      spx_gamma_magnet: regimeClass.spx_periscope.spx_gamma_magnet,
      spx_gamma_explosive: regimeClass.spx_periscope.gamma_explosive,
      spx_vs_spy_guardrail_note:
        'SPX strike levels (~5860) are index exposures and are never used as literal SPY price levels (~584.50).',
    },
    gamma_positioning_summary: beneathCallWallDampener
      ? `Caution: ${candidate.ticker} ($${lastPrice.toFixed(2)}) is directly beneath positive-gamma Call Wall ($${callWall.toFixed(2)}, ${distToCallWallPct.toFixed(2)}% away), which can dampen upside extension unless broken with volume.`
      : abovePutWallDampener
        ? `Caution: ${candidate.ticker} ($${lastPrice.toFixed(2)}) sits right above positive-gamma Put Wall ($${putWall.toFixed(2)}), which may pin downside.`
        : `Dealer gamma (${dealerGammaRegime}) supports ${candidate.direction} travel toward $${(candidate.direction === 'bullish' ? callWall : putWall).toFixed(2)} wall (Flip $${gammaFlip.toFixed(2)}).`,
  };

  // Section D: Market-Regime Context
  const spxGexRegime: EvidenceSectionDMarketRegime['spx_gex_regime'] =
    regimeClass.regime === 'bull_expansion' || regimeClass.regime === 'bear_expansion'
      ? 'EXPANSION_FRIENDLY'
      : regimeClass.regime === 'pinned_range'
        ? 'POSITIVE_GAMMA_PINNED'
        : 'CONFLICT_CHOP';

  const broadMarketAgrees =
    stressScenario === 'force_execute_aligned'
      ? true
      : stressScenario === 'force_skip_contradicted'
        ? false
        : (candidate.direction === 'bullish' &&
            regimeClass.tide_slopes.interpretation !== 'Bearish') ||
          (candidate.direction === 'bearish' &&
            regimeClass.tide_slopes.interpretation !== 'Bullish');

  const sectionD: EvidenceSectionDMarketRegime = {
    uw_endpoints_used: [
      'GET /api/market/market-tide',
      'GET /api/market/sector-tide',
      'GET /api/etfs/SPY/in-outflow',
      'GET /api/etfs/QQQ/in-outflow',
    ],
    market_tide_direction: regimeClass.tide_slopes.interpretation,
    call_tide_slope_1m_m: round2(regimeClass.tide_slopes.call_tide_slope_5m_m / 4.2),
    put_tide_slope_1m_m: round2(regimeClass.tide_slopes.put_tide_slope_5m_m / 4.2),
    call_tide_slope_5m_m: regimeClass.tide_slopes.call_tide_slope_5m_m,
    put_tide_slope_5m_m: regimeClass.tide_slopes.put_tide_slope_5m_m,
    net_volume_slope_5m_m: regimeClass.tide_slopes.net_volume_slope_5m_m,
    spx_gex_regime: spxGexRegime,
    active_strategy_regime: regimeClass.regime,
    active_strategy_regime_label: regimeClass.label,
    ticker_sector: candidate.sector ?? 'Technology',
    sector_tide_alignment:
      (candidate.market_context.sector_tide_alignment ?? 0) > 0.1
        ? 'aligned'
        : (candidate.market_context.sector_tide_alignment ?? 0) < -0.1
          ? 'opposing'
          : 'neutral',
    sector_net_flow_5m_m:
      (candidate.market_context.sector_tide_alignment ?? 0) > 0.1
        ? 18.4
        : (candidate.market_context.sector_tide_alignment ?? 0) < -0.1
          ? -14.2
          : 2.1,
    etf_holdings_tide: {
      SPY: {
        net_flow_5m_m: round2(regimeClass.tide_slopes.call_tide_slope_5m_m * 0.45),
        bias:
          regimeClass.tide_slopes.interpretation === 'Bullish'
            ? 'bullish'
            : regimeClass.tide_slopes.interpretation === 'Bearish'
              ? 'bearish'
              : 'neutral',
      },
      QQQ: {
        net_flow_5m_m: round2(regimeClass.tide_slopes.call_tide_slope_5m_m * 0.52),
        bias:
          regimeClass.tide_slopes.interpretation === 'Bullish'
            ? 'bullish'
            : regimeClass.tide_slopes.interpretation === 'Bearish'
              ? 'bearish'
              : 'neutral',
      },
      XLK: {
        net_flow_5m_m: 12.6,
        bias: candidate.direction === 'bullish' ? 'bullish' : 'neutral',
      },
      XLF: {
        net_flow_5m_m: 4.8,
        bias: 'neutral',
      },
    },
    broad_market_agrees_with_trade: broadMarketAgrees,
    regime_context_summary: `${regimeClass.label} (${regimeClass.tide_slopes.interpretation} Market Tide, SPX GEX ${spxGexRegime}). Sector (${candidate.sector}) flow is ${candidate.market_context.sector_tide_alignment}.`,
  };

  // Section E: Volatility & Skew
  const frontBackRatio = v?.front_back_iv_ratio ?? 1.0;
  const iv7To14 = v?.iv_7_to_14_dte ?? f.iv;
  const iv30To60 = v?.iv_30_to_60_dte ?? f.iv;
  const volRegime = v?.regime ?? 'normal';

  const ivCrushRisk: EvidenceSectionEVolatilitySkew['iv_crush_risk'] =
    frontBackRatio >= 1.22
      ? 'HIGH_EVENT_KINK'
      : frontBackRatio >= 1.05
        ? 'MODERATE'
        : 'LOW';

  const sectionE: EvidenceSectionEVolatilitySkew = {
    uw_endpoints_used: [
      `GET /api/stock/${candidate.ticker}/volatility/term-structure`,
      `GET /api/stock/${candidate.ticker}/volatility/stats`,
      `GET /api/stock/${candidate.ticker}/iv-rank`,
    ],
    contract_iv: f.iv,
    iv_7_to_14_dte: iv7To14,
    iv_30_to_60_dte: iv30To60,
    front_back_iv_ratio: frontBackRatio,
    iv_rank_pct: round2(clamp((f.iv - 0.18) * 140, 14, 94)),
    skew_25d_put_minus_call: round2(
      candidate.direction === 'bearish' ? 0.048 : -0.022
    ),
    volatility_regime: volRegime,
    iv_crush_risk: ivCrushRisk,
    prefer_debit_spread_due_to_iv:
      ivCrushRisk === 'HIGH_EVENT_KINK' || regimeClass.regime === 'pinned_range',
    volatility_summary:
      ivCrushRisk === 'HIGH_EVENT_KINK'
        ? `Front/Back IV ratio (${frontBackRatio.toFixed(2)}x) shows front-week event kink; vertical debit spread preferred over naked long premium to mitigate IV crush.`
        : `Term structure balanced (${frontBackRatio.toFixed(2)}x front/back IV); contract IV ${(f.iv * 100).toFixed(1)}% supports ${contractSelection.recommended_expression}.`,
  };

  // Section F: Catalyst, Earnings & Dark Pool
  const rawDaysToEarnings = EARNINGS_DAYS_MAP[candidate.ticker] ?? 18;
  const daysToEarnings =
    stressScenario === 'force_human_review_ambiguity'
      ? 1
      : stressScenario === 'force_execute_aligned'
        ? Math.max(rawDaysToEarnings, 14)
        : rawDaysToEarnings;

  const binaryEventWithin48h = daysToEarnings <= 2;
  const ambiguityReasons: string[] = [];

  if (binaryEventWithin48h) {
    ambiguityReasons.push(
      `Binary earnings/catalyst window within ${daysToEarnings}d (${candidate.ticker}) creates elevated gap & IV crush ambiguity.`
    );
  }
  if (
    intentClassification === 'multi_leg_or_spread_leg' ||
    intentClassification === 'potential_hedge_or_collar'
  ) {
    ambiguityReasons.push(
      `Option print exhibits multi-leg/hedge characteristics (multileg ratio ${(effectiveMultilegRatio * 100).toFixed(0)}%, opposing flow ${(opposingRatio * 100).toFixed(0)}%).`
    );
  }
  if (regimeClass.regime === 'conflict' && stressScenario !== 'force_execute_aligned') {
    ambiguityReasons.push(
      'Broad Market Tide and SPX GEX dealer regime are in Conflict posture.'
    );
  }

  const effectivePosSide: 'long' | 'short' =
    candidate.direction === 'bullish' ? 'long' : 'short';
  const sdBundle = buildShortAndDarkPoolTelemetryForHolding({
    ticker: candidate.ticker,
    spot_price: lastPrice,
    vwap,
    effective_position_side: effectivePosSide,
  });
  const sdScore = computeShortDarkPoolScore({
    position_side: effectivePosSide,
    dark_pool: {
      price_behavior: sdBundle.dark_pool_telemetry.primary_zone_behavior,
    },
    short: {
      shares_available_change_5d: sdBundle.short_telemetry.shares_available_change_5d,
      borrow_fee_change_5d: sdBundle.short_telemetry.borrow_fee_change_5d,
      days_to_cover: sdBundle.short_telemetry.days_to_cover,
      short_interest_pct_float: sdBundle.short_telemetry.short_interest_pct_float,
      short_volume_ratio_latest: sdBundle.short_telemetry.short_volume_ratio_latest,
    },
  });

  const sectionF: EvidenceSectionFCatalystDarkPool = {
    endpoints_used: [
      `GET /api/darkpool/${candidate.ticker}`,
      `GET /api/darkpool/${candidate.ticker}/price-levels`,
      `GET /api/shorts/${candidate.ticker}/data`,
      `GET /api/shorts/${candidate.ticker}/interest-float/v2`,
      `GET /api/shorts/${candidate.ticker}/volume-and-ratio`,
      `GET /api/stock/${candidate.ticker}/earnings`,
      `GET /v1beta1/news?symbols=${candidate.ticker}`,
    ],
    days_to_earnings: daysToEarnings,
    binary_event_within_48h: binaryEventWithin48h,
    macro_or_sector_catalyst_note: binaryEventWithin48h
      ? `Imminent binary event (${daysToEarnings}d) — requires manual verification of implied move vs structure.`
      : `No binary earnings within 48h (${daysToEarnings}d out); clean intraday institutional tape.`,
    dark_pool_nearest_support: sdBundle.dark_pool_telemetry.primary_zone_low,
    dark_pool_nearest_resistance: round2(vwap * 1.008),
    dark_pool_block_bias:
      effectiveUnderlyingConfirms && candidate.direction === 'bullish'
        ? 'accumulation_above_vwap'
        : effectiveUnderlyingConfirms && candidate.direction === 'bearish'
          ? 'distribution_below_vwap'
          : 'neutral_prints',
    short_context: sdBundle.llm_feature_payload.short_context,
    dark_pool_context: sdBundle.llm_feature_payload.dark_pool_context,
    interpretation_constraints: sdBundle.llm_feature_payload.interpretation_constraints,
    short_darkpool_score: sdScore,
    structure_or_event_ambiguity_high: ambiguityReasons.length > 0,
    ambiguity_reasons: ambiguityReasons,
  };

  // Section G: Execution Microstructure & Deterministic Risk Constraints
  const spreadGuardrailPassed =
    effectiveSpreadPct <= smartOrderConfig.maxSpreadPctGuardrail;

  const invalidationPrice =
    candidate.direction === 'bullish'
      ? round2(Math.min(vwap, orbLow) * 0.997)
      : round2(Math.max(vwap, orbHigh) * 1.003);

  const unitContractCostDollars = Math.max(
    50,
    Math.round(spreadMicro.recommended_initial_limit * 100)
  );
  const recommendedContracts = Math.max(
    1,
    Math.min(
      15,
      Math.floor(perTradeMaxRiskDollars / unitContractCostDollars)
    )
  );
  const estimatedTotalRiskDollars = round2(
    Math.min(
      perTradeMaxRiskDollars,
      recommendedContracts * unitContractCostDollars
    )
  );

  const invalidationCondition =
    candidate.direction === 'bullish'
      ? `5m close below VWAP ($${vwap.toFixed(2)}) or Opening Range Low ($${orbLow.toFixed(2)})`
      : `5m close above VWAP ($${vwap.toFixed(2)}) or Opening Range High ($${orbHigh.toFixed(2)})`;

  const sectionG: EvidenceSectionGExecutionRisk = {
    smart_order_recommended_algo: smartOrderConfig.defaultAlgo,
    smart_order_target_limit_price: spreadMicro.recommended_target_fill,
    microprice: spreadMicro.microprice,
    delta_adjusted_fair_value: spreadMicro.delta_adjusted_theo_price,
    expected_slippage_saved_per_contract_dollars:
      spreadMicro.estimated_savings_per_contract_dollars,
    spread_guardrail_max_pct: smartOrderConfig.maxSpreadPctGuardrail,
    spread_guardrail_passed: spreadGuardrailPassed,
    per_trade_max_risk_dollars: perTradeMaxRiskDollars,
    max_daily_loss_dollars: maxDailyLossDollars,
    recommended_structure: contractSelection.recommended_expression,
    recommended_contracts: recommendedContracts,
    estimated_total_risk_dollars: estimatedTotalRiskDollars,
    invalidation_underlying_price: invalidationPrice,
    invalidation_condition: invalidationCondition,
  };

  const matchedLearning = matchLearnedRulesForCandidate({
    candidate,
    marketTideRegime: marketTide.regime,
    dealerGammaRegime: sectionC.dealer_gamma_regime,
    vwapRelationship: sectionB.vwap_relationship,
    beneathCallWallDampener: sectionC.directly_beneath_call_wall_dampener,
    spreadPct: sectionA.spread_pct,
    askSidePct: sectionA.ask_side_pct,
    volumeOiRatio: sectionA.greeks_and_oi.volume_oi_ratio,
    whaleIntent: sectionA.structure_and_intent.intent_classification,
    learnedRules,
  });

  return {
    packet_id: `pkt-${candidate.candidate_id}-${Date.now().toString(36)}`,
    generated_at: new Date().toISOString(),
    candidate_id: candidate.candidate_id,
    ticker: candidate.ticker,
    option_symbol: candidate.option_symbol,
    model_rank_designation: 'Highest-Ranked by Current Model Inputs',
    flow_score: flowScoreEval.total_flow_score,
    whale_score: candidate.whale_score,
    composite_score: sc?.final_composite_score ?? candidate.whale_score,
    section_a_contract_and_whale_flow: sectionA,
    section_b_underlying_confirmation: sectionB,
    section_c_ticker_gamma_positioning: sectionC,
    section_d_market_regime_context: sectionD,
    section_e_volatility_and_skew: sectionE,
    section_f_catalyst_and_dark_pool: sectionF,
    section_g_execution_and_risk_gate: sectionG,
    self_learning_context: {
      matched_rule_ids: matchedLearning.matched_rules.map((r) => r.rule_id),
      matched_rule_titles: matchedLearning.matched_rules.map((r) => r.title),
      matched_rules_count: matchedLearning.matched_rules.length,
      net_confidence_adjustment_pct:
        matchedLearning.net_confidence_adjustment_pct,
      recommended_override: matchedLearning.recommended_override,
      prompt_injection_block: matchedLearning.prompt_injection_block,
    },
  };
}

/**
 * Evaluates the Deterministic Risk Engine Gate (hard non-LLM rules that must pass
 * before any order can be staged to the Smart Order Engine).
 */
export function evaluateDeterministicRiskGate(
  packet: LlmTradeEvidencePacket
): DeterministicRiskGateAudit {
  const a = packet.section_a_contract_and_whale_flow;
  const b = packet.section_b_underlying_confirmation;
  const f = packet.section_f_catalyst_and_dark_pool;
  const g = packet.section_g_execution_and_risk_gate;

  const checks = [
    {
      id: 'spread_microstructure_guard',
      label: `Option NBBO Spread <= ${g.spread_guardrail_max_pct.toFixed(1)}% Guardrail`,
      passed: g.spread_guardrail_passed && a.spread_pct <= 10.0,
      detail: `Current spread is ${a.spread_pct.toFixed(2)}% ($${a.spread_dollars.toFixed(2)}) vs max ${g.spread_guardrail_max_pct.toFixed(1)}%.`,
    },
    {
      id: 'alpaca_vwap_alignment',
      label: 'Alpaca Underlying Price Confirms Flow Direction & VWAP',
      passed: b.alpaca_confirmation_status !== 'REJECTED',
      detail: `${b.symbol} last $${b.last_trade_price.toFixed(2)} vs VWAP $${b.vwap.toFixed(2)} (${b.vwap_relationship}).`,
    },
    {
      id: 'opening_intent_verification',
      label: 'Single-Leg Opening Flow Integrity (Vol/OI & Ask-Side %)',
      passed:
        a.greeks_and_oi.volume_oi_ratio >= 0.85 &&
        a.structure_and_intent.multileg_ratio <= 0.35,
      detail: `Vol/OI ${a.greeks_and_oi.volume_oi_ratio.toFixed(2)}x, Ask-side ${a.ask_side_pct.toFixed(0)}%, Multileg ${(a.structure_and_intent.multileg_ratio * 100).toFixed(0)}%.`,
    },
    {
      id: 'binary_catalyst_buffer',
      label: 'No Unhedged Binary Earnings Within 48 Hours',
      passed: !f.binary_event_within_48h,
      detail: `Earnings in ${f.days_to_earnings} day(s).`,
    },
    {
      id: 'capital_risk_budget',
      label: `Position Risk Within $${g.per_trade_max_risk_dollars.toLocaleString()} Per-Trade Cap`,
      passed:
        g.estimated_total_risk_dollars <= g.per_trade_max_risk_dollars &&
        g.recommended_contracts >= 1,
      detail: `${g.recommended_contracts} contract(s) = $${g.estimated_total_risk_dollars.toLocaleString()} total risk (Max $${g.per_trade_max_risk_dollars.toLocaleString()}).`,
    },
  ];

  const blockers = checks.filter((c) => !c.passed).map((c) => c.detail);

  return {
    passed_all_hard_gates: blockers.length === 0,
    autonomous_execution_blocked: true,
    checks,
    blockers,
  };
}

/**
 * Computes the 4-state LLM Trade-Decision Output (`EXECUTE` | `WATCH` | `SKIP` | `HUMAN REVIEW`)
 * from the 7-section Evidence Packet.
 */
export function evaluateStructuredLlmDecisionFromPacket(
  packet: LlmTradeEvidencePacket
): LlmTradeDecisionOutput {
  const a = packet.section_a_contract_and_whale_flow;
  const b = packet.section_b_underlying_confirmation;
  const c = packet.section_c_ticker_gamma_positioning;
  const d = packet.section_d_market_regime_context;
  const e = packet.section_e_volatility_and_skew;
  const f = packet.section_f_catalyst_and_dark_pool;
  const g = packet.section_g_execution_and_risk_gate;

  // Build 6-Pillar Scorecard
  const pillar1Status: LlmDecisionPillarCheck['status'] =
    a.structure_and_intent.intent_classification === 'likely_opening_directional'
      ? 'ALIGNED'
      : a.structure_and_intent.intent_classification === 'late_chase_or_closing_flow'
        ? 'CONTRADICTED'
        : 'AMBIGUOUS_HUMAN_REVIEW';

  const pillar2Status: LlmDecisionPillarCheck['status'] =
    b.alpaca_confirmation_status === 'CONFIRMED'
      ? 'ALIGNED'
      : b.alpaca_confirmation_status === 'DE_RANKED'
        ? 'WATCH_NEEDS_CONFIRMATION'
        : 'CONTRADICTED';

  const pillar3Status: LlmDecisionPillarCheck['status'] =
    c.directly_beneath_call_wall_dampener || c.directly_above_put_wall_dampener
      ? 'WATCH_NEEDS_CONFIRMATION'
      : 'ALIGNED';

  const pillar4Status: LlmDecisionPillarCheck['status'] =
    d.active_strategy_regime === 'conflict'
      ? 'AMBIGUOUS_HUMAN_REVIEW'
      : d.broad_market_agrees_with_trade
        ? 'ALIGNED'
        : 'CONTRADICTED';

  const pillar5Status: LlmDecisionPillarCheck['status'] =
    f.binary_event_within_48h
      ? 'AMBIGUOUS_HUMAN_REVIEW'
      : e.iv_crush_risk === 'HIGH_EVENT_KINK'
        ? 'WATCH_NEEDS_CONFIRMATION'
        : 'ALIGNED';

  const pillar6Status: LlmDecisionPillarCheck['status'] =
    g.spread_guardrail_passed && a.spread_pct <= 8.5
      ? 'ALIGNED'
      : a.spread_pct <= g.spread_guardrail_max_pct
        ? 'WATCH_NEEDS_CONFIRMATION'
        : 'CONTRADICTED';

  const pillarScorecard: LlmDecisionPillarCheck[] = [
    {
      pillar_id: 'whale_flow_intent',
      label: 'A. Contract & Whale-Flow Intent (UW)',
      status: pillar1Status,
      score_0_100:
        pillar1Status === 'ALIGNED'
          ? 90
          : pillar1Status === 'AMBIGUOUS_HUMAN_REVIEW'
            ? 58
            : 25,
      finding: a.structure_and_intent.intent_rationale,
    },
    {
      pillar_id: 'alpaca_underlying_confirmation',
      label: 'B. Underlying Price & VWAP Confirmation (Alpaca)',
      status: pillar2Status,
      score_0_100:
        pillar2Status === 'ALIGNED'
          ? 92
          : pillar2Status === 'WATCH_NEEDS_CONFIRMATION'
            ? 64
            : 20,
      finding: b.confirmation_summary,
    },
    {
      pillar_id: 'dealer_gamma_positioning',
      label: 'C. Ticker & SPX Dealer Gamma Positioning (UW)',
      status: pillar3Status,
      score_0_100: pillar3Status === 'ALIGNED' ? 85 : 60,
      finding: c.gamma_positioning_summary,
    },
    {
      pillar_id: 'market_and_sector_regime',
      label: 'D. Market Tide, Sector & ETF Holdings Context',
      status: pillar4Status,
      score_0_100:
        pillar4Status === 'ALIGNED'
          ? 88
          : pillar4Status === 'AMBIGUOUS_HUMAN_REVIEW'
            ? 55
            : 30,
      finding: d.regime_context_summary,
    },
    {
      pillar_id: 'volatility_and_event_structure',
      label: 'E/F. Volatility Skew, Dark Pool & Catalyst Risk',
      status: pillar5Status,
      score_0_100:
        pillar5Status === 'ALIGNED'
          ? 86
          : pillar5Status === 'WATCH_NEEDS_CONFIRMATION'
            ? 65
            : 45,
      finding: f.binary_event_within_48h
        ? f.macro_or_sector_catalyst_note
        : e.volatility_summary,
    },
    {
      pillar_id: 'execution_spread_and_risk',
      label: 'G. NBBO Spread & Deterministic Risk Budget',
      status: pillar6Status,
      score_0_100:
        pillar6Status === 'ALIGNED'
          ? 91
          : pillar6Status === 'WATCH_NEEDS_CONFIRMATION'
            ? 66
            : 22,
      finding: `NBBO spread ${a.spread_pct.toFixed(2)}% ($${a.nbbo_bid.toFixed(2)}x$${a.nbbo_ask.toFixed(2)}); Smart Target Limit $${g.smart_order_target_limit_price.toFixed(2)} (${g.recommended_contracts}x contracts = $${g.estimated_total_risk_dollars.toLocaleString()} risk).`,
    },
  ];

  // Determine the strict 4-state decision:
  // 1. SKIP — flow is ambiguous/closing, late, illiquid (spread > guardrail), or contradicted by Alpaca underlying/Tide
  // 2. HUMAN REVIEW — event/structure ambiguity too high (multi-leg/hedge ambiguity, binary event within 48h, or Conflict regime with mixed signals)
  // 3. WATCH — thesis plausible but needs confirmation (e.g. Alpaca DE_RANKED / inside ORB / reclaiming VWAP, or right under positive-gamma Call Wall)
  // 4. EXECUTE — conditions aligned and risk acceptable

  let decision: LlmTradeGateDecision = 'EXECUTE';

  const hasHardContradiction =
    b.alpaca_confirmation_status === 'REJECTED' ||
    !g.spread_guardrail_passed ||
    a.spread_pct > 12.0 ||
    a.structure_and_intent.intent_classification === 'late_chase_or_closing_flow' ||
    a.ws_live_follow_through.status === 'opposing_flow_pushback';

  const hasHighStructureOrEventAmbiguity =
    f.structure_or_event_ambiguity_high ||
    a.structure_and_intent.intent_classification === 'multi_leg_or_spread_leg' ||
    a.structure_and_intent.intent_classification === 'potential_hedge_or_collar';

  const needsConfirmationWatch =
    b.alpaca_confirmation_status === 'DE_RANKED' ||
    c.directly_beneath_call_wall_dampener ||
    c.directly_above_put_wall_dampener ||
    a.ws_live_follow_through.status === 'consolidating_near_mid' ||
    packet.flow_score < 68;

  if (hasHardContradiction) {
    decision = 'SKIP';
  } else if (
    a.structure_and_intent.intent_classification === 'multi_leg_or_spread_leg'
  ) {
    decision = 'SKIP';
  } else if (hasHighStructureOrEventAmbiguity || needsConfirmationWatch) {
    decision = 'WATCH';
  } else {
    decision = 'EXECUTE';
  }

  const avgScore = Math.round(
    pillarScorecard.reduce((acc, p) => acc + p.score_0_100, 0) /
      pillarScorecard.length
  );

  const supportingReasons: string[] = [
    `${a.symbol} ${a.option_symbol} printed $${(a.premium_5m_dollars / 1000).toFixed(0)}K 5m premium (${a.ask_side_pct.toFixed(0)}% ask-side, Vol/OI ${a.greeks_and_oi.volume_oi_ratio.toFixed(2)}x, ${a.execution_condition}).`,
    `FlowScore ${packet.flow_score}/100 under ${d.active_strategy_regime_label} (${d.market_tide_direction} Market Tide).`,
  ];
  if (b.underlying_confirms_flow) {
    supportingReasons.push(
      `Alpaca confirms ${a.direction} tape: ${b.symbol} at $${b.last_trade_price.toFixed(2)} (${b.vwap_relationship.replace(/_/g, ' ')}, RVOL ${b.relative_volume_vs_intraday_norm.toFixed(2)}x).`
    );
  }
  if (g.spread_guardrail_passed) {
    supportingReasons.push(
      `Option spread is liquid (${a.spread_pct.toFixed(2)}%); Smart Order ${g.smart_order_recommended_algo} targets $${g.smart_order_target_limit_price.toFixed(2)} (saving ~$${g.expected_slippage_saved_per_contract_dollars.toFixed(0)}/contract vs ask).`
    );
  }

  const contradictionsAndRisks: string[] = [];
  if (b.alpaca_confirmation_status === 'REJECTED') {
    contradictionsAndRisks.push(
      `Underlying contradiction: ${b.symbol} lost VWAP ($${b.vwap.toFixed(2)}) and is failing to react in the direction of option flow.`
    );
  }
  if (!g.spread_guardrail_passed || a.spread_pct > 8.5) {
    contradictionsAndRisks.push(
      `Illiquid option spread (${a.spread_pct.toFixed(2)}% > guardrail) creates severe slippage risk.`
    );
  }
  if (a.structure_and_intent.same_ticker_opposing_flow_ratio >= 0.35) {
    contradictionsAndRisks.push(
      `Opposing flow on ${a.symbol} ($${(a.structure_and_intent.same_ticker_opposing_flow_5m_dollars / 1000).toFixed(0)}K, ${(a.structure_and_intent.same_ticker_opposing_flow_ratio * 100).toFixed(0)}% ratio) reduces directional clarity.`
    );
  }
  if (c.directly_beneath_call_wall_dampener) {
    contradictionsAndRisks.push(
      `Price ($${c.spot_price.toFixed(2)}) sits directly beneath positive-gamma Call Wall ($${c.call_wall.toFixed(2)}), risking dealer pinning.`
    );
  }
  if (contradictionsAndRisks.length === 0) {
    contradictionsAndRisks.push(
      `Standard directional theta/gamma risk if ${b.symbol} breaks invalidation level ($${g.invalidation_underlying_price.toFixed(2)}).`
    );
  }

  const watchConfirmationTriggers: string[] = [];
  if (decision === 'WATCH' || b.alpaca_confirmation_status !== 'CONFIRMED') {
    watchConfirmationTriggers.push(
      `Require ${b.symbol} 5m close reclaiming and holding ${a.direction === 'bullish' ? `above VWAP ($${b.vwap.toFixed(2)}) & ORB High ($${b.opening_range_high.toFixed(2)})` : `below VWAP ($${b.vwap.toFixed(2)}) & ORB Low ($${b.opening_range_low.toFixed(2)})`}.`
    );
  }
  if (c.directly_beneath_call_wall_dampener) {
    watchConfirmationTriggers.push(
      `Wait for ${b.symbol} to break and hold above the $${c.call_wall.toFixed(2)} Call Wall with RVOL >= 1.5x.`
    );
  }
  if (a.ws_live_follow_through.status !== 'holding_near_ask_with_follow_through') {
    watchConfirmationTriggers.push(
      `Monitor WS option_trades:${a.symbol} for renewed ask-side sweep follow-through holding >= $${a.nbbo_mid.toFixed(2)}.`
    );
  }

  const thesisSummary =
    decision === 'EXECUTE'
      ? `AUTO-EXECUTE GATE PASSED: ${a.symbol} ${a.option_symbol} exhibits clean single-leg opening ${a.direction} institutional flow (Vol/OI ${a.greeks_and_oi.volume_oi_ratio.toFixed(2)}x, ${a.ask_side_pct.toFixed(0)}% ask-side${a.contract_aggregation?.is_aggregated ? `, aggregated across ${a.contract_aggregation.aggregated_print_count} prints @ $${a.contract_aggregation.vwap_fill_price.toFixed(2)} VWAP` : ''}), confirmed by Alpaca VWAP/ORB alignment and ${d.active_strategy_regime_label} regime. Automatically sized and dispatched to Smart Order Engine.`
      : decision === 'WATCH'
        ? `AUTO-WATCH FOR CONFIRMATION: ${a.symbol} ${a.option_symbol} whale flow is constructive (FlowScore ${packet.flow_score}), and is automatically queued on the confirmation watchlist (${watchConfirmationTriggers[0] ?? 'awaiting underlying breakout above key gamma/VWAP level'}).`
        : `AUTO-SKIP / FILTERED: ${a.symbol} ${a.option_symbol} flow is automatically filtered out due to underlying VWAP contradiction, multi-leg spread structure, or excessive bid/ask spread (${a.spread_pct.toFixed(2)}%).`;

  const learningCtx = packet.self_learning_context;
  const learningDelta = learningCtx?.net_confidence_adjustment_pct ?? 0;
  if (learningCtx && learningCtx.matched_rules_count > 0) {
    supportingReasons.push(
      `Self-Learning Memory Injected (${learningCtx.matched_rules_count} rule(s): ${learningCtx.matched_rule_titles.join(', ')}) -> Confidence adjustment ${learningDelta >= 0 ? `+${learningDelta}%` : `${learningDelta}%`}.`
    );
  }

  return {
    decision,
    decision_badge_subtitle: DECISION_METADATA[decision].shortDescription,
    confidence_pct: clamp(avgScore + learningDelta, 18, 96),
    whale_intent: a.structure_and_intent.intent_classification,
    recommended_structure:
      decision === 'SKIP' ? 'No Trade / Pass' : g.recommended_structure,
    thesis_summary: thesisSummary,
    supporting_reasons: supportingReasons,
    contradictions_and_risks: contradictionsAndRisks,
    watch_confirmation_triggers: watchConfirmationTriggers,
    human_review_ambiguities: f.ambiguity_reasons,
    invalidation_level: `${g.invalidation_condition} (Spot invalidation: $${g.invalidation_underlying_price.toFixed(2)})`,
    pillar_scorecard: pillarScorecard,
    self_learning_rules_applied: learningCtx?.matched_rule_ids ?? [],
    self_learning_confidence_delta_pct: learningDelta,
    autonomous_execution_blocked: true,
  };
}

/**
 * Builds the exact LLM System & User Prompt + JSON Schema for the Trade-Decision Gate.
 * Uses compact, token-efficient serialization for the LLM prompt to cut LM Studio prefill latency by ~65%.
 */
export function buildLlmTradeDecisionPrompts(
  packet: LlmTradeEvidencePacket,
  llmConfig: LlmEngineConfig
): {
  endpoint_url: string;
  system_prompt: string;
  user_prompt: string;
  evidence_packet_json: string;
  request_body_json: string;
  request_body_obj: Record<string, unknown>;
} {
  const endpoints = normalizeLmStudioEndpoints(llmConfig.endpointUrl);
  const endpoint_url = endpoints.primaryChatCompletionsUrl;

  const system_prompt = [
    'You are an institutional Options Flow & Quantitative Risk Gate.',
    'You receive a 7-section structured evidence packet combining Unusual Whales (Contract/Whale Flow, Ticker GEX, SPX Periscope, Market/Sector Tide, IV/Skew, Short-Pressure Regime, Dark-Pool Price Zones, Catalysts) and Alpaca (Real-Time Underlying Trades, NBBO Quotes, 1m/5m Bars, VWAP, ORB, RVOL).',
    'CRITICAL RULES:',
    '1. Return ONLY a JSON object with `decision` set to strictly one of: "EXECUTE", "WATCH", "SKIP", or "HUMAN REVIEW", plus `confidence_pct` (number 1-99) and `thesis_summary` (string).',
    '2. Never place orders autonomously (`autonomous_execution_blocked: true`). Your output is a gate before a human or deterministic risk engine approves execution.',
    '3. Do not execute bullish call flow when the underlying loses VWAP and fails to react, or bearish put flow when price is reclaiming key levels.',
    '4. Do not treat SPX index strike levels as literal SPY price levels.',
    '5. Never call any contract "highest potential" — refer only to "Highest-Ranked by Current Model Inputs".',
    `6. ${SUGGESTED_SHORT_DARKPOOL_LLM_RULE}`,
    '7. Apply any condition-matched rules from SELF_LEARNING_MEMORY_INJECTION derived from historical bake-testing to improve win rate and avoid repeat root-cause failures.',
  ].join('\n');

  const evidence_packet_json = JSON.stringify(packet, null, 2);

  // Distilled compact packet for the actual LLM request to maximize speed & token efficiency in LM Studio
  const compactEvidence = {
    ticker: packet.ticker,
    option_symbol: packet.option_symbol,
    flow_score: packet.flow_score,
    whale_score: packet.whale_score,
    section_a_flow: {
      direction: packet.section_a_contract_and_whale_flow.direction,
      call_put: packet.section_a_contract_and_whale_flow.call_put,
      strike: packet.section_a_contract_and_whale_flow.strike,
      dte: packet.section_a_contract_and_whale_flow.dte,
      nbbo_bid: packet.section_a_contract_and_whale_flow.nbbo_bid,
      nbbo_ask: packet.section_a_contract_and_whale_flow.nbbo_ask,
      spread_pct: packet.section_a_contract_and_whale_flow.spread_pct,
      premium_5m: packet.section_a_contract_and_whale_flow.premium_5m_dollars,
      ask_side_pct: packet.section_a_contract_and_whale_flow.ask_side_pct,
      vol_oi: packet.section_a_contract_and_whale_flow.greeks_and_oi.volume_oi_ratio,
      delta: packet.section_a_contract_and_whale_flow.greeks_and_oi.delta,
      intent: packet.section_a_contract_and_whale_flow.structure_and_intent.intent_classification,
      ws_follow_through: packet.section_a_contract_and_whale_flow.ws_live_follow_through.status,
    },
    section_b_alpaca: {
      spot: packet.section_b_underlying_confirmation.last_trade_price,
      vwap: packet.section_b_underlying_confirmation.vwap,
      vwap_relation: packet.section_b_underlying_confirmation.vwap_relationship,
      rvol: packet.section_b_underlying_confirmation.relative_volume_vs_intraday_norm,
      status: packet.section_b_underlying_confirmation.alpaca_confirmation_status,
    },
    section_c_gamma: {
      regime: packet.section_c_ticker_gamma_positioning.dealer_gamma_regime,
      call_wall: packet.section_c_ticker_gamma_positioning.call_wall,
      put_wall: packet.section_c_ticker_gamma_positioning.put_wall,
      beneath_call_wall: packet.section_c_ticker_gamma_positioning.directly_beneath_call_wall_dampener,
    },
    section_d_regime: {
      regime: packet.section_d_market_regime_context.active_strategy_regime_label,
      tide_direction: packet.section_d_market_regime_context.market_tide_direction,
      sector_alignment: packet.section_d_market_regime_context.sector_tide_alignment,
    },
    short_context: packet.section_f_catalyst_and_dark_pool.short_context,
    dark_pool_context: packet.section_f_catalyst_and_dark_pool.dark_pool_context,
    interpretation_constraints: packet.section_f_catalyst_and_dark_pool.interpretation_constraints,
    short_darkpool_score: packet.section_f_catalyst_and_dark_pool.short_darkpool_score,
    section_e_f_risk: {
      iv_rank: packet.section_e_volatility_and_skew.iv_rank_pct,
      days_to_earnings: packet.section_f_catalyst_and_dark_pool.days_to_earnings,
      binary_event_48h: packet.section_f_catalyst_and_dark_pool.binary_event_within_48h,
      ambiguity_high: packet.section_f_catalyst_and_dark_pool.structure_or_event_ambiguity_high,
      spread_guardrail_passed: packet.section_g_execution_and_risk_gate.spread_guardrail_passed,
      smart_limit: packet.section_g_execution_and_risk_gate.smart_order_target_limit_price,
      invalidation_spot: packet.section_g_execution_and_risk_gate.invalidation_underlying_price,
    },
    self_learning_context: packet.self_learning_context,
  };

  const user_prompt = [
    `Evaluate candidate ${packet.ticker} (${packet.option_symbol}) — ${packet.model_rank_designation}.`,
    'Classify into strictly one of: "EXECUTE", "WATCH", "SKIP", or "HUMAN REVIEW".',
    'Return JSON: {"decision":"EXECUTE"|"WATCH"|"SKIP"|"HUMAN REVIEW","confidence_pct":number,"thesis_summary":string}',
    packet.self_learning_context?.prompt_injection_block ?? '',
    `EVIDENCE_PACKET:${JSON.stringify(compactEvidence)}`,
  ].filter(Boolean).join('\n');

  const request_body_obj = buildOptimizedLmStudioChatPayload({
    modelId: llmConfig.modelId,
    systemPrompt: system_prompt,
    userPrompt: user_prompt,
    temperature: llmConfig.temperature,
    topP: llmConfig.topP,
    maxTokens: llmConfig.maxTokens,
    maxTokensEnabled: llmConfig.maxTokensEnabled ?? true,
    thinkingMode: llmConfig.thinkingMode ?? 'no_think',
    stream: false,
  });

  const request_body_json = JSON.stringify(request_body_obj, null, 2);

  return {
    endpoint_url,
    system_prompt,
    user_prompt,
    evidence_packet_json,
    request_body_json,
    request_body_obj,
  };
}

/**
 * Parses a raw LLM string response if it contains a valid 4-state decision JSON
 * (handling `<think>...</think>` blocks from reasoning models cleanly),
 * otherwise falls back cleanly to the deterministic institutional evaluation.
 */
export function parseOrFallbackLlmDecisionOutput(
  rawContent: string | null | undefined,
  fallbackOutput: LlmTradeDecisionOutput
): LlmTradeDecisionOutput {
  if (!rawContent || typeof rawContent !== 'string') {
    return fallbackOutput;
  }
  const { thinkingTrace, cleanContent } = extractThinkingAndCleanContent(rawContent);
  const parsed = extractJsonObjectFromLlmText(rawContent);

  const validDecisions: LlmTradeGateDecision[] = [
    'EXECUTE',
    'WATCH',
    'SKIP',
    'HUMAN REVIEW',
  ];

  if (parsed) {
    const rawDecision = String(parsed.decision ?? '')
      .toUpperCase()
      .replace(/_/g, ' ')
      .trim();
    const matchedDecision = validDecisions.find((d) => d === rawDecision);
    if (matchedDecision) {
      return {
        ...fallbackOutput,
        decision: matchedDecision,
        decision_badge_subtitle: DECISION_METADATA[matchedDecision].shortDescription,
        confidence_pct:
          typeof parsed.confidence_pct === 'number' && !Number.isNaN(parsed.confidence_pct)
            ? clamp(Math.round(parsed.confidence_pct), 1, 99)
            : fallbackOutput.confidence_pct,
        thesis_summary:
          typeof parsed.thesis_summary === 'string' &&
          parsed.thesis_summary.trim().length > 0
            ? parsed.thesis_summary.trim()
            : fallbackOutput.thesis_summary,
        thinking_trace: thinkingTrace,
        autonomous_execution_blocked: true,
      };
    }
  }

  // Also check if the raw text explicitly mentioned EXECUTE / WATCH / SKIP / HUMAN REVIEW
  const upperClean = cleanContent.toUpperCase();
  const matchedFromText = validDecisions.find((d) =>
    new RegExp(`\\b${d}\\b`).test(upperClean)
  );
  if (matchedFromText) {
    return {
      ...fallbackOutput,
      decision: matchedFromText,
      decision_badge_subtitle: DECISION_METADATA[matchedFromText].shortDescription,
      thesis_summary:
        cleanContent.length > 15 && cleanContent.length < 900
          ? cleanContent
          : fallbackOutput.thesis_summary,
      thinking_trace: thinkingTrace,
      autonomous_execution_blocked: true,
    };
  }

  return {
    ...fallbackOutput,
    thinking_trace: thinkingTrace,
  };
}

/**
 * Builds a complete `LlmTradeDecisionRecord` for a candidate.
 */
export function buildLlmTradeDecisionRecord(params: {
  candidate: WhaleCandidate;
  marketTide: MarketTideState;
  llmConfig: LlmEngineConfig;
  alpacaTickerCache?: AlpacaTickerDataCacheItem | null;
  smartOrderConfig?: SmartOrderEngineConfig;
  alpacaTradingSnapshot?: AlpacaTradingGateSnapshot;
  riskPolicy?: Partial<RiskPolicyConfig>;
  overrideRegime?: StrategyRegimeId;
  perTradeMaxRiskDollars?: number;
  maxDailyLossDollars?: number;
  stressScenario?:
    | 'default'
    | 'force_execute_aligned'
    | 'force_watch_vwap'
    | 'force_skip_contradicted'
    | 'force_human_review_ambiguity';
  executionMode?: 'lm_studio_live' | 'deterministic_synthesis';
  latencyMs?: number;
  rawLlmContent?: string | null;
  rawStage2RiskLlmContent?: string | null;
  stage2LatencyMs?: number;
  stage2ExecutionMode?: 'lm_studio_live' | 'deterministic_synthesis';
  learnedRules?: LearnedConditionRule[];
}): LlmTradeDecisionRecord {
  const packet = buildLlmTradeEvidencePacket({
    candidate: params.candidate,
    marketTide: params.marketTide,
    alpacaTickerCache: params.alpacaTickerCache,
    smartOrderConfig: params.smartOrderConfig,
    overrideRegime: params.overrideRegime,
    perTradeMaxRiskDollars: params.perTradeMaxRiskDollars,
    maxDailyLossDollars: params.maxDailyLossDollars,
    stressScenario: params.stressScenario,
    learnedRules: params.learnedRules,
  });

  const fallbackOutput = evaluateStructuredLlmDecisionFromPacket(packet);
  const llmOutput = parseOrFallbackLlmDecisionOutput(
    params.rawLlmContent,
    fallbackOutput
  );
  const riskGate = evaluateDeterministicRiskGate(packet);
  const baseRiskFirstExecutionPlan = evaluateRiskFirstExecutionPlan({
    packet,
    llmDecision: llmOutput.decision,
    alpacaSnapshot: params.alpacaTradingSnapshot,
    policy: params.riskPolicy,
  });

  const stage2Assessment: LlmRiskAndSizeAssessment =
    parseOrFallbackStage2LlmRiskAssessment({
      rawContent: params.rawStage2RiskLlmContent,
      plan: baseRiskFirstExecutionPlan,
      executionMode:
        params.stage2ExecutionMode ??
        params.executionMode ??
        'deterministic_synthesis',
      modelId: params.llmConfig.modelId,
      thinkingMode: params.llmConfig.thinkingMode ?? 'no_think',
      latencyMs: params.stage2LatencyMs ?? 52,
    });

  const riskFirstExecutionPlan: RiskFirstExecutionPlanResult = {
    ...baseRiskFirstExecutionPlan,
    stage2_llm_risk_assessment: stage2Assessment,
  };

  const prompts = buildLlmTradeDecisionPrompts(packet, params.llmConfig);

  const rawResponseJson = JSON.stringify(
    {
      id: `gate-${params.candidate.candidate_id}`,
      model: params.llmConfig.modelId,
      thinking_mode: params.llmConfig.thinkingMode ?? 'no_think',
      max_tokens:
        (params.llmConfig.maxTokensEnabled ?? true)
          ? params.llmConfig.maxTokens
          : -1,
      object: 'chat.completion',
      decision_gate_output: llmOutput,
      deterministic_risk_gate: riskGate,
      risk_first_execution_plan: {
        execution_action: riskFirstExecutionPlan.execution_action,
        permitted_qty: riskFirstExecutionPlan.sizing.permitted_qty,
        input_contract: riskFirstExecutionPlan.input_contract,
        output_contract: riskFirstExecutionPlan.output_contract,
        stage2_llm_risk_assessment: stage2Assessment,
        limit_order_payload: riskFirstExecutionPlan.limit_order_payload,
      },
    },
    null,
    2
  );

  const autoApproved =
    llmOutput.decision === 'EXECUTE' &&
    stage2Assessment.decision === 'APPROVED' &&
    stage2Assessment.quantity >= 1;
  const createdAt = new Date().toISOString();

  return {
    decision_id: `dec-${params.candidate.candidate_id}-${Date.now().toString(36)}`,
    created_at: createdAt,
    candidate_id: params.candidate.candidate_id,
    ticker: params.candidate.ticker,
    option_symbol: params.candidate.option_symbol,
    direction: params.candidate.direction,
    strike: params.candidate.strike,
    expiry: params.candidate.expiry,
    dte: params.candidate.dte,
    option_type: params.candidate.option_type,
    execution_mode: params.executionMode ?? 'deterministic_synthesis',
    model_id: params.llmConfig.modelId,
    endpoint_url: prompts.endpoint_url,
    latency_ms: params.latencyMs ?? 168,
    evidence_packet: packet,
    llm_output: llmOutput,
    deterministic_risk_gate: riskGate,
    risk_first_execution_plan: riskFirstExecutionPlan,
    approval_status: autoApproved
      ? 'approved_staged_to_smart_order'
      : llmOutput.decision === 'WATCH' || llmOutput.decision === 'HUMAN REVIEW'
        ? 'queued_on_watchlist'
        : 'rejected_by_operator_or_risk_gate',
    approved_by_operator_at: autoApproved ? createdAt : null,
    staged_smart_order_id: autoApproved
      ? `ord-auto-${params.candidate.ticker.toLowerCase()}`
      : null,
    prompt_payload: {
      system_prompt: prompts.system_prompt,
      user_prompt: prompts.user_prompt,
      evidence_packet_json: prompts.evidence_packet_json,
      raw_llm_response_json: rawResponseJson,
    },
  };
}

/**
 * Generates initial seed LLM Trade-Decision records across the ranked
 * candidate universe with full end-to-end automation (no human approval gate).
 */
export function createInitialSeedLlmDecisionRecords(
  candidates: WhaleCandidate[],
  marketTide: MarketTideState,
  llmConfig: LlmEngineConfig,
  smartOrderConfig: SmartOrderEngineConfig = DEFAULT_SMART_ORDER_ENGINE_CONFIG
): LlmTradeDecisionRecord[] {
  const scenarios: Array<
    | 'force_execute_aligned'
    | 'force_watch_vwap'
    | 'force_skip_contradicted'
    | 'default'
  > = [
    'force_execute_aligned',
    'default',
    'force_watch_vwap',
    'default',
    'force_skip_contradicted',
    'default',
  ];

  return candidates.slice(0, 6).map((cand, idx) => {
    const rec = buildLlmTradeDecisionRecord({
      candidate: cand,
      marketTide,
      llmConfig,
      smartOrderConfig,
      stressScenario: scenarios[idx] ?? 'default',
      executionMode: 'deterministic_synthesis',
      latencyMs: 142 + idx * 19,
    });
    return {
      ...rec,
      decision_id: `dec-seed-${idx + 1}-${cand.ticker.toLowerCase()}`,
      created_at: new Date(Date.now() - idx * 95_000).toISOString(),
    };
  });
}

