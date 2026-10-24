import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type WhaleCandidate,
  clamp,
} from '../engine/whaleScannerEngine';
import type { AiAnalysisActivityEntry } from '../engine/activityMonitorEngine';
import type { LlmTradeDecisionRecord } from '../engine/llmTradeDecisionEngine';
import type { SmartOrderExecutionTicket } from '../engine/smartOrderEngine';
import type { MarketTideState } from '../engine/whalePipelineRuntime';
import {
  type CandidateChartEventCategory,
  type CandidateTimelineEvent,
  type ChartZoomPreset,
  type ChartZoomRange,
  buildCandidateOptionEventChartModel,
  computeChartZoomWindow,
  getChartZoomPresetRange,
  panChartZoomRange,
  resolveEventCalloutPositions,
  zoomRangeByFactor,
} from '../engine/candidateEventChartEngine';
import { CandidateInspector } from './CandidateInspector';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Zap,
  BrainCircuit,
  Crosshair,
  Clock,
  Activity,
  ShieldCheck,
  Target,
  Layers,
  PlusCircle,
  Maximize2,
  Minimize2,
  Magnet,
  Flame,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Focus,
} from 'lucide-react';

interface CandidateDetailChartViewProps {
  candidate: WhaleCandidate;
  allCandidates: WhaleCandidate[];
  marketTide?: MarketTideState;
  aiLogs: AiAnalysisActivityEntry[];
  llmDecisionRecords: LlmTradeDecisionRecord[];
  smartOrderTickets: SmartOrderExecutionTicket[];
  onSelectCandidate: (candidateId: string) => void;
  onBackToTable: () => void;
  onRunAiDecisionGate?: (candidate: WhaleCandidate) => void;
  onStageSmartOrder?: (candidate: WhaleCandidate) => void;
  onSimulateRepeatPrint?: (candidate: WhaleCandidate) => void;
  onOpenRegimeStrategy?: (candidate: WhaleCandidate) => void;
}

const EVENT_CATEGORY_META: Record<
  CandidateChartEventCategory,
  {
    label: string;
    dotColor: string;
    strokeColor: string;
    textColor: string;
    badgeBg: string;
  }
> = {
  whale_print: {
    label: 'Whale Print',
    dotColor: '#38bdf8', // sky-400
    strokeColor: '#0284c7',
    textColor: 'text-sky-300',
    badgeBg: 'bg-sky-950/60 border-sky-500/50 text-sky-300',
  },
  confirmation: {
    label: '5m Confirmation',
    dotColor: '#a78bfa', // violet-400
    strokeColor: '#7c3aed',
    textColor: 'text-violet-300',
    badgeBg: 'bg-violet-950/60 border-violet-500/50 text-violet-300',
  },
  ai_decision: {
    label: 'AI Decision Gate',
    dotColor: '#f59e0b', // amber-400
    strokeColor: '#d97706',
    textColor: 'text-amber-300',
    badgeBg: 'bg-amber-950/60 border-amber-500/50 text-amber-200',
  },
  smart_execution: {
    label: 'Smart Execution',
    dotColor: '#10b981', // emerald-500
    strokeColor: '#059669',
    textColor: 'text-emerald-300',
    badgeBg: 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300',
  },
  outcome_milestone: {
    label: 'Outcome & Verdict',
    dotColor: '#f43f5e', // rose-500 or emerald handled dynamically
    strokeColor: '#e11d48',
    textColor: 'text-emerald-200',
    badgeBg: 'bg-slate-900/90 border-slate-600 text-slate-200',
  },
};

export const CandidateDetailChartView: React.FC<
  CandidateDetailChartViewProps
> = ({
  candidate,
  allCandidates,
  marketTide,
  aiLogs,
  llmDecisionRecords,
  smartOrderTickets,
  onSelectCandidate,
  onBackToTable,
  onRunAiDecisionGate,
  onStageSmartOrder,
  onSimulateRepeatPrint,
  onOpenRegimeStrategy,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | CandidateChartEventCategory
  >('all');
  const [showNbboBand, setShowNbboBand] = useState<boolean>(true);
  const [showTargetStopLines, setShowTargetStopLines] = useState<boolean>(true);
  const [showUnderlyingOverlay, setShowUnderlyingOverlay] =
    useState<boolean>(true);
  const [showGexOverlay, setShowGexOverlay] = useState<boolean>(true);
  const [isChartExpanded, setIsChartExpanded] = useState<boolean>(false);
  const [isFullscreenModal, setIsFullscreenModal] = useState<boolean>(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredPointIdx, setHoveredPointIdx] = useState<number | null>(null);

  // Interactive Zoom & Pan State
  const [zoomRange, setZoomRange] = useState<ChartZoomRange>({
    startFrac: 0,
    endFrac: 1,
    preset: 'full',
  });
  const [autoScaleY, setAutoScaleY] = useState<boolean>(true);
  const [dragBrush, setDragBrush] = useState<{
    startSvgX: number;
    currentSvgX: number;
  } | null>(null);

  const chartSectionRef = useRef<HTMLElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const chartModel = useMemo(
    () =>
      buildCandidateOptionEventChartModel({
        candidate,
        marketTide,
        aiLogs,
        llmDecisionRecords,
        smartOrderTickets,
      }),
    [candidate, marketTide, aiLogs, llmDecisionRecords, smartOrderTickets]
  );

  // Reset zoom to full session when switching candidate
  useEffect(() => {
    setZoomRange({ startFrac: 0, endFrac: 1, preset: 'full' });
    setSelectedEventId(null);
    setHoveredPointIdx(null);
  }, [candidate.candidate_id]);

  // Lock background page scroll when chart is expanded or fullscreen so page never moves while inspecting
  useEffect(() => {
    const expanded = isChartExpanded || isFullscreenModal;
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isChartExpanded, isFullscreenModal]);

  const fullSeries = chartModel.price_series;

  const categoryFilteredEvents = useMemo(() => {
    if (categoryFilter === 'all') return chartModel.events;
    return chartModel.events.filter((e) => e.category === categoryFilter);
  }, [chartModel.events, categoryFilter]);

  const outcome = chartModel.outcome_evaluation;
  const gexLayer = chartModel.gamma_exposure_layer;
  const isBull = candidate.direction === 'bullish';

  // Compute Zoom Window (visible series slice, visible events, and auto-fitted Y-axis bounds)
  const zoomWindow = useMemo(
    () =>
      computeChartZoomWindow({
        series: fullSeries,
        events: categoryFilteredEvents,
        range: zoomRange,
        autoScaleY,
        showTargetStopLines,
        showGexOverlay,
        referenceLevels: chartModel.reference_levels,
        gexLayer,
      }),
    [
      fullSeries,
      categoryFilteredEvents,
      zoomRange,
      autoScaleY,
      showTargetStopLines,
      showGexOverlay,
      chartModel.reference_levels,
      gexLayer,
    ]
  );

  const series = zoomWindow.visibleSeries;
  const filteredEvents = zoomWindow.visibleEvents;
  const isZoomed = zoomWindow.zoomFactor > 1.03;

  // Keep activeEvent stable during mouse hover so cards and HUD never resize or shift page scroll on mouse move
  const activeEvent: CandidateTimelineEvent = useMemo(() => {
    if (selectedEventId) {
      const found = chartModel.events.find((e) => e.event_id === selectedEventId);
      if (found) return found;
    }
    const stage1Evt = chartModel.events.find(
      (e) => e.event_type === 'STAGE1_AI_DECISION'
    );
    return stage1Evt ?? chartModel.events[chartModel.events.length - 1];
  }, [selectedEventId, chartModel]);

  // Helper to center zoom window around a specific timeline event
  const focusZoomOnEvent = (
    evt: CandidateTimelineEvent,
    targetSpan = 0.24
  ) => {
    if (fullSeries.length <= 4) return;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < fullSeries.length; i++) {
      const d = Math.abs(fullSeries[i].timestamp_ms - evt.timestamp_ms);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const centerFrac = bestIdx / Math.max(1, fullSeries.length - 1);
    const half = clamp(targetSpan / 2, 0.08, 0.5);
    let startFrac = clamp(centerFrac - half, 0, 1 - targetSpan);
    let endFrac = clamp(startFrac + targetSpan, targetSpan, 1);
    setZoomRange({
      startFrac: Number(startFrac.toFixed(4)),
      endFrac: Number(endFrac.toFixed(4)),
      preset: 'custom',
    });
  };

  // Step to previous or next event and keep it inside the visible zoom window
  const stepActiveEvent = (direction: -1 | 1) => {
    const targetSeq = clamp(
      activeEvent.sequence_index + direction,
      1,
      chartModel.events.length
    );
    const nextEvt = chartModel.events.find(
      (e) => e.sequence_index === targetSeq
    );
    if (!nextEvt) return;
    setSelectedEventId(nextEvt.event_id);
    if (
      isZoomed &&
      (nextEvt.timestamp_ms < zoomWindow.startMs ||
        nextEvt.timestamp_ms > zoomWindow.endMs)
    ) {
      const curSpan = clamp(
        zoomRange.endFrac - zoomRange.startFrac,
        0.16,
        1
      );
      focusZoomOnEvent(nextEvt, curSpan);
    }
  };

  // Keyboard shortcuts for fast chart inspection (+ / - / 0 / Left / Right / Esc)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        if (isFullscreenModal) setIsFullscreenModal(false);
        else if (isChartExpanded) setIsChartExpanded(false);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomRange((prev) => zoomRangeByFactor(prev, 1.45));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomRange((prev) => zoomRangeByFactor(prev, 1 / 1.45));
      } else if (e.key === '0') {
        setZoomRange({ startFrac: 0, endFrac: 1, preset: 'full' });
      } else if (e.key === '[') {
        stepActiveEvent(-1);
      } else if (e.key === ']') {
        stepActiveEvent(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // SVG Geometry Calculations (adapts dynamically when chart is expanded to fit screen)
  const expandedLayout = isChartExpanded || isFullscreenModal;
  const svgWidth = expandedLayout ? 1320 : 1080;
  const svgHeight = expandedLayout ? 460 : 425;
  const gexGutterWidth = showGexOverlay ? (expandedLayout ? 155 : 130) : 0;
  const padLeft = 64;
  const padRight = 72 + gexGutterWidth;
  const padTop = 34;
  const padBottom = 44;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const {
    minOptPrice,
    maxOptPrice,
    optPriceSpan,
    minUndPrice,
    maxUndPrice,
    undPriceSpan,
  } = zoomWindow;

  const getX = (index: number) => {
    if (series.length <= 1) return padLeft;
    return padLeft + (index / (series.length - 1)) * plotW;
  };

  const getXFromTimestamp = (ms: number) => {
    const startMs = series[0]?.timestamp_ms ?? 0;
    const endMs = series[series.length - 1]?.timestamp_ms ?? startMs + 1;
    const exactIdx = series.findIndex((p) => p.timestamp_ms === ms);
    if (exactIdx >= 0) return getX(exactIdx);
    // Find bracketing points in visible series for piecewise linear interpolation
    for (let i = 0; i < series.length - 1; i++) {
      const t0 = series[i].timestamp_ms;
      const t1 = series[i + 1].timestamp_ms;
      if (ms >= t0 && ms <= t1) {
        const subFrac = (ms - t0) / Math.max(1, t1 - t0);
        return getX(i) + subFrac * (getX(i + 1) - getX(i));
      }
    }
    const frac = Math.max(
      0,
      Math.min(1, (ms - startMs) / Math.max(1, endMs - startMs))
    );
    return padLeft + frac * plotW;
  };

  const getYOpt = (price: number) => {
    const frac = (price - minOptPrice) / optPriceSpan;
    return padTop + plotH - Math.max(0, Math.min(1, frac)) * plotH;
  };

  const getYOptRaw = (price: number) => {
    const frac = (price - minOptPrice) / optPriceSpan;
    return padTop + plotH - frac * plotH;
  };

  const getYUnd = (spot: number) => {
    const frac = (spot - minUndPrice) / undPriceSpan;
    return padTop + plotH - Math.max(0, Math.min(1, frac)) * plotH;
  };

  const getYUndRaw = (spot: number) => {
    const frac = (spot - minUndPrice) / undPriceSpan;
    return padTop + plotH - frac * plotH;
  };

  const isOptInPlotY = (price: number) => {
    const rawY = getYOptRaw(price);
    return rawY >= padTop - 6 && rawY <= padTop + plotH + 6;
  };

  const isUndInPlotY = (spot: number) => {
    const rawY = getYUndRaw(spot);
    return rawY >= padTop - 6 && rawY <= padTop + plotH + 6;
  };

  // Convert client mouse X to SVG X coordinate
  const clientXToSvgX = (clientX: number): number | null => {
    const svgEl = svgRef.current;
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const relX = ((clientX - rect.left) / rect.width) * svgWidth;
    return clamp(relX, padLeft, padLeft + plotW);
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const svgX = clientXToSvgX(e.clientX);
    if (svgX === null) return;
    setDragBrush({ startSvgX: svgX, currentSvgX: svgX });
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgX = clientXToSvgX(e.clientX);
    if (svgX === null) return;
    if (dragBrush) {
      setDragBrush((prev) =>
        prev ? { ...prev, currentSvgX: svgX } : null
      );
    }
    // Update hoveredPointIdx only when index actually changes to prevent redundant re-renders
    const plotFrac = clamp((svgX - padLeft) / Math.max(1, plotW), 0, 1);
    const idx = Math.round(plotFrac * Math.max(0, series.length - 1));
    if (idx >= 0 && idx < series.length) {
      setHoveredPointIdx((prev) => (prev === idx ? prev : idx));
    }
  };

  const handleSvgMouseUp = () => {
    if (!dragBrush) return;
    const minX = Math.min(dragBrush.startSvgX, dragBrush.currentSvgX);
    const maxX = Math.max(dragBrush.startSvgX, dragBrush.currentSvgX);
    setDragBrush(null);

    // Require at least 28px drag to trigger marquee zoom (otherwise treat as normal click)
    if (maxX - minX < 28) return;

    const localStartFrac = clamp((minX - padLeft) / Math.max(1, plotW), 0, 1);
    const localEndFrac = clamp((maxX - padLeft) / Math.max(1, plotW), 0, 1);
    const curSpan = zoomWindow.endFrac - zoomWindow.startFrac;
    const nextStart = clamp(
      zoomWindow.startFrac + localStartFrac * curSpan,
      0,
      0.86
    );
    const nextEnd = clamp(
      zoomWindow.startFrac + localEndFrac * curSpan,
      nextStart + 0.14,
      1
    );

    setZoomRange({
      startFrac: Number(nextStart.toFixed(4)),
      endFrac: Number(nextEnd.toFixed(4)),
      preset: 'custom',
    });
    setHoveredPointIdx(null);
  };

  // Native non-passive wheel listener on the SVG so wheel-zooming on the chart NEVER scrolls the page
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = svgEl.getBoundingClientRect();
      const relX =
        rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * svgWidth : padLeft + plotW / 2;
      const clampedSvgX = clamp(relX, padLeft, padLeft + plotW);
      const localFrac = clamp((clampedSvgX - padLeft) / Math.max(1, plotW), 0, 1);
      const anchorGlobalFrac =
        zoomWindow.startFrac +
        localFrac * (zoomWindow.endFrac - zoomWindow.startFrac);
      const factor = e.deltaY < 0 ? 1.32 : 1 / 1.32;
      setZoomRange((prev) => zoomRangeByFactor(prev, factor, anchorGlobalFrac));
    };
    svgEl.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      svgEl.removeEventListener('wheel', onNativeWheel);
    };
  }, [svgWidth, padLeft, plotW, zoomWindow.startFrac, zoomWindow.endFrac]);

  const optionLinePath = useMemo(() => {
    return series
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getYOpt(p.option_price).toFixed(1)}`
      )
      .join(' ');
  }, [series, minOptPrice, maxOptPrice, plotW, plotH]);

  const optionAreaPath = useMemo(() => {
    if (series.length === 0) return '';
    return `${optionLinePath} L ${getX(series.length - 1).toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${padLeft.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;
  }, [optionLinePath, series.length, plotW, plotH]);

  const nbboBandPolygonPath = useMemo(() => {
    if (series.length === 0) return '';
    const upper = series
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getYOpt(p.option_ask).toFixed(1)}`
      )
      .join(' ');
    const lower = [...series]
      .reverse()
      .map(
        (p, revIdx) =>
          `L ${getX(series.length - 1 - revIdx).toFixed(1)} ${getYOpt(p.option_bid).toFixed(1)}`
      )
      .join(' ');
    return `${upper} ${lower} Z`;
  }, [series, minOptPrice, maxOptPrice, plotW, plotH]);

  const underlyingLinePath = useMemo(() => {
    return series
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getYUnd(p.underlying_price).toFixed(1)}`
      )
      .join(' ');
  }, [series, minUndPrice, maxUndPrice, plotW, plotH]);

  // Mini-map full-session sparkline path (0..1000 x 0..32)
  const miniMapSparklinePath = useMemo(() => {
    if (fullSeries.length === 0) return '';
    const prices = fullSeries.map((p) => p.option_price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const span = Math.max(0.05, hi - lo);
    return fullSeries
      .map((p, i) => {
        const x = (i / Math.max(1, fullSeries.length - 1)) * 1000;
        const y = 28 - ((p.option_price - lo) / span) * 22;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [fullSeries]);

  const yTicks = useMemo(() => {
    const count = expandedLayout ? 7 : 6;
    const ticks: Array<{ price: number; y: number; undPrice: number }> = [];
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const price = minOptPrice + frac * optPriceSpan;
      const undPrice = minUndPrice + frac * undPriceSpan;
      ticks.push({
        price,
        undPrice,
        y: getYOpt(price),
      });
    }
    return ticks.reverse();
  }, [minOptPrice, optPriceSpan, minUndPrice, undPriceSpan, expandedLayout, plotH]);

  const resolvedCalloutMap = useMemo(() => {
    const fixedObstacles: Array<{
      cx: number;
      cy: number;
      width: number;
      height: number;
    }> = [];

    if (showGexOverlay) {
      if (isUndInPlotY(gexLayer.call_wall)) {
        fixedObstacles.push({
          cx: padLeft + plotW - 245,
          cy: getYUnd(gexLayer.call_wall) - 8,
          width: 162,
          height: 18,
        });
      }
      if (isUndInPlotY(gexLayer.gamma_magnet)) {
        fixedObstacles.push({
          cx: padLeft + plotW - 415,
          cy: getYUnd(gexLayer.gamma_magnet) - 8,
          width: 154,
          height: 18,
        });
      }
      if (isUndInPlotY(gexLayer.gamma_flip)) {
        fixedObstacles.push({
          cx: padLeft + 255,
          cy: getYUnd(gexLayer.gamma_flip) - 8,
          width: 148,
          height: 18,
        });
      }
      if (isUndInPlotY(gexLayer.put_wall)) {
        fixedObstacles.push({
          cx: padLeft + plotW - 245,
          cy: getYUnd(gexLayer.put_wall) - 8,
          width: 158,
          height: 18,
        });
      }
    }

    if (showTargetStopLines) {
      if (isOptInPlotY(chartModel.reference_levels.planned_target1_price)) {
        fixedObstacles.push({
          cx: padLeft + plotW - 60,
          cy: getYOpt(chartModel.reference_levels.planned_target1_price) - 8,
          width: 120,
          height: 18,
        });
      }
      if (isOptInPlotY(chartModel.reference_levels.planned_stop_price)) {
        fixedObstacles.push({
          cx: padLeft + plotW - 60,
          cy: getYOpt(chartModel.reference_levels.planned_stop_price) + 8,
          width: 120,
          height: 18,
        });
      }
    }

    const refFillOrGate =
      chartModel.reference_levels.smart_fill_price ??
      chartModel.reference_levels.ai_decision_price;
    if (showTargetStopLines && isOptInPlotY(refFillOrGate)) {
      fixedObstacles.push({
        cx: padLeft + 62,
        cy: getYOpt(refFillOrGate) - 8,
        width: 118,
        height: 18,
      });
    }

    const positions = resolveEventCalloutPositions({
      events: filteredEvents,
      getAnchorX: (evt) => getXFromTimestamp(evt.timestamp_ms),
      getAnchorY: (evt) => getYOpt(evt.option_price),
      minX: padLeft + 4,
      maxX: padLeft + plotW - 4,
      minY: padTop + 6,
      maxY: padTop + plotH - 6,
      fixedObstacles,
    });
    const map = new Map<string, (typeof positions)[number]>();
    for (const pos of positions) {
      map.set(pos.event_id, pos);
    }
    return map;
  }, [
    filteredEvents,
    series,
    minOptPrice,
    maxOptPrice,
    minUndPrice,
    maxUndPrice,
    plotW,
    plotH,
    showGexOverlay,
    showTargetStopLines,
  ]);

  const xTickPoints = useMemo(() => {
    if (series.length === 0) return [];
    const step = Math.max(1, Math.floor(series.length / (expandedLayout ? 8 : 6)));
    return series
      .map((pt, localIdx) => ({ pt, localIdx }))
      .filter((_, i) => {
        if (i === 0 || i === series.length - 1) return true;
        // Avoid placing a periodic tick right next to the final point
        if (series.length - 1 - i < Math.max(2, Math.floor(step * 0.65))) {
          return false;
        }
        return i % step === 0;
      });
  }, [series, expandedLayout]);

  const hoveredPoint =
    hoveredPointIdx !== null ? series[hoveredPointIdx] ?? null : null;

  return (
    <div
      data-testid="candidate-detail-event-chart"
      className="space-y-4"
    >
      {/* Top Navigation & Candidate Switcher Bar */}
      <section
        aria-label="Candidate Detail Chart Header"
        className="rounded-lg border border-slate-800 bg-[#111726] p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="back-to-flow-discovery-btn"
              onClick={onBackToTable}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-700 bg-[#0B0F17] hover:border-sky-400 hover:text-sky-300 text-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Flow Discovery Table</span>
            </button>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-bold text-slate-100 tracking-tight">
                  {chartModel.contract_label}
                </h1>
                <span className="text-xs font-mono text-slate-400">
                  · {candidate.option_symbol}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ·{' '}
                  <strong
                    className={
                      isBull ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {candidate.direction.toUpperCase()}
                  </strong>
                </span>
                <span className="text-xs font-mono text-sky-400">
                  · Score {candidate.whale_score} (70/30: {chartModel.composite_score})
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Option Price Trajectory, Associated Pipeline Events (Whale Prints → 5m Confirmation → Stage-1/2 AI Gate → Smart Execution) &amp; Decision Validation
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onSimulateRepeatPrint && (
              <button
                type="button"
                onClick={() => onSimulateRepeatPrint(candidate)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-sky-500/50 bg-sky-950/40 hover:bg-sky-900/50 text-sky-300 transition-colors whitespace-nowrap"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Inject Repeat Print</span>
              </button>
            )}
            {onRunAiDecisionGate && (
              <button
                type="button"
                onClick={() => onRunAiDecisionGate(candidate)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-amber-500/50 bg-amber-950/40 hover:bg-amber-900/50 text-amber-200 transition-colors whitespace-nowrap"
              >
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>Inspect AI Decision Gate</span>
              </button>
            )}
            {onStageSmartOrder && (
              <button
                type="button"
                onClick={() => onStageSmartOrder(candidate)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors whitespace-nowrap"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Stage Smart Order</span>
              </button>
            )}
          </div>
        </div>

        {/* Quick Candidate Switcher Strip */}
        <div className="pt-2.5 border-t border-slate-800/80 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap mr-1">
            Switch Candidate:
          </span>
          {allCandidates.slice(0, 12).map((cand) => {
            const active = cand.candidate_id === candidate.candidate_id;
            return (
              <button
                key={cand.candidate_id}
                type="button"
                data-testid={`candidate-chart-switcher-${cand.ticker}`}
                onClick={() => {
                  setSelectedEventId(null);
                  setHoveredPointIdx(null);
                  onSelectCandidate(cand.candidate_id);
                }}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-colors whitespace-nowrap shrink-0 border ${
                  active
                    ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                    : 'bg-[#0B0F17] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-slate-100'
                }`}
              >
                <span>{cand.ticker}</span>{' '}
                <span className={active ? 'text-slate-900' : 'text-slate-400'}>
                  ${cand.strike}
                  {cand.option_type === 'call' ? 'C' : 'P'}
                </span>{' '}
                <span
                  className={
                    active
                      ? 'text-slate-950'
                      : cand.whale_score >= 80
                        ? 'text-emerald-400'
                        : 'text-sky-400'
                  }
                >
                  ({cand.whale_score})
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Decision Accuracy & Post-Event Outcome Verdict Banner */}
      <section
        aria-label="Decision Accuracy and Outcome Verdict"
        data-testid="decision-outcome-verdict-card"
        className={`rounded-lg border p-4 space-y-3 ${
          outcome.is_decision_correct
            ? 'border-emerald-500/40 bg-[#0F1B1D]'
            : 'border-amber-500/40 bg-[#1B1712]'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span
                data-testid="decision-verdict-badge"
                className={`inline-flex items-center gap-1.5 font-bold ${
                  outcome.is_decision_correct
                    ? 'text-emerald-300'
                    : 'text-amber-300'
                }`}
              >
                {outcome.is_decision_correct ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                )}
                <span>{outcome.verdict_badge}</span>
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-300">
                Stage-1 AI Gate:{' '}
                <strong
                  className={
                    outcome.decision === 'EXECUTE'
                      ? 'text-emerald-400'
                      : outcome.decision === 'WATCH'
                        ? 'text-amber-300'
                        : 'text-rose-300'
                  }
                >
                  {outcome.decision}
                </strong>{' '}
                ({outcome.conviction_score}/100)
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-300">
                Stage-2 Risk Gate:{' '}
                <strong className="text-sky-300">
                  {outcome.stage2_risk_decision}
                </strong>
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-300">
                Decision Audit Grade:{' '}
                <strong className="text-emerald-300">
                  {outcome.confidence_grade}
                </strong>
              </span>
            </div>

            <h2 className="text-sm md:text-base font-bold text-slate-100">
              {outcome.verdict_headline}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              {outcome.verdict_explanation}
            </p>
          </div>

          <div className="text-right font-mono tabular-nums shrink-0 bg-[#0B0F17]/90 border border-slate-800 rounded-md px-3.5 py-2">
            <div className="text-[11px] text-slate-400">
              {outcome.decision === 'SKIP'
                ? 'Avoided Drawdown Savings'
                : 'Post-Decision Contract P/L'}
            </div>
            <div
              data-testid="decision-verdict-pnl-value"
              className={`text-lg font-bold ${
                outcome.total_position_pnl_dollars >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {outcome.total_position_pnl_dollars >= 0 ? '+' : '-'}$
              {Math.abs(outcome.total_position_pnl_dollars).toFixed(0)}{' '}
              <span className="text-xs font-normal text-slate-300">
                ({outcome.return_since_decision_pct >= 0 ? '+' : ''}
                {outcome.return_since_decision_pct.toFixed(1)}%)
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              {outcome.decision === 'SKIP'
                ? `Saved $${Math.abs(outcome.dollar_pnl_per_contract).toFixed(0)}/ct by skipping`
                : `${outcome.permitted_contracts} ct${outcome.permitted_contracts > 1 ? 's' : ''} · ${outcome.dollar_pnl_per_contract >= 0 ? '+' : '-'}$${Math.abs(outcome.dollar_pnl_per_contract).toFixed(0)}/ct`}
            </div>
          </div>
        </div>

        {/* 6 Quantitative Benchmark Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-800/80 font-mono tabular-nums">
          <div className="bg-[#0B0F17]/80 border border-slate-800/90 rounded p-2.5">
            <div className="text-[11px] text-slate-400">1. Detection Price</div>
            <div className="text-sm font-bold text-sky-300 mt-0.5">
              ${outcome.price_at_detection.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Whale VWAP ${chartModel.reference_levels.vwap_fill_price.toFixed(2)}
            </div>
          </div>

          <div className="bg-[#0B0F17]/80 border border-slate-800/90 rounded p-2.5">
            <div className="text-[11px] text-slate-400">2. AI Decision Price</div>
            <div className="text-sm font-bold text-amber-300 mt-0.5">
              ${outcome.price_at_ai_decision.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Gate: {outcome.decision} ({outcome.conviction_score}%)
            </div>
          </div>

          <div className="bg-[#0B0F17]/80 border border-slate-800/90 rounded p-2.5">
            <div className="text-[11px] text-slate-400">3. Smart Order Fill</div>
            <div className="text-sm font-bold text-emerald-300 mt-0.5">
              {outcome.smart_order_fill_price !== null
                ? `$${outcome.smart_order_fill_price.toFixed(2)}`
                : 'No Order (Gate)'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {outcome.smart_order_fill_price !== null
                ? `Saved +$${outcome.smart_execution_savings_dollars.toFixed(0)} vs Ask`
                : `Limit Ref $${outcome.planned_entry_limit.toFixed(2)}`}
            </div>
          </div>

          <div className="bg-[#0B0F17]/80 border border-slate-800/90 rounded p-2.5">
            <div className="text-[11px] text-slate-400">4. Peak Excursion (MFE)</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">
              ${outcome.post_decision_high_price.toFixed(2)}{' '}
              <span className="text-xs">
                ({outcome.max_favorable_excursion_pct >= 0 ? '+' : ''}
                {outcome.max_favorable_excursion_pct.toFixed(1)}%)
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Target 1: ${outcome.planned_target1_price.toFixed(2)}{' '}
              {outcome.target1_reached ? '(HIT)' : ''}
            </div>
          </div>

          <div className="bg-[#0B0F17]/80 border border-slate-800/90 rounded p-2.5">
            <div className="text-[11px] text-slate-400">5. Max Drawdown (MAE)</div>
            <div className="text-sm font-bold text-rose-300 mt-0.5">
              ${outcome.post_decision_low_price.toFixed(2)}{' '}
              <span className="text-xs">
                ({outcome.max_adverse_excursion_pct.toFixed(1)}%)
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Hard Stop: ${outcome.planned_stop_price.toFixed(2)}{' '}
              {outcome.stop_breached ? '(BREACHED)' : '(HELD)'}
            </div>
          </div>

          <div className="bg-[#0B0F17]/80 border border-slate-800/90 rounded p-2.5">
            <div className="text-[11px] text-slate-400">6. Latest Option Mark</div>
            <div className="text-sm font-bold text-slate-100 mt-0.5">
              ${outcome.latest_option_price.toFixed(2)}
            </div>
            <div
              className={`text-[10px] mt-0.5 ${
                outcome.return_since_detection_pct >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {outcome.return_since_detection_pct >= 0 ? '+' : ''}
              {outcome.return_since_detection_pct.toFixed(1)}% vs Detection
            </div>
          </div>
        </div>
      </section>

      {/* Main Option Price, Gamma Exposure (GEX) Walls/Magnet & Event Timeline Chart + Active Event Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <section
          ref={chartSectionRef}
          aria-label="Option Price and Event Timeline Chart"
          data-expanded={expandedLayout ? 'true' : 'false'}
          data-zoom-factor={zoomWindow.zoomFactor.toFixed(2)}
          className={`${
            expandedLayout
              ? 'fixed inset-2 z-50 flex flex-col justify-between border-2 border-sky-500/60 shadow-2xl overflow-hidden'
              : 'lg:col-span-8 border border-slate-800 space-y-2.5'
          } rounded-lg bg-[#111726] p-3.5`}
        >
          {/* Row 1: Chart Title, Layer Checkboxes & Expand / Fit-Screen Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100">
                  Option Price Curve, GEX Walls/Magnet &amp; Pipeline Events (
                  {filteredEvents.length}/{categoryFilteredEvents.length} Visible)
                </h2>
                <span className="text-[11px] font-mono text-cyan-300">
                  · {gexLayer.wall_interaction_badge}
                </span>
                <span
                  data-testid="chart-zoom-status-badge"
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                    isZoomed
                      ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  {zoomWindow.windowLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Drag horizontally on chart to marquee-zoom into any cluster, use Focus Presets below, or click any numbered marker (#1–#{chartModel.events.length}).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNbboBand}
                  onChange={(e) => setShowNbboBand(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                />
                <span>NBBO Band</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTargetStopLines}
                  onChange={(e) => setShowTargetStopLines(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-emerald-400"
                />
                <span>Stop &amp; Target</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showUnderlyingOverlay}
                  onChange={(e) => setShowUnderlyingOverlay(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-violet-400"
                />
                <span>Underlying ({candidate.ticker})</span>
              </label>

              <label className="inline-flex items-center gap-1.5 text-cyan-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="toggle-gex-walls-magnet-checkbox"
                  checked={showGexOverlay}
                  onChange={(e) => setShowGexOverlay(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-cyan-400"
                />
                <span>GEX Walls &amp; Magnet</span>
              </label>

              <button
                type="button"
                data-testid="expand-candidate-chart-btn"
                onClick={() => setIsChartExpanded((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded border transition-colors whitespace-nowrap ${
                  isChartExpanded
                    ? 'bg-sky-500 text-slate-950 border-sky-400'
                    : 'bg-[#0B0F17] text-sky-300 border-sky-500/50 hover:bg-sky-950/60'
                }`}
              >
                {isChartExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {isChartExpanded ? 'Collapse Chart' : 'Expand Chart'}
                </span>
              </button>

              <button
                type="button"
                data-testid="fullscreen-candidate-chart-btn"
                onClick={() => setIsFullscreenModal((prev) => !prev)}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-mono rounded border transition-colors whitespace-nowrap ${
                  isFullscreenModal
                    ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                    : 'bg-[#0B0F17] text-slate-300 border-slate-700 hover:border-slate-500'
                }`}
              >
                <span>{isFullscreenModal ? 'Exit Fullscreen' : 'Fullscreen'}</span>
              </button>
            </div>
          </div>

          {/* Row 2: Interactive Zoom & Focus Presets Bar + Event Category Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Zoom & Focus Preset Controls */}
            <div
              role="group"
              aria-label="Chart Zoom and Focus Controls"
              data-testid="chart-zoom-controls-bar"
              className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] rounded-md border border-slate-800 text-xs font-mono"
            >
              <span className="px-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Zoom:
              </span>
              {(
                [
                  { id: 'full', label: '1x Full' },
                  { id: 'burst_gate', label: '🔍 Burst & AI Gate' },
                  { id: 'execution', label: '⚡ Execution' },
                  { id: 'outcome', label: '🎯 Outcome' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`chart-zoom-preset-${preset.id}`}
                  onClick={() =>
                    setZoomRange(
                      getChartZoomPresetRange(
                        preset.id,
                        fullSeries,
                        chartModel.events
                      )
                    )
                  }
                  className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                    zoomRange.preset === preset.id
                      ? 'bg-sky-500 text-slate-950 font-bold'
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  {preset.label}
                </button>
              ))}

              <div className="h-4 w-px bg-slate-800 mx-0.5" />

              <button
                type="button"
                data-testid="chart-zoom-in-btn"
                title="Zoom In (+ key)"
                onClick={() =>
                  setZoomRange((prev) => zoomRangeByFactor(prev, 1.5))
                }
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-700/80 bg-slate-900 hover:border-sky-400 text-slate-200 transition-colors"
              >
                <ZoomIn className="w-3 h-3 text-sky-400" />
                <span>+</span>
              </button>

              <button
                type="button"
                data-testid="chart-zoom-out-btn"
                title="Zoom Out (- key)"
                disabled={!isZoomed}
                onClick={() =>
                  setZoomRange((prev) => zoomRangeByFactor(prev, 1 / 1.5))
                }
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-slate-700/80 bg-slate-900 hover:border-sky-400 text-slate-200 disabled:opacity-40 transition-colors"
              >
                <ZoomOut className="w-3 h-3 text-sky-400" />
                <span>-</span>
              </button>

              <button
                type="button"
                data-testid="chart-pan-left-btn"
                title="Pan Window Left"
                disabled={zoomWindow.startFrac <= 0.001}
                onClick={() =>
                  setZoomRange((prev) => panChartZoomRange(prev, -0.12))
                }
                className="inline-flex items-center px-1.5 py-1 text-[11px] rounded border border-slate-700/80 bg-slate-900 hover:border-sky-400 text-slate-200 disabled:opacity-40"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>

              <button
                type="button"
                data-testid="chart-pan-right-btn"
                title="Pan Window Right"
                disabled={zoomWindow.endFrac >= 0.999}
                onClick={() =>
                  setZoomRange((prev) => panChartZoomRange(prev, 0.12))
                }
                className="inline-flex items-center px-1.5 py-1 text-[11px] rounded border border-slate-700/80 bg-slate-900 hover:border-sky-400 text-slate-200 disabled:opacity-40"
              >
                <ChevronRight className="w-3 h-3" />
              </button>

              <button
                type="button"
                data-testid="chart-zoom-active-event-btn"
                title={`Zoom 3x centered on Event #${activeEvent.sequence_index}`}
                onClick={() => focusZoomOnEvent(activeEvent, 0.24)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-amber-500/40 bg-amber-950/40 hover:bg-amber-900/50 text-amber-200 transition-colors whitespace-nowrap"
              >
                <Focus className="w-3 h-3 text-amber-300" />
                <span>Focus #{activeEvent.sequence_index}</span>
              </button>

              <button
                type="button"
                data-testid="chart-zoom-reset-btn"
                disabled={!isZoomed}
                title="Reset Zoom to 1x Full Session (0 key)"
                onClick={() =>
                  setZoomRange({ startFrac: 0, endFrac: 1, preset: 'full' })
                }
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border transition-colors whitespace-nowrap ${
                  isZoomed
                    ? 'border-sky-500/50 bg-sky-950/60 hover:bg-sky-900/70 text-sky-200 font-semibold'
                    : 'border-slate-800 bg-slate-900/50 text-slate-500 opacity-50'
                }`}
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>

              <label
                title="Automatically fit Y-axis to visible slice when zoomed in"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-slate-300 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  data-testid="chart-autofit-y-checkbox"
                  checked={autoScaleY}
                  onChange={(e) => setAutoScaleY(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                />
                <span>Auto-Fit Y</span>
              </label>
            </div>

            {/* Category Filter Pills */}
            <div
              role="group"
              aria-label="Filter Chart Events by Category"
              className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] rounded-md border border-slate-800"
            >
              {(
                [
                  { id: 'all', label: `All (${chartModel.events.length})` },
                  { id: 'whale_print', label: 'Whale Prints' },
                  { id: 'confirmation', label: '5m Confirm' },
                  { id: 'ai_decision', label: 'AI Gate' },
                  { id: 'smart_execution', label: 'Execution' },
                  { id: 'outcome_milestone', label: 'Outcome' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`chart-event-filter-${tab.id}`}
                  onClick={() => setCategoryFilter(tab.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    categoryFilter === tab.id
                      ? 'bg-sky-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 3: Fixed-Height Single-Line Crosshair Readout or GEX Wall Summary Strip (never wraps or shifts height on mouse move) */}
          <div className="flex items-center justify-between gap-2 h-8 overflow-hidden whitespace-nowrap text-[11px] font-mono tabular-nums bg-[#0B0F17]/90 px-3 rounded border border-slate-800/90 shrink-0">
            {hoveredPoint ? (
              <div className="flex items-center gap-2 text-slate-200 overflow-hidden truncate">
                <span className="text-sky-400 font-bold">
                  CROSSHAIR {hoveredPoint.time_label}
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  Opt Mid:{' '}
                  <strong className="text-emerald-300">
                    ${hoveredPoint.option_price.toFixed(2)}
                  </strong>
                </span>
                <span className="text-slate-400">
                  (${hoveredPoint.option_bid.toFixed(2)}×$
                  {hoveredPoint.option_ask.toFixed(2)})
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  VWAP:{' '}
                  <strong className="text-slate-200">
                    ${hoveredPoint.option_vwap.toFixed(2)}
                  </strong>
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-violet-300">
                  {candidate.ticker}:{' '}
                  <strong>${hoveredPoint.underlying_price.toFixed(2)}</strong>
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400">
                  IV {(hoveredPoint.iv * 100).toFixed(1)}%
                </span>
                {hoveredPoint.events_at_point.length > 0 && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-amber-300 font-semibold">
                      Event #
                      {
                        hoveredPoint.events_at_point[
                          hoveredPoint.events_at_point.length - 1
                        ].sequence_index
                      }{' '}
                      (Click marker to inspect)
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div
                data-testid="gex-inline-summary-strip"
                className="flex items-center gap-2 text-slate-300 overflow-hidden truncate"
              >
                <span className="text-emerald-300">
                  ▲ Call Wall ${gexLayer.call_wall.toFixed(2)}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-fuchsia-300">
                  ◆ Magnet ${gexLayer.gamma_magnet.toFixed(2)}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300">
                  ⚡ Flip ${gexLayer.gamma_flip.toFixed(2)}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-rose-300">
                  ▼ Put Wall ${gexLayer.put_wall.toFixed(2)}
                </span>
              </div>
            )}

            <div className="text-slate-400 hidden xl:block shrink-0">
              {isZoomed
                ? 'Scroll wheel or drag mini-map · Press 0 to reset'
                : 'Scroll wheel or drag across chart to zoom in'}
            </div>
          </div>

          {/* Interactive SVG Option Price, Gamma Exposure Walls/Magnet & Event Chart */}
          <div
            className={`relative w-full overflow-x-auto overscroll-contain bg-[#0B0F17] rounded-lg border border-slate-800/90 p-2 space-y-2 ${
              expandedLayout ? 'flex-1 min-h-0 flex flex-col justify-between' : ''
            }`}
          >
            <svg
              ref={svgRef}
              data-testid="candidate-option-price-svg-chart"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className={`w-full ${
                expandedLayout
                  ? 'max-h-[calc(100vh-305px)] flex-1 min-h-0 h-auto object-contain'
                  : 'h-auto'
              } min-w-[700px] select-none touch-none overscroll-contain cursor-crosshair`}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onMouseLeave={() => {
                setHoveredPointIdx(null);
                setDragBrush(null);
              }}
              onDoubleClick={(e) => {
                if (isZoomed) {
                  setZoomRange({ startFrac: 0, endFrac: 1, preset: 'full' });
                } else {
                  const svgX = clientXToSvgX(e.clientX);
                  const localFrac =
                    svgX !== null
                      ? clamp((svgX - padLeft) / Math.max(1, plotW), 0, 1)
                      : 0.5;
                  setZoomRange((prev) =>
                    zoomRangeByFactor(prev, 2.5, localFrac)
                  );
                }
              }}
            >
              <defs>
                <linearGradient
                  id="optPriceAreaGrad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={
                      outcome.is_decision_correct ? '#10b981' : '#38bdf8'
                    }
                    stopOpacity="0.28"
                  />
                  <stop
                    offset="100%"
                    stopColor={
                      outcome.is_decision_correct ? '#10b981' : '#38bdf8'
                    }
                    stopOpacity="0.02"
                  />
                </linearGradient>
                <linearGradient
                  id="magnetGravityBandGrad"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop offset="0%" stopColor="#d946ef" stopOpacity="0.05" />
                  <stop offset="50%" stopColor="#d946ef" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#d946ef" stopOpacity="0.07" />
                </linearGradient>
              </defs>

              {/* Gamma Exposure (GEX) Shaded Zones & Call/Put Wall + Magnet + Flip Indicators */}
              {showGexOverlay && (
                <g data-testid="svg-gex-overlay-layer">
                  {/* Gamma Magnet Gravity Band (±0.30% Pinning Corridor) */}
                  {isUndInPlotY(gexLayer.gamma_magnet) &&
                    (() => {
                      const yMagTop = getYUnd(gexLayer.magnet_band_high);
                      const yMagBot = getYUnd(gexLayer.magnet_band_low);
                      const yMagMid = getYUnd(gexLayer.gamma_magnet);
                      const bandH = Math.max(8, Math.abs(yMagBot - yMagTop));
                      return (
                        <g>
                          <rect
                            x={padLeft}
                            y={Math.min(yMagTop, yMagBot)}
                            width={plotW}
                            height={bandH}
                            fill="url(#magnetGravityBandGrad)"
                          />
                          <line
                            x1={padLeft}
                            y1={yMagMid}
                            x2={padLeft + plotW}
                            y2={yMagMid}
                            stroke="#e879f9"
                            strokeWidth="1.2"
                            strokeDasharray="3 3"
                            strokeOpacity="0.85"
                          />
                          <rect
                            x={padLeft + plotW - 490}
                            y={yMagMid - 15}
                            width="148"
                            height="14"
                            rx="2"
                            fill="#2e1065"
                            fillOpacity="0.92"
                            stroke="#e879f9"
                            strokeWidth="0.8"
                          />
                          <text
                            x={padLeft + plotW - 416}
                            y={yMagMid - 5}
                            textAnchor="middle"
                            className="fill-fuchsia-200 text-[9px] font-mono font-semibold"
                          >
                            ◆ GAMMA MAGNET ${gexLayer.gamma_magnet.toFixed(2)}
                          </text>
                        </g>
                      );
                    })()}

                  {/* Call Wall Line & Indicator */}
                  {isUndInPlotY(gexLayer.call_wall) &&
                    (() => {
                      const yCW = getYUnd(gexLayer.call_wall);
                      return (
                        <g>
                          <line
                            x1={padLeft}
                            y1={yCW}
                            x2={padLeft + plotW}
                            y2={yCW}
                            stroke="#22d3ee"
                            strokeWidth="1.3"
                            strokeDasharray="8 3 2 3"
                            strokeOpacity="0.9"
                          />
                          <rect
                            x={padLeft + plotW - 324}
                            y={yCW - 15}
                            width="156"
                            height="14"
                            rx="2"
                            fill="#083344"
                            fillOpacity="0.92"
                            stroke="#22d3ee"
                            strokeWidth="0.8"
                          />
                          <text
                            x={padLeft + plotW - 246}
                            y={yCW - 5}
                            textAnchor="middle"
                            className="fill-cyan-200 text-[9px] font-mono font-semibold"
                          >
                            ▲ CALL WALL ${gexLayer.call_wall.toFixed(2)} (+GEX)
                          </text>
                        </g>
                      );
                    })()}

                  {/* Put Wall Line & Indicator */}
                  {isUndInPlotY(gexLayer.put_wall) &&
                    (() => {
                      const yPW = getYUnd(gexLayer.put_wall);
                      return (
                        <g>
                          <line
                            x1={padLeft}
                            y1={yPW}
                            x2={padLeft + plotW}
                            y2={yPW}
                            stroke="#fb7185"
                            strokeWidth="1.3"
                            strokeDasharray="8 3 2 3"
                            strokeOpacity="0.9"
                          />
                          <rect
                            x={padLeft + plotW - 324}
                            y={yPW - 16}
                            width="152"
                            height="14"
                            rx="2"
                            fill="#4c0519"
                            fillOpacity="0.92"
                            stroke="#fb7185"
                            strokeWidth="0.8"
                          />
                          <text
                            x={padLeft + plotW - 248}
                            y={yPW - 6}
                            textAnchor="middle"
                            className="fill-rose-200 text-[9px] font-mono font-semibold"
                          >
                            ▼ PUT WALL ${gexLayer.put_wall.toFixed(2)} (-GEX)
                          </text>
                        </g>
                      );
                    })()}

                  {/* Gamma Flip Boundary Line & Indicator */}
                  {isUndInPlotY(gexLayer.gamma_flip) &&
                    (() => {
                      const yFlip = getYUnd(gexLayer.gamma_flip);
                      return (
                        <g>
                          <line
                            x1={padLeft}
                            y1={yFlip}
                            x2={padLeft + plotW}
                            y2={yFlip}
                            stroke="#fbbf24"
                            strokeWidth="1.15"
                            strokeDasharray="5 4"
                            strokeOpacity="0.85"
                          />
                          <rect
                            x={padLeft + 184}
                            y={yFlip - 14}
                            width="142"
                            height="13"
                            rx="2"
                            fill="#451a03"
                            fillOpacity="0.9"
                            stroke="#fbbf24"
                            strokeWidth="0.75"
                          />
                          <text
                            x={padLeft + 255}
                            y={yFlip - 4.5}
                            textAnchor="middle"
                            className="fill-amber-200 text-[9px] font-mono font-semibold"
                          >
                            ⚡ GAMMA FLIP ${gexLayer.gamma_flip.toFixed(2)}
                          </text>
                        </g>
                      );
                    })()}
                </g>
              )}

              {/* Horizontal Grid Lines & Left/Right Axis Labels */}
              {yTicks.map((t, idx) => (
                <g key={idx}>
                  <line
                    x1={padLeft}
                    y1={t.y}
                    x2={padLeft + plotW}
                    y2={t.y}
                    stroke="#1e293b"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 8}
                    y={t.y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[11px] font-mono"
                  >
                    ${t.price.toFixed(2)}
                  </text>
                  {(showUnderlyingOverlay || showGexOverlay) && (
                    <text
                      x={padLeft + plotW + 8}
                      y={t.y + 4}
                      textAnchor="start"
                      className="fill-violet-300 text-[10px] font-mono"
                    >
                      ${t.undPrice.toFixed(2)}
                    </text>
                  )}
                </g>
              ))}

              {/* Right-Side Strike-by-Strike GEX Profile Histogram Gutter */}
              {showGexOverlay && gexGutterWidth > 0 && (
                <g data-testid="svg-gex-strike-profile-gutter">
                  {(() => {
                    const gutterStartX = padLeft + plotW + 64;
                    const gutterW = svgWidth - gutterStartX - 8;
                    const zeroAxisX = gutterStartX + gutterW * 0.46;
                    const maxAbsNetGex = Math.max(
                      10,
                      ...gexLayer.strike_gex_bars.map((b) =>
                        Math.max(
                          Math.abs(b.call_gex_m),
                          Math.abs(b.put_gex_m),
                          Math.abs(b.net_gex_m)
                        )
                      )
                    );
                    const halfBarSpan = gutterW * 0.44;

                    // Map GEX bars using full-corridor bounds when zoomed in so the strike profile remains complete
                    const gexStrikes = gexLayer.strike_gex_bars.map(
                      (b) => b.strike
                    );
                    const gexMinStrike = Math.min(...gexStrikes) - 1;
                    const gexMaxStrike = Math.max(...gexStrikes) + 1;
                    const gexStrikeSpan = Math.max(1, gexMaxStrike - gexMinStrike);

                    return (
                      <g>
                        {/* Gutter Background & Header */}
                        <rect
                          x={gutterStartX}
                          y={padTop}
                          width={gutterW}
                          height={plotH}
                          rx="4"
                          fill="#0f172a"
                          fillOpacity="0.85"
                          stroke="#1e293b"
                          strokeWidth="1"
                        />
                        <text
                          x={gutterStartX + gutterW / 2}
                          y={padTop - 10}
                          textAnchor="middle"
                          className="fill-cyan-300 text-[9px] font-mono font-bold"
                        >
                          STRIKE GEX PROFILE ($M)
                        </text>
                        <line
                          x1={zeroAxisX}
                          y1={padTop + 4}
                          x2={zeroAxisX}
                          y2={padTop + plotH - 4}
                          stroke="#475569"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />

                        {gexLayer.strike_gex_bars.map((bar, idx) => {
                          const yStrike = isZoomed
                            ? padTop +
                              plotH -
                              ((bar.strike - gexMinStrike) / gexStrikeSpan) *
                                plotH
                            : getYUnd(bar.strike);
                          const clampedY = Math.max(
                            padTop + 10,
                            Math.min(padTop + plotH - 10, yStrike)
                          );
                          const posW =
                            (Math.abs(bar.call_gex_m) / maxAbsNetGex) *
                            halfBarSpan;
                          const negW =
                            (Math.abs(bar.put_gex_m) / maxAbsNetGex) *
                            halfBarSpan;
                          const isSpecial =
                            bar.role === 'call_wall' ||
                            bar.role === 'put_wall' ||
                            bar.role === 'gamma_magnet' ||
                            bar.role === 'gamma_flip';

                          return (
                            <g key={`${bar.strike}-${bar.role}-${idx}`}>
                              {/* Put Gamma Bar (Left of zero axis) */}
                              <rect
                                x={zeroAxisX - negW}
                                y={clampedY - (isSpecial ? 4.5 : 3)}
                                width={Math.max(1.5, negW)}
                                height={isSpecial ? 9 : 6}
                                rx="1.5"
                                fill={
                                  bar.role === 'put_wall'
                                    ? '#fb7185'
                                    : '#f43f5e'
                                }
                                fillOpacity={isSpecial ? '0.95' : '0.6'}
                              />
                              {/* Call Gamma Bar (Right of zero axis) */}
                              <rect
                                x={zeroAxisX}
                                y={clampedY - (isSpecial ? 4.5 : 3)}
                                width={Math.max(1.5, posW)}
                                height={isSpecial ? 9 : 6}
                                rx="1.5"
                                fill={
                                  bar.role === 'call_wall'
                                    ? '#22d3ee'
                                    : bar.role === 'gamma_magnet'
                                      ? '#e879f9'
                                      : '#10b981'
                                }
                                fillOpacity={isSpecial ? '0.95' : '0.6'}
                              />
                              {isSpecial && (
                                <text
                                  x={gutterStartX + gutterW - 4}
                                  y={clampedY - 6}
                                  textAnchor="end"
                                  className="fill-slate-200 text-[8px] font-mono font-semibold"
                                >
                                  {bar.label} ${bar.strike}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })()}
                </g>
              )}

              {/* Reference Horizontal Lines: Target 1, Entry/AI Decision, Hard Stop */}
              {showTargetStopLines && (
                <g>
                  {/* Profit Target 1 Line */}
                  {isOptInPlotY(
                    chartModel.reference_levels.planned_target1_price
                  ) &&
                    (() => {
                      const yT1 = getYOpt(
                        chartModel.reference_levels.planned_target1_price
                      );
                      return (
                        <g>
                          <line
                            x1={padLeft}
                            y1={yT1}
                            x2={padLeft + plotW}
                            y2={yT1}
                            stroke="#10b981"
                            strokeWidth="1.2"
                            strokeDasharray="6 4"
                          />
                          <rect
                            x={padLeft + plotW - 138}
                            y={yT1 - 16}
                            width="134"
                            height="15"
                            rx="3"
                            fill="#064e3b"
                            fillOpacity="0.9"
                          />
                          <text
                            x={padLeft + plotW - 71}
                            y={yT1 - 5}
                            textAnchor="middle"
                            className="fill-emerald-300 text-[10px] font-mono font-semibold"
                          >
                            Target 1: $
                            {chartModel.reference_levels.planned_target1_price.toFixed(
                              2
                            )}
                          </text>
                        </g>
                      );
                    })()}

                  {/* Hard Stop Line */}
                  {isOptInPlotY(
                    chartModel.reference_levels.planned_stop_price
                  ) &&
                    (() => {
                      const yStop = getYOpt(
                        chartModel.reference_levels.planned_stop_price
                      );
                      return (
                        <g>
                          <line
                            x1={padLeft}
                            y1={yStop}
                            x2={padLeft + plotW}
                            y2={yStop}
                            stroke="#f43f5e"
                            strokeWidth="1.2"
                            strokeDasharray="6 4"
                          />
                          <rect
                            x={padLeft + plotW - 138}
                            y={yStop + 3}
                            width="134"
                            height="15"
                            rx="3"
                            fill="#4c0519"
                            fillOpacity="0.9"
                          />
                          <text
                            x={padLeft + plotW - 71}
                            y={yStop + 14}
                            textAnchor="middle"
                            className="fill-rose-300 text-[10px] font-mono font-semibold"
                          >
                            Hard Stop: $
                            {chartModel.reference_levels.planned_stop_price.toFixed(
                              2
                            )}
                          </text>
                        </g>
                      );
                    })()}

                  {/* AI Decision / Smart Fill Price Reference Line */}
                  {(() => {
                    const refP =
                      chartModel.reference_levels.smart_fill_price ??
                      chartModel.reference_levels.ai_decision_price;
                    if (!isOptInPlotY(refP)) return null;
                    const yRef = getYOpt(refP);
                    return (
                      <g>
                        <line
                          x1={padLeft}
                          y1={yRef}
                          x2={padLeft + plotW}
                          y2={yRef}
                          stroke="#f59e0b"
                          strokeWidth="1"
                          strokeDasharray="4 4"
                          strokeOpacity="0.8"
                        />
                        <text
                          x={padLeft + 6}
                          y={yRef - 5}
                          className="fill-amber-300 text-[10px] font-mono"
                        >
                          {chartModel.reference_levels.smart_fill_price
                            ? `Smart Fill $${refP.toFixed(2)}`
                            : `AI Gate Price $${refP.toFixed(2)}`}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              )}

              {/* NBBO Bid/Ask Shaded Corridor */}
              {showNbboBand && nbboBandPolygonPath && (
                <path
                  d={nbboBandPolygonPath}
                  fill="#38bdf8"
                  fillOpacity="0.11"
                  stroke="#38bdf8"
                  strokeOpacity="0.25"
                  strokeWidth="0.75"
                />
              )}

              {/* Option Price Area & Primary Curve */}
              <path d={optionAreaPath} fill="url(#optPriceAreaGrad)" />
              <path
                d={optionLinePath}
                fill="none"
                stroke={outcome.is_decision_correct ? '#10b981' : '#38bdf8'}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Underlying Stock Price Secondary Curve */}
              {showUnderlyingOverlay && (
                <path
                  d={underlyingLinePath}
                  fill="none"
                  stroke="#a78bfa"
                  strokeWidth="1.75"
                  strokeDasharray="5 3"
                  strokeOpacity="0.9"
                />
              )}

              {/* X-Axis Time Labels (Collision-Prevented, Zoom-Aware) */}
              {xTickPoints.map(({ pt, localIdx }) => {
                const x = getX(localIdx);
                return (
                  <g key={pt.point_index}>
                    <line
                      x1={x}
                      y1={padTop + plotH}
                      x2={x}
                      y2={padTop + plotH + 5}
                      stroke="#475569"
                    />
                    <text
                      x={x}
                      y={padTop + plotH + 17}
                      textAnchor="middle"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {isZoomed ? pt.time_label : pt.time_label.slice(0, 5)}
                    </text>
                    <text
                      x={x}
                      y={padTop + plotH + 30}
                      textAnchor="middle"
                      className="fill-slate-500 text-[9px] font-mono"
                    >
                      ({pt.relative_minutes >= 0 ? '+' : ''}
                      {isZoomed
                        ? pt.relative_minutes.toFixed(1)
                        : pt.relative_minutes.toFixed(0)}
                      m)
                    </text>
                  </g>
                );
              })}

              {/* Hover Crosshair */}
              {hoveredPoint && hoveredPointIdx !== null && (
                <g>
                  <line
                    x1={getX(hoveredPointIdx)}
                    y1={padTop}
                    x2={getX(hoveredPointIdx)}
                    y2={padTop + plotH}
                    stroke="#94a3b8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={getX(hoveredPointIdx)}
                    cy={getYOpt(hoveredPoint.option_price)}
                    r="4.5"
                    fill="#f8fafc"
                    stroke="#0284c7"
                    strokeWidth="2"
                  />
                </g>
              )}

              {/* Marquee Drag-to-Zoom Selection Overlay */}
              {dragBrush &&
                Math.abs(dragBrush.currentSvgX - dragBrush.startSvgX) > 6 && (
                  <g data-testid="svg-drag-zoom-brush">
                    <rect
                      x={Math.min(dragBrush.startSvgX, dragBrush.currentSvgX)}
                      y={padTop}
                      width={Math.abs(
                        dragBrush.currentSvgX - dragBrush.startSvgX
                      )}
                      height={plotH}
                      fill="#38bdf8"
                      fillOpacity="0.18"
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                    />
                    <text
                      x={
                        (dragBrush.startSvgX + dragBrush.currentSvgX) / 2
                      }
                      y={padTop + 18}
                      textAnchor="middle"
                      className="fill-sky-200 text-[10px] font-mono font-bold"
                    >
                      Release to Zoom Slice
                    </text>
                  </g>
                )}

              {/* Event Vertical Markers & Collision-Resolved Callout Badges */}
              {filteredEvents.map((evt) => {
                const cx = getXFromTimestamp(evt.timestamp_ms);
                const cy = getYOpt(evt.option_price);
                const meta = EVENT_CATEGORY_META[evt.category];
                const isSelected = activeEvent?.event_id === evt.event_id;
                const dotColor =
                  evt.category === 'outcome_milestone'
                    ? outcome.is_decision_correct
                      ? '#10b981'
                      : '#f43f5e'
                    : meta.dotColor;

                const callout = resolvedCalloutMap.get(evt.event_id);
                const boxCx = callout?.box_cx ?? cx;
                const boxCy = callout?.box_cy ?? cy - 26;
                const boxW = callout?.box_width ?? 112;
                const boxH = callout?.box_height ?? 18;
                const badgeText =
                  callout?.badge_text ?? `#${evt.sequence_index} ${evt.short_tag}`;

                return (
                  <g
                    key={evt.event_id}
                    data-testid={`svg-event-marker-${evt.sequence_index}`}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEventId(evt.event_id);
                    }}
                  >
                    {/* Vertical guide from event point to bottom axis */}
                    <line
                      x1={cx}
                      y1={cy}
                      x2={cx}
                      y2={padTop + plotH}
                      stroke={dotColor}
                      strokeOpacity={isSelected ? '0.85' : '0.32'}
                      strokeWidth={isSelected ? '1.5' : '1'}
                      strokeDasharray="2 2"
                    />

                    {/* Leader line from anchor point (cx, cy) to collision-resolved callout (boxCx, boxCy) */}
                    <line
                      x1={cx}
                      y1={cy}
                      x2={boxCx}
                      y2={boxCy}
                      stroke={dotColor}
                      strokeOpacity={isSelected ? '0.95' : '0.65'}
                      strokeWidth={isSelected ? '1.4' : '1'}
                    />

                    {/* Outer halo for selected event */}
                    {isSelected && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r="11"
                        fill={dotColor}
                        fillOpacity="0.25"
                      />
                    )}

                    {/* Event node circle with sequence number */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelected ? '8' : '6.5'}
                      fill="#0B0F17"
                      stroke={dotColor}
                      strokeWidth={isSelected ? '2.5' : '2'}
                    />
                    <text
                      x={cx}
                      y={cy + 3.5}
                      textAnchor="middle"
                      fill="#f8fafc"
                      className="text-[9px] font-mono font-bold"
                    >
                      {evt.sequence_index}
                    </text>

                    {/* Collision-Free Callout Label Box */}
                    <g transform={`translate(${boxCx}, ${boxCy})`}>
                      <rect
                        x={-boxW / 2}
                        y={-boxH / 2}
                        width={boxW}
                        height={boxH}
                        rx="3"
                        fill={isSelected ? '#1e293b' : '#0f172a'}
                        fillOpacity="0.95"
                        stroke={dotColor}
                        strokeWidth={isSelected ? '1.6' : '0.95'}
                      />
                      <text
                        x="0"
                        y="3"
                        textAnchor="middle"
                        fill={isSelected ? '#f8fafc' : '#e2e8f0'}
                        className="text-[9px] font-mono font-semibold"
                      >
                        {badgeText}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* Interactive Timeline Range Navigator / Mini-Map Scrubber */}
            <div
              data-testid="chart-zoom-minimap"
              className="flex items-center gap-2.5 px-2 py-1.5 rounded bg-[#111726]/90 border border-slate-800/90"
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 shrink-0">
                Session Navigator:
              </span>

              <div
                role="slider"
                aria-label="Session Zoom Window Navigator"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(zoomWindow.startFrac * 100)}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0) return;
                  const clickFrac = clamp(
                    (e.clientX - rect.left) / rect.width,
                    0,
                    1
                  );
                  const curSpan = clamp(
                    zoomWindow.endFrac - zoomWindow.startFrac,
                    0.16,
                    1
                  );
                  const targetSpan = isZoomed ? curSpan : 0.28;
                  const nextStart = clamp(
                    clickFrac - targetSpan / 2,
                    0,
                    1 - targetSpan
                  );
                  const nextEnd = clamp(nextStart + targetSpan, targetSpan, 1);
                  setZoomRange({
                    startFrac: Number(nextStart.toFixed(4)),
                    endFrac: Number(nextEnd.toFixed(4)),
                    preset: 'custom',
                  });
                }}
                className="relative flex-1 h-7 bg-[#0B0F17] rounded border border-slate-800 overflow-hidden cursor-pointer"
                title="Click anywhere on the timeline navigator to center zoom window"
              >
                {/* Sparkline SVG */}
                <svg
                  viewBox="0 0 1000 28"
                  preserveAspectRatio="none"
                  className="w-full h-full"
                >
                  <path
                    d={miniMapSparklinePath}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2"
                    strokeOpacity="0.65"
                  />
                </svg>

                {/* Event Marker Dots on Mini-Map */}
                {chartModel.events.map((evt) => {
                  let bestIdx = 0;
                  let bestDist = Infinity;
                  for (let i = 0; i < fullSeries.length; i++) {
                    const d = Math.abs(
                      fullSeries[i].timestamp_ms - evt.timestamp_ms
                    );
                    if (d < bestDist) {
                      bestDist = d;
                      bestIdx = i;
                    }
                  }
                  const leftPct =
                    (bestIdx / Math.max(1, fullSeries.length - 1)) * 100;
                  const isAct = activeEvent.event_id === evt.event_id;
                  return (
                    <div
                      key={evt.event_id}
                      style={{ left: `${leftPct}%` }}
                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full pointer-events-none ${
                        isAct
                          ? 'w-2.5 h-2.5 bg-amber-300 ring-2 ring-amber-400/50 z-10'
                          : 'w-1.5 h-1.5 bg-sky-400/80'
                      }`}
                    />
                  );
                })}

                {/* Highlighted Active Zoom Window Box */}
                <div
                  style={{
                    left: `${zoomWindow.startFrac * 100}%`,
                    width: `${Math.max(4, (zoomWindow.endFrac - zoomWindow.startFrac) * 100)}%`,
                  }}
                  className="absolute inset-y-0 bg-sky-400/20 border-x-2 border-sky-400 pointer-events-none"
                />
              </div>

              <span className="text-[10px] font-mono text-slate-300 tabular-nums shrink-0">
                {Math.round(zoomWindow.startFrac * 100)}%–
                {Math.round(zoomWindow.endFrac * 100)}% (
                {zoomWindow.zoomFactor.toFixed(1)}x)
              </span>
            </div>

            {/* Docked Active Event Inspector HUD (Always rendered with fixed single-line height so zooming or moving the mouse never shifts chart height) */}
            <div
              data-testid="expanded-docked-event-hud"
              className="flex items-center justify-between gap-3 h-10 px-3 rounded-md bg-[#111726] border border-sky-500/40 text-xs overflow-hidden whitespace-nowrap shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    data-testid="docked-prev-event-btn"
                    disabled={activeEvent.sequence_index <= 1}
                    onClick={() => stepActiveEvent(-1)}
                    className="px-2 py-1 text-[11px] font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-sky-400 text-slate-200 disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    data-testid="docked-next-event-btn"
                    disabled={
                      activeEvent.sequence_index >= chartModel.events.length
                    }
                    onClick={() => stepActiveEvent(1)}
                    className="px-2 py-1 text-[11px] font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-sky-400 text-slate-200 disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>

                <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 font-mono font-bold shrink-0">
                  #{activeEvent.sequence_index}/{chartModel.events.length}{' '}
                  {activeEvent.short_tag}
                </span>

                <span className="font-mono text-slate-400 tabular-nums shrink-0">
                  {activeEvent.time_label} ({activeEvent.relative_time_label})
                </span>

                <span className="font-semibold text-slate-100 truncate">
                  {activeEvent.title}
                </span>
              </div>

              <div className="hidden md:flex items-center gap-2.5 font-mono tabular-nums text-[11px] shrink-0">
                <span>
                  <span className="text-slate-400">Opt:</span>{' '}
                  <strong className="text-slate-100">
                    ${activeEvent.option_price.toFixed(2)}
                  </strong>{' '}
                  <span className="text-slate-400">
                    (${activeEvent.nbbo_bid.toFixed(2)}×$
                    {activeEvent.nbbo_ask.toFixed(2)})
                  </span>
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  <span className="text-slate-400">{candidate.ticker}:</span>{' '}
                  <strong className="text-violet-300">
                    ${activeEvent.underlying_price.toFixed(2)}
                  </strong>
                </span>
                {activeEvent.metrics_pills.slice(0, 2).map((m) => (
                  <React.Fragment key={m.label}>
                    <span className="text-slate-600">·</span>
                    <span>
                      <span className="text-slate-400">{m.label}:</span>{' '}
                      <strong className="text-sky-300">{m.value}</strong>
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Legend Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1.5 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
                  <span>Whale Print</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-400 inline-block" />
                  <span>5m Confirmation</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                  <span>Stage-1/2 AI Gate</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                  <span>Smart Fill &amp; Outcome</span>
                </span>
                {showGexOverlay && (
                  <>
                    <span className="text-slate-600">|</span>
                    <span className="text-cyan-300">▲ Call Wall</span>
                    <span className="text-fuchsia-300">◆ Magnet</span>
                    <span className="text-amber-300">⚡ Flip</span>
                    <span className="text-rose-300">▼ Put Wall</span>
                  </>
                )}
              </div>
              <div>
                Left Axis: Option Price ($) · Right Axis: {candidate.ticker}{' '}
                Stock &amp; GEX Levels ($)
              </div>
            </div>
          </div>
        </section>

        {/* Right Column (4 cols when standard, 12 cols below when expanded): Selected Event Deep-Dive + Decision Proof Checklist */}
        <aside
          aria-label="Selected Pipeline Event Inspector"
          data-testid="selected-timeline-event-card"
          className={`${
            expandedLayout
              ? 'lg:col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-4'
              : 'lg:col-span-4 space-y-4'
          }`}
        >
          {/* Active Event Detail Card */}
          <div className="rounded-lg border border-slate-800 bg-[#111726] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 font-bold">
                  Event #{activeEvent.sequence_index} of{' '}
                  {chartModel.events.length}
                </span>
                <span className="text-slate-400">
                  {EVENT_CATEGORY_META[activeEvent.category].label}
                </span>
              </div>
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {activeEvent.time_label} ({activeEvent.relative_time_label})
              </span>
            </div>

            <div>
              <div className="text-xs font-mono text-sky-400 font-semibold">
                {activeEvent.short_tag}
              </div>
              <h3
                data-testid="selected-event-title"
                className="text-sm font-bold text-slate-100 mt-0.5"
              >
                {activeEvent.title}
              </h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {activeEvent.subtitle}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 font-mono tabular-nums text-xs">
              <div className="bg-[#0B0F17] p-2 rounded border border-slate-800/90">
                <div className="text-[10px] text-slate-400">
                  Option Price @ Event
                </div>
                <div className="text-sm font-bold text-slate-100 mt-0.5">
                  ${activeEvent.option_price.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400">
                  NBBO ${activeEvent.nbbo_bid.toFixed(2)} × $
                  {activeEvent.nbbo_ask.toFixed(2)}
                </div>
              </div>

              <div className="bg-[#0B0F17] p-2 rounded border border-slate-800/90">
                <div className="text-[10px] text-slate-400">
                  {candidate.ticker} Spot @ Event
                </div>
                <div className="text-sm font-bold text-violet-300 mt-0.5">
                  ${activeEvent.underlying_price.toFixed(2)}
                </div>
                <div className="text-[10px] text-slate-400">
                  vs Detection:{' '}
                  <span
                    className={
                      activeEvent.price_change_from_detection_pct >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }
                  >
                    {activeEvent.price_change_from_detection_pct >= 0
                      ? '+'
                      : ''}
                    {activeEvent.price_change_from_detection_pct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Event Metric Line */}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-mono text-slate-300">
              {activeEvent.metrics_pills.map((m, idx) => (
                <React.Fragment key={m.label}>
                  {idx > 0 && <span className="text-slate-600">·</span>}
                  <span>
                    <span className="text-slate-400">{m.label}:</span>{' '}
                    <strong className="text-slate-100">{m.value}</strong>
                  </span>
                </React.Fragment>
              ))}
            </div>

            {/* Prev / Next Event Stepper + Zoom to Event Buttons */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={activeEvent.sequence_index <= 1}
                onClick={() => stepActiveEvent(-1)}
                className="px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-slate-500 text-slate-200 disabled:opacity-40"
              >
                ← Prev Event
              </button>
              <button
                type="button"
                onClick={() => focusZoomOnEvent(activeEvent, 0.24)}
                className="px-2.5 py-1 text-[11px] font-mono rounded border border-sky-500/40 bg-sky-950/40 hover:bg-sky-900/50 text-sky-300"
              >
                🔍 Zoom Event #{activeEvent.sequence_index}
              </button>
              <button
                type="button"
                disabled={
                  activeEvent.sequence_index >= chartModel.events.length
                }
                onClick={() => stepActiveEvent(1)}
                className="px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-slate-500 text-slate-200 disabled:opacity-40"
              >
                Next Event →
              </button>
            </div>
          </div>

          {/* Decision Audit Evidence Summary Card */}
          <div className="rounded-lg border border-slate-800 bg-[#111726] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Decision Audit Trail &amp; Verification
              </h3>
              <span className="text-xs font-mono text-emerald-400 font-semibold">
                Grade {outcome.confidence_grade}
              </span>
            </div>
            <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
              {outcome.key_evidence_bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 bg-[#0B0F17]/70 p-2 rounded border border-slate-800/80"
                >
                  <span className="font-mono text-sky-400 font-bold shrink-0">
                    0{i + 1}.
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Interactive GEX Wall/Magnet Corridor Gauge & 5-Stage Decision Synthesis Blueprint (Full Width 12-Col Section) */}
        <section
          aria-label="Gamma Exposure and Multi-Signal Synthesis"
          data-testid="decision-gex-synthesis-panel"
          className="lg:col-span-12 rounded-lg border border-slate-800 bg-[#111726] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
                  How the Decision Was Made: Gamma Exposure (GEX) &amp; Multi-Signal Synthesis
                </h3>
                <span className="text-xs font-mono text-cyan-300 font-semibold">
                  · {gexLayer.dealer_regime_label}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {gexLayer.dealer_hedging_behavior}
              </p>
            </div>
            <div className="flex items-center gap-3 font-mono tabular-nums text-xs">
              <span>
                <span className="text-slate-400">Vol GEX:</span>{' '}
                <strong
                  className={
                    gexLayer.gex_source_vol_net_m >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }
                >
                  {gexLayer.gex_source_vol_net_m >= 0 ? '+' : ''}$
                  {gexLayer.gex_source_vol_net_m.toFixed(0)}M
                </strong>
              </span>
              <span className="text-slate-600">·</span>
              <span>
                <span className="text-slate-400">OI GEX:</span>{' '}
                <strong
                  className={
                    gexLayer.gex_source_oi_net_m >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }
                >
                  {gexLayer.gex_source_oi_net_m >= 0 ? '+' : ''}$
                  {gexLayer.gex_source_oi_net_m.toFixed(0)}M
                </strong>
              </span>
              <span className="text-slate-600">·</span>
              <span>
                <span className="text-slate-400">GEX Score Mod:</span>{' '}
                <strong
                  className={
                    gexLayer.ticker_gamma_modifier > 0
                      ? 'text-emerald-400'
                      : gexLayer.ticker_gamma_modifier < 0
                        ? 'text-amber-300'
                        : 'text-slate-200'
                  }
                >
                  {gexLayer.ticker_gamma_modifier >= 0 ? '+' : ''}
                  {gexLayer.ticker_gamma_modifier} pts
                </strong>
              </span>
            </div>
          </div>

          {/* Visual Horizontal GEX Wall & Magnet Thermometer Bar */}
          {(() => {
            const allTrackPrices = [
              gexLayer.put_wall,
              gexLayer.gamma_flip,
              gexLayer.gamma_magnet,
              gexLayer.call_wall,
              gexLayer.ticker_spot,
              gexLayer.latest_spot,
            ];
            const trackMin = Math.min(...allTrackPrices) * 0.992;
            const trackMax = Math.max(...allTrackPrices) * 1.008;
            const trackSpan = Math.max(0.5, trackMax - trackMin);
            const toPct = (val: number) =>
              Math.max(2, Math.min(98, ((val - trackMin) / trackSpan) * 100));

            return (
              <div
                data-testid="gex-wall-magnet-thermometer"
                className="bg-[#0B0F17] border border-slate-800/90 rounded p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="text-slate-300 font-semibold">
                    {candidate.ticker} Spot vs Call/Put Wall &amp; Gamma Magnet Corridor:
                  </span>
                  <span className="text-cyan-300">
                    {gexLayer.wall_interaction_label}
                  </span>
                </div>

                <div className="relative h-8 bg-[#111726] rounded border border-slate-800 overflow-hidden">
                  {/* Negative Gamma Zone (Left of Gamma Flip) */}
                  <div
                    style={{ width: `${toPct(gexLayer.gamma_flip)}%` }}
                    className="absolute inset-y-0 left-0 bg-rose-950/30 border-r border-amber-400/60"
                  />
                  {/* Positive Gamma Zone (Right of Gamma Flip) */}
                  <div
                    style={{
                      left: `${toPct(gexLayer.gamma_flip)}%`,
                      width: `${100 - toPct(gexLayer.gamma_flip)}%`,
                    }}
                    className="absolute inset-y-0 bg-emerald-950/20"
                  />

                  {/* Gamma Magnet Pinning Gravity Band */}
                  <div
                    style={{
                      left: `${Math.max(0, toPct(gexLayer.gamma_magnet) - 2.5)}%`,
                      width: '5%',
                    }}
                    className="absolute inset-y-0 bg-fuchsia-500/25 border-x border-fuchsia-400/60"
                    title={`Gamma Magnet: $${gexLayer.gamma_magnet.toFixed(2)}`}
                  />

                  {/* Put Wall Marker */}
                  <div
                    style={{ left: `${toPct(gexLayer.put_wall)}%` }}
                    className="absolute inset-y-0 -translate-x-1/2 flex flex-col items-center justify-center"
                  >
                    <div className="h-full w-0.5 bg-rose-400" />
                  </div>

                  {/* Gamma Flip Marker */}
                  <div
                    style={{ left: `${toPct(gexLayer.gamma_flip)}%` }}
                    className="absolute inset-y-0 -translate-x-1/2 flex flex-col items-center justify-center"
                  >
                    <div className="h-full w-0.5 bg-amber-400" />
                  </div>

                  {/* Gamma Magnet Marker */}
                  <div
                    style={{ left: `${toPct(gexLayer.gamma_magnet)}%` }}
                    className="absolute inset-y-0 -translate-x-1/2 flex flex-col items-center justify-center"
                  >
                    <div className="h-full w-0.5 bg-fuchsia-400" />
                  </div>

                  {/* Call Wall Marker */}
                  <div
                    style={{ left: `${toPct(gexLayer.call_wall)}%` }}
                    className="absolute inset-y-0 -translate-x-1/2 flex flex-col items-center justify-center"
                  >
                    <div className="h-full w-0.5 bg-cyan-400" />
                  </div>

                  {/* Detection Spot Marker */}
                  <div
                    style={{ left: `${toPct(gexLayer.ticker_spot)}%` }}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500 text-slate-950 text-[9px] font-mono font-bold shadow"
                    title={`Spot at Detection: $${gexLayer.ticker_spot.toFixed(2)}`}
                  >
                    <span>Spot ${gexLayer.ticker_spot.toFixed(2)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono tabular-nums pt-0.5">
                  <div className="text-rose-300">
                    ▼ Put Wall: <strong>${gexLayer.put_wall.toFixed(2)}</strong> (Support / Breakdown)
                  </div>
                  <div className="text-amber-300">
                    ⚡ Gamma Flip: <strong>${gexLayer.gamma_flip.toFixed(2)}</strong> (-GEX ↔ +GEX)
                  </div>
                  <div className="text-fuchsia-300">
                    ◆ Gamma Magnet: <strong>${gexLayer.gamma_magnet.toFixed(2)}</strong> (Pinning Zone)
                  </div>
                  <div className="text-cyan-300 sm:text-right">
                    ▲ Call Wall: <strong>${gexLayer.call_wall.toFixed(2)}</strong> (Resistance / Breakout)
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 5-Stage Causal Decision Architecture Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {gexLayer.decision_blueprint.map((node) => {
              const borderColor =
                node.status === 'positive' || node.status === 'bullish'
                  ? 'border-emerald-500/40 bg-emerald-950/15'
                  : node.status === 'bearish'
                    ? 'border-rose-500/40 bg-rose-950/15'
                    : node.status === 'warning'
                      ? 'border-amber-500/40 bg-amber-950/15'
                      : 'border-slate-800 bg-[#0B0F17]';
              const tagColor =
                node.status === 'positive' || node.status === 'bullish'
                  ? 'text-emerald-300'
                  : node.status === 'bearish'
                    ? 'text-rose-300'
                    : node.status === 'warning'
                      ? 'text-amber-300'
                      : 'text-sky-300';

              return (
                <div
                  key={node.id}
                  data-testid={`decision-blueprint-node-${node.id}`}
                  className={`rounded border p-2.5 flex flex-col justify-between gap-2 ${borderColor}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                      <span className="font-bold text-slate-200">
                        {node.title}
                      </span>
                      <span className="text-sky-400">{node.score_impact}</span>
                    </div>
                    <div className={`text-xs font-mono font-bold ${tagColor}`}>
                      {node.verdict_tag}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      {node.summary}
                    </p>
                  </div>

                  <div className="pt-1.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono tabular-nums text-slate-400">
                    {node.key_metrics.map((m) => (
                      <span key={m.label}>
                        {m.label}:{' '}
                        <strong className="text-slate-200">{m.value}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Chronological Candidate Event Ledger Table */}
      <section
        aria-label="Chronological Candidate Event Ledger"
        className="rounded-lg border border-slate-800 bg-[#111726] overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              Chronological Candidate Event Ledger ({chartModel.events.length} Associated Events)
            </h2>
            <p className="text-xs text-slate-400">
              Complete sequence of option tape prints, 5-minute underlying confirmations, Stage-1/2 AI decisions, Smart Order price-walking steps, and post-decision outcome checkpoints.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Click any row to highlight on chart
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0B0F17]/70 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Time (ET) / Offset</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Event &amp; Rationale</th>
                <th className="py-2.5 px-3 text-right">Option Price</th>
                <th className="py-2.5 px-3 text-right">NBBO Bid × Ask</th>
                <th className="py-2.5 px-3 text-right">{candidate.ticker} Spot</th>
                <th className="py-2.5 px-3 text-right">vs Detection</th>
                <th className="py-2.5 px-3 text-right">vs AI Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {chartModel.events.map((evt) => {
                const isSelected = activeEvent?.event_id === evt.event_id;
                const meta = EVENT_CATEGORY_META[evt.category];
                return (
                  <tr
                    key={evt.event_id}
                    data-testid={`candidate-event-row-${evt.sequence_index}`}
                    onClick={() => setSelectedEventId(evt.event_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-sky-950/40 hover:bg-sky-950/50'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-bold text-sky-400 whitespace-nowrap">
                      #{evt.sequence_index}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="text-slate-100 font-semibold">
                        {evt.time_label}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {evt.relative_time_label}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={`font-semibold ${meta.textColor}`}>
                        {meta.label}
                      </span>
                      <div className="text-[10px] text-slate-400">
                        {evt.short_tag}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-sans max-w-md">
                      <div className="font-semibold text-slate-100">
                        {evt.title}
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-2">
                        {evt.subtitle}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-100 whitespace-nowrap">
                      ${evt.option_price.toFixed(2)}
                      {evt.contracts ? (
                        <div className="text-[10px] font-normal text-sky-300">
                          {evt.contracts} cts
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300 whitespace-nowrap">
                      ${evt.nbbo_bid.toFixed(2)} × ${evt.nbbo_ask.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-violet-300 whitespace-nowrap">
                      ${evt.underlying_price.toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${
                        evt.price_change_from_detection_pct >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {evt.price_change_from_detection_pct >= 0 ? '+' : ''}
                      {evt.price_change_from_detection_pct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {evt.price_change_from_decision_pct !== null ? (
                        <span
                          className={`font-semibold ${
                            evt.price_change_from_decision_pct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {evt.price_change_from_decision_pct >= 0 ? '+' : ''}
                          {evt.price_change_from_decision_pct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-500">Pre-Gate</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Embedded Full Candidate Inspector (9-Factor Score, GEX, 5m Candle, Flow & JSON) */}
      <section aria-label="Full Candidate Quantitative Inspector">
        <CandidateInspector
          candidate={candidate}
          onOpenRegimeStrategy={onOpenRegimeStrategy}
          onStageSmartOrderOnCandidate={onStageSmartOrder}
          onRunAiAnalysisOnCandidate={onRunAiDecisionGate}
        />
      </section>
    </div>
  );
};
