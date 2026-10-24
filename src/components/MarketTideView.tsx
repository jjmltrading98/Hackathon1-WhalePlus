import React, { useState, useEffect, useMemo } from 'react';
import {
  ADAPTIVE_FILTER_PROFILES,
  AdaptiveFilterProfileId,
  MarketTideRegime,
  REGIME_SCANNER_PROFILES,
  WhaleCandidate,
} from '../engine/whaleScannerEngine';
import {
  HistoricalTradingSessionSummary,
  MarketTideState,
} from '../engine/whalePipelineRuntime';
import { HistoricalDateCalendarPicker } from './HistoricalDateCalendarPicker';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Sliders,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

interface MarketTideViewProps {
  marketTide: MarketTideState;
  regimeAdaptiveEnabled: boolean;
  candidates: WhaleCandidate[];
  onSwitchRegime: (regime: MarketTideRegime) => Promise<void>;
  onSwitchAdaptiveProfile?: (
    profileId: AdaptiveFilterProfileId
  ) => Promise<void>;
  onToggleRegimeAdaptive: (enabled: boolean) => void;
  onSelectTickerInScanner: (ticker: string) => void;
  onInspectCandidateInScanner: (candidateId: string) => void;
  onSyncLatestSession?: () => Promise<void>;
  selectedSessionDate?: string;
  latestSessionDate?: string;
  availableSessions?: HistoricalTradingSessionSummary[];
  onSelectSessionDate?: (sessionDate: string) => void;
}

const KNOWN_ETFS = new Set([
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'SOXL',
  'SPCX',
  'SKHY',
  'TQQQ',
  'SQQQ',
  'ARKK',
  'SMH',
  'XLF',
  'XLE',
  'XLK',
]);

function formatVolCompact(volM: number, includePlus = false): string {
  const prefix = includePlus && volM >= 0 ? '+' : '';
  const abs = Math.abs(volM);
  if (abs > 0 && abs < 0.1) {
    return `${prefix}${(volM * 1000).toFixed(1)}K`;
  }
  if (abs >= 0.1 && abs < 1.0) {
    return `${prefix}${volM.toFixed(2)}M`;
  }
  return `${prefix}${volM.toFixed(1)}M`;
}

function formatPremCompact(premM: number, includePlus = false): string {
  const prefix = includePlus && premM >= 0 ? '+' : '';
  const abs = Math.abs(premM);
  if (abs > 0 && abs < 10) {
    return `${prefix}${premM.toFixed(1)}M`;
  }
  return `${prefix}${Math.round(premM)}M`;
}

const REGIME_LABELS: Record<
  MarketTideRegime,
  { title: string; badgeClass: string; textClass: string }
> = {
  strong_positive: {
    title: 'Strong Positive Tide',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    textClass: 'text-emerald-400',
  },
  strong_negative: {
    title: 'Strong Negative Tide',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    textClass: 'text-rose-400',
  },
  neutral: {
    title: 'Neutral / Flat Tide',
    badgeClass: 'bg-slate-700/40 text-slate-200 border-slate-600',
    textClass: 'text-slate-200',
  },
  mixed: {
    title: 'Mixed Tide',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    textClass: 'text-amber-400',
  },
  reversing: {
    title: 'Rapidly Reversing Tide',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
    textClass: 'text-sky-400',
  },
};

export const MarketTideView: React.FC<MarketTideViewProps> = ({
  marketTide,
  regimeAdaptiveEnabled,
  candidates,
  onSwitchRegime,
  onSwitchAdaptiveProfile,
  onToggleRegimeAdaptive,
  onSelectTickerInScanner,
  onInspectCandidateInScanner,
  onSyncLatestSession,
  selectedSessionDate = 'latest',
  latestSessionDate = '2026-10-21',
  availableSessions = [],
  onSelectSessionDate,
}) => {
  const fullSeries = marketTide.intraday_series;
  // null = pinned to the latest session minute (live right edge)
  const [pinnedMinuteIdx, setPinnedMinuteIdx] = useState<number | null>(null);
  const [timeframeWindow, setTimeframeWindow] = useState<'1D' | '30M' | '5M'>(
    '1D'
  );
  const [etfScope, setEtfScope] = useState<'All' | 'Common Only'>('All');
  const [syncingSession, setSyncingSession] = useState(false);

  const handleSyncLatest = async () => {
    if (syncingSession) return;
    setSyncingSession(true);
    try {
      if (onSelectSessionDate && selectedSessionDate !== 'latest') {
        onSelectSessionDate('latest');
      }
      if (onSyncLatestSession) {
        await onSyncLatestSession();
      } else {
        await fetch('/api/market/market-tide/sync', { method: 'POST' });
      }
      setPinnedMinuteIdx(null);
    } finally {
      setSyncingSession(false);
    }
  };

  useEffect(() => {
    const isHistorical =
      marketTide.data_source === 'historical_archive' ||
      (selectedSessionDate &&
        selectedSessionDate !== 'latest' &&
        selectedSessionDate !== latestSessionDate);
    if (!isHistorical && marketTide.data_source !== 'unusual_whales_live') {
      void handleSyncLatest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const series = useMemo(() => {
    if (timeframeWindow === '5M') {
      return fullSeries.slice(-Math.min(fullSeries.length, 6));
    }
    if (timeframeWindow === '30M') {
      return fullSeries.slice(-Math.min(fullSeries.length, 30));
    }
    return fullSeries;
  }, [fullSeries, timeframeWindow]);

  const selectedMinuteIdx =
    pinnedMinuteIdx !== null && pinnedMinuteIdx < series.length
      ? pinnedMinuteIdx
      : Math.max(series.length - 1, 0);

  const activePoint =
    series[Math.min(selectedMinuteIdx, Math.max(series.length - 1, 0))] ??
    series[0];
  const latestSessionPoint = fullSeries[fullSeries.length - 1] ?? activePoint;

  const filteredTopImpact = useMemo(() => {
    if (etfScope === 'Common Only') {
      return marketTide.top_net_impact.filter(
        (item) => !KNOWN_ETFS.has(item.ticker.toUpperCase())
      );
    }
    return marketTide.top_net_impact;
  }, [marketTide.top_net_impact, etfScope]);

  const maxImpactAbs = useMemo(() => {
    const vals = filteredTopImpact.map((i) => Math.abs(i.net_premium_m));
    return Math.max(...vals, 25);
  }, [filteredTopImpact]);

  const activeRegimeMeta = REGIME_LABELS[marketTide.regime];
  const activeProfileId: AdaptiveFilterProfileId =
    marketTide.active_filter_profile ?? 'risk_on_trend';
  const activeAdaptiveSpec =
    marketTide.active_adaptive_spec ??
    ADAPTIVE_FILTER_PROFILES[activeProfileId];
  const mktState = marketTide.market_state;
  const activeSpec =
    marketTide.active_filter_spec ??
    REGIME_SCANNER_PROFILES[marketTide.regime];

  // Compute SVG coordinates for the Market Tide chart
  const chartWidth = 760;
  const topHeight = 250;
  const volHeight = 95;
  const padLeft = 44;
  const padRight = 58;
  const plotW = chartWidth - padLeft - padRight;

  const spyValues = series.map((p) => p.spy_price);
  const rawSpyMin = Math.min(...spyValues);
  const rawSpyMax = Math.max(...spyValues);
  const spyPad = Math.max(0.25, (rawSpyMax - rawSpyMin) * 0.18);
  const spyMin = rawSpyMin - spyPad;
  const spyMax = rawSpyMax + spyPad;

  const premValues = series.flatMap((p) => [
    p.net_call_premium_m,
    p.net_put_premium_m,
    0,
  ]);
  const rawPremMin = Math.min(...premValues, -5);
  const rawPremMax = Math.max(...premValues, 5);
  const premPad = Math.max(4, (rawPremMax - rawPremMin) * 0.12);
  const premMin = rawPremMin - premPad;
  const premMax = rawPremMax + premPad;

  const volValues = series.map((p) => p.net_volume_m);
  const volAbsMax =
    Math.max(...volValues.map((v) => Math.abs(v)), 0.05) * 1.18;

  const getX = (idx: number) =>
    padLeft + (idx / Math.max(series.length - 1, 1)) * plotW;
  const getSpyY = (val: number) =>
    18 + ((spyMax - val) / Math.max(spyMax - spyMin, 0.01)) * (topHeight - 36);
  const getPremY = (val: number) =>
    18 +
    ((premMax - val) / Math.max(premMax - premMin, 1)) * (topHeight - 36);

  const volTop = topHeight + 26;
  const volZeroY =
    volTop +
    (volAbsMax / (volAbsMax * 2)) * (volHeight - 16);
  const getVolY = (val: number) =>
    volZeroY - (val / volAbsMax) * ((volHeight - 18) / 2);

  const spyPath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getSpyY(p.spy_price).toFixed(1)}`)
    .join(' ');
  const ncpPath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getPremY(p.net_call_premium_m).toFixed(1)}`)
    .join(' ');
  const nppPath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getPremY(p.net_put_premium_m).toFixed(1)}`)
    .join(' ');

  const volAreaPath =
    series.length > 0
      ? [
          `M ${getX(0).toFixed(1)} ${volZeroY.toFixed(1)}`,
          ...series.map(
            (p, i) => `L ${getX(i).toFixed(1)} ${getVolY(p.net_volume_m).toFixed(1)}`
          ),
          `L ${getX(series.length - 1).toFixed(1)} ${volZeroY.toFixed(1)}`,
          'Z',
        ].join(' ')
      : '';

  const zeroPremY = getPremY(0);
  const selectedX = getX(selectedMinuteIdx);

  return (
    <div className="space-y-6">
      {/* Global Indices & ETF Benchmarks Header Strip */}
      <section
        aria-label="Global Indices and ETF Benchmarks"
        className="p-4 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Market Data</span>
            <span>&gt;</span>
            <span className="text-sky-400 font-semibold">Market Tide</span>
            <span className="text-slate-600">·</span>
            <span
              className={`px-2 py-0.5 rounded border font-mono text-[11px] font-semibold ${
                marketTide.data_source === 'historical_archive'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              }`}
            >
              {marketTide.data_source === 'historical_archive'
                ? `Historical Session: ${marketTide.session_date}`
                : `Latest Session: ${marketTide.session_date ?? '2026-10-21'}`}{' '}
              ({latestSessionPoint?.timestamp_str ??
                marketTide.latest_timestamp_str ??
                'Live'}{' '}
              ET)
            </span>
            {onSelectSessionDate && (
              <HistoricalDateCalendarPicker
                selectedSessionDate={selectedSessionDate}
                latestSessionDate={latestSessionDate}
                availableSessions={availableSessions}
                onSelectSessionDate={onSelectSessionDate}
                compact
              />
            )}
            <button
              type="button"
              onClick={handleSyncLatest}
              disabled={syncingSession}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-sky-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3 h-3 ${syncingSession ? 'animate-spin' : ''}`}
              />
              <span>
                {syncingSession ? 'Syncing Session...' : 'Sync Latest Session'}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {marketTide.global_indices.map((idx) => {
              const isPos = idx.change_pct >= 0;
              return (
                <div
                  key={idx.name}
                  className="px-2.5 py-1 rounded bg-[#0B0F17] border border-slate-800/80 text-[11px] font-mono flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span className="text-slate-300 font-sans font-medium">
                    {idx.name}
                  </span>
                  <span
                    className={
                      isPos ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {isPos ? '+' : ''}
                    {idx.change_pct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 4 Benchmark ETF Sparkline Cards: SPY, QQQ, DIA, IWM */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {marketTide.benchmarks.map((bm) => {
            const isPos = bm.change_pct >= 0;
            const minS = Math.min(...bm.sparkline);
            const maxS = Math.max(...bm.sparkline);
            const pts = bm.sparkline
              .map((v, i) => {
                const x = (i / Math.max(bm.sparkline.length - 1, 1)) * 110;
                const y =
                  24 - ((v - minS) / Math.max(maxS - minS, 0.01)) * 20;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ');
            return (
              <div
                key={bm.ticker}
                className="p-3 rounded-md bg-[#0B0F17] flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-bold text-slate-100">
                    {bm.ticker}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-xs">
                    <span className="text-slate-200 font-semibold">
                      {bm.price.toFixed(2)}
                    </span>
                    <span
                      className={
                        isPos ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {isPos ? '+' : ''}
                      {bm.change_pct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 font-mono">
                    Volume: {bm.volume_label}
                  </div>
                </div>

                <svg
                  width="112"
                  height="28"
                  viewBox="0 0 112 28"
                  className="shrink-0 overflow-visible"
                >
                  <line
                    x1="0"
                    y1="14"
                    x2="110"
                    y2="14"
                    stroke="#334155"
                    strokeDasharray="2 2"
                    strokeWidth="1"
                  />
                  <polyline
                    fill="none"
                    stroke={isPos ? '#10B981' : '#F43F5E'}
                    strokeWidth="1.75"
                    points={pts}
                  />
                </svg>
              </div>
            );
          })}
        </div>
      </section>

      {/* Regime Switch Control & Rolling Market-Tide Features Bar */}
      {/* Adaptive Whale Scanner: Market-Regime State Machine & 6 Filter Profiles */}
      <section
        aria-label="Adaptive Market-Regime State Machine"
        className="p-4 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-400" />
              <h1 className="text-sm font-semibold text-slate-100">
                Adaptive Whale Scanner: Market-Regime Filter System (v2.0 State Machine)
              </h1>
              <span
                className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${activeRegimeMeta.badgeClass}`}
              >
                {activeAdaptiveSpec.market_regime} · {activeProfileId}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              State machine classifies Market Tide persistence, 0DTE equity/index pressure, SPY/QQQ/IWM GEX flip &amp; walls, and IV term structure to activate the matching filter profile.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#0B0F17] border border-slate-800 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={regimeAdaptiveEnabled}
              onChange={(e) => onToggleRegimeAdaptive(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 accent-sky-400"
            />
            <span className="font-medium">
              Auto-Configure Scanner Filters by Active Profile
            </span>
          </label>
        </div>

        {/* 6 State-Machine Filter Profiles (A through F) */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-300">
              Select Scanner State-Machine Filter Profile (A–F) —{' '}
              <span className="text-slate-400 font-normal">
                adjusts candidate filtering &amp; scoring without altering the live Market Tide chart
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono text-slate-400">
              <span>Simulate Tide Feed:</span>
              {(
                [
                  { id: 'strong_positive', label: 'Strong Positive' },
                  { id: 'strong_negative', label: 'Strong Negative' },
                  { id: 'neutral', label: 'Neutral' },
                  { id: 'reversing', label: 'Reversing' },
                ] as const
              ).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSwitchRegime(r.id)}
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                    marketTide.regime === r.id
                      ? 'bg-slate-800 text-sky-400 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
            {(
              [
                {
                  id: 'risk_on_trend' as AdaptiveFilterProfileId,
                  code: 'Profile A',
                  title: 'risk_on_trend',
                  sub: 'Bullish Tide + Pos GEX',
                  fallbackRegime: 'strong_positive' as MarketTideRegime,
                },
                {
                  id: 'risk_off_trend' as AdaptiveFilterProfileId,
                  code: 'Profile B',
                  title: 'risk_off_trend',
                  sub: 'Bearish Tide + Neg GEX',
                  fallbackRegime: 'strong_negative' as MarketTideRegime,
                },
                {
                  id: 'positive_gamma_range' as AdaptiveFilterProfileId,
                  code: 'Profile C',
                  title: 'positive_gamma_range',
                  sub: 'Pinned / Choppy +GEX',
                  fallbackRegime: 'neutral' as MarketTideRegime,
                },
                {
                  id: 'negative_gamma_expansion' as AdaptiveFilterProfileId,
                  code: 'Profile D',
                  title: 'negative_gamma_expansion',
                  sub: 'Squeeze / Breakdown -GEX',
                  fallbackRegime: 'mixed' as MarketTideRegime,
                },
                {
                  id: 'gamma_flip_transition' as AdaptiveFilterProfileId,
                  code: 'Profile E',
                  title: 'gamma_flip_transition',
                  sub: 'SPY within ±0.30% of Flip',
                  fallbackRegime: 'reversing' as MarketTideRegime,
                },
                {
                  id: 'volatility_stress' as AdaptiveFilterProfileId,
                  code: 'Profile F',
                  title: 'volatility_stress',
                  sub: 'IV Ratio >= 1.20 / Stress',
                  fallbackRegime: 'strong_negative' as MarketTideRegime,
                },
              ] as const
            ).map((prof) => {
              const isSelected = activeProfileId === prof.id;
              return (
                <button
                  key={prof.id}
                  type="button"
                  onClick={() =>
                    onSwitchAdaptiveProfile
                      ? onSwitchAdaptiveProfile(prof.id)
                      : onSwitchRegime(prof.fallbackRegime)
                  }
                  className={`p-2.5 rounded-md border text-left transition-colors ${
                    isSelected
                      ? 'bg-sky-950/45 border-sky-400 text-slate-100'
                      : 'bg-[#0B0F17] border-slate-800/90 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>{prof.code}</span>
                    {isSelected && (
                      <span className="text-sky-400 font-semibold">ACTIVE</span>
                    )}
                  </div>
                  <div className="text-xs font-mono font-bold text-sky-400 truncate mt-0.5">
                    {prof.title}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {prof.sub}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Market State Object Telemetry Cards (Tide + 0DTE + GEX + Volatility) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div className="p-3 rounded-md bg-[#0B0F17]">
            <div className="text-[11px] text-slate-400 font-mono">
              1. Tide Persistence (`market_tide`)
            </div>
            <div
              className={`mt-1 text-base font-bold font-mono tabular-nums ${
                marketTide.net_premium_5m >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              5m {marketTide.net_premium_5m >= 0 ? '+' : '-'}$
              {(Math.abs(marketTide.net_premium_5m) / 1_000_000).toFixed(1)}M ·
              z={marketTide.tide_zscore >= 0 ? '+' : ''}
              {marketTide.tide_zscore.toFixed(2)}σ
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              slope={marketTide.tide_slope_15m >= 0 ? '+' : ''}
              {marketTide.tide_slope_15m.toFixed(2)} · persist=
              {((mktState?.market_tide.persistence ?? 0.8) * 100).toFixed(0)}% (
              {mktState?.market_tide.bullish_minutes_last_30m ?? 24}/30m)
            </div>
          </div>

          <div className="p-3 rounded-md bg-[#0B0F17]">
            <div className="text-[11px] text-slate-400 font-mono">
              2. 0DTE Expiry Tide (`zero_dte`)
            </div>
            <div className="mt-1 text-base font-bold font-mono text-slate-100">
              Equity:{' '}
              <span
                className={
                  mktState?.zero_dte.equity_pressure === 'bullish'
                    ? 'text-emerald-400'
                    : mktState?.zero_dte.equity_pressure === 'bearish'
                      ? 'text-rose-400'
                      : 'text-amber-300'
                }
              >
                {mktState?.zero_dte.equity_pressure ?? 'bullish'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Index: {mktState?.zero_dte.index_pressure ?? 'bullish'} · ETF:{' '}
              {mktState?.zero_dte.etf_pressure ?? 'neutral'}
            </div>
          </div>

          <div className="p-3 rounded-md bg-[#0B0F17]">
            <div className="text-[11px] text-slate-400 font-mono">
              3. Market Gamma (`gex` SPY/QQQ/IWM)
            </div>
            <div className="mt-1 text-base font-bold font-mono text-sky-400">
              {mktState?.gex.regime ?? 'positive_gamma'} (
              {(mktState?.gex.distance_to_flip_pct ?? 0.95) >= 0 ? '+' : ''}
              {(mktState?.gex.distance_to_flip_pct ?? 0.95).toFixed(2)}%)
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              SPY {mktState?.gex.spy_spot.toFixed(1) ?? '769.9'} · Flip{' '}
              {mktState?.gex.spy_gamma_flip.toFixed(1) ?? '763.4'} · Wall{' '}
              {mktState?.gex.spy_call_wall.toFixed(0) ?? '775'}/
              {mktState?.gex.spy_put_wall.toFixed(0) ?? '755'}
            </div>
          </div>

          <div className="p-3 rounded-md bg-[#0B0F17]">
            <div className="text-[11px] text-slate-400 font-mono">
              4. Volatility Term (`volatility_regime`)
            </div>
            <div
              className={`mt-1 text-base font-bold font-mono ${
                mktState?.volatility_regime === 'event_or_stress'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {mktState?.volatility_regime ?? 'normal'} · Ratio{' '}
              {(mktState?.front_back_iv_ratio ?? 1.07).toFixed(2)}x
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              7-14d IV {((mktState?.iv_7_to_14_dte ?? 0.184) * 100).toFixed(1)}%
              · 30-60d IV{' '}
              {((mktState?.iv_30_to_60_dte ?? 0.172) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </section>

      {/* Main Split: Market Tide Chart (8 cols) + Top Net Impact Chart (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Market Tide Interactive Chart */}
        <section
          aria-label="Market Tide Intraday Flow Chart"
          className="lg:col-span-8 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">
                  Market Tide
                </h2>
                <span className="text-xs text-slate-400">
                  Click a minute on the chart to inspect flow
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Powered by unusualwhales.com /api/market/market-tide
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 rounded bg-[#0B0F17] border border-slate-800 text-xs">
                {(['All', 'Common Only'] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setEtfScope(sc)}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      etfScope === sc
                        ? 'bg-slate-800 text-slate-100 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sc}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 rounded bg-[#0B0F17] border border-slate-800 text-xs font-mono">
                {(['1D', '30M', '5M'] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => {
                      setTimeframeWindow(tf);
                      setPinnedMinuteIdx(null);
                    }}
                    className={`px-2 py-1 rounded transition-colors ${
                      timeframeWindow === tf
                        ? 'bg-slate-800 text-sky-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Minute Readout Line */}
          {activePoint && (
            <div className="px-3.5 py-2.5 rounded-md bg-[#0B0F17] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-200 font-semibold">
                  {activePoint.timestamp_str}
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  SPY:{' '}
                  <strong className="text-amber-300">
                    {activePoint.spy_price.toFixed(2)}
                  </strong>
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  Vol:{' '}
                  <strong
                    className={
                      activePoint.net_volume_m >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }
                  >
                    {formatVolCompact(activePoint.net_volume_m, true)}
                  </strong>
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  NPP:{' '}
                  <strong className="text-rose-400">
                    {formatPremCompact(activePoint.net_put_premium_m, true)}
                  </strong>
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  NCP:{' '}
                  <strong className="text-emerald-400">
                    {formatPremCompact(activePoint.net_call_premium_m, true)}
                  </strong>
                </span>
                {pinnedMinuteIdx !== null &&
                  pinnedMinuteIdx < series.length - 1 && (
                    <button
                      type="button"
                      onClick={() => setPinnedMinuteIdx(null)}
                      className="ml-1 px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/40 text-sky-300 text-[10px] hover:bg-sky-500/25 cursor-pointer"
                    >
                      Jump to Latest ({series[series.length - 1]?.time_label})
                    </button>
                  )}
              </div>

              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-300" />
                  SPY Price
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Net Call Prem
                </span>
                <span className="inline-flex items-center gap-1 text-rose-400">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  Net Put Prem
                </span>
              </div>
            </div>
          )}

          {/* Interactive SVG Chart */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${topHeight + volHeight + 52}`}
              className="w-full h-auto select-none bg-[#0B0F17] rounded-md p-2"
              role="img"
              aria-label="Interactive Market Tide Net Premiums and Net Volume Chart"
            >
              {/* Top Panel Title */}
              <text
                x={padLeft}
                y={14}
                fill="#94A3B8"
                fontSize="10"
                fontWeight="600"
              >
                Net Premiums
              </text>

              {/* Horizontal Grid Lines (Top Panel) */}
              {[0.15, 0.38, 0.62, 0.85].map((ratio, idx) => {
                const y = 18 + ratio * (topHeight - 36);
                const spyVal = spyMax - ratio * (spyMax - spyMin);
                const premVal = Math.round(
                  premMax - ratio * (premMax - premMin)
                );
                const spyBadgeY = activePoint
                  ? getSpyY(activePoint.spy_price)
                  : -100;
                const nppBadgeY = activePoint
                  ? getPremY(activePoint.net_put_premium_m)
                  : -100;
                const ncpBadgeY = activePoint
                  ? getPremY(activePoint.net_call_premium_m)
                  : -100;
                const hideLeft = Math.abs(y - spyBadgeY) < 14;
                const hideRight =
                  Math.abs(y - nppBadgeY) < 14 || Math.abs(y - ncpBadgeY) < 14;
                return (
                  <g key={idx}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={chartWidth - padRight}
                      y2={y}
                      stroke="#1E293B"
                      strokeDasharray="2 3"
                      strokeWidth="1"
                    />
                    {!hideLeft && (
                      <text
                        x={padLeft - 6}
                        y={y + 3}
                        textAnchor="end"
                        fill="#64748B"
                        fontSize="10"
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {spyVal.toFixed(0)}
                      </text>
                    )}
                    {!hideRight && (
                      <text
                        x={chartWidth - padRight + 6}
                        y={y + 3}
                        textAnchor="start"
                        fill="#64748B"
                        fontSize="10"
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {premVal}M
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Zero Net Premium Baseline */}
              <line
                x1={padLeft}
                y1={zeroPremY}
                x2={chartWidth - padRight}
                y2={zeroPremY}
                stroke="#475569"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              {(!activePoint ||
                (Math.abs(zeroPremY - getPremY(activePoint.net_put_premium_m)) >=
                  14 &&
                  Math.abs(
                    zeroPremY - getPremY(activePoint.net_call_premium_m)
                  ) >= 14)) && (
                <text
                  x={chartWidth - padRight + 6}
                  y={zeroPremY + 3}
                  fill="#94A3B8"
                  fontSize="10"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  0
                </text>
              )}

              {/* NPP (Red/Rose) Curve */}
              <path
                d={nppPath}
                fill="none"
                stroke="#F43F5E"
                strokeWidth="2.2"
              />

              {/* NCP (Emerald) Curve */}
              <path
                d={ncpPath}
                fill="none"
                stroke="#10B981"
                strokeWidth="2.2"
              />

              {/* SPY Price (Amber/Yellow) Curve */}
              <path
                d={spyPath}
                fill="none"
                stroke="#FACC15"
                strokeWidth="1.8"
              />

              {/* Net Volume Subplot Header & Zero Baseline */}
              <text
                x={padLeft}
                y={volTop - 4}
                fill="#94A3B8"
                fontSize="10"
                fontWeight="600"
              >
                Net Volume
              </text>
              <line
                x1={padLeft}
                y1={volZeroY}
                x2={chartWidth - padRight}
                y2={volZeroY}
                stroke="#475569"
                strokeWidth="1"
              />

              {/* Net Volume Filled Area */}
              <path
                d={volAreaPath}
                fill={
                  (activePoint?.net_volume_m ?? 0) >= 0
                    ? 'rgba(16, 185, 129, 0.35)'
                    : 'rgba(244, 63, 94, 0.65)'
                }
                stroke={
                  (activePoint?.net_volume_m ?? 0) >= 0 ? '#10B981' : '#F43F5E'
                }
                strokeWidth="1.5"
              />

              {/* Selected Minute Vertical Crosshair Line & Dots */}
              {activePoint && (
                <g>
                  <line
                    x1={selectedX}
                    y1={18}
                    x2={selectedX}
                    y2={volTop + volHeight - 10}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                    strokeWidth="1.2"
                  />
                  {/* SPY dot */}
                  <circle
                    cx={selectedX}
                    cy={getSpyY(activePoint.spy_price)}
                    r="4.5"
                    fill="#FACC15"
                    stroke="#0B0F17"
                    strokeWidth="1.5"
                  />
                  {/* NPP dot */}
                  <circle
                    cx={selectedX}
                    cy={getPremY(activePoint.net_put_premium_m)}
                    r="4.5"
                    fill="#F43F5E"
                    stroke="#0B0F17"
                    strokeWidth="1.5"
                  />
                  {/* NCP dot */}
                  <circle
                    cx={selectedX}
                    cy={getPremY(activePoint.net_call_premium_m)}
                    r="4.5"
                    fill="#10B981"
                    stroke="#0B0F17"
                    strokeWidth="1.5"
                  />
                  {/* Net Vol dot */}
                  <circle
                    cx={selectedX}
                    cy={getVolY(activePoint.net_volume_m)}
                    r="4"
                    fill={
                      activePoint.net_volume_m >= 0 ? '#10B981' : '#F43F5E'
                    }
                    stroke="#E2E8F0"
                    strokeWidth="1.5"
                  />

                  {/* Left Axis SPY Callout Badge */}
                  <rect
                    x={2}
                    y={getSpyY(activePoint.spy_price) - 9}
                    width={40}
                    height={18}
                    rx={3}
                    fill="#FACC15"
                  />
                  <text
                    x={22}
                    y={getSpyY(activePoint.spy_price) + 3}
                    textAnchor="middle"
                    fill="#0B0F17"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {activePoint.spy_price.toFixed(1)}
                  </text>

                  {/* Right Axis NPP Callout Badge */}
                  <rect
                    x={chartWidth - padRight + 3}
                    y={getPremY(activePoint.net_put_premium_m) - 9}
                    width={52}
                    height={18}
                    rx={3}
                    fill="#F43F5E"
                  />
                  <text
                    x={chartWidth - padRight + 29}
                    y={getPremY(activePoint.net_put_premium_m) + 3}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {formatPremCompact(activePoint.net_put_premium_m)}
                  </text>

                  {/* Right Axis NCP Callout Badge */}
                  <rect
                    x={chartWidth - padRight + 3}
                    y={getPremY(activePoint.net_call_premium_m) - 9}
                    width={52}
                    height={18}
                    rx={3}
                    fill="#10B981"
                  />
                  <text
                    x={chartWidth - padRight + 29}
                    y={getPremY(activePoint.net_call_premium_m) + 3}
                    textAnchor="middle"
                    fill="#052E16"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {formatPremCompact(activePoint.net_call_premium_m)}
                  </text>

                  {/* Right Axis Net Volume Badge */}
                  <rect
                    x={chartWidth - padRight + 3}
                    y={getVolY(activePoint.net_volume_m) - 9}
                    width={52}
                    height={18}
                    rx={3}
                    fill={
                      activePoint.net_volume_m >= 0 ? '#10B981' : '#F43F5E'
                    }
                  />
                  <text
                    x={chartWidth - padRight + 29}
                    y={getVolY(activePoint.net_volume_m) + 3}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="9.5"
                    fontWeight="700"
                    fontFamily="IBM Plex Mono, monospace"
                  >
                    {formatVolCompact(activePoint.net_volume_m)}
                  </text>
                </g>
              )}

              {/* X-Axis Time Labels & Clickable Slices */}
              {series.map((p, i) => {
                const x = getX(i);
                const sliceW = plotW / Math.max(series.length, 1);
                const labelStep = Math.max(1, Math.floor(series.length / 7));
                const showLabel =
                  (i % labelStep === 0 && i < series.length - Math.max(1, Math.floor(labelStep / 2))) ||
                  i === series.length - 1;
                return (
                  <g key={`${p.timestamp_str}-${i}`}>
                    {showLabel && (
                      <text
                        x={x}
                        y={volTop + volHeight + 14}
                        textAnchor="middle"
                        fill="#94A3B8"
                        fontSize="9.5"
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {p.time_label}
                      </text>
                    )}
                    <rect
                      x={x - sliceW / 2}
                      y={10}
                      width={sliceW}
                      height={topHeight + volHeight + 15}
                      fill="transparent"
                      className="cursor-pointer"
                      onClick={() => setPinnedMinuteIdx(i)}
                      onMouseEnter={() => setPinnedMinuteIdx(i)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* Right: Top Net Impact Chart */}
        <section
          aria-label="Top Net Impact Chart"
          className="lg:col-span-4 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
                <span>Top Net Impact Chart</span>
                <ArrowUpRight className="w-4 h-4 text-slate-400" />
              </h2>
              <p className="text-[11px] text-slate-400">
                Click any ticker to filter Whale Scanner candidates
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Net Premiums
            </span>
          </div>

          <div className="space-y-1.5 pt-1">
            {filteredTopImpact.map((item) => {
              const isPos = item.net_premium_m >= 0;
              const pctWidth = Math.min(
                (Math.abs(item.net_premium_m) / maxImpactAbs) * 100,
                100
              );
              return (
                <button
                  key={item.ticker}
                  type="button"
                  onClick={() => onSelectTickerInScanner(item.ticker)}
                  className="w-full group flex items-center gap-2 py-1 px-1.5 rounded hover:bg-slate-800/50 transition-colors text-left"
                >
                  <span className="w-12 text-xs font-mono font-semibold text-sky-400 group-hover:underline shrink-0">
                    {item.ticker}
                  </span>

                  {/* Diverging Bar Track */}
                  <div className="flex-1 h-4 bg-[#0B0F17] rounded-sm relative flex items-center">
                    {/* Center Zero Axis Line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700" />

                    {isPos ? (
                      <div
                        style={{
                          left: '50%',
                          width: `${pctWidth / 2}%`,
                        }}
                        className="absolute h-3 bg-emerald-400 rounded-r-sm"
                      />
                    ) : (
                      <div
                        style={{
                          right: '50%',
                          width: `${pctWidth / 2}%`,
                        }}
                        className="absolute h-3 bg-rose-500 rounded-l-sm"
                      />
                    )}
                  </div>

                  <span
                    className={`w-14 text-right text-[11px] font-mono tabular-nums shrink-0 ${
                      isPos ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isPos ? '+' : ''}
                    {item.net_premium_m.toFixed(1)}M
                  </span>
                </button>
              );
            })}
          </div>

          {/* X-axis scale footer */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400 pl-14 pr-14">
            <span>-{Math.round(maxImpactAbs)}M</span>
            <span>-{Math.round(maxImpactAbs / 2)}M</span>
            <span>0</span>
            <span>+{Math.round(maxImpactAbs / 2)}M</span>
            <span>+{Math.round(maxImpactAbs)}M</span>
          </div>
        </section>
      </div>

      {/* Bottom Split: 6 State-Machine Filter Profiles Table (7 cols) + Active Profile JSON & 9-Factor Score Spec (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section
          aria-label="Regime Scanner Emphasis Matrix"
          className="lg:col-span-7 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Section 4: State-Machine Filter Profiles (A–F) &amp; Section 6 GEX Rules
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any profile row to activate that state-machine profile and re-rank all Whale Candidates.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-[#0B0F17]/60">
                  <th className="py-2.5 px-2.5 font-medium">Profile (A–F)</th>
                  <th className="py-2.5 px-2.5 font-medium">Activation Condition</th>
                  <th className="py-2.5 px-2.5 font-medium">Tightening &amp; GEX Rules</th>
                  <th className="py-2.5 px-2.5 font-medium text-right">
                    Min Prem / Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {(
                  [
                    {
                      id: 'risk_on_trend' as AdaptiveFilterProfileId,
                      name: 'A. risk_on_trend',
                      cond: 'persistent_bullish_tide + equity_0dte != bearish + SPY >= flip',
                      tighten:
                        'Bullish calls (DTE 7–45, delta 0.25–0.65); +6 Call Wall breakout, +4 sector align',
                      premScore: '$75K · Score >= 68',
                      fallbackRegime: 'strong_positive' as MarketTideRegime,
                    },
                    {
                      id: 'risk_off_trend' as AdaptiveFilterProfileId,
                      name: 'B. risk_off_trend',
                      cond: 'persistent_bearish_tide + equity_0dte != bullish + SPY <= flip',
                      tighten:
                        'Bearish puts/bid calls; below VWAP & close <= 0.35; +6 Put Wall breakdown',
                      premScore: '$75K · Score >= 68',
                      fallbackRegime: 'strong_negative' as MarketTideRegime,
                    },
                    {
                      id: 'positive_gamma_range' as AdaptiveFilterProfileId,
                      name: 'C. positive_gamma_range',
                      cond: '|zscore_5m| < 1.0 + positive_gamma + near magnet/wall',
                      tighten:
                        'Multi-day accumulation only (DTE 14–60, >=2d OI rises); -8 Magnet Pin penalty',
                      premScore: '$150K · Score >= 76',
                      fallbackRegime: 'neutral' as MarketTideRegime,
                    },
                    {
                      id: 'negative_gamma_expansion' as AdaptiveFilterProfileId,
                      name: 'D. negative_gamma_expansion',
                      cond: 'negative_gamma + (|zscore_5m| >= 1.25 or elevated range)',
                      tighten:
                        'Fast convex sweeps (DTE 3–21, sweep >= 45%, 10s >= $100K, RVOL >= 1.8x, TTL 20m)',
                      premScore: '$125K · Score >= 75',
                      fallbackRegime: 'mixed' as MarketTideRegime,
                    },
                    {
                      id: 'gamma_flip_transition' as AdaptiveFilterProfileId,
                      name: 'E. gamma_flip_transition',
                      cond: '|SPY - gamma_flip| / SPY <= 0.30% or 5m/30m sign flip',
                      tighten:
                        'Highest whip-saw risk: skew >= 80%, sweep >= 50%, 3m confirm, 15m TTL',
                      premScore: '$200K · Score >= 82',
                      fallbackRegime: 'reversing' as MarketTideRegime,
                    },
                    {
                      id: 'volatility_stress' as AdaptiveFilterProfileId,
                      name: 'F. volatility_stress',
                      cond: 'front_back_iv_ratio >= 1.20 or 0DTE index dominates flow',
                      tighten:
                        'Spread <= 6%, OI >= 750, Vol/OI >= 2.0, contract_share >= 45%; flag hedge risk',
                      premScore: '$250K · Score >= 84',
                      fallbackRegime: 'strong_negative' as MarketTideRegime,
                    },
                  ] as const
                ).map((row) => {
                  const isActive = activeProfileId === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() =>
                        onSwitchAdaptiveProfile
                          ? onSwitchAdaptiveProfile(row.id)
                          : onSwitchRegime(row.fallbackRegime)
                      }
                      className={`cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-sky-950/35 hover:bg-sky-950/45'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-2.5 font-mono font-semibold text-slate-100 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          )}
                          <span>{row.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 font-mono text-[11px] text-slate-300">
                        {row.cond}
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-400">
                        {row.tighten}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-sky-400 whitespace-nowrap">
                        {row.premScore}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Candidate Preview under Active State-Machine Profile */}
          <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                <span>
                  Candidates Passing `{activeProfileId}` ({candidates.length})
                </span>
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                Click a candidate to inspect GEX &amp; 9-factor score
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {candidates.slice(0, 4).map((cand) => {
                const isBull = cand.direction === 'bullish';
                const adj =
                  cand.decision?.regime_adjustments ??
                  cand.regime_bonus_applied ??
                  0;
                return (
                  <button
                    key={cand.candidate_id}
                    type="button"
                    onClick={() => onInspectCandidateInScanner(cand.candidate_id)}
                    className="p-3 rounded-md bg-[#0B0F17] hover:bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-2 text-left transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="font-bold text-slate-100">
                          {cand.ticker}
                        </span>
                        <span className="text-slate-400">
                          ${cand.strike}
                          {cand.option_type === 'call' ? 'C' : 'P'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 text-[11px] ${
                            isBull ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {isBull ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          {cand.direction}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        5m ${(cand.flow.premium_5m / 1000).toFixed(0)}K ·{' '}
                        {cand.gamma_context?.breakout_confirmed
                          ? 'Wall Breakout (+6)'
                          : 'GEX Aligned'}
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className="text-base font-bold text-sky-400">
                        {cand.whale_score}
                      </div>
                      <div
                        className={`text-[10px] ${
                          adj > 0
                            ? 'text-emerald-400'
                            : adj < 0
                              ? 'text-rose-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {adj >= 0 ? `+${adj}` : adj} regime adj
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right: Active State-Machine Profile JSON, Market State Object & 9-Factor Score Formula */}
        <section
          aria-label="Active Regime Scanner Configuration JSON"
          className="lg:col-span-5 p-5 rounded-lg border border-slate-800 bg-[#111726] space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Active Filter Profile JSON (`{activeProfileId}`)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Section 2 `MarketStateObject` &amp; Section 4 Profile Configuration.
            </p>
          </div>

          <pre className="p-3 rounded-md bg-[#0B0F17] text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed max-h-[260px]">
            {JSON.stringify(
              {
                market_state: {
                  as_of: mktState?.as_of,
                  market_regime: mktState?.market_regime,
                  market_tide: {
                    net_premium_5m: mktState?.market_tide.net_premium_5m,
                    net_premium_30m: mktState?.market_tide.net_premium_30m,
                    zscore_5m: mktState?.market_tide.zscore_5m,
                    slope_15m: mktState?.market_tide.slope_15m,
                    persistence: mktState?.market_tide.persistence,
                  },
                  zero_dte: {
                    index_pressure: mktState?.zero_dte.index_pressure,
                    etf_pressure: mktState?.zero_dte.etf_pressure,
                    equity_pressure: mktState?.zero_dte.equity_pressure,
                  },
                  gex: {
                    spy_spot: mktState?.gex.spy_spot,
                    spy_gamma_flip: mktState?.gex.spy_gamma_flip,
                    spy_call_wall: mktState?.gex.spy_call_wall,
                    spy_put_wall: mktState?.gex.spy_put_wall,
                    distance_to_flip_pct: mktState?.gex.distance_to_flip_pct,
                    regime: mktState?.gex.regime,
                  },
                  volatility_regime: mktState?.volatility_regime,
                  active_filter_profile: activeProfileId,
                },
                active_profile_spec: activeAdaptiveSpec,
              },
              null,
              2
            )}
          </pre>

          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <h3 className="text-xs font-semibold text-slate-200">
              Section 7: 9-Factor Adaptive Whale Score Formula
            </h3>
            <pre className="p-3 rounded-md bg-[#0B0F17] text-[11px] font-mono text-sky-300 overflow-x-auto leading-relaxed">
{`whale_score_base = (
    0.18 * premium_score      + 0.15 * urgency_score
  + 0.12 * novelty_score      + 0.12 * concentration_score
  + 0.15 * price_confirmation + 0.08 * liquidity_score
  + 0.08 * market_tide_align  + 0.06 * sector_tide_align
  + 0.06 * gamma_alignment_score
) * 100
final_score = clamp(whale_score_base + ticker_gamma_mod + regime_penalties, 0, 100)`}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
};
