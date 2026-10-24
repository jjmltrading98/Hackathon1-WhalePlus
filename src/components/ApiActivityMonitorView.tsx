import React, { useMemo, useState } from 'react';
import {
  type ApiActivityLogEntry,
  type ApiActivityMetrics,
  type ApiServiceCategory,
  computeApiActivityMetrics,
} from '../engine/activityMonitorEngine';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Play,
  RefreshCw,
  Search,
  Server,
  Trash2,
  XCircle,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';

interface ApiActivityMonitorViewProps {
  logs: ApiActivityLogEntry[];
  onRefreshLogs: () => Promise<void>;
  onTriggerProbe: (simulateError: boolean, service?: string) => Promise<ApiActivityLogEntry | null>;
  onClearLogs: () => Promise<void>;
}

const SERVICE_OPTIONS: Array<'ALL' | ApiServiceCategory> = [
  'ALL',
  'Alpaca Market Data v2',
  'Alpaca Trading API v2',
  'Unusual Whales API',
  'LM Studio LLM Engine',
  'Internal Scanner API',
];

export const ApiActivityMonitorView: React.FC<ApiActivityMonitorViewProps> = ({
  logs,
  onRefreshLogs,
  onTriggerProbe,
  onClearLogs,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [serviceFilter, setServiceFilter] = useState<'ALL' | ApiServiceCategory>('ALL');
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'GET' | 'POST' | 'PUT' | 'DELETE'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    () => logs[0]?.request_id ?? null
  );
  const [probing, setProbing] = useState(false);
  const [simulatingError, setSimulatingError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedSection, setCopiedSection] = useState<'input' | 'output' | null>(null);

  const metrics: ApiActivityMetrics = useMemo(
    () => computeApiActivityMetrics(logs),
    [logs]
  );

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      const isOk =
        entry.ok &&
        entry.status_code >= 200 &&
        entry.status_code < 400 &&
        !entry.error_message;
      if (statusFilter === 'success' && !isOk) return false;
      if (statusFilter === 'error' && isOk) return false;
      if (serviceFilter !== 'ALL' && entry.service !== serviceFilter) return false;
      if (methodFilter !== 'ALL' && entry.method !== methodFilter) return false;

      if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${entry.endpoint} ${entry.service} ${entry.method} ${entry.status_code} ${entry.error_message ?? ''} ${entry.request_payload} ${entry.response_payload}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, statusFilter, serviceFilter, methodFilter, searchQuery]);

  const selectedEntry =
    filteredLogs.find((x) => x.request_id === selectedRequestId) ??
    filteredLogs[0] ??
    null;

  const handleCopy = async (text: string, section: 'input' | 'output') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 1800);
    } catch {
      // Ignore clipboard failure in restricted context
    }
  };

  const handleDispatchProbe = async (simulateError: boolean) => {
    if (simulateError) {
      setSimulatingError(true);
    } else {
      setProbing(true);
    }
    try {
      const entry = await onTriggerProbe(
        simulateError,
        simulateError ? 'lm_studio' : 'alpaca'
      );
      if (entry) {
        setSelectedRequestId(entry.request_id);
      }
    } finally {
      setProbing(false);
      setSimulatingError(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshLogs();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Controls */}
      <section
        aria-label="API Activity Monitor Header"
        className="p-5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <h1 className="text-base font-bold tracking-tight text-slate-100">
              API Activity &amp; Request/Response Monitor
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Inspect live HTTP inputs, JSON response payloads, latency, and error diagnostics across Alpaca, Unusual Whales, LM Studio, and internal endpoints.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleDispatchProbe(false)}
            disabled={probing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{probing ? 'Probing API...' : 'Dispatch Live API Probe'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleDispatchProbe(true)}
            disabled={simulatingError}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-rose-500/40 bg-rose-950/30 hover:bg-rose-950/50 text-rose-300 transition-colors disabled:opacity-50"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>{simulatingError ? 'Simulating...' : 'Simulate Error Request'}</span>
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-700 bg-[#0B0F17] hover:bg-slate-800 text-slate-200 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Logs</span>
          </button>

          <button
            type="button"
            onClick={onClearLogs}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-800 bg-[#0B0F17] hover:bg-slate-800/80 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
          </button>
        </div>
      </section>

      {/* 4-Card KPI Summary Strip */}
      <section
        aria-label="API Activity KPI Summary"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="p-4 rounded-lg border border-slate-800 bg-[#111726]">
          <div className="text-xs text-slate-400">Total API Requests Captured</div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-100">
              {metrics.total_requests}
            </span>
            <span className="text-xs font-mono text-sky-400 truncate">
              {filteredLogs.length} matching filter
            </span>
          </div>
        </div>

        <div className="p-4 rounded-lg border border-slate-800 bg-[#111726]">
          <div className="text-xs text-slate-400">2xx Successful Calls</div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {metrics.success_count}
            </span>
            <span className="text-xs font-mono text-emerald-400/90">
              {metrics.success_rate_pct.toFixed(1)}% success rate
            </span>
          </div>
        </div>

        <div
          onClick={() =>
            setStatusFilter((prev) => (prev === 'error' ? 'all' : 'error'))
          }
          className="p-4 rounded-lg border border-slate-800 hover:border-rose-500/50 bg-[#111726] cursor-pointer transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Errors &amp; Failed Requests</span>
            <span className="text-[11px] font-mono text-rose-400 underline">
              {statusFilter === 'error' ? 'Show All' : 'Filter Errors'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                metrics.error_count > 0 ? 'text-rose-400' : 'text-slate-300'
              }`}
            >
              {metrics.error_count}
            </span>
            <span className="text-xs font-mono text-slate-400">
              4xx / 5xx / Unreachable
            </span>
          </div>
        </div>

        <div className="p-4 rounded-lg border border-slate-800 bg-[#111726]">
          <div className="text-xs text-slate-400">Round-Trip Latency</div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-sky-400">
              {metrics.avg_latency_ms} ms
            </span>
            <span className="text-xs font-mono text-slate-400">
              peak {metrics.max_latency_ms} ms
            </span>
          </div>
        </div>
      </section>

      {/* Filter Bar */}
      <section
        aria-label="API Log Filters"
        className="p-4 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div
            role="group"
            aria-label="Filter API Logs by Status"
            className="flex items-center gap-1 p-1 rounded-md bg-[#0B0F17] border border-slate-800"
          >
            {(
              [
                { id: 'all', label: `All (${logs.length})` },
                { id: 'success', label: `Success (${metrics.success_count})` },
                { id: 'error', label: `Errors (${metrics.error_count})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  statusFilter === tab.id
                    ? tab.id === 'error'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Service select */}
          <select
            aria-label="Filter by API Service"
            value={serviceFilter}
            onChange={(e) =>
              setServiceFilter(e.target.value as 'ALL' | ApiServiceCategory)
            }
            className="px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-200"
          >
            {SERVICE_OPTIONS.map((srv) => (
              <option key={srv} value={srv}>
                {srv === 'ALL' ? 'All API Services' : srv}
              </option>
            ))}
          </select>

          {/* HTTP Method filter */}
          <div
            role="group"
            aria-label="Filter by HTTP Method"
            className="flex items-center gap-1 p-1 rounded-md bg-[#0B0F17] border border-slate-800"
          >
            {(['ALL', 'GET', 'POST', 'PUT', 'DELETE'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethodFilter(m)}
                className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                  methodFilter === m
                    ? 'bg-slate-800 text-sky-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search API Logs"
            placeholder="Search endpoint, payload, or error..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500"
          />
        </div>
      </section>

      {/* Main 12-Col Master-Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Chronological API Request Table */}
        <section
          aria-label="API Request Log Table"
          className="lg:col-span-7 border border-slate-800 bg-[#111726] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Chronological API Request Ledger
              </h2>
              <p className="text-xs text-slate-400">
                Click any request row to inspect its exact input parameters, response JSON, and error trace.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
              {filteredLogs.length} requests
            </span>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-300">
                No API requests match the active filter criteria.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setServiceFilter('ALL');
                  setMethodFilter('ALL');
                  setSearchQuery('');
                }}
                className="px-3.5 py-2 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 transition-colors"
              >
                Reset Log Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[680px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#0B0F17] border-b border-slate-800 text-slate-400 whitespace-nowrap">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Time</th>
                    <th className="py-2.5 px-2.5 font-medium">Service</th>
                    <th className="py-2.5 px-2.5 font-medium">Method &amp; Endpoint</th>
                    <th className="py-2.5 px-2 font-medium text-center">Status</th>
                    <th className="py-2.5 px-2.5 font-medium text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredLogs.map((entry) => {
                    const isSelected =
                      entry.request_id === selectedEntry?.request_id;
                    const isOk =
                      entry.ok &&
                      entry.status_code >= 200 &&
                      entry.status_code < 400 &&
                      !entry.error_message;
                    const timeStr = new Date(entry.timestamp).toLocaleTimeString(
                      [],
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      }
                    );

                    return (
                      <tr
                        key={entry.request_id}
                        onClick={() => setSelectedRequestId(entry.request_id)}
                        aria-selected={isSelected}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-sky-950/40 hover:bg-sky-950/50'
                            : !isOk
                              ? 'bg-rose-950/15 hover:bg-rose-950/25'
                              : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          {timeStr}
                        </td>

                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-200">
                            {entry.direction === 'inbound_rest' ? (
                              <ArrowDownLeft className="w-3 h-3 text-sky-400 shrink-0" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3 text-amber-400 shrink-0" />
                            )}
                            <span>{entry.service}</span>
                          </div>
                        </td>

                        <td className="py-2.5 px-2.5 max-w-[270px]">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded shrink-0 ${
                                entry.method === 'GET'
                                  ? 'bg-sky-500/15 text-sky-300'
                                  : entry.method === 'POST'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : entry.method === 'PUT'
                                      ? 'bg-amber-500/15 text-amber-300'
                                      : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {entry.method}
                            </span>
                            <span
                              className="font-mono text-[11px] text-slate-200 truncate"
                              title={entry.endpoint}
                            >
                              {entry.endpoint}
                            </span>
                          </div>
                          {entry.error_message && (
                            <div className="text-[11px] text-rose-400 truncate mt-0.5 font-mono">
                              {entry.error_message}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-2 text-center whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                              isOk
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {isOk ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <XCircle className="w-3 h-3" />
                            )}
                            <span>
                              {entry.status_code === 0
                                ? 'ERR_NET'
                                : entry.status_code}
                            </span>
                          </span>
                        </td>

                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {entry.latency_ms} ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right 5 Cols: Request Input / Response Output / Error Inspector */}
        <aside
          aria-label="API Request Input Output Inspector"
          className="lg:col-span-5 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
        >
          {!selectedEntry ? (
            <div className="py-12 text-center space-y-2">
              <Server className="w-6 h-6 text-slate-500 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-200">
                No API Request Selected
              </h3>
              <p className="text-xs text-slate-400">
                Select any row from the API Request Ledger to inspect its input payload, output response body, and error diagnostics.
              </p>
            </div>
          ) : (
            <>
              {/* Inspector Header */}
              <div className="pb-3 border-b border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-slate-400">
                    ID: {selectedEntry.request_id}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-mono text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span>{selectedEntry.latency_ms} ms</span>
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${
                      selectedEntry.method === 'GET'
                        ? 'bg-sky-500/20 text-sky-300'
                        : selectedEntry.method === 'POST'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {selectedEntry.method}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs font-mono font-semibold rounded ${
                      selectedEntry.ok && !selectedEntry.error_message
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/20 text-rose-400'
                    }`}
                  >
                    {selectedEntry.status_code === 0
                      ? 'NETWORK_ERROR (Status 0)'
                      : `HTTP ${selectedEntry.status_code}`}
                  </span>
                  <span className="text-xs font-medium text-slate-300">
                    · {selectedEntry.service}
                  </span>
                </div>

                <div className="p-2.5 rounded bg-[#0B0F17] border border-slate-800/90 font-mono text-xs text-slate-200 break-all">
                  {selectedEntry.endpoint}
                </div>
              </div>

              {/* Error Diagnostic Banner (when an error occurred) */}
              {(!selectedEntry.ok || selectedEntry.error_message) && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg border border-rose-500/40 bg-rose-950/30 space-y-1.5"
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>API Error Diagnostic Detected</span>
                  </div>
                  <p className="text-xs font-mono text-rose-200 leading-relaxed break-words">
                    {selectedEntry.error_message ||
                      `Request failed with HTTP status ${selectedEntry.status_code}.`}
                  </p>
                </div>
              )}

              {/* INPUT: Request Payload / Query / Headers */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Request Input (Query / Headers / Body)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(selectedEntry.request_payload, 'input')
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-400 hover:text-sky-300"
                  >
                    {copiedSection === 'input' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Input</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-md bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-52 overflow-y-auto leading-relaxed">
                  {selectedEntry.request_payload}
                </pre>
              </div>

              {/* OUTPUT: Response Payload */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Response Output (JSON Payload)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(selectedEntry.response_payload, 'output')
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-sky-400 hover:text-sky-300"
                  >
                    {copiedSection === 'output' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Output</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 rounded-md bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-emerald-300/90 overflow-x-auto max-h-72 overflow-y-auto leading-relaxed">
                  {selectedEntry.response_payload}
                </pre>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
