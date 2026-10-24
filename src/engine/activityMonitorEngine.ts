import {
  type MarketTideRegime,
  type WhaleCandidate,
  round2,
} from './whaleScannerEngine.ts';
import type { LlmEngineConfig, MarketTideState } from './whalePipelineRuntime.ts';
import type { LlmTradeDecisionRecord } from './llmTradeDecisionEngine.ts';
import { buildStage2LlmRiskAssessmentPrompts } from './riskFirstExecutionEngine.ts';
import {
  buildOptimizedLmStudioChatPayload,
  normalizeLmStudioEndpoints,
} from './lmStudioClient.ts';

export type ApiDirection =
  | 'inbound_rest'
  | 'outbound_alpaca'
  | 'outbound_unusual_whales'
  | 'outbound_lm_studio';

export type ApiServiceCategory =
  | 'Internal Scanner API'
  | 'Alpaca Market Data v2'
  | 'Alpaca Trading API v2'
  | 'Unusual Whales API'
  | 'LM Studio LLM Engine';

export interface ApiActivityLogEntry {
  request_id: string;
  timestamp: string;
  direction: ApiDirection;
  service: ApiServiceCategory;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  status_code: number;
  ok: boolean;
  latency_ms: number;
  request_payload: string;
  response_payload: string;
  error_message: string | null;
}

export interface ApiActivityMetrics {
  total_requests: number;
  success_count: number;
  error_count: number;
  success_rate_pct: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  by_service: Record<ApiServiceCategory, { total: number; errors: number }>;
}

export type AiAnalysisType =
  | 'stage1_entry_decision'
  | 'stage2_position_size_risk_strategy'
  | 'holding_stage1_risk_evaluation'
  | 'holding_stage2_exit_plan'
  | 'whale_candidate_evaluation'
  | 'stock_technical_confirmation'
  | 'regime_tide_synthesis'
  | 'custom_prompt';

export type AiAnalysisVerdict =
  | 'high_conviction_bullish'
  | 'high_conviction_bearish'
  | 'watch_for_confirmation'
  | 'avoid_conflicting_tape'
  | 'cautious_neutral'
  | 'processing_in_progress'
  | 'pending_in_queue'
  | 'error';

export type AiAnalysisStatus = 'processing' | 'pending' | 'success' | 'error';

export interface AiAnalysisQueueMetadata {
  queue_stage_label: string;
  trigger_reason: string;
  priority_score: number;
  progress_pct?: number;
  started_at?: string;
  queued_at?: string;
  source_pipeline: 'entry_scanner' | 'holdings_monitor' | 'manual_workbench';
}

export interface AiAnalysisActivityEntry {
  analysis_id: string;
  timestamp: string;
  candidate_id: string | null;
  ticker: string;
  option_symbol: string;
  direction: 'bullish' | 'bearish';
  analysis_type: AiAnalysisType;
  endpoint_url: string;
  model_id: string;
  status: AiAnalysisStatus;
  execution_mode:
    | 'lm_studio_live'
    | 'deterministic_synthesis'
    | 'endpoint_error'
    | 'in_flight_processing'
    | 'queued_pending';
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  queue_metadata?: AiAnalysisQueueMetadata;
  input_payload: {
    system_prompt: string;
    user_prompt: string;
    context_snapshot: string;
    request_body: string;
  };
  output_payload: {
    assistant_message: string;
    raw_response: string;
    verdict: AiAnalysisVerdict;
    confidence_score: number;
  };
  error_details: {
    has_error: boolean;
    error_code: string | null;
    error_message: string | null;
    endpoint_attempted: string;
  };
}

export interface AiAnalysisMetrics {
  total_analyses: number;
  processing_count: number;
  pending_count: number;
  completed_count: number;
  success_count: number;
  error_count: number;
  stage1_count: number;
  stage2_count: number;
  holdings_eval_count: number;
  success_rate_pct: number;
  avg_latency_ms: number;
  total_analysis_time_ms: number;
  completed_analysis_time_ms: number;
  processing_elapsed_time_ms: number;
  total_tokens_used: number;
}

export function formatAnalysisDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  if (safeMs === 0) return '0 ms (0.00s)';
  const seconds = safeMs / 1000;
  if (seconds < 60) {
    return `${safeMs.toLocaleString()} ms (${seconds.toFixed(2)}s)`;
  }
  const mins = Math.floor(seconds / 60);
  const remSec = (seconds % 60).toFixed(1);
  return `${mins}m ${remSec}s (${safeMs.toLocaleString()} ms)`;
}

/**
 * Formats milliseconds into a live digital stopwatch counter: MM:SS.d (e.g., "00:04.2" or "01:15.8")
 */
export function formatElapsedCounter(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalTenths = Math.floor(safeMs / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${mm}:${ss}.${tenths}`;
}

/**
 * Computes the live monotonic elapsed time in milliseconds for an AI analysis entry at `nowMs`.
 */
export function computeLiveEntryElapsedMs(
  entry: Pick<
    AiAnalysisActivityEntry,
    'status' | 'latency_ms' | 'timestamp' | 'queue_metadata'
  >,
  nowMs: number,
  fallbackStartMs?: number
): number {
  if (entry.status === 'processing') {
    const isoStart = entry.queue_metadata?.started_at || entry.timestamp;
    const parsedStart = isoStart ? Date.parse(isoStart) : NaN;
    const baseStart = Number.isFinite(parsedStart)
      ? parsedStart
      : (fallbackStartMs ?? nowMs - Math.max(50, entry.latency_ms));
    const delta = Math.max(0, Math.round(nowMs - baseStart));
    return Math.max(Math.max(0, Math.round(entry.latency_ms)), delta);
  }
  if (entry.status === 'pending') {
    const isoQueued = entry.queue_metadata?.queued_at || entry.timestamp;
    const parsedQueued = isoQueued ? Date.parse(isoQueued) : NaN;
    const baseQueued = Number.isFinite(parsedQueued)
      ? parsedQueued
      : (fallbackStartMs ?? nowMs);
    return Math.max(0, Math.round(nowMs - baseQueued));
  }
  return Math.max(0, Math.round(entry.latency_ms));
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'apca-api-secret-key',
  'apca-api-key-id',
  'api_key',
  'apikey',
  'secret',
  'token',
  'password',
]);

function maskSensitiveObject(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 15).map((item) => maskSensitiveObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = maskSensitiveObject(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function sanitizePayloadForLog(
  payload: unknown,
  maxLength = 6000
): string {
  if (payload === undefined || payload === null || payload === '') {
    return '{}';
  }
  try {
    const parsed =
      typeof payload === 'string' ? JSON.parse(payload) : payload;
    const masked = maskSensitiveObject(parsed);
    const serialized = JSON.stringify(masked, null, 2);
    if (serialized.length > maxLength) {
      return `${serialized.slice(0, maxLength)}\n... [truncated ${serialized.length - maxLength} chars]`;
    }
    return serialized;
  } catch {
    const raw = String(payload);
    return raw.length > maxLength
      ? `${raw.slice(0, maxLength)}... [truncated]`
      : raw;
  }
}

export function classifyApiServiceFromPath(
  pathOrUrl: string,
  explicitDirection?: ApiDirection
): { direction: ApiDirection; service: ApiServiceCategory } {
  const lower = pathOrUrl.toLowerCase();
  if (
    explicitDirection === 'outbound_lm_studio' ||
    lower.includes(':1234') ||
    lower.includes('/v1/chat/completions') ||
    lower.includes('/v1/models') ||
    lower.includes('/api/settings/llm-engine') ||
    lower.includes('/api/ai-analysis')
  ) {
    return {
      direction: explicitDirection ?? 'outbound_lm_studio',
      service: 'LM Studio LLM Engine',
    };
  }
  if (
    lower.includes('data.alpaca.markets') ||
    lower.includes('/api/alpaca/stock-context') ||
    lower.includes('/api/alpaca/sync') ||
    lower.includes('/api/alpaca/status')
  ) {
    return {
      direction: explicitDirection ?? 'outbound_alpaca',
      service: 'Alpaca Market Data v2',
    };
  }
  if (
    lower.includes('paper-api.alpaca.markets') ||
    lower.includes('api.alpaca.markets') ||
    lower.includes('/api/alpaca/account-overview')
  ) {
    return {
      direction: explicitDirection ?? 'outbound_alpaca',
      service: 'Alpaca Trading API v2',
    };
  }
  if (
    lower.includes('unusualwhales.com') ||
    lower.includes('/api/uw/') ||
    lower.includes('/api/market/market-tide')
  ) {
    return {
      direction: explicitDirection ?? 'outbound_unusual_whales',
      service: 'Unusual Whales API',
    };
  }
  return {
    direction: explicitDirection ?? 'inbound_rest',
    service: 'Internal Scanner API',
  };
}

export function computeApiActivityMetrics(
  logs: ApiActivityLogEntry[]
): ApiActivityMetrics {
  const by_service: Record<
    ApiServiceCategory,
    { total: number; errors: number }
  > = {
    'Internal Scanner API': { total: 0, errors: 0 },
    'Alpaca Market Data v2': { total: 0, errors: 0 },
    'Alpaca Trading API v2': { total: 0, errors: 0 },
    'Unusual Whales API': { total: 0, errors: 0 },
    'LM Studio LLM Engine': { total: 0, errors: 0 },
  };

  if (logs.length === 0) {
    return {
      total_requests: 0,
      success_count: 0,
      error_count: 0,
      success_rate_pct: 100,
      avg_latency_ms: 0,
      max_latency_ms: 0,
      by_service,
    };
  }

  let successCount = 0;
  let errorCount = 0;
  let totalLatency = 0;
  let maxLatency = 0;

  for (const entry of logs) {
    if (!by_service[entry.service]) {
      by_service[entry.service] = { total: 0, errors: 0 };
    }
    by_service[entry.service].total += 1;

    if (entry.ok && entry.status_code >= 200 && entry.status_code < 400 && !entry.error_message) {
      successCount += 1;
    } else {
      errorCount += 1;
      by_service[entry.service].errors += 1;
    }

    totalLatency += Math.max(0, entry.latency_ms);
    if (entry.latency_ms > maxLatency) {
      maxLatency = entry.latency_ms;
    }
  }

  return {
    total_requests: logs.length,
    success_count: successCount,
    error_count: errorCount,
    success_rate_pct: round2((successCount / logs.length) * 100),
    avg_latency_ms: Math.round(totalLatency / logs.length),
    max_latency_ms: Math.round(maxLatency),
    by_service,
  };
}

export function computeAiAnalysisMetrics(
  logs: AiAnalysisActivityEntry[]
): AiAnalysisMetrics {
  if (logs.length === 0) {
    return {
      total_analyses: 0,
      processing_count: 0,
      pending_count: 0,
      completed_count: 0,
      success_count: 0,
      error_count: 0,
      stage1_count: 0,
      stage2_count: 0,
      holdings_eval_count: 0,
      success_rate_pct: 100,
      avg_latency_ms: 0,
      total_analysis_time_ms: 0,
      completed_analysis_time_ms: 0,
      processing_elapsed_time_ms: 0,
      total_tokens_used: 0,
    };
  }

  let processingCount = 0;
  let pendingCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let stage1Count = 0;
  let stage2Count = 0;
  let holdingsEvalCount = 0;
  let totalLatency = 0;
  let completedLatency = 0;
  let processingElapsedLatency = 0;
  let latencySampleCount = 0;
  let totalTokens = 0;

  for (const item of logs) {
    if (
      item.analysis_type === 'stage1_entry_decision' ||
      item.analysis_type === 'whale_candidate_evaluation'
    ) {
      stage1Count += 1;
    } else if (item.analysis_type === 'stage2_position_size_risk_strategy') {
      stage2Count += 1;
    } else if (
      item.analysis_type === 'holding_stage1_risk_evaluation' ||
      item.analysis_type === 'holding_stage2_exit_plan'
    ) {
      holdingsEvalCount += 1;
    }

    if (item.status === 'processing') {
      processingCount += 1;
      if (item.latency_ms > 0) {
        const elapsed = Math.max(0, item.latency_ms);
        totalLatency += elapsed;
        processingElapsedLatency += elapsed;
        latencySampleCount += 1;
      }
      totalTokens += Math.max(0, item.total_tokens);
    } else if (item.status === 'pending') {
      pendingCount += 1;
      totalTokens += Math.max(0, item.total_tokens);
    } else if (item.status === 'success' && !item.error_details.has_error) {
      successCount += 1;
      const lat = Math.max(0, item.latency_ms);
      totalLatency += lat;
      completedLatency += lat;
      latencySampleCount += 1;
      totalTokens += Math.max(0, item.total_tokens);
    } else {
      errorCount += 1;
      const lat = Math.max(0, item.latency_ms);
      totalLatency += lat;
      completedLatency += lat;
      latencySampleCount += 1;
      totalTokens += Math.max(0, item.total_tokens);
    }
  }

  const completedCount = successCount + errorCount;

  return {
    total_analyses: logs.length,
    processing_count: processingCount,
    pending_count: pendingCount,
    completed_count: completedCount,
    success_count: successCount,
    error_count: errorCount,
    stage1_count: stage1Count,
    stage2_count: stage2Count,
    holdings_eval_count: holdingsEvalCount,
    success_rate_pct:
      completedCount > 0 ? round2((successCount / completedCount) * 100) : 100,
    avg_latency_ms:
      latencySampleCount > 0 ? Math.round(totalLatency / latencySampleCount) : 0,
    total_analysis_time_ms: Math.round(totalLatency),
    completed_analysis_time_ms: Math.round(completedLatency),
    processing_elapsed_time_ms: Math.round(processingElapsedLatency),
    total_tokens_used: totalTokens,
  };
}

export function buildCandidateAiAnalysisPrompts(
  candidate: WhaleCandidate,
  llmConfig: LlmEngineConfig,
  marketTide: MarketTideState,
  customInstruction?: string
): {
  endpoint_url: string;
  system_prompt: string;
  user_prompt: string;
  context_snapshot: string;
  request_body: string;
} {
  const endpoints = normalizeLmStudioEndpoints(llmConfig.endpointUrl);
  const chatEndpoint = endpoints.primaryChatCompletionsUrl;

  const sc = candidate.stock_confirmation;
  const ind = sc?.indicators;

  const contextObj: Record<string, unknown> = {
    candidate_id: candidate.candidate_id,
    ticker: candidate.ticker,
    option_symbol: candidate.option_symbol,
    direction: candidate.direction,
    option_type: candidate.option_type,
    strike: candidate.strike,
    expiry: candidate.expiry,
    dte: candidate.dte,
    whale_score: candidate.whale_score,
    adaptive_whale_score: candidate.decision?.final_score ?? candidate.whale_score,
    status: candidate.status,
    flow_metrics: {
      premium_5m: candidate.flow.premium_5m,
      premium_1m: candidate.flow.premium_1m,
      volume_oi_ratio: candidate.flow.volume_oi_ratio,
      side_share: candidate.flow.side_share,
      sweep_ratio: candidate.flow.sweep_ratio,
      contract_share: candidate.flow.contract_share,
      robust_zscore: candidate.bursts.robust_zscore,
    },
  };

  if (llmConfig.includeAlpacaStockIndicators) {
    contextObj.alpaca_stock_confirmation = sc
      ? {
          data_source: sc.data_source,
          confirmed_3_of_5: sc.confirmed_3_of_5,
          rules_passed: `${sc.rules_passed_count}/5`,
          stock_confirmation_score: sc.stock_confirmation_score,
          final_composite_70_30_score: sc.final_composite_score,
          weighted_components: sc.weighted_components,
          secondary_boost_points: sc.secondary_boost_points,
          indicators_5m: ind
            ? {
                last_price: candidate.underlying.price_at_detection,
                vwap_session: ind.vwap_session,
                ema_9: ind.ema_9,
                ema_20: ind.ema_20,
                ema_50: ind.ema_50,
                atr_14: ind.atr_14,
                relative_volume_5m: candidate.underlying.relative_volume_5m,
                rsi_14: ind.rsi_14,
                macd_histogram: ind.macd_histogram,
                adx_14: ind.adx_14,
                post_burst_atr_multiple: ind.post_burst_atr_multiple,
              }
            : null,
        }
      : {
          underlying_price: candidate.underlying.price_at_detection,
          return_5m: candidate.underlying.return_5m,
          relative_volume_5m: candidate.underlying.relative_volume_5m,
          vwap_aligned: candidate.underlying.vwap_aligned,
        };
  }

  if (llmConfig.includeGexAndTideContext) {
    contextObj.market_tide_and_gex = {
      tide_regime: marketTide.regime,
      active_filter_profile: marketTide.active_filter_profile,
      net_call_premium: marketTide.net_call_premium,
      net_put_premium: marketTide.net_put_premium,
      net_premium_5m: marketTide.net_premium_5m,
      tide_zscore: marketTide.tide_zscore,
      spy_spot: marketTide.market_state?.gex?.spy_spot,
      spy_gamma_flip: marketTide.market_state?.gex?.spy_gamma_flip,
      ticker_gex: candidate.gamma_context ?? null,
    };
  }

  const contextSnapshot = JSON.stringify(contextObj, null, 2);

  const userLines: string[] = [
    `Analyze institutional options flow candidate ${candidate.ticker} (${candidate.option_symbol}) — ${candidate.direction.toUpperCase()} $${candidate.strike} ${candidate.option_type.toUpperCase()} expiring ${candidate.expiry} (${candidate.dte} DTE).`,
    `- Flow Cluster: 5m Premium $${(candidate.flow.premium_5m / 1000).toFixed(1)}K | Vol/OI ${candidate.flow.volume_oi_ratio.toFixed(2)}x | Side Share ${Math.round(candidate.flow.side_share * 100)}% | Sweep Ratio ${Math.round(candidate.flow.sweep_ratio * 100)}% | Burst Z-Score ${candidate.bursts.robust_zscore.toFixed(2)}`,
  ];

  if (llmConfig.includeAlpacaStockIndicators && sc && ind) {
    userLines.push(
      `- Alpaca 5m Stock Confirmation (${sc.rules_passed_count}/5 rules passed, 70/30 Composite Score ${sc.final_composite_score}): Spot $${candidate.underlying.price_at_detection.toFixed(2)} vs Session VWAP $${ind.vwap_session.toFixed(2)} | EMA9 $${ind.ema_9.toFixed(2)} vs EMA20 $${ind.ema_20.toFixed(2)} | 5m RVOL ${candidate.underlying.relative_volume_5m.toFixed(2)}x | Post-Burst Move ${ind.post_burst_atr_multiple.toFixed(2)}x ATR14 ($${ind.atr_14.toFixed(2)}) | RSI14 ${ind.rsi_14.toFixed(1)} | MACD Hist ${ind.macd_histogram.toFixed(3)}`
    );
  }

  if (llmConfig.includeGexAndTideContext) {
    userLines.push(
      `- Market Tide & GEX State: Regime=${marketTide.regime} (z=${marketTide.tide_zscore.toFixed(2)}, 5m Net Prem $${(marketTide.net_premium_5m / 1_000_000).toFixed(2)}M) | Active Profile=${marketTide.active_filter_profile ?? 'risk_on_trend'} | Call Wall $${candidate.gamma_context?.call_wall ?? 'N/A'} | Put Wall $${candidate.gamma_context?.put_wall ?? 'N/A'} | Gamma Flip $${candidate.gamma_context?.gamma_flip ?? 'N/A'}`
    );
  }

  if (customInstruction && customInstruction.trim()) {
    userLines.push(`\nAdditional Operator Instruction: ${customInstruction.trim()}`);
  }

  userLines.push(
    `\nProvide a structured institutional assessment covering: (1) Conviction & Verdict, (2) Options Flow vs. Alpaca 5m Stock Alignment, (3) Key Gamma/VWAP Levels & Invalidation, and (4) Primary Execution Risks.`
  );

  const userPrompt = userLines.join('\n');
  const systemPrompt = llmConfig.systemPromptTemplate;

  const requestBodyObj = buildOptimizedLmStudioChatPayload({
    modelId: llmConfig.modelId,
    systemPrompt,
    userPrompt,
    temperature: llmConfig.temperature,
    topP: llmConfig.topP,
    maxTokens: llmConfig.maxTokens,
    maxTokensEnabled: llmConfig.maxTokensEnabled ?? true,
    thinkingMode: llmConfig.thinkingMode ?? 'no_think',
    stream: false,
  });

  return {
    endpoint_url: chatEndpoint,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    context_snapshot: contextSnapshot,
    request_body: JSON.stringify(requestBodyObj, null, 2),
  };
}

export function generateStructuredAiSynthesisForCandidate(
  candidate: WhaleCandidate,
  marketTide: MarketTideState,
  modelId: string
): {
  assistant_message: string;
  raw_response: string;
  verdict: AiAnalysisVerdict;
  confidence_score: number;
  prompt_tokens: number;
  completion_tokens: number;
} {
  const sc = candidate.stock_confirmation;
  const ind = sc?.indicators;
  const rulesPassed = sc?.rules_passed_count ?? (candidate.status === 'confirmed' ? 4 : 2);
  const compositeScore = sc?.final_composite_score ?? candidate.whale_score;
  const isBull = candidate.direction === 'bullish';

  let verdict: AiAnalysisVerdict = 'watch_for_confirmation';
  if (compositeScore >= 80 && rulesPassed >= 3) {
    verdict = isBull ? 'high_conviction_bullish' : 'high_conviction_bearish';
  } else if (compositeScore < 65 || rulesPassed <= 1) {
    verdict = 'avoid_conflicting_tape';
  }

  const confidenceScore = Math.min(
    98,
    Math.max(42, Math.round(compositeScore * 0.92 + rulesPassed * 2))
  );

  const spotStr = `$${candidate.underlying.price_at_detection.toFixed(2)}`;
  const vwapStr = ind ? `$${ind.vwap_session.toFixed(2)}` : 'Session VWAP';
  const emaStr = ind
    ? `EMA9 ($${ind.ema_9.toFixed(2)}) ${ind.ema_9 >= ind.ema_20 ? '>' : '<'} EMA20 ($${ind.ema_20.toFixed(2)})`
    : 'EMA9/EMA20 stack';
  const atrStr = ind
    ? `${ind.post_burst_atr_multiple.toFixed(2)}x 5m ATR ($${ind.atr_14.toFixed(2)})`
    : '0.65x ATR';
  const rvolStr = `${candidate.underlying.relative_volume_5m.toFixed(2)}x`;

  const callWall = candidate.gamma_context?.call_wall ?? Math.round(candidate.strike * 1.03);
  const putWall = candidate.gamma_context?.put_wall ?? Math.round(candidate.strike * 0.96);
  const gammaFlip = candidate.gamma_context?.gamma_flip ?? Math.round(candidate.strike * 0.985);

  const assistantMessage = [
    `### 1. Conviction & Verdict: ${verdict.toUpperCase().replace(/_/g, ' ')} (Confidence: ${confidenceScore}/100)`,
    `- **Contract**: \`${candidate.option_symbol}\` (${candidate.ticker} $${candidate.strike}${candidate.option_type === 'call' ? 'C' : 'P'} · ${candidate.dte} DTE)`,
    `- **Composite 70/30 Score**: **${compositeScore}** (Options Flow Score: ${candidate.whale_score} · Alpaca Stock Confirmation: ${sc?.stock_confirmation_score ?? 78})`,
    '',
    `### 2. Options Flow vs. Alpaca 5m Underlying Response (${rulesPassed}/5 Rules Passed)`,
    `- **Aggressor Concentration**: $${(candidate.flow.premium_5m / 1000).toFixed(1)}K 5-minute clustered premium with ${Math.round(candidate.flow.side_share * 100)}% directional side share, ${Math.round(candidate.flow.sweep_ratio * 100)}% multi-exchange sweeps, and ${candidate.flow.volume_oi_ratio.toFixed(2)}x Vol/OI (${candidate.bursts.robust_zscore.toFixed(2)}σ burst).`,
    `- **Price & Volume Follow-Through**: Underlying spot (${spotStr}) vs. ${vwapStr} with ${emaStr}. 5-minute relative volume is **${rvolStr}** expected participation, producing a **${atrStr}** post-signal expansion.`,
    '',
    `### 3. Key Gamma, VWAP & Invalidation Structure`,
    `- **Primary Upside/Downside Target**: Call Wall at **$${callWall}** / Put Wall at **$${putWall}** (Gamma Flip at **$${gammaFlip}**).`,
    `- **Hard Invalidation Level**: Two consecutive 5-minute closes ${isBull ? 'below' : 'above'} ${vwapStr} or loss of the 5-minute signal candle ${isBull ? 'low' : 'high'}.`,
    '',
    `### 4. Market Tide & Execution Risk Check`,
    `- **Market Tide Context**: Active regime is \`${marketTide.regime}\` (z=${marketTide.tide_zscore.toFixed(2)}, profile \`${marketTide.active_filter_profile ?? 'risk_on_trend'}\`). ${candidate.flow.oi_status === 'verified_next_day_oi' ? 'Open interest is next-day verified.' : 'Intraday Vol > OI requires overnight OI verification at T+1.'}`,
  ].join('\n');

  const promptTokens = 310 + Math.round(candidate.option_symbol.length * 2);
  const completionTokens = 245;

  const rawResponseObj = {
    id: `chatcmpl-${candidate.ticker.toLowerCase()}-${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId || 'local-model',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: assistantMessage,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };

  return {
    assistant_message: assistantMessage,
    raw_response: JSON.stringify(rawResponseObj, null, 2),
    verdict,
    confidence_score: confidenceScore,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  };
}

export function createInitialSeedApiLogs(): ApiActivityLogEntry[] {
  const now = Date.now();
  return [
    {
      request_id: 'api-seed-001',
      timestamp: new Date(now - 95_000).toISOString(),
      direction: 'outbound_alpaca',
      service: 'Alpaca Market Data v2',
      method: 'GET',
      endpoint:
        'https://data.alpaca.markets/v2/stocks/bars?symbols=NVDA,TSLA,AMD,META,AAPL,MSFT,AMZN,PLTR,COIN,SPY&timeframe=5Min&feed=sip',
      status_code: 200,
      ok: true,
      latency_ms: 142,
      request_payload: JSON.stringify(
        {
          headers: {
            'APCA-API-KEY-ID': '***REDACTED***',
            'APCA-API-SECRET-KEY': '***REDACTED***',
            Accept: 'application/json',
          },
          query: {
            symbols: 'NVDA,TSLA,AMD,META,AAPL,MSFT,AMZN,PLTR,COIN,SPY',
            timeframe: '5Min',
            feed: 'sip',
            limit: 1000,
          },
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          bars_returned_tickers: [
            'NVDA',
            'TSLA',
            'AMD',
            'META',
            'AAPL',
            'MSFT',
            'AMZN',
            'PLTR',
            'COIN',
            'SPY',
          ],
          total_5m_bars_cached: 2400,
          indicators_computed: [
            'vwap',
            'ema_9_20_50',
            'atr_14',
            'rsi_14',
            'macd',
            'bollinger_20_2',
            'adx_14',
          ],
        },
        null,
        2
      ),
      error_message: null,
    },
    {
      request_id: 'api-seed-002',
      timestamp: new Date(now - 78_000).toISOString(),
      direction: 'outbound_alpaca',
      service: 'Alpaca Trading API v2',
      method: 'GET',
      endpoint:
        'https://paper-api.alpaca.markets/v2/account + /v2/positions + /v2/account/activities/FILL',
      status_code: 200,
      ok: true,
      latency_ms: 168,
      request_payload: JSON.stringify(
        {
          endpoints: [
            '/v2/account',
            '/v2/positions',
            '/v2/account/portfolio/history?period=1M&timeframe=1D',
            '/v2/account/activities/FILL?page_size=100',
          ],
          headers: {
            'APCA-API-KEY-ID': '***REDACTED***',
            'APCA-API-SECRET-KEY': '***REDACTED***',
          },
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          account_status: 'ACTIVE',
          data_source: 'alpaca_live',
          fifo_round_trip_trades_reconstructed: true,
          portfolio_curves_loaded: ['1D', '1W', '1M', '3M', '1A'],
        },
        null,
        2
      ),
      error_message: null,
    },
    {
      request_id: 'api-seed-003',
      timestamp: new Date(now - 54_000).toISOString(),
      direction: 'outbound_unusual_whales',
      service: 'Unusual Whales API',
      method: 'GET',
      endpoint:
        'https://api.unusualwhales.com/api/market/market-tide?interval_5m=true',
      status_code: 200,
      ok: true,
      latency_ms: 64,
      request_payload: JSON.stringify(
        {
          channel: 'market_tide',
          interval: '5m',
          include_0dte_breakdown: true,
          include_gex_walls: true,
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          regime: 'strong_positive',
          net_call_premium: 62_400_000,
          net_put_premium: -18_700_000,
          net_premium_5m: 9_100_000,
          tide_zscore: 2.34,
          spy_spot: 586.4,
          spy_gamma_flip: 581.0,
        },
        null,
        2
      ),
      error_message: null,
    },
    {
      request_id: 'api-seed-004',
      timestamp: new Date(now - 32_000).toISOString(),
      direction: 'outbound_lm_studio',
      service: 'LM Studio LLM Engine',
      method: 'GET',
      endpoint: 'http://localhost:1234/v1/models',
      status_code: 0,
      ok: false,
      latency_ms: 19,
      request_payload: JSON.stringify(
        {
          method: 'GET',
          url: 'http://localhost:1234/v1/models',
          headers: { Accept: 'application/json' },
          timeout_ms: 5000,
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          reachable: false,
          status: 0,
          endpoint_tested: 'http://localhost:1234/v1/models',
          models: [],
        },
        null,
        2
      ),
      error_message:
        'ECONNREFUSED 127.0.0.1:1234 — Local LM Studio server is not reachable from the cloud container. Start LM Studio server on port 1234 or use a reachable tunnel/LAN endpoint.',
    },
    {
      request_id: 'api-seed-005',
      timestamp: new Date(now - 12_000).toISOString(),
      direction: 'inbound_rest',
      service: 'Internal Scanner API',
      method: 'GET',
      endpoint:
        '/api/v1/scanners/default/candidates?mode=directional_momentum&min_score=60&include_etfs=false&regime_adaptive=true',
      status_code: 200,
      ok: true,
      latency_ms: 8,
      request_payload: JSON.stringify(
        {
          mode: 'directional_momentum',
          min_score: 60,
          include_etfs: false,
          regime_adaptive: true,
          adaptive_profile: 'risk_on_trend',
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          scanner_id: 'default',
          active_filter_profile: 'risk_on_trend',
          status: 'ok',
        },
        null,
        2
      ),
      error_message: null,
    },
  ];
}

export function createInitialSeedAiAnalysisLogs(
  candidates: WhaleCandidate[],
  llmConfig: LlmEngineConfig,
  marketTide: MarketTideState
): AiAnalysisActivityEntry[] {
  const now = Date.now();
  const entries: AiAnalysisActivityEntry[] = [];

  const firstCand = candidates[0];
  if (firstCand) {
    const prompts1 = buildCandidateAiAnalysisPrompts(
      firstCand,
      llmConfig,
      marketTide
    );
    const synth1 = generateStructuredAiSynthesisForCandidate(
      firstCand,
      marketTide,
      llmConfig.modelId
    );
    entries.push({
      analysis_id: 'ai-seed-001',
      timestamp: new Date(now - 85_000).toISOString(),
      candidate_id: firstCand.candidate_id,
      ticker: firstCand.ticker,
      option_symbol: firstCand.option_symbol,
      direction: firstCand.direction,
      analysis_type: 'whale_candidate_evaluation',
      endpoint_url: prompts1.endpoint_url,
      model_id: llmConfig.modelId || 'local-model',
      status: 'success',
      execution_mode: 'deterministic_synthesis',
      latency_ms: 412,
      prompt_tokens: synth1.prompt_tokens,
      completion_tokens: synth1.completion_tokens,
      total_tokens: synth1.prompt_tokens + synth1.completion_tokens,
      input_payload: {
        system_prompt: prompts1.system_prompt,
        user_prompt: prompts1.user_prompt,
        context_snapshot: prompts1.context_snapshot,
        request_body: prompts1.request_body,
      },
      output_payload: {
        assistant_message: synth1.assistant_message,
        raw_response: synth1.raw_response,
        verdict: synth1.verdict,
        confidence_score: synth1.confidence_score,
      },
      error_details: {
        has_error: false,
        error_code: null,
        error_message: null,
        endpoint_attempted: prompts1.endpoint_url,
      },
    });
  }

  const secondCand = candidates[1] ?? candidates[0];
  if (secondCand) {
    const prompts2 = buildCandidateAiAnalysisPrompts(
      secondCand,
      llmConfig,
      marketTide,
      'Focus specifically on 5-minute Alpaca VWAP acceptance and whether lit stock prints confirm institutional delta hedging.'
    );
    const synth2 = generateStructuredAiSynthesisForCandidate(
      secondCand,
      marketTide,
      llmConfig.modelId
    );
    entries.push({
      analysis_id: 'ai-seed-002',
      timestamp: new Date(now - 48_000).toISOString(),
      candidate_id: secondCand.candidate_id,
      ticker: secondCand.ticker,
      option_symbol: secondCand.option_symbol,
      direction: secondCand.direction,
      analysis_type: 'stock_technical_confirmation',
      endpoint_url: prompts2.endpoint_url,
      model_id: llmConfig.modelId || 'local-model',
      status: 'success',
      execution_mode: 'deterministic_synthesis',
      latency_ms: 385,
      prompt_tokens: synth2.prompt_tokens,
      completion_tokens: synth2.completion_tokens,
      total_tokens: synth2.prompt_tokens + synth2.completion_tokens,
      input_payload: {
        system_prompt: prompts2.system_prompt,
        user_prompt: prompts2.user_prompt,
        context_snapshot: prompts2.context_snapshot,
        request_body: prompts2.request_body,
      },
      output_payload: {
        assistant_message: synth2.assistant_message,
        raw_response: synth2.raw_response,
        verdict: synth2.verdict,
        confidence_score: synth2.confidence_score,
      },
      error_details: {
        has_error: false,
        error_code: null,
        error_message: null,
        endpoint_attempted: prompts2.endpoint_url,
      },
    });
  }

  const thirdCand = candidates[2] ?? candidates[0];
  if (thirdCand) {
    const prompts3 = buildCandidateAiAnalysisPrompts(
      thirdCand,
      llmConfig,
      marketTide
    );
    entries.push({
      analysis_id: 'ai-seed-003',
      timestamp: new Date(now - 22_000).toISOString(),
      candidate_id: thirdCand.candidate_id,
      ticker: thirdCand.ticker,
      option_symbol: thirdCand.option_symbol,
      direction: thirdCand.direction,
      analysis_type: 'whale_candidate_evaluation',
      endpoint_url: prompts3.endpoint_url,
      model_id: llmConfig.modelId || 'local-model',
      status: 'error',
      execution_mode: 'endpoint_error',
      latency_ms: 24,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      input_payload: {
        system_prompt: prompts3.system_prompt,
        user_prompt: prompts3.user_prompt,
        context_snapshot: prompts3.context_snapshot,
        request_body: prompts3.request_body,
      },
      output_payload: {
        assistant_message: '',
        raw_response: JSON.stringify(
          {
            error: {
              code: 'ECONNREFUSED',
              message:
                'connect ECONNREFUSED 127.0.0.1:1234 — LM Studio local server did not accept the connection.',
              endpoint: prompts3.endpoint_url,
            },
          },
          null,
          2
        ),
        verdict: 'error',
        confidence_score: 0,
      },
      error_details: {
        has_error: true,
        error_code: 'ECONNREFUSED',
        error_message: `POST ${prompts3.endpoint_url} failed: connect ECONNREFUSED 127.0.0.1:1234. Verify LM Studio Local Server is running on port 1234 or switch execution mode to Quantitative Synthesis.`,
        endpoint_attempted: prompts3.endpoint_url,
      },
    });
  }

  return entries;
}

/**
 * Converts a Stage-1 AI Trade Entry Decision record into an AiAnalysisActivityEntry
 * so every order decision is logged in the AI Analysis Activity Monitor.
 */
export function buildStage1DecisionAiActivityEntry(
  record: LlmTradeDecisionRecord
): AiAnalysisActivityEntry {
  const out = record.llm_output;
  const verdict: AiAnalysisVerdict =
    out.decision === 'EXECUTE'
      ? record.direction === 'bullish'
        ? 'high_conviction_bullish'
        : 'high_conviction_bearish'
      : out.decision === 'WATCH' || out.decision === 'HUMAN REVIEW'
        ? 'watch_for_confirmation'
        : 'avoid_conflicting_tape';

  const promptTokens = Math.max(
    180,
    Math.round(
      (record.prompt_payload.system_prompt.length +
        record.prompt_payload.user_prompt.length) /
        3.8
    )
  );
  const completionTokens = Math.max(
    95,
    Math.round(out.thesis_summary.length / 3.2) + 85
  );

  const formattedMessage = [
    `[STAGE-1 AI TRADE DECISION GATE] Verdict: ${out.decision} (${out.confidence_pct}% Confidence)`,
    `Contract: ${record.option_symbol} (${record.ticker} $${record.strike} ${record.option_type.toUpperCase()} · ${record.dte}DTE · ${record.direction.toUpperCase()})`,
    `Whale Intent: ${out.whale_intent} | Recommended Structure: ${out.recommended_structure}`,
    '',
    `Thesis Summary:`,
    out.thesis_summary,
    '',
    `Supporting Evidence:`,
    ...out.supporting_reasons.map((r) => `• ${r}`),
    ...(out.contradictions_and_risks.length > 0
      ? ['', 'Contradictions & Risk Factors:', ...out.contradictions_and_risks.map((r) => `• ${r}`)]
      : []),
    '',
    `Invalidation Level: ${out.invalidation_level}`,
    out.decision === 'EXECUTE'
      ? '→ Stage-1 Decision is EXECUTE: Triggering mandatory Stage-2 AI Analysis for Position Size, Risk & Initial Trading Strategy.'
      : `→ Stage-1 Decision is ${out.decision}: Order entry blocked prior to Stage-2 sizing.`,
  ].join('\n');

  const requestBodyJson = JSON.stringify(
    {
      model: record.model_id,
      stage: 'STAGE_1_ENTRY_DECISION_GATE',
      candidate_id: record.candidate_id,
      option_symbol: record.option_symbol,
      messages: [
        { role: 'system', content: record.prompt_payload.system_prompt },
        { role: 'user', content: record.prompt_payload.user_prompt },
      ],
    },
    null,
    2
  );

  return {
    analysis_id: `ai-stg1-${record.decision_id}`,
    timestamp: record.created_at,
    candidate_id: record.candidate_id,
    ticker: record.ticker,
    option_symbol: record.option_symbol,
    direction: record.direction,
    analysis_type: 'stage1_entry_decision',
    endpoint_url: record.endpoint_url,
    model_id: record.model_id || 'local-model',
    status: 'success',
    execution_mode: record.execution_mode,
    latency_ms: record.latency_ms,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    input_payload: {
      system_prompt: record.prompt_payload.system_prompt,
      user_prompt: record.prompt_payload.user_prompt,
      context_snapshot: record.prompt_payload.evidence_packet_json,
      request_body: requestBodyJson,
    },
    output_payload: {
      assistant_message: formattedMessage,
      raw_response: record.prompt_payload.raw_llm_response_json,
      verdict,
      confidence_score: out.confidence_pct,
    },
    error_details: {
      has_error: false,
      error_code: null,
      error_message: null,
      endpoint_attempted: record.endpoint_url,
    },
  };
}

/**
 * Converts a Stage-2 AI Position Size, Risk & Initial Trading Strategy assessment into
 * a dedicated AiAnalysisActivityEntry whenever Stage-1 AI decides to enter a position (EXECUTE).
 */
export function buildStage2RiskStrategyAiActivityEntry(
  record: LlmTradeDecisionRecord,
  llmConfig?: LlmEngineConfig
): AiAnalysisActivityEntry {
  const plan = record.risk_first_execution_plan;
  const stg2 = plan.stage2_llm_risk_assessment;
  const strat = stg2.initial_trading_strategy;

  const prompts = buildStage2LlmRiskAssessmentPrompts({
    plan,
    modelId: stg2.model_id || record.model_id || 'local-model',
    endpointUrl: llmConfig?.endpointUrl || record.endpoint_url,
    temperature: llmConfig?.temperature ?? 0.2,
    topP: llmConfig?.topP ?? 0.9,
    maxTokens: llmConfig?.maxTokens ?? 700,
    maxTokensEnabled: llmConfig?.maxTokensEnabled ?? true,
    thinkingMode: stg2.thinking_mode ?? llmConfig?.thinkingMode ?? 'no_think',
  });

  const verdict: AiAnalysisVerdict =
    stg2.decision === 'APPROVED' && stg2.quantity >= 1
      ? record.direction === 'bullish'
        ? 'high_conviction_bullish'
        : 'high_conviction_bearish'
      : 'avoid_conflicting_tape';

  const promptTokens = Math.max(
    160,
    Math.round((prompts.system_prompt.length + prompts.user_prompt.length) / 3.8)
  );
  const completionTokens = Math.max(
    130,
    Math.round((stg2.raw_response_text?.length || 420) / 3.4)
  );

  const stage2Timestamp =
    stg2.assessed_at && stg2.assessed_at > record.created_at
      ? stg2.assessed_at
      : new Date(new Date(record.created_at).getTime() + 1000).toISOString();

  const formattedMessage = [
    `[STAGE-2 AI POSITION SIZE, RISK & INITIAL TRADING STRATEGY] Verdict: ${stg2.decision}`,
    `Contract: ${record.option_symbol} (${record.ticker} $${record.strike} ${record.option_type.toUpperCase()} · ${record.dte}DTE)`,
    '',
    `1. POSITION SIZE & ACCOUNT RISK PARAMETERS:`,
    `• Approved Quantity: ${stg2.quantity} contract(s) (Max Permitted by Risk Engine: ${plan.sizing.permitted_qty}x)`,
    `• Planned Limit Entry: $${stg2.entry_limit.toFixed(2)} | Hard Option Stop: $${stg2.premium_stop.toFixed(2)}`,
    `• Maximum Total Debit: $${stg2.maximum_debit.toFixed(0)} | Max Planned Loss at Stop: $${stg2.maximum_planned_loss.toFixed(0)} (${(stg2.risk_pct_of_equity * 100).toFixed(2)}% of $${plan.budgets.effective_equity_dollars.toLocaleString()} Equity)`,
    `• Recommended Smart Order Algo: ${stg2.recommended_smart_algo}`,
    `• Risk & Sizing Rationale: ${stg2.llm_risk_narrative}`,
    `• Binding Sizing Constraint: ${stg2.sizing_justification}`,
    '',
    `2. INITIAL TRADING STRATEGY (${strat.strategy_name} · ${strat.reward_to_risk_ratio.toFixed(2)}R Reward/Risk):`,
    `• Entry Execution Plan: ${strat.entry_execution_plan}`,
    `• Profit Target & Scale-Out Plan: ${strat.profit_target_plan}`,
    `• Hard Stop & Spot Invalidation Plan: ${strat.stop_and_invalidation_plan}`,
    `• Time & Theta Management Plan: ${strat.time_and_theta_plan}`,
  ].join('\n');

  const contextSnapshotJson = JSON.stringify(
    {
      stage1_decision: record.llm_output.decision,
      stage1_confidence_pct: record.llm_output.confidence_pct,
      input_contract: plan.input_contract,
      alpaca_account_budgets: plan.budgets,
      contract_sizing_breakdown: plan.sizing,
      option_trade_plan_levels: plan.trade_plan,
      initial_trading_strategy: strat,
    },
    null,
    2
  );

  return {
    analysis_id: `ai-stg2-${record.decision_id}`,
    timestamp: stage2Timestamp,
    candidate_id: record.candidate_id,
    ticker: record.ticker,
    option_symbol: record.option_symbol,
    direction: record.direction,
    analysis_type: 'stage2_position_size_risk_strategy',
    endpoint_url: prompts.endpoint_url,
    model_id: stg2.model_id || record.model_id || 'local-model',
    status: 'success',
    execution_mode: stg2.execution_mode,
    latency_ms: stg2.latency_ms,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    input_payload: {
      system_prompt: prompts.system_prompt,
      user_prompt: prompts.user_prompt,
      context_snapshot: contextSnapshotJson,
      request_body: JSON.stringify(prompts.request_body, null, 2),
    },
    output_payload: {
      assistant_message: formattedMessage,
      raw_response: stg2.raw_response_text,
      verdict,
      confidence_score: record.llm_output.confidence_pct,
    },
    error_details: {
      has_error: false,
      error_code: null,
      error_message: null,
      endpoint_attempted: prompts.endpoint_url,
    },
  };
}

