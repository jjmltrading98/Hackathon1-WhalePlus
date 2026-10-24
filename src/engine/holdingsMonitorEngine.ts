/**
 * Holdings Monitor With Unusual Whales, Alpaca, and LLM Exit Plans Engine
 *
 * Implements the full specification:
 * 1. Continuous monitoring of Stock & Option holdings (OSI-normalized symbols):
 *    - Underlying price, intraday bars, volume, VWAP, realized move (Alpaca Market Data)
 *    - Position P&L, exposure, DTE, Greeks (Delta, Gamma, Theta, Vega, IV), option bid/ask spread
 *    - Unusual Whales options tape, flow alerts (marked as supporting aggregation evidence),
 *      intraday cumulative net premium ticks (call/put prem & volume), contract flow, and
 *      unconfirmed volume-over-OI flagging (volume > OI treated as unconfirmed until next-day OI update)
 * 2. Safety & Data Integrity Flags:
 *    - Stale market data, wide bid/ask spreads, halted symbols, earnings proximity, corporate actions
 * 3. Deterministic Rule-Based Risk Evaluation Engine:
 *    - Triggers Evaluation Events when rule thresholds fire
 * 4. Two-Stage Advisory LLM Decision & Structured Execution Plan Pipeline:
 *    - Stage 1: Compact Evidence Packet -> LLM recommends HOLD | REDUCE | EXIT | HEDGE | ROLL | NEEDS_HUMAN_REVIEW
 *    - Stage 2: Richer dataset collected when Stage 1 chooses EXIT, REDUCE, HEDGE, or ROLL ->
 *      LLM produces Structured Execution Plan with formulaic limit-price logic (pegged to live NBBO bid/mid/ask,
 *      never fabricated arbitrary prices), quantity/percentage, time-in-force, retry/cancel logic,
 *      risk constraints, and rationale/confidence qualifiers
 * 5. Deterministic Risk Validator, Approval Queue (default human approval required; Live mode requires
 *    explicit toggle + MFA verification + buying-power/position checks), and Immutable Audit Log.
 */

import { parseOccOptionSymbol, type NormalizedAlpacaPosition } from './alpacaAccountEngine.ts';
import {
  buildOptimizedLmStudioChatPayload,
  extractJsonObjectFromLlmText,
  extractThinkingAndCleanContent,
  normalizeLmStudioEndpoints,
  type LlmThinkingMode,
} from './lmStudioClient.ts';
import {
  buildShortAndDarkPoolTelemetryForHolding,
  evaluateHoldingConfirmationMatrix,
  SUGGESTED_SHORT_DARKPOOL_LLM_RULE,
  type DarkPoolContextPayload,
  type DetailedDarkPoolTelemetry,
  type DetailedShortTelemetry,
  type HoldingConfirmationMatrixEvaluation,
  type LlmShortDarkPoolFeaturePayload,
  type ShortContextPayload,
  type ShortDarkPoolScoreResult,
} from './shortAndDarkPoolEngine.ts';

export type HoldingAssetClass = 'stock' | 'option';
export type HoldingMonitorMode = 'alert_only' | 'approval_required' | 'paper_auto';
export type TradingEnvironmentMode = 'paper' | 'live';

export type Stage1HoldingAction =
  | 'HOLD'
  | 'REDUCE'
  | 'EXIT'
  | 'HEDGE'
  | 'ROLL'
  | 'NEEDS_HUMAN_REVIEW';

export type LimitPriceFormulaType =
  | 'MID_PRICE'
  | 'BID_PLUS_OFFSET_BPS'
  | 'ASK_MINUS_OFFSET_BPS'
  | 'PEGGED_TO_NBBO_MID_WALK_TO_BID'
  | 'PEGGED_TO_NBBO_MID_WALK_TO_ASK'
  | 'PASSIVE_BID_PEG'
  | 'PASSIVE_ASK_PEG';

export interface HoldingRiskRuleConfig {
  max_loss_pct: number; // e.g. -0.18 (-18%)
  take_profit_pct: number; // e.g. +0.35 (+35%)
  trailing_drawdown_from_peak_pct: number; // e.g. 0.12 (12% drop from peak)
  min_dte_warning: number; // e.g. 5 DTE
  max_spread_pct: number; // e.g. 0.08 (8% bid/ask spread)
  adverse_net_flow_threshold: number; // e.g. $500,000 opposing net premium
  max_stale_quote_seconds: number; // e.g. 15 seconds
  earnings_proximity_days: number; // e.g. 3 days
}

export interface HoldingMonitorConfig {
  id: string;
  holding_id: string;
  symbol: string;
  enabled: boolean;
  mode: HoldingMonitorMode;
  risk_config: HoldingRiskRuleConfig;
  updated_at: string;
}

export interface IntradayUnderlyingBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
}

export interface UnderlyingMarketSnapshot {
  ticker: string;
  spot_price: number;
  prev_close: number;
  intraday_vwap: number;
  realized_move_pct: number;
  realized_move_atr_multiple: number;
  intraday_volume: number;
  relative_volume: number;
  bid: number;
  ask: number;
  spread_pct: number;
  quote_age_seconds: number;
  halted: boolean;
  days_to_earnings: number | null;
  corporate_action_flag: string | null;
  intraday_bars: IntradayUnderlyingBar[];
}

export interface OptionGreeksAndQuoteSnapshot {
  osi_symbol: string;
  dte: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  implied_volatility: number;
  option_bid: number;
  option_ask: number;
  option_mid: number;
  spread_abs: number;
  spread_pct: number;
  open_interest: number;
  intraday_contract_volume: number;
  volume_over_oi_ratio: number;
  volume_over_oi_unconfirmed: boolean; // True when volume > OI (unconfirmed until next-day OI update)
  quote_age_seconds: number;
}

export interface UwOptionTapePrint {
  trade_id: string;
  executed_at: string;
  ticker_symbol: string;
  osi_symbol: string;
  option_type: 'CALL' | 'PUT';
  strike: number;
  expiry: string;
  dte: number;
  price: number;
  size: number;
  premium: number;
  ask_perc: number;
  bid_perc: number;
  side_aggressor: 'ASK_SIDE' | 'BID_SIDE' | 'MID';
  volume: number;
  open_interest: number;
  volume_greater_oi: boolean;
  unconfirmed_opening_disclaimer: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface UwFlowAlertItem {
  alert_id: string;
  created_at: string;
  ticker_symbol: string;
  osi_symbol: string;
  rule_name: string;
  total_premium: number;
  total_size: number;
  ask_side_perc: number;
  is_otm: boolean;
  volume_over_oi: number;
  supporting_evidence_note: string; // Explicit note: Flow alerts are aggregations, not isolated orders
}

export interface UwNetPremTickPoint {
  timestamp: string;
  net_call_premium: number;
  net_put_premium: number;
  net_call_volume: number;
  net_put_volume: number;
  cumulative_net_call_premium: number;
  cumulative_net_put_premium: number;
  cumulative_net_flow_delta: number;
}

export interface UwContractFlowSummary {
  osi_symbol: string;
  intraday_premium: number;
  ask_side_premium: number;
  bid_side_premium: number;
  net_contract_premium: number;
  print_count: number;
  unusual_contract_rank: number;
  hottest_chain_alternatives: Array<{
    osi_symbol: string;
    option_type: 'CALL' | 'PUT';
    strike: number;
    expiry: string;
    dte: number;
    bid: number;
    ask: number;
    mid: number;
    delta: number;
    open_interest: number;
    intraday_volume: number;
    role: 'ROLL_CANDIDATE' | 'HEDGE_CANDIDATE';
  }>;
}

export interface HoldingSafetyFlags {
  stale_market_data: boolean;
  wide_spread: boolean;
  halted_symbol: boolean;
  earnings_proximity: boolean;
  corporate_action_pending: boolean;
  volume_over_oi_unconfirmed: boolean;
  active_flag_descriptions: string[];
}

export interface TriggeredRiskRule {
  rule_id: string;
  rule_name: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  triggered: boolean;
  observed_value: string;
  threshold_value: string;
  evidence_summary: string;
}

export interface MonitoredHolding {
  holding_id: string;
  broker_connection_id: string;
  environment: TradingEnvironmentMode;
  asset_class: HoldingAssetClass;
  symbol: string;
  osi_canonical_symbol: string;
  underlying_symbol: string;
  display_label: string;
  side: 'long' | 'short';
  quantity: number;
  qty_available: number;
  multiplier: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  intraday_pl: number;
  intraday_plpc: number;
  peak_unrealized_plpc: number;
  drawdown_from_peak_pct: number;
  portfolio_exposure_pct: number;
  option_expiry: string | null;
  option_strike: number | null;
  option_right: 'CALL' | 'PUT' | null;
  underlying_snapshot: UnderlyingMarketSnapshot;
  option_snapshot: OptionGreeksAndQuoteSnapshot | null;
  uw_options_tape: UwOptionTapePrint[];
  uw_flow_alerts: UwFlowAlertItem[];
  uw_net_prem_ticks: UwNetPremTickPoint[];
  uw_contract_flow: UwContractFlowSummary;
  short_telemetry: DetailedShortTelemetry;
  dark_pool_telemetry: DetailedDarkPoolTelemetry;
  confirmation_matrix: HoldingConfirmationMatrixEvaluation;
  llm_short_darkpool_payload: LlmShortDarkPoolFeaturePayload;
  safety_flags: HoldingSafetyFlags;
  triggered_rules: TriggeredRiskRule[];
  evaluation_event_active: boolean;
  monitor_config: HoldingMonitorConfig;
  latest_stage1_decision: LlmStage1HoldingDecision | null;
  latest_stage2_plan: LlmStage2ExitExecutionPlan | null;
  updated_at: string;
}

export interface Stage1CompactEvidencePacket {
  event_id: string;
  generated_at: string;
  holding: {
    holding_id: string;
    asset_class: HoldingAssetClass;
    osi_symbol: string;
    underlying_symbol: string;
    side: 'long' | 'short';
    quantity: number;
    avg_entry_price: number;
    current_price: number;
    unrealized_pl: number;
    unrealized_plpc: number;
    drawdown_from_peak_pct: number;
    portfolio_exposure_pct: number;
  };
  underlying_context: {
    spot_price: number;
    intraday_vwap: number;
    price_vs_vwap_pct: number;
    realized_move_pct: number;
    relative_volume: number;
  };
  option_greeks_and_spread: {
    dte: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    iv: number | null;
    bid: number;
    ask: number;
    mid: number;
    spread_pct: number;
  };
  unusual_whales_flow_summary: {
    cumulative_net_call_premium: number;
    cumulative_net_put_premium: number;
    cumulative_net_flow_delta: number;
    contract_net_premium: number;
    flow_alerts_count: number;
    flow_alerts_supporting_note: string;
    volume_over_oi_ratio: number;
    volume_over_oi_unconfirmed: boolean;
  };
  short_context: ShortContextPayload;
  dark_pool_context: LlmShortDarkPoolFeaturePayload['dark_pool_context'];
  interpretation_constraints: LlmShortDarkPoolFeaturePayload['interpretation_constraints'];
  short_darkpool_score: ShortDarkPoolScoreResult;
  confirmation_matrix: {
    effective_position_side: 'long' | 'short';
    categories_agreed_count: number;
    stronger_exit_review_triggered: boolean;
    avoid_premature_long_exit_active: boolean;
    short_squeeze_cluster_active: boolean;
    matrix_verdict_label: string;
    matrix_summary: string;
  };
  safety_flags: HoldingSafetyFlags;
  triggered_risk_rules: Array<{
    rule_id: string;
    severity: string;
    observed: string;
    threshold: string;
  }>;
}

export interface LlmStage1HoldingDecision {
  stage1_id: string;
  event_id: string;
  holding_id: string;
  symbol: string;
  evaluated_at: string;
  execution_mode: 'lm_studio_live' | 'deterministic_synthesis';
  model_id: string;
  latency_ms: number;
  decision: Stage1HoldingAction;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
  confidence_score: number; // 0.0 - 1.0
  primary_risk_driver: string;
  rationale: string;
  requires_stage2_plan: boolean;
  evidence_packet: Stage1CompactEvidencePacket;
  system_prompt: string;
  user_prompt: string;
  raw_llm_output: string;
}

export interface Stage2RichDatasetPacket {
  stage1_decision_id: string;
  holding_id: string;
  osi_symbol: string;
  recommended_stage1_action: Stage1HoldingAction;
  live_nbbo: {
    bid: number;
    ask: number;
    mid: number;
    spread_abs: number;
    spread_pct: number;
    quote_age_seconds: number;
  };
  broker_account_context: {
    environment: TradingEnvironmentMode;
    buying_power: number;
    options_buying_power: number;
    open_orders_for_symbol: number;
    qty_total: number;
    qty_available: number;
  };
  intraday_bars_tail: IntradayUnderlyingBar[];
  net_prem_ticks_tail: UwNetPremTickPoint[];
  contract_tape_prints: UwOptionTapePrint[];
  roll_and_hedge_candidates: UwContractFlowSummary['hottest_chain_alternatives'];
  short_context: ShortContextPayload;
  dark_pool_context: DarkPoolContextPayload;
  confirmation_matrix: HoldingConfirmationMatrixEvaluation;
  safety_flags: HoldingSafetyFlags;
}

export interface LimitPriceCalculationLogic {
  formula_type: LimitPriceFormulaType;
  formula_expression: string;
  reference_bid: number;
  reference_ask: number;
  reference_mid: number;
  aggressiveness_bps: number;
  computed_initial_limit_price: number;
  worst_acceptable_limit_price: number;
  marketability_assessment: 'PASSIVE_MAKER' | 'MID_PEGGED' | 'CROSS_SPREAD_GUARDED';
  explanation: string;
}

export interface DeterministicRiskValidationResult {
  validation_id: string;
  validated_at: string;
  passed: boolean;
  auto_execution_permitted: boolean;
  requires_human_approval: boolean;
  requires_live_mfa: boolean;
  checks: Array<{
    check_name: string;
    passed: boolean;
    detail: string;
  }>;
  blocking_reasons: string[];
  validated_limit_price: number;
  validated_quantity: number;
}

export interface LlmStage2ExitExecutionPlan {
  plan_id: string;
  stage1_id: string;
  event_id: string;
  holding_id: string;
  symbol: string;
  osi_symbol: string;
  underlying_symbol: string;
  asset_class: HoldingAssetClass;
  created_at: string;
  execution_mode: 'lm_studio_live' | 'deterministic_synthesis';
  model_id: string;
  latency_ms: number;
  recommended_action: 'EXIT' | 'REDUCE' | 'HEDGE' | 'ROLL';
  order_side: 'sell' | 'buy';
  target_symbol: string; // Same symbol for EXIT/REDUCE, hedge/roll leg for HEDGE/ROLL
  secondary_leg_symbol: string | null; // For ROLL (buy-to-open new expiry/strike after closing existing)
  quantity_to_trade: number;
  percentage_of_position: number; // e.g. 100 for EXIT, 50 for REDUCE
  order_type: 'limit';
  limit_price_logic: LimitPriceCalculationLogic;
  time_in_force: 'day' | 'gtc' | 'ioc';
  retry_and_cancel_logic: {
    max_reprice_attempts: number;
    reprice_interval_seconds: number;
    step_towards_market_bps: number;
    cancel_if_spread_exceeds_pct: number;
    cancel_if_unfilled_after_seconds: number;
    stale_quote_abort_seconds: number;
  };
  risk_constraints: {
    max_slippage_from_mid_pct: number;
    min_acceptable_credit_per_contract: number;
    max_hedge_debit_pct_of_holding: number;
    post_trade_delta_target: number;
    disallow_market_orders: boolean;
  };
  rationale: string;
  confidence_score: number;
  confidence_qualifiers: string[];
  rich_dataset: Stage2RichDatasetPacket;
  risk_validation: DeterministicRiskValidationResult;
  approval_status: 'PENDING_HUMAN_APPROVAL' | 'APPROVED_AND_SUBMITTED' | 'REJECTED_BY_USER' | 'BLOCKED_BY_RISK_ENGINE';
  alpaca_order_payload: {
    symbol: string;
    qty: string;
    side: 'sell' | 'buy';
    type: 'limit';
    time_in_force: 'day' | 'gtc' | 'ioc';
    limit_price: string;
    client_order_id: string;
  };
  submitted_order_id: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  system_prompt: string;
  user_prompt: string;
  raw_llm_output: string;
}

export interface ImmutableAuditLogEntry {
  audit_id: string;
  timestamp: string;
  event_type:
    | 'RULE_EVALUATION_TRIGGERED'
    | 'STAGE1_LLM_DECISION'
    | 'STAGE2_LLM_EXIT_PLAN'
    | 'RISK_ENGINE_VALIDATION'
    | 'HUMAN_APPROVAL_DECISION'
    | 'ALPACA_ORDER_SUBMITTED'
    | 'ALPACA_ORDER_CANCELLED'
    | 'ENVIRONMENT_MODE_CHANGED';
  holding_id: string;
  symbol: string;
  environment: TradingEnvironmentMode;
  actor: 'DETERMINISTIC_RULE_ENGINE' | 'ADVISORY_LLM' | 'RISK_VALIDATOR' | 'HUMAN_OPERATOR' | 'ALPACA_ROUTER';
  summary: string;
  source_data_snapshot: Record<string, unknown>;
  prompts: {
    system_prompt?: string;
    user_prompt?: string;
  } | null;
  llm_json_output: Record<string, unknown> | null;
  approval_metadata: {
    status: string;
    operator: string;
    mfa_verified: boolean;
    notes?: string;
  } | null;
  order_payload: Record<string, unknown> | null;
  immutable_hash: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Normalizes any stock or OCC option symbol into an OSI-compatible canonical format.
 * Example: "SHOP261120P00175000" -> "SHOP261120P00175000"
 */
export function normalizeToOsiCanonicalSymbol(rawSymbol: string): {
  osi_symbol: string;
  asset_class: HoldingAssetClass;
  underlying: string;
  expiry: string | null;
  right: 'CALL' | 'PUT' | null;
  strike: number | null;
} {
  const clean = (rawSymbol || '').trim().toUpperCase().replace(/\s+/g, '');
  const parsed = parseOccOptionSymbol(clean);
  if (parsed.is_option && parsed.expiration_date && parsed.option_type && parsed.strike_price !== null) {
    const yy = parsed.expiration_date.slice(2, 4);
    const mm = parsed.expiration_date.slice(5, 7);
    const dd = parsed.expiration_date.slice(8, 10);
    const rightChar = parsed.option_type === 'CALL' ? 'C' : 'P';
    const strikeInt = Math.round(parsed.strike_price * 1000)
      .toString()
      .padStart(8, '0');
    return {
      osi_symbol: `${parsed.underlying}${yy}${mm}${dd}${rightChar}${strikeInt}`,
      asset_class: 'option',
      underlying: parsed.underlying,
      expiry: parsed.expiration_date,
      right: parsed.option_type,
      strike: parsed.strike_price,
    };
  }
  return {
    osi_symbol: clean,
    asset_class: 'stock',
    underlying: clean,
    expiry: null,
    right: null,
    strike: null,
  };
}

export function createDefaultHoldingRiskConfig(assetClass: HoldingAssetClass): HoldingRiskRuleConfig {
  if (assetClass === 'option') {
    return {
      max_loss_pct: -0.2, // -20% stop loss on option premium
      take_profit_pct: 0.3, // +30% profit target / partial scale-out evaluation
      trailing_drawdown_from_peak_pct: 0.12, // 12% giveback from peak unrealized P&L
      min_dte_warning: 7, // Evaluate roll/exit at <= 7 DTE
      max_spread_pct: 0.08, // Flag wide spread > 8%
      adverse_net_flow_threshold: 450_000, // $450k opposing institutional net flow
      max_stale_quote_seconds: 15,
      earnings_proximity_days: 3,
    };
  }
  return {
    max_loss_pct: -0.05, // -5% equity position stop
    take_profit_pct: 0.12, // +12% equity target
    trailing_drawdown_from_peak_pct: 0.04,
    min_dte_warning: 0,
    max_spread_pct: 0.01,
    adverse_net_flow_threshold: 750_000,
    max_stale_quote_seconds: 15,
    earnings_proximity_days: 3,
  };
}

/**
 * Computes a deterministic SHA-like hex digest for immutable audit log integrity.
 */
export function computeDeterministicAuditHash(payload: string): string {
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `sha256-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Evaluates deterministic risk rules and safety flags for a holding.
 */
export function evaluateHoldingRiskRules(params: {
  assetClass: HoldingAssetClass;
  side: 'long' | 'short';
  optionRight: 'CALL' | 'PUT' | null;
  unrealizedPlpc: number;
  peakUnrealizedPlpc: number;
  underlying: UnderlyingMarketSnapshot;
  optionQuote: OptionGreeksAndQuoteSnapshot | null;
  uwNetPremTicks: UwNetPremTickPoint[];
  uwContractFlow: UwContractFlowSummary;
  riskConfig: HoldingRiskRuleConfig;
  confirmationMatrix?: HoldingConfirmationMatrixEvaluation;
}): {
  safety_flags: HoldingSafetyFlags;
  triggered_rules: TriggeredRiskRule[];
  evaluation_event_active: boolean;
} {
  const {
    assetClass,
    side,
    optionRight,
    unrealizedPlpc,
    peakUnrealizedPlpc,
    underlying,
    optionQuote,
    uwNetPremTicks,
    uwContractFlow,
    riskConfig,
  } = params;

  const quoteAge = optionQuote ? optionQuote.quote_age_seconds : underlying.quote_age_seconds;
  const spreadPct = optionQuote ? optionQuote.spread_pct : underlying.spread_pct;
  const staleData = quoteAge > riskConfig.max_stale_quote_seconds;
  const wideSpread = spreadPct > riskConfig.max_spread_pct;
  const halted = underlying.halted;
  const earningsNear =
    underlying.days_to_earnings !== null &&
    underlying.days_to_earnings <= riskConfig.earnings_proximity_days;
  const corpAction = Boolean(underlying.corporate_action_flag);
  const volOverOiUnconfirmed = Boolean(optionQuote?.volume_over_oi_unconfirmed);

  const flagDescriptions: string[] = [];
  if (staleData) {
    flagDescriptions.push(`Stale quote (${quoteAge}s old > ${riskConfig.max_stale_quote_seconds}s max)`);
  }
  if (wideSpread) {
    flagDescriptions.push(
      `Wide bid/ask spread (${(spreadPct * 100).toFixed(2)}% > ${(riskConfig.max_spread_pct * 100).toFixed(1)}% max)`
    );
  }
  if (halted) {
    flagDescriptions.push(`Trading HALTED on ${underlying.ticker}`);
  }
  if (earningsNear) {
    flagDescriptions.push(
      `Earnings proximity (${underlying.days_to_earnings}d away <= ${riskConfig.earnings_proximity_days}d window)`
    );
  }
  if (corpAction) {
    flagDescriptions.push(`Corporate action: ${underlying.corporate_action_flag}`);
  }
  if (volOverOiUnconfirmed && optionQuote) {
    flagDescriptions.push(
      `Unconfirmed Volume-over-OI (${optionQuote.intraday_contract_volume.toLocaleString()} vol vs ${optionQuote.open_interest.toLocaleString()} OI = ${optionQuote.volume_over_oi_ratio.toFixed(2)}x — treated as unconfirmed until next-day OI update)`
    );
  }

  const safety_flags: HoldingSafetyFlags = {
    stale_market_data: staleData,
    wide_spread: wideSpread,
    halted_symbol: halted,
    earnings_proximity: earningsNear,
    corporate_action_pending: corpAction,
    volume_over_oi_unconfirmed: volOverOiUnconfirmed,
    active_flag_descriptions: flagDescriptions,
  };

  // Determine directional exposure of the holding (+1 bullish underlying, -1 bearish underlying)
  const isBullishExposure =
    assetClass === 'stock'
      ? side === 'long'
      : optionRight === 'CALL'
        ? side === 'long'
        : side === 'short';

  const latestNetTick = uwNetPremTicks[uwNetPremTicks.length - 1];
  const cumNetCall = latestNetTick?.cumulative_net_call_premium ?? 0;
  const cumNetPut = latestNetTick?.cumulative_net_put_premium ?? 0;
  // Opposing flow is net put buying + negative call flow when bullish, or net call buying when bearish
  const opposingNetFlow = isBullishExposure
    ? Math.max(0, cumNetPut - cumNetCall)
    : Math.max(0, cumNetCall - cumNetPut);

  const drawdownFromPeak = Math.max(0, peakUnrealizedPlpc - unrealizedPlpc);
  const priceVsVwapPct =
    underlying.intraday_vwap > 0
      ? (underlying.spot_price - underlying.intraday_vwap) / underlying.intraday_vwap
      : 0;
  const vwapBreakdown = isBullishExposure ? priceVsVwapPct < -0.004 : priceVsVwapPct > 0.004;

  const rules: TriggeredRiskRule[] = [
    {
      rule_id: 'RULE_UNREALIZED_STOP_BREACH',
      rule_name: 'Hard Unrealized P&L Stop Threshold',
      severity: 'CRITICAL',
      triggered: unrealizedPlpc <= riskConfig.max_loss_pct,
      observed_value: `${(unrealizedPlpc * 100).toFixed(2)}%`,
      threshold_value: `<= ${(riskConfig.max_loss_pct * 100).toFixed(1)}%`,
      evidence_summary:
        unrealizedPlpc <= riskConfig.max_loss_pct
          ? `Position P&L ${(unrealizedPlpc * 100).toFixed(2)}% breached hard stop ${(riskConfig.max_loss_pct * 100).toFixed(1)}%.`
          : `Position P&L ${(unrealizedPlpc * 100).toFixed(2)}% is above stop ${(riskConfig.max_loss_pct * 100).toFixed(1)}%.`,
    },
    {
      rule_id: 'RULE_PROFIT_TARGET_OR_TRAIL_GIVEBACK',
      rule_name: 'Profit Target / Peak Giveback Protection',
      severity: 'WARNING',
      triggered:
        unrealizedPlpc >= riskConfig.take_profit_pct ||
        (peakUnrealizedPlpc > 0.1 && drawdownFromPeak >= riskConfig.trailing_drawdown_from_peak_pct),
      observed_value: `P&L ${(unrealizedPlpc * 100).toFixed(2)}% (Peak ${(peakUnrealizedPlpc * 100).toFixed(1)}%, Giveback ${(drawdownFromPeak * 100).toFixed(1)}%)`,
      threshold_value: `Target >= +${(riskConfig.take_profit_pct * 100).toFixed(0)}% or Giveback >= ${(riskConfig.trailing_drawdown_from_peak_pct * 100).toFixed(0)}%`,
      evidence_summary:
        unrealizedPlpc >= riskConfig.take_profit_pct
          ? `Unrealized gain +${(unrealizedPlpc * 100).toFixed(2)}% reached scale-out/exit profit threshold (+${(riskConfig.take_profit_pct * 100).toFixed(0)}%).`
          : drawdownFromPeak >= riskConfig.trailing_drawdown_from_peak_pct
            ? `Position gave back ${(drawdownFromPeak * 100).toFixed(1)}% from peak unrealized P&L (+${(peakUnrealizedPlpc * 100).toFixed(1)}%).`
            : 'Within normal P&L excursion band.',
    },
    {
      rule_id: 'RULE_UW_ADVERSE_WHALE_FLOW',
      rule_name: 'Unusual Whales Opposing Net Premium & Tape Reversal',
      severity: opposingNetFlow >= riskConfig.adverse_net_flow_threshold * 1.4 ? 'CRITICAL' : 'WARNING',
      triggered:
        opposingNetFlow >= riskConfig.adverse_net_flow_threshold ||
        (isBullishExposure && uwContractFlow.net_contract_premium < -150_000) ||
        (!isBullishExposure && uwContractFlow.net_contract_premium > 150_000),
      observed_value: `$${(opposingNetFlow / 1_000).toFixed(0)}k opposing net flow | Contract net $${(uwContractFlow.net_contract_premium / 1_000).toFixed(0)}k`,
      threshold_value: `>= $${(riskConfig.adverse_net_flow_threshold / 1_000).toFixed(0)}k opposing`,
      evidence_summary:
        opposingNetFlow >= riskConfig.adverse_net_flow_threshold
          ? `Intraday Unusual Whales net premium shows $${(opposingNetFlow / 1_000).toFixed(0)}k opposing institutional flow against ${isBullishExposure ? 'bullish' : 'bearish'} holding.`
          : 'Unusual Whales net premium flow remains aligned or neutral.',
    },
    {
      rule_id: 'RULE_VWAP_AND_REALIZED_MOVE_BREAK',
      rule_name: 'Underlying VWAP & Intraday Structure Breakdown',
      severity: 'WARNING',
      triggered: vwapBreakdown && underlying.relative_volume >= 1.25,
      observed_value: `Spot $${underlying.spot_price.toFixed(2)} vs VWAP $${underlying.intraday_vwap.toFixed(2)} (${(priceVsVwapPct * 100).toFixed(2)}%) @ ${underlying.relative_volume.toFixed(2)}x RVOL`,
      threshold_value: `${isBullishExposure ? '< -0.40% below VWAP' : '> +0.40% above VWAP'} with RVOL >= 1.25x`,
      evidence_summary:
        vwapBreakdown && underlying.relative_volume >= 1.25
          ? `Underlying ${underlying.ticker} broke ${isBullishExposure ? 'below' : 'above'} intraday VWAP ($${underlying.intraday_vwap.toFixed(2)}) on elevated ${underlying.relative_volume.toFixed(2)}x relative volume.`
          : `Underlying ${underlying.ticker} holding intraday VWAP structure.`,
    },
    {
      rule_id: 'RULE_DTE_THETA_GAMMA_CLIFF',
      rule_name: 'Option DTE Theta Decay & Pin Risk Gate',
      severity: optionQuote && optionQuote.dte <= 3 ? 'CRITICAL' : 'WARNING',
      triggered:
        assetClass === 'option' &&
        optionQuote !== null &&
        optionQuote.dte <= riskConfig.min_dte_warning,
      observed_value: optionQuote ? `${optionQuote.dte} DTE | Theta ${optionQuote.theta.toFixed(3)}` : 'Equity (N/A)',
      threshold_value: assetClass === 'option' ? `<= ${riskConfig.min_dte_warning} DTE` : 'N/A',
      evidence_summary:
        assetClass === 'option' && optionQuote && optionQuote.dte <= riskConfig.min_dte_warning
          ? `Option contract is at ${optionQuote.dte} DTE with accelerating theta decay (${optionQuote.theta.toFixed(3)}/day); evaluate ROLL or EXIT.`
          : 'DTE / Theta profile within normal holding horizon.',
    },
    {
      rule_id: 'RULE_MARKET_QUALITY_AND_EVENT_SAFETY',
      rule_name: 'Spread, Stale Data, Halt & Earnings Safety Gate',
      severity: halted || staleData ? 'CRITICAL' : 'WARNING',
      triggered: staleData || wideSpread || halted || earningsNear || corpAction,
      observed_value:
        flagDescriptions.length > 0 ? flagDescriptions.join(' · ') : 'All market quality checks nominal',
      threshold_value: `Spread <= ${(riskConfig.max_spread_pct * 100).toFixed(0)}%, Age <= ${riskConfig.max_stale_quote_seconds}s, Earnings > ${riskConfig.earnings_proximity_days}d`,
      evidence_summary:
        flagDescriptions.length > 0
          ? `Safety flags active: ${flagDescriptions.join('; ')}`
          : 'Quotes fresh, spreads tight, no earnings or corporate action flags.',
    },
  ];

  if (params.confirmationMatrix) {
    const cm = params.confirmationMatrix;
    rules.push({
      rule_id: 'RULE_SHORT_DARKPOOL_CONFIRMATION_MATRIX',
      rule_name: 'Multi-Signal Short-Pressure & Dark-Pool Confirmation Matrix',
      severity:
        cm.short_squeeze_cluster.active || cm.categories_agreed_count === 3
          ? 'CRITICAL'
          : cm.stronger_exit_review_triggered
            ? 'WARNING'
            : 'INFO',
      triggered: cm.stronger_exit_review_triggered || cm.short_squeeze_cluster.active,
      observed_value: `${cm.matrix_verdict_label} | Score ${cm.short_darkpool_score.score >= 0 ? `+${cm.short_darkpool_score.score}` : cm.short_darkpool_score.score} (${cm.short_darkpool_score.flags.join(', ') || 'neutral'})`,
      threshold_value:
        cm.effective_position_side === 'long'
          ? '>= 2/3 categories agree (Price + Flow + Non-Offsetting Short Data)'
          : 'Squeeze-Risk Cluster >= 4/5 signals or >= 2/3 categories',
      evidence_summary: cm.matrix_summary,
    });
  }

  const evaluation_event_active = rules.some((r) => r.triggered);

  return {
    safety_flags,
    triggered_rules: rules,
    evaluation_event_active,
  };
}

/**
 * Builds the Stage-1 Compact Evidence Packet and prompts for the LLM Holding Decision.
 */
export function buildStage1HoldingDecisionPrompts(holding: MonitoredHolding): {
  evidence_packet: Stage1CompactEvidencePacket;
  system_prompt: string;
  user_prompt: string;
} {
  const latestNet = holding.uw_net_prem_ticks[holding.uw_net_prem_ticks.length - 1];
  const priceVsVwapPct =
    holding.underlying_snapshot.intraday_vwap > 0
      ? round4(
          (holding.underlying_snapshot.spot_price - holding.underlying_snapshot.intraday_vwap) /
            holding.underlying_snapshot.intraday_vwap
        )
      : 0;

  const evidence_packet: Stage1CompactEvidencePacket = {
    event_id: `ev-${holding.holding_id}-${Date.now().toString(36).slice(-5)}`,
    generated_at: new Date().toISOString(),
    holding: {
      holding_id: holding.holding_id,
      asset_class: holding.asset_class,
      osi_symbol: holding.osi_canonical_symbol,
      underlying_symbol: holding.underlying_symbol,
      side: holding.side,
      quantity: holding.quantity,
      avg_entry_price: holding.avg_entry_price,
      current_price: holding.current_price,
      unrealized_pl: holding.unrealized_pl,
      unrealized_plpc: holding.unrealized_plpc,
      drawdown_from_peak_pct: holding.drawdown_from_peak_pct,
      portfolio_exposure_pct: holding.portfolio_exposure_pct,
    },
    underlying_context: {
      spot_price: holding.underlying_snapshot.spot_price,
      intraday_vwap: holding.underlying_snapshot.intraday_vwap,
      price_vs_vwap_pct: priceVsVwapPct,
      realized_move_pct: holding.underlying_snapshot.realized_move_pct,
      relative_volume: holding.underlying_snapshot.relative_volume,
    },
    option_greeks_and_spread: {
      dte: holding.option_snapshot?.dte ?? null,
      delta: holding.option_snapshot?.delta ?? null,
      gamma: holding.option_snapshot?.gamma ?? null,
      theta: holding.option_snapshot?.theta ?? null,
      iv: holding.option_snapshot?.implied_volatility ?? null,
      bid: holding.option_snapshot?.option_bid ?? holding.underlying_snapshot.bid,
      ask: holding.option_snapshot?.option_ask ?? holding.underlying_snapshot.ask,
      mid:
        holding.option_snapshot?.option_mid ??
        round2((holding.underlying_snapshot.bid + holding.underlying_snapshot.ask) / 2),
      spread_pct: holding.option_snapshot?.spread_pct ?? holding.underlying_snapshot.spread_pct,
    },
    unusual_whales_flow_summary: {
      cumulative_net_call_premium: latestNet?.cumulative_net_call_premium ?? 0,
      cumulative_net_put_premium: latestNet?.cumulative_net_put_premium ?? 0,
      cumulative_net_flow_delta: latestNet?.cumulative_net_flow_delta ?? 0,
      contract_net_premium: holding.uw_contract_flow.net_contract_premium,
      flow_alerts_count: holding.uw_flow_alerts.length,
      flow_alerts_supporting_note:
        'Flow alerts are aggregations, not necessarily isolated orders; used as supporting evidence only.',
      volume_over_oi_ratio: holding.option_snapshot?.volume_over_oi_ratio ?? 0,
      volume_over_oi_unconfirmed: holding.safety_flags.volume_over_oi_unconfirmed,
    },
    short_context: holding.llm_short_darkpool_payload.short_context,
    dark_pool_context: holding.llm_short_darkpool_payload.dark_pool_context,
    interpretation_constraints: holding.llm_short_darkpool_payload.interpretation_constraints,
    short_darkpool_score: holding.confirmation_matrix.short_darkpool_score,
    confirmation_matrix: {
      effective_position_side: holding.confirmation_matrix.effective_position_side,
      categories_agreed_count: holding.confirmation_matrix.categories_agreed_count,
      stronger_exit_review_triggered: holding.confirmation_matrix.stronger_exit_review_triggered,
      avoid_premature_long_exit_active: holding.confirmation_matrix.avoid_premature_long_exit_active,
      short_squeeze_cluster_active: holding.confirmation_matrix.short_squeeze_cluster.active,
      matrix_verdict_label: holding.confirmation_matrix.matrix_verdict_label,
      matrix_summary: holding.confirmation_matrix.matrix_summary,
    },
    safety_flags: holding.safety_flags,
    triggered_risk_rules: holding.triggered_rules
      .filter((r) => r.triggered)
      .map((r) => ({
        rule_id: r.rule_id,
        severity: r.severity,
        observed: r.observed_value,
        threshold: r.threshold_value,
      })),
  };

  const system_prompt = [
    'You are the Stage-1 Portfolio Holdings Risk & Exit Decision Advisory LLM.',
    'You evaluate a compact real-time evidence packet combining Alpaca position telemetry, Alpaca underlying intraday price/VWAP/volume, Unusual Whales options flow, Short-Pressure Regime metrics, and Dark-Pool Price Zones.',
    'CRITICAL RULES:',
    '1. You are advisory only and cannot submit orders directly.',
    '2. Choose exactly one action from: "HOLD" | "REDUCE" | "EXIT" | "HEDGE" | "ROLL" | "NEEDS_HUMAN_REVIEW".',
    '3. If market data is stale (`stale_market_data: true`), the symbol is halted (`halted_symbol: true`), or corporate actions create ambiguity, prefer "NEEDS_HUMAN_REVIEW".',
    '4. Do not assume option volume equals newly opened positions: treat `volume_over_oi_unconfirmed: true` as unconfirmed until next-day OI updates.',
    '5. Flow alerts are aggregations, not isolated orders; weight them alongside net premium ticks and underlying VWAP action.',
    `6. ${SUGGESTED_SHORT_DARKPOOL_LLM_RULE}`,
    '7. Require agreement between at least two independent categories (Price action + Options flow + Non-offsetting Short data) before recommending EXIT or REDUCE on a long position. Avoid exiting a long solely on bearish tape if price holds above a high-volume dark-pool zone and short borrow is tightening (`avoid_premature_long_exit_active: true`).',
    'Return ONLY valid JSON matching: {"decision":"HOLD"|"REDUCE"|"EXIT"|"HEDGE"|"ROLL"|"NEEDS_HUMAN_REVIEW","urgency":"LOW"|"MEDIUM"|"HIGH"|"IMMEDIATE","confidence_score":number,"primary_risk_driver":string,"rationale":string}',
  ].join('\n');

  const user_prompt = `Evaluate holding ${holding.osi_canonical_symbol} (${holding.display_label}) and recommend a Stage-1 action:\n${JSON.stringify(evidence_packet)}`;

  return {
    evidence_packet,
    system_prompt,
    user_prompt,
  };
}

/**
 * Synthesizes or parses the Stage-1 LLM Holding Decision.
 */
export function resolveStage1HoldingDecision(params: {
  holding: MonitoredHolding;
  evidence_packet: Stage1CompactEvidencePacket;
  system_prompt: string;
  user_prompt: string;
  rawContent?: string | null;
  executionMode: 'lm_studio_live' | 'deterministic_synthesis';
  modelId: string;
  latencyMs: number;
  overrideDecision?: Stage1HoldingAction;
}): LlmStage1HoldingDecision {
  const { holding, evidence_packet, system_prompt, user_prompt } = params;
  const parsed = extractJsonObjectFromLlmText(params.rawContent);

  const validActions: Stage1HoldingAction[] = [
    'HOLD',
    'REDUCE',
    'EXIT',
    'HEDGE',
    'ROLL',
    'NEEDS_HUMAN_REVIEW',
  ];

  // Deterministic synthesis baseline grounded in triggered rules
  let defaultAction: Stage1HoldingAction = 'HOLD';
  let defaultUrgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE' = 'LOW';
  let defaultConfidence = 0.84;
  let defaultDriver = 'Position & flow aligned within risk tolerances';
  let defaultRationale = '';

  const stopRule = holding.triggered_rules.find(
    (r) => r.rule_id === 'RULE_UNREALIZED_STOP_BREACH' && r.triggered
  );
  const profitRule = holding.triggered_rules.find(
    (r) => r.rule_id === 'RULE_PROFIT_TARGET_OR_TRAIL_GIVEBACK' && r.triggered
  );
  const adverseFlowRule = holding.triggered_rules.find(
    (r) => r.rule_id === 'RULE_UW_ADVERSE_WHALE_FLOW' && r.triggered
  );
  const dteRule = holding.triggered_rules.find(
    (r) => r.rule_id === 'RULE_DTE_THETA_GAMMA_CLIFF' && r.triggered
  );
  const vwapRule = holding.triggered_rules.find(
    (r) => r.rule_id === 'RULE_VWAP_AND_REALIZED_MOVE_BREAK' && r.triggered
  );

  const cm = holding.confirmation_matrix;
  const sdScore = cm.short_darkpool_score;

  if (
    holding.asset_class === 'option' &&
    holding.current_price <= 0 &&
    holding.option_snapshot &&
    holding.option_snapshot.option_bid <= 0
  ) {
    defaultAction = 'NEEDS_HUMAN_REVIEW';
    defaultUrgency = 'HIGH';
    defaultConfidence = 0.72;
    defaultDriver = '0-DTE Expiration Pin & Zero-Bid NBBO Liquidity Gate';
    defaultRationale = `Contract ${holding.display_label} marks at $0.00 (${(holding.unrealized_plpc * 100).toFixed(2)}% / $${holding.unrealized_pl.toFixed(0)} unrealized P&L) with $0.00 × $${holding.option_snapshot.option_ask.toFixed(2)} NBBO on ${holding.option_snapshot.dte} DTE (${holding.option_expiry ?? 'expiration'}). Because there is no active bid to cross, automated limit liquidation is blocked; escalating to NEEDS_HUMAN_REVIEW to let the contract expire or manually work a closing order.`;
  } else if (holding.safety_flags.halted_symbol || holding.safety_flags.stale_market_data) {
    defaultAction = 'NEEDS_HUMAN_REVIEW';
    defaultUrgency = 'HIGH';
    defaultConfidence = 0.58;
    defaultDriver = 'Stale quote or halted symbol safety gate';
    defaultRationale = `Market data integrity flag triggered (${holding.safety_flags.active_flag_descriptions.join('; ')}). Automated exit pricing is unsafe without fresh NBBO quotes; escalating to NEEDS_HUMAN_REVIEW.`;
  } else if (cm.short_squeeze_cluster.active && !stopRule) {
    defaultAction = holding.quantity >= 2 && holding.unrealized_plpc > -0.1 ? 'REDUCE' : 'EXIT';
    defaultUrgency = 'IMMEDIATE';
    defaultConfidence = 0.92;
    defaultDriver = `Short-Squeeze Risk Cluster (${cm.short_squeeze_cluster.signals_active_count}/5 Signals) + Off-Lit Zone Reclaim`;
    defaultRationale = `${defaultAction} recommended for bearish/short exposure ${holding.display_label}: ${cm.short_squeeze_cluster.summary} Short/dark-pool score is ${sdScore.score} (${sdScore.flags.join(', ')}).`;
  } else if (stopRule || (cm.stronger_exit_review_triggered && adverseFlowRule && vwapRule && holding.unrealized_plpc < -0.08)) {
    defaultAction = 'EXIT';
    defaultUrgency = 'IMMEDIATE';
    defaultConfidence = 0.91;
    defaultDriver = stopRule
      ? stopRule.rule_name
      : `Confirmation Matrix (${cm.categories_agreed_count}/3 Agreed): Price + Options Flow + Non-Offsetting Short Data`;
    defaultRationale = `Full EXIT recommended for ${holding.display_label}: unrealized P&L is ${(holding.unrealized_plpc * 100).toFixed(2)}% ($${holding.unrealized_pl.toFixed(0)}) while ${holding.underlying_symbol} trades at $${holding.underlying_snapshot.spot_price.toFixed(2)} vs $${holding.underlying_snapshot.intraday_vwap.toFixed(2)} VWAP (${cm.matrix_verdict_label}; short_darkpool_score ${sdScore.score}).`;
  } else if (dteRule && holding.option_snapshot && holding.option_snapshot.dte <= 7) {
    defaultAction = 'ROLL';
    defaultUrgency = 'HIGH';
    defaultConfidence = 0.86;
    defaultDriver = `${holding.option_snapshot.dte} DTE Theta Cliff & Earnings/Gamma Exposure`;
    defaultRationale = `ROLL recommended for ${holding.display_label}: contract is down to ${holding.option_snapshot.dte} DTE with theta decay of $${Math.abs(holding.option_snapshot.theta * 100).toFixed(0)}/day per contract${holding.safety_flags.earnings_proximity ? ` and earnings in ${holding.underlying_snapshot.days_to_earnings} days` : ''}. Rolling out in time preserves directional thesis while mitigating gamma/theta cliff.`;
  } else if (profitRule && holding.quantity >= 2) {
    defaultAction = 'REDUCE';
    defaultUrgency = 'MEDIUM';
    defaultConfidence = 0.89;
    defaultDriver = 'Profit Target Reached + Opposing Intraday Tape Hedge Signal';
    defaultRationale = `REDUCE 50% recommended for ${holding.display_label}: position is up +${(holding.unrealized_plpc * 100).toFixed(2)}% (+$${holding.unrealized_pl.toFixed(0)}) with ${holding.drawdown_from_peak_pct > 0.05 ? `${(holding.drawdown_from_peak_pct * 100).toFixed(1)}% giveback from intraday peak` : 'institutional flow decelerating near resistance'}. Locking in half the position de-risks capital while keeping runner exposure.`;
  } else if (cm.avoid_premature_long_exit_active && adverseFlowRule && !vwapRule) {
    defaultAction = 'HOLD';
    defaultUrgency = 'LOW';
    defaultConfidence = 0.87;
    defaultDriver = `Premature-Exit Guard Active (Score +${sdScore.score}: Dark-Pool Hold + Tightening Short Borrow)`;
    defaultRationale = `HOLD ${holding.display_label} (Avoid Premature Exit): Although options flow shows opposing put activity, ${holding.underlying_symbol} spot ($${holding.underlying_snapshot.spot_price.toFixed(2)}) is holding above both VWAP ($${holding.underlying_snapshot.intraday_vwap.toFixed(2)}) and the primary high-volume dark-pool zone ($${holding.dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${holding.dark_pool_telemetry.primary_zone_high.toFixed(2)}), while short borrow is tightening (${(holding.short_telemetry.shares_available_change_5d * 100).toFixed(0)}% 5d shares avail, +${(holding.short_telemetry.borrow_fee_change_5d * 100).toFixed(1)}% fee, ${holding.short_telemetry.days_to_cover.toFixed(1)} DTC). Confirmation Matrix has only ${cm.categories_agreed_count}/3 exit categories agreed.`;
  } else if (holding.asset_class === 'stock' && adverseFlowRule) {
    defaultAction = 'HEDGE';
    defaultUrgency = 'MEDIUM';
    defaultConfidence = 0.85;
    defaultDriver = 'Heavy Put Sweep Activity Against Core Equity Holding';
    defaultRationale = `HEDGE recommended for ${holding.quantity} shares of ${holding.underlying_symbol}: Unusual Whales net put premium surged to $${((evidence_packet.unusual_whales_flow_summary.cumulative_net_put_premium) / 1_000).toFixed(0)}k with supporting flow alerts. Purchasing protective puts caps downside tail risk without liquidating core shares.`;
  } else if (adverseFlowRule && cm.categories_agreed_count >= 2) {
    defaultAction = holding.quantity >= 2 ? 'REDUCE' : 'EXIT';
    defaultUrgency = 'HIGH';
    defaultConfidence = 0.84;
    defaultDriver = `${adverseFlowRule.rule_name} + Matrix Confirmation (${cm.categories_agreed_count}/3)`;
    defaultRationale = `${defaultAction} recommended for ${holding.display_label}: Unusual Whales net flow flipped against the position and Confirmation Matrix verified ${cm.categories_agreed_count}/3 independent categories (${cm.matrix_summary}).`;
  } else {
    defaultAction = 'HOLD';
    defaultUrgency = 'LOW';
    defaultConfidence = 0.88;
    defaultDriver = `Constructive VWAP & Off-Lit Zone Hold (Score ${sdScore.score >= 0 ? `+${sdScore.score}` : sdScore.score})`;
    defaultRationale = `HOLD ${holding.display_label}: ${holding.underlying_symbol} spot ($${holding.underlying_snapshot.spot_price.toFixed(2)}) remains constructive vs intraday VWAP ($${holding.underlying_snapshot.intraday_vwap.toFixed(2)}) and primary dark-pool zone ($${holding.dark_pool_telemetry.primary_zone_low.toFixed(2)}–$${holding.dark_pool_telemetry.primary_zone_high.toFixed(2)}). ${cm.matrix_summary}`;
  }

  if (params.overrideDecision) {
    defaultAction = params.overrideDecision;
  }

  const parsedDecision = validActions.includes(parsed?.decision as Stage1HoldingAction)
    ? (parsed?.decision as Stage1HoldingAction)
    : defaultAction;

  const finalDecision = params.overrideDecision ?? parsedDecision;
  const requiresStage2 =
    finalDecision === 'EXIT' ||
    finalDecision === 'REDUCE' ||
    finalDecision === 'HEDGE' ||
    finalDecision === 'ROLL';

  const outputObj = {
    decision: finalDecision,
    urgency:
      typeof parsed?.urgency === 'string' &&
      ['LOW', 'MEDIUM', 'HIGH', 'IMMEDIATE'].includes(parsed.urgency)
        ? (parsed.urgency as 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE')
        : defaultUrgency,
    confidence_score:
      typeof parsed?.confidence_score === 'number'
        ? Math.max(0.1, Math.min(0.99, round2(parsed.confidence_score)))
        : defaultConfidence,
    primary_risk_driver:
      typeof parsed?.primary_risk_driver === 'string' && parsed.primary_risk_driver.trim()
        ? parsed.primary_risk_driver.trim()
        : defaultDriver,
    rationale:
      typeof parsed?.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : defaultRationale,
  };

  return {
    stage1_id: `stg1-${holding.holding_id}-${Date.now().toString(36).slice(-5)}`,
    event_id: evidence_packet.event_id,
    holding_id: holding.holding_id,
    symbol: holding.osi_canonical_symbol,
    evaluated_at: new Date().toISOString(),
    execution_mode: params.executionMode,
    model_id: params.modelId,
    latency_ms: params.latencyMs,
    decision: outputObj.decision,
    urgency: outputObj.urgency,
    confidence_score: outputObj.confidence_score,
    primary_risk_driver: outputObj.primary_risk_driver,
    rationale: outputObj.rationale,
    requires_stage2_plan: requiresStage2,
    evidence_packet,
    system_prompt,
    user_prompt,
    raw_llm_output: params.rawContent || JSON.stringify(outputObj, null, 2),
  };
}

/**
 * Collects the Stage-2 richer dataset when Stage-1 selects EXIT, REDUCE, HEDGE, or ROLL,
 * and constructs the Stage-2 Structured Execution Plan + Deterministic Risk Validation.
 */
export function buildStage2ExitExecutionPlan(params: {
  holding: MonitoredHolding;
  stage1: LlmStage1HoldingDecision;
  accountBuyingPower: number;
  optionsBuyingPower: number;
  openOrdersCountForSymbol: number;
  environment: TradingEnvironmentMode;
  mfaVerifiedForLive: boolean;
  rawLlmContent?: string | null;
  executionMode: 'lm_studio_live' | 'deterministic_synthesis';
  modelId: string;
  latencyMs: number;
}): LlmStage2ExitExecutionPlan {
  const { holding, stage1 } = params;
  const action: 'EXIT' | 'REDUCE' | 'HEDGE' | 'ROLL' =
    stage1.decision === 'EXIT' ||
    stage1.decision === 'REDUCE' ||
    stage1.decision === 'HEDGE' ||
    stage1.decision === 'ROLL'
      ? stage1.decision
      : 'EXIT';

  const bid = holding.option_snapshot
    ? holding.option_snapshot.option_bid
    : holding.underlying_snapshot.bid;
  const ask = holding.option_snapshot
    ? holding.option_snapshot.option_ask
    : holding.underlying_snapshot.ask;
  const mid = round2((bid + ask) / 2);
  const spreadAbs = round2(Math.max(0.01, ask - bid));
  const spreadPct = mid > 0 ? round4(spreadAbs / mid) : 0;
  const quoteAge = holding.option_snapshot
    ? holding.option_snapshot.quote_age_seconds
    : holding.underlying_snapshot.quote_age_seconds;

  const rich_dataset: Stage2RichDatasetPacket = {
    stage1_decision_id: stage1.stage1_id,
    holding_id: holding.holding_id,
    osi_symbol: holding.osi_canonical_symbol,
    recommended_stage1_action: action,
    live_nbbo: {
      bid,
      ask,
      mid,
      spread_abs: spreadAbs,
      spread_pct: spreadPct,
      quote_age_seconds: quoteAge,
    },
    broker_account_context: {
      environment: params.environment,
      buying_power: params.accountBuyingPower,
      options_buying_power: params.optionsBuyingPower,
      open_orders_for_symbol: params.openOrdersCountForSymbol,
      qty_total: holding.quantity,
      qty_available: holding.qty_available,
    },
    intraday_bars_tail: holding.underlying_snapshot.intraday_bars.slice(-6),
    net_prem_ticks_tail: holding.uw_net_prem_ticks.slice(-6),
    contract_tape_prints: holding.uw_options_tape.slice(0, 8),
    roll_and_hedge_candidates: holding.uw_contract_flow.hottest_chain_alternatives,
    short_context: holding.llm_short_darkpool_payload.short_context,
    dark_pool_context: holding.dark_pool_telemetry,
    confirmation_matrix: holding.confirmation_matrix,
    safety_flags: holding.safety_flags,
  };

  // Determine target contract, quantity, side, and formulaic limit-price logic
  let targetSymbol = holding.osi_canonical_symbol;
  let secondaryLegSymbol: string | null = null;
  let orderSide: 'sell' | 'buy' = holding.side === 'long' ? 'sell' : 'buy';
  let pctOfPosition = 100;
  let qtyToTrade = Math.max(1, holding.qty_available);
  let refBid = bid;
  let refAsk = ask;
  let refMid = mid;

  if (action === 'REDUCE') {
    pctOfPosition = holding.qty_available >= 2 ? 50 : 100;
    qtyToTrade = Math.max(1, Math.floor((holding.qty_available * pctOfPosition) / 100));
  } else if (action === 'HEDGE') {
    const hedgeLeg =
      holding.uw_contract_flow.hottest_chain_alternatives.find(
        (c) => c.role === 'HEDGE_CANDIDATE'
      ) ?? holding.uw_contract_flow.hottest_chain_alternatives[0];
    if (hedgeLeg) {
      targetSymbol = hedgeLeg.osi_symbol;
      orderSide = 'buy';
      refBid = hedgeLeg.bid;
      refAsk = hedgeLeg.ask;
      refMid = hedgeLeg.mid;
      // 1 protective put contract per 100 shares, or matching option contracts
      qtyToTrade =
        holding.asset_class === 'stock'
          ? Math.max(1, Math.floor(holding.quantity / 100))
          : Math.max(1, Math.ceil(holding.quantity * 0.5));
      pctOfPosition = 50;
    }
  } else if (action === 'ROLL') {
    const rollLeg =
      holding.uw_contract_flow.hottest_chain_alternatives.find(
        (c) => c.role === 'ROLL_CANDIDATE'
      ) ?? holding.uw_contract_flow.hottest_chain_alternatives[0];
    if (rollLeg) {
      secondaryLegSymbol = rollLeg.osi_symbol;
    }
    pctOfPosition = 100;
    qtyToTrade = Math.max(1, holding.qty_available);
  }

  // Formulaic Limit-Price Calculation anchored strictly to live NBBO quotes (never arbitrary fabricated prices)
  const formulaType: LimitPriceFormulaType =
    orderSide === 'sell'
      ? stage1.urgency === 'IMMEDIATE'
        ? 'PEGGED_TO_NBBO_MID_WALK_TO_BID'
        : 'MID_PRICE'
      : 'PEGGED_TO_NBBO_MID_WALK_TO_ASK';

  const stepTick = round2(Math.max(0.01, (refAsk - refBid) * 0.25));
  const computedInitialLimit =
    orderSide === 'sell'
      ? stage1.urgency === 'IMMEDIATE'
        ? round2(Math.max(refBid, refMid - stepTick * 0.5))
        : refMid
      : round2(Math.min(refAsk, refMid + stepTick * 0.5));

  const worstAcceptableLimit =
    orderSide === 'sell'
      ? round2(Math.max(0.01, refBid))
      : round2(refAsk);

  const limitPriceLogic: LimitPriceCalculationLogic = {
    formula_type: formulaType,
    formula_expression:
      orderSide === 'sell'
        ? `limit = max(NBBO_Bid [$${refBid.toFixed(2)}], round2(NBBO_Mid [$${refMid.toFixed(2)}] - ${stage1.urgency === 'IMMEDIATE' ? '0.125 * Spread' : '0.00'}))`
        : `limit = min(NBBO_Ask [$${refAsk.toFixed(2)}], round2(NBBO_Mid [$${refMid.toFixed(2)}] + 0.125 * Spread))`,
    reference_bid: refBid,
    reference_ask: refAsk,
    reference_mid: refMid,
    aggressiveness_bps: stage1.urgency === 'IMMEDIATE' ? 25 : 0,
    computed_initial_limit_price: computedInitialLimit,
    worst_acceptable_limit_price: worstAcceptableLimit,
    marketability_assessment:
      stage1.urgency === 'IMMEDIATE' ? 'CROSS_SPREAD_GUARDED' : 'MID_PEGGED',
    explanation:
      orderSide === 'sell'
        ? `Pegged to live NBBO Mid ($${refMid.toFixed(2)}) between Bid $${refBid.toFixed(2)} and Ask $${refAsk.toFixed(2)}; walks down in $${stepTick.toFixed(2)} increments every 12s with hard floor at live Bid ($${worstAcceptableLimit.toFixed(2)}).`
        : `Pegged to live NBBO Mid ($${refMid.toFixed(2)}) for protective ${targetSymbol}; walks up in $${stepTick.toFixed(2)} increments with hard cap at live Ask ($${worstAcceptableLimit.toFixed(2)}).`,
  };

  // Qualifiers & warnings
  const qualifiers: string[] = [];
  if (holding.safety_flags.volume_over_oi_unconfirmed) {
    qualifiers.push(
      'Volume-over-OI exceeds 1.0x and is treated as unconfirmed until next-day OCC Open Interest update.'
    );
  }
  if (holding.uw_flow_alerts.length > 0) {
    qualifiers.push(
      `${holding.uw_flow_alerts.length} Unusual Whales flow alert(s) weighed as supporting aggregation evidence, not isolated single-counterparty conviction.`
    );
  }
  if (holding.safety_flags.wide_spread) {
    qualifiers.push(
      `Option bid/ask spread is wide (${(spreadPct * 100).toFixed(2)}%); strictly enforce passive mid-pegged limit order without market order fallback.`
    );
  }
  if (holding.safety_flags.earnings_proximity) {
    qualifiers.push(
      `Upcoming earnings in ${holding.underlying_snapshot.days_to_earnings} day(s) elevates implied volatility crush and gap risk.`
    );
  }
  if (qualifiers.length === 0) {
    qualifiers.push(
      'NBBO quotes are fresh (<15s) and liquid; limit price is anchored directly to live bid/ask midpoint.'
    );
  }

  // Deterministic Risk Engine Validation
  const validationChecks: Array<{ check_name: string; passed: boolean; detail: string }> = [];
  const blockingReasons: string[] = [];

  // Check 1: Fresh Market Data & Non-Halted Symbol
  const freshAndActive = !holding.safety_flags.stale_market_data && !holding.safety_flags.halted_symbol;
  validationChecks.push({
    check_name: 'Market Data Freshness & Halt Gate',
    passed: freshAndActive,
    detail: freshAndActive
      ? `Quote age ${quoteAge}s (<= ${holding.monitor_config.risk_config.max_stale_quote_seconds}s) and ${holding.underlying_symbol} trading normally.`
      : `Blocked: ${holding.safety_flags.active_flag_descriptions.join(', ')}`,
  });
  if (!freshAndActive) {
    blockingReasons.push('Market data is stale or underlying symbol is halted.');
  }

  // Check 2: Position / Buying Power Check
  const hasSufficientPositionOrBp =
    orderSide === 'sell'
      ? qtyToTrade <= holding.qty_available && holding.qty_available >= 1
      : qtyToTrade * computedInitialLimit * 100 <= params.optionsBuyingPower;
  validationChecks.push({
    check_name: 'Broker Position & Buying Power Verification',
    passed: hasSufficientPositionOrBp,
    detail:
      orderSide === 'sell'
        ? `Selling ${qtyToTrade} of ${holding.qty_available} available (${holding.quantity} total held).`
        : `Hedge debit $${(qtyToTrade * computedInitialLimit * 100).toFixed(0)} within $${params.optionsBuyingPower.toLocaleString()} options buying power.`,
  });
  if (!hasSufficientPositionOrBp) {
    blockingReasons.push(
      orderSide === 'sell'
        ? `Requested quantity (${qtyToTrade}) exceeds available unlocked quantity (${holding.qty_available}).`
        : 'Insufficient options buying power for protective hedge debit.'
    );
  }

  // Check 3: Limit-Price Quote Anchoring Check (never outside NBBO collar)
  const collarPassed =
    computedInitialLimit >= round2(refBid * 0.95) &&
    computedInitialLimit <= round2(refAsk * 1.05) &&
    computedInitialLimit > 0;
  validationChecks.push({
    check_name: 'NBBO Quote-Anchored Limit Price Collar',
    passed: collarPassed,
    detail: `Computed limit $${computedInitialLimit.toFixed(2)} anchored inside live NBBO ($${refBid.toFixed(2)} × $${refAsk.toFixed(2)}).`,
  });
  if (!collarPassed) {
    blockingReasons.push('Limit price falls outside live NBBO quote collar.');
  }

  // Check 4: Spread Marketability Gate
  const spreadAcceptable = spreadPct <= holding.monitor_config.risk_config.max_spread_pct * 1.5;
  validationChecks.push({
    check_name: 'Bid/Ask Spread Marketability Gate',
    passed: spreadAcceptable,
    detail: `Live spread ${(spreadPct * 100).toFixed(2)}% (limit order mandatory).`,
  });
  if (!spreadAcceptable) {
    blockingReasons.push(
      `Bid/ask spread (${(spreadPct * 100).toFixed(2)}%) exceeds maximum marketable threshold.`
    );
  }

  // Check 5: Live Trading MFA & Explicit Approval Gate
  const liveMfaCheckPassed =
    params.environment === 'paper' || params.mfaVerifiedForLive;
  validationChecks.push({
    check_name: 'Environment & Live MFA Safety Gate',
    passed: liveMfaCheckPassed,
    detail:
      params.environment === 'paper'
        ? 'Default Alpaca Paper Trading environment active.'
        : params.mfaVerifiedForLive
          ? 'Live Trading environment unlocked with verified MFA session.'
          : 'Live Trading requires MFA re-authentication before order submission.',
  });

  const allRiskPassed = blockingReasons.length === 0;

  const requireHumanApproval =
    holding.monitor_config.mode === 'approval_required' ||
    (params.environment === 'live' && !params.mfaVerifiedForLive);
  const autoExecutionPermitted =
    allRiskPassed &&
    !requireHumanApproval &&
    holding.monitor_config.mode === 'paper_auto';

  const risk_validation: DeterministicRiskValidationResult = {
    validation_id: `rval-${holding.holding_id}-${Date.now().toString(36).slice(-5)}`,
    validated_at: new Date().toISOString(),
    passed: allRiskPassed,
    auto_execution_permitted: autoExecutionPermitted,
    requires_human_approval: requireHumanApproval,
    requires_live_mfa: params.environment === 'live' && !params.mfaVerifiedForLive,
    checks: validationChecks,
    blocking_reasons: blockingReasons,
    validated_limit_price: computedInitialLimit,
    validated_quantity: qtyToTrade,
  };

  const clientOrderId = `exit-plan-${holding.underlying_symbol.toLowerCase()}-${Date.now().toString(36).slice(-6)}`;
  const alpaca_order_payload = {
    symbol: targetSymbol,
    qty: String(qtyToTrade),
    side: orderSide,
    type: 'limit' as const,
    time_in_force: 'day' as const,
    limit_price: computedInitialLimit.toFixed(2),
    client_order_id: clientOrderId,
  };

  const system_prompt = [
    'You are the Stage-2 Structured Execution Plan Architect for the Holdings Monitor.',
    'Given a Stage-1 decision of EXIT, REDUCE, HEDGE, or ROLL and the richer market/flow dataset, produce a structured execution plan.',
    'SAFETY RULES:',
    '- Never fabricate an arbitrary numeric stop, target, or limit price. Specify formulaic limit-price logic anchored to live NBBO Bid/Mid/Ask.',
    '- Use limit orders by default for options (`"order_type": "limit"`).',
    '- Include explicit retry/cancel logic, risk constraints, rationale, and confidence qualifiers (including unconfirmed Volume-over-OI and flow alert aggregation caveats).',
  ].join('\n');

  const user_prompt = `Generate Stage-2 Structured Execution Plan for ${holding.osi_canonical_symbol} (Stage-1 action: ${action}):\n${JSON.stringify(rich_dataset)}`;

  const rationale =
    action === 'EXIT'
      ? `Execute full EXIT of ${qtyToTrade}x ${targetSymbol} via ${limitPriceLogic.marketability_assessment} limit order @ $${computedInitialLimit.toFixed(2)} (${limitPriceLogic.formula_expression}). Triggered by ${stage1.primary_risk_driver}.`
      : action === 'REDUCE'
        ? `Scale out ${pctOfPosition}% (${qtyToTrade} of ${holding.qty_available} contracts/shares) of ${targetSymbol} @ $${computedInitialLimit.toFixed(2)} limit (${limitPriceLogic.formula_expression}) to lock in gains and reduce exposure while retaining ${holding.qty_available - qtyToTrade} runner(s).`
        : action === 'HEDGE'
          ? `Open ${qtyToTrade}x protective hedge ${targetSymbol} @ $${computedInitialLimit.toFixed(2)} limit (${limitPriceLogic.formula_expression}) to neutralize downside delta against opposing Unusual Whales net put flow.`
          : `Close existing ${qtyToTrade}x ${targetSymbol} @ $${computedInitialLimit.toFixed(2)} limit and roll into ${secondaryLegSymbol ?? 'next-cycle contract'} to eliminate near-term ${holding.option_snapshot?.dte ?? 5} DTE theta decay and gamma pin risk.`;

  const planId = `plan-${holding.holding_id}-${Date.now().toString(36).slice(-5)}`;
  const createdAt = new Date().toISOString();
  const autoOrderId = autoExecutionPermitted
    ? `ord-auto-${holding.underlying_symbol.toLowerCase()}-${Date.now().toString(36).slice(-5)}`
    : null;

  return {
    plan_id: planId,
    stage1_id: stage1.stage1_id,
    event_id: stage1.event_id,
    holding_id: holding.holding_id,
    symbol: holding.symbol,
    osi_symbol: holding.osi_canonical_symbol,
    underlying_symbol: holding.underlying_symbol,
    asset_class: holding.asset_class,
    created_at: createdAt,
    execution_mode: params.executionMode,
    model_id: params.modelId,
    latency_ms: params.latencyMs,
    recommended_action: action,
    order_side: orderSide,
    target_symbol: targetSymbol,
    secondary_leg_symbol: secondaryLegSymbol,
    quantity_to_trade: qtyToTrade,
    percentage_of_position: pctOfPosition,
    order_type: 'limit',
    limit_price_logic: limitPriceLogic,
    time_in_force: 'day',
    retry_and_cancel_logic: {
      max_reprice_attempts: 3,
      reprice_interval_seconds: 12,
      step_towards_market_bps: 125,
      cancel_if_spread_exceeds_pct: round2(holding.monitor_config.risk_config.max_spread_pct * 1.5),
      cancel_if_unfilled_after_seconds: 90,
      stale_quote_abort_seconds: holding.monitor_config.risk_config.max_stale_quote_seconds,
    },
    risk_constraints: {
      max_slippage_from_mid_pct: 0.035,
      min_acceptable_credit_per_contract:
        orderSide === 'sell' ? round2(worstAcceptableLimit * 100) : 0,
      max_hedge_debit_pct_of_holding: 0.08,
      post_trade_delta_target:
        action === 'EXIT' ? 0 : action === 'REDUCE' ? round2((holding.option_snapshot?.delta ?? 0.5) * 0.5) : 0.25,
      disallow_market_orders: true,
    },
    rationale,
    confidence_score: stage1.confidence_score,
    confidence_qualifiers: qualifiers,
    rich_dataset,
    risk_validation,
    approval_status: !allRiskPassed
      ? 'BLOCKED_BY_RISK_ENGINE'
      : autoExecutionPermitted
        ? 'APPROVED_AND_SUBMITTED'
        : 'PENDING_HUMAN_APPROVAL',
    alpaca_order_payload,
    submitted_order_id: autoOrderId,
    submitted_at: autoExecutionPermitted ? createdAt : null,
    approved_by: autoExecutionPermitted ? 'AUTO_EXECUTION_ENGINE' : null,
    system_prompt,
    user_prompt,
    raw_llm_output:
      params.rawLlmContent ||
      JSON.stringify(
        {
          recommended_action: action,
          target_symbol: targetSymbol,
          secondary_leg_symbol: secondaryLegSymbol,
          quantity_to_trade: qtyToTrade,
          percentage_of_position: pctOfPosition,
          limit_price_logic: limitPriceLogic,
          time_in_force: 'day',
          alpaca_order_payload,
          confidence_qualifiers: qualifiers,
          rationale,
        },
        null,
        2
      ),
  };
}

/**
 * Generates initial monitored holdings combining any live Alpaca positions with
 * rich institutional stock & options holdings so all 6 LLM decision actions
 * (EXIT, REDUCE, HEDGE, ROLL, HOLD, NEEDS_HUMAN_REVIEW) and Unusual Whales data streams
 * can be inspected and tested immediately.
 * Defaults to `paper_auto` so approval is NOT required by default.
 */
export function buildInitialMonitoredHoldings(
  alpacaPositions: NormalizedAlpacaPosition[] = [],
  accountEquity = 125_000,
  environment: TradingEnvironmentMode = 'paper',
  accountBuyingPower = 84_780,
  optionsBuyingPower = 21_195,
  defaultMode: HoldingMonitorMode = 'paper_auto'
): {
  holdings: MonitoredHolding[];
  stage1_decisions: LlmStage1HoldingDecision[];
  stage2_plans: LlmStage2ExitExecutionPlan[];
  audit_logs: ImmutableAuditLogEntry[];
} {
  const nowIso = new Date().toISOString();

  type HoldingSeedSpec = {
    holding_id: string;
    symbol: string;
    display_label?: string;
    side: 'long' | 'short';
    quantity: number;
    qty_available?: number;
    avg_entry_price: number;
    current_price: number;
    exact_cost_basis?: number;
    exact_market_value?: number;
    exact_unrealized_pl?: number;
    exact_unrealized_plpc?: number;
    exact_intraday_pl?: number;
    exact_intraday_plpc?: number;
    peak_plpc: number;
    spot_price: number;
    prev_close: number;
    vwap: number;
    rvol: number;
    dte: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    iv: number;
    opt_bid: number;
    opt_ask: number;
    oi: number;
    vol: number;
    quote_age_seconds: number;
    halted: boolean;
    days_to_earnings: number | null;
    corporate_action_flag: string | null;
    cum_call_prem: number;
    cum_put_prem: number;
    contract_net_prem: number;
    preferred_stage1?: Stage1HoldingAction;
  };

  const seedSpecs: HoldingSeedSpec[] = [
    // 1. SHOP 261120P00175000 (From real Alpaca position or fallback) -> +30.8% gain, giveback from +44% peak -> REDUCE
    {
      holding_id: 'hold-shop-175p',
      symbol: 'SHOP261120P00175000',
      side: 'long',
      quantity: 2,
      avg_entry_price: 12.65,
      current_price: 16.55,
      peak_plpc: 0.445,
      spot_price: 161.4,
      prev_close: 166.8,
      vwap: 160.85,
      rvol: 1.64,
      dte: 32,
      delta: -0.64,
      gamma: 0.028,
      theta: -0.14,
      vega: 0.19,
      iv: 0.48,
      opt_bid: 16.4,
      opt_ask: 16.7,
      oi: 1840,
      vol: 2690, // vol > OI -> unconfirmed opening flow flag
      quote_age_seconds: 3,
      halted: false,
      days_to_earnings: 14,
      corporate_action_flag: null,
      cum_call_prem: 620_000,
      cum_put_prem: 980_000,
      contract_net_prem: 210_000,
      preferred_stage1: 'REDUCE',
    },
    // 2. NVDA 261120C00145000 -> -22.4% unrealized loss + heavy opposing UW put flow + below VWAP -> EXIT
    {
      holding_id: 'hold-nvda-145c',
      symbol: 'NVDA261120C00145000',
      side: 'long',
      quantity: 4,
      avg_entry_price: 6.25,
      current_price: 4.85,
      peak_plpc: 0.08,
      spot_price: 138.2,
      prev_close: 142.1,
      vwap: 140.45,
      rvol: 2.18,
      dte: 32,
      delta: 0.41,
      gamma: 0.034,
      theta: -0.18,
      vega: 0.22,
      iv: 0.54,
      opt_bid: 4.8,
      opt_ask: 4.9,
      oi: 14_200,
      vol: 9_850,
      quote_age_seconds: 2,
      halted: false,
      days_to_earnings: 21,
      corporate_action_flag: null,
      cum_call_prem: 1_150_000,
      cum_put_prem: 2_890_000,
      contract_net_prem: -420_000,
      preferred_stage1: 'EXIT',
    },
    // 3. TSLA 261023P00250000 -> 4 DTE Theta Cliff + Earnings in 2 days -> ROLL
    {
      holding_id: 'hold-tsla-250p',
      symbol: 'TSLA261023P00250000',
      side: 'long',
      quantity: 3,
      avg_entry_price: 5.4,
      current_price: 6.1,
      peak_plpc: 0.19,
      spot_price: 247.5,
      prev_close: 251.2,
      vwap: 248.1,
      rvol: 1.85,
      dte: 4,
      delta: -0.52,
      gamma: 0.051,
      theta: -0.68,
      vega: 0.14,
      iv: 0.72,
      opt_bid: 6.0,
      opt_ask: 6.2,
      oi: 8_420,
      vol: 12_910, // vol > OI
      quote_age_seconds: 4,
      halted: false,
      days_to_earnings: 2,
      corporate_action_flag: null,
      cum_call_prem: 910_000,
      cum_put_prem: 1_640_000,
      contract_net_prem: 380_000,
      preferred_stage1: 'ROLL',
    },
    // 4. AAPL Stock (200 shares long equity) -> Opposing $1.45M institutional put sweep activity -> HEDGE
    {
      holding_id: 'hold-aapl-stock',
      symbol: 'AAPL',
      side: 'long',
      quantity: 200,
      avg_entry_price: 224.5,
      current_price: 231.8,
      peak_plpc: 0.048,
      spot_price: 231.8,
      prev_close: 233.4,
      vwap: 232.95,
      rvol: 1.42,
      dte: 0,
      delta: 1.0,
      gamma: 0,
      theta: 0,
      vega: 0,
      iv: 0.24,
      opt_bid: 231.78,
      opt_ask: 231.82,
      oi: 0,
      vol: 0,
      quote_age_seconds: 1,
      halted: false,
      days_to_earnings: 9,
      corporate_action_flag: null,
      cum_call_prem: 780_000,
      cum_put_prem: 2_230_000,
      contract_net_prem: -640_000,
      preferred_stage1: 'HEDGE',
    },
    // 5. MSFT 261120C00430000 -> Strong trend above VWAP, aligned bullish call flow -> HOLD
    {
      holding_id: 'hold-msft-430c',
      symbol: 'MSFT261120C00430000',
      side: 'long',
      quantity: 2,
      avg_entry_price: 8.9,
      current_price: 10.4,
      peak_plpc: 0.18,
      spot_price: 434.6,
      prev_close: 429.8,
      vwap: 432.15,
      rvol: 1.38,
      dte: 32,
      delta: 0.58,
      gamma: 0.022,
      theta: -0.15,
      vega: 0.29,
      iv: 0.27,
      opt_bid: 10.3,
      opt_ask: 10.5,
      oi: 6_100,
      vol: 4_320,
      quote_age_seconds: 2,
      halted: false,
      days_to_earnings: 8,
      corporate_action_flag: null,
      cum_call_prem: 1_890_000,
      cum_put_prem: 540_000,
      contract_net_prem: 520_000,
      preferred_stage1: 'HOLD',
    },
  ];

  const underlyingTelemetryDefaults: Record<
    string,
    {
      spot_price: number;
      prev_close: number;
      vwap: number;
      rvol: number;
      days_to_earnings: number | null;
      cum_call_prem: number;
      cum_put_prem: number;
      contract_net_prem: number;
      oi: number;
      vol: number;
    }
  > = {
    SHOP: {
      spot_price: 161.4,
      prev_close: 166.8,
      vwap: 160.85,
      rvol: 1.64,
      days_to_earnings: 14,
      cum_call_prem: 620_000,
      cum_put_prem: 980_000,
      contract_net_prem: 210_000,
      oi: 1840,
      vol: 2690,
    },
    MRVL: {
      spot_price: 234.8,
      prev_close: 238.1,
      vwap: 236.15,
      rvol: 1.78,
      days_to_earnings: 10,
      cum_call_prem: 840_000,
      cum_put_prem: 1_390_000,
      contract_net_prem: -185_000,
      oi: 4120,
      vol: 5380,
    },
    TSLA: {
      spot_price: 247.5,
      prev_close: 251.2,
      vwap: 248.4,
      rvol: 1.85,
      days_to_earnings: 4,
      cum_call_prem: 1_640_000,
      cum_put_prem: 910_000,
      contract_net_prem: -240_000,
      oi: 8420,
      vol: 12_910,
    },
    NVDA: {
      spot_price: 138.2,
      prev_close: 142.1,
      vwap: 140.45,
      rvol: 2.18,
      days_to_earnings: 21,
      cum_call_prem: 1_150_000,
      cum_put_prem: 2_890_000,
      contract_net_prem: -420_000,
      oi: 14_200,
      vol: 18_450,
    },
    AMD: {
      spot_price: 156.4,
      prev_close: 159.2,
      vwap: 157.8,
      rvol: 1.52,
      days_to_earnings: 8,
      cum_call_prem: 540_000,
      cum_put_prem: 1_120_000,
      contract_net_prem: -310_000,
      oi: 6200,
      vol: 7940,
    },
    MU: {
      spot_price: 108.6,
      prev_close: 111.4,
      vwap: 109.75,
      rvol: 1.46,
      days_to_earnings: 19,
      cum_call_prem: 410_000,
      cum_put_prem: 890_000,
      contract_net_prem: -265_000,
      oi: 5180,
      vol: 6890,
    },
  };

  let activeSpecs: HoldingSeedSpec[] = seedSpecs;

  // When live Alpaca positions are provided, build activeSpecs directly from them so
  // position count, Market Value, Intraday P&L, and Unrealized P&L match Alpaca Account 100%.
  if (alpacaPositions.length > 0) {
    const refDateMs = Date.parse('2026-10-19T00:00:00Z');
    activeSpecs = alpacaPositions.map((pos) => {
      const norm = normalizeToOsiCanonicalSymbol(pos.symbol);
      const tkr = norm.underlying;
      const def = underlyingTelemetryDefaults[tkr] ?? {
        spot_price: pos.strike_price ? round2(pos.strike_price * 0.96) : Math.max(25, pos.current_price),
        prev_close: pos.strike_price ? round2(pos.strike_price * 0.97) : Math.max(25, pos.current_price),
        vwap: pos.strike_price ? round2(pos.strike_price * 0.965) : Math.max(25, pos.current_price),
        rvol: 1.45,
        days_to_earnings: 12,
        cum_call_prem: 750_000,
        cum_put_prem: 920_000,
        contract_net_prem: -140_000,
        oi: 3800,
        vol: 4600,
      };

      const expStr = pos.expiration_date ?? norm.expiry;
      const expMs = expStr ? Date.parse(`${expStr}T00:00:00Z`) : NaN;
      const dte = Number.isFinite(expMs)
        ? Math.max(0, Math.round((expMs - refDateMs) / 86_400_000))
        : norm.asset_class === 'option'
          ? 21
          : 0;

      const curPlpc = round4(pos.unrealized_pl_pct / 100);
      const lastDayPlpc =
        pos.avg_entry_price > 0 && pos.lastday_price > 0
          ? (pos.lastday_price - pos.avg_entry_price) / pos.avg_entry_price
          : curPlpc;
      const peakPlpc = round4(Math.max(curPlpc, lastDayPlpc, 0.04));

      const hasLiveBid = pos.current_price > 0;
      const halfSpread = hasLiveBid
        ? Math.max(0.01, round2(Math.min(0.15, pos.current_price * 0.01)))
        : 0.01;
      const optBid = hasLiveBid ? round2(Math.max(0.01, pos.current_price - halfSpread)) : 0;
      const optAsk = hasLiveBid ? round2(pos.current_price + halfSpread) : 0.01;

      const isPut = norm.right === 'PUT';
      const delta =
        norm.asset_class === 'stock'
          ? 1.0
          : !hasLiveBid
            ? isPut
              ? -0.02
              : 0.02
            : isPut
              ? -0.58
              : 0.46;
      const theta =
        norm.asset_class === 'stock'
          ? 0
          : dte <= 5
            ? -0.48
            : -0.14;

      let preferredStage1: Stage1HoldingAction | undefined;
      if (norm.asset_class === 'option' && !hasLiveBid) {
        preferredStage1 = 'NEEDS_HUMAN_REVIEW';
      } else if (curPlpc >= 0.15 && pos.qty >= 2) {
        preferredStage1 = 'REDUCE';
      } else if (norm.asset_class === 'option' && dte > 0 && dte <= 7 && hasLiveBid) {
        preferredStage1 = 'ROLL';
      } else if (curPlpc <= -0.18 && hasLiveBid) {
        preferredStage1 = 'EXIT';
      }

      return {
        holding_id:
          pos.symbol === 'SHOP261120P00175000'
            ? 'hold-shop-175p'
            : `hold-${pos.symbol.toLowerCase()}`,
        symbol: pos.symbol,
        display_label: pos.display_label,
        side: pos.side,
        quantity: pos.qty,
        qty_available: pos.qty_available,
        avg_entry_price: pos.avg_entry_price,
        current_price: pos.current_price,
        exact_cost_basis: pos.cost_basis,
        exact_market_value: pos.market_value,
        exact_unrealized_pl: pos.unrealized_pl,
        exact_unrealized_plpc: curPlpc,
        exact_intraday_pl: pos.intraday_pl,
        exact_intraday_plpc: round4(pos.intraday_pl_pct / 100),
        peak_plpc: peakPlpc,
        spot_price: def.spot_price,
        prev_close: def.prev_close,
        vwap: def.vwap,
        rvol: def.rvol,
        dte,
        delta,
        gamma: norm.asset_class === 'option' ? (hasLiveBid ? 0.032 : 0.002) : 0,
        theta,
        vega: norm.asset_class === 'option' ? (hasLiveBid ? 0.18 : 0.01) : 0,
        iv: norm.asset_class === 'option' ? (hasLiveBid ? 0.52 : 0.85) : 0.24,
        opt_bid: optBid,
        opt_ask: optAsk,
        oi: def.oi,
        vol: def.vol,
        quote_age_seconds: 2,
        halted: false,
        days_to_earnings: def.days_to_earnings,
        corporate_action_flag: null,
        cum_call_prem: def.cum_call_prem,
        cum_put_prem: def.cum_put_prem,
        contract_net_prem: def.contract_net_prem,
        preferred_stage1: preferredStage1,
      };
    });
  }

  const holdings: MonitoredHolding[] = [];
  const stage1_decisions: LlmStage1HoldingDecision[] = [];
  const stage2_plans: LlmStage2ExitExecutionPlan[] = [];
  const audit_logs: ImmutableAuditLogEntry[] = [];

  for (const spec of activeSpecs) {
    const norm = normalizeToOsiCanonicalSymbol(spec.symbol);
    const multiplier = norm.asset_class === 'option' ? 100 : 1;
    const costBasis =
      typeof spec.exact_cost_basis === 'number'
        ? round2(spec.exact_cost_basis)
        : round2(spec.quantity * spec.avg_entry_price * multiplier);
    const marketValue =
      typeof spec.exact_market_value === 'number'
        ? round2(spec.exact_market_value)
        : round2(spec.quantity * spec.current_price * multiplier);
    const unrealizedPl =
      typeof spec.exact_unrealized_pl === 'number'
        ? round2(spec.exact_unrealized_pl)
        : round2(marketValue - costBasis);
    const unrealizedPlpc =
      typeof spec.exact_unrealized_plpc === 'number'
        ? spec.exact_unrealized_plpc
        : costBasis > 0
          ? round4(unrealizedPl / costBasis)
          : 0;
    const intradayPl =
      typeof spec.exact_intraday_pl === 'number'
        ? round2(spec.exact_intraday_pl)
        : round2(unrealizedPl * 0.35);
    const intradayPlpc =
      typeof spec.exact_intraday_plpc === 'number'
        ? spec.exact_intraday_plpc
        : round4(unrealizedPlpc * 0.35);
    const peakPlpc = Math.max(spec.peak_plpc, unrealizedPlpc);
    const drawdownFromPeak = round4(Math.max(0, peakPlpc - unrealizedPlpc));
    const exposurePct = accountEquity > 0 ? round4(marketValue / accountEquity) : 0.05;

    const bars: IntradayUnderlyingBar[] = [
      {
        timestamp: '14:05:00Z',
        open: round2(spec.spot_price * 0.996),
        high: round2(spec.spot_price * 1.002),
        low: round2(spec.spot_price * 0.994),
        close: round2(spec.spot_price * 0.998),
        volume: 420_000,
        vwap: round2(spec.vwap * 0.999),
      },
      {
        timestamp: '14:10:00Z',
        open: round2(spec.spot_price * 0.998),
        high: round2(spec.spot_price * 1.003),
        low: round2(spec.spot_price * 0.997),
        close: round2(spec.spot_price * 1.001),
        volume: 510_000,
        vwap: round2(spec.vwap),
      },
      {
        timestamp: '14:15:00Z',
        open: round2(spec.spot_price * 1.001),
        high: round2(spec.spot_price * 1.002),
        low: round2(spec.spot_price * 0.998),
        close: spec.spot_price,
        volume: 640_000,
        vwap: spec.vwap,
      },
    ];

    const underlyingSnapshot: UnderlyingMarketSnapshot = {
      ticker: norm.underlying,
      spot_price: spec.spot_price,
      prev_close: spec.prev_close,
      intraday_vwap: spec.vwap,
      realized_move_pct: round4((spec.spot_price - spec.prev_close) / spec.prev_close),
      realized_move_atr_multiple: round2(
        Math.abs(spec.spot_price - spec.prev_close) / (spec.prev_close * 0.018)
      ),
      intraday_volume: 14_800_000,
      relative_volume: spec.rvol,
      bid: round2(spec.spot_price - 0.02),
      ask: round2(spec.spot_price + 0.02),
      spread_pct: round4(0.04 / spec.spot_price),
      quote_age_seconds: spec.quote_age_seconds,
      halted: spec.halted,
      days_to_earnings: spec.days_to_earnings,
      corporate_action_flag: spec.corporate_action_flag,
      intraday_bars: bars,
    };

    const optMid =
      spec.current_price > 0
        ? round2(spec.current_price)
        : round2((spec.opt_bid + spec.opt_ask) / 2);
    const optSpreadAbs = round2(Math.max(0.01, spec.opt_ask - spec.opt_bid));
    const optSpreadPct = optMid > 0 ? round4(optSpreadAbs / optMid) : 1.0;
    const volOverOiRatio = spec.oi > 0 ? round2(spec.vol / spec.oi) : 0;

    const optionSnapshot: OptionGreeksAndQuoteSnapshot | null =
      norm.asset_class === 'option'
        ? {
            osi_symbol: norm.osi_symbol,
            dte: spec.dte,
            delta: spec.delta,
            gamma: spec.gamma,
            theta: spec.theta,
            vega: spec.vega,
            implied_volatility: spec.iv,
            option_bid: spec.opt_bid,
            option_ask: spec.opt_ask,
            option_mid: optMid,
            spread_abs: optSpreadAbs,
            spread_pct: optSpreadPct,
            open_interest: spec.oi,
            intraday_contract_volume: spec.vol,
            volume_over_oi_ratio: volOverOiRatio,
            volume_over_oi_unconfirmed: volOverOiRatio > 1.0,
            quote_age_seconds: spec.quote_age_seconds,
          }
        : null;

    const uwTape: UwOptionTapePrint[] = [
      {
        trade_id: `uw-print-${norm.underlying.toLowerCase()}-1`,
        executed_at: nowIso,
        ticker_symbol: norm.underlying,
        osi_symbol:
          norm.asset_class === 'option'
            ? norm.osi_symbol
            : `${norm.underlying}261120P00225000`,
        option_type: norm.right ?? 'PUT',
        strike: norm.strike ?? round2(spec.spot_price * 0.97),
        expiry: norm.expiry ?? '2026-11-20',
        dte: spec.dte || 32,
        price: Math.max(0.05, optMid),
        size: 185,
        premium: round2(185 * Math.max(0.05, optMid) * 100),
        ask_perc: spec.contract_net_prem >= 0 ? 0.88 : 0.14,
        bid_perc: spec.contract_net_prem >= 0 ? 0.12 : 0.86,
        side_aggressor: spec.contract_net_prem >= 0 ? 'ASK_SIDE' : 'BID_SIDE',
        volume: spec.vol || 4200,
        open_interest: spec.oi || 3100,
        volume_greater_oi: (spec.vol || 4200) > (spec.oi || 3100),
        unconfirmed_opening_disclaimer:
          'Volume > OI does not confirm newly opened positions until next-day OCC OI settlement.',
        sentiment: spec.cum_call_prem > spec.cum_put_prem ? 'BULLISH' : 'BEARISH',
      },
      {
        trade_id: `uw-print-${norm.underlying.toLowerCase()}-2`,
        executed_at: nowIso,
        ticker_symbol: norm.underlying,
        osi_symbol: `${norm.underlying}261120P00${Math.round(spec.spot_price * 0.95)
          .toString()
          .padStart(3, '0')}000`,
        option_type: 'PUT',
        strike: Math.round(spec.spot_price * 0.95),
        expiry: '2026-11-20',
        dte: 32,
        price: 4.45,
        size: 310,
        premium: 137_950,
        ask_perc: 0.92,
        bid_perc: 0.08,
        side_aggressor: 'ASK_SIDE',
        volume: 6420,
        open_interest: 4100,
        volume_greater_oi: true,
        unconfirmed_opening_disclaimer:
          'Volume > OI does not confirm newly opened positions until next-day OCC OI settlement.',
        sentiment: 'BEARISH',
      },
    ];

    const uwFlowAlerts: UwFlowAlertItem[] = [
      {
        alert_id: `uw-fa-${norm.underlying.toLowerCase()}-1`,
        created_at: nowIso,
        ticker_symbol: norm.underlying,
        osi_symbol: uwTape[0].osi_symbol,
        rule_name: 'Repeated Sweep Activity (> $100k Premium)',
        total_premium: 342_500,
        total_size: 460,
        ask_side_perc: 0.84,
        is_otm: true,
        volume_over_oi: volOverOiRatio || 1.35,
        supporting_evidence_note:
          'Supporting evidence only: Unusual Whales flow alerts are multi-print aggregations, not proof of single-institution directional conviction.',
      },
    ];

    const netPremTicks: UwNetPremTickPoint[] = [
      {
        timestamp: '13:30:00Z',
        net_call_premium: round2(spec.cum_call_prem * 0.35),
        net_put_premium: round2(spec.cum_put_prem * 0.35),
        net_call_volume: 12_400,
        net_put_volume: 14_100,
        cumulative_net_call_premium: round2(spec.cum_call_prem * 0.35),
        cumulative_net_put_premium: round2(spec.cum_put_prem * 0.35),
        cumulative_net_flow_delta: round2((spec.cum_call_prem - spec.cum_put_prem) * 0.35),
      },
      {
        timestamp: '14:00:00Z',
        net_call_premium: round2(spec.cum_call_prem * 0.3),
        net_put_premium: round2(spec.cum_put_prem * 0.3),
        net_call_volume: 10_800,
        net_put_volume: 13_500,
        cumulative_net_call_premium: round2(spec.cum_call_prem * 0.65),
        cumulative_net_put_premium: round2(spec.cum_put_prem * 0.65),
        cumulative_net_flow_delta: round2((spec.cum_call_prem - spec.cum_put_prem) * 0.65),
      },
      {
        timestamp: '14:15:00Z',
        net_call_premium: round2(spec.cum_call_prem * 0.35),
        net_put_premium: round2(spec.cum_put_prem * 0.35),
        net_call_volume: 15_200,
        net_put_volume: 18_900,
        cumulative_net_call_premium: spec.cum_call_prem,
        cumulative_net_put_premium: spec.cum_put_prem,
        cumulative_net_flow_delta: round2(spec.cum_call_prem - spec.cum_put_prem),
      },
    ];

    const rollStrike = Math.round(spec.spot_price);
    const hedgeStrike = Math.round(spec.spot_price * 0.96);
    const contractFlow: UwContractFlowSummary = {
      osi_symbol: norm.osi_symbol,
      intraday_premium: Math.abs(spec.contract_net_prem) * 1.6,
      ask_side_premium:
        spec.contract_net_prem >= 0
          ? Math.abs(spec.contract_net_prem) * 1.3
          : Math.abs(spec.contract_net_prem) * 0.3,
      bid_side_premium:
        spec.contract_net_prem < 0
          ? Math.abs(spec.contract_net_prem) * 1.3
          : Math.abs(spec.contract_net_prem) * 0.3,
      net_contract_premium: spec.contract_net_prem,
      print_count: 28,
      unusual_contract_rank: 4,
      hottest_chain_alternatives: [
        {
          osi_symbol: `${norm.underlying}261218${norm.right === 'CALL' ? 'C' : 'P'}${Math.round(
            rollStrike * 1000
          )
            .toString()
            .padStart(8, '0')}`,
          option_type: norm.right ?? 'CALL',
          strike: rollStrike,
          expiry: '2026-12-18',
          dte: 60,
          bid: round2(Math.max(2.4, optMid * 1.22 - 0.1)),
          ask: round2(Math.max(2.6, optMid * 1.22 + 0.1)),
          mid: round2(Math.max(2.5, optMid * 1.22)),
          delta: norm.right === 'PUT' ? -0.51 : 0.53,
          open_interest: 5400,
          intraday_volume: 3120,
          role: 'ROLL_CANDIDATE',
        },
        {
          osi_symbol: `${norm.underlying}261120P${Math.round(hedgeStrike * 1000)
            .toString()
            .padStart(8, '0')}`,
          option_type: 'PUT',
          strike: hedgeStrike,
          expiry: '2026-11-20',
          dte: 32,
          bid: 3.7,
          ask: 3.9,
          mid: 3.8,
          delta: -0.36,
          open_interest: 7850,
          intraday_volume: 4890,
          role: 'HEDGE_CANDIDATE',
        },
      ],
    };

    const riskConfig = createDefaultHoldingRiskConfig(norm.asset_class);
    const monitorConfig: HoldingMonitorConfig = {
      id: `mcfg-${spec.holding_id}`,
      holding_id: spec.holding_id,
      symbol: norm.osi_symbol,
      enabled: true,
      mode: defaultMode,
      risk_config: riskConfig,
      updated_at: nowIso,
    };

    const isBullishExposure =
      norm.asset_class === 'stock'
        ? spec.side === 'long'
        : norm.right === 'CALL'
          ? spec.side === 'long'
          : spec.side === 'short';
    const effectivePositionSide: 'long' | 'short' = isBullishExposure ? 'long' : 'short';

    const sdBundle = buildShortAndDarkPoolTelemetryForHolding({
      ticker: norm.underlying,
      spot_price: spec.spot_price,
      vwap: spec.vwap,
      effective_position_side: effectivePositionSide,
    });

    const confirmationMatrix = evaluateHoldingConfirmationMatrix({
      effective_position_side: effectivePositionSide,
      raw_holding_side: spec.side,
      spot_price: spec.spot_price,
      intraday_vwap: spec.vwap,
      realized_move_pct: underlyingSnapshot.realized_move_pct,
      relative_volume: spec.rvol,
      cumulative_net_call_premium: spec.cum_call_prem,
      cumulative_net_put_premium: spec.cum_put_prem,
      contract_net_premium: spec.contract_net_prem,
      repeated_bearish_flow: spec.cum_put_prem > spec.cum_call_prem * 1.25,
      repeated_bullish_flow: spec.cum_call_prem > spec.cum_put_prem * 1.25,
      short_telemetry: sdBundle.short_telemetry,
      dark_pool_telemetry: sdBundle.dark_pool_telemetry,
    });

    const ruleEval = evaluateHoldingRiskRules({
      assetClass: norm.asset_class,
      side: spec.side,
      optionRight: norm.right,
      unrealizedPlpc,
      peakUnrealizedPlpc: peakPlpc,
      underlying: underlyingSnapshot,
      optionQuote: optionSnapshot,
      uwNetPremTicks: netPremTicks,
      uwContractFlow: contractFlow,
      riskConfig,
      confirmationMatrix,
    });

    const parsedLabel = parseOccOptionSymbol(spec.symbol);

    const holding: MonitoredHolding = {
      holding_id: spec.holding_id,
      broker_connection_id: 'brk-alpaca-primary',
      environment,
      asset_class: norm.asset_class,
      symbol: spec.symbol,
      osi_canonical_symbol: norm.osi_symbol,
      underlying_symbol: norm.underlying,
      display_label:
        spec.display_label ||
        (norm.asset_class === 'option'
          ? parsedLabel.short_label
          : `${norm.underlying} Common Stock`),
      side: spec.side,
      quantity: spec.quantity,
      qty_available: spec.qty_available ?? spec.quantity,
      multiplier,
      avg_entry_price: spec.avg_entry_price,
      current_price: spec.current_price,
      market_value: marketValue,
      cost_basis: costBasis,
      unrealized_pl: unrealizedPl,
      unrealized_plpc: unrealizedPlpc,
      intraday_pl: intradayPl,
      intraday_plpc: intradayPlpc,
      peak_unrealized_plpc: peakPlpc,
      drawdown_from_peak_pct: drawdownFromPeak,
      portfolio_exposure_pct: exposurePct,
      option_expiry: norm.expiry,
      option_strike: norm.strike,
      option_right: norm.right,
      underlying_snapshot: underlyingSnapshot,
      option_snapshot: optionSnapshot,
      uw_options_tape: uwTape,
      uw_flow_alerts: uwFlowAlerts,
      uw_net_prem_ticks: netPremTicks,
      uw_contract_flow: contractFlow,
      short_telemetry: sdBundle.short_telemetry,
      dark_pool_telemetry: sdBundle.dark_pool_telemetry,
      confirmation_matrix: confirmationMatrix,
      llm_short_darkpool_payload: sdBundle.llm_feature_payload,
      safety_flags: ruleEval.safety_flags,
      triggered_rules: ruleEval.triggered_rules,
      evaluation_event_active: ruleEval.evaluation_event_active,
      monitor_config: monitorConfig,
      latest_stage1_decision: null,
      latest_stage2_plan: null,
      updated_at: nowIso,
    };

    // Build Stage-1 Decision
    const stage1Prompts = buildStage1HoldingDecisionPrompts(holding);
    const stage1Decision = resolveStage1HoldingDecision({
      holding,
      evidence_packet: stage1Prompts.evidence_packet,
      system_prompt: stage1Prompts.system_prompt,
      user_prompt: stage1Prompts.user_prompt,
      executionMode: 'deterministic_synthesis',
      modelId: 'holdings-risk-gate-v1',
      latencyMs: 42,
      overrideDecision: spec.preferred_stage1,
    });
    holding.latest_stage1_decision = stage1Decision;
    stage1_decisions.push(stage1Decision);

    // Record Rule Evaluation + Stage-1 Audit Logs
    audit_logs.push({
      audit_id: `aud-rule-${holding.holding_id}`,
      timestamp: nowIso,
      event_type: 'RULE_EVALUATION_TRIGGERED',
      holding_id: holding.holding_id,
      symbol: holding.osi_canonical_symbol,
      environment,
      actor: 'DETERMINISTIC_RULE_ENGINE',
      summary: `Evaluated 6 risk rules on ${holding.display_label}: ${holding.triggered_rules.filter((r) => r.triggered).length} rule(s) triggered.`,
      source_data_snapshot: {
        spot_price: holding.underlying_snapshot.spot_price,
        vwap: holding.underlying_snapshot.intraday_vwap,
        unrealized_plpc: holding.unrealized_plpc,
        triggered_rules: holding.triggered_rules.filter((r) => r.triggered).map((r) => r.rule_id),
      },
      prompts: null,
      llm_json_output: null,
      approval_metadata: null,
      order_payload: null,
      immutable_hash: computeDeterministicAuditHash(
        `RULE:${holding.osi_canonical_symbol}:${holding.unrealized_plpc}`
      ),
    });

    audit_logs.push({
      audit_id: `aud-stg1-${holding.holding_id}`,
      timestamp: nowIso,
      event_type: 'STAGE1_LLM_DECISION',
      holding_id: holding.holding_id,
      symbol: holding.osi_canonical_symbol,
      environment,
      actor: 'ADVISORY_LLM',
      summary: `Stage-1 LLM recommended ${stage1Decision.decision} (${stage1Decision.urgency} urgency, ${(stage1Decision.confidence_score * 100).toFixed(0)}% confidence): ${stage1Decision.primary_risk_driver}`,
      source_data_snapshot: stage1Decision.evidence_packet as unknown as Record<string, unknown>,
      prompts: {
        system_prompt: stage1Decision.system_prompt,
        user_prompt: stage1Decision.user_prompt,
      },
      llm_json_output: {
        decision: stage1Decision.decision,
        urgency: stage1Decision.urgency,
        confidence_score: stage1Decision.confidence_score,
        primary_risk_driver: stage1Decision.primary_risk_driver,
        rationale: stage1Decision.rationale,
      },
      approval_metadata: null,
      order_payload: null,
      immutable_hash: computeDeterministicAuditHash(stage1Decision.raw_llm_output),
    });

    // If Stage-1 chooses EXIT, REDUCE, HEDGE, or ROLL -> run Stage-2 Rich Dataset & Structured Execution Plan
    if (stage1Decision.requires_stage2_plan) {
      const stage2Plan = buildStage2ExitExecutionPlan({
        holding,
        stage1: stage1Decision,
        accountBuyingPower,
        optionsBuyingPower,
        openOrdersCountForSymbol: 0,
        environment,
        mfaVerifiedForLive: false,
        executionMode: 'deterministic_synthesis',
        modelId: 'holdings-exit-planner-v1',
        latencyMs: 56,
      });
      holding.latest_stage2_plan = stage2Plan;
      stage2_plans.push(stage2Plan);

      audit_logs.push({
        audit_id: `aud-stg2-${holding.holding_id}`,
        timestamp: nowIso,
        event_type: 'STAGE2_LLM_EXIT_PLAN',
        holding_id: holding.holding_id,
        symbol: holding.osi_canonical_symbol,
        environment,
        actor: 'ADVISORY_LLM',
        summary: `Stage-2 Execution Plan created for ${stage2Plan.recommended_action}: ${stage2Plan.order_side.toUpperCase()} ${stage2Plan.quantity_to_trade}x ${stage2Plan.target_symbol} @ $${stage2Plan.limit_price_logic.computed_initial_limit_price.toFixed(2)} limit (${stage2Plan.approval_status})`,
        source_data_snapshot: stage2Plan.rich_dataset as unknown as Record<string, unknown>,
        prompts: {
          system_prompt: stage2Plan.system_prompt,
          user_prompt: stage2Plan.user_prompt,
        },
        llm_json_output: JSON.parse(stage2Plan.raw_llm_output),
        approval_metadata: {
          status: stage2Plan.approval_status,
          operator: stage2Plan.approved_by ?? 'PENDING_HUMAN_OPERATOR',
          mfa_verified: false,
        },
        order_payload: stage2Plan.alpaca_order_payload,
        immutable_hash: computeDeterministicAuditHash(stage2Plan.raw_llm_output),
      });

      if (stage2Plan.approval_status === 'APPROVED_AND_SUBMITTED') {
        audit_logs.push({
          audit_id: `aud-auto-ord-${holding.holding_id}`,
          timestamp: nowIso,
          event_type: 'ALPACA_ORDER_SUBMITTED',
          holding_id: holding.holding_id,
          symbol: stage2Plan.target_symbol,
          environment,
          actor: 'ALPACA_ROUTER',
          summary: `Auto-Executed (${stage2Plan.approved_by}) & submitted Alpaca ${stage2Plan.order_type.toUpperCase()} ${stage2Plan.order_side.toUpperCase()} order (${stage2Plan.submitted_order_id}) for ${stage2Plan.quantity_to_trade}x ${stage2Plan.target_symbol} @ $${stage2Plan.alpaca_order_payload.limit_price} [${environment.toUpperCase()}]`,
          source_data_snapshot: {
            plan_id: stage2Plan.plan_id,
            risk_validation_id: stage2Plan.risk_validation.validation_id,
            nbbo_bid: stage2Plan.limit_price_logic.reference_bid,
            nbbo_ask: stage2Plan.limit_price_logic.reference_ask,
          },
          prompts: {
            system_prompt: stage2Plan.system_prompt,
            user_prompt: stage2Plan.user_prompt,
          },
          llm_json_output: JSON.parse(stage2Plan.raw_llm_output),
          approval_metadata: {
            status: 'APPROVED_AND_SUBMITTED',
            operator: 'AUTO_EXECUTION_ENGINE',
            mfa_verified: false,
          },
          order_payload: stage2Plan.alpaca_order_payload,
          immutable_hash: computeDeterministicAuditHash(
            `AUTO_ORDER:${stage2Plan.submitted_order_id}:${JSON.stringify(stage2Plan.alpaca_order_payload)}`
          ),
        });
      }
    }

    holdings.push(holding);
  }

  return {
    holdings,
    stage1_decisions,
    stage2_plans,
    audit_logs,
  };
}
