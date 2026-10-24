import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  RotateCcw,
  Check,
  Sparkles,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import type { HistoricalTradingSessionSummary } from '../engine/whalePipelineRuntime';

export interface HistoricalDateCalendarPickerProps {
  selectedSessionDate: string; // 'latest' or 'YYYY-MM-DD'
  latestSessionDate: string; // e.g. '2026-10-21'
  availableSessions: HistoricalTradingSessionSummary[];
  onSelectSessionDate: (sessionDate: string) => void;
  compact?: boolean;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parseYearMonth(isoDate: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    return { year: 2026, month: 9 }; // October 2026 (0-indexed month = 9)
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1,
  };
}

function formatYmd(year: number, monthZeroIndexed: number, day: number): string {
  const m = String(monthZeroIndexed + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export const HistoricalDateCalendarPicker: React.FC<
  HistoricalDateCalendarPickerProps
> = ({
  selectedSessionDate,
  latestSessionDate,
  availableSessions,
  onSelectSessionDate,
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const effectiveLatestDate =
    latestSessionDate ||
    availableSessions.find((s) => s.is_latest)?.session_date ||
    availableSessions.find((s) => s.is_latest)?.date ||
    new Date().toISOString().slice(0, 10);

  const isLatestSelected =
    !selectedSessionDate ||
    selectedSessionDate === 'latest' ||
    selectedSessionDate === effectiveLatestDate;

  const activeDateStr = isLatestSelected
    ? effectiveLatestDate
    : selectedSessionDate;

  const initialYm = useMemo(
    () => parseYearMonth(activeDateStr),
    [activeDateStr]
  );
  const [viewYear, setViewYear] = useState<number>(initialYm.year);
  const [viewMonth, setViewMonth] = useState<number>(initialYm.month);

  useEffect(() => {
    const ym = parseYearMonth(activeDateStr);
    setViewYear(ym.year);
    setViewMonth(ym.month);
  }, [activeDateStr]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const sessionMap = useMemo(() => {
    const map = new Map<string, HistoricalTradingSessionSummary>();
    for (const s of availableSessions) {
      const key = s.session_date || s.date;
      if (key) {
        map.set(key, s);
      }
    }
    return map;
  }, [availableSessions]);

  const activeSessionSummary = sessionMap.get(activeDateStr);

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      cells.push({ day: null, dateStr: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        dateStr: formatYmd(viewYear, viewMonth, d),
      });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleChooseDate = (targetDate: string) => {
    if (targetDate === 'latest' || targetDate === effectiveLatestDate) {
      onSelectSessionDate('latest');
    } else {
      onSelectSessionDate(targetDate);
    }
    setOpen(false);
  };

  const getRegimeBadgeStyle = (regime?: string) => {
    switch (regime) {
      case 'strong_positive':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'strong_negative':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      case 'reversing':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'mixed':
        return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        data-testid="calendar-date-picker-btn"
        aria-label="Select trading session date"
        title="Inspect historical trading session data or view latest live session"
        className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
          isLatestSelected
            ? 'border-emerald-500/35 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40'
            : 'border-amber-500/50 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50 shadow-sm shadow-amber-950/50'
        }`}
      >
        <Calendar className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono tracking-tight">
          {isLatestSelected
            ? compact
              ? `Latest (${effectiveLatestDate})`
              : `Session: ${effectiveLatestDate} (Latest)`
            : compact
              ? `History: ${activeDateStr}`
              : `Historical: ${activeDateStr}`}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            isLatestSelected
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-amber-500/25 text-amber-300'
          }`}
        >
          {isLatestSelected ? 'LIVE' : 'ARCHIVE'}
        </span>
      </button>

      {!isLatestSelected && (
        <button
          type="button"
          onClick={() => handleChooseDate('latest')}
          data-testid="calendar-return-latest-btn"
          title="Return to Latest Live Session"
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 transition"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Latest</span>
        </button>
      )}

      {open && (
        <div
          data-testid="calendar-date-picker-popover"
          className="absolute right-0 top-full z-50 mt-2 w-80 sm:w-96 rounded-xl border border-slate-700/90 bg-slate-900/98 p-3.5 shadow-2xl backdrop-blur-md text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                <span>Trading Session Time Machine</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Inspect historical Flow Discovery, AI Gate &amp; Smart Orders
              </p>
            </div>
            <button
              type="button"
              data-testid="calendar-select-latest"
              onClick={() => handleChooseDate('latest')}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                isLatestSelected
                  ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-emerald-500/40 hover:text-emerald-300'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Latest ({effectiveLatestDate})</span>
            </button>
          </div>

          {/* Month Calendar Grid */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 mb-3">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label="Previous month"
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold text-slate-200">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
              <button
                type="button"
                onClick={handleNextMonth}
                aria-label="Next month"
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-500 mb-1">
              {WEEKDAYS.map((wd) => (
                <div key={wd}>{wd}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((cell, idx) => {
                if (!cell.day || !cell.dateStr) {
                  return <div key={`empty-${idx}`} className="h-7" />;
                }
                const sessionInfo = sessionMap.get(cell.dateStr);
                const isSelected = cell.dateStr === activeDateStr;
                const isLatestDay = cell.dateStr === effectiveLatestDate;
                const isFuture = cell.dateStr > effectiveLatestDate;

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    disabled={isFuture}
                    data-testid={`calendar-day-${cell.dateStr}`}
                    onClick={() => handleChooseDate(cell.dateStr!)}
                    className={`relative flex flex-col items-center justify-center h-7 rounded text-[11px] font-mono transition ${
                      isFuture
                        ? 'text-slate-700 cursor-not-allowed'
                        : isSelected
                          ? 'bg-indigo-600 text-white font-bold shadow-sm'
                          : sessionInfo
                            ? 'bg-slate-800/90 text-slate-100 hover:bg-indigo-500/30 border border-slate-700/70'
                            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    <span>{cell.day}</span>
                    {(sessionInfo || isLatestDay) && (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          isSelected
                            ? 'bg-white'
                            : isLatestDay
                              ? 'bg-emerald-400'
                              : 'bg-indigo-400'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Direct Date Input */}
            <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
              <label
                htmlFor="historical-date-native-input"
                className="text-[11px] text-slate-400"
              >
                Jump to date:
              </label>
              <input
                id="historical-date-native-input"
                data-testid="calendar-date-native-input"
                type="date"
                value={activeDateStr}
                max={effectiveLatestDate}
                onChange={(e) => {
                  if (e.target.value) {
                    handleChooseDate(e.target.value);
                  }
                }}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Available Sessions Quick-Select List */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              <span>Recorded Trading Sessions</span>
              <span>Activity Summary</span>
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5">
              {availableSessions.map((session) => {
                const sessDate = session.session_date || session.date;
                const sessRegime =
                  session.tide_regime || session.regime || 'neutral';
                const candCount =
                  session.candidates_count ?? session.candidate_count ?? 0;
                const aiCount =
                  session.ai_analyses_count ?? session.ai_analysis_count ?? 0;
                const ordCount =
                  session.smart_orders_count ?? session.smart_order_count ?? 0;
                const isSelected =
                  (session.is_latest && isLatestSelected) ||
                  sessDate === activeDateStr;
                return (
                  <button
                    key={sessDate}
                    type="button"
                    data-testid={`calendar-session-item-${sessDate}`}
                    onClick={() =>
                      handleChooseDate(session.is_latest ? 'latest' : sessDate)
                    }
                    className={`w-full text-left rounded-lg border p-2 transition flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'border-indigo-500/60 bg-indigo-950/40 text-white'
                        : 'border-slate-800 bg-slate-950/50 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold">
                          {sessDate}
                        </span>
                        {session.is_latest && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300 border border-emerald-500/30">
                            Latest
                          </span>
                        )}
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${getRegimeBadgeStyle(
                            sessRegime
                          )}`}
                        >
                          {sessRegime.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        {session.label}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 text-[10px] font-mono">
                      <span
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-cyan-300"
                        title="Flow Discovery Candidates"
                      >
                        {candCount} Flow
                      </span>
                      <span
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-indigo-300"
                        title="AI Decision Gate Analyses"
                      >
                        {aiCount} AI
                      </span>
                      <span
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-300"
                        title="Smart Execution Orders"
                      >
                        {ordCount} Ord
                      </span>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 text-indigo-400" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Session Footer Note */}
          {activeSessionSummary && (
            <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3 w-3 text-indigo-400" />
                <span>
                  Viewing{' '}
                  <strong className="text-slate-200 font-mono">
                    {activeSessionSummary.session_date ||
                      activeSessionSummary.date}
                  </strong>
                </span>
              </span>
              <span className="font-mono text-slate-300">
                {activeSessionSummary.candidates_count ??
                  activeSessionSummary.candidate_count ??
                  0}{' '}
                candidates ·{' '}
                {activeSessionSummary.ai_analyses_count ??
                  activeSessionSummary.ai_analysis_count ??
                  0}{' '}
                AI logs
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
