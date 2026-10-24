/**
 * Stock Data & Technical Indicator Confirmation Engine (Alpaca Market Data v2)
 *
 * Implements:
 * 1. 1m (1D) and 5m (5D) OHLCV bar series processing
 * 2. Technical Indicator Series:
 *    - Session VWAP
 *    - EMA 9 / 20 / 50
 *    - ATR 14 (5-minute Wilder's ATR)
 *    - 5-minute Relative Volume (RVOL)
 *    - RSI 14 (with rising/falling slope detection)
 *    - MACD (12, 26, 9) line, signal, and histogram (with rising/falling detection)
 *    - Bollinger Bands (20, 2) upper, middle, lower, bandwidth, and breakout detection
 *    - ADX 14 (+DI 14 / -DI 14 trend strength)
 *    - Intraday Support & Resistance levels (swing low / high)
 * 3. Lit Stock Trades (`get_ticker_lit_flow`) institutional block print confirmation
 * 4. Practical 3-of-5 Confirmation Rules (Bullish & Bearish mirror logic)
 * 5. Secondary Momentum & Lit-Flow Boosts (+3 RSI, +4 MACD, +4 Lit Print, +3 BB Breakout)
 *    with strict anti-override guardrail
 * 6. 70/30 Options-Flow + Stock-Confirmation Composite Score Weighting
 */

export interface AlpacaOhlcvBar {
  t: string; // ISO timestamp
  timestamp_ms: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw: number;
  n?: number;
}

export interface LitStockTradePrint {
  trade_id: string;
  ticker: string;
  timestamp: string;
  price: number;
  size: number;
  premium: number;
  exchange: string;
  conditions: string[];
  side_inference: 'bullish' | 'bearish' | 'neutral';
}

export interface TechnicalIndicatorPoint {
  timestamp: string;
  close: number;
  vwap: number;
  ema9: number;
  ema20: number;
  ema50: number;
  atr14: number;
  rvol: number;
  rsi14: number;
  macd: number;
  macd_signal: number;
  macd_hist: number;
  bb_upper: number;
  bb_middle: number;
  bb_lower: number;
  adx14: number;
  plus_di14: number;
  minus_di14: number;
}

export interface TechnicalIndicatorSnapshot {
  as_of: string;
  data_source: 'alpaca_live_sip' | 'alpaca_live_iex' | 'deterministic_fallback';
  bars_1m_count: number;
  bars_5m_count: number;
  last_price: number;
  vwap_session: number;
  ema_9: number;
  ema_20: number;
  ema_50: number;
  atr_14: number;
  relative_volume_5m: number;
  rsi_14: number;
  rsi_prev: number;
  rsi_rising: boolean;
  macd_line: number;
  macd_signal: number;
  macd_histogram: number;
  macd_histogram_prev: number;
  macd_histogram_rising: boolean;
  bollinger_upper: number;
  bollinger_middle: number;
  bollinger_lower: number;
  bollinger_bandwidth_pct: number;
  adx_14: number;
  plus_di_14: number;
  minus_di_14: number;
  prior_5m_high: number;
  prior_5m_low: number;
  prior_5m_close: number;
  support_level: number;
  resistance_level: number;
  post_burst_move_dollars: number;
  post_burst_atr_multiple: number;
}

export interface StockConfirmationRuleItem {
  id:
    | 'vwap_alignment'
    | 'ema_alignment'
    | 'range_break'
    | 'relative_volume'
    | 'atr_follow_through';
  label: string;
  weight: number; // 0.30, 0.20, 0.20, 0.20, 0.10
  passed: boolean;
  component_score: number; // 0..1
  detail: string;
}

export interface StockSecondaryBoostItem {
  id: 'rsi_momentum' | 'macd_histogram' | 'lit_stock_print' | 'bollinger_breakout';
  label: string;
  max_points: number;
  applied_points: number;
  triggered: boolean;
  detail: string;
}

export interface StockConfirmationEvaluation {
  direction: 'bullish' | 'bearish';
  data_source: 'alpaca_live_sip' | 'alpaca_live_iex' | 'deterministic_fallback';
  rules_passed_count: number;
  rules_required_count: number; // 3 of 5
  confirmed_3_of_5: boolean;
  rules: StockConfirmationRuleItem[];
  weighted_components: {
    vwap_alignment: number;
    ema_alignment: number;
    range_break: number;
    relative_volume_confirmation: number;
    atr_follow_through: number;
  };
  /** 0..100 raw weighted stock confirmation score before secondary boosts */
  stock_confirmation_score: number;
  secondary_boosts: StockSecondaryBoostItem[];
  secondary_boost_points: number;
  guardrail_note: string;
  options_flow_score: number;
  /** 0.70 * options_flow_score + 0.30 * stock_confirmation_score + gated secondary boosts */
  final_composite_score: number;
  indicators: TechnicalIndicatorSnapshot;
  lit_flow: {
    min_premium_threshold: number;
    total_lit_prints: number;
    largest_print_premium: number;
    supporting_lit_premium: number;
    has_supporting_large_print: boolean;
    prints: LitStockTradePrint[];
  };
  recent_5m_bars: AlpacaOhlcvBar[];
  recent_1m_bars: AlpacaOhlcvBar[];
  indicator_series_tail: TechnicalIndicatorPoint[];
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

/**
 * Compute Exponential Moving Average series
 */
export function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const ema = values[i] * k + result[i - 1] * (1 - k);
    result.push(ema);
  }
  return result;
}

/**
 * Compute Wilder's ATR(14) series from OHLCV bars
 */
export function computeAtrSeries(
  bars: AlpacaOhlcvBar[],
  period = 14
): number[] {
  if (bars.length === 0) return [];
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i === 0) {
      trs.push(Math.max(0.01, b.h - b.l));
    } else {
      const prevClose = bars[i - 1].c;
      const tr = Math.max(
        b.h - b.l,
        Math.abs(b.h - prevClose),
        Math.abs(b.l - prevClose)
      );
      trs.push(Math.max(0.01, tr));
    }
  }

  const atr: number[] = [];
  let running = trs[0];
  for (let i = 0; i < trs.length; i++) {
    if (i < period) {
      const slice = trs.slice(0, i + 1);
      running = slice.reduce((a, b) => a + b, 0) / slice.length;
    } else {
      running = (running * (period - 1) + trs[i]) / period;
    }
    atr.push(running);
  }
  return atr;
}

/**
 * Compute Wilder's RSI(14) series
 */
export function computeRsiSeries(closes: number[], period = 14): number[] {
  if (closes.length === 0) return [];
  if (closes.length === 1) return [50];

  const rsis: number[] = [50];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      rsis.push(avgGain === 0 ? 50 : 100);
    } else {
      const rs = avgGain / avgLoss;
      rsis.push(100 - 100 / (1 + rs));
    }
  }
  return rsis;
}

/**
 * Compute MACD (12, 26, 9) series
 */
export function computeMacdSeries(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = computeEmaSeries(closes, fastPeriod);
  const emaSlow = computeEmaSeries(closes, slowPeriod);
  const macd = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signal = computeEmaSeries(macd, signalPeriod);
  const histogram = macd.map((m, i) => m - signal[i]);
  return { macd, signal, histogram };
}

/**
 * Compute Bollinger Bands (20, 2) series
 */
export function computeBollingerSeries(
  closes: number[],
  period = 20,
  stdDevMult = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1);
    const window = closes.slice(start, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance =
      window.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) /
      window.length;
    const std = Math.sqrt(variance);
    middle.push(mean);
    upper.push(mean + stdDevMult * std);
    lower.push(mean - stdDevMult * std);
  }
  return { upper, middle, lower };
}

/**
 * Compute ADX(14) +DI(14) and -DI(14) series
 */
export function computeAdxDiSeries(
  bars: AlpacaOhlcvBar[],
  period = 14
): { adx: number[]; plusDi: number[]; minusDi: number[] } {
  if (bars.length === 0) return { adx: [], plusDi: [], minusDi: [] };

  const adx: number[] = [20];
  const plusDi: number[] = [25];
  const minusDi: number[] = [20];

  let smoothTr = Math.max(0.01, bars[0].h - bars[0].l);
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;
  const dxList: number[] = [20];

  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];

    const upMove = cur.h - prev.h;
    const downMove = prev.l - cur.l;

    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
      0.01
    );

    smoothTr = (smoothTr * (period - 1) + tr) / period;
    smoothPlusDm = (smoothPlusDm * (period - 1) + plusDm) / period;
    smoothMinusDm = (smoothMinusDm * (period - 1) + minusDm) / period;

    const pDi = clamp((smoothPlusDm / Math.max(smoothTr, 0.0001)) * 100, 0, 100);
    const mDi = clamp(
      (smoothMinusDm / Math.max(smoothTr, 0.0001)) * 100,
      0,
      100
    );
    const diSum = Math.max(pDi + mDi, 0.0001);
    const dx = (Math.abs(pDi - mDi) / diSum) * 100;
    dxList.push(dx);

    const prevAdx = adx[i - 1];
    const curAdx = (prevAdx * (period - 1) + dx) / period;

    plusDi.push(pDi);
    minusDi.push(mDi);
    adx.push(curAdx);
  }

  return { adx, plusDi, minusDi };
}

/**
 * Compute full technical indicator series (`get_ticker_indicator_series`)
 * and latest snapshot from 5m (and optional 1m) OHLCV bars.
 */
export function computeTechnicalIndicatorsFromBars(params: {
  bars5m: AlpacaOhlcvBar[];
  bars1m?: AlpacaOhlcvBar[];
  data_source?: 'alpaca_live_sip' | 'alpaca_live_iex' | 'deterministic_fallback';
  flow_burst_reference_price?: number;
}): {
  snapshot: TechnicalIndicatorSnapshot;
  series: TechnicalIndicatorPoint[];
} {
  const bars = params.bars5m.length > 0 ? params.bars5m : [];
  const closes = bars.map((b) => b.c);

  const ema9Series = computeEmaSeries(closes, 9);
  const ema20Series = computeEmaSeries(closes, 20);
  const ema50Series = computeEmaSeries(closes, 50);
  const atr14Series = computeAtrSeries(bars, 14);
  const rsi14Series = computeRsiSeries(closes, 14);
  const macdObj = computeMacdSeries(closes, 12, 26, 9);
  const bbObj = computeBollingerSeries(closes, 20, 2);
  const adxObj = computeAdxDiSeries(bars, 14);

  // Session VWAP computation across recent session bars (last ~78 5m bars or same UTC date)
  const lastBar = bars[bars.length - 1];
  const lastDayPrefix = lastBar ? lastBar.t.slice(0, 10) : '';
  const sessionBars = bars.filter((b) => b.t.slice(0, 10) === lastDayPrefix);
  const activeSessionBars =
    sessionBars.length >= 3 ? sessionBars : bars.slice(-30);

  let cumulativePv = 0;
  let cumulativeVol = 0;
  const sessionVwapSeries: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i === 0 || b.t.slice(0, 10) !== bars[i - 1].t.slice(0, 10)) {
      cumulativePv = 0;
      cumulativeVol = 0;
    }
    const typical = b.vw > 0 ? b.vw : (b.h + b.l + b.c) / 3;
    const vol = Math.max(b.v, 1);
    cumulativePv += typical * vol;
    cumulativeVol += vol;
    sessionVwapSeries.push(cumulativePv / cumulativeVol);
  }

  // Relative volume 5m: compare each bar's volume against trailing 20-bar median/mean
  const rvolSeries: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const windowStart = Math.max(0, i - 20);
    const priorSlice = bars.slice(windowStart, i);
    if (priorSlice.length === 0) {
      rvolSeries.push(1.0);
    } else {
      const avgVol =
        priorSlice.reduce((sum, item) => sum + item.v, 0) / priorSlice.length;
      rvolSeries.push(round2(bars[i].v / Math.max(avgVol, 1)));
    }
  }

  const series: TechnicalIndicatorPoint[] = bars.map((b, i) => ({
    timestamp: b.t,
    close: round2(b.c),
    vwap: round2(sessionVwapSeries[i] ?? b.vw ?? b.c),
    ema9: round2(ema9Series[i] ?? b.c),
    ema20: round2(ema20Series[i] ?? b.c),
    ema50: round2(ema50Series[i] ?? b.c),
    atr14: round4(atr14Series[i] ?? 0.5),
    rvol: round2(rvolSeries[i] ?? 1.0),
    rsi14: round2(rsi14Series[i] ?? 50),
    macd: round4(macdObj.macd[i] ?? 0),
    macd_signal: round4(macdObj.signal[i] ?? 0),
    macd_hist: round4(macdObj.histogram[i] ?? 0),
    bb_upper: round2(bbObj.upper[i] ?? b.c),
    bb_middle: round2(bbObj.middle[i] ?? b.c),
    bb_lower: round2(bbObj.lower[i] ?? b.c),
    adx14: round2(adxObj.adx[i] ?? 20),
    plus_di14: round2(adxObj.plusDi[i] ?? 25),
    minus_di14: round2(adxObj.minusDi[i] ?? 20),
  }));

  const n = bars.length;
  const curIdx = Math.max(0, n - 1);
  const prevIdx = Math.max(0, n - 2);

  const curBar = bars[curIdx] ?? {
    t: new Date().toISOString(),
    timestamp_ms: Date.now(),
    o: 100,
    h: 101,
    l: 99,
    c: 100.5,
    v: 100000,
    vw: 100.1,
  };
  const prevBar = bars[prevIdx] ?? curBar;

  // Support & Resistance over prior 20 bars (excluding current bar so breakouts are measurable)
  const srWindow =
    bars.length > 2 ? bars.slice(Math.max(0, n - 21), n - 1) : [prevBar];
  const resistanceLevel = Math.max(...srWindow.map((b) => b.h));
  const supportLevel = Math.min(...srWindow.map((b) => b.l));

  const curAtr = Math.max(0.01, atr14Series[curIdx] ?? 0.5);
  const refPrice = params.flow_burst_reference_price ?? curBar.o;
  const postBurstMoveDollars = Math.abs(curBar.c - refPrice);
  const postBurstAtrMultiple = round2(postBurstMoveDollars / curAtr);

  const curRsi = round2(rsi14Series[curIdx] ?? 50);
  const prevRsi = round2(rsi14Series[prevIdx] ?? curRsi);
  const curMacdHist = round4(macdObj.histogram[curIdx] ?? 0);
  const prevMacdHist = round4(macdObj.histogram[prevIdx] ?? curMacdHist);

  const bbUpper = round2(bbObj.upper[curIdx] ?? curBar.c * 1.01);
  const bbMiddle = round2(bbObj.middle[curIdx] ?? curBar.c);
  const bbLower = round2(bbObj.lower[curIdx] ?? curBar.c * 0.99);
  const bbBandwidthPct = round2(
    ((bbUpper - bbLower) / Math.max(bbMiddle, 0.01)) * 100
  );

  // Use session VWAP or current bar VWAP if closer to intraday institutional benchmark
  const vwapSession = round2(
    sessionVwapSeries[curIdx] ??
      (activeSessionBars.length > 0 ? curBar.vw : curBar.vw)
  );

  const snapshot: TechnicalIndicatorSnapshot = {
    as_of: curBar.t,
    data_source: params.data_source ?? 'deterministic_fallback',
    bars_1m_count: params.bars1m?.length ?? 0,
    bars_5m_count: bars.length,
    last_price: round2(curBar.c),
    vwap_session: vwapSession,
    ema_9: round2(ema9Series[curIdx] ?? curBar.c),
    ema_20: round2(ema20Series[curIdx] ?? curBar.c),
    ema_50: round2(ema50Series[curIdx] ?? curBar.c),
    atr_14: round4(curAtr),
    relative_volume_5m: round2(rvolSeries[curIdx] ?? 1.0),
    rsi_14: curRsi,
    rsi_prev: prevRsi,
    rsi_rising: curRsi >= prevRsi,
    macd_line: round4(macdObj.macd[curIdx] ?? 0),
    macd_signal: round4(macdObj.signal[curIdx] ?? 0),
    macd_histogram: curMacdHist,
    macd_histogram_prev: prevMacdHist,
    macd_histogram_rising: curMacdHist >= prevMacdHist,
    bollinger_upper: bbUpper,
    bollinger_middle: bbMiddle,
    bollinger_lower: bbLower,
    bollinger_bandwidth_pct: bbBandwidthPct,
    adx_14: round2(adxObj.adx[curIdx] ?? 20),
    plus_di_14: round2(adxObj.plusDi[curIdx] ?? 25),
    minus_di_14: round2(adxObj.minusDi[curIdx] ?? 20),
    prior_5m_high: round2(prevBar.h),
    prior_5m_low: round2(prevBar.l),
    prior_5m_close: round2(prevBar.c),
    support_level: round2(supportLevel),
    resistance_level: round2(resistanceLevel),
    post_burst_move_dollars: round2(postBurstMoveDollars),
    post_burst_atr_multiple: postBurstAtrMultiple,
  };

  return { snapshot, series };
}

/**
 * Evaluate Practical Stock Confirmation Rules (3 of 5) + Optional Boosts + 70/30 Weighting
 *
 * Bullish options-flow candidate — Require at least 3 of 5:
 * 1. Price is above session VWAP.
 * 2. EMA 9 is above EMA 20.
 * 3. 5-minute close is above the prior 5-minute high.
 * 4. 5-minute relative volume is at least 1.5x expected.
 * 5. Price moved at least 0.5 × 5-minute ATR after the flow burst.
 *
 * Bearish options-flow candidate — Mirror the logic (Require at least 3 of 5):
 * 1. Price is below session VWAP.
 * 2. EMA 9 is below EMA 20.
 * 3. 5-minute close is below the prior 5-minute low.
 * 4. 5-minute relative volume is at least 1.5x expected.
 * 5. Price fell at least 0.5 × 5-minute ATR after the flow burst.
 *
 * Optional boosts (only applied when underlying price action does not conflict):
 * - +3 points: RSI is 50–75 and rising (Bullish) / 25–50 and falling (Bearish)
 * - +4 points: MACD histogram is positive and rising (Bullish) / negative and falling (Bearish)
 * - +4 points: a large lit-stock print supports the move
 * - +3 points: price breaks above upper Bollinger Band with volume (Bullish) / below lower BB with volume (Bearish)
 *
 * Weighting:
 * stock_confirmation_score = (
 *   0.30 * vwap_alignment +
 *   0.20 * ema_alignment +
 *   0.20 * range_break +
 *   0.20 * relative_volume_confirmation +
 *   0.10 * atr_follow_through
 * )
 * final_score = 0.70 * options_flow_score + 0.30 * stock_confirmation_score (+ secondary boosts if confirmed)
 */
export function evaluateStockConfirmation(params: {
  direction: 'bullish' | 'bearish';
  options_flow_score: number;
  bars5m: AlpacaOhlcvBar[];
  bars1m?: AlpacaOhlcvBar[];
  lit_prints?: LitStockTradePrint[];
  min_lit_premium?: number;
  data_source?: 'alpaca_live_sip' | 'alpaca_live_iex' | 'deterministic_fallback';
  flow_burst_reference_price?: number;
}): StockConfirmationEvaluation {
  const { snapshot, series } = computeTechnicalIndicatorsFromBars({
    bars5m: params.bars5m,
    bars1m: params.bars1m,
    data_source: params.data_source,
    flow_burst_reference_price: params.flow_burst_reference_price,
  });

  const isBull = params.direction === 'bullish';
  const curBar = params.bars5m[params.bars5m.length - 1];
  const refPrice =
    params.flow_burst_reference_price ?? (curBar ? curBar.o : snapshot.last_price);
  const signedMove = isBull
    ? snapshot.last_price - refPrice
    : refPrice - snapshot.last_price;
  const directionalAtrMultiple = round2(
    Math.max(0, signedMove) / Math.max(snapshot.atr_14, 0.01)
  );
  snapshot.post_burst_move_dollars = round2(signedMove);
  snapshot.post_burst_atr_multiple = directionalAtrMultiple;

  // 1. VWAP Alignment (Weight 0.30)
  const vwapPassed = isBull
    ? snapshot.last_price > snapshot.vwap_session
    : snapshot.last_price < snapshot.vwap_session;
  const vwapComponent = vwapPassed ? 1.0 : 0.0;

  // 2. EMA 9 vs EMA 20 Alignment (Weight 0.20)
  const emaPassed = isBull
    ? snapshot.ema_9 > snapshot.ema_20
    : snapshot.ema_9 < snapshot.ema_20;
  const emaFullTrend = isBull
    ? snapshot.ema_9 > snapshot.ema_20 && snapshot.ema_20 >= snapshot.ema_50
    : snapshot.ema_9 < snapshot.ema_20 && snapshot.ema_20 <= snapshot.ema_50;
  const emaComponent = emaPassed ? (emaFullTrend ? 1.0 : 0.85) : 0.0;

  // 3. 5-Minute Range Break (Close > Prior 5m High or < Prior 5m Low) (Weight 0.20)
  const rangeBreakPassed = isBull
    ? snapshot.last_price > snapshot.prior_5m_high
    : snapshot.last_price < snapshot.prior_5m_low;
  const directionalCloseCheck = isBull
    ? snapshot.last_price > snapshot.prior_5m_close
    : snapshot.last_price < snapshot.prior_5m_close;
  const rangeBreakComponent = rangeBreakPassed
    ? 1.0
    : directionalCloseCheck
      ? 0.45
      : 0.0;

  // 4. 5-Minute Relative Volume >= 1.5x (Weight 0.20)
  const rvolPassed = snapshot.relative_volume_5m >= 1.5;
  const rvolComponent = rvolPassed
    ? 1.0
    : clamp((snapshot.relative_volume_5m - 0.8) / 0.7, 0, 0.85);

  // 5. ATR Follow-Through >= 0.5x 5m ATR (Weight 0.10)
  const atrPassed = directionalAtrMultiple >= 0.5;
  const atrComponent = atrPassed
    ? 1.0
    : clamp(directionalAtrMultiple / 0.5, 0, 0.9);

  const rules: StockConfirmationRuleItem[] = [
    {
      id: 'vwap_alignment',
      label: isBull
        ? 'Price above session VWAP'
        : 'Price below session VWAP',
      weight: 0.3,
      passed: vwapPassed,
      component_score: round2(vwapComponent),
      detail: `$${snapshot.last_price.toFixed(2)} ${isBull ? '>' : '<'} VWAP $${snapshot.vwap_session.toFixed(2)}`,
    },
    {
      id: 'ema_alignment',
      label: isBull ? 'EMA 9 above EMA 20' : 'EMA 9 below EMA 20',
      weight: 0.2,
      passed: emaPassed,
      component_score: round2(emaComponent),
      detail: `EMA9 $${snapshot.ema_9.toFixed(2)} ${isBull ? '>' : '<'} EMA20 $${snapshot.ema_20.toFixed(2)}`,
    },
    {
      id: 'range_break',
      label: isBull
        ? '5m close > prior 5m high'
        : '5m close < prior 5m low',
      weight: 0.2,
      passed: rangeBreakPassed,
      component_score: round2(rangeBreakComponent),
      detail: isBull
        ? `$${snapshot.last_price.toFixed(2)} > Prior High $${snapshot.prior_5m_high.toFixed(2)}`
        : `$${snapshot.last_price.toFixed(2)} < Prior Low $${snapshot.prior_5m_low.toFixed(2)}`,
    },
    {
      id: 'relative_volume',
      label: '5m RVOL >= 1.5x expected',
      weight: 0.2,
      passed: rvolPassed,
      component_score: round2(rvolComponent),
      detail: `${snapshot.relative_volume_5m.toFixed(2)}x vs 1.50x min`,
    },
    {
      id: 'atr_follow_through',
      label: isBull
        ? 'Move >= 0.5x 5m ATR'
        : 'Fall >= 0.5x 5m ATR',
      weight: 0.1,
      passed: atrPassed,
      component_score: round2(atrComponent),
      detail: `${directionalAtrMultiple.toFixed(2)}x ATR ($${snapshot.post_burst_move_dollars.toFixed(2)} / $${snapshot.atr_14.toFixed(2)})`,
    },

  ];

  const rulesPassedCount = rules.filter((r) => r.passed).length;
  const confirmed3Of5 = rulesPassedCount >= 3;

  const rawStockScoreNorm =
    0.3 * vwapComponent +
    0.2 * emaComponent +
    0.2 * rangeBreakComponent +
    0.2 * rvolComponent +
    0.1 * atrComponent;

  const stockConfirmationScore = Math.round(
    clamp(rawStockScoreNorm * 100, 0, 100)
  );

  // Lit Stock Trades evaluation
  const minLitPrem = params.min_lit_premium ?? 100_000;
  const litPrints = (params.lit_prints ?? []).filter(
    (p) => p.premium >= minLitPrem
  );
  const supportingPrints = litPrints.filter(
    (p) => p.side_inference === params.direction
  );
  const largestPrintPrem =
    litPrints.length > 0 ? Math.max(...litPrints.map((p) => p.premium)) : 0;
  const supportingPrem = supportingPrints.reduce(
    (acc, p) => acc + p.premium,
    0
  );
  const hasSupportingLargePrint = supportingPrints.length > 0;

  // Secondary Boosts (RSI, MACD, Lit Stock Print, Bollinger Breakout)
  // Guardrail: "Do not let RSI, MACD, or Bollinger Bands override conflicting price action and flow.
  // They should refine timing and filter out weak candidates—not manufacture a thesis."
  const priceActionAllowsBoosts = confirmed3Of5 && vwapPassed;

  const rsiTriggered = isBull
    ? snapshot.rsi_14 >= 50 && snapshot.rsi_14 <= 75 && snapshot.rsi_rising
    : snapshot.rsi_14 >= 25 && snapshot.rsi_14 <= 50 && !snapshot.rsi_rising;

  const macdTriggered = isBull
    ? snapshot.macd_histogram > 0 && snapshot.macd_histogram_rising
    : snapshot.macd_histogram < 0 && !snapshot.macd_histogram_rising;

  const bbBreakoutTriggered = isBull
    ? snapshot.last_price > snapshot.bollinger_upper &&
      snapshot.relative_volume_5m >= 1.5
    : snapshot.last_price < snapshot.bollinger_lower &&
      snapshot.relative_volume_5m >= 1.5;

  const secondaryBoosts: StockSecondaryBoostItem[] = [
    {
      id: 'rsi_momentum',
      label: isBull
        ? 'RSI 14 is 50–75 and rising (+3)'
        : 'RSI 14 is 25–50 and falling (+3)',
      max_points: 3,
      triggered: rsiTriggered,
      applied_points: priceActionAllowsBoosts && rsiTriggered ? 3 : 0,
      detail: `RSI ${snapshot.rsi_14.toFixed(1)} (prev ${snapshot.rsi_prev.toFixed(1)}, ${snapshot.rsi_rising ? 'rising' : 'falling'})`,
    },
    {
      id: 'macd_histogram',
      label: isBull
        ? 'MACD histogram positive & rising (+4)'
        : 'MACD histogram negative & falling (+4)',
      max_points: 4,
      triggered: macdTriggered,
      applied_points: priceActionAllowsBoosts && macdTriggered ? 4 : 0,
      detail: `Hist ${snapshot.macd_histogram >= 0 ? '+' : ''}${snapshot.macd_histogram.toFixed(3)} (prev ${snapshot.macd_histogram_prev.toFixed(3)})`,
    },
    {
      id: 'lit_stock_print',
      label: 'Large lit-stock print supports move (+4)',
      max_points: 4,
      triggered: hasSupportingLargePrint,
      applied_points:
        confirmed3Of5 && hasSupportingLargePrint ? 4 : 0,
      detail: hasSupportingLargePrint
        ? `${supportingPrints.length} supporting prints ($${(supportingPrem / 1000).toFixed(0)}K total)`
        : 'No supporting block print above threshold',
    },
    {
      id: 'bollinger_breakout',
      label: isBull
        ? 'Breaks above Upper Bollinger Band with volume (+3)'
        : 'Breaks below Lower Bollinger Band with volume (+3)',
      max_points: 3,
      triggered: bbBreakoutTriggered,
      applied_points: priceActionAllowsBoosts && bbBreakoutTriggered ? 3 : 0,
      detail: isBull
        ? `Close $${snapshot.last_price.toFixed(2)} vs Upper BB $${snapshot.bollinger_upper.toFixed(2)}`
        : `Close $${snapshot.last_price.toFixed(2)} vs Lower BB $${snapshot.bollinger_lower.toFixed(2)}`,
    },
  ];

  const secondaryBoostPoints = secondaryBoosts.reduce(
    (sum, b) => sum + b.applied_points,
    0
  );

  const guardrailNote = priceActionAllowsBoosts
    ? `Primary price action confirmed (${rulesPassedCount}/5 rules passed & VWAP aligned); +${secondaryBoostPoints} secondary momentum/lit-flow boost points applied.`
    : `Secondary indicator boosts gated (0 pts applied): RSI/MACD/Bollinger cannot override unconfirmed or conflicting price action (${rulesPassedCount}/5 rules passed).`;

  const finalCompositeScore = Math.round(
    clamp(
      0.7 * params.options_flow_score +
        0.3 * stockConfirmationScore +
        secondaryBoostPoints,
      0,
      100
    )
  );

  return {
    direction: params.direction,
    data_source: params.data_source ?? 'deterministic_fallback',
    rules_passed_count: rulesPassedCount,
    rules_required_count: 3,
    confirmed_3_of_5: confirmed3Of5,
    rules,
    weighted_components: {
      vwap_alignment: round2(vwapComponent),
      ema_alignment: round2(emaComponent),
      range_break: round2(rangeBreakComponent),
      relative_volume_confirmation: round2(rvolComponent),
      atr_follow_through: round2(atrComponent),
    },
    stock_confirmation_score: stockConfirmationScore,
    secondary_boosts: secondaryBoosts,
    secondary_boost_points: secondaryBoostPoints,
    guardrail_note: guardrailNote,
    options_flow_score: params.options_flow_score,
    final_composite_score: finalCompositeScore,
    indicators: snapshot,
    lit_flow: {
      min_premium_threshold: minLitPrem,
      total_lit_prints: litPrints.length,
      largest_print_premium: largestPrintPrem,
      supporting_lit_premium: supportingPrem,
      has_supporting_large_print: hasSupportingLargePrint,
      prints: litPrints.slice(0, 12),
    },
    recent_5m_bars: params.bars5m.slice(-24),
    recent_1m_bars: (params.bars1m ?? []).slice(-24),
    indicator_series_tail: series.slice(-20),
  };
}
