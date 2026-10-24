import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPrintDirection,
  computePrintEventId,
  passesContractScreenerFilter,
  evaluatePremiumBurst,
  evaluateConcentrationBurst,
  evaluateUrgencyBurst,
  evaluateSweepBurst,
  evaluateCandleConfirmation,
  computeWhaleScore,
  evaluateHardRejectRules,
  resolveCandidateLifecycleStatus,
  buildUnusualActivityDiscoveryUrl,
  evaluateMarketTideFeatures,
  computeTideAlignmentScore,
  getRegimeScannerProfile,
  evaluateTidePersistence,
  evaluateGammaRegime,
  evaluateVolatilityRegime,
  classifyMarketStateAndProfile,
  computeSectorTideAlignment,
  evaluateTickerGammaRules,
  computeAdaptiveWhaleScore,
  computeTechnicalIndicatorsFromBars,
  evaluateStockConfirmation,
  aggregateContractPrints,
  mergeCandidatesForSameContract,
  resolveAutoScannerMode,
  formatCandidateTimestampSummary,
} from './whaleScannerEngine.ts';
import {
  generateDeterministicBarsForCandidate,
  sharedAlpacaStockService,
} from './alpacaStockService.ts';
import {
  computeAlpacaMarketClockState,
  normalizeAlpacaAccount,
  normalizePortfolioHistory,
  parseOccOptionSymbol,
  reconstructRoundTripTrades,
} from './alpacaAccountEngine.ts';
import { AlpacaAccountService } from './alpacaAccountService.ts';
import {
  LLM_MODEL_CATALOG,
  WhaleScannerRuntime,
  resolveLlmModelPreset,
} from './whalePipelineRuntime.ts';
import {
  classifyApiServiceFromPath,
  computeAiAnalysisMetrics,
  computeApiActivityMetrics,
  computeLiveEntryElapsedMs,
  formatElapsedCounter,
  sanitizePayloadForLog,
} from './activityMonitorEngine.ts';
import { computeSmartOrderPortfolioMetrics } from './smartOrderEngine.ts';
import { evaluateRegimeWhaleStrategyPipeline } from './regimeWhaleStrategyEngine.ts';
import {
  buildLlmTradeEvidencePacket,
  evaluateDeterministicRiskGate,
  evaluateStructuredLlmDecisionFromPacket,
} from './llmTradeDecisionEngine.ts';
import {
  DEFAULT_RISK_POLICY_CONFIG,
  SPEC_25K_EXAMPLE_RISK_POLICY,
  buildAlpacaTradingGateSnapshot,
  buildOptionTradePlanLevels,
  buildStage2LlmRiskAssessmentPrompts,
  evaluateRiskFirstExecutionPlan,
  parseOrFallbackStage2LlmRiskAssessment,
} from './riskFirstExecutionEngine.ts';
import { buildInitialMonitoredHoldings } from './holdingsMonitorEngine.ts';
import {
  buildLmStudioHeaders,
  buildOptimizedLmStudioChatPayload,
  extractJsonObjectFromLlmText,
  extractThinkingAndCleanContent,
  isLocalhostLmStudioEndpoint,
  normalizeLmStudioEndpoints,
  parseLmStudioModelsResponse,
} from './lmStudioClient.ts';
import {
  buildCandidateOptionEventChartModel,
  computeChartZoomWindow,
  formatEventCalloutBadgeText,
  getChartZoomPresetRange,
  panChartZoomRange,
  resolveEventCalloutPositions,
  zoomRangeByFactor,
} from './candidateEventChartEngine.ts';
import {
  buildShortAndDarkPoolTelemetryForHolding,
  computeShortDarkPoolScore,
  evaluateHoldingConfirmationMatrix,
  SUGGESTED_SHORT_DARKPOOL_LLM_RULE,
} from './shortAndDarkPoolEngine.ts';


test('Section 5: Direction mapping classifies call/put and ask/bid accurately', () => {
  assert.equal(classifyPrintDirection('call', 'ask'), 'bullish');
  assert.equal(classifyPrintDirection('put', 'ask'), 'bearish');
  assert.equal(classifyPrintDirection('call', 'bid'), 'bearish');
  assert.equal(classifyPrintDirection('put', 'bid'), 'bullish');
  assert.equal(classifyPrintDirection('call', 'mid'), 'ambiguous');
  assert.equal(classifyPrintDirection('put', 'unknown'), 'ambiguous');
});

test('Section 4B: Deduplication event ID uses provider ID or deterministic hash', () => {
  assert.equal(
    computePrintEventId({ event_id: 'uw-print-991' }),
    'uw-print-991'
  );
  const hash1 = computePrintEventId({
    option_symbol: 'NVDA261120C00150000',
    executed_at_ms: 1792333920000,
    price: 4.5,
    size: 200,
    exchange: 'CBOE',
    trade_code: 'SWEEP',
  });
  const hash2 = computePrintEventId({
    option_symbol: 'NVDA261120C00150000',
    executed_at_ms: 1792333920000,
    price: 4.5,
    size: 200,
    exchange: 'CBOE',
    trade_code: 'SWEEP',
  });
  assert.equal(hash1, hash2);
  assert.ok(hash1.startsWith('hash-'));
});

test('Section 4A: Contract screener consumer enforces all 7 eligibility rules', () => {
  const validSnapshot = {
    ticker: 'NVDA',
    option_symbol: 'NVDA261120C00150000',
    option_type: 'call' as const,
    strike: 150,
    expiry: '2026-11-20',
    dte: 34,
    premium: 185_000,
    volume: 1400,
    open_interest: 800,
    ask_pct: 0.82,
    bid_pct: 0.12,
    otm: true,
    multileg_volume_ratio: 0.15,
    spread: 0.06,
    issue_type: 'Common Stock' as const,
    underlying_price: 142.5,
    avg_daily_dollar_volume: 12_500_000_000,
    updated_at_ms: Date.now(),
  };

  assert.equal(passesContractScreenerFilter(validSnapshot).passed, true);

  const lowSkew = { ...validSnapshot, ask_pct: 0.55, bid_pct: 0.45 };
  assert.equal(passesContractScreenerFilter(lowSkew).passed, false);

  const zeroDte = { ...validSnapshot, dte: 2 };
  assert.equal(passesContractScreenerFilter(zeroDte).passed, false);
});

test('Section 5A-5E: Candle-burst and underlying confirmation calculations', () => {
  const history = Array.from({ length: 20 }, (_, i) => 30_000 + (i % 5) * 2_000);
  const premEval = evaluatePremiumBurst(420_000, history);
  assert.equal(premEval.premium_burst, true);
  assert.ok(premEval.robust_zscore >= 3);

  const fallbackEval = evaluatePremiumBurst(260_000, []);
  assert.equal(fallbackEval.premium_burst, true);
  assert.equal(fallbackEval.used_fallback, true);

  const concEval = evaluateConcentrationBurst(240_000, 420_000);
  assert.equal(concEval.concentration_burst, true);
  assert.equal(concEval.contract_share, 0.57);

  const urgEval = evaluateUrgencyBurst(5, 180_000, 0.83, [
    'RepeatedHitsAscendingFill',
  ]);
  assert.equal(urgEval.urgency_burst, true);
  assert.equal(urgEval.boosted_by_alert, true);

  const sweepEval = evaluateSweepBurst(256_200, 420_000);
  assert.equal(sweepEval.sweep_burst, true);
  assert.equal(sweepEval.sweep_ratio, 0.61);

  const bullCandle = {
    ticker: 'NVDA',
    window_end_ms: Date.now(),
    open: 141.0,
    high: 143.2,
    low: 140.8,
    close: 142.8,
    volume: 4_500_000,
    vwap: 141.95,
    relative_volume_5m: 1.92,
    return_5m: 0.0128,
  };
  const candleConfirm = evaluateCandleConfirmation('bullish', bullCandle);
  assert.equal(candleConfirm.confirmed, true);
  assert.ok(candleConfirm.close_position >= 0.65);
});

test('Section 6 (v1.1): Deterministic 7-Factor Whale Score with Tide Alignment & Bonus', () => {
  const bullCandle = {
    ticker: 'NVDA',
    window_end_ms: Date.now(),
    open: 141.0,
    high: 143.2,
    low: 140.8,
    close: 142.8,
    volume: 4_500_000,
    vwap: 141.95,
    relative_volume_5m: 1.92,
    return_5m: 0.0128,
  };

  const strongPosResult = computeWhaleScore({
    premium_5m: 420_000,
    sweep_ratio: 0.61,
    repeated_hit_flag: true,
    dominant_side_share: 0.83,
    volume: 3400,
    open_interest: 900,
    contract_share: 0.57,
    direction: 'bullish',
    candle: bullCandle,
    spread: 0.05,
    avg_daily_dollar_volume: 500_000_000,
    market_regime: 'strong_positive',
  });

  assert.ok(
    strongPosResult.whale_score >= 75 && strongPosResult.whale_score <= 100
  );
  assert.equal(strongPosResult.price_confirmed, true);
  assert.equal(strongPosResult.components.tide_alignment, 1.0);
  assert.equal(strongPosResult.regime_bonus_applied, 8);

  const conflictingTideResult = computeWhaleScore({
    premium_5m: 420_000,
    sweep_ratio: 0.61,
    repeated_hit_flag: true,
    dominant_side_share: 0.83,
    volume: 3400,
    open_interest: 900,
    contract_share: 0.57,
    direction: 'bullish',
    candle: bullCandle,
    spread: 0.05,
    avg_daily_dollar_volume: 500_000_000,
    market_regime: 'strong_negative',
  });

  assert.equal(conflictingTideResult.components.tide_alignment, 0.0);
  assert.equal(conflictingTideResult.regime_bonus_applied, 0);
  assert.ok(strongPosResult.whale_score > conflictingTideResult.whale_score);
});

test('Market Tide Regime Definitions: classifies strong_positive, strong_negative, neutral, reversing, and mixed', () => {
  const trailing = [
    1_000_000, -1_500_000, 2_000_000, -2_500_000, 500_000, -800_000, 1_200_000,
    -1_100_000, 900_000, -900_000, 1_500_000, -1_400_000, 700_000, -600_000,
    1_800_000, -1_700_000, 400_000, -500_000, 1_100_000, -1_000_000,
  ];

  // 1. Strong positive: zscore >= 2 and slope > 0
  const strongPos = evaluateMarketTideFeatures({
    call_premium_5m: 12_000_000,
    put_premium_5m: 2_000_000,
    call_premium_30m: 58_000_000,
    put_premium_30m: 18_000_000,
    net_premium_5m_series: [6_000_000, 8_200_000, 10_000_000],
    trailing_20_sessions_same_time_window: trailing,
  });
  assert.equal(strongPos.regime, 'strong_positive');
  assert.equal(strongPos.scanner_profile, 'risk_on_directional');
  assert.ok(strongPos.tide_zscore >= 2);
  assert.ok(strongPos.tide_slope_15m > 0);

  // 2. Strong negative: zscore <= -2 and slope < 0
  const strongNeg = evaluateMarketTideFeatures({
    call_premium_5m: 3_000_000,
    put_premium_5m: 15_000_000,
    call_premium_30m: 14_000_000,
    put_premium_30m: 72_000_000,
    net_premium_5m_series: [-5_000_000, -8_500_000, -12_000_000],
    trailing_20_sessions_same_time_window: trailing,
  });
  assert.equal(strongNeg.regime, 'strong_negative');
  assert.equal(strongNeg.scanner_profile, 'risk_off_directional');
  assert.ok(strongNeg.tide_zscore <= -2);
  assert.ok(strongNeg.tide_slope_15m < 0);

  // 3. Neutral: abs(tide_zscore) < 0.75
  const neutral = evaluateMarketTideFeatures({
    call_premium_5m: 4_200_000,
    put_premium_5m: 3_800_000,
    call_premium_30m: 21_000_000,
    put_premium_30m: 19_500_000,
    net_premium_5m_series: [200_000, 310_000, 400_000],
    trailing_20_sessions_same_time_window: trailing,
  });
  assert.equal(neutral.regime, 'neutral');
  assert.equal(neutral.scanner_profile, 'idiosyncratic_single_name');

  // 4. Reversing: abs(zscore) >= 0.75 and sign(net_5m) != sign(net_30m)
  const reversing = evaluateMarketTideFeatures({
    call_premium_5m: 4_500_000,
    put_premium_5m: 2_300_000, // net_5m = +2.2M (z ~ 1.65)
    call_premium_30m: 12_000_000,
    put_premium_30m: 28_000_000, // net_30m = -16M
    net_premium_5m_series: [-1_500_000, 800_000, 2_200_000],
    trailing_20_sessions_same_time_window: trailing,
  });
  assert.equal(reversing.regime, 'reversing');
  assert.equal(reversing.scanner_profile, 'reversing_short_momentum');
  assert.equal(
    getRegimeScannerProfile('reversing').confirmation_window_minutes,
    3
  );
  assert.equal(getRegimeScannerProfile('reversing').expiry_minutes, 15);

  // Tide alignment values
  assert.equal(computeTideAlignmentScore('strong_positive', 'bullish'), 1.0);
  assert.equal(computeTideAlignmentScore('strong_positive', 'bearish'), 0.0);
  assert.equal(computeTideAlignmentScore('strong_negative', 'bearish'), 1.0);
  assert.equal(computeTideAlignmentScore('reversing', 'bullish'), 0.25);
  assert.equal(computeTideAlignmentScore('neutral', 'bullish'), 0.5);
});

test('Section 7: Hard Reject Rules block invalid prints and never suppress volume > OI', () => {
  const validEval = evaluateHardRejectRules({
    is_canceled: false,
    premium: 150_000,
    spread: 0.08,
    dte: 21,
    underlying_price: 185.0,
    avg_daily_dollar_volume: 85_000_000,
    multileg_directional_share: 0.12,
    tags: ['sweep'],
    allow_0dte: false,
    direction: 'bullish',
    dominant_side_share: 0.82,
  });
  assert.equal(validEval.rejected, false);

  const wideSpreadAnd0Dte = evaluateHardRejectRules({
    is_canceled: false,
    premium: 150_000,
    spread: 0.29,
    dte: 0,
    underlying_price: 185.0,
    avg_daily_dollar_volume: 85_000_000,
    multileg_directional_share: 0.12,
    tags: [],
    allow_0dte: false,
    direction: 'bullish',
    dominant_side_share: 0.82,
  });
  assert.equal(wideSpreadAnd0Dte.rejected, true);
  assert.equal(wideSpreadAnd0Dte.reasons.length, 2);
});

test('Section 9: Candidate lifecycle and discovery URL construction', () => {
  assert.equal(
    resolveCandidateLifecycleStatus({
      whale_score: 82,
      min_whale_score: 70,
      price_confirmed: true,
      require_price_confirmation: true,
      age_minutes: 4,
    }),
    'confirmed'
  );

  // Reversing tide 3-minute confirmation window expires unconfirmed candidates after 3 minutes
  assert.equal(
    resolveCandidateLifecycleStatus({
      whale_score: 82,
      min_whale_score: 80,
      price_confirmed: false,
      require_price_confirmation: true,
      age_minutes: 5,
      confirmation_window_minutes: 3,
      expiry_minutes: 15,
    }),
    'expired'
  );

  const url = buildUnusualActivityDiscoveryUrl();
  assert.ok(url.includes('/option-activity/unusual?'));
  assert.ok(url.includes('min_premium=50000'));
  assert.ok(url.includes('max_multileg_volume_ratio=0.35'));
});

test('v2.0 State Machine: Tide Persistence, Gamma Regime, Volatility Regime & 6 Filter Profiles (A-F)', () => {
  const tidePersist = evaluateTidePersistence({
    net_call_premium_30m: 62_000_000,
    net_put_premium_30m: 18_000_000,
    tide_zscore_5m: 2.1,
    tide_slope_15m: 0.16,
    bullish_minutes_last_30m: 24,
    bearish_minutes_last_30m: 6,
  });
  assert.equal(tidePersist.tide_direction, 1);
  assert.equal(tidePersist.persistent_bullish_tide, true);
  assert.equal(tidePersist.persistence, 0.8);

  const posGamma = evaluateGammaRegime(585.0, 580.0);
  assert.equal(posGamma.positive_gamma, true);
  assert.equal(posGamma.regime, 'positive_gamma');

  const nearFlip = evaluateGammaRegime(580.5, 580.0);
  assert.equal(nearFlip.near_gamma_flip, true);
  assert.equal(nearFlip.regime, 'near_gamma_flip');

  const stressVol = evaluateVolatilityRegime(0.38, 0.28);
  assert.equal(stressVol.volatility_regime, 'event_or_stress');
  assert.ok(stressVol.front_back_iv_ratio >= 1.2);

  // Profile A: risk_on_trend
  const stateA = classifyMarketStateAndProfile({
    net_premium_5m: 9_100_000,
    net_call_premium_30m: 62_000_000,
    net_put_premium_30m: 18_700_000,
    zscore_5m: 2.34,
    slope_15m: 0.18,
    bullish_minutes_last_30m: 24,
    bearish_minutes_last_30m: 6,
    zero_dte_index_pressure: 'bullish',
    zero_dte_etf_pressure: 'neutral',
    zero_dte_equity_pressure: 'bullish',
    spy_spot: 586.4,
    spy_gamma_flip: 581.0,
    spy_call_wall: 590.0,
    spy_put_wall: 575.0,
    spy_gamma_magnet: 585.0,
    iv_7_to_14_dte: 0.17,
    iv_30_to_60_dte: 0.165,
  });
  assert.equal(stateA.active_filter_profile, 'risk_on_trend');
  assert.equal(stateA.market_regime, 'positive_trend');

  // Profile B: risk_off_trend
  const stateB = classifyMarketStateAndProfile({
    net_premium_5m: -11_400_000,
    net_call_premium_30m: 14_000_000,
    net_put_premium_30m: 76_000_000,
    zscore_5m: -2.92,
    slope_15m: -0.34,
    bullish_minutes_last_30m: 4,
    bearish_minutes_last_30m: 26,
    zero_dte_index_pressure: 'bearish',
    zero_dte_etf_pressure: 'bearish',
    zero_dte_equity_pressure: 'bearish',
    spy_spot: 574.2,
    spy_gamma_flip: 581.0,
    spy_call_wall: 588.0,
    spy_put_wall: 570.0,
    spy_gamma_magnet: 576.0,
    iv_7_to_14_dte: 0.22,
    iv_30_to_60_dte: 0.2,
  });
  assert.equal(stateB.active_filter_profile, 'risk_off_trend');
  assert.equal(stateB.market_regime, 'negative_trend');

  // Profile E: gamma_flip_transition
  const stateE = classifyMarketStateAndProfile({
    net_premium_5m: 1_200_000,
    net_call_premium_30m: 24_000_000,
    net_put_premium_30m: 23_000_000,
    zscore_5m: 0.4,
    slope_15m: -0.05,
    bullish_minutes_last_30m: 15,
    bearish_minutes_last_30m: 15,
    zero_dte_index_pressure: 'neutral',
    zero_dte_etf_pressure: 'neutral',
    zero_dte_equity_pressure: 'neutral',
    spy_spot: 581.2,
    spy_gamma_flip: 581.0, // within 0.30%
    spy_call_wall: 590.0,
    spy_put_wall: 575.0,
    spy_gamma_magnet: 581.0,
    iv_7_to_14_dte: 0.19,
    iv_30_to_60_dte: 0.18,
  });
  assert.equal(stateE.active_filter_profile, 'gamma_flip_transition');

  // Profile F: volatility_stress
  const stateF = classifyMarketStateAndProfile({
    net_premium_5m: -8_500_000,
    net_call_premium_30m: 20_000_000,
    net_put_premium_30m: 45_000_000,
    zscore_5m: -1.8,
    slope_15m: -0.22,
    bullish_minutes_last_30m: 8,
    bearish_minutes_last_30m: 22,
    zero_dte_index_pressure: 'bearish',
    zero_dte_etf_pressure: 'bearish',
    zero_dte_equity_pressure: 'neutral',
    index_dominates_total_flow: true,
    spy_spot: 578.0,
    spy_gamma_flip: 581.0,
    spy_call_wall: 590.0,
    spy_put_wall: 570.0,
    spy_gamma_magnet: 580.0,
    iv_7_to_14_dte: 0.34,
    iv_30_to_60_dte: 0.25, // ratio = 1.36 >= 1.20
  });
  assert.equal(stateF.active_filter_profile, 'volatility_stress');
});

test('v2.0 State Machine: Ticker Gamma Modifiers (+6 breakout, -8 magnet, -5 flip) & 9-Factor Adaptive Score', () => {
  // Breakout above call wall (+6)
  const breakoutGamma = evaluateTickerGammaRules({
    direction: 'bullish',
    ticker_spot: 146.8,
    gamma_flip: 139.0,
    call_wall: 145.0,
    put_wall: 135.0,
    gamma_magnet: 142.0,
  });
  assert.equal(breakoutGamma.breakout_confirmed, true);
  assert.equal(breakoutGamma.ticker_gamma_modifier, 6);
  assert.equal(breakoutGamma.gamma_alignment_score, 1.0);

  // Pinning near magnet (-8)
  const pinnedGamma = evaluateTickerGammaRules({
    direction: 'bullish',
    ticker_spot: 142.1,
    gamma_flip: 138.0,
    call_wall: 148.0,
    put_wall: 135.0,
    gamma_magnet: 142.0, // within 0.30%
  });
  assert.equal(pinnedGamma.near_magnet, true);
  assert.equal(pinnedGamma.ticker_gamma_modifier, -8);

  const sectorAlign = computeSectorTideAlignment({
    candidate_direction: 'bullish',
    sector_tide_direction: 'bullish',
  });
  assert.equal(sectorAlign, 1.0);

  const bullCandle = {
    ticker: 'NVDA',
    window_end_ms: Date.now(),
    open: 144.2,
    high: 147.0,
    low: 144.0,
    close: 146.8,
    volume: 5_200_000,
    vwap: 145.4,
    relative_volume_5m: 2.35,
    return_5m: 0.0136,
  };

  const adaptiveScore = computeAdaptiveWhaleScore({
    premium_5m: 840_000,
    sweep_ratio: 0.69,
    repeated_hit_flag: true,
    dominant_side_share: 0.89,
    volume: 6420,
    open_interest: 1450,
    contract_share: 0.62,
    direction: 'bullish',
    candle: bullCandle,
    spread: 0.04,
    avg_daily_dollar_volume: 18_500_000_000,
    multileg_ratio: 0.08,
    dte: 33,
    active_profile: 'risk_on_trend',
    market_tide_alignment: 1.0,
    sector_tide_alignment: 1.0,
    gamma_context: breakoutGamma,
    conflicts_with_market_regime: false,
  });

  assert.ok(adaptiveScore.base_score >= 85);
  assert.equal(adaptiveScore.regime_adjustments, 10); // +6 call wall breakout + 4 sector agreement in risk_on_trend
  assert.ok(adaptiveScore.final_score >= 95);
});

test('v2.1 Alpaca Stock Confirmation: Bullish 5-of-5 rules, secondary boosts, and 70/30 composite score', () => {
  const det = generateDeterministicBarsForCandidate({
    ticker: 'NVDA',
    direction: 'bullish',
    close: 145.05,
    open: 143.1,
    high: 145.4,
    low: 142.9,
    vwap: 144.12,
    volume_5m: 8_920_000,
    relative_volume_5m: 2.35,
  });

  const evalBull = evaluateStockConfirmation({
    direction: 'bullish',
    options_flow_score: 96,
    bars5m: det.bars5m,
    bars1m: det.bars1m,
    lit_prints: det.lit_trades,
    min_lit_premium: 100_000,
    data_source: 'alpaca_live_sip',
    flow_burst_reference_price: 143.1,
  });

  assert.equal(evalBull.confirmed_3_of_5, true);
  assert.ok(evalBull.rules_passed_count >= 4);
  assert.equal(evalBull.weighted_components.vwap_alignment, 1.0);
  assert.equal(evalBull.weighted_components.relative_volume_confirmation, 1.0);
  assert.equal(evalBull.weighted_components.atr_follow_through, 1.0);
  assert.ok(evalBull.stock_confirmation_score >= 80);
  assert.equal(evalBull.lit_flow.has_supporting_large_print, true);
  assert.ok(evalBull.final_composite_score >= 90);
});

test('v2.1 Alpaca Stock Confirmation: Bearish mirror rules & secondary boost guardrail', () => {
  const detBear = generateDeterministicBarsForCandidate({
    ticker: 'MU',
    direction: 'bearish',
    close: 96.2,
    open: 98.1,
    high: 98.3,
    low: 95.9,
    vwap: 97.25,
    volume_5m: 5_400_000,
    relative_volume_5m: 2.1,
  });

  const evalBear = evaluateStockConfirmation({
    direction: 'bearish',
    options_flow_score: 88,
    bars5m: detBear.bars5m,
    bars1m: detBear.bars1m,
    lit_prints: detBear.lit_trades,
    min_lit_premium: 100_000,
    data_source: 'alpaca_live_sip',
    flow_burst_reference_price: 98.1,
  });

  assert.equal(evalBear.confirmed_3_of_5, true);
  assert.ok(evalBear.rules_passed_count >= 4);
  assert.equal(evalBear.weighted_components.vwap_alignment, 1.0);
  assert.ok(evalBear.stock_confirmation_score >= 80);

  // Guardrail check: if a bullish candidate faces bearish price action (< 3 rules passed), secondary boosts must be 0
  const conflictingEval = evaluateStockConfirmation({
    direction: 'bullish',
    options_flow_score: 80,
    bars5m: detBear.bars5m,
    bars1m: detBear.bars1m,
    lit_prints: detBear.lit_trades,
    min_lit_premium: 100_000,
    data_source: 'alpaca_live_sip',
    flow_burst_reference_price: 98.1,
  });

  assert.equal(conflictingEval.confirmed_3_of_5, false);
  assert.equal(conflictingEval.secondary_boost_points, 0);
});

test('v2.2 Alpaca Account Engine: OCC Option Symbol parser & account normalization', () => {
  const callOpt = parseOccOptionSymbol('UNH261016C00410000');
  assert.equal(callOpt.is_option, true);
  assert.equal(callOpt.underlying, 'UNH');
  assert.equal(callOpt.expiration_date, '2026-10-16');
  assert.equal(callOpt.option_type, 'CALL');
  assert.equal(callOpt.strike_price, 410);
  assert.equal(callOpt.multiplier, 100);
  assert.equal(callOpt.short_label, 'UNH $410C 10/16');

  const decOpt = parseOccOptionSymbol('NFLX261120C00067500');
  assert.equal(decOpt.strike_price, 67.5);
  assert.equal(decOpt.short_label, 'NFLX $67.50C 11/20');

  const eq = parseOccOptionSymbol('NVDA');
  assert.equal(eq.is_option, false);
  assert.equal(eq.multiplier, 1);

  const acc = normalizeAlpacaAccount({
    id: 'acc-1',
    account_number: 'PA3OUZMI3MFU',
    status: 'ACTIVE',
    currency: 'USD',
    buying_power: '84780.84',
    cash: '21195.21',
    portfolio_value: '24505.21',
    equity: '24505.21',
    last_equity: '24705.21',
    long_market_value: '3310',
    short_market_value: '0',
    options_trading_level: 3,
    multiplier: '4',
  });
  assert.equal(acc.day_pl, -200);
  assert.equal(acc.options_level, 3);
});

test('v2.2 Alpaca Account Engine: FIFO round-trip trade P/L reconstruction & portfolio history', () => {
  const fills = [
    {
      id: 'f1',
      activity_type: 'FILL' as const,
      transaction_time: '2026-10-15T15:57:28Z',
      type: 'fill',
      price: '4.30',
      qty: '1',
      side: 'buy' as const,
      symbol: 'TSLA261016P00360000',
      order_id: 'ord-buy-1',
    },
    {
      id: 'f2',
      activity_type: 'FILL' as const,
      transaction_time: '2026-10-15T16:32:24Z',
      type: 'fill',
      price: '5.50',
      qty: '1',
      side: 'sell' as const,
      symbol: 'TSLA261016P00360000',
      order_id: 'ord-sell-1',
    },
    {
      id: 'f3',
      activity_type: 'FILL' as const,
      transaction_time: '2026-10-15T17:18:49Z',
      type: 'fill',
      price: '0.90',
      qty: '7',
      side: 'buy' as const,
      symbol: 'PLTR261016P00195000',
      order_id: 'ord-buy-2',
    },
    {
      id: 'f4',
      activity_type: 'FILL' as const,
      transaction_time: '2026-10-15T19:13:53Z',
      type: 'fill',
      price: '0.56',
      qty: '7',
      side: 'sell' as const,
      symbol: 'PLTR261016P00195000',
      order_id: 'ord-sell-2',
    },
  ];

  const recon = reconstructRoundTripTrades(fills, []);
  assert.equal(recon.closed_trades.length, 2);
  assert.equal(recon.metrics.win_count, 1);
  assert.equal(recon.metrics.loss_count, 1);
  assert.equal(recon.metrics.win_rate_pct, 50);
  // TSLA: (5.50 - 4.30) * 1 * 100 = +$120.00
  // PLTR: (0.56 - 0.90) * 7 * 100 = -$238.00
  assert.equal(recon.metrics.gross_profit, 120);
  assert.equal(recon.metrics.gross_loss, 238);
  assert.equal(recon.metrics.total_realized_pl, -118);
  assert.equal(recon.daily_realized_pl.length, 1);
  assert.equal(recon.daily_realized_pl[0].realized_pl, -118);

  const hist = normalizePortfolioHistory(
    {
      timestamp: [1792157400, 1792157700, 1792158000],
      equity: [25000, 25250, 25100],
      profit_loss: [0, 250, -150],
      profit_loss_pct: [0, 0.01, -0.0059],
      base_value: 25000,
      timeframe: '5Min',
    },
    '1D'
  );
  assert.equal(hist.points.length, 3);
  assert.equal(hist.net_pl, 100);
  assert.equal(hist.max_drawdown_dollars, 150);
});

test('LM Studio LLM Engine Configuration, Multi-Endpoint Model Discovery, Think/No-Think Mode & Max Tokens', () => {
  const runtime = new WhaleScannerRuntime();
  const initialConfig = runtime.getLlmEngineConfig();
  assert.equal(initialConfig.provider, 'lm_studio');
  assert.equal(initialConfig.endpointUrl, 'http://localhost:1234/v1');
  assert.equal(initialConfig.thinkingMode, 'no_think');
  assert.equal(initialConfig.maxTokensEnabled, true);
  // Ensure no hardcoded mock models exist in catalog
  assert.equal(LLM_MODEL_CATALOG.length, 0);

  // 1. Verify URL normalization prevents duplicate /v1/models or /chat/completions paths
  const norm1 = normalizeLmStudioEndpoints(
    'http://localhost:1234/v1/chat/completions'
  );
  assert.equal(norm1.openAiBase, 'http://localhost:1234/v1');
  assert.equal(
    norm1.chatCompletionsUrl,
    'http://localhost:1234/v1/chat/completions'
  );
  assert.equal(norm1.openAiModelsUrl, 'http://localhost:1234/v1/models');
  assert.equal(norm1.nativeV0ModelsUrl, 'http://localhost:1234/api/v0/models');

  // 2. Verify detection of LM Studio false-positive HTTP 200 "Unexpected endpoint or method"
  const false200 = parseLmStudioModelsResponse({
    error: 'Unexpected endpoint or method. (GET /v1/models). Returning 200 anyway',
  });
  assert.equal(false200.models.length, 0);
  assert.ok(
    false200.unexpectedEndpointError?.includes('Unexpected endpoint or method')
  );

  // 3. Verify parsing of real LM Studio /v1/models and /api/v0/models payloads
  const realModels = parseLmStudioModelsResponse({
    data: [
      {
        id: 'qwen2.5-coder-32b-instruct@q4_k_m',
        state: 'loaded',
        arch: 'qwen2',
        max_context_length: 32768,
      },
    ],
  });
  assert.equal(realModels.models.length, 1);
  assert.equal(realModels.models[0].id, 'qwen2.5-coder-32b-instruct@q4_k_m');
  assert.equal(realModels.models[0].state, 'loaded');

  // 4. Verify think / no_think prompt formatting & maxTokensEnabled toggle
  const noThinkPayload = buildOptimizedLmStudioChatPayload({
    modelId: 'qwen2.5-coder-32b-instruct@q4_k_m',
    systemPrompt: 'System prompt.',
    userPrompt: 'User prompt.',
    temperature: 0.15,
    topP: 0.9,
    maxTokens: 4096,
    maxTokensEnabled: true,
    thinkingMode: 'no_think',
  });
  assert.ok(noThinkPayload.messages[0].content.includes('/no_think'));
  assert.equal(noThinkPayload.max_tokens, 4096);

  const unboundedThinkPayload = buildOptimizedLmStudioChatPayload({
    modelId: 'deepseek-r1-distill-qwen-32b',
    systemPrompt: 'System prompt.',
    userPrompt: 'User prompt.',
    temperature: 0.15,
    topP: 0.9,
    maxTokens: 4096,
    maxTokensEnabled: false,
    thinkingMode: 'think',
  });
  assert.ok(unboundedThinkPayload.messages[0].content.includes('/think'));
  assert.equal(unboundedThinkPayload.max_tokens, undefined);

  // 5. Verify <think> tag extraction & JSON extraction
  const rawWithThink = `<think>\nChecking whale score and VWAP alignment...\n</think>\n\`\`\`json\n{"decision": "EXECUTE", "conviction_score": 92}\n\`\`\``;
  const { thinkingTrace, cleanContent } =
    extractThinkingAndCleanContent(rawWithThink);
  assert.ok(thinkingTrace?.includes('Checking whale score'));
  assert.ok(!cleanContent.includes('<think>'));
  const parsedObj = extractJsonObjectFromLlmText(rawWithThink);
  assert.equal(parsedObj?.decision, 'EXECUTE');

  // 6. Verify persisting discovered models from LM Studio
  const updated = runtime.updateLlmEngineConfig({
    endpointUrl: 'http://192.168.1.42:1234/v1/chat/completions/',
    discoveredModels: realModels.models,
    thinkingMode: 'think',
    maxTokensEnabled: true,
    maxTokens: 8192,
    temperature: 0.15,
    timeoutMs: 45000,
    enabled: true,
  });

  assert.equal(updated.endpointUrl, 'http://192.168.1.42:1234/v1');
  assert.equal(updated.modelId, 'qwen2.5-coder-32b-instruct@q4_k_m');
  assert.equal(updated.thinkingMode, 'think');
  assert.equal(updated.maxTokensEnabled, true);
  assert.equal(updated.maxTokens, 8192);
  assert.equal(updated.discoveredModels.length, 1);

  const snapshot = runtime.exportPersistentSnapshot();
  assert.ok(snapshot.llm_engine_config);
  assert.equal(
    snapshot.llm_engine_config?.endpointUrl,
    'http://192.168.1.42:1234/v1'
  );
  assert.equal(
    snapshot.llm_engine_config?.modelId,
    'qwen2.5-coder-32b-instruct@q4_k_m'
  );
});

test('API Activity Monitor & AI Analysis Activity Monitor Engine', async () => {
  // 1. Sensitive key redaction in API payloads
  const sanitized = sanitizePayloadForLog({
    headers: {
      Authorization: 'Bearer secret-token-123',
      'APCA-API-SECRET-KEY': 'super-secret-alpaca-key',
    },
    query: { symbols: 'NVDA,TSLA' },
  });
  assert.ok(sanitized.includes('***REDACTED***'));
  assert.ok(!sanitized.includes('secret-token-123'));
  assert.ok(!sanitized.includes('super-secret-alpaca-key'));

  // 2. Service classification
  assert.equal(
    classifyApiServiceFromPath('/api/alpaca/stock-context/NVDA').service,
    'Alpaca Market Data v2'
  );
  assert.equal(
    classifyApiServiceFromPath('http://localhost:1234/v1/chat/completions').service,
    'LM Studio LLM Engine'
  );

  // 3. Runtime seeded logs & metrics
  const runtime = new WhaleScannerRuntime();
  const apiLogs = runtime.getApiActivityLogs();
  assert.ok(apiLogs.length >= 5);
  const apiMetrics = computeApiActivityMetrics(apiLogs);
  assert.equal(apiMetrics.total_requests, apiLogs.length);
  assert.ok(apiMetrics.success_count >= 1);
  assert.ok(apiMetrics.error_count >= 1);

  // 4. Execute AI Analysis (Quantitative Synthesis & Simulated Error)
  const synthResult = await runtime.executeAiAnalysisForCandidate({
    ticker: 'NVDA',
    analysis_type: 'whale_candidate_evaluation',
    execution_mode: 'deterministic_synthesis',
  });
  assert.equal(synthResult.status, 'success');
  assert.equal(synthResult.ticker, 'NVDA');
  assert.ok(synthResult.input_payload.user_prompt.includes('NVDA'));
  assert.ok(synthResult.output_payload.assistant_message.includes('Conviction'));

  const errorResult = await runtime.executeAiAnalysisForCandidate({
    ticker: 'TSLA',
    analysis_type: 'stock_technical_confirmation',
    execution_mode: 'simulate_error',
  });
  assert.equal(errorResult.status, 'error');
  assert.equal(errorResult.error_details.has_error, true);
  assert.equal(errorResult.error_details.error_code, 'ECONNREFUSED');

  const allAiLogs = runtime.getAiAnalysisLogs();
  const aiMetrics = computeAiAnalysisMetrics(allAiLogs);
  assert.ok(aiMetrics.total_analyses >= 10);
  assert.equal(
    aiMetrics.processing_count,
    0,
    'Idle runtime with no in-flight LM Studio HTTP call must report 0 processing items (no fake processing entries)'
  );
  assert.ok(aiMetrics.pending_count >= 1, 'Expected pending queued AI entries');
  assert.ok(aiMetrics.error_count >= 2);
  assert.ok(aiMetrics.total_analysis_time_ms > 0, 'Expected positive total AI analysis time');
  assert.ok(aiMetrics.completed_analysis_time_ms > 0, 'Expected positive completed AI analysis time');

  // Verify Elapsed Time Counter formatting & monotonic live elapsed calculation
  assert.equal(formatElapsedCounter(0), '00:00.0');
  assert.equal(formatElapsedCounter(4250), '00:04.2');
  assert.equal(formatElapsedCounter(65800), '01:05.8');

  const firstPending = allAiLogs.find((l) => l.status === 'pending');
  assert.ok(firstPending, 'Expected at least one pending entry');
  const t0 = Date.now();
  const simulatedInFlight = {
    ...firstPending,
    status: 'processing' as const,
    latency_ms: 250,
    queue_metadata: {
      ...firstPending.queue_metadata!,
      started_at: new Date(t0 - 250).toISOString(),
    },
  };
  const elapsedT0 = computeLiveEntryElapsedMs(simulatedInFlight, t0);
  const elapsedT1 = computeLiveEntryElapsedMs(simulatedInFlight, t0 + 1500);
  assert.ok(elapsedT1 >= elapsedT0 + 1400, 'Expected live elapsed time counter to advance with clock');

  assert.ok(
    allAiLogs.some((l) => l.analysis_type === 'holding_stage1_risk_evaluation'),
    'Expected Holdings Stage-1 AI risk evaluation logs'
  );
  assert.ok(
    allAiLogs.some((l) => l.analysis_type === 'holding_stage2_exit_plan'),
    'Expected Holdings Stage-2 AI exit plan logs'
  );

  // Process a pending entry and confirm it completes
  const processedRes = await runtime.processPendingAiAnalyses({
    analysis_id: firstPending.analysis_id,
  });
  assert.equal(processedRes.processed_count, 1);
  assert.ok(processedRes.logs.some((l) => l.status === 'success'));

  // Verify 3x default Concurrent AI Analysis configuration in both LlmEngineConfig and AutomatedPipelineState
  assert.equal(runtime.getLlmEngineConfig().concurrentAnalyses, 3);
  assert.equal(runtime.getAutomationState().concurrent_ai_analyses, 3);
  assert.ok(runtime.getLlmEngineConfig().timeoutMs >= 90000);

  // Verify buildOptimizedLmStudioChatPayload enforces >= 1536 max_tokens floor for reasoning models
  const floorCheckPayload = buildOptimizedLmStudioChatPayload({
    modelId: 'qwen/qwen3.8-27b',
    systemPrompt: 'Sys',
    userPrompt: 'Usr',
    temperature: 0.15,
    topP: 0.9,
    maxTokens: 350,
    maxTokensEnabled: true,
    thinkingMode: 'no_think',
  });
  assert.equal(floorCheckPayload.max_tokens, 1536);

  const updatedLlmCfg = runtime.updateLlmEngineConfig({ concurrentAnalyses: 4 });
  assert.equal(updatedLlmCfg.concurrentAnalyses, 4);
  assert.equal(runtime.getAutomationState().concurrent_ai_analyses, 4);

  const updatedAutoSt = runtime.updateAutomationConfig({ concurrent_ai_analyses: 2 });
  assert.equal(updatedAutoSt.concurrent_ai_analyses, 2);
  assert.equal(runtime.getLlmEngineConfig().concurrentAnalyses, 2);
});

test('Smart Options Order Filling & Spread-Crossing Engine (Microprice, Delta-Peg & Wide-Spread Guardrail)', () => {
  const runtime = new WhaleScannerRuntime();

  // 1. Preview live option spread microstructure combining Unusual Whales flow & Alpaca spot
  const micro = runtime.previewSmartOrderForCandidate({
    ticker: 'NVDA',
    side: 'buy_to_open',
    bid_override: 5.0,
    ask_override: 5.4,
    live_spot_override: 145.65,
  });
  assert.equal(micro.ticker, 'NVDA');
  assert.equal(micro.nbbo_bid, 5.0);
  assert.equal(micro.nbbo_ask, 5.4);
  assert.equal(micro.nbbo_mid, 5.2);
  assert.equal(micro.nbbo_spread_dollars, 0.4);
  assert.ok(micro.recommended_initial_limit > micro.nbbo_bid);
  assert.ok(
    micro.recommended_target_fill >= micro.recommended_initial_limit &&
      micro.recommended_target_fill <= micro.recommended_hard_cap_limit
  );
  assert.ok(micro.recommended_hard_cap_limit < micro.nbbo_ask);
  assert.ok(micro.estimated_savings_per_contract_dollars > 0);
  assert.equal(micro.spread_guard_triggered, false);

  // 2. Execute Auto-Fill Smart Order and verify price-walking ladder & dollar savings vs Ask
  const filledTicket = runtime.executeSmartOrderForCandidate({
    ticker: 'NVDA',
    side: 'buy_to_open',
    qty: 10,
    algo: 'adaptive_microprice_walk',
    simulate_mode: 'auto_fill',
    bid_override: 5.0,
    ask_override: 5.4,
  });
  assert.equal(filledTicket.status, 'filled');
  assert.equal(filledTicket.filled_qty, 10);
  assert.ok(filledTicket.avg_fill_price !== null);
  assert.ok(filledTicket.avg_fill_price! < 5.4);
  assert.ok(filledTicket.total_dollars_saved > 0);
  assert.ok(filledTicket.spread_captured_pct > 25);
  assert.ok(filledTicket.walk_ladder.length >= 2);

  // 3. Stage Working Walker and step-walk to completion
  const workingTicket = runtime.executeSmartOrderForCandidate({
    ticker: 'TSLA',
    side: 'buy_to_open',
    qty: 8,
    algo: 'delta_pegged_mid',
    simulate_mode: 'working_walk',
    bid_override: 6.2,
    ask_override: 6.6,
  });
  assert.equal(workingTicket.status, 'partially_filled');
  assert.ok(workingTicket.filled_qty < 8);

  const completedTicket = runtime.advanceSmartOrderTicket(
    workingTicket.order_id,
    'complete_at_fair_value'
  );
  assert.ok(completedTicket);
  assert.equal(completedTicket?.status, 'filled');
  assert.equal(completedTicket?.filled_qty, 8);

  // 4. Verify Wide-Spread Guardrail blocks aggressive spread crossing when spread > maxSpreadPctGuardrail
  const guardTicket = runtime.executeSmartOrderForCandidate({
    ticker: 'AMD',
    side: 'buy_to_open',
    qty: 5,
    algo: 'liquidity_sniper_twap',
    simulate_mode: 'wide_spread_guard',
  });
  assert.equal(guardTicket.status, 'spread_guard_paused');
  assert.equal(guardTicket.filled_qty, 0);
  assert.ok(guardTicket.error_message?.includes('exceeds guardrail ceiling'));

  const portfolioMetrics = computeSmartOrderPortfolioMetrics(
    runtime.getSmartOrderTickets()
  );
  assert.ok(portfolioMetrics.total_orders >= 6);
  assert.ok(portfolioMetrics.total_dollars_saved_vs_ask > 0);
});

test('Regime-Aware Whale Flow Scanner Strategy: Market Tide Slopes, SPX Periscope/GEX, Stock Screener, 14-Factor FlowScore & Alpaca Confirmation', () => {
  const runtime = new WhaleScannerRuntime();
  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 25,
  });
  const marketTide = runtime.getMarketTideState();

  // 1. Bull Expansion evaluation
  const bullEval = evaluateRegimeWhaleStrategyPipeline({
    marketTide,
    candidates,
    overrideRegime: 'bull_expansion',
  });
  assert.equal(bullEval.regime_classification.regime, 'bull_expansion');
  assert.equal(bullEval.regime_classification.tide, 'Bullish');
  assert.equal(
    bullEval.regime_classification.spx_periscope.gamma_explosive,
    true
  );
  assert.ok(
    bullEval.regime_classification.spx_periscope.spx_spot > 5000 &&
      bullEval.regime_classification.spx_periscope.spy_spot_proxy < 1000,
    'SPX index level and SPY proxy level must remain distinct'
  );
  assert.ok(
    bullEval.screener_spec.sql_where_clause.includes('price > ema_20') &&
      bullEval.screener_spec.sql_where_clause.includes('call_volume > put_volume') &&
      bullEval.screener_spec.sql_where_clause.includes('open_interest >= 50000')
  );
  assert.equal(bullEval.tape_filter_json.type, 'Calls');
  assert.equal(bullEval.tape_filter_json.min_premium, '100000');

  const topCandidate = bullEval.evaluated_candidates[0];
  assert.ok(topCandidate);
  assert.equal(topCandidate.Rank, 1);
  assert.equal(topCandidate.flow_score.components.length, 14);
  assert.equal(
    topCandidate.contract_selection.ranking_designation,
    'Highest-Ranked by Current Model Inputs'
  );
  assert.equal(topCandidate.rule_hierarchy.length, 6);

  // 2. Bear Expansion evaluation
  const bearEval = evaluateRegimeWhaleStrategyPipeline({
    marketTide,
    candidates,
    overrideRegime: 'bear_expansion',
  });
  assert.equal(bearEval.regime_classification.regime, 'bear_expansion');
  assert.ok(
    bearEval.screener_spec.sql_where_clause.includes('price < ema_20') &&
      bearEval.screener_spec.sql_where_clause.includes('put_volume > call_volume')
  );
  assert.equal(bearEval.tape_filter_json.type, 'Puts');

  // 3. Pinned / Range evaluation (verifies non-explosive GEX and defined-risk spread recommendation)
  const pinnedEval = evaluateRegimeWhaleStrategyPipeline({
    marketTide,
    candidates,
    overrideRegime: 'pinned_range',
  });
  assert.equal(
    pinnedEval.regime_classification.spx_periscope.gamma_explosive,
    false
  );
  assert.equal(
    pinnedEval.evaluated_candidates[0].contract_selection.structure_type,
    'range_pinning_iron_condor_or_fade'
  );

  // 4. Conflict evaluation (verifies red bar alone without break is NOT gamma explosive)
  const conflictEval = evaluateRegimeWhaleStrategyPipeline({
    marketTide,
    candidates,
    overrideRegime: 'conflict',
  });
  assert.equal(
    conflictEval.regime_classification.spx_periscope.gamma_explosive,
    false
  );
  assert.equal(conflictEval.regime_classification.review_threshold, 84);
});

test('LLM Trade-Decision Pipeline: 7-Section Evidence Packet, Automated Decision Gate (EXECUTE, WATCH, SKIP) & Automated Smart Order Fulfillment', async () => {
  const runtime = new WhaleScannerRuntime();
  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 25,
  });
  const marketTide = runtime.getMarketTideState();
  const cand = candidates[0];
  assert.ok(cand);

  // 1. Verify EXECUTE packet and 7 sections (A-G) including contract_aggregation telemetry
  const execPacket = buildLlmTradeEvidencePacket({
    candidate: cand,
    marketTide,
    stressScenario: 'force_execute_aligned',
  });
  assert.equal(
    execPacket.model_rank_designation,
    'Highest-Ranked by Current Model Inputs'
  );
  assert.ok(
    execPacket.section_a_contract_and_whale_flow.uw_endpoints_used.includes(
      'GET /api/option-trades'
    )
  );
  assert.ok(execPacket.section_a_contract_and_whale_flow.contract_aggregation);
  assert.ok(
    execPacket.section_a_contract_and_whale_flow.contract_aggregation!.aggregated_print_count >= 1
  );
  assert.ok(
    execPacket.section_b_underlying_confirmation.alpaca_endpoints_used.some(
      (ep) => ep.includes('/v2/stocks/')
    )
  );
  assert.ok(
    execPacket.section_c_ticker_gamma_positioning.spx_index_context.spx_vs_spy_guardrail_note.includes(
      'never used as literal SPY price levels'
    )
  );
  const execDecision = evaluateStructuredLlmDecisionFromPacket(execPacket);
  assert.equal(execDecision.decision, 'EXECUTE');
  assert.equal(execDecision.autonomous_execution_blocked, true);
  assert.equal(execDecision.pillar_scorecard.length, 6);

  const execRiskGate = evaluateDeterministicRiskGate(execPacket);
  assert.equal(execRiskGate.autonomous_execution_blocked, true);
  assert.equal(execRiskGate.passed_all_hard_gates, true);

  // 2. Verify WATCH packet
  const watchPacket = buildLlmTradeEvidencePacket({
    candidate: cand,
    marketTide,
    stressScenario: 'force_watch_vwap',
  });
  const watchDecision = evaluateStructuredLlmDecisionFromPacket(watchPacket);
  assert.equal(watchDecision.decision, 'WATCH');
  assert.ok(watchDecision.watch_confirmation_triggers.length > 0);

  // 3. Verify Ambiguity packet auto-resolves to WATCH or SKIP without blocking on human approval
  const ambiguityPacket = buildLlmTradeEvidencePacket({
    candidate: cand,
    marketTide,
    stressScenario: 'force_human_review_ambiguity',
  });
  const ambiguityDecision = evaluateStructuredLlmDecisionFromPacket(ambiguityPacket);
  assert.ok(
    ambiguityDecision.decision === 'WATCH' || ambiguityDecision.decision === 'SKIP'
  );
  assert.ok(ambiguityDecision.human_review_ambiguities.length > 0);

  // 4. Verify SKIP packet (contradicted VWAP / wide spread / opposing flow)
  const skipPacket = buildLlmTradeEvidencePacket({
    candidate: cand,
    marketTide,
    stressScenario: 'force_skip_contradicted',
  });
  const skipDecision = evaluateStructuredLlmDecisionFromPacket(skipPacket);
  assert.equal(skipDecision.decision, 'SKIP');
  assert.equal(skipDecision.recommended_structure, 'No Trade / Pass');

  // 5. Verify Runtime evaluation automatically stages and fulfills Smart Order without human approval
  const runtimeRec = await runtime.evaluateLlmTradeDecisionForCandidate({
    candidate_id: cand.candidate_id,
    stress_scenario: 'force_execute_aligned',
    execution_mode: 'deterministic_synthesis',
  });
  assert.equal(runtimeRec.llm_output.decision, 'EXECUTE');
  assert.equal(runtimeRec.approval_status, 'approved_staged_to_smart_order');
  assert.ok(runtimeRec.staged_smart_order_id);
});

test('Simplified Risk-First Execution Plan: Alpaca Account Gate, Entry/Stop/Target Math, Dual Risk & Capital Caps ($25K Spec Benchmark), and SUBMIT / REDUCE / REJECT', () => {
  const runtime = new WhaleScannerRuntime();
  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 25,
  });
  const marketTide = runtime.getMarketTideState();
  const cand = candidates[0];
  assert.ok(cand);

  const execPacket = buildLlmTradeEvidencePacket({
    candidate: cand,
    marketTide,
    stressScenario: 'force_execute_aligned',
  });

  // 1. Verify Alpaca Trading API endpoints and snapshot normalization
  const alpacaSnap = buildAlpacaTradingGateSnapshot();
  assert.deepEqual(alpacaSnap.endpoints_queried, [
    'GET /v2/account',
    'GET /v2/account/configurations',
    'GET /v2/positions',
    'GET /v2/orders?status=open',
    'GET /v2/clock',
  ]);
  assert.equal(alpacaSnap.trading_blocked, false);
  assert.equal(alpacaSnap.account_blocked, false);
  assert.ok(alpacaSnap.options_approved_level >= 1);

  // 2. Verify contract_cost, contract_stop_price, risk_per_contract, and first target
  const tradePlan = buildOptionTradePlanLevels({
    packet: execPacket,
    plannedEntryOverride: 2.4,
    contractStopOverride: 1.8,
  });
  assert.equal(tradePlan.planned_entry_price, 2.4);
  assert.equal(tradePlan.contract_cost_dollars, 240); // 2.40 * 100
  assert.equal(tradePlan.contract_stop_price, 1.8);
  assert.equal(tradePlan.risk_per_contract_dollars, 60); // (2.40 - 1.80) * 100
  assert.ok(tradePlan.contract_first_target_price > tradePlan.planned_entry_price);
  assert.ok(tradePlan.reward_to_risk_ratio >= 1.5);

  // 3. Verify Exact Section 4, 5, 6, 9, 10 $25,000 Equity Spec Example (Entry $5.00, Stop $3.75, Risk/ct $125, Max Alloc $750 -> Qty 1)
  const exactSpec25k = evaluateRiskFirstExecutionPlan({
    packet: execPacket,
    llmDecision: 'EXECUTE',
    policy: {
      ...SPEC_25K_EXAMPLE_RISK_POLICY,
      desired_contracts: 1,
    },
    plannedEntryOverride: 5.0,
    contractStopOverride: 3.75,
  });
  assert.equal(exactSpec25k.budgets.effective_equity_dollars, 25000);
  assert.equal(exactSpec25k.budgets.max_dollar_risk_per_trade, 125);
  assert.equal(exactSpec25k.budgets.max_premium_outlay_per_trade, 750);
  assert.equal(exactSpec25k.trade_plan.planned_entry_price, 5.0);
  assert.equal(exactSpec25k.trade_plan.contract_cost_dollars, 500);
  assert.equal(exactSpec25k.trade_plan.contract_stop_price, 3.75);
  assert.equal(exactSpec25k.trade_plan.risk_per_contract_dollars, 125);
  assert.equal(exactSpec25k.sizing.qty_by_dollar_risk, 1);
  assert.equal(exactSpec25k.sizing.qty_by_option_allocation, 1);
  assert.equal(exactSpec25k.sizing.qty_by_buying_power, 30); // floor($15,000 / $500) = 30
  assert.equal(exactSpec25k.sizing.permitted_qty, 1);
  assert.equal(exactSpec25k.output_contract.decision, 'APPROVED');
  assert.equal(exactSpec25k.output_contract.quantity, 1);
  assert.equal(exactSpec25k.output_contract.entry_limit, 5.0);
  assert.equal(exactSpec25k.output_contract.premium_stop, 3.75);
  assert.equal(exactSpec25k.output_contract.maximum_debit, 500);
  assert.equal(exactSpec25k.output_contract.maximum_planned_loss, 125);
  assert.equal(exactSpec25k.output_contract.risk_pct_of_equity, 0.005);

  // 4. Verify Stage-2 LLM Risk & Order Size Assessment & Prompt Builder
  const stage2Prompts = buildStage2LlmRiskAssessmentPrompts({
    plan: exactSpec25k,
    modelId: 'qwen2.5-coder-32b-instruct',
    endpointUrl: 'http://localhost:1234/v1',
    temperature: 0.15,
    topP: 0.9,
    maxTokens: 1024,
    maxTokensEnabled: true,
    thinkingMode: 'no_think',
  });
  assert.equal(
    stage2Prompts.endpoint_url,
    'http://localhost:1234/v1/chat/completions'
  );
  const parsedStage2 = parseOrFallbackStage2LlmRiskAssessment({
    rawContent: `<think>Sizing check</think>{"decision":"APPROVED","quantity":1,"entry_limit":5.0,"premium_stop":3.75,"maximum_debit":500,"maximum_planned_loss":125,"risk_pct_of_equity":0.005,"rejection_checks":[],"recommended_smart_algo":"adaptive_microprice_walk","llm_risk_narrative":"Approved 1 contract within $125 risk cap.","execution_notes":"Stage limit @ $5.00"}`,
    plan: exactSpec25k,
    executionMode: 'lm_studio_live',
    modelId: 'qwen2.5-coder-32b-instruct',
    thinkingMode: 'think',
    latencyMs: 65,
  });
  assert.equal(parsedStage2.decision, 'APPROVED');
  assert.equal(parsedStage2.quantity, 1);
  assert.equal(parsedStage2.maximum_debit, 500);
  assert.equal(parsedStage2.maximum_planned_loss, 125);
  assert.equal(parsedStage2.thinking_trace, 'Sizing check');

  // 5. Verify REDUCE_AND_SUBMIT when desired_contracts (e.g. 5) > permitted_qty (2)
  const reducedResult = evaluateRiskFirstExecutionPlan({
    packet: execPacket,
    llmDecision: 'EXECUTE',
    policy: {
      ...SPEC_25K_EXAMPLE_RISK_POLICY,
      desired_contracts: 5,
    },
    plannedEntryOverride: 2.4,
    contractStopOverride: 1.8,
  });
  assert.equal(reducedResult.execution_action, 'REDUCE_AND_SUBMIT');
  assert.equal(reducedResult.sizing.permitted_qty, 2);
  assert.ok(reducedResult.reduction_reasons.length > 0);

  // 6. Verify REJECT when 1 contract exceeds $125 max dollar risk or trading_blocked=true or LLM != EXECUTE
  const tooExpensiveResult = evaluateRiskFirstExecutionPlan({
    packet: execPacket,
    llmDecision: 'EXECUTE',
    policy: SPEC_25K_EXAMPLE_RISK_POLICY,
    plannedEntryOverride: 8.5, // $850 contract cost > $750 max premium outlay!
    contractStopOverride: 6.5, // $200 stop risk > $125 max dollar risk!
  });
  assert.equal(tooExpensiveResult.execution_action, 'REJECT');
  assert.equal(tooExpensiveResult.sizing.permitted_qty, 0);
  assert.equal(tooExpensiveResult.output_contract.decision, 'SKIP');
  assert.equal(tooExpensiveResult.limit_order_payload, null);

  const watchRejectResult = evaluateRiskFirstExecutionPlan({
    packet: execPacket,
    llmDecision: 'WATCH',
    policy: DEFAULT_RISK_POLICY_CONFIG,
  });
  assert.equal(watchRejectResult.execution_action, 'REJECT');

  const blockedAccountResult = evaluateRiskFirstExecutionPlan({
    packet: execPacket,
    llmDecision: 'EXECUTE',
    alpacaSnapshot: buildAlpacaTradingGateSnapshot({ tradingBlocked: true }),
    policy: DEFAULT_RISK_POLICY_CONFIG,
  });
  assert.equal(blockedAccountResult.execution_action, 'REJECT');
});

test('End-to-End Automated Pipeline (Scan -> Stage-1 LLM -> Stage-2 Risk & Sizing -> Auto Smart Order) & LM Studio Proxy Helpers', async () => {
  assert.equal(isLocalhostLmStudioEndpoint('http://localhost:1234/v1'), true);
  assert.equal(isLocalhostLmStudioEndpoint('http://127.0.0.1:1234/v1'), true);
  assert.equal(
    isLocalhostLmStudioEndpoint('http://d17krzcgng2.d.firewalla.org:9210/v1'),
    false
  );

  const headersWithBearer = buildLmStudioHeaders('lms-secret-token', true);
  assert.equal(headersWithBearer['Content-Type'], 'application/json');
  assert.equal(headersWithBearer['Authorization'], 'Bearer lms-secret-token');

  // Verify LM Studio 0.4+ /api/v1/models parsing (object quantization, loaded_instances, display_name) & embedding exclusion
  const v1Parsed = parseLmStudioModelsResponse({
    models: [
      {
        type: 'llm',
        publisher: 'qwen',
        key: 'qwen/qwen3.8-27b',
        display_name: 'Qwen3.8 27B',
        architecture: 'qwen35',
        quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
        params_string: '27B',
        loaded_instances: ['inst-1'],
        max_context_length: 262144,
      },
      {
        id: 'text-embedding-nomic-embed-text-v1.5',
        object: 'model',
      },
    ],
  });
  assert.equal(v1Parsed.models.length, 1);
  assert.equal(v1Parsed.models[0].id, 'qwen/qwen3.8-27b');
  assert.equal(v1Parsed.models[0].display_name, 'Qwen3.8 27B');
  assert.equal(v1Parsed.models[0].quantization, 'Q4_K_M');
  assert.equal(v1Parsed.models[0].state, 'loaded');

  const runtime = new WhaleScannerRuntime();
  runtime.updateLlmEngineConfig({
    endpointUrl: 'http://d17krzcgng2.d.firewalla.org:9210/v1',
    discoveredModels: v1Parsed.models,
    modelId: 'qwen/qwen3.8-27b',
  });
  // Ensure partial updates with empty discoveredModels (e.g. from Firestore sync) do not wipe scanned models
  const afterPartialSync = runtime.updateLlmEngineConfig({
    temperature: 0.25,
    discoveredModels: [],
  });
  assert.equal(afterPartialSync.discoveredModels.length, 1);
  assert.equal(afterPartialSync.discoveredModels[0].id, 'qwen/qwen3.8-27b');
  assert.equal(afterPartialSync.modelId, 'qwen/qwen3.8-27b');
  runtime.updateLlmEngineConfig({ endpointUrl: 'http://localhost:1234/v1' });

  const initialOrdersCount = runtime.getSmartOrderTickets().length;

  const cycleResult = await runtime.runAutomatedPipelineCycle({
    candidate_id: 'cand-nvda-150c',
    force_re_evaluate: true,
    max_candidates: 1,
  });

  assert.equal(cycleResult.evaluated_records.length, 1);
  const evalRecord = cycleResult.evaluated_records[0];
  assert.equal(evalRecord.ticker, 'NVDA');
  assert.equal(evalRecord.llm_output.decision, 'EXECUTE');
  assert.equal(
    evalRecord.risk_first_execution_plan.stage2_llm_risk_assessment.decision,
    'APPROVED'
  );
  assert.ok(
    evalRecord.risk_first_execution_plan.stage2_llm_risk_assessment.quantity >= 1
  );
  assert.equal(cycleResult.placed_orders.length, 1);
  assert.ok(runtime.getSmartOrderTickets().length >= initialOrdersCount);
  assert.equal(
    runtime.getSmartOrderTickets()[0].ticket_id,
    cycleResult.placed_orders[0].ticket_id
  );
  assert.equal(cycleResult.automation_state.recent_runs[0].order_placed, true);
  assert.equal(cycleResult.automation_state.recent_runs[0].ticker, 'NVDA');
});

test('Same-Contract Activity Aggregation (aggregateContractPrints, mergeCandidatesForSameContract & ingestOptionPrint repeat hits)', () => {
  // 1. Pure aggregateContractPrints verification
  const agg = aggregateContractPrints([
    {
      event_id: 'evt-nvda-1',
      ticker: 'NVDA',
      option_symbol: 'NVDA261120C00150000',
      option_type: 'call',
      strike: 150,
      expiration: '2026-11-20',
      dte: 32,
      price: 6.1,
      size: 250,
      premium: 152500,
      bid: 6.0,
      ask: 6.15,
      underlying_price: 145.6,
      executed_at_ms: 1792333890000,
      exchange: 'CBOE',
      side: 'ask',
      direction: 'bullish',
      is_sweep: true,
      is_floor: false,
      is_multi_leg: false,
      is_opening_likely: true,
      open_interest: 18400,
      volume: 12000,
      iv: 0.48,
      delta: 0.46,
    },
    {
      event_id: 'evt-nvda-2',
      ticker: 'NVDA',
      option_symbol: 'NVDA261120C00150000',
      option_type: 'call',
      strike: 150,
      expiration: '2026-11-20',
      dte: 32,
      price: 6.3,
      size: 250,
      premium: 157500,
      bid: 6.15,
      ask: 6.3,
      underlying_price: 145.8,
      executed_at_ms: 1792333920000,
      exchange: 'ISE',
      side: 'ask',
      direction: 'bullish',
      is_sweep: true,
      is_floor: false,
      is_multi_leg: false,
      is_opening_likely: true,
      open_interest: 18400,
      volume: 12500,
      iv: 0.49,
      delta: 0.47,
    },
  ]);

  assert.equal(agg.is_aggregated, true);
  assert.equal(agg.aggregated_print_count, 2);
  assert.equal(agg.cumulative_contracts, 500);
  assert.equal(agg.cumulative_premium_dollars, 310000);
  assert.equal(agg.vwap_fill_price, 6.2);
  assert.equal(agg.min_fill_price, 6.1);
  assert.equal(agg.max_fill_price, 6.3);
  assert.equal(agg.price_progression, 'ascending_fills');
  assert.equal(agg.aggregation_window_seconds, 30);
  assert.equal(agg.print_ledger.length, 2);
  assert.ok(agg.aggregation_summary.includes('Aggregated 2 prints'));

  // 2. Runtime ingestOptionPrint on an existing contract aggregates into a single candidate
  const runtime = new WhaleScannerRuntime();
  const beforeCandidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 50,
  });
  const nvdaBefore = beforeCandidates.find(
    (c) => c.option_symbol === 'NVDA261120C00150000'
  );
  assert.ok(nvdaBefore);
  assert.ok(nvdaBefore.aggregation);
  const initialPrintsCount = nvdaBefore.aggregation!.aggregated_print_count;
  const initialTotalPrem = nvdaBefore.aggregation!.cumulative_premium_dollars;

  const outcome = runtime.ingestOptionPrint({
    event_id: 'evt-nvda-repeat-test-999',
    ticker: 'NVDA',
    option_symbol: 'NVDA261120C00150000',
    option_type: 'call',
    strike: 150,
    expiry: '2026-11-20',
    dte: 32,
    price: 6.45,
    size: 400,
    side: 'ask',
    is_sweep: true,
    is_multi_leg: false,
    spread: 0.03,
    open_interest: 18400,
    volume: 15250,
    underlying_price: 146.1,
    return_5m: 0.011,
    relative_volume_5m: 2.8,
    vwap_aligned: true,
    avg_daily_dollar_volume: 28_500_000_000,
    flow_alert_rules: ['RepeatedHits', 'RepeatedHitsAscendingFill'],
  });

  assert.equal(outcome.accepted, true);
  assert.ok(outcome.candidate);
  assert.ok(outcome.candidate.aggregation);
  assert.equal(outcome.candidate.aggregation!.is_aggregated, true);
  assert.equal(
    outcome.candidate.aggregation!.aggregated_print_count,
    initialPrintsCount + 1
  );
  assert.equal(
    outcome.candidate.aggregation!.cumulative_premium_dollars,
    initialTotalPrem + 258000
  );
  assert.ok(outcome.candidate.flags.includes('multi_print_contract_aggregated'));

  // Ensure no duplicate NVDA261120C00150000 rows exist in queryCandidates
  const afterCandidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 50,
  });
  const nvdaMatches = afterCandidates.filter(
    (c) => c.option_symbol === 'NVDA261120C00150000'
  );
  assert.equal(
    nvdaMatches.length,
    1,
    'Multiple activities on the same contract must be aggregated into a single candidate row'
  );
});

test('Automatic Scanner Mode Routing: resolveAutoScannerMode and WhaleScannerRuntime auto-select mode by regime', () => {
  const posMode = resolveAutoScannerMode({
    tide_regime: 'strong_positive',
    adaptive_profile: 'risk_on_trend',
  });
  assert.equal(posMode.mode, 'directional_momentum');
  assert.equal(posMode.mode_label, 'Directional Momentum');

  const negMode = resolveAutoScannerMode({
    tide_regime: 'strong_negative',
    adaptive_profile: 'risk_off_trend',
  });
  assert.equal(negMode.mode, 'directional_momentum');

  const rangeMode = resolveAutoScannerMode({
    tide_regime: 'neutral',
    adaptive_profile: 'positive_gamma_range',
  });
  assert.equal(rangeMode.mode, 'accumulation_watch');
  assert.equal(rangeMode.mode_label, 'Accumulation Watch');

  const reversingMode = resolveAutoScannerMode({
    tide_regime: 'reversing',
    adaptive_profile: 'gamma_flip_transition',
  });
  assert.equal(reversingMode.mode, 'urgent_flow');
  assert.equal(reversingMode.mode_label, 'Urgent Flow');

  const stressMode = resolveAutoScannerMode({
    tide_regime: 'mixed',
    adaptive_profile: 'volatility_stress',
    volatility_regime: 'event_or_stress',
  });
  assert.equal(stressMode.mode, 'urgent_flow');

  const runtime = new WhaleScannerRuntime();
  assert.equal(
    runtime.getMarketTideState().auto_scanner_mode,
    'directional_momentum'
  );

  const neutralTide = runtime.setMarketTideRegimePreset('neutral');
  assert.equal(neutralTide.auto_scanner_mode, 'accumulation_watch');
  assert.equal(neutralTide.auto_scanner_mode_label, 'Accumulation Watch');

  const reversingTide = runtime.setMarketTideRegimePreset('reversing');
  assert.equal(reversingTide.auto_scanner_mode, 'urgent_flow');
  assert.equal(reversingTide.auto_scanner_mode_label, 'Urgent Flow');
});

test('Live Background Scanner & Auto-Order Pipeline: ingestLiveMarketAndWhaleStream and runAutomatedPipelineCycle place orders for high-potential candidates', async () => {
  const runtime = new WhaleScannerRuntime();
  // Use deterministic synthesis so the unit test does not wait on a local LM Studio socket
  runtime.updateLlmEngineConfig({ enabled: false });

  const streamRes = await runtime.ingestLiveMarketAndWhaleStream({
    injectDiscoverySweep: true,
  });
  assert.equal(streamRes.discovered_ticker, 'AMZN');
  assert.equal(streamRes.discovered_option_symbol, 'AMZN261120C00215000');

  const cycleRes = await runtime.runAutomatedPipelineCycle({
    candidate_id: 'cand-amzn-215c',
    force_re_evaluate: true,
  });

  assert.ok(cycleRes.evaluated_records.length >= 1);
  const amznRec = cycleRes.evaluated_records.find((r) => r.ticker === 'AMZN');
  assert.ok(amznRec, 'AMZN live discovery sweep should be evaluated by LLM gate');
  assert.equal(amznRec.llm_output.decision, 'EXECUTE');
  assert.equal(
    amznRec.risk_first_execution_plan.stage2_llm_risk_assessment.decision,
    'APPROVED'
  );
  assert.ok(
    amznRec.staged_smart_order_id,
    'Approved high-potential candidate must automatically place a Smart Order ticket'
  );
  assert.ok(cycleRes.placed_orders.length >= 1);

  const strat =
    amznRec.risk_first_execution_plan.stage2_llm_risk_assessment
      .initial_trading_strategy;
  assert.ok(strat, 'Stage-2 AI must produce an initial_trading_strategy plan');
  assert.ok(strat.strategy_name.length > 5);
  assert.ok(strat.entry_execution_plan.includes('AMZN261120C00215000'));
  assert.ok(strat.profit_target_plan.includes('Tranche 1'));
  assert.ok(strat.stop_and_invalidation_plan.includes('Hard option premium stop'));
  assert.ok(strat.time_and_theta_plan.length > 10);
  assert.ok(strat.reward_to_risk_ratio > 1.0);

  const aiLogs = runtime.getAiAnalysisLogs();
  assert.ok(
    aiLogs.length >= 10,
    `Expected >= 10 AI analysis activity logs (Stage-1 + Stage-2), got ${aiLogs.length}`
  );
  const amznStage1Log = aiLogs.find(
    (l) =>
      l.option_symbol === 'AMZN261120C00215000' &&
      l.analysis_type === 'stage1_entry_decision'
  );
  const amznStage2Log = aiLogs.find(
    (l) =>
      l.option_symbol === 'AMZN261120C00215000' &&
      l.analysis_type === 'stage2_position_size_risk_strategy'
  );
  assert.ok(
    amznStage1Log,
    'AMZN order must log a Stage-1 Entry Decision in AI Analysis Activity'
  );
  assert.ok(
    amznStage2Log,
    'AMZN EXECUTE decision must log a Stage-2 Position Size, Risk & Initial Trading Strategy analysis in AI Analysis Activity'
  );
  assert.ok(
    amznStage2Log.output_payload.assistant_message.includes(
      'INITIAL TRADING STRATEGY'
    )
  );
});

test('Holdings Monitor With Unusual Whales, Alpaca, and LLM Exit Plans: defaults to automatic execution (no approval required by default) and supports centralized approval policy toggle', async () => {
  const runtime = new WhaleScannerRuntime();
  const autoState = runtime.getAutomationState();
  assert.equal(autoState.approval_required_by_default, false);
  assert.equal(autoState.holdings_default_mode, 'paper_auto');

  const initialState = runtime.getHoldingsMonitorState();
  assert.equal(initialState.environment, 'paper');
  assert.equal(initialState.live_mfa_verified, false);
  assert.ok(initialState.holdings.length >= 5);
  assert.equal(
    initialState.approval_queue.length,
    0,
    'By default approval is not required so plans auto-execute'
  );
  assert.ok(initialState.audit_logs.length >= 5);

  // Verify SHOP 261120P00175000 has volume > OI flagged as unconfirmed and its REDUCE plan is auto-executed by default
  const shopHolding = initialState.holdings.find(
    (h) => h.osi_canonical_symbol === 'SHOP261120P00175000'
  );
  assert.ok(shopHolding, 'SHOP option holding should be monitored');
  assert.equal(shopHolding.monitor_config.mode, 'paper_auto');
  assert.equal(shopHolding.safety_flags.volume_over_oi_unconfirmed, true);
  assert.equal(shopHolding.latest_stage1_decision?.decision, 'REDUCE');
  assert.ok(shopHolding.latest_stage2_plan, 'REDUCE must generate a Stage-2 Execution Plan');
  assert.equal(
    shopHolding.latest_stage2_plan.approval_status,
    'APPROVED_AND_SUBMITTED'
  );
  assert.equal(
    shopHolding.latest_stage2_plan.risk_validation.requires_human_approval,
    false
  );
  assert.ok(
    shopHolding.latest_stage2_plan.limit_price_logic.formula_expression.includes('NBBO_Mid'),
    'Limit price must be formulaic and anchored to live NBBO quotes'
  );

  // Simulate stale quote / wide spread scenario -> should trigger NEEDS_HUMAN_REVIEW and no Stage-2 order
  const staleEval = await runtime.evaluateHoldingWithLlm({
    holding_id: 'hold-nvda-145c',
    simulate_scenario: 'stale_or_wide_spread',
  });
  assert.ok(staleEval);
  assert.equal(staleEval.stage1_decision.decision, 'NEEDS_HUMAN_REVIEW');
  assert.equal(staleEval.stage2_plan, null);

  // Re-evaluate NVDA for stop_loss_breach in default paper_auto mode -> auto-submits limit order without manual approval
  const autoExitEval = await runtime.evaluateHoldingWithLlm({
    holding_id: 'hold-nvda-145c',
    simulate_scenario: 'stop_loss_breach',
  });
  assert.ok(autoExitEval);
  assert.equal(autoExitEval.stage1_decision.decision, 'EXIT');
  assert.ok(autoExitEval.stage2_plan);
  assert.equal(
    autoExitEval.stage2_plan.approval_status,
    'APPROVED_AND_SUBMITTED'
  );
  assert.ok(autoExitEval.stage2_plan.submitted_order_id);

  // Toggle centralized Settings policy to require manual approval
  const updatedPolicy = runtime.updateAutomationConfig({
    approval_required_by_default: true,
  });
  assert.equal(updatedPolicy.approval_required_by_default, true);
  assert.equal(updatedPolicy.holdings_default_mode, 'approval_required');

  const gatedExitEval = await runtime.evaluateHoldingWithLlm({
    holding_id: 'hold-nvda-145c',
    simulate_scenario: 'stop_loss_breach',
  });
  assert.ok(gatedExitEval?.stage2_plan);
  assert.equal(
    gatedExitEval.stage2_plan.approval_status,
    'PENDING_HUMAN_APPROVAL'
  );

  // Approve the gated Stage-2 exit plan
  const approvalRes = await runtime.approveOrRejectHoldingExitPlan({
    plan_id: gatedExitEval.stage2_plan.plan_id,
    action: 'approve',
    operator_name: 'Unit Test Risk Officer',
  });
  assert.ok(approvalRes);
  assert.equal(approvalRes.plan.approval_status, 'APPROVED_AND_SUBMITTED');
  assert.ok(approvalRes.submitted_order);
  assert.ok(
    approvalRes.state.audit_logs.some(
      (l) => l.event_type === 'ALPACA_ORDER_SUBMITTED'
    )
  );
});

test('Holdings Monitor aligns 100% with Alpaca Account positions P/L, Intraday P/L, and Market Value', () => {
  const alpacaPositions = [
    {
      asset_id: '9463481c-ce91-415e-a257-bf47587e35e3',
      symbol: 'AMD261019C00550000',
      underlying: 'AMD',
      display_label: 'AMD $550C 10/19',
      full_label: 'AMD 2026-10-19 $550 CALL',
      is_option: true,
      option_type: 'CALL' as const,
      strike_price: 550,
      expiration_date: '2026-10-19',
      side: 'long' as const,
      qty: 2,
      qty_available: 2,
      multiplier: 100,
      avg_entry_price: 3.2,
      current_price: 0,
      lastday_price: 1.75,
      cost_basis: 640,
      market_value: 0,
      unrealized_pl: -640,
      unrealized_pl_pct: -100,
      intraday_pl: -640,
      intraday_pl_pct: -100,
      change_today_pct: -100,
    },
    {
      asset_id: '3d78ca68-f22a-410c-b355-46889d76d9b1',
      symbol: 'MRVL261023C00240000',
      underlying: 'MRVL',
      display_label: 'MRVL $240C 10/23',
      full_label: 'MRVL 2026-10-23 $240 CALL',
      is_option: true,
      option_type: 'CALL' as const,
      strike_price: 240,
      expiration_date: '2026-10-23',
      side: 'long' as const,
      qty: 1,
      qty_available: 1,
      multiplier: 100,
      avg_entry_price: 9.6,
      current_price: 6.05,
      lastday_price: 3.88,
      cost_basis: 960,
      market_value: 605,
      unrealized_pl: -355,
      unrealized_pl_pct: -36.98,
      intraday_pl: -355,
      intraday_pl_pct: -36.98,
      change_today_pct: 55.93,
    },
    {
      asset_id: '989bf65a-f332-41a1-9c76-24490c0e8c12',
      symbol: 'SHOP261120P00175000',
      underlying: 'SHOP',
      display_label: 'SHOP $175P 11/20',
      full_label: 'SHOP 2026-11-20 $175 PUT',
      is_option: true,
      option_type: 'PUT' as const,
      strike_price: 175,
      expiration_date: '2026-11-20',
      side: 'long' as const,
      qty: 2,
      qty_available: 2,
      multiplier: 100,
      avg_entry_price: 12.65,
      current_price: 15.5,
      lastday_price: 17.55,
      cost_basis: 2530,
      market_value: 3100,
      unrealized_pl: 570,
      unrealized_pl_pct: 22.53,
      intraday_pl: -410,
      intraday_pl_pct: -11.68,
      change_today_pct: -11.68,
    },
  ];

  const built = buildInitialMonitoredHoldings(alpacaPositions, 21220.9, 'paper');
  assert.equal(built.holdings.length, 3);

  for (let i = 0; i < alpacaPositions.length; i++) {
    const pos = alpacaPositions[i];
    const h = built.holdings[i];
    assert.equal(h.symbol, pos.symbol);
    assert.equal(h.display_label, pos.display_label);
    assert.equal(h.quantity, pos.qty);
    assert.equal(h.avg_entry_price, pos.avg_entry_price);
    assert.equal(h.current_price, pos.current_price);
    assert.equal(h.cost_basis, pos.cost_basis);
    assert.equal(h.market_value, pos.market_value);
    assert.equal(h.unrealized_pl, pos.unrealized_pl);
    assert.equal(Number((h.unrealized_plpc * 100).toFixed(2)), pos.unrealized_pl_pct);
    assert.equal(h.intraday_pl, pos.intraday_pl);
    assert.equal(Number((h.intraday_plpc * 100).toFixed(2)), pos.unrealized_pl_pct === -36.98 ? -36.98 : pos.intraday_pl_pct);
  }
});

test('Backend AI Activity Coordinator & Database Settings Sync: auto-starts AI activity and prevents multi-session conflicts', async () => {
  const runtime = new WhaleScannerRuntime();

  // Update settings and verify they persist in database snapshot & telemetry
  runtime.updateSessionSettings({
    minScoreFilter: 74,
    includeEtfs: true,
    tickerQuery: 'NVDA',
  });
  runtime.updateSmartOrderConfig({
    defaultAlgo: 'uw_flow_urgency_sweep',
    maxSpreadPctGuardrail: 16.5,
  });

  const snap = runtime.exportPersistentSnapshot();
  assert.equal(snap.session_settings.minScoreFilter, 74);
  assert.equal(snap.session_settings.includeEtfs, true);
  assert.equal(snap.smart_order_config?.defaultAlgo, 'uw_flow_urgency_sweep');

  const restored = new WhaleScannerRuntime();
  restored.restorePersistentSnapshot(snap);
  const tel = restored.getTelemetryState();
  assert.equal(tel.session_settings.minScoreFilter, 74);
  assert.equal(tel.session_settings.includeEtfs, true);
  assert.equal(tel.smart_order_config.defaultAlgo, 'uw_flow_urgency_sweep');
  assert.ok(Array.isArray(tel.scanners) && tel.scanners.length >= 3);

  // Session 1 opens AI Decision Gate -> auto-starts 3 concurrent backend AI analysis instances
  assert.equal(restored.getLlmEngineConfig().concurrentAnalyses, 3);
  const firstSessionStart = restored.startOrEnsureBackendAiActivity({
    trigger_new_if_idle: true,
    min_in_flight_ms: 50,
  });
  assert.equal(firstSessionStart.started, true);
  assert.equal(firstSessionStart.already_running, false);
  assert.equal(firstSessionStart.active_processing_count, 3);

  const processingLogs = restored
    .getAiAnalysisLogs()
    .filter((l) => l.status === 'processing');
  assert.equal(processingLogs.length, 3);

  // Session 2 opens AI Decision Gate simultaneously -> attaches to running 3-worker pool without conflict
  const secondSessionStart = restored.startOrEnsureBackendAiActivity({
    trigger_new_if_idle: true,
    min_in_flight_ms: 50,
  });
  assert.equal(secondSessionStart.started, false);
  assert.equal(secondSessionStart.already_running, true);
  assert.equal(secondSessionStart.active_processing_count, 3);
});

test('Flow Discovery & AI Decision Gate Candidate Parity + Historical Session Calendar Inspection', () => {
  const runtime = new WhaleScannerRuntime();

  // 1. Default Flow Discovery query returns all 10 seeded institutional candidates (including SPY & QQQ ETFs)
  const latestCandidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 50,
    include_etfs: true,
    regime_adaptive: false,
    limit: 50,
  });
  assert.ok(
    latestCandidates.length >= 10,
    `Expected at least 10 candidates in Flow Discovery, got ${latestCandidates.length}`
  );
  const candidateTickers = new Set(latestCandidates.map((c) => c.ticker));
  for (const ticker of ['NVDA', 'NFLX', 'TSM', 'MU', 'META', 'TSLA', 'AVGO', 'COIN', 'PLTR', 'AMD']) {
    assert.ok(
      candidateTickers.has(ticker),
      `Expected ${ticker} to be present in Flow Discovery candidates`
    );
  }

  // 2. Verify available trading sessions include Latest (today) and historical dates
  const sessions = runtime.getAvailableHistoricalSessions();
  assert.ok(sessions.length >= 5);
  assert.equal(sessions[0].is_latest, true);
  assert.ok(sessions.some((s) => s.date === '2026-10-20' && s.session_date === '2026-10-20'));
  assert.ok(sessions.some((s) => s.date === '2026-10-19' && s.session_date === '2026-10-19'));
  assert.ok(sessions.some((s) => s.date === '2026-10-16' && s.session_date === '2026-10-16'));

  // 3. Query historical session 2026-10-20 and verify date-scoped candidates, market tide, AI logs, and smart orders
  const histDate = '2026-10-20';
  const histCandidates = runtime.queryCandidates({
    session_date: histDate,
    limit: 50,
  });
  assert.ok(histCandidates.length >= 8);
  assert.ok(
    histCandidates.every((c) => c.detected_at.startsWith(histDate)),
    'Expected all historical candidates to have timestamps on 2026-10-20'
  );

  const histTel = runtime.getTelemetryState(histDate);
  assert.equal(histTel.selected_session_date, histDate);
  assert.equal(histTel.is_historical_session, true);
  assert.equal(histTel.market_tide.session_date, histDate);
  assert.equal(histTel.market_tide.latest_timestamp_str, '10/20 03:54 PM');
  assert.ok(histTel.ai_analysis_logs.length >= 4);
  assert.ok(
    histTel.ai_analysis_logs.every((l) => l.timestamp.startsWith(histDate)),
    'Expected historical AI analysis logs to be scoped to 2026-10-20'
  );
  assert.ok(histTel.smart_order_tickets.length >= 2);
  for (const ticket of histTel.smart_order_tickets) {
    assert.ok(
      ticket.created_at.startsWith(histDate),
      `Expected historical smart order created_at (${ticket.created_at}) to start with ${histDate}`
    );
    assert.ok(
      ticket.updated_at.startsWith(histDate),
      `Expected historical smart order updated_at (${ticket.updated_at}) to start with ${histDate}`
    );
    assert.ok(ticket.walk_ladder.length >= 1);
    for (const step of ticket.walk_ladder) {
      assert.ok(
        step.timestamp.startsWith(histDate),
        `Expected historical walk_ladder step timestamp (${step.timestamp}) to start with ${histDate}`
      );
    }
  }

  // 4. Verify latest session smart order execution tickets and walk ladder step timestamps
  const latestTel = runtime.getTelemetryState();
  assert.ok(latestTel.smart_order_tickets.length >= 3);
  for (const ticket of latestTel.smart_order_tickets) {
    assert.ok(
      Number.isFinite(Date.parse(ticket.created_at)),
      `Expected valid ISO created_at on smart order ${ticket.order_id}`
    );
    assert.ok(
      Number.isFinite(Date.parse(ticket.updated_at)),
      `Expected valid ISO updated_at on smart order ${ticket.order_id}`
    );
    assert.ok(
      Date.parse(ticket.updated_at) >= Date.parse(ticket.created_at),
      'Expected updated_at >= created_at on smart order ticket'
    );
    for (const step of ticket.walk_ladder) {
      assert.ok(
        Number.isFinite(Date.parse(step.timestamp)),
        `Expected valid ISO timestamp on walk_ladder step ${step.step_index}`
      );
    }
    const parsedOut = JSON.parse(ticket.output_payload_json);
    assert.ok(typeof parsedOut.submitted_at === 'string');
    assert.ok(typeof parsedOut.completed_at === 'string');
    assert.ok(Array.isArray(parsedOut.execution_ladder));
    assert.ok(typeof parsedOut.execution_ladder[0]?.timestamp === 'string');
  }
});

test('Alpaca Market Clock (/v2/clock) & Automatic Activity Halting When Market Is Closed', async () => {
  // 1. Regular Trading Hours (Wednesday Oct 21, 2026 at 11:15 AM ET = 15:15 UTC)
  const rthOpenClock = computeAlpacaMarketClockState(
    null,
    new Date('2026-10-21T15:15:00.000Z'),
    'et_schedule_clock'
  );
  assert.equal(rthOpenClock.is_open, true);
  assert.equal(rthOpenClock.status_label, 'MARKET OPEN');
  assert.equal(rthOpenClock.session_phase, 'regular_open');
  assert.equal(rthOpenClock.activity_halted, false);
  assert.equal(rthOpenClock.halt_reason, null);

  // 2. After-Hours (Wednesday Oct 21, 2026 at 05:30 PM ET = 21:30 UTC)
  const afterHoursClock = computeAlpacaMarketClockState(
    null,
    new Date('2026-10-21T21:30:00.000Z'),
    'et_schedule_clock'
  );
  assert.equal(afterHoursClock.is_open, false);
  assert.equal(afterHoursClock.status_label, 'MARKET CLOSED');
  assert.equal(afterHoursClock.session_phase, 'after_hours');
  assert.equal(afterHoursClock.activity_halted, true);
  assert.ok(afterHoursClock.halt_reason?.includes('stopped'));

  // 3. Pre-Market (Wednesday Oct 21, 2026 at 08:15 AM ET = 12:15 UTC)
  const preMarketClock = computeAlpacaMarketClockState(
    null,
    new Date('2026-10-21T12:15:00.000Z'),
    'et_schedule_clock'
  );
  assert.equal(preMarketClock.is_open, false);
  assert.equal(preMarketClock.status_label, 'MARKET CLOSED');
  assert.equal(preMarketClock.session_phase, 'pre_market');
  assert.equal(preMarketClock.activity_halted, true);

  // 4. Live Alpaca /v2/clock payload normalization
  const rawAlpacaClock = computeAlpacaMarketClockState(
    {
      timestamp: '2026-10-21T20:20:00.000Z',
      is_open: false,
      next_open: '2026-10-22T13:30:00.000Z',
      next_close: '2026-10-22T20:00:00.000Z',
    },
    new Date('2026-10-21T20:20:00.000Z'),
    'alpaca_clock_api'
  );
  assert.equal(rawAlpacaClock.is_open, false);
  assert.equal(rawAlpacaClock.source, 'alpaca_clock_api');
  assert.equal(rawAlpacaClock.activity_halted, true);

  // 5. Runtime enforces activity halt when market is closed
  const runtime = new WhaleScannerRuntime();
  // Create a working_walking smart order ticket first
  const walkingTicket = runtime.executeSmartOrderForCandidate({
    ticker: 'NVDA',
    qty: 5,
    simulate_mode: 'working_walk',
  });
  assert.ok(
    walkingTicket.status === 'working_walking' ||
      walkingTicket.status === 'partially_filled'
  );

  // Enforce market-closed state on runtime
  runtime.setMarketClockState(afterHoursClock, true);
  assert.equal(runtime.isMarketClosedAndHalted(), true);
  assert.equal(runtime.getTelemetryState().market_clock.is_open, false);
  assert.equal(runtime.getTelemetryState().market_clock.activity_halted, true);

  // Working smart order ticket must be paused on market close
  const pausedTicket = runtime
    .getSmartOrderTickets()
    .find((t) => t.order_id === walkingTicket.order_id);
  assert.equal(pausedTicket?.status, 'spread_guard_paused');

  // AI Analysis queue must report 0 processing and 0 pending items when market is closed
  const closedAiLogs = runtime.getAiAnalysisLogs();
  assert.equal(
    closedAiLogs.filter((l) => l.status === 'processing').length,
    0,
    'Expected 0 processing AI entries after market close'
  );
  assert.equal(
    closedAiLogs.filter((l) => l.status === 'pending').length,
    0,
    'Expected 0 pending AI entries after market close'
  );

  // Background AI auto-start, pending queue worker, automated pipeline cycle, and lifecycle recalculation must all halt
  const autoStartRes = runtime.startOrEnsureBackendAiActivity();
  assert.equal(autoStartRes.started, false);
  assert.equal(autoStartRes.active_processing_count, 0);
  assert.equal(autoStartRes.pending_count, 0);

  const pendingRes = await runtime.processPendingAiAnalyses();
  assert.equal(pendingRes.processed_count, 0);

  const prevCycles = runtime.getTelemetryState().recalculation_cycles;
  const recalcRes = runtime.runMinuteLifecycleRecalculation();
  assert.equal(recalcRes.halted_market_closed, true);
  assert.equal(recalcRes.recalculation_cycles, prevCycles);

  const autoCycleRes = await runtime.runAutomatedPipelineCycle();
  assert.equal(autoCycleRes.evaluated_records.length, 0);
  assert.equal(autoCycleRes.placed_orders.length, 0);
});

test('Alpaca Account Overview Resilience, Cached Snapshot & Telemetry Integration', () => {
  const svc = new AlpacaAccountService();
  const cached = svc.getCachedAccountOverview();
  assert.ok(cached);
  assert.equal(cached.account.account_number, 'PA3OUZMI3MFU');
  assert.equal(cached.account.status, 'ACTIVE');
  assert.ok(cached.positions.length >= 3);
  assert.ok(cached.portfolio_history['1M']);

  const runtime = new WhaleScannerRuntime();
  const telemetry = runtime.getTelemetryState();
  assert.ok(telemetry.alpaca_account_overview);
  assert.equal(
    telemetry.alpaca_account_overview.account.account_number,
    'PA3OUZMI3MFU'
  );

  const snapshot = runtime.exportPersistentSnapshot();
  assert.ok(snapshot.alpaca_account_overview);
  assert.equal(
    snapshot.alpaca_account_overview?.account.account_number,
    'PA3OUZMI3MFU'
  );
});

test('Candidate Option Price & Associated Events Detail Chart Model + Decision Outcome Validation', () => {
  const runtime = new WhaleScannerRuntime();
  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 25,
  });
  const tel = runtime.getTelemetryState();

  const nvda = candidates.find((c) => c.ticker === 'NVDA') ?? candidates[0];
  assert.ok(nvda, 'Expected NVDA candidate');

  const model = buildCandidateOptionEventChartModel({
    candidate: nvda,
    marketTide: tel.market_tide,
    aiLogs: tel.ai_analysis_logs,
    llmDecisionRecords: tel.llm_decision_records,
    smartOrderTickets: tel.smart_order_tickets,
  });

  assert.equal(model.candidate_id, nvda.candidate_id);
  assert.equal(model.ticker, nvda.ticker);
  assert.ok(model.price_series.length >= 25, 'Expected rich intraday option price series');
  assert.ok(model.events.length >= 6, 'Expected at least 6 associated lifecycle events');

  // Verify required event categories are present on the timeline
  const categories = new Set(model.events.map((e) => e.category));
  assert.ok(categories.has('whale_print'), 'Expected whale_print events');
  assert.ok(categories.has('confirmation'), 'Expected 5m confirmation event');
  assert.ok(categories.has('ai_decision'), 'Expected Stage-1/2 AI decision events');
  assert.ok(categories.has('outcome_milestone'), 'Expected post-decision outcome events');

  // Verify every event timestamp is anchored in price_series with matching option price
  for (const evt of model.events) {
    const matchedPt = model.price_series.find(
      (pt) => pt.timestamp_ms === evt.timestamp_ms
    );
    assert.ok(
      matchedPt,
      `Expected price_series to include exact anchor point for event ${evt.event_id}`
    );
    assert.ok(
      matchedPt.events_at_point.some((e) => e.event_id === evt.event_id),
      `Expected point at ${evt.time_label} to reference event ${evt.event_id}`
    );
  }

  // Verify Decision Outcome Evaluation ("if the decision is correctly made")
  assert.equal(model.outcome_evaluation.decision, 'EXECUTE');
  assert.equal(model.outcome_evaluation.is_decision_correct, true);
  assert.equal(model.outcome_evaluation.verdict_status, 'CORRECT_PROFITABLE');
  assert.ok(model.outcome_evaluation.return_since_decision_pct > 0);
  assert.ok(model.outcome_evaluation.post_decision_high_price >= model.outcome_evaluation.latest_option_price);
  assert.ok(model.outcome_evaluation.key_evidence_bullets.length >= 4);

  // Also test all candidates (including NFLX, AMD, PLTR, etc.) to verify universal coverage & zero NaN values
  for (const cand of candidates) {
    const cm = buildCandidateOptionEventChartModel({
      candidate: cand,
      marketTide: tel.market_tide,
      aiLogs: tel.ai_analysis_logs,
      llmDecisionRecords: tel.llm_decision_records,
      smartOrderTickets: tel.smart_order_tickets,
    });
    assert.ok(cm.price_series.length >= 20);
    assert.ok(cm.events.length >= 5);
    assert.ok(cm.outcome_evaluation.verdict_badge.length > 5);
    assert.ok(
      Number.isFinite(cm.outcome_evaluation.conviction_score),
      `Expected finite conviction_score for ${cand.ticker}`
    );
    for (const evt of cm.events) {
      assert.ok(
        Number.isFinite(evt.option_price) && evt.option_price > 0,
        `Expected finite positive option_price on event ${evt.event_id}`
      );
      assert.ok(
        Number.isFinite(evt.nbbo_bid) && evt.nbbo_bid > 0,
        `Expected finite positive nbbo_bid on event ${evt.event_id}`
      );
      assert.ok(
        Number.isFinite(evt.nbbo_ask) && evt.nbbo_ask >= evt.nbbo_bid,
        `Expected finite nbbo_ask >= nbbo_bid on event ${evt.event_id}`
      );
    }
  }
});

test('Smart Execution Filled Tickets Synchronize into Alpaca Account Overview (Positions, Closed Trades, Ticker Performance & Recent Orders)', () => {
  const runtime = new WhaleScannerRuntime();

  // Execute filled Smart Execution orders across multiple tickers (e.g. NFLX, AMD, META)
  const nflxTicket = runtime.executeSmartOrderForCandidate({
    ticker: 'NFLX',
    qty: 8,
    simulate_mode: 'immediate_fill',
  });
  const amdTicket = runtime.executeSmartOrderForCandidate({
    ticker: 'AMD',
    qty: 12,
    simulate_mode: 'immediate_fill',
  });
  assert.equal(nflxTicket.status, 'filled');
  assert.equal(amdTicket.status, 'filled');

  const allTickets = runtime.getSmartOrderTickets();
  const filledTickets = allTickets.filter(
    (t) => t.status === 'filled' && t.filled_qty > 0
  );
  assert.ok(filledTickets.length >= 4);

  const overview = runtime.getTelemetryState().alpaca_account_overview;
  assert.ok(overview, 'Expected alpaca_account_overview in telemetry');

  for (const ticket of filledTickets) {
    const ticker = ticket.ticker.toUpperCase();
    // 1. Every filled Smart Execution ticket appears in Recent Alpaca Orders
    assert.ok(
      overview.recent_orders.some(
        (o) =>
          o.id === ticket.order_id ||
          o.symbol === ticket.option_symbol ||
          o.short_label.toUpperCase().startsWith(ticker)
      ),
      `Expected filled Smart Execution ticket ${ticket.order_id} (${ticker}) in recent_orders`
    );

    // 2. Every filled Smart Execution ticket is reflected in Open Positions
    assert.ok(
      overview.positions.some((p) => p.underlying.toUpperCase() === ticker),
      `Expected filled Smart Execution ticker ${ticker} in Alpaca open positions`
    );

    // 3. Every filled Smart Execution ticket is reflected in Closed Round-Trip Trades & Per-Trade P/L Bar Chart
    assert.ok(
      overview.closed_trades.some((ct) => ct.underlying.toUpperCase() === ticker),
      `Expected filled Smart Execution ticker ${ticker} in Alpaca closed_trades`
    );

    // 4. Every filled Smart Execution ticket is reflected in P/L Breakdown by Underlying Ticker
    assert.ok(
      overview.ticker_performance.some(
        (tp) => tp.underlying.toUpperCase() === ticker
      ),
      `Expected filled Smart Execution ticker ${ticker} in Alpaca ticker_performance`
    );
  }
});

test('Short-Pressure Regime, Dark-Pool Price Zones, Confirmation Matrix & short_darkpool_score Rule Engine', async () => {
  // 1. Test computeShortDarkPoolScore matching exact specification rule scoring
  // Long holding + holding_above_primary_zone (+2) + squeeze_risk (+2) = +4
  const longSqueezeHoldScore = computeShortDarkPoolScore({
    position_side: 'long',
    dark_pool: { price_behavior: 'holding_above_primary_zone' },
    short: {
      shares_available_change_5d: -0.62,
      borrow_fee_change_5d: 0.08,
      days_to_cover: 4.1,
      short_interest_pct_float: 0.18,
      short_volume_ratio_latest: 0.54,
    },
  });
  assert.equal(longSqueezeHoldScore.score, 4);
  assert.ok(longSqueezeHoldScore.flags.includes('dark_pool_zone_hold'));
  assert.ok(longSqueezeHoldScore.flags.includes('short_squeeze_risk'));
  assert.equal(
    longSqueezeHoldScore.review_urgency_modifier,
    'REDUCE_FALSE_EXIT_URGENCY'
  );

  // Short holding + holding_above_primary_zone (-2) + squeeze_risk (-3) = -5
  const shortSqueezeRiskScore = computeShortDarkPoolScore({
    position_side: 'short',
    dark_pool: { price_behavior: 'holding_above_primary_zone' },
    short: {
      shares_available_change_5d: -0.62,
      borrow_fee_change_5d: 0.08,
      days_to_cover: 4.1,
    },
  });
  assert.equal(shortSqueezeRiskScore.score, -5);
  assert.ok(shortSqueezeRiskScore.flags.includes('dark_pool_zone_hold'));
  assert.ok(shortSqueezeRiskScore.flags.includes('short_squeeze_risk'));
  assert.equal(
    shortSqueezeRiskScore.review_urgency_modifier,
    'ESCALATE_REVIEW_URGENCY'
  );

  // Long holding + rejected_below_primary_zone (-2) + no squeeze_risk (0) = -2
  const longRejectScore = computeShortDarkPoolScore({
    position_side: 'long',
    dark_pool: { price_behavior: 'rejected_below_primary_zone' },
    short: {
      shares_available_change_5d: 0.25,
      borrow_fee_change_5d: -0.01,
      days_to_cover: 1.5,
    },
  });
  assert.equal(longRejectScore.score, -2);
  assert.ok(longRejectScore.flags.includes('dark_pool_zone_rejection'));

  // 2. Test buildShortAndDarkPoolTelemetryForHolding & LLM Feature Payload structure
  const aaplBundle = buildShortAndDarkPoolTelemetryForHolding({
    ticker: 'AAPL',
    spot_price: 199.8,
    vwap: 199.1,
    effective_position_side: 'long',
    scenario_override: 'long_squeeze_hold_guard',
  });
  assert.equal(aaplBundle.llm_feature_payload.short_context.short_interest_pct_float, 0.18);
  assert.equal(aaplBundle.llm_feature_payload.short_context.days_to_cover, 4.1);
  assert.equal(aaplBundle.llm_feature_payload.short_context.borrow_fee_rate, 0.27);
  assert.equal(aaplBundle.llm_feature_payload.short_context.borrow_fee_change_5d, 0.08);
  assert.equal(aaplBundle.llm_feature_payload.short_context.short_shares_available, 150000);
  assert.equal(aaplBundle.llm_feature_payload.short_context.shares_available_change_5d, -0.62);
  assert.equal(aaplBundle.llm_feature_payload.dark_pool_context.cancelled_prints_excluded, true);
  assert.equal(
    aaplBundle.llm_feature_payload.dark_pool_context.last_price_relation,
    'above_primary_zone'
  );
  assert.equal(
    aaplBundle.llm_feature_payload.interpretation_constraints.length,
    4
  );
  assert.ok(
    aaplBundle.dark_pool_telemetry.recent_prints.some(
      (p) => p.canceled && p.excluded_from_scoring
    ),
    'Expected cancelled dark-pool prints to be explicitly marked and excluded from scoring'
  );

  // 3. Test Anti-Premature-Exit Guardrail on Long Holding (Bearish tape alone does NOT force exit when price holds above DP zone + borrow tightening)
  const prematureExitGuardEval = evaluateHoldingConfirmationMatrix({
    effective_position_side: 'long',
    raw_holding_side: 'long',
    spot_price: 199.8,
    intraday_vwap: 199.1,
    realized_move_pct: 0.008,
    relative_volume: 1.45,
    cumulative_net_call_premium: 650_000,
    cumulative_net_put_premium: 1_850_000, // Bearish tape (Category B agrees)
    contract_net_premium: -280_000,
    repeated_bearish_flow: true,
    repeated_bullish_flow: false,
    short_telemetry: aaplBundle.short_telemetry,
    dark_pool_telemetry: aaplBundle.dark_pool_telemetry,
  });
  assert.equal(prematureExitGuardEval.avoid_premature_long_exit_active, true);
  assert.equal(prematureExitGuardEval.stronger_exit_review_triggered, false);
  assert.equal(
    prematureExitGuardEval.matrix_verdict_label,
    'PREMATURE_EXIT_GUARD_ACTIVE'
  );

  // 4. Test Short-Position Squeeze-Risk Cluster Escalation (5/5 signals)
  const squeezeBundle = buildShortAndDarkPoolTelemetryForHolding({
    ticker: 'TSLA',
    spot_price: 252.4,
    vwap: 248.1,
    effective_position_side: 'short',
    scenario_override: 'short_squeeze_cluster',
  });
  const shortSqueezeMatrix = evaluateHoldingConfirmationMatrix({
    effective_position_side: 'short',
    raw_holding_side: 'long', // e.g., Long Put (-1 bearish exposure)
    spot_price: 252.4,
    intraday_vwap: 248.1,
    realized_move_pct: 0.024,
    relative_volume: 2.15,
    cumulative_net_call_premium: 3_680_000,
    cumulative_net_put_premium: 540_000,
    contract_net_premium: 640_000,
    repeated_bearish_flow: false,
    repeated_bullish_flow: true,
    short_telemetry: squeezeBundle.short_telemetry,
    dark_pool_telemetry: squeezeBundle.dark_pool_telemetry,
  });
  assert.equal(shortSqueezeMatrix.short_squeeze_cluster.active, true);
  assert.equal(shortSqueezeMatrix.short_squeeze_cluster.signals_active_count, 5);
  assert.equal(shortSqueezeMatrix.stronger_exit_review_triggered, true);
  assert.equal(shortSqueezeMatrix.recommended_urgency_override, 'IMMEDIATE');

  // 5. Test Runtime Scenario Evaluation & Stage-1 Prompt Integration
  const runtime = new WhaleScannerRuntime();
  const holdingsState = runtime.getHoldingsMonitorState();
  assert.ok(holdingsState.holdings.length >= 4);
  for (const h of holdingsState.holdings) {
    assert.ok(h.short_telemetry, `Expected short_telemetry on ${h.symbol}`);
    assert.ok(h.dark_pool_telemetry, `Expected dark_pool_telemetry on ${h.symbol}`);
    assert.ok(h.confirmation_matrix, `Expected confirmation_matrix on ${h.symbol}`);
    assert.ok(
      h.llm_short_darkpool_payload,
      `Expected llm_short_darkpool_payload on ${h.symbol}`
    );
    assert.ok(
      h.latest_stage1_decision?.system_prompt.includes(
        SUGGESTED_SHORT_DARKPOOL_LLM_RULE
      ),
      'Expected Stage-1 system prompt to include the Suggested Short & Dark-Pool LLM Rule'
    );
  }

  // Simulate long_squeeze_hold_guard on a Call Option holding -> verifies Premature-Exit Guard holds the position
  const msftHold =
    holdingsState.holdings.find((h) => h.underlying_symbol === 'MSFT') ??
    holdingsState.holdings[0];
  const guardSim = await runtime.evaluateHoldingWithLlm({
    holding_id: msftHold.holding_id,
    simulate_scenario: 'long_squeeze_hold_guard',
  });
  assert.ok(guardSim);
  assert.equal(
    guardSim.holding.confirmation_matrix.avoid_premature_long_exit_active,
    true
  );
  assert.equal(guardSim.stage1_decision.decision, 'HOLD');

  // Simulate short_squeeze_cluster -> verifies immediate escalation to EXIT or REDUCE
  const squeezeSim = await runtime.evaluateHoldingWithLlm({
    holding_id: msftHold.holding_id,
    simulate_scenario: 'short_squeeze_cluster',
  });
  assert.ok(squeezeSim);
  assert.equal(
    squeezeSim.holding.confirmation_matrix.short_squeeze_cluster.active,
    true
  );
  assert.ok(
    squeezeSim.stage1_decision.decision === 'EXIT' ||
      squeezeSim.stage1_decision.decision === 'REDUCE'
  );
  assert.equal(squeezeSim.stage1_decision.urgency, 'IMMEDIATE');
});

test('Flow Discovery Candidate Timestamp Formatter (ET Time, Date, Relative Age & Multi-Print Span)', () => {
  const runtime = new WhaleScannerRuntime();
  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 50,
    include_etfs: true,
    regime_adaptive: false,
  });
  assert.ok(candidates.length > 0);

  const nvda = candidates.find((c) => c.ticker === 'NVDA') ?? candidates[0];
  const refNowMs = nvda.last_updated_ms + 120_000; // 2 minutes after latest print
  const summary = formatCandidateTimestampSummary(nvda, refNowMs);

  assert.match(summary.detected_time_et, /^\d{2}:\d{2}:\d{2} ET$/);
  assert.match(summary.latest_time_et, /^\d{2}:\d{2}:\d{2} ET$/);
  assert.match(summary.date_et, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(summary.relative_age_label, '2m ago');
  assert.equal(summary.is_multi_print_span, true);
  assert.match(summary.window_span_label, /\+\d+s \(\d+ prints\)/);
});

test('Candidate Event Chart Gamma Exposure (GEX) Call/Put Wall Magnet Overlay, 5-Stage Decision Blueprint & 2D Callout Collision Solver', () => {
  const runtime = new WhaleScannerRuntime();
  const tel = runtime.getTelemetryState();
  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 25,
  });

  for (const cand of candidates) {
    const cm = buildCandidateOptionEventChartModel({
      candidate: cand,
      marketTide: tel.market_tide,
      aiLogs: tel.ai_analysis_logs,
      llmDecisionRecords: tel.llm_decision_records,
      smartOrderTickets: tel.smart_order_tickets,
    });

    const gex = cm.gamma_exposure_layer;
    assert.ok(gex, `Expected gamma_exposure_layer for ${cand.ticker}`);
    assert.ok(gex.call_wall > gex.put_wall, `Expected call_wall > put_wall for ${cand.ticker}`);
    assert.ok(Number.isFinite(gex.gamma_flip) && gex.gamma_flip > 0);
    assert.ok(Number.isFinite(gex.gamma_magnet) && gex.gamma_magnet > 0);
    assert.ok(gex.magnet_band_high > gex.magnet_band_low);
    assert.ok(gex.strike_gex_bars.length >= 6, 'Expected at least 6 strike GEX bars');
    assert.equal(gex.decision_blueprint.length, 5, 'Expected 5-stage causal decision blueprint');
    assert.ok(gex.wall_interaction_badge.length > 4);
    assert.ok(gex.dealer_hedging_behavior.length > 20);

    // Verify callout badge formatter never truncates SKIP to SKI
    for (const evt of cm.events) {
      const badge = formatEventCalloutBadgeText(evt);
      assert.ok(!badge.endsWith('SKI'), `Badge must not truncate SKIP to SKI: ${badge}`);
      assert.ok(badge.length <= 22, `Badge should be concise (<=22 chars): ${badge}`);
    }

    // Verify 2D Callout Collision Solver produces non-overlapping bounding boxes
    const idxMap = new Map(cm.events.map((e, idx) => [e.event_id, idx]));
    const laidOut = resolveEventCalloutPositions({
      events: cm.events,
      getAnchorX: (evt) => 120 + (idxMap.get(evt.event_id) ?? 0) * 18,
      getAnchorY: (evt) =>
        210 + ((idxMap.get(evt.event_id) ?? 0) % 2 === 0 ? -8 : 8),
      minX: 74,
      maxX: 966,
      minY: 28,
      maxY: 382,
    });

    assert.equal(laidOut.length, cm.events.length);
    for (let i = 0; i < laidOut.length; i++) {
      for (let j = i + 1; j < laidOut.length; j++) {
        const a = laidOut[i];
        const b = laidOut[j];
        const overlapX = Math.abs(a.box_cx - b.box_cx) < (a.box_width + b.box_width) / 2;
        const overlapY = Math.abs(a.box_cy - b.box_cy) < (a.box_height + b.box_height) / 2;
        assert.equal(
          overlapX && overlapY,
          false,
          `Callout #${a.sequence_index} and #${b.sequence_index} must not overlap on ${cand.ticker}`
        );
      }
    }

    // Verify Interactive Chart Zoom Presets, Factor Zoom, Pan, and Auto-Fit Y-Axis
    const totalPts = cm.price_series.length;
    assert.ok(totalPts >= 12, `Expected at least 12 series points for ${cand.ticker}`);

    const burstPreset = getChartZoomPresetRange('burst_gate', cm.price_series, cm.events);
    assert.equal(burstPreset.preset, 'burst_gate');
    assert.ok(burstPreset.startFrac >= 0);
    assert.ok(burstPreset.endFrac <= 1);
    assert.ok(
      burstPreset.endFrac - burstPreset.startFrac < 1,
      'Burst & Gate preset should zoom into a subset of points'
    );

    const zoomedWindow = computeChartZoomWindow({
      series: cm.price_series,
      events: cm.events,
      range: burstPreset,
      autoScaleY: true,
      showTargetStopLines: true,
      showGexOverlay: true,
      referenceLevels: cm.reference_levels,
      gexLayer: cm.gamma_exposure_layer,
    });
    assert.ok(
      zoomedWindow.zoomFactor > 1.1,
      `Expected zoomFactor > 1.1, got ${zoomedWindow.zoomFactor}`
    );
    assert.equal(
      zoomedWindow.visibleSeries.length,
      zoomedWindow.endIdx - zoomedWindow.startIdx + 1
    );
    assert.ok(
      zoomedWindow.visibleEvents.length >= 1,
      'Burst & Gate zoom window must contain at least 1 event'
    );
    assert.ok(zoomedWindow.minOptPrice > 0);
    assert.ok(zoomedWindow.maxOptPrice > zoomedWindow.minOptPrice);

    // Zoom in further around center and pan right
    const tighterRange = zoomRangeByFactor(burstPreset, 1.5);
    assert.ok(
      tighterRange.endFrac - tighterRange.startFrac <=
        burstPreset.endFrac - burstPreset.startFrac,
      'Zooming in by factor 1.5 should narrow or preserve minimum span'
    );

    const pannedRange = panChartZoomRange(tighterRange, 0.08);
    assert.ok(
      Math.abs(
        pannedRange.endFrac -
          pannedRange.startFrac -
          (tighterRange.endFrac - tighterRange.startFrac)
      ) < 0.002,
      'Panning must preserve window span'
    );
  }
});

test('Cross-View Option Price & Return Alignment: Flow Discovery, Smart Order, Candidate Chart, and Alpaca Account match 100%', () => {
  const runtime = new WhaleScannerRuntime();
  // Ingest live discovery sweeps for AMZN, GOOGL, MSFT, ARM, PANW
  for (let i = 0; i < 5; i++) {
    runtime.ingestLiveMarketAndWhaleStream({ injectDiscoverySweep: true });
  }
  // Execute filled Smart Orders on MSFT and PANW so we can test them alongside NVDA/TSLA
  runtime.executeSmartOrderForCandidate({
    ticker: 'MSFT',
    qty: 6,
    simulate_mode: 'immediate_fill',
  });
  runtime.executeSmartOrderForCandidate({
    ticker: 'PANW',
    qty: 6,
    simulate_mode: 'immediate_fill',
  });

  const candidates = runtime.queryCandidates({
    mode: 'directional_momentum',
    min_score: 0,
    include_etfs: true,
    regime_adaptive: false,
    limit: 50,
  });
  const tel = runtime.getTelemetryState();
  const mergedOverview = tel.alpaca_account_overview!;
  assert.ok(mergedOverview, 'Expected alpaca_account_overview in telemetry');

  const msftCand = candidates.find((c) => c.ticker === 'MSFT');
  const panwCand = candidates.find((c) => c.ticker === 'PANW');
  assert.ok(msftCand, 'Expected MSFT candidate');
  assert.ok(panwCand, 'Expected PANW candidate');

  const msftVwap = msftCand.aggregation?.vwap_fill_price ?? 0;
  const panwVwap = panwCand.aggregation?.vwap_fill_price ?? 0;
  const msftSnap = sharedAlpacaStockService.getCachedOptionSnapshot(
    msftCand.option_symbol
  );
  const panwSnap = sharedAlpacaStockService.getCachedOptionSnapshot(
    panwCand.option_symbol
  );
  assert.ok(msftSnap, 'Expected Alpaca Option Snapshot for MSFT');
  assert.ok(panwSnap, 'Expected Alpaca Option Snapshot for PANW');
  assert.equal(
    msftVwap,
    msftSnap.latest_trade_price,
    `Expected actual Alpaca API MSFT option price ($${msftSnap.latest_trade_price.toFixed(2)}), got ${msftVwap}`
  );
  assert.equal(
    panwVwap,
    panwSnap.latest_trade_price,
    `Expected actual Alpaca API PANW option price ($${panwSnap.latest_trade_price.toFixed(2)}), got ${panwVwap}`
  );
  assert.notEqual(
    msftVwap,
    panwVwap,
    'MSFT and PANW option VWAP prices must be distinct'
  );

  // Verify every filled buy_to_open Smart Order Ticket matches both the Candidate Chart and Alpaca Account Overview
  const filledOpenTickets = tel.smart_order_tickets.filter(
    (t) =>
      t.side === 'buy_to_open' &&
      (t.status === 'filled' || t.status === 'partially_filled') &&
      t.avg_fill_price !== null
  );
  assert.ok(filledOpenTickets.length >= 3, 'Expected at least 3 filled buy_to_open smart order tickets');

  const seenEntryPrices = new Set<number>();
  for (const ticket of filledOpenTickets) {
    seenEntryPrices.add(ticket.avg_fill_price!);
    const cand = candidates.find(
      (c) =>
        c.option_symbol === ticket.option_symbol ||
        c.candidate_id === ticket.candidate_id
    );
    if (!cand) continue;

    const chartModel = buildCandidateOptionEventChartModel({
      candidate: cand,
      smartOrderTickets: tel.smart_order_tickets,
      llmDecisionRecords: tel.llm_decision_records,
      aiLogs: tel.ai_analysis_logs,
      marketTide: tel.market_tide,
    });

    // 1. Chart Smart Fill Price must equal Ticket Avg Fill Price
    assert.equal(
      chartModel.reference_levels.smart_fill_price,
      ticket.avg_fill_price,
      `Chart smart_fill_price for ${cand.ticker} (${chartModel.reference_levels.smart_fill_price}) must match ticket avg_fill_price (${ticket.avg_fill_price})`
    );

    // 2. Alpaca Closed Round-Trip Trade & Open Position must match Ticket Avg Fill Price and Chart Latest Option Mark
    const closedTrade = mergedOverview.closed_trades.find(
      (tr) => tr.symbol === ticket.option_symbol && tr.trade_id.startsWith('smo-ledger-')
    );
    assert.ok(closedTrade, `Expected closed round-trip trade for ${ticket.option_symbol}`);
    assert.equal(
      closedTrade.entry_price,
      ticket.avg_fill_price,
      `Alpaca closed trade entry_price (${closedTrade.entry_price}) must equal smart order fill (${ticket.avg_fill_price}) for ${cand.ticker}`
    );
    if (
      chartModel.outcome_evaluation.decision === 'EXECUTE' &&
      cand.whale_score >= 70
    ) {
      assert.equal(
        closedTrade.exit_price,
        chartModel.outcome_evaluation.latest_option_price,
        `Alpaca closed trade exit_price (${closedTrade.exit_price}) must equal chart latest_option_price (${chartModel.outcome_evaluation.latest_option_price}) for ${cand.ticker}`
      );
      assert.equal(
        closedTrade.realized_pl_pct,
        chartModel.outcome_evaluation.return_since_fill_pct,
        `Alpaca closed trade return % (${closedTrade.realized_pl_pct}) must equal chart return_since_fill_pct (${chartModel.outcome_evaluation.return_since_fill_pct}) for ${cand.ticker}`
      );
    }
  }

  assert.ok(
    seenEntryPrices.size >= 3,
    `Expected distinct entry prices across filled tickets, got ${Array.from(seenEntryPrices).join(', ')}`
  );
});

test('Self-Learning Bake-Testing & Post-Trade Retrospective Attribution Engine collects all pipeline activities, grades decisions, diagnoses root causes, and injects learned rules into future AI decisions', async () => {
  const runtime = new WhaleScannerRuntime();
  runtime.updateLlmEngineConfig({ enabled: false });

  // 1. Collect all pipeline activities (Flow Discovery -> Stage-1 AI -> Stage-2 Risk -> Smart Order / Dropped / Pre-Gate Rejected)
  const initialState = runtime.getSelfLearningBacktestState();
  assert.ok(
    initialState.activities.length >= 6,
    `Expected >= 6 pipeline activities collected across executed and dropped flows, got ${initialState.activities.length}`
  );
  assert.ok(
    initialState.learned_rules.length >= 4,
    `Expected >= 4 seeded self-learning condition rules, got ${initialState.learned_rules.length}`
  );

  // Verify both executed and dropped/rejected activities are represented
  const executedActs = initialState.activities.filter(
    (a) =>
      a.execution_or_drop_stage.disposition ===
        'ORDER_FILLED_ACTIVE_OR_CLOSED' ||
      a.execution_or_drop_stage.disposition ===
        'ORDER_WORKING_OR_STAGED'
  );
  const droppedActs = initialState.activities.filter(
    (a) =>
      a.execution_or_drop_stage.disposition ===
        'DROPPED_BY_AI_GATE_SKIP' ||
      a.execution_or_drop_stage.disposition === 'WATCHLIST_QUEUED' ||
      a.execution_or_drop_stage.disposition ===
        'REJECTED_BY_PRE_GATE_FILTER'
  );
  assert.ok(executedActs.length >= 3, 'Expected >= 3 executed order activities');
  assert.ok(droppedActs.length >= 2, 'Expected >= 2 dropped/skipped/rejected activities');

  // 2. Query deeper post-decision multi-API telemetry (Alpaca + Unusual Whales) on an activity
  const targetAct = initialState.activities[0];
  const deepRes = await runtime.queryDeepBacktestTelemetryForActivity(
    targetAct.activity_id
  );
  assert.ok(deepRes.activity, 'Deep telemetry query must return updated activity');
  assert.equal(
    deepRes.activity!.post_trade_inspection.horizon_curve.length,
    6,
    'Deep inspection must include T+0, T+5m, T+15m, T+60m, MFE Peak, and MAE Trough horizons'
  );
  assert.ok(
    deepRes.activity!.post_trade_inspection.alpaca_endpoints_queried.length >= 3,
    'Must record Alpaca API endpoints queried'
  );
  assert.ok(
    deepRes.activity!.post_trade_inspection.uw_endpoints_queried.length >= 3,
    'Must record Unusual Whales API endpoints queried'
  );

  // 3. Run LLM root-cause & win/loss attribution and verify rule synthesis
  const llmRes = await runtime.analyzeBacktestActivityWithLlm({
    activity_id: targetAct.activity_id,
    extract_learned_rule: true,
  });
  assert.ok(llmRes.activity, 'LLM analysis must update the activity');
  assert.ok(
    ['A+', 'A', 'B', 'C', 'D', 'F'].includes(
      llmRes.activity!.grade_report.grade
    ),
    'Decision grade must be A+, A, B, C, D, or F'
  );
  assert.ok(
    llmRes.activity!.grade_report.root_cause_explanation.length > 20,
    'Must include detailed LLM root-cause diagnosis'
  );

  // 4. Verify closed-loop injection into future AI Decision Gate evaluations when conditions match
  const reEvalRec = await runtime.evaluateLlmTradeDecisionForCandidate({
    candidate_id: 'cand-nvda-150c',
    execution_mode: 'deterministic_synthesis',
  });
  assert.ok(reEvalRec, 'Candidate re-evaluation must return a decision record');
  assert.ok(
    reEvalRec!.evidence_packet.self_learning_context,
    'Evidence packet must contain self_learning_context'
  );
  assert.ok(
    reEvalRec!.evidence_packet.self_learning_context!.matched_rules_count >= 1,
    'NVDA candidate must match at least 1 active self-learning condition rule'
  );
  assert.ok(
    reEvalRec!.prompt_payload.user_prompt.includes(
      'SELF_LEARNING_MEMORY_INJECTION'
    ),
    'Stage-1 AI prompt must inject SELF_LEARNING_MEMORY_INJECTION block'
  );
  assert.ok(
    Array.isArray(reEvalRec!.llm_output.self_learning_rules_applied) &&
      reEvalRec!.llm_output.self_learning_rules_applied.length >= 1,
    'LLM decision output must list applied self-learning rule IDs'
  );
  assert.notEqual(
    reEvalRec!.llm_output.self_learning_confidence_delta_pct,
    0,
    'Matched self-learning rules must apply a non-zero confidence adjustment delta'
  );
});




