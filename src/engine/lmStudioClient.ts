export type LlmThinkingMode = 'no_think' | 'think';

export interface LlmDiscoveredModel {
  id: string;
  display_name?: string;
  params_string?: string;
  publisher?: string;
  object?: string;
  owned_by?: string;
  state?: 'loaded' | 'not-loaded' | 'unknown';
  arch?: string;
  quantization?: string;
  max_context_length?: number;
  type?: string;
  source_endpoint?: string;
}

export interface NormalizedLmStudioEndpoints {
  originBase: string;
  openAiBase: string;
  chatCompletionsUrl: string;
  openAiModelsUrl: string;
  nativeV0ModelsUrl: string;
  chatCompletionsUrls: string[];
  modelsDiscoveryUrls: string[];
  primaryChatCompletionsUrl: string;
  primaryModelsUrl: string;
}

/**
 * Normalizes any user-entered LM Studio URL (whether they typed
 * `http://localhost:1234`, `http://localhost:1234/v1`,
 * `http://localhost:1234/v1/models`, `http://localhost:1234/v1/chat/completions`,
 * `http://localhost:1234/api/v0`, or `http://localhost:1234/api/v1`)
 * into clean origin and route candidates.
 */
export function normalizeLmStudioEndpoints(
  rawEndpointUrl: string | undefined | null
): NormalizedLmStudioEndpoints {
  const fallback = 'http://localhost:1234';
  let cleaned = (rawEndpointUrl ?? '').trim();
  if (!cleaned) {
    cleaned = fallback;
  }

  // Add http:// if user typed localhost:1234 or 127.0.0.1:1234 without protocol
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `http://${cleaned}`;
  }

  // Strip trailing slashes and known suffixes so we never produce /v1/v1/models or /chat/completions/v1/models
  cleaned = cleaned.replace(/\/+$/, '');
  const originBase = cleaned
    .replace(/\/(api\/v[01]|v1)\/chat\/completions$/i, '')
    .replace(/\/(api\/v[01]|v1)\/models$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '')
    .replace(/\/api\/v[01]$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');

  const safeOrigin = originBase || fallback;
  const openAiBase = `${safeOrigin}/v1`;
  const openAiModelsUrl = `${safeOrigin}/v1/models`;
  const nativeV0ModelsUrl = `${safeOrigin}/api/v0/models`;
  const nativeV1ModelsUrl = `${safeOrigin}/api/v1/models`;

  // Order of discovery:
  // 1. /api/v0/models (LM Studio 0.3+ native REST API: returns loaded state + max_context_length + arch + quantization)
  // 2. /api/v1/models (LM Studio 0.4+ native REST API: returns display_name + params_string + loaded_instances)
  // 3. /v1/models (OpenAI-compatible models list)
  const modelsDiscoveryUrls = [
    nativeV0ModelsUrl,
    nativeV1ModelsUrl,
    openAiModelsUrl,
  ];

  const chatCompletionsUrls = [
    `${safeOrigin}/v1/chat/completions`,
    `${safeOrigin}/api/v0/chat/completions`,
    `${safeOrigin}/api/v1/chat/completions`,
  ];

  return {
    originBase: safeOrigin,
    openAiBase,
    chatCompletionsUrl: chatCompletionsUrls[0],
    openAiModelsUrl,
    nativeV0ModelsUrl,
    chatCompletionsUrls,
    modelsDiscoveryUrls,
    primaryChatCompletionsUrl: chatCompletionsUrls[0],
    primaryModelsUrl: openAiModelsUrl,
  };
}

/**
 * Inspects a JSON payload returned from LM Studio (`/v1/models`, `/api/v0/models`, or `/api/v1/models`).
 * Handles LM Studio's false-positive HTTP 200 `{ error: "Unexpected endpoint or method..." }` response
 * by returning `{ validEndpoint: false, models: [] }` so the caller can try the next endpoint.
 */
export function parseLmStudioModelsPayload(
  payload: unknown,
  sourceEndpoint?: string
): {
  validEndpoint: boolean;
  models: LlmDiscoveredModel[];
  unexpectedEndpointError?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { validEndpoint: false, models: [] };
  }

  const obj = payload as Record<string, unknown>;

  // Detect LM Studio's "Unexpected endpoint or method. (GET ...). Returning 200 anyway"
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
    return {
      validEndpoint: false,
      models: [],
      unexpectedEndpointError: obj.error.trim(),
    };
  }
  if (
    obj.error &&
    typeof obj.error === 'object' &&
    typeof (obj.error as Record<string, unknown>).message === 'string'
  ) {
    return {
      validEndpoint: false,
      models: [],
      unexpectedEndpointError: String(
        (obj.error as Record<string, unknown>).message
      ),
    };
  }

  const rawItems: unknown[] = Array.isArray(obj.data)
    ? obj.data
    : Array.isArray(obj.models)
      ? obj.models
      : [];

  if (!Array.isArray(obj.data) && !Array.isArray(obj.models)) {
    return { validEndpoint: false, models: [] };
  }

  const seenIds = new Set<string>();
  const parsedModels: LlmDiscoveredModel[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const rawId =
      typeof rec.id === 'string' && rec.id.trim()
        ? rec.id.trim()
        : typeof rec.key === 'string' && rec.key.trim()
          ? rec.key.trim()
          : typeof rec.model === 'string' && rec.model.trim()
            ? rec.model.trim()
            : '';
    if (!rawId || seenIds.has(rawId)) continue;

    const modelType = typeof rec.type === 'string' ? rec.type.toLowerCase() : '';
    // Skip pure embedding models (by explicit type or embedding model ID pattern) so chat/reasoning dropdown only contains generative LLMs/VLMs
    if (
      modelType === 'embeddings' ||
      modelType === 'embedding' ||
      rawId.toLowerCase().includes('text-embedding') ||
      rawId.toLowerCase().includes('nomic-embed')
    ) {
      continue;
    }

    seenIds.add(rawId);
    const rawState = typeof rec.state === 'string' ? rec.state.toLowerCase() : '';
    const stateFromLoadedInstances = Array.isArray(rec.loaded_instances)
      ? rec.loaded_instances.length > 0
        ? 'loaded'
        : 'not-loaded'
      : undefined;
    const state: 'loaded' | 'not-loaded' | 'unknown' =
      rawState === 'loaded'
        ? 'loaded'
        : rawState === 'not-loaded' || rawState === 'unloaded'
          ? 'not-loaded'
          : stateFromLoadedInstances ?? 'unknown';

    const maxCtx =
      typeof rec.max_context_length === 'number' && rec.max_context_length > 0
        ? rec.max_context_length
        : typeof rec.context_length === 'number' && rec.context_length > 0
          ? rec.context_length
          : undefined;

    const arch =
      typeof rec.arch === 'string' && rec.arch.trim()
        ? rec.arch.trim()
        : typeof rec.architecture === 'string' && rec.architecture.trim()
          ? rec.architecture.trim()
          : undefined;

    let quantization: string | undefined;
    if (typeof rec.quantization === 'string' && rec.quantization.trim()) {
      quantization = rec.quantization.trim();
    } else if (
      rec.quantization &&
      typeof rec.quantization === 'object' &&
      typeof (rec.quantization as Record<string, unknown>).name === 'string'
    ) {
      quantization = String(
        (rec.quantization as Record<string, unknown>).name
      ).trim();
    }

    const displayName =
      typeof rec.display_name === 'string' && rec.display_name.trim()
        ? rec.display_name.trim()
        : undefined;
    const paramsString =
      typeof rec.params_string === 'string' && rec.params_string.trim()
        ? rec.params_string.trim()
        : undefined;
    const publisher =
      typeof rec.publisher === 'string' && rec.publisher.trim()
        ? rec.publisher.trim()
        : undefined;

    parsedModels.push({
      id: rawId,
      display_name: displayName,
      params_string: paramsString,
      publisher,
      object: typeof rec.object === 'string' ? rec.object : 'model',
      owned_by:
        typeof rec.owned_by === 'string'
          ? rec.owned_by
          : publisher || 'lm-studio',
      state,
      arch,
      quantization,
      max_context_length: maxCtx,
      type: modelType || 'llm',
      source_endpoint: sourceEndpoint,
    });
  }

  // Sort loaded models first
  parsedModels.sort((a, b) => {
    const scoreA = a.state === 'loaded' ? 0 : a.state === 'unknown' ? 1 : 2;
    const scoreB = b.state === 'loaded' ? 0 : b.state === 'unknown' ? 1 : 2;
    return scoreA - scoreB;
  });

  return {
    validEndpoint: true,
    models: parsedModels,
  };
}

export const parseLmStudioModelsResponse = parseLmStudioModelsPayload;

export function isLocalhostLmStudioEndpoint(rawEndpointUrl: string): boolean {
  const clean = (rawEndpointUrl || '').trim().toLowerCase();
  return (
    clean.includes('://localhost') ||
    clean.includes('://127.0.0.1') ||
    clean.includes('://[::1]') ||
    clean.includes('://0.0.0.0')
  );
}

let verifiedWorkingLmStudioApiKey: string | null = null;

/**
 * Returns deduplicated candidate LM Studio API keys from environment variables
 * (`LM_API_KEY`, `LM_STUDIO_API_KEY`, `LM_API_TOKEN`, `LLM_API_KEY`), prioritizing
 * any key that has already been verified against the LM Studio server.
 */
export function getServerLmStudioCandidateKeys(customKey?: string): string[] {
  const candidates: string[] = [];
  const addKey = (k: string | undefined | null) => {
    const clean = (k ?? '').trim();
    if (clean && !candidates.includes(clean)) {
      candidates.push(clean);
    }
  };

  if (verifiedWorkingLmStudioApiKey) {
    addKey(verifiedWorkingLmStudioApiKey);
  }
  if (customKey) {
    addKey(customKey);
  }

  try {
    if (typeof process !== 'undefined' && process && process.env) {
      // Prioritize LM_API_KEY first, then LM_STUDIO_API_KEY, LM_API_TOKEN, and LLM_API_KEY
      addKey(process.env.LM_API_KEY);
      addKey(process.env.LM_STUDIO_API_KEY);
      addKey(process.env.LM_API_TOKEN);
      addKey(process.env.LLM_API_KEY);
    }
  } catch {
    // Browser context
  }

  return candidates;
}

export function getActiveLmStudioApiKey(customKey?: string): string {
  const keys = getServerLmStudioCandidateKeys(customKey);
  return keys[0] ?? '';
}

export function setVerifiedLmStudioApiKey(key: string): void {
  const clean = (key ?? '').trim();
  if (clean) {
    verifiedWorkingLmStudioApiKey = clean;
  }
}

export function buildLmStudioHeaders(
  apiKey?: string,
  includeJsonContentType = false
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const cleanKey = (apiKey || '').trim();
  if (cleanKey) {
    headers['Authorization'] = cleanKey.toLowerCase().startsWith('bearer ')
      ? cleanKey
      : `Bearer ${cleanKey}`;
  }
  return headers;
}

/**
 * Multi-endpoint LM Studio model discovery (`/api/v0/models`, `/api/v1/models`, `/v1/models`)
 * with multi-key authentication fallback (`LM_API_KEY`, `LM_STUDIO_API_KEY`, `LM_API_TOKEN`, `LLM_API_KEY`),
 * false-positive HTTP 200 `"Unexpected endpoint or method"` detection, and rich metadata merging.
 */
export async function discoverLmStudioModels(
  rawEndpointUrl: string,
  timeoutMs = 5000,
  apiKey?: string | string[]
): Promise<{
  reachable: boolean;
  server_online?: boolean;
  auth_required?: boolean;
  status: number;
  endpoint_tested: string;
  normalized_openai_base: string;
  latency_ms: number;
  models: LlmDiscoveredModel[];
  model_ids: string[];
  unexpected_endpoint_warning: string | null;
  message: string;
}> {
  const endpoints = normalizeLmStudioEndpoints(rawEndpointUrl);
  const startedAt = Date.now();
  const mergedMap = new Map<string, LlmDiscoveredModel>();
  let anyReachable = false;
  let serverOnline = false;
  let authRequired = false;
  let authErrorMsg: string | null = null;
  let lastStatus = 0;
  let primaryTested = endpoints.primaryModelsUrl;
  let unexpectedWarning: string | null = null;
  let lastErrorMsg = '';

  const candidateKeys: string[] = [];
  if (Array.isArray(apiKey)) {
    for (const k of apiKey) {
      const clean = (k ?? '').trim();
      if (clean && !candidateKeys.includes(clean)) candidateKeys.push(clean);
    }
  } else if (typeof apiKey === 'string' && apiKey.trim()) {
    candidateKeys.push(apiKey.trim());
  }
  for (const envKey of getServerLmStudioCandidateKeys()) {
    if (!candidateKeys.includes(envKey)) {
      candidateKeys.push(envKey);
    }
  }
  // Always include empty key as final fallback in case server has auth disabled
  if (!candidateKeys.includes('')) {
    candidateKeys.push('');
  }

  for (const keyToTry of candidateKeys) {
    const reqHeaders = buildLmStudioHeaders(keyToTry, false);
    let keyFailedAuth = false;

    for (const url of endpoints.modelsDiscoveryUrls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
          method: 'GET',
          headers: reqHeaders,
          signal: controller.signal,
        });
        clearTimeout(timer);
        lastStatus = response.status;
        serverOnline = true;

        const text = await response.text();
        let payload: unknown = null;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }

        if (response.status === 401 || response.status === 403) {
          authRequired = true;
          keyFailedAuth = true;
          primaryTested = url;
          const errObj =
            payload && typeof payload === 'object'
              ? (payload as Record<string, unknown>).error
              : null;
          const apiMsg =
            typeof errObj === 'string'
              ? errObj
              : errObj &&
                  typeof errObj === 'object' &&
                  typeof (errObj as Record<string, unknown>).message === 'string'
                ? String((errObj as Record<string, unknown>).message)
                : 'LM Studio API token is required (Authorization: Bearer $LM_API_KEY).';
          authErrorMsg = apiMsg;
          break;
        }

        if (!response.ok || !payload) {
          continue;
        }

        const parsed = parseLmStudioModelsPayload(payload, url);
        if (parsed.unexpectedEndpointError) {
          unexpectedWarning = parsed.unexpectedEndpointError;
          lastErrorMsg = parsed.unexpectedEndpointError;
          continue;
        }

        if (parsed.validEndpoint) {
          anyReachable = true;
          authRequired = false;
          if (keyToTry) {
            setVerifiedLmStudioApiKey(keyToTry);
          }
          if (!mergedMap.size) {
            primaryTested = url;
          }
          for (const m of parsed.models) {
            const existing = mergedMap.get(m.id);
            if (!existing) {
              mergedMap.set(m.id, m);
            } else {
              mergedMap.set(m.id, {
                ...existing,
                display_name: existing.display_name ?? m.display_name,
                params_string: existing.params_string ?? m.params_string,
                publisher: existing.publisher ?? m.publisher,
                state:
                  existing.state !== 'unknown' && existing.state
                    ? existing.state
                    : m.state,
                arch: existing.arch ?? m.arch,
                quantization: existing.quantization ?? m.quantization,
                max_context_length:
                  existing.max_context_length ?? m.max_context_length,
                type:
                  existing.type && existing.type !== 'llm'
                    ? existing.type
                    : m.type ?? existing.type,
              });
            }
          }
          // If we already queried both /api/v0/models and /api/v1/models and have rich models, no need to hit /v1/models
          if (mergedMap.size > 0 && url.includes('/api/v1/models')) {
            break;
          }
        }
      } catch (err) {
        lastErrorMsg = err instanceof Error ? err.message : 'Network error';
      }
    }

    if (anyReachable) {
      break;
    }
    if (!keyFailedAuth) {
      // Network error or non-auth failure; no need to retry other API keys against an unreachable host
      break;
    }
  }

  const latencyMs = Math.max(1, Date.now() - startedAt);
  const discoveredList = Array.from(mergedMap.values()).sort((a, b) => {
    const scoreA = a.state === 'loaded' ? 0 : a.state === 'unknown' ? 1 : 2;
    const scoreB = b.state === 'loaded' ? 0 : b.state === 'unknown' ? 1 : 2;
    return scoreA - scoreB;
  });
  const modelIds = discoveredList.map((m) => m.id);

  if (anyReachable) {
    const loadedCount = discoveredList.filter((m) => m.state === 'loaded').length;
    return {
      reachable: true,
      server_online: true,
      auth_required: false,
      status: lastStatus || 200,
      endpoint_tested: primaryTested,
      normalized_openai_base: endpoints.openAiBase,
      latency_ms: latencyMs,
      models: discoveredList,
      model_ids: modelIds,
      unexpected_endpoint_warning: unexpectedWarning,
      message:
        modelIds.length > 0
          ? `Connected to LM Studio (${modelIds.length} model${modelIds.length === 1 ? '' : 's'} scanned${loadedCount > 0 ? ` · ${loadedCount} loaded in memory` : ' · JIT auto-load ready'} from ${primaryTested})`
          : 'Connected to LM Studio server, but 0 models are currently available.',
    };
  }

  if (authRequired) {
    return {
      reachable: false,
      server_online: true,
      auth_required: true,
      status: lastStatus || 401,
      endpoint_tested: primaryTested,
      normalized_openai_base: endpoints.openAiBase,
      latency_ms: latencyMs,
      models: [],
      model_ids: [],
      unexpected_endpoint_warning: null,
      message: `LM Studio Server at ${endpoints.originBase} is online (${latencyMs}ms) and requires a valid API Token (HTTP ${lastStatus || 401}). Set LM_API_KEY in environment secrets or disable "Require Authentication" in LM Studio Server Settings. (${authErrorMsg})`,
    };
  }

  return {
    reachable: false,
    server_online: serverOnline,
    auth_required: false,
    status: lastStatus,
    endpoint_tested: primaryTested,
    normalized_openai_base: endpoints.openAiBase,
    latency_ms: latencyMs,
    models: [],
    model_ids: [],
    unexpected_endpoint_warning: unexpectedWarning,
    message: unexpectedWarning
      ? `LM Studio returned "${unexpectedWarning}". Verify Local Server is started on ${endpoints.originBase} and CORS is enabled in LM Studio Developer tab.`
      : lastErrorMsg
        ? `LM Studio unreachable (${lastErrorMsg}). Ensure LM Studio Local Server is running on ${endpoints.originBase} with CORS enabled.`
        : `Unable to reach LM Studio at ${endpoints.originBase}.`,
  };
}

export interface OptimizedLmStudioChatPayload {
  model: string;
  temperature: number;
  top_p: number;
  max_tokens?: number;
  stream: boolean;
  chat_template_kwargs: {
    enable_thinking: boolean;
  };
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  [key: string]: unknown;
}

/**
 * Applies the `think` / `no_think` directive to prompts for reasoning models (Qwen3, DeepSeek-R1, QwQ)
 * and builds an optimized OpenAI-compatible chat completion payload for LM Studio.
 */
export function buildOptimizedLmStudioChatPayload(params: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  maxTokensEnabled: boolean;
  thinkingMode: LlmThinkingMode;
  stream?: boolean;
}): OptimizedLmStudioChatPayload {
  const thinkDirective =
    params.thinkingMode === 'no_think' ? '/no_think' : '/think';

  const systemInstruction =
    params.thinkingMode === 'no_think'
      ? `${thinkDirective}\n${params.systemPrompt.trim()}\n\n[REASONING MODE: NO_THINK] Do NOT output <think>...</think> blocks or internal chain-of-thought. Respond directly and concisely with the final JSON object.`
      : `${thinkDirective}\n${params.systemPrompt.trim()}\n\n[REASONING MODE: THINK] You may think step-by-step inside <think>...</think> before providing the final JSON object.`;

  // Append /no_think or /think tag to user prompt (supported natively by Qwen3 / DeepSeek / LM Studio templates)
  const userContent = `${params.userPrompt.trim()}\n${thinkDirective}`;

  const payload: OptimizedLmStudioChatPayload = {
    model: params.modelId.trim(),
    temperature: params.temperature,
    top_p: params.topP,
    stream: Boolean(params.stream),
    chat_template_kwargs: {
      enable_thinking: params.thinkingMode === 'think',
    },
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userContent },
    ],
  };

  if (params.maxTokensEnabled) {
    payload.max_tokens = Math.max(1536, Math.round(params.maxTokens || 2048));
  }

  return payload;
}

/**
 * Extracts `<think>...</think>` blocks and clean final content from an LM Studio completion.
 * Also handles unclosed `<think>` blocks if the model hit `max_tokens` while thinking.
 */
export function extractThinkingAndCleanContent(rawContent: string | null | undefined): {
  thinkingTrace: string | null;
  cleanContent: string;
} {
  if (!rawContent || typeof rawContent !== 'string') {
    return { thinkingTrace: null, cleanContent: '' };
  }

  const thinkBlocks: string[] = [];
  let cleaned = rawContent.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, group1) => {
    if (typeof group1 === 'string' && group1.trim()) {
      thinkBlocks.push(group1.trim());
    }
    return '';
  });

  // Handle unclosed <think> if model ran out of tokens mid-thought
  if (/<think>/i.test(cleaned) && !/<\/think>/i.test(cleaned)) {
    const parts = cleaned.split(/<think>/i);
    const beforeThink = parts[0]?.trim() ?? '';
    const unclosedThought = parts.slice(1).join('\n').trim();
    if (unclosedThought) {
      thinkBlocks.push(`${unclosedThought} [truncated by max_tokens]`);
    }
    // Check if there is a JSON block at the end of unclosedThought
    const jsonMatch = unclosedThought.match(/\{[\s\S]*\}$/);
    cleaned = jsonMatch ? jsonMatch[0] : beforeThink;
  }

  return {
    thinkingTrace: thinkBlocks.length > 0 ? thinkBlocks.join('\n\n') : null,
    cleanContent: cleaned.trim(),
  };
}

/**
 * Extracts the first valid JSON object `{ ... }` from an LLM string response,
 * even if surrounded by `<think>...</think>`, markdown fences, or commentary.
 */
export function extractJsonObjectFromLlmText(
  rawText: string | null | undefined
): Record<string, unknown> | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const { cleanContent } = extractThinkingAndCleanContent(rawText);
  const CandidatesToTry = [cleanContent, rawText];

  for (const text of CandidatesToTry) {
    if (!text) continue;
    const strippedFences = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(strippedFences);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Find first '{' and last '}'
      const firstBrace = strippedFences.indexOf('{');
      const lastBrace = strippedFences.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const sub = strippedFences.slice(firstBrace, lastBrace + 1);
        try {
          const parsedSub = JSON.parse(sub);
          if (
            parsedSub &&
            typeof parsedSub === 'object' &&
            !Array.isArray(parsedSub)
          ) {
            return parsedSub as Record<string, unknown>;
          }
        } catch {
          // continue
        }
      }
    }
  }

  return null;
}
