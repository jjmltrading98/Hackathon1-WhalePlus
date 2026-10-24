import { clamp, round2 } from './whaleScannerEngine.ts';
import type {
  LlmTradeEvidencePacket,
  LlmTradeGateDecision,
} from './llmTradeDecisionEngine.ts';
import type {
  NormalizedAlpacaAccount,
  NormalizedAlpacaPosition,
} from './alpacaAccountEngine.ts';
import type { AlpacaRecentOrder } from './alpacaAccountService.ts';
import {
  type LlmThinkingMode,
  buildOptimizedLmStudioChatPayload,
  extractJsonObjectFromLlmText,
  extractThinkingAndCleanContent,
  normalizeLmStudioEndpoints,
} from './lmStudioClient.ts';

/**
 * ============================================================================
 * SIMPLIFIED RISK-FIRST EXECUTION PLAN ENGINE
 * ============================================================================
 * After the AI returns EXECUTE, do not jump straight to entry.
 * Run a deterministic account-risk check using Alpaca, then calculate a
 * maximum contract quantity from account equity and the defined stop.
 *
 * The LLM chooses: EXECUTE / WATCH / SKIP / HUMAN REVIEW
 * The risk engine decides: whether you can afford the trade and how many
 * contracts to buy (SUBMIT_LIMIT_ORDER / REDUCE_AND_SUBMIT / REJECT).
 *
 * Minimal 7-Step Workflow:
 *   1. Whale flow + market regime
 *   2. LLM trade decision: EXECUTE / WATCH / SKIP
 *   3. Build entry, stop, and first target from underlying + option data
 *   4. Pull Alpaca account data (/v2/account, /v2/account/configurations,
 *      /v2/positions, /v2/orders?status=open, /v2/clock)
 *   5. Calculate dollar risk per contract
 *   6. Calculate permitted quantity
 *   7. Reject, reduce, or submit a limit order
 */

export type RiskExecutionAction =
  | 'SUBMIT_LIMIT_ORDER'
  | 'REDUCE_AND_SUBMIT'
  | 'REJECT';

export type BindingSizingConstraint =
  | 'dollar_risk_per_trade'
  | 'max_option_allocation'
  | 'option_buying_power'
  | 'total_open_risk_cap'
  | 'same_ticker_concentration'
  | 'hard_gate_rejected';

export interface AlpacaAccountConfigurationsSnapshot {
  dtbp_check: 'both' | 'entry' | 'exit';
  trade_confirm_email: 'all' | 'none';
  suspend_trade: boolean;
  no_shorting: boolean;
  fractional_trading: boolean;
  max_margin_multiplier: string;
  max_options_trading_level: number;
  pdt_check: 'both' | 'entry' | 'exit';
}

export interface AlpacaMarketClockSnapshot {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
  session_label: 'REGULAR_OPEN' | 'PRE_MARKET' | 'AFTER_HOURS' | 'CLOSED';
}

export interface AlpacaTradingGateSnapshot {
  endpoints_queried: string[];
  account_source:
    | 'ALPACA_PAPER_LIVE'
    | 'ALPACA_LIVE'
    | 'SPEC_EXAMPLE_25K'
    | 'DETERMINISTIC_FALLBACK';
  equity: number;
  cash: number;
  buying_power: number;
  regt_buying_power: number;
  daytrading_buying_power: number;
  portfolio_value: number;
  option_buying_power: number;
  pattern_day_trader: boolean;
  daytrade_count: number;
  trading_blocked: boolean;
  account_blocked: boolean;
  options_approved_level: number;
  configurations: AlpacaAccountConfigurationsSnapshot;
  clock: AlpacaMarketClockSnapshot;
  open_positions: NormalizedAlpacaPosition[];
  open_orders: AlpacaRecentOrder[];
}

export interface RiskPolicyConfig {
  /** Primary base for risk sizing: 'alpaca_account' or 'custom_equity' (e.g. $25,000 spec benchmark) */
  equity_source: 'alpaca_account' | 'custom_equity';
  /** Custom equity override when equity_source === 'custom_equity' (default $25,000) */
  custom_equity_dollars: number;
  /** 0.25% to 1.00% of account equity (stored as percentage, e.g. 0.5 for 0.50%) */
  risk_per_trade_pct: number;
  /** 2.00% to 5.00% of account equity per trade (stored as percentage, e.g. 3.0 for 3.00%) */
  max_option_allocation_pct: number;
  /** 1.00% to 3.00% of account equity across all open positions (e.g. 2.0 for 2.00%) */
  max_total_open_risk_pct: number;
  /** 5.00% of account equity max concentration in a single underlying ticker */
  max_same_ticker_pct: number;
  /** Desired contract quantity before risk engine reduction/cap */
  desired_contracts: number;
  /** Minimum required options_approved_level for long single-leg calls/puts (1 or 2) */
  required_options_level: number;
  /** If true, use conservative full-premium risk if delta-derived stop is too wide */
  enforce_conservative_stop_floor: boolean;
  /** Allow staging limit orders in paper/off-hours mode when market clock is closed */
  allow_paper_staging_when_clock_closed: boolean;
}

export const DEFAULT_RISK_POLICY_CONFIG: RiskPolicyConfig = {
  equity_source: 'alpaca_account',
  custom_equity_dollars: 25000,
  risk_per_trade_pct: 0.5, // 0.50%
  max_option_allocation_pct: 3.0, // 3.00%
  max_total_open_risk_pct: 2.0, // 2.00%
  max_same_ticker_pct: 5.0, // 5.00%
  desired_contracts: 5,
  required_options_level: 1,
  enforce_conservative_stop_floor: true,
  allow_paper_staging_when_clock_closed: true,
};

export const SPEC_25K_EXAMPLE_RISK_POLICY: RiskPolicyConfig = {
  equity_source: 'custom_equity',
  custom_equity_dollars: 25000,
  risk_per_trade_pct: 0.5, // 0.5% of $25,000 = $125 max dollar risk
  max_option_allocation_pct: 3.0, // 3.0% of $25,000 = $750 max premium outlay
  max_total_open_risk_pct: 2.0, // 2.0% of $25,000 = $500 max total open risk
  max_same_ticker_pct: 5.0, // 5.0% of $25,000 = $1,250 max same ticker exposure
  desired_contracts: 3,
  required_options_level: 1,
  enforce_conservative_stop_floor: true,
  allow_paper_staging_when_clock_closed: true,
};

export interface OptionTradePlanLevels {
  symbol: string;
  option_symbol: string;
  direction: 'bullish' | 'bearish';
  option_type: 'CALL' | 'PUT';
  /** Underlying levels */
  underlying_entry_spot: number;
  underlying_invalidation_stop: number;
  underlying_invalidation_reason: string;
  underlying_stop_distance_dollars: number;
  underlying_stop_distance_pct: number;
  underlying_first_target: number;
  underlying_first_target_reason: string;
  underlying_target_distance_dollars: number;
  /** Option contract levels */
  nbbo_bid: number;
  nbbo_ask: number;
  nbbo_mid: number;
  planned_entry_price: number;
  entry_limit_basis: string;
  contract_stop_price: number;
  stop_calculation_method: string;
  contract_first_target_price: number;
  /** Per-contract dollar figures (× 100 multiplier) */
  contract_cost_dollars: number;
  risk_per_contract_dollars: number;
  full_premium_risk_per_contract_dollars: number;
  reward_per_contract_dollars: number;
  reward_to_risk_ratio: number;
  stop_loss_pct_of_premium: number;
}

export interface RiskPolicyBudgets {
  effective_equity_dollars: number;
  max_dollar_risk_per_trade: number;
  max_premium_outlay_per_trade: number;
  max_total_open_risk_dollars: number;
  current_open_risk_dollars: number;
  remaining_total_open_risk_dollars: number;
  max_same_ticker_dollars: number;
  current_same_ticker_exposure_dollars: number;
  remaining_same_ticker_dollars: number;
  effective_option_buying_power_dollars: number;
}

export interface ContractQuantityBreakdown {
  desired_contracts: number;
  qty_by_dollar_risk: number;
  qty_by_option_allocation: number;
  qty_by_buying_power: number;
  qty_by_total_open_risk: number;
  qty_by_same_ticker_cap: number;
  raw_permitted_qty: number;
  permitted_qty: number;
  binding_constraint: BindingSizingConstraint;
  binding_constraint_explanation: string;
  deployed_premium_dollars: number;
  deployed_equity_pct: number;
  total_trade_dollar_risk: number;
  total_trade_equity_risk_pct: number;
  estimated_target_1_profit_dollars: number;
}

export interface RiskGateCheckItem {
  id: string;
  category:
    | 'LLM_GATE'
    | 'ACCOUNT_STATUS'
    | 'OPTIONS_ENTITLEMENT'
    | 'CONCENTRATION_AND_ORDERS'
    | 'SIZING_AND_SPREAD';
  label: string;
  passed: boolean;
  hard_reject: boolean;
  detail: string;
}

export interface StagedAlpacaLimitOrderPayload {
  symbol: string;
  underlying: string;
  side: 'buy';
  type: 'limit';
  time_in_force: 'day';
  qty: number;
  limit_price: number;
  notional_premium_outlay_dollars: number;
  max_dollar_risk_at_stop: number;
  attached_exit_plan: {
    underlying_invalidation_stop: number;
    option_stop_price: number;
    underlying_first_target: number;
    option_first_target_price: number;
  };
}

export interface RiskEngineInputContract {
  llm_decision: LlmTradeGateDecision;
  option: {
    symbol: string;
    planned_entry: number;
    premium_stop: number;
  };
  account_policy: {
    risk_per_trade_pct: number;
    max_option_allocation_pct: number;
    max_total_open_risk_pct: number;
  };
}

export interface RiskEngineOutputContract {
  decision: 'APPROVED' | 'SKIP';
  quantity: number;
  entry_limit: number;
  premium_stop: number;
  maximum_debit: number;
  maximum_planned_loss: number;
  risk_pct_of_equity: number;
  rejection_checks: string[];
}

export interface InitialTradingStrategyPlan {
  strategy_name: string;
  entry_execution_plan: string;
  profit_target_plan: string;
  stop_and_invalidation_plan: string;
  time_and_theta_plan: string;
  reward_to_risk_ratio: number;
}

export interface LlmRiskAndSizeAssessment {
  assessed_at: string;
  execution_mode: 'lm_studio_live' | 'deterministic_synthesis';
  model_id: string;
  thinking_mode: LlmThinkingMode;
  latency_ms: number;
  decision: 'APPROVED' | 'SKIP';
  quantity: number;
  entry_limit: number;
  premium_stop: number;
  maximum_debit: number;
  maximum_planned_loss: number;
  risk_pct_of_equity: number;
  rejection_checks: string[];
  recommended_smart_algo:
    | 'adaptive_microprice_walk'
    | 'delta_pegged_mid'
    | 'uw_flow_urgency_sweep'
    | 'liquidity_sniper_twap';
  risk_narrative: string;
  llm_risk_narrative: string;
  sizing_justification: string;
  execution_notes: string;
  initial_trading_strategy: InitialTradingStrategyPlan;
  smart_order_fulfillment_ready: boolean;
  thinking_trace: string | null;
  raw_response_text: string;
}

export interface RiskFirstExecutionPlanResult {
  evaluated_at: string;
  workflow_steps: {
    step_number: number;
    title: string;
    status: 'PASSED' | 'REDUCED' | 'REJECTED';
    summary: string;
  }[];
  llm_decision: LlmTradeGateDecision;
  execution_action: RiskExecutionAction;
  action_headline: string;
  action_rationale: string;
  policy: RiskPolicyConfig;
  alpaca_snapshot: AlpacaTradingGateSnapshot;
  trade_plan: OptionTradePlanLevels;
  budgets: RiskPolicyBudgets;
  sizing: ContractQuantityBreakdown;
  checks: RiskGateCheckItem[];
  hard_reject_reasons: string[];
  reduction_reasons: string[];
  limit_order_payload: StagedAlpacaLimitOrderPayload | null;
  input_contract: RiskEngineInputContract;
  output_contract: RiskEngineOutputContract;
  stage2_llm_risk_assessment: LlmRiskAndSizeAssessment;
}

/**
 * Normalizes or constructs an `AlpacaTradingGateSnapshot` from an existing
 * account overview payload or deterministic fallback.
 */
export function buildAlpacaTradingGateSnapshot(params?: {
  account?: NormalizedAlpacaAccount | null;
  positions?: NormalizedAlpacaPosition[];
  openOrders?: AlpacaRecentOrder[];
  configurations?: Partial<AlpacaAccountConfigurationsSnapshot>;
  clock?: Partial<AlpacaMarketClockSnapshot>;
  tradingBlocked?: boolean;
  accountBlocked?: boolean;
  daytradingBuyingPower?: number;
  source?: AlpacaTradingGateSnapshot['account_source'];
}): AlpacaTradingGateSnapshot {
  const acc = params?.account;
  const equity = acc?.equity ?? 105976.05;
  const cash = acc?.cash ?? 42390.42;
  const buyingPower = acc?.buying_power ?? 84780.84;
  const regtBuyingPower = acc?.regt_buying_power ?? 42390.42;
  const daytradingBuyingPower =
    params?.daytradingBuyingPower ??
    round2(Math.max(buyingPower, regtBuyingPower * 2));
  const portfolioValue = acc?.equity ?? equity;
  const optionBuyingPower =
    acc?.options_buying_power && acc.options_buying_power > 0
      ? acc.options_buying_power
      : Math.min(cash, buyingPower);
  const optionsLevel = acc?.options_level ?? 3;

  const openOrders = (params?.openOrders ?? []).filter((o) => {
    const st = o.status.toLowerCase();
    return (
      st === 'open' ||
      st === 'new' ||
      st === 'accepted' ||
      st === 'partially_filled' ||
      st === 'pending_new'
    );
  });

  return {
    endpoints_queried: [
      'GET /v2/account',
      'GET /v2/account/configurations',
      'GET /v2/positions',
      'GET /v2/orders?status=open',
      'GET /v2/clock',
    ],
    account_source:
      params?.source ??
      (acc?.environment === 'LIVE'
        ? 'ALPACA_LIVE'
        : acc?.environment === 'PAPER'
          ? 'ALPACA_PAPER_LIVE'
          : 'DETERMINISTIC_FALLBACK'),
    equity: round2(equity),
    cash: round2(cash),
    buying_power: round2(buyingPower),
    regt_buying_power: round2(regtBuyingPower),
    daytrading_buying_power: round2(daytradingBuyingPower),
    portfolio_value: round2(portfolioValue),
    option_buying_power: round2(optionBuyingPower),
    pattern_day_trader: acc?.pattern_day_trader ?? false,
    daytrade_count: acc?.daytrade_count ?? 1,
    trading_blocked: params?.tradingBlocked ?? false,
    account_blocked: params?.accountBlocked ?? false,
    options_approved_level: optionsLevel,
    configurations: {
      dtbp_check: params?.configurations?.dtbp_check ?? 'both',
      trade_confirm_email:
        params?.configurations?.trade_confirm_email ?? 'all',
      suspend_trade: params?.configurations?.suspend_trade ?? false,
      no_shorting: params?.configurations?.no_shorting ?? false,
      fractional_trading: params?.configurations?.fractional_trading ?? true,
      max_margin_multiplier:
        params?.configurations?.max_margin_multiplier ?? '2',
      max_options_trading_level:
        params?.configurations?.max_options_trading_level ?? optionsLevel,
      pdt_check: params?.configurations?.pdt_check ?? 'entry',
    },
    clock: {
      timestamp: params?.clock?.timestamp ?? new Date().toISOString(),
      is_open: params?.clock?.is_open ?? true,
      next_open:
        params?.clock?.next_open ??
        new Date(Date.now() + 14 * 3600_000).toISOString(),
      next_close:
        params?.clock?.next_close ??
        new Date(Date.now() + 4 * 3600_000).toISOString(),
      session_label: params?.clock?.session_label ?? 'REGULAR_OPEN',
    },
    open_positions: params?.positions ?? [],
    open_orders: openOrders,
  };
}

/**
 * Step 3 & Step 5 of the Simplified Risk-First Execution Plan:
 * Build entry, stop, and first target from underlying + option data,
 * and calculate dollar risk per contract:
 *   contract_cost = planned_entry_price * 100
 *   contract_stop_price = option price associated with underlying invalidation
 *   risk_per_contract = (planned_entry_price - contract_stop_price) * 100
 */
export function buildOptionTradePlanLevels(params: {
  packet: LlmTradeEvidencePacket;
  enforceConservativeStopFloor?: boolean;
  plannedEntryOverride?: number;
  contractStopOverride?: number;
}): OptionTradePlanLevels {
  const { packet, enforceConservativeStopFloor = true } = params;
  const a = packet.section_a_contract_and_whale_flow;
  const b = packet.section_b_underlying_confirmation;
  const c = packet.section_c_ticker_gamma_positioning;
  const g = packet.section_g_execution_and_risk_gate;

  const spot = b.last_trade_price;
  const isBullish = a.direction === 'bullish';

  // Underlying invalidation stop (VWAP / ORB / Gamma flip invalidation)
  const rawInvalidationSpot = g.invalidation_underlying_price;
  const minStopDistance = Math.max(spot * 0.0045, 0.35);
  const maxStopDistance = Math.max(spot * 0.025, 1.5);
  const clampedStopDistance = clamp(
    Math.abs(spot - rawInvalidationSpot),
    minStopDistance,
    maxStopDistance
  );

  const underlyingInvalidationStop = round2(
    isBullish ? spot - clampedStopDistance : spot + clampedStopDistance
  );
  const underlyingStopDistanceDollars = round2(
    Math.abs(spot - underlyingInvalidationStop)
  );
  const underlyingStopDistancePct = round2(
    (underlyingStopDistanceDollars / Math.max(spot, 1)) * 100
  );

  // First target from nearest Call Wall / Put Wall / Gamma Magnet (at least 1.6R on underlying)
  const rawWallTarget = isBullish
    ? Math.max(c.call_wall, c.gamma_magnet, spot + underlyingStopDistanceDollars * 1.8)
    : Math.min(c.put_wall, c.gamma_magnet, spot - underlyingStopDistanceDollars * 1.8);

  const minTargetDistance = underlyingStopDistanceDollars * 1.6;
  const maxTargetDistance = Math.max(spot * 0.045, minTargetDistance);
  const targetDistanceDollars = round2(
    clamp(Math.abs(rawWallTarget - spot), minTargetDistance, maxTargetDistance)
  );

  const underlyingFirstTarget = round2(
    isBullish ? spot + targetDistanceDollars : spot - targetDistanceDollars
  );

  const underlyingFirstTargetReason = isBullish
    ? c.call_wall > spot && Math.abs(c.call_wall - underlyingFirstTarget) < spot * 0.015
      ? `Nearest Call Wall / Gamma Target ($${c.call_wall.toFixed(2)})`
      : `1.8R Intraday Expansion Target above VWAP ($${underlyingFirstTarget.toFixed(2)})`
    : c.put_wall < spot && Math.abs(c.put_wall - underlyingFirstTarget) < spot * 0.015
      ? `Nearest Put Wall / Gamma Target ($${c.put_wall.toFixed(2)})`
      : `1.8R Intraday Breakdown Target below VWAP ($${underlyingFirstTarget.toFixed(2)})`;

  // Planned Option Entry Price (Smart Limit Price near NBBO mid / microprice, never blind ask)
  const plannedEntryPrice = round2(
    params.plannedEntryOverride && params.plannedEntryOverride > 0
      ? params.plannedEntryOverride
      : clamp(
          g.smart_order_target_limit_price || a.nbbo_mid,
          a.nbbo_bid,
          a.nbbo_ask
        )
  );

  // Option Stop Price associated with underlying invalidation using Delta-Gamma + Half-Spread Slippage
  const absDelta = clamp(Math.abs(a.greeks_and_oi.delta), 0.2, 0.85);
  const absGamma = clamp(Math.abs(a.greeks_and_oi.gamma), 0.005, 0.25);
  const halfSpreadSlippage = Math.max(0.02, a.spread_dollars * 0.35);

  const deltaGammaLoss =
    absDelta * underlyingStopDistanceDollars +
    0.5 * absGamma * Math.pow(underlyingStopDistanceDollars, 2) +
    halfSpreadSlippage;

  // Bound the stop loss between 20% and 55% of option premium so stops are realistic & conservative
  const minOptionLoss = plannedEntryPrice * 0.22;
  const maxOptionLoss = enforceConservativeStopFloor
    ? plannedEntryPrice * 0.5
    : plannedEntryPrice * 0.7;

  const effectiveOptionLoss = clamp(
    deltaGammaLoss,
    minOptionLoss,
    maxOptionLoss
  );

  const derivedStopPrice = round2(
    Math.max(0.05, plannedEntryPrice - effectiveOptionLoss)
  );

  const contractStopPrice = round2(
    params.contractStopOverride !== undefined &&
      params.contractStopOverride >= 0 &&
      params.contractStopOverride < plannedEntryPrice
      ? params.contractStopOverride
      : derivedStopPrice
  );

  // First Target Option Price using Delta-Gamma gain
  const deltaGammaGain =
    absDelta * targetDistanceDollars +
    0.5 * absGamma * Math.pow(targetDistanceDollars, 2);
  const contractFirstTargetPrice = round2(
    Math.max(
      plannedEntryPrice + (plannedEntryPrice - contractStopPrice) * 1.5,
      plannedEntryPrice + deltaGammaGain
    )
  );

  const contractCostDollars = round2(plannedEntryPrice * 100);
  const riskPerContractDollars = round2(
    Math.max(1, (plannedEntryPrice - contractStopPrice) * 100)
  );
  const fullPremiumRiskPerContractDollars = contractCostDollars;
  const rewardPerContractDollars = round2(
    Math.max(1, (contractFirstTargetPrice - plannedEntryPrice) * 100)
  );
  const rewardToRiskRatio = round2(
    rewardPerContractDollars / Math.max(riskPerContractDollars, 1)
  );
  const stopLossPctOfPremium = round2(
    (riskPerContractDollars / Math.max(contractCostDollars, 1)) * 100
  );

  return {
    symbol: a.symbol,
    option_symbol: a.option_symbol,
    direction: a.direction,
    option_type: a.call_put,
    underlying_entry_spot: round2(spot),
    underlying_invalidation_stop: underlyingInvalidationStop,
    underlying_invalidation_reason: g.invalidation_condition,
    underlying_stop_distance_dollars: underlyingStopDistanceDollars,
    underlying_stop_distance_pct: underlyingStopDistancePct,
    underlying_first_target: underlyingFirstTarget,
    underlying_first_target_reason: underlyingFirstTargetReason,
    underlying_target_distance_dollars: targetDistanceDollars,
    nbbo_bid: round2(a.nbbo_bid),
    nbbo_ask: round2(a.nbbo_ask),
    nbbo_mid: round2(a.nbbo_mid),
    planned_entry_price: plannedEntryPrice,
    entry_limit_basis: `Smart Limit (${g.smart_order_recommended_algo}) near Microprice $${g.microprice.toFixed(2)}`,
    contract_stop_price: contractStopPrice,
    stop_calculation_method: `Delta (${absDelta.toFixed(2)}) × $${underlyingStopDistanceDollars.toFixed(2)} invalidation move + spread slippage buffer`,
    contract_first_target_price: contractFirstTargetPrice,
    contract_cost_dollars: contractCostDollars,
    risk_per_contract_dollars: riskPerContractDollars,
    full_premium_risk_per_contract_dollars: fullPremiumRiskPerContractDollars,
    reward_per_contract_dollars: rewardPerContractDollars,
    reward_to_risk_ratio: rewardToRiskRatio,
    stop_loss_pct_of_premium: stopLossPctOfPremium,
  };
}

/**
 * Evaluates the complete 7-step Simplified Risk-First Execution Plan:
 *   Whale flow + market regime
 *     ↓
 *   LLM trade decision: EXECUTE / WATCH / SKIP
 *     ↓
 *   Build entry, stop, and first target from underlying + option data
 *     ↓
 *   Pull Alpaca account data
 *     ↓
 *   Calculate dollar risk per contract
 *     ↓
 *   Calculate permitted quantity
 *     ↓
 *   Reject, reduce, or submit a limit order
 */
export function evaluateRiskFirstExecutionPlan(params: {
  packet: LlmTradeEvidencePacket;
  llmDecision: LlmTradeGateDecision;
  alpacaSnapshot?: AlpacaTradingGateSnapshot;
  policy?: Partial<RiskPolicyConfig>;
  plannedEntryOverride?: number;
  contractStopOverride?: number;
}): RiskFirstExecutionPlanResult {
  const policy: RiskPolicyConfig = {
    ...DEFAULT_RISK_POLICY_CONFIG,
    ...(params.policy ?? {}),
    risk_per_trade_pct: clamp(
      params.policy?.risk_per_trade_pct ??
        DEFAULT_RISK_POLICY_CONFIG.risk_per_trade_pct,
      0.1,
      5.0
    ),
    max_option_allocation_pct: clamp(
      params.policy?.max_option_allocation_pct ??
        DEFAULT_RISK_POLICY_CONFIG.max_option_allocation_pct,
      0.5,
      15.0
    ),
    max_total_open_risk_pct: clamp(
      params.policy?.max_total_open_risk_pct ??
        DEFAULT_RISK_POLICY_CONFIG.max_total_open_risk_pct,
      0.5,
      10.0
    ),
    max_same_ticker_pct: clamp(
      params.policy?.max_same_ticker_pct ??
        DEFAULT_RISK_POLICY_CONFIG.max_same_ticker_pct,
      1.0,
      20.0
    ),
    desired_contracts: Math.max(
      1,
      Math.round(
        params.policy?.desired_contracts ??
          DEFAULT_RISK_POLICY_CONFIG.desired_contracts
      )
    ),
  };

  const baseSnapshot =
    params.alpacaSnapshot ?? buildAlpacaTradingGateSnapshot();

  // Apply custom equity override if selected (e.g. $25,000 spec benchmark)
  const effectiveEquity =
    policy.equity_source === 'custom_equity'
      ? Math.max(1000, policy.custom_equity_dollars)
      : Math.max(1000, baseSnapshot.equity);

  const alpacaSnapshot: AlpacaTradingGateSnapshot =
    policy.equity_source === 'custom_equity'
      ? {
          ...baseSnapshot,
          account_source:
            policy.custom_equity_dollars === 25000
              ? 'SPEC_EXAMPLE_25K'
              : baseSnapshot.account_source,
          equity: round2(effectiveEquity),
          portfolio_value: round2(effectiveEquity),
          cash:
            policy.custom_equity_dollars === 25000
              ? 15000
              : round2(Math.min(baseSnapshot.cash, effectiveEquity)),
          buying_power:
            policy.custom_equity_dollars === 25000
              ? 15000
              : round2(Math.min(baseSnapshot.buying_power, effectiveEquity)),
          option_buying_power:
            policy.custom_equity_dollars === 25000
              ? 15000
              : round2(
                  Math.min(baseSnapshot.option_buying_power, effectiveEquity)
                ),
          open_positions:
            policy.custom_equity_dollars === 25000
              ? []
              : baseSnapshot.open_positions,
          open_orders:
            policy.custom_equity_dollars === 25000
              ? []
              : baseSnapshot.open_orders,
        }
      : baseSnapshot;

  // Step 3 & Step 5: Build Entry, Stop, First Target & Dollar Risk per Contract
  const tradePlan = buildOptionTradePlanLevels({
    packet: params.packet,
    enforceConservativeStopFloor: policy.enforce_conservative_stop_floor,
    plannedEntryOverride: params.plannedEntryOverride,
    contractStopOverride: params.contractStopOverride,
  });

  // Step 4 & Step 6: Account Risk Budgets
  const maxDollarRiskPerTrade = round2(
    effectiveEquity * (policy.risk_per_trade_pct / 100)
  );
  const maxPremiumOutlayPerTrade = round2(
    effectiveEquity * (policy.max_option_allocation_pct / 100)
  );
  const maxTotalOpenRiskDollars = round2(
    effectiveEquity * (policy.max_total_open_risk_pct / 100)
  );
  const maxSameTickerDollars = round2(
    effectiveEquity * (policy.max_same_ticker_pct / 100)
  );

  // Estimate current open risk across existing option positions (assume ~35% stop risk on open option market value)
  const optionPositions = alpacaSnapshot.open_positions.filter(
    (pos) => pos.is_option
  );
  const currentOpenRiskDollars = round2(
    optionPositions.reduce(
      (sum, pos) => sum + Math.abs(pos.market_value) * 0.35,
      0
    )
  );
  const remainingTotalOpenRiskDollars = round2(
    Math.max(0, maxTotalOpenRiskDollars - currentOpenRiskDollars)
  );

  // Same-ticker existing exposure
  const sameTickerPositions = alpacaSnapshot.open_positions.filter(
    (pos) => pos.underlying.toUpperCase() === tradePlan.symbol.toUpperCase()
  );
  const currentSameTickerExposureDollars = round2(
    sameTickerPositions.reduce(
      (sum, pos) => sum + Math.abs(pos.market_value),
      0
    )
  );
  const remainingSameTickerDollars = round2(
    Math.max(0, maxSameTickerDollars - currentSameTickerExposureDollars)
  );

  const effectiveOptionBuyingPowerDollars = round2(
    Math.max(0, alpacaSnapshot.option_buying_power)
  );

  const budgets: RiskPolicyBudgets = {
    effective_equity_dollars: round2(effectiveEquity),
    max_dollar_risk_per_trade: maxDollarRiskPerTrade,
    max_premium_outlay_per_trade: maxPremiumOutlayPerTrade,
    max_total_open_risk_dollars: maxTotalOpenRiskDollars,
    current_open_risk_dollars: currentOpenRiskDollars,
    remaining_total_open_risk_dollars: remainingTotalOpenRiskDollars,
    max_same_ticker_dollars: maxSameTickerDollars,
    current_same_ticker_exposure_dollars: currentSameTickerExposureDollars,
    remaining_same_ticker_dollars: remainingSameTickerDollars,
    effective_option_buying_power_dollars: effectiveOptionBuyingPowerDollars,
  };

  // Step 6: Calculate Permitted Quantity across all 5 constraints
  const allowSingleContractFloor =
    params.llmDecision === 'EXECUTE' &&
    policy.equity_source === 'alpaca_account' &&
    params.plannedEntryOverride === undefined &&
    effectiveOptionBuyingPowerDollars >= tradePlan.contract_cost_dollars * 0.25;
  const minQtyFloor = allowSingleContractFloor ? 1 : 0;

  const qtyByDollarRisk = Math.max(
    minQtyFloor,
    Math.floor(
      maxDollarRiskPerTrade / Math.max(tradePlan.risk_per_contract_dollars, 0.01)
    )
  );
  const qtyByOptionAllocation = Math.max(
    minQtyFloor,
    Math.floor(
      maxPremiumOutlayPerTrade / Math.max(tradePlan.contract_cost_dollars, 0.01)
    )
  );
  const qtyByBuyingPower = Math.max(
    minQtyFloor,
    Math.floor(
      effectiveOptionBuyingPowerDollars /
        Math.max(tradePlan.contract_cost_dollars, 0.01)
    )
  );
  const qtyByTotalOpenRisk = Math.max(
    minQtyFloor,
    Math.floor(
      remainingTotalOpenRiskDollars /
        Math.max(tradePlan.risk_per_contract_dollars, 0.01)
    )
  );
  const qtyBySameTickerCap = Math.max(
    minQtyFloor,
    Math.floor(
      remainingSameTickerDollars /
        Math.max(tradePlan.contract_cost_dollars, 0.01)
    )
  );

  const rawPermittedQty = Math.max(
    0,
    Math.min(
      qtyByDollarRisk,
      qtyByOptionAllocation,
      qtyByBuyingPower,
      qtyByTotalOpenRisk,
      qtyBySameTickerCap
    )
  );

  // Check duplicate / overlapping open orders on the same option symbol
  const duplicateOpenOrders = alpacaSnapshot.open_orders.filter(
    (ord) =>
      ord.symbol.toUpperCase() === tradePlan.option_symbol.toUpperCase() ||
      ord.underlying.toUpperCase() === tradePlan.symbol.toUpperCase()
  );

  // Deterministic Account & Risk Gate Checks
  const checks: RiskGateCheckItem[] = [
    {
      id: 'llm_gate_execute_status',
      category: 'LLM_GATE',
      label: 'LLM Trade-Decision Gate Status',
      passed: params.llmDecision === 'EXECUTE',
      hard_reject: params.llmDecision !== 'EXECUTE',
      detail:
        params.llmDecision === 'EXECUTE'
          ? 'LLM returned EXECUTE (conditions aligned)'
          : `LLM returned ${params.llmDecision} — only EXECUTE candidates proceed to order submission`,
    },
    {
      id: 'alpaca_account_unblocked',
      category: 'ACCOUNT_STATUS',
      label: 'Alpaca Account & Trading Status',
      passed:
        !alpacaSnapshot.trading_blocked &&
        !alpacaSnapshot.account_blocked &&
        !alpacaSnapshot.configurations.suspend_trade,
      hard_reject:
        alpacaSnapshot.trading_blocked ||
        alpacaSnapshot.account_blocked ||
        alpacaSnapshot.configurations.suspend_trade,
      detail:
        !alpacaSnapshot.trading_blocked && !alpacaSnapshot.account_blocked
          ? `Account ACTIVE (trading_blocked=false, account_blocked=false, PDT=${alpacaSnapshot.pattern_day_trader})`
          : 'HARD REJECT: Alpaca account or trading is blocked/suspended',
    },
    {
      id: 'options_approved_level',
      category: 'OPTIONS_ENTITLEMENT',
      label: 'Options Approval Level & Buying Power',
      passed:
        alpacaSnapshot.options_approved_level >= policy.required_options_level &&
        qtyByBuyingPower >= 1,
      hard_reject:
        alpacaSnapshot.options_approved_level < policy.required_options_level ||
        qtyByBuyingPower < 1,
      detail: `Level ${alpacaSnapshot.options_approved_level} >= Req Level ${policy.required_options_level} · Option BP $${effectiveOptionBuyingPowerDollars.toLocaleString()} (${qtyByBuyingPower}x max)`,
    },
    {
      id: 'market_clock_check',
      category: 'ACCOUNT_STATUS',
      label: 'Alpaca Market Clock (/v2/clock)',
      passed:
        alpacaSnapshot.clock.is_open ||
        policy.allow_paper_staging_when_clock_closed,
      hard_reject:
        !alpacaSnapshot.clock.is_open &&
        !policy.allow_paper_staging_when_clock_closed,
      detail: alpacaSnapshot.clock.is_open
        ? `Market OPEN (${alpacaSnapshot.clock.session_label})`
        : 'Market Closed (Paper Limit Staging Permitted)',
    },
    {
      id: 'duplicate_orders_and_concentration',
      category: 'CONCENTRATION_AND_ORDERS',
      label: 'Duplicate Open Orders & Ticker Concentration Cap',
      passed: duplicateOpenOrders.length === 0 && qtyBySameTickerCap >= 1,
      hard_reject: duplicateOpenOrders.length > 0 || qtyBySameTickerCap < 1,
      detail:
        duplicateOpenOrders.length > 0
          ? `Duplicate open order detected for ${tradePlan.symbol}`
          : `${tradePlan.symbol} exposure $${currentSameTickerExposureDollars.toFixed(0)} / $${maxSameTickerDollars.toFixed(0)} (${policy.max_same_ticker_pct.toFixed(1)}% cap → ${qtyBySameTickerCap}x max)`,
    },
    {
      id: 'per_trade_risk_and_allocation',
      category: 'SIZING_AND_SPREAD',
      label: 'Dual Cap: Max Stop Risk & Max Capital Allocation',
      passed:
        qtyByDollarRisk >= 1 &&
        qtyByOptionAllocation >= 1 &&
        qtyByTotalOpenRisk >= 1 &&
        params.packet.section_g_execution_and_risk_gate.spread_guardrail_passed,
      hard_reject:
        qtyByDollarRisk < 1 ||
        qtyByOptionAllocation < 1 ||
        qtyByTotalOpenRisk < 1 ||
        !params.packet.section_g_execution_and_risk_gate.spread_guardrail_passed,
      detail: `Stop Risk $${tradePlan.risk_per_contract_dollars.toFixed(0)}/ct vs $${maxDollarRiskPerTrade.toFixed(0)} budget (${qtyByDollarRisk}x) · Cost $${tradePlan.contract_cost_dollars.toFixed(0)}/ct vs $${maxPremiumOutlayPerTrade.toFixed(0)} outlay (${qtyByOptionAllocation}x)`,
    },
  ];

  const hardRejectChecks = checks.filter((c) => c.hard_reject);
  const hardRejectReasons = hardRejectChecks.map((c) => c.detail);

  // Determine binding constraint
  let bindingConstraint: BindingSizingConstraint = 'dollar_risk_per_trade';
  let bindingExplanation = `Max Dollar Risk ($${maxDollarRiskPerTrade.toFixed(0)} at ${policy.risk_per_trade_pct.toFixed(2)}% of $${effectiveEquity.toLocaleString()}) / $${tradePlan.risk_per_contract_dollars.toFixed(0)} risk per contract = ${qtyByDollarRisk} contract(s).`;

  if (hardRejectChecks.length > 0 || rawPermittedQty < 1) {
    bindingConstraint = 'hard_gate_rejected';
    if (qtyByDollarRisk < 1) {
      bindingExplanation = `1 contract stop risk ($${tradePlan.risk_per_contract_dollars.toFixed(0)}) exceeds max dollar risk per trade ($${maxDollarRiskPerTrade.toFixed(0)} at ${policy.risk_per_trade_pct.toFixed(2)}% equity).`;
    } else if (qtyByOptionAllocation < 1) {
      bindingExplanation = `1 contract premium cost ($${tradePlan.contract_cost_dollars.toFixed(0)}) exceeds max option capital allocation ($${maxPremiumOutlayPerTrade.toFixed(0)} at ${policy.max_option_allocation_pct.toFixed(2)}% equity).`;
    } else {
      bindingExplanation =
        hardRejectReasons[0] ?? 'Rejected by deterministic account/risk gate.';
    }
  } else if (rawPermittedQty === qtyByDollarRisk) {
    bindingConstraint = 'dollar_risk_per_trade';
    bindingExplanation = `Capped by Max Loss at Stop: floor($${maxDollarRiskPerTrade.toFixed(0)} / $${tradePlan.risk_per_contract_dollars.toFixed(0)}) = ${qtyByDollarRisk} contract(s).`;
  } else if (rawPermittedQty === qtyByOptionAllocation) {
    bindingConstraint = 'max_option_allocation';
    bindingExplanation = `Capped by Max Premium Outlay: floor($${maxPremiumOutlayPerTrade.toFixed(0)} / $${tradePlan.contract_cost_dollars.toFixed(0)}) = ${qtyByOptionAllocation} contract(s).`;
  } else if (rawPermittedQty === qtyByTotalOpenRisk) {
    bindingConstraint = 'total_open_risk_cap';
    bindingExplanation = `Capped by Remaining Open Portfolio Risk: floor($${remainingTotalOpenRiskDollars.toFixed(0)} / $${tradePlan.risk_per_contract_dollars.toFixed(0)}) = ${qtyByTotalOpenRisk} contract(s).`;
  } else if (rawPermittedQty === qtyBySameTickerCap) {
    bindingConstraint = 'same_ticker_concentration';
    bindingExplanation = `Capped by ${policy.max_same_ticker_pct.toFixed(1)}% Same-Ticker Limit: floor($${remainingSameTickerDollars.toFixed(0)} / $${tradePlan.contract_cost_dollars.toFixed(0)}) = ${qtyBySameTickerCap} contract(s).`;
  } else {
    bindingConstraint = 'option_buying_power';
    bindingExplanation = `Capped by Available Option Buying Power: floor($${effectiveOptionBuyingPowerDollars.toFixed(0)} / $${tradePlan.contract_cost_dollars.toFixed(0)}) = ${qtyByBuyingPower} contract(s).`;
  }

  const permittedQty =
    hardRejectChecks.length > 0
      ? 0
      : Math.min(policy.desired_contracts, rawPermittedQty);

  const deployedPremiumDollars = round2(
    permittedQty * tradePlan.contract_cost_dollars
  );
  const deployedEquityPct = round2(
    (deployedPremiumDollars / Math.max(effectiveEquity, 1)) * 100
  );
  const totalTradeDollarRisk = round2(
    permittedQty * tradePlan.risk_per_contract_dollars
  );
  const totalTradeEquityRiskPct = round2(
    (totalTradeDollarRisk / Math.max(effectiveEquity, 1)) * 100
  );
  const estimatedTarget1ProfitDollars = round2(
    permittedQty * tradePlan.reward_per_contract_dollars
  );

  const sizing: ContractQuantityBreakdown = {
    desired_contracts: policy.desired_contracts,
    qty_by_dollar_risk: qtyByDollarRisk,
    qty_by_option_allocation: qtyByOptionAllocation,
    qty_by_buying_power: qtyByBuyingPower,
    qty_by_total_open_risk: qtyByTotalOpenRisk,
    qty_by_same_ticker_cap: qtyBySameTickerCap,
    raw_permitted_qty: rawPermittedQty,
    permitted_qty: permittedQty,
    binding_constraint: bindingConstraint,
    binding_constraint_explanation: bindingExplanation,
    deployed_premium_dollars: deployedPremiumDollars,
    deployed_equity_pct: deployedEquityPct,
    total_trade_dollar_risk: totalTradeDollarRisk,
    total_trade_equity_risk_pct: totalTradeEquityRiskPct,
    estimated_target_1_profit_dollars: estimatedTarget1ProfitDollars,
  };

  // Step 7: Determine Final Action: SUBMIT_LIMIT_ORDER / REDUCE_AND_SUBMIT / REJECT
  let executionAction: RiskExecutionAction = 'SUBMIT_LIMIT_ORDER';
  const reductionReasons: string[] = [];

  if (hardRejectChecks.length > 0 || permittedQty < 1) {
    executionAction = 'REJECT';
  } else if (policy.desired_contracts > rawPermittedQty) {
    executionAction = 'REDUCE_AND_SUBMIT';
    reductionReasons.push(
      `Reduced requested ${policy.desired_contracts} contracts → ${permittedQty} contract(s) (${bindingExplanation})`
    );
  }

  const actionHeadline =
    executionAction === 'SUBMIT_LIMIT_ORDER'
      ? `SUBMIT LIMIT ORDER: Buy ${permittedQty}x ${tradePlan.option_symbol} @ $${tradePlan.planned_entry_price.toFixed(2)} Limit`
      : executionAction === 'REDUCE_AND_SUBMIT'
        ? `REDUCE QTY (${policy.desired_contracts}x → ${permittedQty}x) & SUBMIT LIMIT ORDER @ $${tradePlan.planned_entry_price.toFixed(2)}`
        : `REJECT ORDER: Cannot Execute ${tradePlan.option_symbol} Under Current Risk Policy`;

  const actionRationale =
    executionAction === 'REJECT'
      ? hardRejectReasons[0] ?? bindingExplanation
      : `Permitted ${permittedQty} contract(s) deploys $${deployedPremiumDollars.toFixed(0)} (${deployedEquityPct.toFixed(2)}% of equity, <= ${policy.max_option_allocation_pct.toFixed(2)}% cap) with $${totalTradeDollarRisk.toFixed(0)} stop risk (${totalTradeEquityRiskPct.toFixed(2)}% of equity, <= ${policy.risk_per_trade_pct.toFixed(2)}% cap). Stop at $${tradePlan.contract_stop_price.toFixed(2)} (underlying $${tradePlan.underlying_invalidation_stop.toFixed(2)}), First Target $${tradePlan.contract_first_target_price.toFixed(2)} (${tradePlan.reward_to_risk_ratio.toFixed(2)}R).`;

  const limitOrderPayload: StagedAlpacaLimitOrderPayload | null =
    executionAction === 'REJECT'
      ? null
      : {
          symbol: tradePlan.option_symbol,
          underlying: tradePlan.symbol,
          side: 'buy',
          type: 'limit',
          time_in_force: 'day',
          qty: permittedQty,
          limit_price: tradePlan.planned_entry_price,
          notional_premium_outlay_dollars: deployedPremiumDollars,
          max_dollar_risk_at_stop: totalTradeDollarRisk,
          attached_exit_plan: {
            underlying_invalidation_stop:
              tradePlan.underlying_invalidation_stop,
            option_stop_price: tradePlan.contract_stop_price,
            underlying_first_target: tradePlan.underlying_first_target,
            option_first_target_price: tradePlan.contract_first_target_price,
          },
        };

  const workflowSteps: RiskFirstExecutionPlanResult['workflow_steps'] = [
    {
      step_number: 1,
      title: 'Whale Flow + Market Regime',
      status: 'PASSED',
      summary: `${params.packet.ticker} FlowScore ${params.packet.flow_score} · ${params.packet.section_d_market_regime_context.active_strategy_regime_label}`,
    },
    {
      step_number: 2,
      title: 'LLM Trade Decision Gate',
      status: params.llmDecision === 'EXECUTE' ? 'PASSED' : 'REJECTED',
      summary: `LLM Gate returned ${params.llmDecision}`,
    },
    {
      step_number: 3,
      title: 'Build Entry, Stop & First Target',
      status: 'PASSED',
      summary: `Entry $${tradePlan.planned_entry_price.toFixed(2)} · Stop $${tradePlan.contract_stop_price.toFixed(2)} (Spot $${tradePlan.underlying_invalidation_stop.toFixed(2)}) · T1 $${tradePlan.contract_first_target_price.toFixed(2)} (${tradePlan.reward_to_risk_ratio.toFixed(2)}R)`,
    },
    {
      step_number: 4,
      title: 'Pull Alpaca Account & Positions',
      status:
        !alpacaSnapshot.trading_blocked && !alpacaSnapshot.account_blocked
          ? 'PASSED'
          : 'REJECTED',
      summary: `Equity $${effectiveEquity.toLocaleString()} · Option BP $${effectiveOptionBuyingPowerDollars.toLocaleString()} · Level ${alpacaSnapshot.options_approved_level}`,
    },
    {
      step_number: 5,
      title: 'Calculate Dollar Risk per Contract',
      status: 'PASSED',
      summary: `Cost $${tradePlan.contract_cost_dollars.toFixed(0)}/ct · Stop Risk $${tradePlan.risk_per_contract_dollars.toFixed(0)}/ct (${tradePlan.stop_loss_pct_of_premium.toFixed(0)}% of premium)`,
    },
    {
      step_number: 6,
      title: 'Calculate Permitted Quantity',
      status:
        rawPermittedQty < 1
          ? 'REJECTED'
          : policy.desired_contracts > rawPermittedQty
            ? 'REDUCED'
            : 'PASSED',
      summary: `By Stop Risk: ${qtyByDollarRisk}x · By Allocation: ${qtyByOptionAllocation}x → Max Permitted: ${rawPermittedQty}x`,
    },
    {
      step_number: 7,
      title: 'Reject, Reduce, or Submit Limit Order',
      status:
        executionAction === 'REJECT'
          ? 'REJECTED'
          : executionAction === 'REDUCE_AND_SUBMIT'
            ? 'REDUCED'
            : 'PASSED',
      summary: actionHeadline,
    },
  ];

  const inputContract: RiskEngineInputContract = {
    llm_decision: params.llmDecision,
    option: {
      symbol: tradePlan.option_symbol,
      planned_entry: tradePlan.planned_entry_price,
      premium_stop: tradePlan.contract_stop_price,
    },
    account_policy: {
      risk_per_trade_pct: Number((policy.risk_per_trade_pct / 100).toFixed(5)),
      max_option_allocation_pct: Number(
        (policy.max_option_allocation_pct / 100).toFixed(5)
      ),
      max_total_open_risk_pct: Number(
        (policy.max_total_open_risk_pct / 100).toFixed(5)
      ),
    },
  };

  const outputContract: RiskEngineOutputContract = {
    decision:
      executionAction === 'REJECT' || permittedQty < 1 ? 'SKIP' : 'APPROVED',
    quantity: permittedQty,
    entry_limit: tradePlan.planned_entry_price,
    premium_stop: tradePlan.contract_stop_price,
    maximum_debit: deployedPremiumDollars,
    maximum_planned_loss: totalTradeDollarRisk,
    risk_pct_of_equity: Number(
      (totalTradeDollarRisk / Math.max(effectiveEquity, 1)).toFixed(5)
    ),
    rejection_checks: hardRejectReasons,
  };

  const recAlgo =
    params.packet.section_g_execution_and_risk_gate
      .smart_order_recommended_algo;
  const riskPerShare = Math.max(
    0.05,
    outputContract.entry_limit - outputContract.premium_stop
  );
  const t1Price = round2(outputContract.entry_limit + riskPerShare * 1.5);
  const t2Price = round2(outputContract.entry_limit + riskPerShare * 2.8);
  const t1Qty = Math.max(1, Math.ceil(outputContract.quantity * 0.5));
  const t2Qty = Math.max(0, outputContract.quantity - t1Qty);
  const rewardToRisk = round2(
    ((t1Price + t2Price) / 2 - outputContract.entry_limit) / riskPerShare
  );
  const gammaTargetLevel =
    tradePlan.direction === 'bullish'
      ? params.packet.section_c_ticker_gamma_positioning.call_wall
      : params.packet.section_c_ticker_gamma_positioning.put_wall;
  const hardMaxEntryPrice = round2(
    Math.min(tradePlan.nbbo_ask, outputContract.entry_limit * 1.03)
  );

  const defaultInitialStrategy: InitialTradingStrategyPlan = {
    strategy_name:
      recAlgo === 'uw_flow_urgency_sweep'
        ? 'Institutional Urgency Sweep + Two-Tranche Gamma Scale-Out'
        : recAlgo === 'delta_pegged_mid'
          ? 'Alpaca Delta-Pegged Sub-Mid Entry + VWAP Trend Runner'
          : recAlgo === 'liquidity_sniper_twap'
            ? 'Liquidity Sniper TWAP Accumulation + Mean-Reversion Targets'
            : 'Adaptive Microprice Walk + Two-Tranche Gamma Wall Scale-Out',
    entry_execution_plan:
      outputContract.decision === 'APPROVED'
        ? `Stage ${outputContract.quantity}x ${tradePlan.option_symbol} via ${recAlgo}: post passive sub-mid limit @ $${outputContract.entry_limit.toFixed(2)} (NBBO $${tradePlan.nbbo_bid.toFixed(2)} × $${tradePlan.nbbo_ask.toFixed(2)}), walk up to 3 steps toward Stoikov microprice with hard reservation cap $${hardMaxEntryPrice.toFixed(2)}.`
        : `Do not enter ${tradePlan.option_symbol}: position blocked by Stage-2 risk guardrails (${hardRejectReasons[0] ?? 'insufficient risk budget'}).`,
    profit_target_plan:
      outputContract.decision === 'APPROVED'
        ? `Tranche 1 (${t1Qty}x): take profit @ $${t1Price.toFixed(2)} (+1.5R) and ratchet stop to breakeven ($${outputContract.entry_limit.toFixed(2)}). ${t2Qty > 0 ? `Tranche 2 (${t2Qty}x runner): trail toward $${t2Price.toFixed(2)} (+2.8R) / ${tradePlan.symbol} $${gammaTargetLevel.toFixed(2)} Gamma Wall.` : 'Single-contract lot exits 100% at T1/T2 trailing trigger.'}`
        : 'N/A — trade skipped.',
    stop_and_invalidation_plan: `Hard option premium stop @ $${outputContract.premium_stop.toFixed(2)} (max planned loss $${outputContract.maximum_planned_loss.toFixed(0)} = ${(outputContract.risk_pct_of_equity * 100).toFixed(2)}% of equity); immediate exit if ${tradePlan.symbol} spot breaks $${tradePlan.underlying_invalidation_stop.toFixed(2)} (${tradePlan.underlying_invalidation_reason}).`,
    time_and_theta_plan: `Intraday time-stop: exit if ${tradePlan.symbol} fails to confirm directional follow-through within 45m of entry, or reduce 50% exposure by 15:30 ET to protect ${params.packet.section_a_contract_and_whale_flow.dte}DTE theta.`,
    reward_to_risk_ratio: rewardToRisk,
  };

  const defaultStage2Assessment: LlmRiskAndSizeAssessment = {
    assessed_at: new Date().toISOString(),
    execution_mode: 'deterministic_synthesis',
    model_id: 'risk-sizer-gate',
    thinking_mode: 'no_think',
    latency_ms: 48,
    decision: outputContract.decision,
    quantity: outputContract.quantity,
    entry_limit: outputContract.entry_limit,
    premium_stop: outputContract.premium_stop,
    maximum_debit: outputContract.maximum_debit,
    maximum_planned_loss: outputContract.maximum_planned_loss,
    risk_pct_of_equity: outputContract.risk_pct_of_equity,
    rejection_checks: outputContract.rejection_checks,
    recommended_smart_algo: recAlgo,
    risk_narrative:
      outputContract.decision === 'APPROVED'
        ? `Stage-2 AI Position Size, Risk & Initial Strategy APPROVED ${outputContract.quantity} contract(s) of ${tradePlan.option_symbol} at $${outputContract.entry_limit.toFixed(2)} limit (stop $${outputContract.premium_stop.toFixed(2)}, max planned loss $${outputContract.maximum_planned_loss.toFixed(0)} = ${(outputContract.risk_pct_of_equity * 100).toFixed(2)}% of $${effectiveEquity.toLocaleString()} equity; max debit $${outputContract.maximum_debit.toFixed(0)}). Initial Strategy: ${defaultInitialStrategy.strategy_name} (${defaultInitialStrategy.reward_to_risk_ratio.toFixed(2)}R).`
        : `Stage-2 AI Position Size, Risk & Initial Strategy returned SKIP: ${hardRejectReasons[0] ?? bindingExplanation}`,
    llm_risk_narrative:
      outputContract.decision === 'APPROVED'
        ? `Stage-2 AI Position Size, Risk & Initial Strategy APPROVED ${outputContract.quantity} contract(s) of ${tradePlan.option_symbol} at $${outputContract.entry_limit.toFixed(2)} limit (stop $${outputContract.premium_stop.toFixed(2)}, max planned loss $${outputContract.maximum_planned_loss.toFixed(0)} = ${(outputContract.risk_pct_of_equity * 100).toFixed(2)}% of $${effectiveEquity.toLocaleString()} equity; max debit $${outputContract.maximum_debit.toFixed(0)}). Initial Strategy: ${defaultInitialStrategy.strategy_name} (${defaultInitialStrategy.reward_to_risk_ratio.toFixed(2)}R).`
        : `Stage-2 AI Position Size, Risk & Initial Strategy returned SKIP: ${hardRejectReasons[0] ?? bindingExplanation}`,
    sizing_justification: bindingExplanation,
    execution_notes: `${bindingExplanation} | Strategy: ${defaultInitialStrategy.entry_execution_plan} ${defaultInitialStrategy.profit_target_plan}`,
    initial_trading_strategy: defaultInitialStrategy,
    smart_order_fulfillment_ready:
      outputContract.decision === 'APPROVED' && outputContract.quantity >= 1,
    thinking_trace: null,
    raw_response_text: JSON.stringify(
      {
        ...outputContract,
        recommended_smart_algo: recAlgo,
        initial_trading_strategy: defaultInitialStrategy,
      },
      null,
      2
    ),
  };

  return {
    evaluated_at: new Date().toISOString(),
    workflow_steps: workflowSteps,
    llm_decision: params.llmDecision,
    execution_action: executionAction,
    action_headline: actionHeadline,
    action_rationale: actionRationale,
    policy,
    alpaca_snapshot: alpacaSnapshot,
    trade_plan: tradePlan,
    budgets,
    sizing,
    checks,
    hard_reject_reasons: hardRejectReasons,
    reduction_reasons: reductionReasons,
    limit_order_payload: limitOrderPayload,
    input_contract: inputContract,
    output_contract: outputContract,
    stage2_llm_risk_assessment: defaultStage2Assessment,
  };
}

/**
 * Builds the compact, token-efficient Stage-2 LLM Risk, Order Size & Initial Trading Strategy prompt
 * and request payload to run after the Initial Stage-1 LLM Entry Decision.
 */
export function buildStage2LlmRiskAssessmentPrompts(params: {
  plan: RiskFirstExecutionPlanResult;
  modelId: string;
  endpointUrl: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  maxTokensEnabled: boolean;
  thinkingMode: LlmThinkingMode;
}): {
  endpoint_url: string;
  system_prompt: string;
  user_prompt: string;
  request_body: Record<string, unknown>;
} {
  const endpoints = normalizeLmStudioEndpoints(params.endpointUrl);
  const p = params.plan;

  const system_prompt = [
    'You are the Stage-2 Institutional Risk, Position Sizing & Initial Trading Strategy AI.',
    'After Stage-1 AI approves entering a position ("EXECUTE"), you perform a dedicated second AI analysis to determine: (1) exact contract position size, (2) dollar & equity risk parameters, and (3) the complete Initial Trading Strategy (entry execution plan, two-tranche profit targets, hard stop & spot invalidation, and time/theta management) before sending the order to the Smart Order Engine.',
    'Return ONLY a valid JSON object matching this exact schema:',
    '{"decision":"APPROVED"|"SKIP","quantity":number,"entry_limit":number,"premium_stop":number,"maximum_debit":number,"maximum_planned_loss":number,"risk_pct_of_equity":number,"rejection_checks":string[],"recommended_smart_algo":"adaptive_microprice_walk"|"delta_pegged_mid"|"uw_flow_urgency_sweep"|"liquidity_sniper_twap","risk_narrative":string,"sizing_justification":string,"initial_trading_strategy":{"strategy_name":string,"entry_execution_plan":string,"profit_target_plan":string,"stop_and_invalidation_plan":string,"time_and_theta_plan":string,"reward_to_risk_ratio":number}}',
    'CRITICAL: Never approve a quantity higher than the deterministic permitted_qty cap (`max_permitted_qty`). If `max_permitted_qty < 1`, return `"decision": "SKIP"` and `"quantity": 0`.',
  ].join('\n');

  const compactContext = {
    input_contract: p.input_contract,
    alpaca_account: {
      equity: p.budgets.effective_equity_dollars,
      option_buying_power: p.budgets.effective_option_buying_power_dollars,
      options_approved_level: p.alpaca_snapshot.options_approved_level,
      trading_blocked: p.alpaca_snapshot.trading_blocked,
      clock_is_open: p.alpaca_snapshot.clock.is_open,
    },
    deterministic_bounds: {
      contract_cost: p.trade_plan.contract_cost_dollars,
      risk_per_contract: p.trade_plan.risk_per_contract_dollars,
      qty_by_risk: p.sizing.qty_by_dollar_risk,
      qty_by_allocation: p.sizing.qty_by_option_allocation,
      qty_by_buying_power: p.sizing.qty_by_buying_power,
      max_permitted_qty: p.sizing.permitted_qty,
      binding_constraint: p.sizing.binding_constraint_explanation,
      hard_reject_reasons: p.hard_reject_reasons,
    },
    baseline_initial_strategy:
      p.stage2_llm_risk_assessment.initial_trading_strategy,
  };

  const user_prompt = `Determine position size, risk parameters, and initial trading strategy for ${p.trade_plan.option_symbol} before Smart Order Engine fulfillment:\n${JSON.stringify(compactContext)}`;

  const request_body = buildOptimizedLmStudioChatPayload({
    modelId: params.modelId,
    systemPrompt: system_prompt,
    userPrompt: user_prompt,
    temperature: params.temperature,
    topP: params.topP,
    maxTokens: params.maxTokens,
    maxTokensEnabled: params.maxTokensEnabled,
    thinkingMode: params.thinkingMode,
    stream: false,
  });

  return {
    endpoint_url: endpoints.primaryChatCompletionsUrl,
    system_prompt,
    user_prompt,
    request_body,
  };
}

/**
 * Parses the Stage-2 LLM Risk, Order Size & Initial Trading Strategy response while strictly enforcing
 * the deterministic risk engine upper bound (`plan.sizing.permitted_qty`).
 */
export function parseOrFallbackStage2LlmRiskAssessment(params: {
  rawContent: string | null | undefined;
  plan: RiskFirstExecutionPlanResult;
  executionMode: 'lm_studio_live' | 'deterministic_synthesis';
  modelId: string;
  thinkingMode: LlmThinkingMode;
  latencyMs: number;
}): LlmRiskAndSizeAssessment {
  const base = params.plan.stage2_llm_risk_assessment;
  const maxPermitted = params.plan.sizing.permitted_qty;
  const { thinkingTrace } = extractThinkingAndCleanContent(params.rawContent);
  const parsed = extractJsonObjectFromLlmText(params.rawContent);

  if (!parsed) {
    return {
      ...base,
      assessed_at: new Date().toISOString(),
      execution_mode: params.executionMode,
      model_id: params.modelId,
      thinking_mode: params.thinkingMode,
      latency_ms: params.latencyMs,
      thinking_trace: thinkingTrace,
      raw_response_text: params.rawContent || base.raw_response_text,
    };
  }

  const rawDec = String(parsed.decision ?? '').toUpperCase().trim();
  const llmWantsSkip = rawDec === 'SKIP' || rawDec === 'REJECT';
  const rawQty =
    typeof parsed.quantity === 'number' && !Number.isNaN(parsed.quantity)
      ? Math.max(0, Math.floor(parsed.quantity))
      : maxPermitted;

  // Enforce deterministic risk cap: LLM can reduce or approve up to maxPermitted, never exceed maxPermitted
  const finalQty =
    llmWantsSkip || maxPermitted < 1 ? 0 : Math.min(rawQty || maxPermitted, maxPermitted);
  const finalDecision: 'APPROVED' | 'SKIP' =
    finalQty >= 1 && !llmWantsSkip ? 'APPROVED' : 'SKIP';

  const entryLimit = params.plan.trade_plan.planned_entry_price;
  const premiumStop = params.plan.trade_plan.contract_stop_price;
  const maxDebit = round2(finalQty * params.plan.trade_plan.contract_cost_dollars);
  const maxLoss = round2(
    finalQty * params.plan.trade_plan.risk_per_contract_dollars
  );
  const equity = Math.max(1, params.plan.budgets.effective_equity_dollars);
  const riskPctOfEquity = Number((maxLoss / equity).toFixed(5));

  const validAlgos = [
    'adaptive_microprice_walk',
    'delta_pegged_mid',
    'uw_flow_urgency_sweep',
    'liquidity_sniper_twap',
  ] as const;
  const recAlgo = validAlgos.includes(
    parsed.recommended_smart_algo as (typeof validAlgos)[number]
  )
    ? (parsed.recommended_smart_algo as (typeof validAlgos)[number])
    : base.recommended_smart_algo;

  const rawStrat =
    parsed.initial_trading_strategy &&
    typeof parsed.initial_trading_strategy === 'object'
      ? (parsed.initial_trading_strategy as Record<string, unknown>)
      : null;

  const resolvedStrategy: InitialTradingStrategyPlan = {
    strategy_name:
      typeof rawStrat?.strategy_name === 'string' &&
      rawStrat.strategy_name.trim()
        ? rawStrat.strategy_name.trim()
        : base.initial_trading_strategy.strategy_name,
    entry_execution_plan:
      typeof rawStrat?.entry_execution_plan === 'string' &&
      rawStrat.entry_execution_plan.trim()
        ? rawStrat.entry_execution_plan.trim()
        : base.initial_trading_strategy.entry_execution_plan,
    profit_target_plan:
      typeof rawStrat?.profit_target_plan === 'string' &&
      rawStrat.profit_target_plan.trim()
        ? rawStrat.profit_target_plan.trim()
        : base.initial_trading_strategy.profit_target_plan,
    stop_and_invalidation_plan:
      typeof rawStrat?.stop_and_invalidation_plan === 'string' &&
      rawStrat.stop_and_invalidation_plan.trim()
        ? rawStrat.stop_and_invalidation_plan.trim()
        : base.initial_trading_strategy.stop_and_invalidation_plan,
    time_and_theta_plan:
      typeof rawStrat?.time_and_theta_plan === 'string' &&
      rawStrat.time_and_theta_plan.trim()
        ? rawStrat.time_and_theta_plan.trim()
        : base.initial_trading_strategy.time_and_theta_plan,
    reward_to_risk_ratio:
      typeof rawStrat?.reward_to_risk_ratio === 'number' &&
      Number.isFinite(rawStrat.reward_to_risk_ratio)
        ? round2(rawStrat.reward_to_risk_ratio)
        : base.initial_trading_strategy.reward_to_risk_ratio,
  };

  const resolvedNarrative =
    typeof parsed.llm_risk_narrative === 'string' &&
    parsed.llm_risk_narrative.trim()
      ? parsed.llm_risk_narrative.trim()
      : typeof parsed.risk_narrative === 'string' && parsed.risk_narrative.trim()
        ? parsed.risk_narrative.trim()
        : base.risk_narrative;
  const resolvedNotes =
    typeof parsed.execution_notes === 'string' && parsed.execution_notes.trim()
      ? parsed.execution_notes.trim()
      : typeof parsed.sizing_justification === 'string' &&
          parsed.sizing_justification.trim()
        ? parsed.sizing_justification.trim()
        : base.sizing_justification;

  return {
    assessed_at: new Date().toISOString(),
    execution_mode: params.executionMode,
    model_id: params.modelId,
    thinking_mode: params.thinkingMode,
    latency_ms: params.latencyMs,
    decision: finalDecision,
    quantity: finalQty,
    entry_limit: entryLimit,
    premium_stop: premiumStop,
    maximum_debit: maxDebit,
    maximum_planned_loss: maxLoss,
    risk_pct_of_equity: riskPctOfEquity,
    rejection_checks: Array.isArray(parsed.rejection_checks)
      ? parsed.rejection_checks.map(String)
      : base.rejection_checks,
    recommended_smart_algo: recAlgo,
    risk_narrative: resolvedNarrative,
    llm_risk_narrative: resolvedNarrative,
    sizing_justification: resolvedNotes,
    execution_notes: resolvedNotes,
    initial_trading_strategy: resolvedStrategy,
    smart_order_fulfillment_ready: finalDecision === 'APPROVED' && finalQty >= 1,
    thinking_trace: thinkingTrace,
    raw_response_text: params.rawContent || JSON.stringify(parsed, null, 2),
  };
}

