import React, { useState } from 'react';
import {
  FlowAlertRule,
  IssueType,
  OptionType,
  PrintSide,
  WhaleCandidate,
} from '../engine/whaleScannerEngine';
import {
  PersistedWebSocketMessage,
  ReconciliationReport,
  RejectedPrintLog,
} from '../engine/whalePipelineRuntime';
import {
  Play,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Database,
  Radio,
  ArrowRight,
} from 'lucide-react';

interface PipelineWorkbenchViewProps {
  rawWsMessages: PersistedWebSocketMessage[];
  rejectedPrints: RejectedPrintLog[];
  activeWsChannels: string[];
  contractCacheCount: number;
  seenEventCount: number;
  lastReconciliation: ReconciliationReport | null;
  onIngestPrint: (payload: {
    ticker: string;
    option_symbol: string;
    option_type: OptionType;
    strike: number;
    expiry: string;
    dte: number;
    size: number;
    price: number;
    side: PrintSide;
    is_sweep: boolean;
    is_multi_leg: boolean;
    is_canceled?: boolean;
    spread: number;
    open_interest: number;
    volume: number;
    underlying_price: number;
    return_5m: number;
    relative_volume_5m: number;
    vwap_aligned: boolean;
    avg_daily_dollar_volume: number;
    issue_type?: IssueType;
    flow_alert_rules?: FlowAlertRule[];
    event_id?: string;
  }) => Promise<{
    accepted: boolean;
    deduplicated: boolean;
    event_id: string;
    reject_reasons: string[];
    candidate?: WhaleCandidate;
  }>;
  onTriggerReconcile: () => Promise<void>;
}

export const PipelineWorkbenchView: React.FC<PipelineWorkbenchViewProps> = ({
  rawWsMessages,
  rejectedPrints,
  activeWsChannels,
  contractCacheCount,
  seenEventCount,
  lastReconciliation,
  onIngestPrint,
  onTriggerReconcile,
}) => {
  const [ticker, setTicker] = useState('AMZN');
  const [optionSymbol, setOptionSymbol] = useState('AMZN261120C00215000');
  const [optionType, setOptionType] = useState<OptionType>('call');
  const [strike, setStrike] = useState(215);
  const [expiry, setExpiry] = useState('2026-11-20');
  const [dte, setDte] = useState(33);
  const [size, setSize] = useState(650);
  const [price, setPrice] = useState(4.8);
  const [side, setSide] = useState<PrintSide>('ask');
  const [isSweep, setIsSweep] = useState(true);
  const [isMultiLeg, setIsMultiLeg] = useState(false);
  const [spread, setSpread] = useState(0.045);
  const [openInterest, setOpenInterest] = useState(950);
  const [volume, setVolume] = useState(3600);
  const [underlyingPrice, setUnderlyingPrice] = useState(209.4);
  const [return5m, setReturn5m] = useState(0.0115);
  const [rvol5m, setRvol5m] = useState(1.95);
  const [vwapAligned, setVwapAligned] = useState(true);
  const [eventId, setEventId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<{
    accepted: boolean;
    deduplicated: boolean;
    event_id: string;
    reject_reasons: string[];
    candidate?: WhaleCandidate;
  } | null>(null);

  const loadPreset = (
    preset:
      | 'confirmed_bull'
      | 'repeat_nvda_sweep'
      | 'unconfirmed_flow'
      | 'reject_0dte'
      | 'reject_spread'
      | 'reject_multileg'
      | 'duplicate_id'
  ) => {
    setFormError(null);
    if (preset === 'repeat_nvda_sweep') {
      setTicker('NVDA');
      setOptionSymbol('NVDA261120C00150000');
      setOptionType('call');
      setStrike(150);
      setExpiry('2026-11-20');
      setDte(33);
      setSize(420);
      setPrice(6.55);
      setSide('ask');
      setIsSweep(true);
      setIsMultiLeg(false);
      setSpread(0.038);
      setOpenInterest(1450);
      setVolume(6840);
      setUnderlyingPrice(146.95);
      setReturn5m(0.0158);
      setRvol5m(2.45);
      setVwapAligned(true);
      setEventId(`uw-nvda-agg-${Date.now().toString().slice(-4)}`);
    } else if (preset === 'confirmed_bull') {
      setTicker('AMZN');
      setOptionSymbol('AMZN261120C00215000');
      setOptionType('call');
      setStrike(215);
      setExpiry('2026-11-20');
      setDte(33);
      setSize(650);
      setPrice(4.8);
      setSide('ask');
      setIsSweep(true);
      setIsMultiLeg(false);
      setSpread(0.045);
      setOpenInterest(950);
      setVolume(3600);
      setUnderlyingPrice(209.4);
      setReturn5m(0.0115);
      setRvol5m(1.95);
      setVwapAligned(true);
      setEventId(`uw-amzn-${Date.now().toString().slice(-4)}`);
    } else if (preset === 'unconfirmed_flow') {
      setTicker('NFLX');
      setOptionSymbol('NFLX261120C00760000');
      setOptionType('call');
      setStrike(760);
      setExpiry('2026-11-20');
      setDte(33);
      setSize(220);
      setPrice(14.5);
      setSide('ask');
      setIsSweep(true);
      setIsMultiLeg(false);
      setSpread(0.06);
      setOpenInterest(620);
      setVolume(1950);
      setUnderlyingPrice(738.0);
      setReturn5m(-0.0022);
      setRvol5m(1.1);
      setVwapAligned(false);
      setEventId(`uw-nflx-${Date.now().toString().slice(-4)}`);
    } else if (preset === 'reject_0dte') {
      const todayIso = new Date().toISOString().slice(0, 10);
      const compactDate = todayIso.slice(2).replace(/-/g, '');
      setTicker('AAPL');
      setOptionSymbol(`AAPL${compactDate}C00235000`);
      setOptionType('call');
      setStrike(235);
      setExpiry(todayIso);
      setDte(0);
      setSize(900);
      setPrice(2.1);
      setSide('ask');
      setIsSweep(true);
      setIsMultiLeg(false);
      setSpread(0.05);
      setOpenInterest(4200);
      setVolume(9500);
      setUnderlyingPrice(234.2);
      setReturn5m(0.008);
      setRvol5m(1.8);
      setVwapAligned(true);
      setEventId(`uw-0dte-${Date.now().toString().slice(-4)}`);
    } else if (preset === 'reject_spread') {
      setTicker('RIVN');
      setOptionSymbol('RIVN261120C00016000');
      setOptionType('call');
      setStrike(16);
      setExpiry('2026-11-20');
      setDte(33);
      setSize(1500);
      setPrice(1.15);
      setSide('ask');
      setIsSweep(false);
      setIsMultiLeg(false);
      setSpread(0.32); // 32% > 25% hard limit
      setOpenInterest(800);
      setVolume(2100);
      setUnderlyingPrice(13.8);
      setReturn5m(0.009);
      setRvol5m(1.6);
      setVwapAligned(true);
      setEventId(`uw-wide-${Date.now().toString().slice(-4)}`);
    } else if (preset === 'reject_multileg') {
      setTicker('ORCL');
      setOptionSymbol('ORCL261120C00185000');
      setOptionType('call');
      setStrike(185);
      setExpiry('2026-11-20');
      setDte(33);
      setSize(500);
      setPrice(5.2);
      setSide('ask');
      setIsSweep(false);
      setIsMultiLeg(true);
      setSpread(0.07);
      setOpenInterest(1200);
      setVolume(2800);
      setUnderlyingPrice(178.5);
      setReturn5m(0.005);
      setRvol5m(1.55);
      setVwapAligned(true);
      setEventId(`uw-mleg-${Date.now().toString().slice(-4)}`);
    } else if (preset === 'duplicate_id') {
      setEventId('uw-evt-98410'); // Existing NVDA event ID
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !optionSymbol.trim()) {
      setFormError('Ticker and Option Symbol are required.');
      return;
    }
    if (size <= 0 || price <= 0) {
      setFormError('Print size and option price must be greater than zero.');
      return;
    }
    setFormError(null);

    const res = await onIngestPrint({
      ticker: ticker.trim().toUpperCase(),
      option_symbol: optionSymbol.trim().toUpperCase(),
      option_type: optionType,
      strike: Number(strike),
      expiry,
      dte: Number(dte),
      size: Number(size),
      price: Number(price),
      side,
      is_sweep: isSweep,
      is_multi_leg: isMultiLeg,
      spread: Number(spread),
      open_interest: Number(openInterest),
      volume: Number(volume),
      underlying_price: Number(underlyingPrice),
      return_5m: Number(return5m),
      relative_volume_5m: Number(rvol5m),
      vwap_aligned: vwapAligned,
      avg_daily_dollar_volume: 4_500_000_000,
      event_id: eventId.trim() || undefined,
    });

    setLastOutcome(res);
  };

  const pipelineSteps = [
    {
      step: '01. contract_screener',
      detail: `${contractCacheCount} cached (30m TTL)`,
    },
    {
      step: '02. option_trades + alerts',
      detail: `${seenEventCount} deduplicated prints`,
    },
    {
      step: '03. Window Aggregation',
      detail: '1m · 5m · 15m rolling',
    },
    {
      step: '04. Burst & Urgency',
      detail: '4x baseline · z >= 3.0',
    },
    {
      step: '05. 5m Candle Confirm',
      detail: 'VWAP · RVOL >= 1.5x',
    },
    {
      step: '06. Whale Score (0-100)',
      detail: '6 clamped factors',
    },
  ];

  return (
    <div className="space-y-6">
      {/* 7-Stage Pipeline Flow Strip */}
      <section
        aria-label="Real-Time Event Pipeline Architecture"
        className="border border-slate-800 bg-[#111726] rounded-lg p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Real-Time Event Pipeline & Idempotent Tape Consumer
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Raw WebSocket frames are persisted prior to window aggregation and
              deduplicated via provider event ID or deterministic FNV-1a print
              hash.
            </p>
          </div>
          <button
            type="button"
            onClick={onTriggerReconcile}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Run Post-Close /option-trades &amp; OI Reconciliation</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {pipelineSteps.map((item, idx) => (
            <div
              key={item.step}
              className="p-3 rounded bg-[#0B0F17] border border-slate-800/80 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                <span>{item.step}</span>
                {idx < pipelineSteps.length - 1 && (
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden lg:block" />
                )}
              </div>
              <div className="text-xs font-mono text-sky-400 mt-1.5">
                {item.detail}
              </div>
            </div>
          ))}
        </div>

        {lastReconciliation && (
          <div className="mt-4 p-3 rounded bg-emerald-950/30 border border-emerald-800/50 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2 font-mono">
            <span>
              Reconciliation complete at {lastReconciliation.run_at}: Checked{' '}
              {lastReconciliation.total_prints_checked} prints ·{' '}
              {lastReconciliation.idempotent_matches} idempotent matches ·{' '}
              {lastReconciliation.oi_labels_updated} candidate OI labels updated
              to verified_next_day_oi
            </span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Interactive Option Print Injector & Hard-Reject Tester */}
        <section
          aria-label="Option Print Tape Simulator"
          className="lg:col-span-7 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
        >
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Inject Normalized Option Print into Pipeline
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Test how the pipeline scores valid institutional sweeps, assigns
              needs_confirmation when underlying candles lag, or enforces
              Section 7 Hard Reject Rules.
            </p>
          </div>

          {/* Preset Test Scenarios */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-300">
              Load Deterministic Test Scenario:
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="preset-repeat-nvda-btn"
                onClick={() => loadPreset('repeat_nvda_sweep')}
                className="px-2.5 py-1.5 text-xs font-medium bg-sky-950/60 border border-sky-500/40 hover:bg-sky-900/50 text-sky-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Aggregate Repeat Print (NVDA $150C)
              </button>
              <button
                type="button"
                onClick={() => loadPreset('confirmed_bull')}
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Confirmed Bullish Sweep (AMZN)
              </button>
              <button
                type="button"
                onClick={() => loadPreset('unconfirmed_flow')}
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-amber-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Unconfirmed Candle (NFLX)
              </button>
              <button
                type="button"
                onClick={() => loadPreset('reject_0dte')}
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-rose-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Reject: 0DTE Contract
              </button>
              <button
                type="button"
                onClick={() => loadPreset('reject_spread')}
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-rose-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Reject: Spread &gt; 25%
              </button>
              <button
                type="button"
                onClick={() => loadPreset('reject_multileg')}
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-rose-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Reject: Multi-Leg &gt; 50%
              </button>
              <button
                type="button"
                onClick={() => loadPreset('duplicate_id')}
                className="px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors whitespace-nowrap shrink-0"
              >
                Test Duplicate Event ID
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="sim-ticker"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Ticker
                </label>
                <input
                  id="sim-ticker"
                  type="text"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="sim-symbol"
                  className="block text-xs text-slate-400 mb-1"
                >
                  OCC Option Symbol
                </label>
                <input
                  id="sim-symbol"
                  type="text"
                  value={optionSymbol}
                  onChange={(e) => setOptionSymbol(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="sim-dte"
                  className="block text-xs text-slate-400 mb-1"
                >
                  DTE (Days)
                </label>
                <input
                  id="sim-dte"
                  type="number"
                  value={dte}
                  onChange={(e) => setDte(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="sim-type"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Option Type
                </label>
                <select
                  id="sim-type"
                  value={optionType}
                  onChange={(e) => setOptionType(e.target.value as OptionType)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                >
                  <option value="call">call</option>
                  <option value="put">put</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="sim-side"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Execution Side
                </label>
                <select
                  id="sim-side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as PrintSide)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                >
                  <option value="ask">ask</option>
                  <option value="bid">bid</option>
                  <option value="mid">mid (ambiguous)</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="sim-size"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Contract Size
                </label>
                <input
                  id="sim-size"
                  type="number"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="sim-price"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Contract Price ($)
                </label>
                <input
                  id="sim-price"
                  type="number"
                  step="0.05"
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="sim-spread"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Option Spread (0..1)
                </label>
                <input
                  id="sim-spread"
                  type="number"
                  step="0.01"
                  value={spread}
                  onChange={(e) => setSpread(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="sim-ret5m"
                  className="block text-xs text-slate-400 mb-1"
                >
                  5m Stock Return
                </label>
                <input
                  id="sim-ret5m"
                  type="number"
                  step="0.001"
                  value={return5m}
                  onChange={(e) => setReturn5m(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="sim-rvol"
                  className="block text-xs text-slate-400 mb-1"
                >
                  5m Rel Volume (x)
                </label>
                <input
                  id="sim-rvol"
                  type="number"
                  step="0.1"
                  value={rvol5m}
                  onChange={(e) => setRvol5m(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="sim-evtid"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Provider Event ID
                </label>
                <input
                  id="sim-evtid"
                  type="text"
                  placeholder="Auto hash if blank"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-4 text-xs text-slate-300">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSweep}
                    onChange={(e) => setIsSweep(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900"
                  />
                  <span>Intermarket Sweep</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isMultiLeg}
                    onChange={(e) => setIsMultiLeg(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900"
                  />
                  <span>Multi-Leg (&gt;50% Share)</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vwapAligned}
                    onChange={(e) => setVwapAligned(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900"
                  />
                  <span>5m VWAP Aligned</span>
                </label>
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Process Print in Pipeline</span>
              </button>
            </div>
          </form>

          {formError && (
            <div
              role="alert"
              className="p-3 rounded bg-rose-950/40 border border-rose-800 text-xs text-rose-200"
            >
              {formError}
            </div>
          )}

          {lastOutcome && (
            <div
              role="status"
              className={`p-3.5 rounded border text-xs space-y-1.5 ${
                lastOutcome.accepted
                  ? 'bg-emerald-950/30 border-emerald-800/70 text-emerald-200'
                  : 'bg-rose-950/30 border-rose-800/70 text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {lastOutcome.accepted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                  )}
                  {lastOutcome.accepted
                    ? `Emitted WhaleCandidate (${lastOutcome.candidate?.option_symbol}) — Score ${lastOutcome.candidate?.whale_score}/100 [${lastOutcome.candidate?.status}]`
                    : lastOutcome.deduplicated
                      ? 'Suppressed Duplicate Print (Idempotent Filter)'
                      : 'Hard Reject Rule Triggered — Candidate Suppressed'}
                </span>
                <span className="font-mono text-[11px]">
                  event_id: {lastOutcome.event_id}
                </span>
              </div>
              {lastOutcome.accepted && lastOutcome.candidate?.aggregation && (
                <div className="p-2 rounded bg-[#0B0F17]/70 border border-emerald-500/30 font-mono text-[11px] text-emerald-200 space-y-0.5">
                  <div className="font-semibold text-sky-300">
                    Contract Activity Aggregation:{' '}
                    {lastOutcome.candidate.aggregation.aggregated_print_count}{' '}
                    Prints · VWAP $
                    {lastOutcome.candidate.aggregation.vwap_fill_price.toFixed(
                      2
                    )}{' '}
                    ·{' '}
                    {lastOutcome.candidate.aggregation.price_progression.replace(
                      /_/g,
                      ' '
                    )}
                  </div>
                  <div className="text-slate-300">
                    {lastOutcome.candidate.aggregation.aggregation_summary}
                  </div>
                </div>
              )}
              {lastOutcome.reject_reasons.length > 0 && (
                <ul className="list-disc list-inside font-mono text-[11px] space-y-0.5">
                  {lastOutcome.reject_reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Right 5 cols: Persisted Raw WS Log & Hard Reject Audit Log */}
        <div className="lg:col-span-5 space-y-6">
          <section
            aria-label="Hard Reject Audit Log"
            className="border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>Section 7 Hard-Rejected Prints</span>
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {rejectedPrints.length} blocked
              </span>
            </div>
            <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
              {rejectedPrints.map((item) => (
                <div
                  key={item.reject_id}
                  className="p-2.5 rounded bg-[#0B0F17] border border-slate-800/80 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-semibold text-slate-200">
                      {item.option_symbol}
                    </span>
                    <span className="text-slate-400">
                      ${(item.premium / 1000).toFixed(0)}K
                    </span>
                  </div>
                  <div className="text-rose-400 font-mono text-[11px]">
                    Reason: {item.reasons.join('; ')}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-label="Persisted Raw WebSocket Messages"
            className="border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Database className="w-4 h-4 text-sky-400" />
                <span>Persisted Pre-Aggregation WebSocket Log</span>
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {activeWsChannels.length} channels active
              </span>
            </div>
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 font-mono text-[11px]">
              {rawWsMessages.slice(0, 12).map((msg) => (
                <div
                  key={msg.msg_id}
                  className="p-2 rounded bg-[#0B0F17] border border-slate-800/70 flex items-center justify-between gap-2"
                >
                  <div className="truncate">
                    <span className="text-sky-400">{msg.channel}</span>
                    <span className="text-slate-500 mx-1.5">·</span>
                    <span className="text-slate-300">
                      {msg.payload_summary}
                    </span>
                  </div>
                  <span className="text-slate-500 shrink-0">
                    {msg.deduplicated ? 'DUP_SKIP' : 'ACK'}
                  </span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-slate-800/70 text-[11px] font-mono text-slate-400 flex items-center gap-1.5 flex-wrap">
              <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Subscribed Channels:</span>
              <span className="text-slate-300">
                {activeWsChannels.slice(0, 8).join(' · ')}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
