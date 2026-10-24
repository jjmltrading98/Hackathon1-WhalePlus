/**
 * Alpaca Account, Portfolio P/L & Trade Reconstruction Engine
 *
 * Pure, deterministic calculations for:
 * 1. OCC Option Symbol parsing (underlying, expiry, CALL/PUT, strike, 100x multiplier)
 * 2. FIFO Round-Trip Trade P/L Reconstruction from Alpaca FILL + OPEXP activities
 * 3. Per-Trade P/L Bar Series, Day-over-Day P/L Bar Series, and Intraday/Multi-Timeframe Equity & P/L Curves
 * 4. Account-level Risk & Performance Analytics (Win Rate, Profit Factor, Expectancy, Drawdown, Ticker Leaderboard)
 */

export type PortfolioTimeframeKey = '1D' | '1W' | '1M' | '3M' | '1A';

export interface ParsedSymbolInfo {
  symbol: string;
  underlying: string;
  is_option: boolean;
  expiration_date: string | null;
  option_type: 'CALL' | 'PUT' | null;
  strike_price: number | null;
  multiplier: number;
  short_label: string;
  full_label: string;
}

export interface RawAlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  crypto_status?: string;
  options_approved_level?: number;
  options_trading_level?: number;
  currency: string;
  buying_power: string;
  regt_buying_power?: string;
  effective_buying_power?: string;
  non_marginable_buying_power?: string;
  options_buying_power?: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  position_market_value?: string;
  initial_margin?: string;
  maintenance_margin?: string;
  sma?: string;
  multiplier?: string;
  daytrade_count?: number;
  pattern_day_trader?: boolean;
  trading_blocked?: boolean;
  transfers_blocked?: boolean;
  account_blocked?: boolean;
  created_at?: string;
  balance_asof?: string;
}

export interface NormalizedAlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  environment: 'PAPER' | 'LIVE' | 'SIMULATED_FALLBACK';
  currency: string;
  equity: number;
  last_equity: number;
  day_pl: number;
  day_pl_pct: number;
  cash: number;
  buying_power: number;
  regt_buying_power: number;
  options_buying_power: number;
  long_market_value: number;
  short_market_value: number;
  position_market_value: number;
  initial_margin: number;
  maintenance_margin: number;
  sma: number;
  multiplier: number;
  options_level: number;
  daytrade_count: number;
  pattern_day_trader: boolean;
  created_at: string;
  balance_asof: string;
}

export interface RawAlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange?: string;
  asset_class: string;
  qty: string;
  qty_available?: string;
  avg_entry_price: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export interface NormalizedAlpacaPosition {
  asset_id: string;
  symbol: string;
  underlying: string;
  display_label: string;
  full_label: string;
  is_option: boolean;
  option_type: 'CALL' | 'PUT' | null;
  strike_price: number | null;
  expiration_date: string | null;
  side: 'long' | 'short';
  qty: number;
  qty_available: number;
  multiplier: number;
  avg_entry_price: number;
  current_price: number;
  lastday_price: number;
  cost_basis: number;
  market_value: number;
  unrealized_pl: number;
  unrealized_pl_pct: number;
  intraday_pl: number;
  intraday_pl_pct: number;
  change_today_pct: number;
}

export interface RawAlpacaFillActivity {
  id: string;
  activity_type: 'FILL';
  transaction_time: string;
  type: string;
  price: string;
  qty: string;
  side: 'buy' | 'sell' | 'sell_short';
  symbol: string;
  leaves_qty?: string;
  order_id: string;
  cum_qty?: string;
  order_status?: string;
}

export interface RawAlpacaOptionExpiration {
  id: string;
  activity_type: 'OPEXP';
  date: string;
  created_at?: string;
  net_amount?: string;
  description?: string;
  symbol: string;
  qty: string;
  status?: string;
}

export interface ClosedTradeRecord {
  trade_id: string;
  chronological_index: number;
  symbol: string;
  underlying: string;
  short_label: string;
  full_label: string;
  is_option: boolean;
  option_type: 'CALL' | 'PUT' | null;
  strike_price: number | null;
  expiration_date: string | null;
  direction: 'LONG' | 'SHORT';
  qty: number;
  multiplier: number;
  entry_price: number;
  exit_price: number;
  cost_basis: number;
  gross_proceeds: number;
  realized_pl: number;
  realized_pl_pct: number;
  entry_time: string;
  exit_time: string;
  exit_date: string;
  hold_duration_minutes: number;
  hold_duration_label: string;
  outcome: 'WIN' | 'LOSS' | 'FLAT' | 'EXPIRED';
  entry_order_id: string;
  exit_order_id: string;
}

export interface DailyRealizedPlSummary {
  date: string;
  display_date: string;
  realized_pl: number;
  cumulative_realized_pl: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate_pct: number;
  gross_profit: number;
  gross_loss: number;
}

export interface TickerPerformanceSummary {
  underlying: string;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate_pct: number;
  gross_profit: number;
  gross_loss: number;
  net_pl: number;
  avg_pl_per_trade: number;
  best_trade_pl: number;
  worst_trade_pl: number;
}

export interface AccountTradePerformanceMetrics {
  total_closed_trades: number;
  win_count: number;
  loss_count: number;
  flat_count: number;
  expired_count: number;
  win_rate_pct: number;
  total_realized_pl: number;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number;
  avg_win: number;
  avg_loss: number;
  payoff_ratio: number;
  expectancy_per_trade: number;
  best_trade: ClosedTradeRecord | null;
  worst_trade: ClosedTradeRecord | null;
  avg_hold_minutes: number;
  avg_hold_label: string;
  max_win_streak: number;
  max_loss_streak: number;
}

export interface RawAlpacaPortfolioHistory {
  timestamp: number[];
  equity: Array<number | null>;
  profit_loss: Array<number | null>;
  profit_loss_pct: Array<number | null>;
  base_value: number;
  base_value_asof?: string;
  timeframe: string;
}

export interface PortfolioHistoryPoint {
  timestamp: number;
  iso_time: string;
  date_key: string;
  label: string;
  equity: number;
  bar_pl: number;
  bar_pl_pct: number;
  cumulative_pl: number;
  cumulative_pl_pct: number;
  drawdown_pct: number;
}

export interface NormalizedPortfolioHistory {
  period: PortfolioTimeframeKey;
  timeframe: string;
  base_value: number;
  base_value_asof: string;
  points: PortfolioHistoryPoint[];
  start_equity: number;
  end_equity: number;
  net_pl: number;
  net_pl_pct: number;
  high_equity: number;
  low_equity: number;
  max_drawdown_dollars: number;
  max_drawdown_pct: number;
  positive_periods: number;
  negative_periods: number;
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parses an OCC option symbol (e.g., UNH261016C00410000 or SHOP261120P00175000)
 * or regular equity ticker (e.g., NVDA, SPY).
 */
export function parseOccOptionSymbol(rawSymbol: string): ParsedSymbolInfo {
  const clean = String(rawSymbol || '').trim().toUpperCase();
  const occMatch = /^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(clean);

  if (!occMatch) {
    return {
      symbol: clean,
      underlying: clean,
      is_option: false,
      expiration_date: null,
      option_type: null,
      strike_price: null,
      multiplier: 1,
      short_label: clean,
      full_label: `${clean} Equity`,
    };
  }

  const [, underlying, yy, mm, dd, cp, strikeRaw] = occMatch;
  const expiration_date = `20${yy}-${mm}-${dd}`;
  const option_type: 'CALL' | 'PUT' = cp === 'C' ? 'CALL' : 'PUT';
  const strike_price = round2(Number.parseInt(strikeRaw, 10) / 1000);
  const strikeFormatted =
    strike_price % 1 === 0 ? `$${strike_price.toFixed(0)}` : `$${strike_price.toFixed(2)}`;

  return {
    symbol: clean,
    underlying,
    is_option: true,
    expiration_date,
    option_type,
    strike_price,
    multiplier: 100,
    short_label: `${underlying} ${strikeFormatted}${cp} ${mm}/${dd}`,
    full_label: `${underlying} ${expiration_date} ${strikeFormatted} ${option_type}`,
  };
}

export function formatHoldDuration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const days = Math.floor(m / 1440);
  const remHours = Math.floor((m % 1440) / 60);
  const remMins = m % 60;
  if (days > 0) {
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  return remMins > 0 ? `${remHours}h ${remMins}m` : `${remHours}h`;
}

export function normalizeAlpacaAccount(
  raw: RawAlpacaAccount,
  environment: 'PAPER' | 'LIVE' | 'SIMULATED_FALLBACK' = 'PAPER'
): NormalizedAlpacaAccount {
  const equity = round2(safeNum(raw.equity));
  const last_equity = round2(safeNum(raw.last_equity, equity));
  const day_pl = round2(equity - last_equity);
  const day_pl_pct = last_equity > 0 ? round2((day_pl / last_equity) * 100) : 0;

  return {
    id: raw.id || 'alpaca-account',
    account_number: raw.account_number || 'PA-UNKNOWN',
    status: raw.status || 'ACTIVE',
    environment,
    currency: raw.currency || 'USD',
    equity,
    last_equity,
    day_pl,
    day_pl_pct,
    cash: round2(safeNum(raw.cash)),
    buying_power: round2(safeNum(raw.buying_power)),
    regt_buying_power: round2(safeNum(raw.regt_buying_power, safeNum(raw.buying_power))),
    options_buying_power: round2(safeNum(raw.options_buying_power, safeNum(raw.cash))),
    long_market_value: round2(safeNum(raw.long_market_value)),
    short_market_value: round2(safeNum(raw.short_market_value)),
    position_market_value: round2(
      safeNum(raw.position_market_value, safeNum(raw.long_market_value) + Math.abs(safeNum(raw.short_market_value)))
    ),
    initial_margin: round2(safeNum(raw.initial_margin)),
    maintenance_margin: round2(safeNum(raw.maintenance_margin)),
    sma: round2(safeNum(raw.sma)),
    multiplier: safeNum(raw.multiplier, 1),
    options_level: safeNum(raw.options_trading_level ?? raw.options_approved_level, 0),
    daytrade_count: safeNum(raw.daytrade_count, 0),
    pattern_day_trader: Boolean(raw.pattern_day_trader),
    created_at: raw.created_at || new Date().toISOString(),
    balance_asof: raw.balance_asof || new Date().toISOString().slice(0, 10),
  };
}

export function normalizeAlpacaPositions(rawPositions: RawAlpacaPosition[]): NormalizedAlpacaPosition[] {
  return (rawPositions || []).map((pos) => {
    const parsed = parseOccOptionSymbol(pos.symbol);
    const qty = Math.abs(safeNum(pos.qty));
    const side: 'long' | 'short' =
      String(pos.side).toLowerCase() === 'short' || safeNum(pos.qty) < 0 ? 'short' : 'long';
    return {
      asset_id: pos.asset_id,
      symbol: parsed.symbol,
      underlying: parsed.underlying,
      display_label: parsed.short_label,
      full_label: parsed.full_label,
      is_option: parsed.is_option,
      option_type: parsed.option_type,
      strike_price: parsed.strike_price,
      expiration_date: parsed.expiration_date,
      side,
      qty,
      qty_available: Math.abs(safeNum(pos.qty_available, qty)),
      multiplier: parsed.multiplier,
      avg_entry_price: round2(safeNum(pos.avg_entry_price)),
      current_price: round2(safeNum(pos.current_price)),
      lastday_price: round2(safeNum(pos.lastday_price)),
      cost_basis: round2(safeNum(pos.cost_basis)),
      market_value: round2(safeNum(pos.market_value)),
      unrealized_pl: round2(safeNum(pos.unrealized_pl)),
      unrealized_pl_pct: round2(safeNum(pos.unrealized_plpc) * 100),
      intraday_pl: round2(safeNum(pos.unrealized_intraday_pl)),
      intraday_pl_pct: round2(safeNum(pos.unrealized_intraday_plpc) * 100),
      change_today_pct: round2(safeNum(pos.change_today) * 100),
    };
  });
}

interface ConsolidatedOrderFill {
  id: string;
  order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  avg_price: number;
  timestamp: string;
  is_expiration: boolean;
}

interface OpenInventoryLot {
  order_id: string;
  side: 'buy' | 'sell';
  qty_remaining: number;
  price: number;
  timestamp: string;
}

/**
 * Reconstructs round-trip realized trades from Alpaca FILL and OPEXP activities using FIFO lot matching.
 * Also aggregates partial fills belonging to the same order_id so each trade row represents a clean execution.
 */
export function reconstructRoundTripTrades(
  fills: RawAlpacaFillActivity[],
  expirations: RawAlpacaOptionExpiration[] = []
): {
  closed_trades: ClosedTradeRecord[];
  daily_realized_pl: DailyRealizedPlSummary[];
  ticker_performance: TickerPerformanceSummary[];
  metrics: AccountTradePerformanceMetrics;
} {
  // 1. Consolidate partial fills that share the same order_id + symbol + side
  const orderMap = new Map<string, ConsolidatedOrderFill>();

  for (const fill of fills || []) {
    const qty = Math.abs(safeNum(fill.qty));
    const price = safeNum(fill.price);
    if (qty <= 0 || !fill.symbol) continue;
    const normalizedSide: 'buy' | 'sell' =
      String(fill.side).toLowerCase() === 'buy' ? 'buy' : 'sell';
    const key = `${fill.order_id || fill.id}::${fill.symbol}::${normalizedSide}`;
    const existing = orderMap.get(key);
    if (!existing) {
      orderMap.set(key, {
        id: fill.id,
        order_id: fill.order_id || fill.id,
        symbol: fill.symbol,
        side: normalizedSide,
        qty,
        avg_price: price,
        timestamp: fill.transaction_time || new Date().toISOString(),
        is_expiration: false,
      });
    } else {
      const totalValue = existing.qty * existing.avg_price + qty * price;
      const newQty = existing.qty + qty;
      existing.avg_price = newQty > 0 ? totalValue / newQty : price;
      existing.qty = newQty;
      if (fill.transaction_time && fill.transaction_time > existing.timestamp) {
        existing.timestamp = fill.transaction_time;
      }
    }
  }

  for (const exp of expirations || []) {
    const rawQty = safeNum(exp.qty);
    const qty = Math.abs(rawQty);
    if (qty <= 0 || !exp.symbol) continue;
    // An option expiration with negative qty closes a long option position at $0.00
    const normalizedSide: 'buy' | 'sell' = rawQty < 0 ? 'sell' : 'buy';
    const expTime = exp.created_at || `${exp.date || '2026-10-16'}T20:00:00Z`;
    const key = `OPEXP::${exp.id}::${exp.symbol}`;
    orderMap.set(key, {
      id: exp.id,
      order_id: `EXP-${exp.date || 'OPT'}`,
      symbol: exp.symbol,
      side: normalizedSide,
      qty,
      avg_price: 0,
      timestamp: expTime,
      is_expiration: true,
    });
  }

  // Sort consolidated events oldest -> newest
  const chronologicalEvents = Array.from(orderMap.values()).sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );

  const inventoryBySymbol = new Map<string, OpenInventoryLot[]>();
  const rawClosedTrades: Omit<ClosedTradeRecord, 'chronological_index'>[] = [];

  for (const event of chronologicalEvents) {
    const parsed = parseOccOptionSymbol(event.symbol);
    const lots = inventoryBySymbol.get(parsed.symbol) || [];
    let remainingEventQty = event.qty;

    // Check if there are opposite lots to close
    if (lots.length > 0 && lots[0].side !== event.side) {
      let matchedQty = 0;
      let weightedEntryCost = 0;
      let earliestEntryTime = lots[0].timestamp;
      let primaryEntryOrderId = lots[0].order_id;
      const openingSide = lots[0].side;

      while (remainingEventQty > 0 && lots.length > 0 && lots[0].side !== event.side) {
        const frontLot = lots[0];
        const takeQty = Math.min(remainingEventQty, frontLot.qty_remaining);
        matchedQty += takeQty;
        weightedEntryCost += takeQty * frontLot.price;
        remainingEventQty = round2(remainingEventQty - takeQty);
        frontLot.qty_remaining = round2(frontLot.qty_remaining - takeQty);

        if (frontLot.qty_remaining <= 1e-6) {
          lots.shift();
        }
      }

      if (matchedQty > 0) {
        const avgEntryPrice = weightedEntryCost / matchedQty;
        const exitPrice = event.avg_price;
        const direction: 'LONG' | 'SHORT' = openingSide === 'buy' ? 'LONG' : 'SHORT';
        const costBasis = round2(matchedQty * avgEntryPrice * parsed.multiplier);
        const grossProceeds = round2(matchedQty * exitPrice * parsed.multiplier);
        const realizedPl =
          direction === 'LONG'
            ? round2(grossProceeds - costBasis)
            : round2(costBasis - grossProceeds);
        const realizedPlPct =
          costBasis > 0 ? round2((realizedPl / costBasis) * 100) : 0;

        const entryMs = Date.parse(earliestEntryTime);
        const exitMs = Date.parse(event.timestamp);
        const holdMinutes =
          Number.isFinite(entryMs) && Number.isFinite(exitMs) && exitMs >= entryMs
            ? Math.max(1, Math.round((exitMs - entryMs) / 60000))
            : 1;

        let outcome: 'WIN' | 'LOSS' | 'FLAT' | 'EXPIRED' = 'FLAT';
        if (event.is_expiration) {
          outcome = 'EXPIRED';
        } else if (realizedPl > 0.01) {
          outcome = 'WIN';
        } else if (realizedPl < -0.01) {
          outcome = 'LOSS';
        }

        const exitDate = event.timestamp.slice(0, 10);

        rawClosedTrades.push({
          trade_id: `${parsed.symbol}-${event.order_id}-${rawClosedTrades.length + 1}`,
          symbol: parsed.symbol,
          underlying: parsed.underlying,
          short_label: parsed.short_label,
          full_label: parsed.full_label,
          is_option: parsed.is_option,
          option_type: parsed.option_type,
          strike_price: parsed.strike_price,
          expiration_date: parsed.expiration_date,
          direction,
          qty: matchedQty,
          multiplier: parsed.multiplier,
          entry_price: round2(avgEntryPrice),
          exit_price: round2(exitPrice),
          cost_basis: costBasis,
          gross_proceeds: grossProceeds,
          realized_pl: realizedPl,
          realized_pl_pct: realizedPlPct,
          entry_time: earliestEntryTime,
          exit_time: event.timestamp,
          exit_date: exitDate,
          hold_duration_minutes: holdMinutes,
          hold_duration_label: formatHoldDuration(holdMinutes),
          outcome,
          entry_order_id: primaryEntryOrderId,
          exit_order_id: event.order_id,
        });
      }
    }

    // Only open a new inventory lot if it's a buy (or non-expiration equity/option opening)
    // Note: If the very first event for an option in the fetched window is a sell without a prior buy,
    // we only record it as an opening short lot if it's not an OPEXP event.
    if (remainingEventQty > 1e-6 && !event.is_expiration) {
      lots.push({
        order_id: event.order_id,
        side: event.side,
        qty_remaining: remainingEventQty,
        price: event.avg_price,
        timestamp: event.timestamp,
      });
    }

    inventoryBySymbol.set(parsed.symbol, lots);
  }

  // Assign chronological_index (1..N from oldest to newest)
  const chronologicalClosed: ClosedTradeRecord[] = rawClosedTrades.map((t, idx) => ({
    ...t,
    chronological_index: idx + 1,
  }));

  // Build daily realized P/L summary (sorted oldest -> newest for bar chart)
  const dailyMap = new Map<
    string,
    {
      date: string;
      realized_pl: number;
      trade_count: number;
      win_count: number;
      loss_count: number;
      gross_profit: number;
      gross_loss: number;
    }
  >();

  for (const t of chronologicalClosed) {
    const existing = dailyMap.get(t.exit_date) || {
      date: t.exit_date,
      realized_pl: 0,
      trade_count: 0,
      win_count: 0,
      loss_count: 0,
      gross_profit: 0,
      gross_loss: 0,
    };
    existing.realized_pl = round2(existing.realized_pl + t.realized_pl);
    existing.trade_count += 1;
    if (t.realized_pl > 0.01) {
      existing.win_count += 1;
      existing.gross_profit = round2(existing.gross_profit + t.realized_pl);
    } else if (t.realized_pl < -0.01) {
      existing.loss_count += 1;
      existing.gross_loss = round2(existing.gross_loss + Math.abs(t.realized_pl));
    }
    dailyMap.set(t.exit_date, existing);
  }

  let runningDailyPl = 0;
  const daily_realized_pl: DailyRealizedPlSummary[] = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      runningDailyPl = round2(runningDailyPl + d.realized_pl);
      const [, mm, dd] = d.date.split('-');
      return {
        date: d.date,
        display_date: mm && dd ? `${mm}/${dd}` : d.date,
        realized_pl: d.realized_pl,
        cumulative_realized_pl: runningDailyPl,
        trade_count: d.trade_count,
        win_count: d.win_count,
        loss_count: d.loss_count,
        win_rate_pct: d.trade_count > 0 ? round2((d.win_count / d.trade_count) * 100) : 0,
        gross_profit: d.gross_profit,
        gross_loss: d.gross_loss,
      };
    });

  // Build ticker performance leaderboard
  const tickerMap = new Map<string, TickerPerformanceSummary>();
  for (const t of chronologicalClosed) {
    const cur = tickerMap.get(t.underlying) || {
      underlying: t.underlying,
      trade_count: 0,
      win_count: 0,
      loss_count: 0,
      win_rate_pct: 0,
      gross_profit: 0,
      gross_loss: 0,
      net_pl: 0,
      avg_pl_per_trade: 0,
      best_trade_pl: Number.NEGATIVE_INFINITY,
      worst_trade_pl: Number.POSITIVE_INFINITY,
    };
    cur.trade_count += 1;
    cur.net_pl = round2(cur.net_pl + t.realized_pl);
    if (t.realized_pl > 0.01) {
      cur.win_count += 1;
      cur.gross_profit = round2(cur.gross_profit + t.realized_pl);
    } else if (t.realized_pl < -0.01) {
      cur.loss_count += 1;
      cur.gross_loss = round2(cur.gross_loss + Math.abs(t.realized_pl));
    }
    if (t.realized_pl > cur.best_trade_pl) cur.best_trade_pl = t.realized_pl;
    if (t.realized_pl < cur.worst_trade_pl) cur.worst_trade_pl = t.realized_pl;
    tickerMap.set(t.underlying, cur);
  }

  const ticker_performance: TickerPerformanceSummary[] = Array.from(tickerMap.values())
    .map((item) => ({
      ...item,
      win_rate_pct: item.trade_count > 0 ? round2((item.win_count / item.trade_count) * 100) : 0,
      avg_pl_per_trade: item.trade_count > 0 ? round2(item.net_pl / item.trade_count) : 0,
      best_trade_pl: Number.isFinite(item.best_trade_pl) ? item.best_trade_pl : 0,
      worst_trade_pl: Number.isFinite(item.worst_trade_pl) ? item.worst_trade_pl : 0,
    }))
    .sort((a, b) => b.net_pl - a.net_pl);

  // Overall metrics
  let win_count = 0;
  let loss_count = 0;
  let flat_count = 0;
  let expired_count = 0;
  let gross_profit = 0;
  let gross_loss = 0;
  let total_realized_pl = 0;
  let total_hold_minutes = 0;
  let best_trade: ClosedTradeRecord | null = null;
  let worst_trade: ClosedTradeRecord | null = null;
  let curWinStreak = 0;
  let curLossStreak = 0;
  let max_win_streak = 0;
  let max_loss_streak = 0;

  for (const t of chronologicalClosed) {
    total_realized_pl = round2(total_realized_pl + t.realized_pl);
    total_hold_minutes += t.hold_duration_minutes;
    if (t.outcome === 'EXPIRED') expired_count += 1;

    if (t.realized_pl > 0.01) {
      win_count += 1;
      gross_profit = round2(gross_profit + t.realized_pl);
      curWinStreak += 1;
      curLossStreak = 0;
      if (curWinStreak > max_win_streak) max_win_streak = curWinStreak;
    } else if (t.realized_pl < -0.01) {
      loss_count += 1;
      gross_loss = round2(gross_loss + Math.abs(t.realized_pl));
      curLossStreak += 1;
      curWinStreak = 0;
      if (curLossStreak > max_loss_streak) max_loss_streak = curLossStreak;
    } else {
      flat_count += 1;
      curWinStreak = 0;
      curLossStreak = 0;
    }

    if (!best_trade || t.realized_pl > best_trade.realized_pl) best_trade = t;
    if (!worst_trade || t.realized_pl < worst_trade.realized_pl) worst_trade = t;
  }

  const total_closed_trades = chronologicalClosed.length;
  const win_rate_pct =
    total_closed_trades > 0 ? round2((win_count / total_closed_trades) * 100) : 0;
  const profit_factor =
    gross_loss > 0 ? round2(gross_profit / gross_loss) : gross_profit > 0 ? 99.99 : 0;
  const avg_win = win_count > 0 ? round2(gross_profit / win_count) : 0;
  const avg_loss = loss_count > 0 ? round2(gross_loss / loss_count) : 0;
  const payoff_ratio = avg_loss > 0 ? round2(avg_win / avg_loss) : avg_win > 0 ? 99.99 : 0;
  const expectancy_per_trade =
    total_closed_trades > 0 ? round2(total_realized_pl / total_closed_trades) : 0;
  const avg_hold_minutes =
    total_closed_trades > 0 ? Math.round(total_hold_minutes / total_closed_trades) : 0;

  // Return closed_trades sorted newest first for table display (chronological_index preserved for chart)
  const closed_trades = [...chronologicalClosed].reverse();

  return {
    closed_trades,
    daily_realized_pl,
    ticker_performance,
    metrics: {
      total_closed_trades,
      win_count,
      loss_count,
      flat_count,
      expired_count,
      win_rate_pct,
      total_realized_pl,
      gross_profit,
      gross_loss,
      profit_factor,
      avg_win,
      avg_loss,
      payoff_ratio,
      expectancy_per_trade,
      best_trade,
      worst_trade,
      avg_hold_minutes,
      avg_hold_label: formatHoldDuration(avg_hold_minutes),
      max_win_streak,
      max_loss_streak,
    },
  };
}

function formatPortfolioTimestampLabel(unixSeconds: number, period: PortfolioTimeframeKey): string {
  const d = new Date(unixSeconds * 1000);
  if (period === '1D') {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[d.getUTCMonth()] || 'Oct';
  const day = d.getUTCDate();
  if (period === '1W') {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${mon} ${day} ${hh}:00`;
  }
  return `${mon} ${day}`;
}

export function normalizePortfolioHistory(
  raw: RawAlpacaPortfolioHistory,
  period: PortfolioTimeframeKey
): NormalizedPortfolioHistory {
  const timestamps = raw?.timestamp || [];
  const equities = raw?.equity || [];
  const pls = raw?.profit_loss || [];
  const plPcts = raw?.profit_loss_pct || [];
  const baseValue = round2(safeNum(raw?.base_value, safeNum(equities[0], 25000)));

  const points: PortfolioHistoryPoint[] = [];
  let peakEquity = baseValue > 0 ? baseValue : 0;
  let maxDrawdownDollars = 0;
  let maxDrawdownPct = 0;
  let highEquity = Number.NEGATIVE_INFINITY;
  let lowEquity = Number.POSITIVE_INFINITY;
  let positive_periods = 0;
  let negative_periods = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const eqRaw = equities[i];
    if (eqRaw === null || eqRaw === undefined) continue;
    const eq = round2(safeNum(eqRaw));
    if (eq <= 0) continue;

    const ts = timestamps[i];
    const iso = new Date(ts * 1000).toISOString();
    const date_key = iso.slice(0, 10);
    const barPl = round2(safeNum(pls[i], i > 0 && points.length > 0 ? eq - points[points.length - 1].equity : eq - baseValue));
    const barPlPct = round2(safeNum(plPcts[i], 0) * 100);
    const cumulativePl = round2(eq - baseValue);
    const cumulativePlPct = baseValue > 0 ? round2((cumulativePl / baseValue) * 100) : 0;

    if (eq > peakEquity) peakEquity = eq;
    const ddDollars = round2(peakEquity - eq);
    const ddPct = peakEquity > 0 ? round2((ddDollars / peakEquity) * 100) : 0;
    if (ddDollars > maxDrawdownDollars) maxDrawdownDollars = ddDollars;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    if (eq > highEquity) highEquity = eq;
    if (eq < lowEquity) lowEquity = eq;

    if (barPl > 0.01) positive_periods += 1;
    else if (barPl < -0.01) negative_periods += 1;

    points.push({
      timestamp: ts,
      iso_time: iso,
      date_key,
      label: formatPortfolioTimestampLabel(ts, period),
      equity: eq,
      bar_pl: barPl,
      bar_pl_pct: barPlPct,
      cumulative_pl: cumulativePl,
      cumulative_pl_pct: cumulativePlPct,
      drawdown_pct: -ddPct,
    });
  }

  const start_equity = points.length > 0 ? points[0].equity : baseValue;
  const end_equity = points.length > 0 ? points[points.length - 1].equity : baseValue;
  const net_pl = round2(end_equity - baseValue);
  const net_pl_pct = baseValue > 0 ? round2((net_pl / baseValue) * 100) : 0;

  return {
    period,
    timeframe: raw?.timeframe || (period === '1D' ? '5Min' : period === '1W' ? '1H' : '1D'),
    base_value: baseValue,
    base_value_asof: raw?.base_value_asof || (points[0]?.date_key ?? '2026-10-16'),
    points,
    start_equity,
    end_equity,
    net_pl,
    net_pl_pct,
    high_equity: Number.isFinite(highEquity) ? highEquity : end_equity,
    low_equity: Number.isFinite(lowEquity) ? lowEquity : start_equity,
    max_drawdown_dollars: maxDrawdownDollars,
    max_drawdown_pct: maxDrawdownPct,
    positive_periods,
    negative_periods,
  };
}

export type MarketSessionPhase =
  | 'regular_open'
  | 'pre_market'
  | 'after_hours'
  | 'weekend_or_holiday';

export interface RawAlpacaClockResponse {
  timestamp?: string;
  is_open?: boolean;
  next_open?: string;
  next_close?: string;
}

export interface AlpacaMarketClockState {
  is_open: boolean;
  session_phase: MarketSessionPhase;
  status_label: 'MARKET OPEN' | 'MARKET CLOSED';
  phase_label: string;
  timestamp: string;
  et_time_formatted: string;
  next_open: string;
  next_open_formatted: string;
  next_close: string;
  next_close_formatted: string;
  source: 'alpaca_clock_api' | 'et_schedule_clock';
  endpoint: string;
  activity_halted: boolean;
  halt_reason: string | null;
}

function getEtPartsForDate(d: Date): {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const rawHour = Number.parseInt(get('hour'), 10);
  return {
    year: Number.parseInt(get('year'), 10) || 2026,
    month: Number.parseInt(get('month'), 10) || 1,
    day: Number.parseInt(get('day'), 10) || 1,
    weekday: get('weekday') || 'Mon',
    hour: rawHour === 24 ? 0 : Number.isFinite(rawHour) ? rawHour : 0,
    minute: Number.parseInt(get('minute'), 10) || 0,
    second: Number.parseInt(get('second'), 10) || 0,
  };
}

function formatEtDateTimeShort(isoOrDate: string | Date): string {
  const d =
    typeof isoOrDate === 'string'
      ? new Date(isoOrDate)
      : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d) + ' ET'
  );
}

function formatEtClockTimeOnly(d: Date): string {
  if (Number.isNaN(d.getTime())) return '00:00:00 ET';
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d) + ' ET'
  );
}

function computeNextEtRthTimestamp(
  fromDate: Date,
  targetHour: number,
  targetMinute: number,
  allowToday: boolean
): string {
  const probe = new Date(fromDate.getTime());
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidateDay = new Date(probe.getTime() + dayOffset * 86_400_000);
    const parts = getEtPartsForDate(candidateDay);
    const isWeekend = parts.weekday === 'Sat' || parts.weekday === 'Sun';
    if (isWeekend) continue;

    if (dayOffset === 0 && !allowToday) continue;
    const minsNow = parts.hour * 60 + parts.minute;
    const targetMins = targetHour * 60 + targetMinute;
    if (dayOffset === 0 && minsNow >= targetMins) continue;

    // Construct exact UTC timestamp corresponding to targetHour:targetMinute ET on that date
    const deltaMins = targetMins - minsNow;
    const targetMs =
      candidateDay.getTime() +
      deltaMins * 60_000 -
      parts.second * 1000;
    return new Date(targetMs).toISOString();
  }
  return new Date(fromDate.getTime() + 86_400_000).toISOString();
}

/**
 * Pure, deterministic evaluator that normalizes an Alpaca `/v2/clock` response
 * (or computes the exact US equities/options RTH schedule in `America/New_York` 09:30–16:00 ET)
 * and determines whether automated scanning, AI queue workers, and order execution must stop.
 */
export function computeAlpacaMarketClockState(
  rawClock?: RawAlpacaClockResponse | null,
  referenceDate: Date = new Date(),
  source: 'alpaca_clock_api' | 'et_schedule_clock' = rawClock
    ? 'alpaca_clock_api'
    : 'et_schedule_clock',
  endpoint = 'https://paper-api.alpaca.markets/v2/clock'
): AlpacaMarketClockState {
  const tsIso =
    rawClock?.timestamp && !Number.isNaN(Date.parse(rawClock.timestamp))
      ? new Date(rawClock.timestamp).toISOString()
      : referenceDate.toISOString();
  const effectiveDate = new Date(tsIso);
  const et = getEtPartsForDate(effectiveDate);
  const isWeekend = et.weekday === 'Sat' || et.weekday === 'Sun';
  const minutesFromMidnight = et.hour * 60 + et.minute;
  const rthOpenMins = 9 * 60 + 30; // 09:30 ET
  const rthCloseMins = 16 * 60; // 16:00 ET

  const scheduleIsOpen =
    !isWeekend &&
    minutesFromMidnight >= rthOpenMins &&
    minutesFromMidnight < rthCloseMins;

  const isOpen =
    typeof rawClock?.is_open === 'boolean' ? rawClock.is_open : scheduleIsOpen;

  let sessionPhase: MarketSessionPhase = 'regular_open';
  let phaseLabel = 'Regular Trading Hours (09:30–16:00 ET)';
  if (!isOpen) {
    if (isWeekend) {
      sessionPhase = 'weekend_or_holiday';
      phaseLabel = 'Weekend / Market Holiday';
    } else if (minutesFromMidnight < rthOpenMins) {
      sessionPhase = 'pre_market';
      phaseLabel = 'Pre-Market (Opens 09:30 AM ET)';
    } else {
      sessionPhase = 'after_hours';
      phaseLabel = 'After-Hours (Closed at 04:00 PM ET)';
    }
  }

  const nextOpenIso =
    rawClock?.next_open && !Number.isNaN(Date.parse(rawClock.next_open))
      ? new Date(rawClock.next_open).toISOString()
      : computeNextEtRthTimestamp(
          effectiveDate,
          9,
          30,
          !isWeekend && minutesFromMidnight < rthOpenMins
        );

  const nextCloseIso =
    rawClock?.next_close && !Number.isNaN(Date.parse(rawClock.next_close))
      ? new Date(rawClock.next_close).toISOString()
      : computeNextEtRthTimestamp(
          effectiveDate,
          16,
          0,
          !isWeekend && minutesFromMidnight < rthCloseMins
        );

  const nextOpenFormatted = formatEtDateTimeShort(nextOpenIso);
  const nextCloseFormatted = formatEtDateTimeShort(nextCloseIso);

  return {
    is_open: isOpen,
    session_phase: sessionPhase,
    status_label: isOpen ? 'MARKET OPEN' : 'MARKET CLOSED',
    phase_label: phaseLabel,
    timestamp: tsIso,
    et_time_formatted: formatEtClockTimeOnly(effectiveDate),
    next_open: nextOpenIso,
    next_open_formatted: nextOpenFormatted,
    next_close: nextCloseIso,
    next_close_formatted: nextCloseFormatted,
    source,
    endpoint,
    activity_halted: !isOpen,
    halt_reason: isOpen
      ? null
      : `US Options Market is closed (${phaseLabel}). Automated scanning, AI queue workers, and background order execution are stopped until ${nextOpenFormatted}.`,
  };
}

