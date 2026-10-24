import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Download,
  Search,
  TrendingUp,
  TrendingDown,
  Wallet,
  BarChart3,
  Activity,
  Award,
  Layers,
  Filter,
} from 'lucide-react';
import type {
  ClosedTradeRecord,
  DailyRealizedPlSummary,
  PortfolioTimeframeKey,
} from '../engine/alpacaAccountEngine';
import {
  type AlpacaAccountOverviewPayload,
  type SmartOrderTicketSyncInput,
  mergeSmartOrderTicketsIntoAccountOverview,
  sharedAlpacaAccountService,
} from '../engine/alpacaAccountService';

interface AlpacaAccountViewProps {
  initialData?: AlpacaAccountOverviewPayload | null;
  smartOrderTickets?: SmartOrderTicketSyncInput[];
  onSelectTickerInScanner?: (ticker: string) => void;
}

type RegularChartMetricMode = 'cumulative_pl' | 'equity' | 'drawdown';
type DailyBarMode = 'portfolio_daily' | 'realized_daily';
type TradeBarWindow = 30 | 60 | 100 | 500;
type OutcomeFilter = 'ALL' | 'WIN' | 'LOSS' | 'EXPIRED';
type OptionTypeFilter = 'ALL' | 'CALL' | 'PUT';
type TradeSortKey = 'NEWEST' | 'HIGHEST_PL' | 'LOWEST_PL' | 'HOLD_TIME';
type LeaderboardSortKey = 'TOP_PROFIT' | 'BIGGEST_LOSS' | 'MOST_TRADES';

function formatCurrency(val: number | null | undefined, showSign = false): string {
  const safeVal = typeof val === 'number' && Number.isFinite(val) ? val : 0;
  const abs = Math.abs(safeVal);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (safeVal < -0.001) return `-$${formatted}`;
  if (showSign && safeVal > 0.001) return `+$${formatted}`;
  return `$${formatted}`;
}

function formatCompactCurrency(val: number | null | undefined, showSign = false): string {
  const safeVal = typeof val === 'number' && Number.isFinite(val) ? val : 0;
  const abs = Math.abs(safeVal);
  let numStr = '';
  if (abs >= 1_000_000) {
    numStr = `${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 10_000) {
    numStr = `${(abs / 1_000).toFixed(1)}k`;
  } else {
    numStr = abs.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  if (safeVal < -0.001) return `-$${numStr}`;
  if (showSign && safeVal > 0.001) return `+$${numStr}`;
  return `$${numStr}`;
}

function formatPct(val: number | null | undefined, showSign = true): string {
  const safeVal = typeof val === 'number' && Number.isFinite(val) ? val : 0;
  const abs = Math.abs(safeVal).toFixed(2);
  if (safeVal < -0.001) return `-${abs}%`;
  if (showSign && safeVal > 0.001) return `+${abs}%`;
  return `${abs}%`;
}

function formatTimestampShort(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[d.getUTCMonth()] || 'Oct';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mon} ${day}, ${hh}:${mm}`;
}

export const AlpacaAccountView: React.FC<AlpacaAccountViewProps> = ({
  initialData,
  smartOrderTickets,
  onSelectTickerInScanner,
}) => {
  const [rawData, setData] = useState<AlpacaAccountOverviewPayload | null>(
    () => initialData ?? sharedAlpacaAccountService.getCachedAccountOverview()
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!rawData) return null;
    if (!smartOrderTickets || smartOrderTickets.length === 0) return rawData;
    return mergeSmartOrderTicketsIntoAccountOverview(rawData, smartOrderTickets);
  }, [rawData, smartOrderTickets]);

  useEffect(() => {
    if (
      initialData &&
      initialData.account &&
      (!rawData ||
        (rawData.source === 'DETERMINISTIC_FALLBACK' &&
          initialData.source !== 'DETERMINISTIC_FALLBACK') ||
        initialData.last_synced_at > rawData.last_synced_at)
    ) {
      sharedAlpacaAccountService.setCachedAccountOverview(initialData);
      setData(initialData);
    }
  }, [initialData, rawData]);

  // Regular Intraday / Multi-Timeframe Chart state
  const [selectedTimeframe, setSelectedTimeframe] = useState<PortfolioTimeframeKey>('1D');
  const [regularMetricMode, setRegularMetricMode] = useState<RegularChartMetricMode>('cumulative_pl');
  const [hoverPointIndex, setHoverPointIndex] = useState<number | null>(null);

  // Day-over-Day Bar Chart state
  const [dailyBarMode, setDailyBarMode] = useState<DailyBarMode>('portfolio_daily');
  const [dailyPortfolioPeriod, setDailyPortfolioPeriod] = useState<'1M' | '3M' | '1A'>('1M');
  const [hoverDailyIndex, setHoverDailyIndex] = useState<number | null>(null);

  // Per-Trade Bar Chart state
  const [tradeBarWindow, setTradeBarWindow] = useState<TradeBarWindow>(60);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);

  // Trade Ledger & Ticker Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('ALL');
  const [optionTypeFilter, setOptionTypeFilter] = useState<OptionTypeFilter>('ALL');
  const [tradeSort, setTradeSort] = useState<TradeSortKey>('NEWEST');
  const [ledgerTab, setLedgerTab] = useState<'CLOSED_TRADES' | 'RECENT_ORDERS'>('CLOSED_TRADES');
  const [visibleRowLimit, setVisibleRowLimit] = useState<number>(30);
  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSortKey>('TOP_PROFIT');

  const tryParseOverviewResponse = async (
    res: Response | null
  ): Promise<AlpacaAccountOverviewPayload | null> => {
    if (!res || !res.ok) return null;
    try {
      const rawText = await res.text();
      const trimmed = rawText.trim();
      if (!trimmed || trimmed.startsWith('<') || !trimmed.startsWith('{')) {
        return null;
      }
      const parsed = JSON.parse(trimmed) as AlpacaAccountOverviewPayload;
      if (parsed && parsed.account && Array.isArray(parsed.positions)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchAccountData = async (force = false) => {
    try {
      if (force) setRefreshing(true);
      else if (!data) setLoading(true);
      setError(null);

      const endpoint = force
        ? '/api/alpaca/account-overview/refresh'
        : '/api/alpaca/account-overview';
      const res = await fetch(endpoint, {
        method: force ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
      }).catch(() => null);

      const parsedPrimary = await tryParseOverviewResponse(res);
      if (parsedPrimary) {
        sharedAlpacaAccountService.setCachedAccountOverview(parsedPrimary);
        setData(parsedPrimary);
        return;
      }

      if (force) {
        const getRes = await fetch('/api/alpaca/account-overview?refresh=true', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }).catch(() => null);
        const parsedGet = await tryParseOverviewResponse(getRes);
        if (parsedGet) {
          sharedAlpacaAccountService.setCachedAccountOverview(parsedGet);
          setData(parsedGet);
          return;
        }
      }

      const fallbackPayload =
        await sharedAlpacaAccountService.getAccountOverview(force);
      setData(fallbackPayload);
    } catch {
      const cached = sharedAlpacaAccountService.getCachedAccountOverview();
      setData((prev) => prev ?? cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchAccountData(false);
  }, []);

  // Filtered closed trades for both Per-Trade Bar Chart and Trade Ledger
  const filteredClosedTrades = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toUpperCase();
    const list = data.closed_trades.filter((t) => {
      if (q && !t.underlying.includes(q) && !t.short_label.toUpperCase().includes(q) && !t.symbol.includes(q)) {
        return false;
      }
      if (outcomeFilter !== 'ALL' && t.outcome !== outcomeFilter) {
        return false;
      }
      if (optionTypeFilter !== 'ALL' && t.option_type !== optionTypeFilter) {
        return false;
      }
      return true;
    });

    if (tradeSort === 'HIGHEST_PL') {
      return [...list].sort((a, b) => b.realized_pl - a.realized_pl);
    }
    if (tradeSort === 'LOWEST_PL') {
      return [...list].sort((a, b) => a.realized_pl - b.realized_pl);
    }
    if (tradeSort === 'HOLD_TIME') {
      return [...list].sort((a, b) => b.hold_duration_minutes - a.hold_duration_minutes);
    }
    return list; // Already newest first
  }, [data, searchQuery, outcomeFilter, optionTypeFilter, tradeSort]);

  const filteredRecentOrders = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toUpperCase();
    if (!q) return data.recent_orders;
    return data.recent_orders.filter(
      (ord) =>
        ord.symbol.toUpperCase().includes(q) ||
        ord.short_label.toUpperCase().includes(q)
    );
  }, [data, searchQuery]);

  // Chronological slice for the Per-Trade P/L Bar Chart
  const perTradeChartItems = useMemo(() => {
    const chrono = [...filteredClosedTrades].sort(
      (a, b) => a.chronological_index - b.chronological_index
    );
    return chrono.slice(-tradeBarWindow);
  }, [filteredClosedTrades, tradeBarWindow]);

  const inspectedTrade: ClosedTradeRecord | null = useMemo(() => {
    if (!perTradeChartItems.length) return null;
    if (selectedTradeId) {
      const found = perTradeChartItems.find((t) => t.trade_id === selectedTradeId);
      if (found) return found;
    }
    return perTradeChartItems[perTradeChartItems.length - 1];
  }, [perTradeChartItems, selectedTradeId]);

  // Day-over-Day Bar Chart series
  const dailyBarSeries = useMemo(() => {
    if (!data) return [];
    if (dailyBarMode === 'portfolio_daily') {
      const hist = data.portfolio_history[dailyPortfolioPeriod] || data.portfolio_history['1M'];
      return (hist?.points || []).map((pt) => ({
        date: pt.date_key,
        label: pt.label,
        pl: pt.bar_pl,
        pl_pct: pt.bar_pl_pct,
        cumulative_pl: pt.cumulative_pl,
        equity: pt.equity,
        meta: `Equity ${formatCurrency(pt.equity)}`,
      }));
    }
    // realized_daily from closed trades
    return data.daily_realized_pl.slice(-45).map((d: DailyRealizedPlSummary) => ({
      date: d.date,
      label: d.display_date,
      pl: d.realized_pl,
      pl_pct: d.win_rate_pct,
      cumulative_pl: d.cumulative_realized_pl,
      equity: 0,
      meta: `${d.trade_count} trades (${d.win_count}W/${d.loss_count}L)`,
    }));
  }, [data, dailyBarMode, dailyPortfolioPeriod]);

  const dailySummaryStats = useMemo(() => {
    if (!dailyBarSeries.length) {
      return {
        winDays: 0,
        lossDays: 0,
        netPl: 0,
        bestDay: null as (typeof dailyBarSeries)[0] | null,
        worstDay: null as (typeof dailyBarSeries)[0] | null,
      };
    }
    let winDays = 0;
    let lossDays = 0;
    let netPl = 0;
    let bestDay = dailyBarSeries[0];
    let worstDay = dailyBarSeries[0];
    for (const item of dailyBarSeries) {
      netPl += item.pl;
      if (item.pl > 0.01) winDays += 1;
      else if (item.pl < -0.01) lossDays += 1;
      if (item.pl > bestDay.pl) bestDay = item;
      if (item.pl < worstDay.pl) worstDay = item;
    }
    return { winDays, lossDays, netPl, bestDay, worstDay };
  }, [dailyBarSeries]);

  const sortedTickerLeaderboard = useMemo(() => {
    if (!data) return [];
    const list = [...data.ticker_performance];
    if (leaderboardSort === 'BIGGEST_LOSS') {
      return list.sort((a, b) => a.net_pl - b.net_pl);
    }
    if (leaderboardSort === 'MOST_TRADES') {
      return list.sort((a, b) => b.trade_count - a.trade_count);
    }
    return list.sort((a, b) => b.net_pl - a.net_pl);
  }, [data, leaderboardSort]);

  const handleExportCsv = () => {
    if (!filteredClosedTrades.length) return;
    const headers = [
      'Trade #',
      'Symbol',
      'Underlying',
      'Contract',
      'Type',
      'Qty',
      'Entry Price',
      'Exit Price',
      'Cost Basis ($)',
      'Gross Proceeds ($)',
      'Realized P/L ($)',
      'Realized P/L (%)',
      'Outcome',
      'Entry Time',
      'Exit Time',
      'Hold Duration',
    ];
    const rows = filteredClosedTrades.map((t) => [
      t.chronological_index,
      t.symbol,
      t.underlying,
      `"${t.full_label}"`,
      t.option_type || 'EQUITY',
      t.qty,
      (t.entry_price ?? 0).toFixed(2),
      (t.exit_price ?? 0).toFixed(2),
      (t.cost_basis ?? 0).toFixed(2),
      (t.gross_proceeds ?? 0).toFixed(2),
      (t.realized_pl ?? 0).toFixed(2),
      (t.realized_pl_pct ?? 0).toFixed(2),
      t.outcome,
      t.entry_time,
      t.exit_time,
      `"${t.hold_duration_label}"`,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `alpaca_account_trades_pl_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-6 animate-pulse">
          <div className="h-6 w-64 bg-slate-800 rounded mb-3" />
          <div className="h-4 w-96 bg-slate-800/60 rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-4 h-28 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-[#0B101B] border border-slate-800/80 rounded-lg p-6 h-96 animate-pulse" />
          <div className="lg:col-span-5 bg-[#0B101B] border border-slate-800/80 rounded-lg p-6 h-96 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="bg-[#0B101B] border border-rose-500/40 rounded-lg p-6 text-slate-200">
          <h2 className="text-lg font-semibold text-white mb-2">Alpaca Account Connection Error</h2>
          <p className="text-sm text-slate-400 mb-4">{error || 'Unable to load account overview.'}</p>
          <button
            type="button"
            onClick={() => fetchAccountData(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors"
          >
            Retry Account Sync
          </button>
        </div>
      </div>
    );
  }

  const { account, positions, metrics } = data;
  const activeHistory =
    data.portfolio_history[selectedTimeframe] || data.portfolio_history['1D'];
  const historyPoints = activeHistory?.points || [];
  const activeHoverPoint =
    hoverPointIndex !== null && historyPoints[hoverPointIndex]
      ? historyPoints[hoverPointIndex]
      : historyPoints[historyPoints.length - 1] || null;

  const totalUnrealizedPl = positions.reduce((acc, p) => acc + p.unrealized_pl, 0);
  const totalIntradayPosPl = positions.reduce((acc, p) => acc + p.intraday_pl, 0);

  // Regular chart SVG coordinates
  const chartW = 760;
  const chartH = 230;
  const padL = 58;
  const padR = 18;
  const padT = 18;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const seriesValues = historyPoints.map((pt) => {
    if (regularMetricMode === 'equity') return pt.equity;
    if (regularMetricMode === 'drawdown') return pt.drawdown_pct;
    return pt.cumulative_pl;
  });

  const minValRaw = seriesValues.length ? Math.min(...seriesValues) : 0;
  const maxValRaw = seriesValues.length ? Math.max(...seriesValues) : 100;
  const minVal =
    regularMetricMode === 'cumulative_pl' ? Math.min(0, minValRaw) : minValRaw;
  const maxVal =
    regularMetricMode === 'cumulative_pl' ? Math.max(0, maxValRaw) : maxValRaw;
  const valSpan = Math.max(1e-3, maxVal - minVal);

  const getX = (idx: number) =>
    historyPoints.length <= 1
      ? padL + plotW / 2
      : padL + (idx / (historyPoints.length - 1)) * plotW;
  const getY = (v: number) => padT + plotH - ((v - minVal) / valSpan) * plotH;
  const zeroY = getY(regularMetricMode === 'equity' ? activeHistory.base_value : 0);
  const clampedZeroY = Math.max(padT, Math.min(padT + plotH, zeroY));

  const polylinePoints = historyPoints
    .map((_, idx) => `${getX(idx).toFixed(1)},${getY(seriesValues[idx]).toFixed(1)}`)
    .join(' ');

  const areaPath =
    historyPoints.length > 1
      ? `M ${getX(0).toFixed(1)} ${clampedZeroY.toFixed(1)} L ${historyPoints
          .map((_, idx) => `${getX(idx).toFixed(1)} ${getY(seriesValues[idx]).toFixed(1)}`)
          .join(' L ')} L ${getX(historyPoints.length - 1).toFixed(1)} ${clampedZeroY.toFixed(1)} Z`
      : '';

  const isPositiveTrajectory =
    regularMetricMode === 'drawdown'
      ? false
      : (seriesValues[seriesValues.length - 1] ?? 0) >=
        (regularMetricMode === 'equity' ? activeHistory.base_value : 0);

  const strokeColor =
    regularMetricMode === 'drawdown'
      ? '#F43F5E'
      : isPositiveTrajectory
      ? '#10B981'
      : '#F43F5E';

  // Day-over-day bar chart SVG math
  const dailyChartW = 620;
  const dailyChartH = 230;
  const dPadL = 54;
  const dPadR = 14;
  const dPadT = 18;
  const dPadB = 28;
  const dPlotW = dailyChartW - dPadL - dPadR;
  const dPlotH = dailyChartH - dPadT - dPadB;
  const maxAbsDailyPl = Math.max(
    100,
    ...dailyBarSeries.map((d) => Math.abs(d.pl))
  );
  const dZeroY = dPadT + dPlotH / 2;

  const activeDailyHover =
    hoverDailyIndex !== null && dailyBarSeries[hoverDailyIndex]
      ? dailyBarSeries[hoverDailyIndex]
      : dailyBarSeries[dailyBarSeries.length - 1] || null;

  // Per-trade bar chart SVG math
  const tradeChartW = 920;
  const tradeChartH = 220;
  const tPadL = 56;
  const tPadR = 16;
  const tPadT = 16;
  const tPadB = 28;
  const tPlotW = tradeChartW - tPadL - tPadR;
  const tPlotH = tradeChartH - tPadT - tPadB;
  const maxAbsTradePl = Math.max(
    100,
    ...perTradeChartItems.map((t) => Math.abs(t.realized_pl))
  );
  const tZeroY = tPadT + tPlotH / 2;

  return (
    <div className="space-y-5">
      {/* Section 1: Account Header & Live Controls */}
      <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-1">
            <span className="font-mono text-slate-200 font-semibold">
              Account {account.account_number}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {data.source === 'ALPACA_PAPER_LIVE'
                ? 'Alpaca Paper Trading v2 (Live API)'
                : data.source === 'ALPACA_LIVE'
                ? 'Alpaca Live Brokerage v2'
                : 'Fallback Snapshot'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Status: {account.status}</span>
            <span aria-hidden="true">·</span>
            <span>Options Tier: Level {account.options_level}</span>
            <span aria-hidden="true">·</span>
            <span>Margin Multiplier: {account.multiplier}x</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              Synced {formatTimestampShort(data.last_synced_at)}
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Alpaca Portfolio, P/L Curves & Trade Performance Ledger
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md hover:bg-amber-500/20 transition-colors whitespace-nowrap"
            >
              Clear Filter: {searchQuery.toUpperCase()}
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            Export Trade P/L CSV ({filteredClosedTrades.length})
          </button>
          <button
            type="button"
            onClick={() => fetchAccountData(true)}
            disabled={refreshing}
            className="px-3.5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Syncing Alpaca...' : 'Refresh Account Data'}
          </button>
        </div>
      </div>

      {/* Section 2: 6-Card Account & P/L KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {/* KPI 1: Net Account Equity */}
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="truncate">Net Account Equity</span>
            <Wallet className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-white">
            {formatCurrency(account.equity)}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span className="text-slate-400">Day P/L</span>
            <span
              className={
                account.day_pl >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'
              }
            >
              {formatCurrency(account.day_pl, true)} ({formatPct(account.day_pl_pct)})
            </span>
          </div>
        </div>

        {/* KPI 2: Cash & Buying Power */}
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="truncate">Cash & Buying Power</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-white">
            {formatCurrency(account.cash)}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span className="text-slate-400">Buying Pwr</span>
            <span className="text-slate-200">{formatCurrency(account.buying_power)}</span>
          </div>
        </div>

        {/* KPI 3: Open Positions & Unrealized P/L */}
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="truncate">Open Unrealized P/L</span>
            {totalUnrealizedPl >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            )}
          </div>
          <div
            className={`text-xl font-bold font-mono tabular-nums ${
              totalUnrealizedPl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatCurrency(totalUnrealizedPl, true)}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span className="text-slate-400">{positions.length} Open Mkt</span>
            <span className="text-slate-200">
              {formatCurrency(account.position_market_value)}
            </span>
          </div>
        </div>

        {/* KPI 4: Period Portfolio P/L (Selected Timeframe) */}
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="truncate">{selectedTimeframe} Portfolio P/L</span>
            <Activity className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          </div>
          <div
            className={`text-xl font-bold font-mono tabular-nums ${
              activeHistory.net_pl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatCurrency(activeHistory.net_pl, true)}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span className="text-slate-400">Ret / Max DD</span>
            <span className="text-slate-200">
              {formatPct(activeHistory.net_pl_pct)} / -{(activeHistory.max_drawdown_pct ?? 0).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* KPI 5: Closed Trade Win Rate & Profit Factor */}
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="truncate">Win Rate ({metrics.total_closed_trades})</span>
            <BarChart3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-white whitespace-nowrap">
            {(metrics.win_rate_pct ?? 0).toFixed(1)}%
            <span className="text-xs font-normal text-slate-400 ml-1.5">
              ({metrics.win_count}W/{metrics.loss_count}L)
            </span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span className="text-slate-400">PF / Payoff</span>
            <span className="text-slate-200">
              {(metrics.profit_factor ?? 0).toFixed(2)}x · {(metrics.payoff_ratio ?? 0).toFixed(2)}R
            </span>
          </div>
        </div>

        {/* KPI 6: Avg Win vs Loss & Best Trade */}
        <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="truncate">Avg Win vs Avg Loss</span>
            <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          </div>
          <div className="text-base font-bold font-mono tabular-nums flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
            <span className="text-emerald-400">+{formatCompactCurrency(metrics.avg_win)}</span>
            <span className="text-slate-500">/</span>
            <span className="text-rose-400">-{formatCompactCurrency(metrics.avg_loss)}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums whitespace-nowrap">
            <span className="text-slate-400">Best Trade</span>
            <span className="text-emerald-400 truncate">
              {metrics.best_trade
                ? `${metrics.best_trade.underlying} ${formatCompactCurrency(metrics.best_trade.realized_pl, true)}`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Section 3: Main Charts Row - Intraday/Multi-Timeframe Regular Chart + Day-over-Day P/L Bar Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left 7 Cols: Intraday or Different Timeframe Regular P/L & Equity Chart */}
        <div className="xl:col-span-7 bg-[#0B101B] border border-slate-800/80 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-800/80">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Intraday & Multi-Timeframe Portfolio P/L Curve
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Alpaca Portfolio History ({activeHistory.period} · {activeHistory.timeframe} resolution · Base{' '}
                  <span className="font-mono text-slate-300">
                    {formatCurrency(activeHistory.base_value)}
                  </span>
                  )
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Timeframe Selector */}
                <div
                  className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
                  role="group"
                  aria-label="Portfolio history timeframe"
                >
                  {(['1D', '1W', '1M', '3M', '1A'] as PortfolioTimeframeKey[]).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => {
                        setSelectedTimeframe(tf);
                        setHoverPointIndex(null);
                      }}
                      className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap ${
                        selectedTimeframe === tf
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Metric Mode Selector */}
                <div
                  className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
                  role="group"
                  aria-label="Chart metric mode"
                >
                  <button
                    type="button"
                    onClick={() => setRegularMetricMode('cumulative_pl')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      regularMetricMode === 'cumulative_pl'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    P/L ($)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegularMetricMode('equity')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      regularMetricMode === 'equity'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Equity ($)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegularMetricMode('drawdown')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      regularMetricMode === 'drawdown'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Drawdown (%)
                  </button>
                </div>
              </div>
            </div>

            {/* Active Point Telemetry Bar */}
            {activeHoverPoint && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 py-3 border-b border-slate-800/50 text-xs font-mono tabular-nums">
                <div>
                  <span className="text-slate-400 block text-[11px]">Timestamp</span>
                  <span className="text-slate-200 font-semibold">{activeHoverPoint.label}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Account Equity</span>
                  <span className="text-white font-semibold">
                    {formatCurrency(activeHoverPoint.equity)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Cumulative P/L</span>
                  <span
                    className={
                      activeHoverPoint.cumulative_pl >= 0
                        ? 'text-emerald-400 font-semibold'
                        : 'text-rose-400 font-semibold'
                    }
                  >
                    {formatCurrency(activeHoverPoint.cumulative_pl, true)} (
                    {formatPct(activeHoverPoint.cumulative_pl_pct)})
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Interval Bar P/L</span>
                  <span
                    className={
                      activeHoverPoint.bar_pl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {formatCurrency(activeHoverPoint.bar_pl, true)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Drawdown from Peak</span>
                  <span className="text-rose-400">
                    {(activeHoverPoint.drawdown_pct ?? 0).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            {/* SVG Regular Line / Area Chart */}
            <div className="mt-3 relative select-none">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-60 overflow-visible"
                role="img"
                aria-label={`Alpaca ${selectedTimeframe} portfolio ${regularMetricMode} chart`}
                onMouseLeave={() => setHoverPointIndex(null)}
              >
                <defs>
                  <linearGradient id="alpacaRegularGradPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="alpacaRegularGradNeg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#F43F5E" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Horizontal Y Gridlines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                  const y = padT + ratio * plotH;
                  const val = maxVal - ratio * valSpan;
                  const label =
                    regularMetricMode === 'drawdown'
                      ? `${val.toFixed(1)}%`
                      : formatCompactCurrency(val, regularMetricMode === 'cumulative_pl');
                  return (
                    <g key={idx}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke="#1E293B"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={padL - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* Baseline Reference */}
                <line
                  x1={padL}
                  y1={clampedZeroY}
                  x2={chartW - padR}
                  y2={clampedZeroY}
                  stroke="#475569"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />

                {/* Area Fill */}
                {areaPath && (
                  <path
                    d={areaPath}
                    fill={
                      regularMetricMode === 'drawdown' || !isPositiveTrajectory
                        ? 'url(#alpacaRegularGradNeg)'
                        : 'url(#alpacaRegularGradPos)'
                    }
                  />
                )}

                {/* Main Curve */}
                {polylinePoints && (
                  <polyline
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="2.2"
                    points={polylinePoints}
                  />
                )}

                {/* X-Axis Labels */}
                {historyPoints.map((pt, idx) => {
                  const total = historyPoints.length;
                  const step = Math.max(1, Math.floor(total / 5));
                  const isLast = idx === total - 1;
                  const isStep = idx % step === 0 && idx <= total - 1 - Math.ceil(step * 0.6);
                  if (!isStep && !isLast) return null;
                  return (
                    <text
                      key={pt.timestamp}
                      x={getX(idx)}
                      y={chartH - 6}
                      textAnchor={idx === 0 ? 'start' : isLast ? 'end' : 'middle'}
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {pt.label}
                    </text>
                  );
                })}

                {/* Active Hover Marker */}
                {hoverPointIndex !== null && historyPoints[hoverPointIndex] && (
                  <g>
                    <line
                      x1={getX(hoverPointIndex)}
                      y1={padT}
                      x2={getX(hoverPointIndex)}
                      y2={padT + plotH}
                      stroke="#94A3B8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <circle
                      cx={getX(hoverPointIndex)}
                      cy={getY(seriesValues[hoverPointIndex])}
                      r="4.5"
                      fill={strokeColor}
                      stroke="#0B101B"
                      strokeWidth="2"
                    />
                  </g>
                )}

                {/* Invisible Hover Columns */}
                {historyPoints.map((pt, idx) => {
                  const sliceW = plotW / Math.max(1, historyPoints.length);
                  return (
                    <rect
                      key={pt.timestamp}
                      x={getX(idx) - sliceW / 2}
                      y={padT}
                      width={Math.max(4, sliceW)}
                      height={plotH}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoverPointIndex(idx)}
                    />
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Bottom Period Summary Footer */}
          <div className="pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>
              Range Equity: {formatCurrency(activeHistory.low_equity)} —{' '}
              {formatCurrency(activeHistory.high_equity)}
            </span>
            <span>
              Positive Bars: {activeHistory.positive_periods} · Negative Bars:{' '}
              {activeHistory.negative_periods}
            </span>
            <span>
              Max Drawdown: -{formatCurrency(activeHistory.max_drawdown_dollars)} (-
              {(activeHistory.max_drawdown_pct ?? 0).toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Right 5 Cols: Day-over-Day P/L Bar Chart */}
        <div className="xl:col-span-5 bg-[#0B101B] border border-slate-800/80 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-800/80">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Day-over-Day P/L Bar Chart
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {dailyBarMode === 'portfolio_daily'
                    ? `Daily mark-to-market portfolio P/L (${dailyPortfolioPeriod})`
                    : 'Daily realized P/L from closed round-trip trades'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
                  role="group"
                  aria-label="Day over day P/L source"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDailyBarMode('portfolio_daily');
                      setHoverDailyIndex(null);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      dailyBarMode === 'portfolio_daily'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Portfolio Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDailyBarMode('realized_daily');
                      setHoverDailyIndex(null);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      dailyBarMode === 'realized_daily'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Realized Trades
                  </button>
                </div>

                {dailyBarMode === 'portfolio_daily' && (
                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md">
                    {(['1M', '3M', '1A'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setDailyPortfolioPeriod(p);
                          setHoverDailyIndex(null);
                        }}
                        className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                          dailyPortfolioPeriod === p
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Active Daily Bar Readout */}
            {activeDailyHover && (
              <div className="grid grid-cols-3 gap-3 py-3 border-b border-slate-800/50 text-xs font-mono tabular-nums">
                <div>
                  <span className="text-slate-400 block text-[11px]">Session Date</span>
                  <span className="text-slate-200 font-semibold">{activeDailyHover.date}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Day-over-Day P/L</span>
                  <span
                    className={
                      activeDailyHover.pl >= 0
                        ? 'text-emerald-400 font-semibold'
                        : 'text-rose-400 font-semibold'
                    }
                  >
                    {formatCurrency(activeDailyHover.pl, true)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Session Context</span>
                  <span className="text-slate-300">{activeDailyHover.meta}</span>
                </div>
              </div>
            )}

            {/* SVG Day-over-Day Bar Chart */}
            <div className="mt-3 relative select-none">
              <svg
                viewBox={`0 0 ${dailyChartW} ${dailyChartH}`}
                className="w-full h-60 overflow-visible"
                role="img"
                aria-label="Day over day P/L bar chart"
                onMouseLeave={() => setHoverDailyIndex(null)}
              >
                {/* Y Gridlines */}
                {[1, 0.5, 0, -0.5, -1].map((mult, idx) => {
                  const y = dZeroY - mult * (dPlotH / 2);
                  const val = mult * maxAbsDailyPl;
                  return (
                    <g key={idx}>
                      <line
                        x1={dPadL}
                        y1={y}
                        x2={dailyChartW - dPadR}
                        y2={y}
                        stroke={mult === 0 ? '#475569' : '#1E293B'}
                        strokeDasharray={mult === 0 ? undefined : '3 3'}
                        strokeWidth="1"
                      />
                      <text
                        x={dPadL - 6}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {formatCompactCurrency(val, mult !== 0)}
                      </text>
                    </g>
                  );
                })}

                {/* Daily Bars */}
                {dailyBarSeries.map((item, idx) => {
                  const count = Math.max(1, dailyBarSeries.length);
                  const slotW = dPlotW / count;
                  const barW = Math.max(2.5, Math.min(18, slotW * 0.72));
                  const x = dPadL + idx * slotW + (slotW - barW) / 2;
                  const ratio = Math.min(1, Math.abs(item.pl) / maxAbsDailyPl);
                  const barH = Math.max(2, ratio * (dPlotH / 2));
                  const y = item.pl >= 0 ? dZeroY - barH : dZeroY;
                  const isHovered = hoverDailyIndex === idx;

                  return (
                    <g
                      key={`${item.date}-${idx}`}
                      onMouseEnter={() => setHoverDailyIndex(idx)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={dPadL + idx * slotW}
                        y={dPadT}
                        width={slotW}
                        height={dPlotH}
                        fill="transparent"
                      />
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={barH}
                        rx="1.5"
                        fill={item.pl >= 0 ? '#10B981' : '#F43F5E'}
                        opacity={isHovered ? 1 : 0.85}
                      />
                    </g>
                  );
                })}

                {/* X-Axis Labels */}
                {dailyBarSeries.map((item, idx) => {
                  const total = dailyBarSeries.length;
                  const step = Math.max(1, Math.floor(total / 5));
                  const isLast = idx === total - 1;
                  const isStep = idx % step === 0 && idx <= total - 1 - Math.ceil(step * 0.6);
                  if (!isStep && !isLast) return null;
                  const slotW = dPlotW / Math.max(1, total);
                  const cx = dPadL + idx * slotW + slotW / 2;
                  return (
                    <text
                      key={`lbl-${item.date}-${idx}`}
                      x={cx}
                      y={dailyChartH - 6}
                      textAnchor={idx === 0 ? 'start' : isLast ? 'end' : 'middle'}
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {item.label}
                    </text>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Daily Summary Footer */}
          <div className="pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>
              Green Days: <strong className="text-emerald-400">{dailySummaryStats.winDays}</strong> ·
              Red Days: <strong className="text-rose-400">{dailySummaryStats.lossDays}</strong>
            </span>
            <span>
              Best:{' '}
              <strong className="text-emerald-400">
                {dailySummaryStats.bestDay
                  ? formatCompactCurrency(dailySummaryStats.bestDay.pl, true)
                  : '—'}
              </strong>{' '}
              · Worst:{' '}
              <strong className="text-rose-400">
                {dailySummaryStats.worstDay
                  ? formatCompactCurrency(dailySummaryStats.worstDay.pl, true)
                  : '—'}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Section 4: Per-Trade P/L Bar Chart (P/L of Each Trade) */}
      <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div>
            <h2 className="text-base font-semibold text-white">
              P/L of Each Trade — Chronological Round-Trip Execution Bar Chart
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Each vertical bar represents a single closed trade reconstructed via FIFO lot matching across{' '}
              <span className="font-mono text-slate-300">{data.raw_fills_count}</span> Alpaca option & equity fills. Click or hover any bar to inspect execution details.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Window:</span>
            <div
              className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
              role="group"
              aria-label="Per-trade bar chart window"
            >
              {([30, 60, 100, 500] as TradeBarWindow[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setTradeBarWindow(w)}
                  className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap ${
                    tradeBarWindow === w
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {w === 500 ? `All (${filteredClosedTrades.length})` : `Last ${w}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inspected Trade Detail Banner */}
        {inspectedTrade && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 py-3 border-b border-slate-800/50 text-xs font-mono tabular-nums">
            <div>
              <span className="text-slate-400 block text-[11px]">Trade # / Contract</span>
              <span className="text-white font-semibold">
                #{inspectedTrade.chronological_index} · {inspectedTrade.short_label}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Realized P/L ($)</span>
              <span
                className={
                  inspectedTrade.realized_pl >= 0
                    ? 'text-emerald-400 font-bold'
                    : 'text-rose-400 font-bold'
                }
              >
                {formatCurrency(inspectedTrade.realized_pl, true)} (
                {formatPct(inspectedTrade.realized_pl_pct)})
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Qty & Entry → Exit</span>
              <span className="text-slate-200">
                {inspectedTrade.qty}x @ ${(inspectedTrade.entry_price ?? 0).toFixed(2)} → $
                {(inspectedTrade.exit_price ?? 0).toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Cost Basis → Proceeds</span>
              <span className="text-slate-200">
                {formatCurrency(inspectedTrade.cost_basis)} →{' '}
                {formatCurrency(inspectedTrade.gross_proceeds)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Entry Timestamp</span>
              <span className="text-slate-300">
                {formatTimestampShort(inspectedTrade.entry_time)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Exit Timestamp</span>
              <span className="text-slate-300">
                {formatTimestampShort(inspectedTrade.exit_time)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Hold Time / Outcome</span>
              <span className="text-slate-200">
                {inspectedTrade.hold_duration_label} · {inspectedTrade.outcome}
              </span>
            </div>
          </div>
        )}

        {/* SVG Per-Trade Bar Chart */}
        <div className="mt-3 relative select-none">
          <svg
            viewBox={`0 0 ${tradeChartW} ${tradeChartH}`}
            className="w-full h-56 overflow-visible"
            role="img"
            aria-label="Per-trade realized P/L bar chart"
          >
            {[1, 0.5, 0, -0.5, -1].map((mult, idx) => {
              const y = tZeroY - mult * (tPlotH / 2);
              const val = mult * maxAbsTradePl;
              return (
                <g key={idx}>
                  <line
                    x1={tPadL}
                    y1={y}
                    x2={tradeChartW - tPadR}
                    y2={y}
                    stroke={mult === 0 ? '#475569' : '#1E293B'}
                    strokeDasharray={mult === 0 ? undefined : '3 3'}
                    strokeWidth="1"
                  />
                  <text
                    x={tPadL - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {formatCompactCurrency(val, mult !== 0)}
                  </text>
                </g>
              );
            })}

            {perTradeChartItems.map((trade, idx) => {
              const count = Math.max(1, perTradeChartItems.length);
              const slotW = tPlotW / count;
              const barW = Math.max(2, Math.min(14, slotW * 0.75));
              const x = tPadL + idx * slotW + (slotW - barW) / 2;
              const ratio = Math.min(1, Math.abs(trade.realized_pl) / maxAbsTradePl);
              const barH = Math.max(2, ratio * (tPlotH / 2));
              const y = trade.realized_pl >= 0 ? tZeroY - barH : tZeroY;
              const isSelected = inspectedTrade?.trade_id === trade.trade_id;

              return (
                <g
                  key={trade.trade_id}
                  onMouseEnter={() => setSelectedTradeId(trade.trade_id)}
                  onClick={() => setSelectedTradeId(trade.trade_id)}
                  className="cursor-pointer"
                >
                  <rect
                    x={tPadL + idx * slotW}
                    y={tPadT}
                    width={slotW}
                    height={tPlotH}
                    fill="transparent"
                  />
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx="1"
                    fill={trade.realized_pl >= 0 ? '#10B981' : '#F43F5E'}
                    opacity={isSelected ? 1 : 0.8}
                    stroke={isSelected ? '#F8FAFC' : 'none'}
                    strokeWidth={isSelected ? 1 : 0}
                  />
                </g>
              );
            })}

            {perTradeChartItems.map((trade, idx) => {
              const total = perTradeChartItems.length;
              const step = Math.max(1, Math.floor(total / 6));
              const isLast = idx === total - 1;
              const isStep = idx % step === 0 && idx <= total - 1 - Math.ceil(step * 0.65);
              if (!isStep && !isLast) return null;
              const slotW = tPlotW / Math.max(1, total);
              const cx = tPadL + idx * slotW + slotW / 2;
              return (
                <text
                  key={`tlbl-${trade.trade_id}`}
                  x={cx}
                  y={tradeChartH - 6}
                  textAnchor={idx === 0 ? 'start' : isLast ? 'end' : 'middle'}
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  #{trade.chronological_index} ({trade.underlying})
                </text>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Section 5: Active Open Positions + Underlying Ticker P/L Leaderboard */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left 6 Cols: Open Positions & Account Margin Breakdown */}
        <div className="xl:col-span-6 bg-[#0B101B] border border-slate-800/80 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Open Alpaca Positions ({positions.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time mark-to-market valuation, cost basis, intraday change, and unrealized P/L
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Mkt Value: <strong className="text-white">{formatCurrency(account.position_market_value)}</strong>
              </span>
            </div>

            {positions.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No open positions currently held in this Alpaca account.
              </div>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                      <th className="py-2 pr-3">Contract / Symbol</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2 text-right">Avg Entry</th>
                      <th className="py-2 px-2 text-right">Current</th>
                      <th className="py-2 px-2 text-right">Mkt Value</th>
                      <th className="py-2 px-2 text-right">Intraday P/L</th>
                      <th className="py-2 pl-2 text-right">Unrealized P/L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
                    {positions.map((pos) => (
                      <tr
                        key={pos.asset_id}
                        className="hover:bg-slate-900/60 transition-colors"
                      >
                        <td className="py-2.5 pr-3">
                          <button
                            type="button"
                            onClick={() => setSearchQuery(pos.underlying)}
                            className="text-left group"
                          >
                            <div className="font-semibold text-white group-hover:text-indigo-400 transition-colors">
                              {pos.display_label}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {pos.full_label} · {pos.side.toUpperCase()}
                            </div>
                          </button>
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-200">{pos.qty}</td>
                        <td className="py-2.5 px-2 text-right text-slate-300">
                          ${(pos.avg_entry_price ?? 0).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-white font-medium">
                          ${(pos.current_price ?? 0).toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-slate-200">
                          {formatCurrency(pos.market_value)}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right ${
                            pos.intraday_pl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatCurrency(pos.intraday_pl, true)} ({formatPct(pos.intraday_pl_pct)})
                        </td>
                        <td
                          className={`py-2.5 pl-2 text-right font-semibold ${
                            pos.unrealized_pl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatCurrency(pos.unrealized_pl, true)} ({formatPct(pos.unrealized_pl_pct)})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Account Balance & Margin Telemetry Grid */}
          <div className="mt-5 pt-4 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-300 mb-2.5">
              Account Capital, Margin & Risk Configuration
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
              <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-slate-400 block text-[11px]">Reg-T Buying Power</span>
                <span className="text-slate-200 font-semibold">
                  {formatCurrency(account.regt_buying_power)}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-slate-400 block text-[11px]">Options Buying Power</span>
                <span className="text-slate-200 font-semibold">
                  {formatCurrency(account.options_buying_power)}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-slate-400 block text-[11px]">Special Memo (SMA)</span>
                <span className="text-slate-200 font-semibold">
                  {formatCurrency(account.sma)}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-slate-400 block text-[11px]">Win / Loss Streak</span>
                <span className="text-slate-200 font-semibold">
                  Max {metrics.max_win_streak}W / {metrics.max_loss_streak}L
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right 6 Cols: Performance Breakdown by Underlying Ticker */}
        <div className="xl:col-span-6 bg-[#0B101B] border border-slate-800/80 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-slate-800/80">
            <div>
              <h2 className="text-base font-semibold text-white">
                P/L Breakdown by Underlying Ticker ({data.ticker_performance.length} Tickers)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Click any ticker row to filter the per-trade chart and trade ledger below
              </p>
            </div>

            <div
              className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
              role="group"
              aria-label="Sort ticker performance"
            >
              <button
                type="button"
                onClick={() => setLeaderboardSort('TOP_PROFIT')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  leaderboardSort === 'TOP_PROFIT'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Top Profit
              </button>
              <button
                type="button"
                onClick={() => setLeaderboardSort('BIGGEST_LOSS')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  leaderboardSort === 'BIGGEST_LOSS'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Biggest Drawdown
              </button>
              <button
                type="button"
                onClick={() => setLeaderboardSort('MOST_TRADES')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  leaderboardSort === 'MOST_TRADES'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Most Active
              </button>
            </div>
          </div>

          <div className="overflow-x-auto mt-3 max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2 pr-3">Ticker</th>
                  <th className="py-2 px-2 text-right">Trades</th>
                  <th className="py-2 px-2 text-right">Win Rate</th>
                  <th className="py-2 px-2 text-right">Gross Profit</th>
                  <th className="py-2 px-2 text-right">Gross Loss</th>
                  <th className="py-2 px-2 text-right">Avg P/L</th>
                  <th className="py-2 pl-2 text-right">Net Realized P/L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
                {sortedTickerLeaderboard.slice(0, 12).map((tk) => {
                  const isSelected = searchQuery.toUpperCase() === tk.underlying;
                  return (
                    <tr
                      key={tk.underlying}
                      onClick={() =>
                        setSearchQuery(isSelected ? '' : tk.underlying)
                      }
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-600/15 hover:bg-indigo-600/20'
                          : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <td className="py-2 pr-3 font-semibold text-white">
                        {tk.underlying}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300">
                        {tk.trade_count} ({tk.win_count}W/{tk.loss_count}L)
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200">
                        {(tk.win_rate_pct ?? 0).toFixed(1)}%
                      </td>
                      <td className="py-2 px-2 text-right text-emerald-400">
                        {formatCurrency(tk.gross_profit)}
                      </td>
                      <td className="py-2 px-2 text-right text-rose-400">
                        -{formatCurrency(tk.gross_loss)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          tk.avg_pl_per_trade >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatCurrency(tk.avg_pl_per_trade, true)}
                      </td>
                      <td
                        className={`py-2 pl-2 text-right font-semibold ${
                          tk.net_pl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatCurrency(tk.net_pl, true)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 6: Complete Trade-by-Trade P/L Ledger & Recent Alpaca Orders */}
      <div className="bg-[#0B101B] border border-slate-800/80 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLedgerTab('CLOSED_TRADES')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                ledgerTab === 'CLOSED_TRADES'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Closed Round-Trip Trades ({filteredClosedTrades.length})
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('RECENT_ORDERS')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                ledgerTab === 'RECENT_ORDERS'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Recent Alpaca Orders ({filteredRecentOrders.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search by Ticker / Contract */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter ticker (e.g. NVDA, AMD, META)..."
                aria-label="Filter trades by ticker or contract symbol"
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-52"
              />
            </div>

            {ledgerTab === 'CLOSED_TRADES' && (
              <>
                {/* Outcome Filter */}
                <div
                  className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
                  role="group"
                  aria-label="Filter trades by outcome"
                >
                  {(['ALL', 'WIN', 'LOSS', 'EXPIRED'] as OutcomeFilter[]).map((out) => (
                    <button
                      key={out}
                      type="button"
                      onClick={() => setOutcomeFilter(out)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        outcomeFilter === out
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {out === 'ALL'
                        ? 'All'
                        : out === 'WIN'
                        ? 'Winners'
                        : out === 'LOSS'
                        ? 'Losers'
                        : 'Expired'}
                    </button>
                  ))}
                </div>

                {/* Option Type Filter */}
                <div
                  className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md"
                  role="group"
                  aria-label="Filter trades by option type"
                >
                  {(['ALL', 'CALL', 'PUT'] as OptionTypeFilter[]).map((ot) => (
                    <button
                      key={ot}
                      type="button"
                      onClick={() => setOptionTypeFilter(ot)}
                      className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                        optionTypeFilter === ot
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {ot}
                    </button>
                  ))}
                </div>

                {/* Sort Select */}
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    aria-label="Sort closed trades"
                    value={tradeSort}
                    onChange={(e) => setTradeSort(e.target.value as TradeSortKey)}
                    className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="NEWEST">Sort: Newest Exit</option>
                    <option value="HIGHEST_PL">Sort: Highest Profit ($)</option>
                    <option value="LOWEST_PL">Sort: Biggest Loss ($)</option>
                    <option value="HOLD_TIME">Sort: Longest Hold</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {ledgerTab === 'CLOSED_TRADES' ? (
          <>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                    <th className="py-2.5 pr-3">#</th>
                    <th className="py-2.5 px-2">Contract / Symbol</th>
                    <th className="py-2.5 px-2">Type</th>
                    <th className="py-2.5 px-2 text-right">Qty</th>
                    <th className="py-2.5 px-2 text-right">Entry Price</th>
                    <th className="py-2.5 px-2 text-right">Exit Price</th>
                    <th className="py-2.5 px-2 text-right">Cost Basis</th>
                    <th className="py-2.5 px-2 text-right">Proceeds</th>
                    <th className="py-2.5 px-2 text-right">Realized P/L ($)</th>
                    <th className="py-2.5 px-2 text-right">Return (%)</th>
                    <th className="py-2.5 px-2 text-right">Hold Time</th>
                    <th className="py-2.5 pl-2 text-right">Exit Time (UTC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
                  {filteredClosedTrades.slice(0, visibleRowLimit).map((t) => (
                    <tr
                      key={t.trade_id}
                      onClick={() => setSelectedTradeId(t.trade_id)}
                      className={`cursor-pointer transition-colors ${
                        inspectedTrade?.trade_id === t.trade_id
                          ? 'bg-indigo-600/15 hover:bg-indigo-600/20'
                          : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <td className="py-2.5 pr-3 text-slate-400">#{t.chronological_index}</td>
                      <td className="py-2.5 px-2">
                        <div className="font-semibold text-white">{t.short_label}</div>
                        <div className="text-[11px] text-slate-400">{t.symbol}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={
                            t.option_type === 'CALL'
                              ? 'text-emerald-400'
                              : t.option_type === 'PUT'
                              ? 'text-rose-400'
                              : 'text-slate-300'
                          }
                        >
                          {t.option_type || 'EQUITY'}
                        </span>
                        <span className="text-slate-500"> · {t.outcome}</span>
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-200">{t.qty}</td>
                      <td className="py-2.5 px-2 text-right text-slate-300">
                        ${(t.entry_price ?? 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-200">
                        ${(t.exit_price ?? 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-300">
                        {formatCurrency(t.cost_basis)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-300">
                        {formatCurrency(t.gross_proceeds)}
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-semibold ${
                          t.realized_pl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatCurrency(t.realized_pl, true)}
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right ${
                          t.realized_pl_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatPct(t.realized_pl_pct)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-slate-300">
                        {t.hold_duration_label}
                      </td>
                      <td className="py-2.5 pl-2 text-right text-slate-400">
                        {formatTimestampShort(t.exit_time)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredClosedTrades.length > visibleRowLimit && (
              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
                <span>
                  Showing {visibleRowLimit} of {filteredClosedTrades.length} matching closed trades
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleRowLimit((prev) => prev + 50)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md transition-colors"
                  >
                    Load 50 More Trades
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleRowLimit(filteredClosedTrades.length)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
                  >
                    Show All ({filteredClosedTrades.length})
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 pr-3">Contract</th>
                  <th className="py-2.5 px-2">Side / Type</th>
                  <th className="py-2.5 px-2 text-right">Order Qty</th>
                  <th className="py-2.5 px-2 text-right">Filled Qty</th>
                  <th className="py-2.5 px-2 text-right">Fill / Limit Price</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 pl-2 text-right">Submitted At (UTC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-mono tabular-nums">
                {filteredRecentOrders.map((ord) => (
                  <tr key={ord.id || ord.symbol} className="hover:bg-slate-900/60 transition-colors">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-white">{ord.short_label}</div>
                      <div className="text-[11px] text-slate-400">{ord.symbol}</div>
                    </td>
                    <td className="py-2.5 px-2 uppercase text-slate-300">
                      <span
                        className={
                          ord.side === 'buy' ? 'text-emerald-400' : 'text-amber-400'
                        }
                      >
                        {ord.side}
                      </span>{' '}
                      · {ord.type}
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-300">{ord.qty ?? 0}</td>
                    <td className="py-2.5 px-2 text-right text-slate-200">{ord.filled_qty ?? 0}</td>
                    <td className="py-2.5 px-2 text-right text-slate-200">
                      {typeof ord.filled_avg_price === 'number' &&
                      Number.isFinite(ord.filled_avg_price)
                        ? `$${ord.filled_avg_price.toFixed(2)}`
                        : typeof ord.limit_price === 'number' &&
                          Number.isFinite(ord.limit_price)
                        ? `Lim $${ord.limit_price.toFixed(2)}`
                        : 'MKT'}
                    </td>
                    <td className="py-2.5 px-2 text-slate-300 uppercase">{ord.status}</td>
                    <td className="py-2.5 pl-2 text-right text-slate-400">
                      {formatTimestampShort(ord.submitted_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
