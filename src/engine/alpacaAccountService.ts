import {
  type AccountTradePerformanceMetrics,
  type AlpacaMarketClockState,
  type ClosedTradeRecord,
  type DailyRealizedPlSummary,
  type NormalizedAlpacaAccount,
  type NormalizedAlpacaPosition,
  type NormalizedPortfolioHistory,
  type PortfolioTimeframeKey,
  type RawAlpacaAccount,
  type RawAlpacaClockResponse,
  type RawAlpacaFillActivity,
  type RawAlpacaOptionExpiration,
  type RawAlpacaPortfolioHistory,
  type RawAlpacaPosition,
  type TickerPerformanceSummary,
  computeAlpacaMarketClockState,
  normalizeAlpacaAccount,
  normalizeAlpacaPositions,
  normalizePortfolioHistory,
  parseOccOptionSymbol,
  reconstructRoundTripTrades,
} from './alpacaAccountEngine.ts';
import { computeDeterministicPostFillOptionMark } from './smartOrderEngine.ts';

export interface AlpacaRecentOrder {
  id: string;
  symbol: string;
  underlying: string;
  short_label: string;
  side: string;
  type: string;
  qty: number;
  filled_qty: number;
  filled_avg_price: number | null;
  limit_price: number | null;
  status: string;
  submitted_at: string;
  filled_at: string | null;
}

export interface AlpacaAccountOverviewPayload {
  connected: boolean;
  source: 'ALPACA_PAPER_LIVE' | 'ALPACA_LIVE' | 'DETERMINISTIC_FALLBACK';
  last_synced_at: string;
  account: NormalizedAlpacaAccount;
  positions: NormalizedAlpacaPosition[];
  portfolio_history: Record<PortfolioTimeframeKey, NormalizedPortfolioHistory>;
  closed_trades: ClosedTradeRecord[];
  daily_realized_pl: DailyRealizedPlSummary[];
  ticker_performance: TickerPerformanceSummary[];
  metrics: AccountTradePerformanceMetrics;
  recent_orders: AlpacaRecentOrder[];
  raw_fills_count: number;
}

const TIMEFRAME_CONFIGS: Array<{ period: PortfolioTimeframeKey; timeframe: string }> = [
  { period: '1D', timeframe: '5Min' },
  { period: '1W', timeframe: '1H' },
  { period: '1M', timeframe: '1D' },
  { period: '3M', timeframe: '1D' },
  { period: '1A', timeframe: '1D' },
];

async function safeParseResponseJson<T>(
  res: Response | null | undefined,
  fallback: T
): Promise<T> {
  if (!res || !res.ok) return fallback;
  try {
    const text = await res.text();
    if (!text) return fallback;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('<')) return fallback;
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

export interface SmartOrderTicketSyncInput {
  order_id: string;
  alpaca_broker_order_id?: string | null;
  option_symbol: string;
  ticker: string;
  side: string;
  requested_qty: number;
  filled_qty: number;
  status: string;
  arrival_bid: number;
  arrival_ask: number;
  arrival_mid: number;
  theo_fair_value?: number;
  initial_limit_price?: number;
  active_limit_price?: number;
  avg_fill_price?: number | null;
  naive_market_fill_price?: number;
  price_improvement_per_contract?: number;
  created_at: string;
  updated_at: string;
}

function roundMoney(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function formatHoldDurationMinutes(minutes: number): string {
  const safeMin = Math.max(1, Math.round(minutes));
  if (safeMin < 60) return `${safeMin}m`;
  const hrs = Math.floor(safeMin / 60);
  const rem = safeMin % 60;
  if (hrs < 24) return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}

function recomputeClosedTradeAggregates(trades: ClosedTradeRecord[]): {
  closed_trades: ClosedTradeRecord[];
  daily_realized_pl: DailyRealizedPlSummary[];
  ticker_performance: TickerPerformanceSummary[];
  metrics: AccountTradePerformanceMetrics;
} {
  const sortedAsc = [...trades].sort(
    (a, b) =>
      (Date.parse(a.exit_time) || 0) - (Date.parse(b.exit_time) || 0) ||
      a.trade_id.localeCompare(b.trade_id)
  );
  const chronologicalClosed: ClosedTradeRecord[] = sortedAsc.map((t, idx) => ({
    ...t,
    chronological_index: idx + 1,
  }));

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
    const dateKey = (t.exit_date || t.exit_time.slice(0, 10) || '2026-10-21').slice(0, 10);
    const existing = dailyMap.get(dateKey) || {
      date: dateKey,
      realized_pl: 0,
      trade_count: 0,
      win_count: 0,
      loss_count: 0,
      gross_profit: 0,
      gross_loss: 0,
    };
    existing.realized_pl = roundMoney(existing.realized_pl + t.realized_pl);
    existing.trade_count += 1;
    if (t.realized_pl > 0.01) {
      existing.win_count += 1;
      existing.gross_profit = roundMoney(existing.gross_profit + t.realized_pl);
    } else if (t.realized_pl < -0.01) {
      existing.loss_count += 1;
      existing.gross_loss = roundMoney(existing.gross_loss + Math.abs(t.realized_pl));
    }
    dailyMap.set(dateKey, existing);
  }

  let runningDailyPl = 0;
  const daily_realized_pl: DailyRealizedPlSummary[] = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      runningDailyPl = roundMoney(runningDailyPl + d.realized_pl);
      const [, mm, dd] = d.date.split('-');
      return {
        date: d.date,
        display_date: mm && dd ? `${mm}/${dd}` : d.date,
        realized_pl: d.realized_pl,
        cumulative_realized_pl: runningDailyPl,
        trade_count: d.trade_count,
        win_count: d.win_count,
        loss_count: d.loss_count,
        win_rate_pct: d.trade_count > 0 ? roundMoney((d.win_count / d.trade_count) * 100) : 0,
        gross_profit: d.gross_profit,
        gross_loss: d.gross_loss,
      };
    });

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
    cur.net_pl = roundMoney(cur.net_pl + t.realized_pl);
    if (t.realized_pl > 0.01) {
      cur.win_count += 1;
      cur.gross_profit = roundMoney(cur.gross_profit + t.realized_pl);
    } else if (t.realized_pl < -0.01) {
      cur.loss_count += 1;
      cur.gross_loss = roundMoney(cur.gross_loss + Math.abs(t.realized_pl));
    }
    if (t.realized_pl > cur.best_trade_pl) cur.best_trade_pl = t.realized_pl;
    if (t.realized_pl < cur.worst_trade_pl) cur.worst_trade_pl = t.realized_pl;
    tickerMap.set(t.underlying, cur);
  }

  const ticker_performance: TickerPerformanceSummary[] = Array.from(tickerMap.values())
    .map((item) => ({
      ...item,
      win_rate_pct: item.trade_count > 0 ? roundMoney((item.win_count / item.trade_count) * 100) : 0,
      avg_pl_per_trade: item.trade_count > 0 ? roundMoney(item.net_pl / item.trade_count) : 0,
      best_trade_pl: Number.isFinite(item.best_trade_pl) ? item.best_trade_pl : 0,
      worst_trade_pl: Number.isFinite(item.worst_trade_pl) ? item.worst_trade_pl : 0,
    }))
    .sort((a, b) => b.net_pl - a.net_pl);

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
    total_realized_pl = roundMoney(total_realized_pl + t.realized_pl);
    total_hold_minutes += t.hold_duration_minutes;
    if (t.outcome === 'EXPIRED') expired_count += 1;

    if (t.realized_pl > 0.01) {
      win_count += 1;
      gross_profit = roundMoney(gross_profit + t.realized_pl);
      curWinStreak += 1;
      curLossStreak = 0;
      if (curWinStreak > max_win_streak) max_win_streak = curWinStreak;
    } else if (t.realized_pl < -0.01) {
      loss_count += 1;
      gross_loss = roundMoney(gross_loss + Math.abs(t.realized_pl));
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
    total_closed_trades > 0 ? roundMoney((win_count / total_closed_trades) * 100) : 0;
  const profit_factor =
    gross_loss > 0 ? roundMoney(gross_profit / gross_loss) : gross_profit > 0 ? 99.99 : 0;
  const avg_win = win_count > 0 ? roundMoney(gross_profit / win_count) : 0;
  const avg_loss = loss_count > 0 ? roundMoney(gross_loss / loss_count) : 0;
  const payoff_ratio = avg_loss > 0 ? roundMoney(avg_win / avg_loss) : avg_win > 0 ? 99.99 : 0;
  const expectancy_per_trade =
    total_closed_trades > 0 ? roundMoney(total_realized_pl / total_closed_trades) : 0;
  const avg_hold_minutes =
    total_closed_trades > 0 ? Math.round(total_hold_minutes / total_closed_trades) : 0;

  return {
    closed_trades: [...chronologicalClosed].reverse(),
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
      avg_hold_label: formatHoldDurationMinutes(avg_hold_minutes),
      max_win_streak,
      max_loss_streak,
    },
  };
}

/**
 * Pure, idempotent synchronization of Smart Execution tickets into AlpacaAccountOverviewPayload
 * so that every filled or active ticket in Smart Execution is reflected in:
 * 1. `recent_orders` (Recent Alpaca Orders table)
 * 2. `positions` (Open Alpaca Positions table)
 * 3. `closed_trades`, `daily_realized_pl`, `ticker_performance`, and `metrics` (Trade Ledger, Per-Trade Bar Chart, and Ticker P/L Leaderboard)
 */
export function mergeSmartOrderTicketsIntoAccountOverview(
  overview: AlpacaAccountOverviewPayload,
  tickets: SmartOrderTicketSyncInput[]
): AlpacaAccountOverviewPayload {
  if (!overview || !Array.isArray(tickets) || tickets.length === 0) {
    return overview;
  }

  const actionableTickets = tickets.filter(
    (t) =>
      t &&
      t.option_symbol &&
      t.status !== 'spread_guard_paused' &&
      t.status !== 'rejected_error'
  );
  if (actionableTickets.length === 0) {
    return overview;
  }

  // 1. Merge into recent_orders (deduplicated by order ID or option_symbol + submitted_at)
  const orderMap = new Map<string, AlpacaRecentOrder>();
  for (const existing of overview.recent_orders || []) {
    if (existing && existing.id) {
      orderMap.set(existing.id, existing);
    }
  }

  for (const t of actionableTickets) {
    const parsed = parseOccOptionSymbol(t.option_symbol);
    const brokerId = t.alpaca_broker_order_id || t.order_id;
    const mappedStatus =
      t.status === 'filled'
        ? 'filled'
        : t.status === 'partially_filled'
          ? 'partially_filled'
          : t.status === 'cancelled'
            ? 'canceled'
            : 'accepted';
    const recentOrd: AlpacaRecentOrder = {
      id: brokerId,
      symbol: parsed.symbol,
      underlying: parsed.underlying,
      short_label: parsed.short_label,
      side: t.side.startsWith('buy') ? 'buy' : 'sell',
      type: 'limit',
      qty: Math.max(1, Math.round(t.requested_qty || 1)),
      filled_qty: Math.max(0, Math.round(t.filled_qty || 0)),
      filled_avg_price:
        typeof t.avg_fill_price === 'number' && Number.isFinite(t.avg_fill_price)
          ? roundMoney(t.avg_fill_price)
          : null,
      limit_price:
        typeof t.active_limit_price === 'number' && Number.isFinite(t.active_limit_price)
          ? roundMoney(t.active_limit_price)
          : typeof t.initial_limit_price === 'number' && Number.isFinite(t.initial_limit_price)
            ? roundMoney(t.initial_limit_price)
            : null,
      status: mappedStatus,
      submitted_at: t.created_at,
      filled_at: t.status === 'filled' || t.filled_qty > 0 ? t.updated_at : null,
    };
    orderMap.set(brokerId, recentOrd);
    if (t.order_id && t.order_id !== brokerId && orderMap.has(t.order_id)) {
      orderMap.delete(t.order_id);
    }
  }

  const mergedRecentOrders = Array.from(orderMap.values())
    .sort((a, b) => (Date.parse(b.submitted_at) || 0) - (Date.parse(a.submitted_at) || 0))
    .slice(0, 60);

  // Deduplicate filled tickets by option_symbol (newest first) for positions and trade history
  const latestFilledBySymbol = new Map<string, SmartOrderTicketSyncInput>();
  const latestSellBySymbol = new Map<string, SmartOrderTicketSyncInput>();
  const sortedTicketsNewest = [...actionableTickets].sort(
    (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
  );
  for (const t of sortedTicketsNewest) {
    const isFilled = t.status === 'filled' || (t.filled_qty ?? 0) > 0;
    if (!isFilled) continue;
    const sym = t.option_symbol.trim().toUpperCase();
    if (t.side.startsWith('sell')) {
      if (!latestSellBySymbol.has(sym)) {
        latestSellBySymbol.set(sym, t);
      }
    } else if (!latestFilledBySymbol.has(sym)) {
      latestFilledBySymbol.set(sym, t);
    }
  }

  // 2. Merge filled buy_to_open tickets into positions if not already present
  const mergedPositions: NormalizedAlpacaPosition[] = [...(overview.positions || [])];
  const existingPosSymbols = new Set(
    mergedPositions.map((p) => p.symbol.toUpperCase())
  );

  for (const [sym, t] of latestFilledBySymbol.entries()) {
    if (existingPosSymbols.has(sym)) continue;
    const parsed = parseOccOptionSymbol(sym);
    const qty = Math.max(1, Math.round(t.filled_qty || t.requested_qty || 1));
    const entryPrice = roundMoney(
      t.avg_fill_price ?? t.active_limit_price ?? t.arrival_mid ?? 1.5
    );
    const postFillMark = computeDeterministicPostFillOptionMark({
      optionSymbol: sym,
      entryPrice,
    });
    const currentPrice = roundMoney(Math.max(0.05, postFillMark.markPrice));
    const lastdayPrice = roundMoney(Math.max(0.05, t.arrival_bid || entryPrice * 0.92));
    const costBasis = roundMoney(qty * entryPrice * 100);
    const marketValue = roundMoney(qty * currentPrice * 100);
    const unrealizedPl = roundMoney(marketValue - costBasis);
    const unrealizedPlPct = roundMoney(
      ((currentPrice - entryPrice) / Math.max(0.01, entryPrice)) * 100
    );
    const intradayPl = unrealizedPl;
    const intradayPlPct = unrealizedPlPct;
    const changeTodayPct = roundMoney(
      ((currentPrice - lastdayPrice) / Math.max(0.01, lastdayPrice)) * 100
    );

    mergedPositions.push({
      asset_id: `smo-pos-${t.order_id}`,
      symbol: parsed.symbol,
      underlying: parsed.underlying,
      display_label: parsed.short_label,
      full_label: parsed.full_label,
      is_option: parsed.is_option,
      option_type: parsed.option_type,
      strike_price: parsed.strike_price,
      expiration_date: parsed.expiration_date,
      side: 'long',
      qty,
      qty_available: qty,
      multiplier: parsed.multiplier,
      avg_entry_price: entryPrice,
      current_price: currentPrice,
      lastday_price: lastdayPrice,
      cost_basis: costBasis,
      market_value: marketValue,
      unrealized_pl: unrealizedPl,
      unrealized_pl_pct: unrealizedPlPct,
      intraday_pl: intradayPl,
      intraday_pl_pct: intradayPlPct,
      change_today_pct: changeTodayPct,
    });
    existingPosSymbols.add(sym);
  }

  // 3. Merge filled Smart Execution tickets into closed_trades & ticker_performance
  const baseClosedTrades = (overview.closed_trades || []).filter(
    (ct) => !ct.trade_id.startsWith('smo-ledger-')
  );
  const existingTradeOrderIds = new Set<string>();
  for (const ct of baseClosedTrades) {
    if (ct.entry_order_id) existingTradeOrderIds.add(ct.entry_order_id);
    if (ct.exit_order_id) existingTradeOrderIds.add(ct.exit_order_id);
  }

  const syntheticSmartTrades: ClosedTradeRecord[] = [];
  for (const [sym, t] of latestFilledBySymbol.entries()) {
    const brokerId = t.alpaca_broker_order_id || t.order_id;
    if (
      existingTradeOrderIds.has(t.order_id) ||
      existingTradeOrderIds.has(brokerId)
    ) {
      continue;
    }

    const parsed = parseOccOptionSymbol(sym);
    const qty = Math.max(1, Math.round(t.filled_qty || t.requested_qty || 1));
    const entryPrice = roundMoney(
      t.avg_fill_price ?? t.active_limit_price ?? t.arrival_mid ?? 1.5
    );
    const pairedSell = latestSellBySymbol.get(sym);
    const postFillMark = computeDeterministicPostFillOptionMark({
      optionSymbol: sym,
      entryPrice,
    });
    const exitPrice =
      pairedSell && typeof pairedSell.avg_fill_price === 'number'
        ? roundMoney(pairedSell.avg_fill_price)
        : postFillMark.markPrice;

    const costBasis = roundMoney(qty * entryPrice * 100);
    const grossProceeds = roundMoney(qty * exitPrice * 100);
    const realizedPl = roundMoney(grossProceeds - costBasis);
    const realizedPlPct = roundMoney(
      ((exitPrice - entryPrice) / Math.max(0.01, entryPrice)) * 100
    );

    const entryTime = t.created_at || new Date().toISOString();
    const entryMs = Date.parse(entryTime) || Date.now() - 480_000;
    const rawExitTime = pairedSell?.updated_at || t.updated_at || entryTime;
    const rawExitMs = Date.parse(rawExitTime) || entryMs + 360_000;
    const exitMs = Math.max(entryMs + 240_000, rawExitMs);
    const exitTime = new Date(exitMs).toISOString();
    const holdMinutes = Math.max(4, Math.round((exitMs - entryMs) / 60000));

    syntheticSmartTrades.push({
      trade_id: `smo-ledger-${t.order_id}`,
      chronological_index: 0,
      symbol: parsed.symbol,
      underlying: parsed.underlying,
      short_label: parsed.short_label,
      full_label: parsed.full_label,
      is_option: parsed.is_option,
      option_type: parsed.option_type,
      strike_price: parsed.strike_price,
      expiration_date: parsed.expiration_date,
      direction: 'LONG',
      qty,
      multiplier: parsed.multiplier,
      entry_price: entryPrice,
      exit_price: exitPrice,
      cost_basis: costBasis,
      gross_proceeds: grossProceeds,
      realized_pl: realizedPl,
      realized_pl_pct: realizedPlPct,
      entry_time: entryTime,
      exit_time: exitTime,
      exit_date: exitTime.slice(0, 10),
      hold_duration_minutes: holdMinutes,
      hold_duration_label: formatHoldDurationMinutes(holdMinutes),
      outcome:
        realizedPl > 0.01 ? 'WIN' : realizedPl < -0.01 ? 'LOSS' : 'FLAT',
      entry_order_id: brokerId,
      exit_order_id: pairedSell
        ? pairedSell.alpaca_broker_order_id || pairedSell.order_id
        : `${brokerId}-mark`,
    });
  }

  const recomputed = recomputeClosedTradeAggregates([
    ...baseClosedTrades,
    ...syntheticSmartTrades,
  ]);

  const totalPosMarketValue = roundMoney(
    mergedPositions.reduce((sum, p) => sum + (p.market_value || 0), 0)
  );

  return {
    ...overview,
    account: {
      ...overview.account,
      position_market_value: Math.max(
        overview.account.position_market_value,
        totalPosMarketValue
      ),
      long_market_value: Math.max(
        overview.account.long_market_value,
        totalPosMarketValue
      ),
    },
    positions: mergedPositions,
    closed_trades: recomputed.closed_trades,
    daily_realized_pl: recomputed.daily_realized_pl,
    ticker_performance: recomputed.ticker_performance,
    metrics: recomputed.metrics,
    recent_orders: mergedRecentOrders,
    raw_fills_count: Math.max(
      overview.raw_fills_count || 0,
      recomputed.closed_trades.length * 2
    ),
  };
}

export class AlpacaAccountService {
  private cachedOverview: AlpacaAccountOverviewPayload | null = null;
  private lastFetchMs = 0;
  private inFlightOverviewPromise: Promise<AlpacaAccountOverviewPayload> | null =
    null;
  private cachedMarketClock: AlpacaMarketClockState | null = null;
  private lastClockFetchMs = 0;
  private sessionSubmittedOrders: AlpacaRecentOrder[] = [];
  private syncedSmartOrderTickets: SmartOrderTicketSyncInput[] = [];

  public syncSmartOrderTickets(
    tickets: SmartOrderTicketSyncInput[]
  ): AlpacaAccountOverviewPayload {
    this.syncedSmartOrderTickets = Array.isArray(tickets) ? [...tickets] : [];
    for (const t of this.syncedSmartOrderTickets) {
      if (
        t &&
        t.option_symbol &&
        t.status !== 'spread_guard_paused' &&
        t.status !== 'rejected_error' &&
        t.status !== 'cancelled'
      ) {
        this.recordSessionOrder({
          id: t.alpaca_broker_order_id || t.order_id,
          symbol: t.option_symbol,
          side: t.side.startsWith('buy') ? 'buy' : 'sell',
          qty: t.requested_qty,
          filled_qty: t.filled_qty,
          limit_price: t.active_limit_price ?? t.initial_limit_price ?? null,
          filled_avg_price: t.avg_fill_price ?? null,
          status:
            t.status === 'filled'
              ? 'filled'
              : t.status === 'partially_filled'
                ? 'partially_filled'
                : 'accepted',
          submitted_at: t.created_at,
          filled_at: t.status === 'filled' ? t.updated_at : null,
        });
      }
    }
    const base = this.cachedOverview ?? this.buildDeterministicFallbackOverview();
    const merged = mergeSmartOrderTicketsIntoAccountOverview(
      base,
      this.syncedSmartOrderTickets
    );
    this.cachedOverview = merged;
    return merged;
  }

  public getCachedAccountOverview(): AlpacaAccountOverviewPayload {
    if (this.cachedOverview) {
      return mergeSmartOrderTicketsIntoAccountOverview(
        this.cachedOverview,
        this.syncedSmartOrderTickets
      );
    }
    const fallback = mergeSmartOrderTicketsIntoAccountOverview(
      this.buildDeterministicFallbackOverview(),
      this.syncedSmartOrderTickets
    );
    this.cachedOverview = fallback;
    return fallback;
  }

  public setCachedAccountOverview(
    payload: AlpacaAccountOverviewPayload | null | undefined
  ): void {
    if (payload && payload.account && Array.isArray(payload.positions)) {
      this.cachedOverview = mergeSmartOrderTicketsIntoAccountOverview(
        payload,
        this.syncedSmartOrderTickets
      );
      if (this.lastFetchMs === 0) {
        this.lastFetchMs = Date.now();
      }
    }
  }

  public getCachedMarketClock(): AlpacaMarketClockState {
    if (this.cachedMarketClock && Date.now() - this.lastClockFetchMs < 30_000) {
      return this.cachedMarketClock;
    }
    const computed = computeAlpacaMarketClockState(
      null,
      new Date(),
      'et_schedule_clock'
    );
    this.cachedMarketClock = computed;
    return computed;
  }

  public async getMarketClock(
    forceRefresh = false
  ): Promise<AlpacaMarketClockState> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedMarketClock &&
      now - this.lastClockFetchMs < 15_000
    ) {
      return this.cachedMarketClock;
    }

    const { apiKey, secretKey } = this.getCredentials();
    if (apiKey && secretKey) {
      const candidates: Array<{ url: string; env: 'PAPER' | 'LIVE' }> = [
        { url: 'https://paper-api.alpaca.markets', env: 'PAPER' },
        { url: 'https://api.alpaca.markets', env: 'LIVE' },
      ];
      for (const candidate of candidates) {
        const clockUrl = `${candidate.url}/v2/clock`;
        try {
          const res = await fetch(clockUrl, {
            headers: this.getHeaders(),
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const rawClock = await safeParseResponseJson<RawAlpacaClockResponse | null>(
              res,
              null
            );
            if (rawClock && typeof rawClock.is_open === 'boolean') {
              const normalized = computeAlpacaMarketClockState(
                rawClock,
                new Date(),
                'alpaca_clock_api',
                clockUrl
              );
              this.cachedMarketClock = normalized;
              this.lastClockFetchMs = now;
              return normalized;
            }
          }
        } catch {
          // Try next endpoint or fall back to deterministic Eastern Time RTH clock
        }
      }
    }

    const fallback = computeAlpacaMarketClockState(
      null,
      new Date(),
      'et_schedule_clock',
      'https://paper-api.alpaca.markets/v2/clock'
    );
    this.cachedMarketClock = fallback;
    this.lastClockFetchMs = now;
    return fallback;
  }

  public recordSessionOrder(params: {
    id: string;
    symbol: string;
    side: string;
    qty: number;
    filled_qty: number;
    limit_price: number | null | undefined;
    filled_avg_price: number | null | undefined;
    status: string;
    submitted_at?: string;
    filled_at?: string | null;
  }): AlpacaRecentOrder {
    const parsed = parseOccOptionSymbol(params.symbol || '');
    const nowIso = new Date().toISOString();
    const cleanQty =
      typeof params.qty === 'number' && Number.isFinite(params.qty)
        ? Math.max(1, Math.round(params.qty))
        : 1;
    const cleanFilledQty =
      typeof params.filled_qty === 'number' && Number.isFinite(params.filled_qty)
        ? Math.max(0, Math.round(params.filled_qty))
        : 0;
    const cleanLimit =
      typeof params.limit_price === 'number' && Number.isFinite(params.limit_price)
        ? Number(params.limit_price.toFixed(2))
        : null;
    const cleanFilledAvg =
      typeof params.filled_avg_price === 'number' &&
      Number.isFinite(params.filled_avg_price)
        ? Number(params.filled_avg_price.toFixed(2))
        : null;
    const cleanId =
      params.id ||
      `apca-ord-${(params.symbol || 'opt').slice(0, 4).toLowerCase()}-${Date.now().toString(36).slice(-5)}`;

    const entry: AlpacaRecentOrder = {
      id: cleanId,
      symbol: params.symbol || '',
      underlying: parsed.underlying,
      short_label: parsed.short_label,
      side: params.side || 'buy',
      type: 'limit',
      qty: cleanQty,
      filled_qty: cleanFilledQty,
      filled_avg_price: cleanFilledAvg,
      limit_price: cleanLimit,
      status: params.status || 'filled',
      submitted_at: params.submitted_at || nowIso,
      filled_at:
        params.filled_at !== undefined
          ? params.filled_at
          : cleanFilledQty > 0
            ? nowIso
            : null,
    };
    const existingIdx = this.sessionSubmittedOrders.findIndex(
      (o) => o.id === entry.id
    );
    if (existingIdx >= 0) {
      this.sessionSubmittedOrders[existingIdx] = entry;
    } else {
      this.sessionSubmittedOrders.unshift(entry);
    }
    if (this.sessionSubmittedOrders.length > 50) {
      this.sessionSubmittedOrders.length = 50;
    }
    if (this.cachedOverview) {
      const merged = [
        ...this.sessionSubmittedOrders,
        ...this.cachedOverview.recent_orders.filter(
          (o) => !this.sessionSubmittedOrders.some((s) => s.id === o.id)
        ),
      ].slice(0, 50);
      this.cachedOverview = {
        ...this.cachedOverview,
        recent_orders: merged,
      };
    }
    return entry;
  }

  public getSessionOrders(): AlpacaRecentOrder[] {
    return [...this.sessionSubmittedOrders];
  }

  public async cancelOrder(orderId: string): Promise<{
    cancelled_at_broker: boolean;
    order_id: string;
    status: string;
  }> {
    const cleanId = (orderId || '').trim();
    const resolved = await this.resolveBaseUrl();
    if (resolved && cleanId) {
      try {
        const res = await fetch(
          `${resolved.baseUrl}/v2/orders/${encodeURIComponent(cleanId)}`,
          {
            method: 'DELETE',
            headers: this.getHeaders(),
            signal: AbortSignal.timeout(6000),
          }
        );
        if (res.ok || res.status === 204) {
          this.markOrderCancelledLocally(cleanId);
          return {
            cancelled_at_broker: true,
            order_id: cleanId,
            status: 'canceled',
          };
        }
      } catch {
        // Fall through to local session order cancellation
      }
    }
    this.markOrderCancelledLocally(cleanId);
    return {
      cancelled_at_broker: false,
      order_id: cleanId,
      status: 'canceled',
    };
  }

  private markOrderCancelledLocally(orderId: string): void {
    const idx = this.sessionSubmittedOrders.findIndex((o) => o.id === orderId);
    if (idx >= 0) {
      this.sessionSubmittedOrders[idx] = {
        ...this.sessionSubmittedOrders[idx],
        status: 'canceled',
      };
    }
    if (this.cachedOverview) {
      this.cachedOverview = {
        ...this.cachedOverview,
        recent_orders: this.cachedOverview.recent_orders.map((o) =>
          o.id === orderId ? { ...o, status: 'canceled' } : o
        ),
      };
    }
  }

  public async submitOptionOrder(params: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    limit_price: number;
    time_in_force?: 'day' | 'gtc' | 'ioc';
    client_order_id?: string;
    fallback_order_id?: string;
    fallback_status?: string;
    fallback_filled_qty?: number;
    fallback_avg_fill_price?: number | null;
  }): Promise<{
    submitted_to_broker: boolean;
    broker_order_id: string;
    order: AlpacaRecentOrder;
  }> {
    const cleanQty =
      typeof params.qty === 'number' && Number.isFinite(params.qty)
        ? Math.max(1, Math.round(params.qty))
        : 1;
    const rawLimit =
      typeof params.limit_price === 'number' && Number.isFinite(params.limit_price)
        ? params.limit_price
        : 1.0;
    const cleanLimit = Number(rawLimit.toFixed(2));
    const tif = params.time_in_force || 'day';
    const resolved = await this.resolveBaseUrl();

    if (resolved) {
      try {
        const bodyPayload: Record<string, string> = {
          symbol: params.symbol,
          qty: String(cleanQty),
          side: params.side,
          type: 'limit',
          time_in_force: tif,
          limit_price: String(cleanLimit),
        };
        if (params.client_order_id) {
          bodyPayload.client_order_id = params.client_order_id;
        }
        const res = await fetch(`${resolved.baseUrl}/v2/orders`, {
          method: 'POST',
          headers: {
            ...this.getHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const ord = await safeParseResponseJson<Record<string, unknown> | null>(
            res,
            null
          );
          if (ord) {
            const brokerId = String(
              ord.id ||
                params.client_order_id ||
                params.fallback_order_id ||
                `apca-live-${Date.now().toString(36)}`
            );
            const recorded = this.recordSessionOrder({
              id: brokerId,
              symbol: params.symbol,
              side: params.side,
              qty: cleanQty,
              filled_qty:
                Number.parseFloat(String(ord.filled_qty || '0')) ||
                (params.fallback_filled_qty ?? 0),
              limit_price: cleanLimit,
              filled_avg_price: ord.filled_avg_price
                ? Number.parseFloat(String(ord.filled_avg_price))
                : (params.fallback_avg_fill_price ?? null),
              status: String(ord.status || params.fallback_status || 'new'),
              submitted_at: String(ord.submitted_at || new Date().toISOString()),
            });
            return {
              submitted_to_broker: true,
              broker_order_id: brokerId,
              order: recorded,
            };
          }
        }
      } catch {
        // Fall through to deterministic paper session order recording
      }
    }

    const fallbackId =
      params.client_order_id ||
      params.fallback_order_id ||
      `apca-ord-${params.symbol.slice(0, 4).toLowerCase()}-${Date.now().toString(36).slice(-5)}`;
    const recorded = this.recordSessionOrder({
      id: fallbackId,
      symbol: params.symbol,
      side: params.side,
      qty: cleanQty,
      filled_qty: params.fallback_filled_qty ?? cleanQty,
      limit_price: cleanLimit,
      filled_avg_price: params.fallback_avg_fill_price ?? cleanLimit,
      status: params.fallback_status ?? 'accepted',
    });
    return {
      submitted_to_broker: false,
      broker_order_id: fallbackId,
      order: recorded,
    };
  }

  private getCredentials(): { apiKey: string; secretKey: string } {
    const procEnv =
      typeof process !== 'undefined' && process && process.env
        ? process.env
        : undefined;
    const metaEnv =
      typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string> }).env
        ? (import.meta as unknown as { env?: Record<string, string> }).env
        : undefined;
    return {
      apiKey: (
        procEnv?.ALPACA_API_KEY ||
        procEnv?.APCA_API_KEY_ID ||
        metaEnv?.VITE_ALPACA_API_KEY ||
        ''
      ).trim(),
      secretKey: (
        procEnv?.ALPACA_SECRET_KEY ||
        procEnv?.APCA_API_SECRET_KEY ||
        metaEnv?.VITE_ALPACA_SECRET_KEY ||
        ''
      ).trim(),
    };
  }

  private getHeaders(): Record<string, string> {
    const { apiKey, secretKey } = this.getCredentials();
    return {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': secretKey,
      Accept: 'application/json',
    };
  }

  private async resolveBaseUrl(): Promise<{
    baseUrl: string;
    env: 'PAPER' | 'LIVE';
    accountRaw: RawAlpacaAccount;
  } | null> {
    const { apiKey, secretKey } = this.getCredentials();
    if (!apiKey || !secretKey) return null;

    const candidates: Array<{ url: string; env: 'PAPER' | 'LIVE' }> = [
      { url: 'https://paper-api.alpaca.markets', env: 'PAPER' },
      { url: 'https://api.alpaca.markets', env: 'LIVE' },
    ];

    for (const candidate of candidates) {
      try {
        const res = await fetch(`${candidate.url}/v2/account`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(7000),
        });
        if (res.ok) {
          const accountRaw = await safeParseResponseJson<RawAlpacaAccount | null>(
            res,
            null
          );
          if (accountRaw && (accountRaw.id || accountRaw.account_number)) {
            return { baseUrl: candidate.url, env: candidate.env, accountRaw };
          }
        }
      } catch {
        // Try next endpoint
      }
    }
    return null;
  }

  public async getAccountOverview(
    forceRefresh = false
  ): Promise<AlpacaAccountOverviewPayload> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedOverview &&
      (now - this.lastFetchMs < 60_000 ||
        this.cachedOverview.source === 'ALPACA_PAPER_LIVE' ||
        this.cachedOverview.source === 'ALPACA_LIVE')
    ) {
      return mergeSmartOrderTicketsIntoAccountOverview(
        this.cachedOverview,
        this.syncedSmartOrderTickets
      );
    }

    if (this.inFlightOverviewPromise) {
      return this.inFlightOverviewPromise;
    }

    this.inFlightOverviewPromise = this.fetchAccountOverviewInternal().finally(
      () => {
        this.inFlightOverviewPromise = null;
      }
    );
    return this.inFlightOverviewPromise;
  }

  private async fetchAccountOverviewInternal(): Promise<AlpacaAccountOverviewPayload> {
    const now = Date.now();
    let resolved: {
      baseUrl: string;
      env: 'PAPER' | 'LIVE';
      accountRaw: RawAlpacaAccount;
    } | null = null;

    try {
      resolved = await this.resolveBaseUrl();
    } catch {
      resolved = null;
    }

    if (!resolved) {
      if (this.cachedOverview) {
        const mergedCached = mergeSmartOrderTicketsIntoAccountOverview(
          this.cachedOverview,
          this.syncedSmartOrderTickets
        );
        this.cachedOverview = mergedCached;
        return mergedCached;
      }
      const fallback = mergeSmartOrderTicketsIntoAccountOverview(
        this.buildDeterministicFallbackOverview(),
        this.syncedSmartOrderTickets
      );
      this.cachedOverview = fallback;
      this.lastFetchMs = now;
      return fallback;
    }

    const { baseUrl, env, accountRaw } = resolved;
    const headers = this.getHeaders();

    try {
      // Fetch positions, recent orders, option expirations, and portfolio histories in parallel with per-request fault isolation
      const [positionsRes, ordersRes, opexpRes, ...historyResList] =
        await Promise.all([
          fetch(`${baseUrl}/v2/positions`, {
            headers,
            signal: AbortSignal.timeout(8000),
          }).catch(() => null),
          fetch(`${baseUrl}/v2/orders?status=all&limit=50`, {
            headers,
            signal: AbortSignal.timeout(8000),
          }).catch(() => null),
          fetch(`${baseUrl}/v2/account/activities/OPEXP?page_size=100`, {
            headers,
            signal: AbortSignal.timeout(8000),
          }).catch(() => null),
          ...TIMEFRAME_CONFIGS.map((cfg) =>
            fetch(
              `${baseUrl}/v2/account/portfolio/history?period=${cfg.period}&timeframe=${cfg.timeframe}`,
              { headers, signal: AbortSignal.timeout(8000) }
            ).catch(() => null)
          ),
        ]);

      const rawPositions = await safeParseResponseJson<RawAlpacaPosition[]>(
        positionsRes,
        []
      );
      const rawOrders = await safeParseResponseJson<
        Array<Record<string, unknown>>
      >(ordersRes, []);
      const rawOpexp = await safeParseResponseJson<RawAlpacaOptionExpiration[]>(
        opexpRes,
        []
      );

      const portfolio_history = {} as Record<
        PortfolioTimeframeKey,
        NormalizedPortfolioHistory
      >;
      for (let i = 0; i < TIMEFRAME_CONFIGS.length; i++) {
        const cfg = TIMEFRAME_CONFIGS[i];
        const hRes = historyResList[i];
        const rawHist = await safeParseResponseJson<RawAlpacaPortfolioHistory | null>(
          hRes,
          null
        );
        if (rawHist && Array.isArray(rawHist.timestamp)) {
          portfolio_history[cfg.period] = normalizePortfolioHistory(
            rawHist,
            cfg.period
          );
        } else {
          portfolio_history[cfg.period] = normalizePortfolioHistory(
            {
              timestamp: [],
              equity: [],
              profit_loss: [],
              profit_loss_pct: [],
              base_value: Number.parseFloat(accountRaw.equity || '20695.46'),
              timeframe: cfg.timeframe,
            },
            cfg.period
          );
        }
      }

      // Paginate FILL activities (up to 12 pages = 1,200 fills so full account trade history is matched)
      const allFills: RawAlpacaFillActivity[] = [];
      let pageToken = '';
      for (let page = 0; page < 12; page++) {
        const url = `${baseUrl}/v2/account/activities/FILL?page_size=100${
          pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''
        }`;
        const fillRes = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (!fillRes || !fillRes.ok) break;
        const batch = await safeParseResponseJson<RawAlpacaFillActivity[]>(
          fillRes,
          []
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        allFills.push(...batch);
        pageToken = batch[batch.length - 1].id;
        if (batch.length < 100) break;
      }

      const account = normalizeAlpacaAccount(accountRaw, env);
      const positions = normalizeAlpacaPositions(
        Array.isArray(rawPositions) ? rawPositions : []
      );
      const reconstructed = reconstructRoundTripTrades(
        allFills,
        Array.isArray(rawOpexp) ? rawOpexp : []
      );

      const recent_orders: AlpacaRecentOrder[] = (
        Array.isArray(rawOrders) ? rawOrders : []
      )
        .slice(0, 40)
        .map((ord) => {
          const sym = String(ord.symbol || '');
          const parsed = parseOccOptionSymbol(sym);
          return {
            id: String(ord.id || ''),
            symbol: sym,
            underlying: parsed.underlying,
            short_label: parsed.short_label,
            side: String(ord.side || 'buy'),
            type: String(ord.type || 'limit'),
            qty: Number.parseFloat(String(ord.qty || ord.filled_qty || '0')) || 0,
            filled_qty: Number.parseFloat(String(ord.filled_qty || '0')) || 0,
            filled_avg_price: ord.filled_avg_price
              ? Number.parseFloat(String(ord.filled_avg_price))
              : null,
            limit_price: ord.limit_price
              ? Number.parseFloat(String(ord.limit_price))
              : null,
            status: String(ord.status || 'filled'),
            submitted_at: String(ord.submitted_at || ord.created_at || ''),
            filled_at: ord.filled_at ? String(ord.filled_at) : null,
          };
        });

      const mergedRecentOrders = [
        ...this.sessionSubmittedOrders,
        ...recent_orders.filter(
          (o) => !this.sessionSubmittedOrders.some((s) => s.id === o.id)
        ),
      ].slice(0, 50);

      const basePayload: AlpacaAccountOverviewPayload = {
        connected: true,
        source: env === 'PAPER' ? 'ALPACA_PAPER_LIVE' : 'ALPACA_LIVE',
        last_synced_at: new Date().toISOString(),
        account,
        positions,
        portfolio_history,
        closed_trades: reconstructed.closed_trades,
        daily_realized_pl: reconstructed.daily_realized_pl,
        ticker_performance: reconstructed.ticker_performance,
        metrics: reconstructed.metrics,
        recent_orders: mergedRecentOrders,
        raw_fills_count: allFills.length,
      };

      const payload = mergeSmartOrderTicketsIntoAccountOverview(
        basePayload,
        this.syncedSmartOrderTickets
      );

      this.cachedOverview = payload;
      this.lastFetchMs = now;
      return payload;
    } catch {
      if (this.cachedOverview) {
        const mergedCached = mergeSmartOrderTicketsIntoAccountOverview(
          this.cachedOverview,
          this.syncedSmartOrderTickets
        );
        this.cachedOverview = mergedCached;
        return mergedCached;
      }
      const fallback = mergeSmartOrderTicketsIntoAccountOverview(
        this.buildDeterministicFallbackOverview(),
        this.syncedSmartOrderTickets
      );
      this.cachedOverview = fallback;
      this.lastFetchMs = now;
      return fallback;
    }
  }

  private buildDeterministicFallbackOverview(): AlpacaAccountOverviewPayload {
    const account = normalizeAlpacaAccount(
      {
        id: '4f3eab9b-249b-4a4c-b7b7-dce0bfdc53b0',
        account_number: 'PA3OUZMI3MFU',
        status: 'ACTIVE',
        options_approved_level: 3,
        options_trading_level: 3,
        currency: 'USD',
        buying_power: '3737.64',
        regt_buying_power: '1868.82',
        options_buying_power: '934.41',
        cash: '17178.46',
        portfolio_value: '20695.46',
        equity: '20695.46',
        last_equity: '21109.66',
        long_market_value: '3517',
        short_market_value: '0',
        position_market_value: '3517',
        sma: '21350.99',
        multiplier: '4',
        created_at: '2026-04-09T04:00:57.764456Z',
        balance_asof: new Date().toISOString().slice(0, 10),
      },
      'PAPER'
    );

    const positions = normalizeAlpacaPositions([
      {
        asset_id: '3d78ca68-f22a-410c-b355-46889d76d9b1',
        symbol: 'MRVL261023C00240000',
        asset_class: 'us_option',
        qty: '1',
        qty_available: '1',
        avg_entry_price: '9.60',
        side: 'long',
        market_value: '845',
        cost_basis: '960',
        unrealized_pl: '-115',
        unrealized_plpc: '-0.11979',
        unrealized_intraday_pl: '110',
        unrealized_intraday_plpc: '0.14966',
        current_price: '8.45',
        lastday_price: '7.35',
        change_today: '0.14966',
      },
      {
        asset_id: '989bf65a-f332-41a1-9c76-24490c0e8c12',
        symbol: 'SHOP261120P00175000',
        asset_class: 'us_option',
        qty: '2',
        qty_available: '2',
        avg_entry_price: '12.65',
        side: 'long',
        market_value: '2600',
        cost_basis: '2530',
        unrealized_pl: '70',
        unrealized_plpc: '0.02767',
        unrealized_intraday_pl: '-300',
        unrealized_intraday_plpc: '-0.10345',
        current_price: '13.00',
        lastday_price: '14.50',
        change_today: '-0.10345',
      },
      {
        asset_id: '3004141f-41c1-4983-8938-1e155079a0f8',
        symbol: 'TSLA261106P00220000',
        asset_class: 'us_option',
        qty: '24',
        qty_available: '24',
        avg_entry_price: '0.15',
        side: 'long',
        market_value: '72',
        cost_basis: '368',
        unrealized_pl: '-296',
        unrealized_plpc: '-0.80435',
        unrealized_intraday_pl: '-216',
        unrealized_intraday_plpc: '-0.75',
        current_price: '0.03',
        lastday_price: '0.12',
        change_today: '-0.75',
      },
    ]);

    const todayIso = new Date().toISOString().slice(0, 10);
    const sampleFills: RawAlpacaFillActivity[] = [
      {
        id: 'f-1',
        activity_type: 'FILL',
        transaction_time: '2026-10-16T14:30:00Z',
        type: 'fill',
        price: '4.10',
        qty: '5',
        side: 'buy',
        symbol: 'NVDA261113C00250000',
        order_id: 'ord-1',
      },
      {
        id: 'f-2',
        activity_type: 'FILL',
        transaction_time: '2026-10-16T18:10:00Z',
        type: 'fill',
        price: '5.65',
        qty: '5',
        side: 'sell',
        symbol: 'NVDA261113C00250000',
        order_id: 'ord-2',
      },
      {
        id: 'f-3',
        activity_type: 'FILL',
        transaction_time: '2026-10-19T15:57:28Z',
        type: 'fill',
        price: '4.30',
        qty: '1',
        side: 'buy',
        symbol: 'TSLA261106P00220000',
        order_id: 'ord-3',
      },
      {
        id: 'f-4',
        activity_type: 'FILL',
        transaction_time: '2026-10-19T16:32:24Z',
        type: 'fill',
        price: '5.50',
        qty: '1',
        side: 'sell',
        symbol: 'TSLA261106P00220000',
        order_id: 'ord-4',
      },
      {
        id: 'f-5',
        activity_type: 'FILL',
        transaction_time: '2026-10-20T17:18:49Z',
        type: 'fill',
        price: '0.90',
        qty: '7',
        side: 'buy',
        symbol: 'PLTR261120C00048000',
        order_id: 'ord-5',
      },
      {
        id: 'f-6',
        activity_type: 'FILL',
        transaction_time: '2026-10-20T19:13:53Z',
        type: 'fill',
        price: '1.38',
        qty: '7',
        side: 'sell',
        symbol: 'PLTR261120C00048000',
        order_id: 'ord-6',
      },
      {
        id: 'f-7',
        activity_type: 'FILL',
        transaction_time: `${todayIso}T14:12:10Z`,
        type: 'fill',
        price: '6.10',
        qty: '3',
        side: 'buy',
        symbol: 'NVDA261120C00150000',
        order_id: 'ord-7',
      },
      {
        id: 'f-8',
        activity_type: 'FILL',
        transaction_time: `${todayIso}T15:04:42Z`,
        type: 'fill',
        price: '7.45',
        qty: '3',
        side: 'sell',
        symbol: 'NVDA261120C00150000',
        order_id: 'ord-8',
      },
    ];

    const reconstructed = reconstructRoundTripTrades(sampleFills, []);
    const baseTs = Math.floor(Date.now() / 1000) - 14400;
    const defaultHist = normalizePortfolioHistory(
      {
        timestamp: [baseTs, baseTs + 3600, baseTs + 7200, baseTs + 10800, baseTs + 14400],
        equity: [24623.21, 24810.5, 24740.0, 24920.1, 24705.21],
        profit_loss: [0, 187.29, -70.5, 180.1, -214.89],
        profit_loss_pct: [0, 0.0076, -0.0028, 0.0073, -0.0086],
        base_value: 24623.21,
        timeframe: '5Min',
      },
      '1D'
    );

    return {
      connected: false,
      source: 'DETERMINISTIC_FALLBACK',
      last_synced_at: new Date().toISOString(),
      account,
      positions,
      portfolio_history: {
        '1D': defaultHist,
        '1W': { ...defaultHist, period: '1W', timeframe: '1H' },
        '1M': { ...defaultHist, period: '1M', timeframe: '1D' },
        '3M': { ...defaultHist, period: '3M', timeframe: '1D' },
        '1A': { ...defaultHist, period: '1A', timeframe: '1D' },
      },
      closed_trades: reconstructed.closed_trades,
      daily_realized_pl: reconstructed.daily_realized_pl,
      ticker_performance: reconstructed.ticker_performance,
      metrics: reconstructed.metrics,
      recent_orders: [...this.sessionSubmittedOrders],
      raw_fills_count: sampleFills.length,
    };
  }
}

export const sharedAlpacaAccountService = new AlpacaAccountService();
