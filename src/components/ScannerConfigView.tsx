import React, { useEffect, useState } from 'react';
import {
  ScannerConfig,
  ScannerModeId,
  buildUnusualActivityDiscoveryUrl,
} from '../engine/whaleScannerEngine';
import {
  DEFAULT_LLM_ENGINE_CONFIG,
  LlmEngineConfig,
  LlmEngineProvider,
  type AutomatedPipelineState,
} from '../engine/whalePipelineRuntime';
import type {
  HoldingMonitorMode,
  LlmStage2ExitExecutionPlan,
  MonitoredHolding,
  TradingEnvironmentMode,
} from '../engine/holdingsMonitorEngine';
import {
  type LlmDiscoveredModel,
  type LlmThinkingMode,
  buildOptimizedLmStudioChatPayload,
  normalizeLmStudioEndpoints,
} from '../engine/lmStudioClient';
import {
  Save,
  CheckCircle2,
  Terminal,
  Globe,
  Database,
  Cloud,
  RefreshCw,
  LogIn,
  LogOut,
  Cpu,
  Sliders,
  RotateCcw,
  Activity,
  ShieldCheck,
  Zap,
  Lock,
  Unlock,
} from 'lucide-react';

export type SettingsTabId = 'llm_engine' | 'scanner_rules' | 'data_sources';

interface ScannerConfigViewProps {
  scanners: ScannerConfig[];
  activeScanner: ScannerConfig;
  llmEngineConfig: LlmEngineConfig;
  onSaveScanner: (
    payload: Partial<ScannerConfig> & { name: string; mode: ScannerModeId }
  ) => Promise<ScannerConfig>;
  onSaveLlmEngineConfig: (
    payload: Partial<LlmEngineConfig>
  ) => Promise<LlmEngineConfig>;
  onSelectMode: (mode: ScannerModeId) => void;
  currentUserEmail: string | null;
  onSignInGoogle: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSyncAllToCloud: () => Promise<void>;
  cloudSyncCounts: {
    syncedCandidates: number;
    syncedConfigs: number;
    syncedPrints: number;
    lastSyncedAt: string | null;
  };
  backendPersistenceStats: {
    candidatesCount: number;
    printsCount: number;
    recalculationCycles: number;
    lastSavedAt: string;
  };
}

export const ScannerConfigView: React.FC<ScannerConfigViewProps> = ({
  scanners,
  activeScanner,
  llmEngineConfig,
  onSaveScanner,
  onSaveLlmEngineConfig,
  onSelectMode,
  currentUserEmail,
  onSignInGoogle,
  onSignOut,
  onSyncAllToCloud,
  cloudSyncCounts,
  backendPersistenceStats,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('llm_engine');

  // Tab 1: LM Studio LLM Engine State
  const [provider, setProvider] = useState<LlmEngineProvider>(
    llmEngineConfig.provider
  );
  const [llmEnabled, setLlmEnabled] = useState<boolean>(
    llmEngineConfig.enabled
  );
  const [endpointUrl, setEndpointUrl] = useState<string>(
    llmEngineConfig.endpointUrl
  );
  const [modelId, setModelId] = useState<string>(llmEngineConfig.modelId);
  const [thinkingMode, setThinkingMode] = useState<LlmThinkingMode>(
    llmEngineConfig.thinkingMode ?? 'no_think'
  );
  const [discoveredModels, setDiscoveredModels] = useState<
    LlmDiscoveredModel[]
  >(llmEngineConfig.discoveredModels ?? []);
  const [temperature, setTemperature] = useState<number>(
    llmEngineConfig.temperature
  );
  const [topP, setTopP] = useState<number>(llmEngineConfig.topP);
  const [timeoutMs, setTimeoutMs] = useState<number>(llmEngineConfig.timeoutMs);
  const [concurrentAnalyses, setConcurrentAnalyses] = useState<number>(
    llmEngineConfig.concurrentAnalyses ?? 3
  );
  const [streamResponses, setStreamResponses] = useState<boolean>(
    llmEngineConfig.streamResponses
  );
  const [autoAnalyzeConfirmedWhales, setAutoAnalyzeConfirmedWhales] =
    useState<boolean>(llmEngineConfig.autoAnalyzeConfirmedWhales);
  const [includeGexAndTideContext, setIncludeGexAndTideContext] =
    useState<boolean>(llmEngineConfig.includeGexAndTideContext);
  const [includeAlpacaStockIndicators, setIncludeAlpacaStockIndicators] =
    useState<boolean>(llmEngineConfig.includeAlpacaStockIndicators);
  const [systemPromptTemplate, setSystemPromptTemplate] = useState<string>(
    llmEngineConfig.systemPromptTemplate
  );
  const [llmSavedNotice, setLlmSavedNotice] = useState<string | null>(null);
  const [llmValidationError, setLlmValidationError] = useState<string | null>(
    null
  );
  const [savingLlm, setSavingLlm] = useState<boolean>(false);
  const [probingLlm, setProbingLlm] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<{
    reachable: boolean;
    server_online?: boolean;
    auth_required?: boolean;
    status?: number;
    endpoint_tested: string;
    latency_ms: number;
    models: LlmDiscoveredModel[];
    unexpected_endpoint_warning?: string | null;
    message: string;
  } | null>(null);

  useEffect(() => {
    setProvider(llmEngineConfig.provider);
    setLlmEnabled(llmEngineConfig.enabled);
    setEndpointUrl(llmEngineConfig.endpointUrl);
    setModelId(llmEngineConfig.modelId);
    setThinkingMode(llmEngineConfig.thinkingMode ?? 'no_think');
    setDiscoveredModels(llmEngineConfig.discoveredModels ?? []);
    setTemperature(llmEngineConfig.temperature);
    setTopP(llmEngineConfig.topP);
    setTimeoutMs(llmEngineConfig.timeoutMs);
    setConcurrentAnalyses(llmEngineConfig.concurrentAnalyses ?? 3);
    setStreamResponses(llmEngineConfig.streamResponses);
    setAutoAnalyzeConfirmedWhales(llmEngineConfig.autoAnalyzeConfirmedWhales);
    setIncludeGexAndTideContext(llmEngineConfig.includeGexAndTideContext);
    setIncludeAlpacaStockIndicators(
      llmEngineConfig.includeAlpacaStockIndicators
    );
    setSystemPromptTemplate(llmEngineConfig.systemPromptTemplate);
  }, [llmEngineConfig]);

  // Tab 2: Scanner Rules State
  const [name, setName] = useState(activeScanner.name);
  const [mode, setMode] = useState<ScannerModeId>(activeScanner.mode);
  const [minPremium, setMinPremium] = useState(
    activeScanner.contract_filters.min_premium
  );
  const [minDte, setMinDte] = useState(activeScanner.contract_filters.min_dte);
  const [maxDte, setMaxDte] = useState(activeScanner.contract_filters.max_dte);
  const [minVolOi, setMinVolOi] = useState(
    activeScanner.contract_filters.min_volume_oi_ratio
  );
  const [minSkew, setMinSkew] = useState(
    activeScanner.contract_filters.min_skew
  );
  const [maxMultileg, setMaxMultileg] = useState(
    activeScanner.contract_filters.max_multileg_ratio
  );
  const [maxSpread, setMaxSpread] = useState(
    activeScanner.contract_filters.max_spread
  );
  const [minWhaleScore, setMinWhaleScore] = useState(
    activeScanner.min_whale_score
  );
  const [requireConfirm, setRequireConfirm] = useState(
    activeScanner.confirmation.enabled
  );
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [syncingCloud, setSyncingCloud] = useState(false);

  useEffect(() => {
    setName(activeScanner.name);
    setMode(activeScanner.mode);
    setMinPremium(activeScanner.contract_filters.min_premium);
    setMinDte(activeScanner.contract_filters.min_dte);
    setMaxDte(activeScanner.contract_filters.max_dte);
    setMinVolOi(activeScanner.contract_filters.min_volume_oi_ratio);
    setMinSkew(activeScanner.contract_filters.min_skew);
    setMaxMultileg(activeScanner.contract_filters.max_multileg_ratio);
    setMaxSpread(activeScanner.contract_filters.max_spread);
    setMinWhaleScore(activeScanner.min_whale_score);
    setRequireConfirm(activeScanner.confirmation.enabled);
  }, [activeScanner]);

  // Centralized Automation & Approval Policy State (Default: Approval NOT required)
  const [approvalRequiredByDefault, setApprovalRequiredByDefault] =
    useState<boolean>(false);
  const [autoPilotEnabled, setAutoPilotEnabled] = useState<boolean>(true);
  const [autoPlaceOrders, setAutoPlaceOrders] = useState<boolean>(true);
  const [holdingsDefaultMode, setHoldingsDefaultMode] =
    useState<HoldingMonitorMode>('paper_auto');
  const [holdingsEnv, setHoldingsEnv] =
    useState<TradingEnvironmentMode>('paper');
  const [liveMfaVerified, setLiveMfaVerified] = useState<boolean>(false);
  const [mfaCodeInput, setMfaCodeInput] = useState<string>('849204');
  const [monitoredHoldingsList, setMonitoredHoldingsList] = useState<
    MonitoredHolding[]
  >([]);
  const [pendingPlansList, setPendingPlansList] = useState<
    LlmStage2ExitExecutionPlan[]
  >([]);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [updatingPolicy, setUpdatingPolicy] = useState<boolean>(false);

  const loadCentralizedPolicyState = async () => {
    try {
      const [autoRes, holdRes] = await Promise.all([
        fetch('/api/pipeline/automation'),
        fetch('/api/holdings-monitor'),
      ]);
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        const st: AutomatedPipelineState | undefined =
          autoData.automation_state;
        if (st) {
          setApprovalRequiredByDefault(
            st.approval_required_by_default ?? false
          );
          setAutoPilotEnabled(st.auto_pilot_enabled ?? true);
          setAutoPlaceOrders(st.auto_place_orders ?? true);
          setHoldingsDefaultMode(st.holdings_default_mode ?? 'paper_auto');
          if (typeof st.concurrent_ai_analyses === 'number') {
            setConcurrentAnalyses(st.concurrent_ai_analyses);
          }
        }
      }
      if (holdRes.ok) {
        const holdData = await holdRes.json();
        setHoldingsEnv(holdData.environment ?? 'paper');
        setLiveMfaVerified(Boolean(holdData.live_mfa_verified));
        setMonitoredHoldingsList(holdData.holdings ?? []);
        setPendingPlansList(holdData.approval_queue ?? []);
      }
    } catch {
      // Keep defaults
    }
  };

  useEffect(() => {
    void loadCentralizedPolicyState();
  }, []);

  const handleUpdateCentralAutomationPolicy = async (
    patch: Partial<{
      approval_required_by_default: boolean;
      auto_pilot_enabled: boolean;
      auto_place_orders: boolean;
      holdings_default_mode: HoldingMonitorMode;
      concurrent_ai_analyses: number;
    }>
  ) => {
    setUpdatingPolicy(true);
    try {
      const res = await fetch('/api/pipeline/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        const st: AutomatedPipelineState | undefined = data.automation_state;
        if (st) {
          setApprovalRequiredByDefault(
            st.approval_required_by_default ?? false
          );
          setAutoPilotEnabled(st.auto_pilot_enabled ?? true);
          setAutoPlaceOrders(st.auto_place_orders ?? true);
          setHoldingsDefaultMode(st.holdings_default_mode ?? 'paper_auto');
          if (typeof st.concurrent_ai_analyses === 'number') {
            setConcurrentAnalyses(st.concurrent_ai_analyses);
          }
        }
        if (typeof patch.concurrent_ai_analyses === 'number') {
          await onSaveLlmEngineConfig({
            concurrentAnalyses: patch.concurrent_ai_analyses,
          });
        }
        if (data.holdings_monitor) {
          setMonitoredHoldingsList(data.holdings_monitor.holdings ?? []);
          setPendingPlansList(data.holdings_monitor.approval_queue ?? []);
        }
        setPolicyNotice(
          typeof patch.concurrent_ai_analyses === 'number'
            ? `Updated Concurrent AI Analysis Worker Pool to ${st?.concurrent_ai_analyses ?? patch.concurrent_ai_analyses}x parallel LLM inferences.`
            : st?.approval_required_by_default
              ? 'Updated Centralized Policy: Manual Human Approval Required before submitting entry or exit orders.'
              : 'Updated Centralized Policy: Automatic Execution Enabled across Whale Scanner, LLM Trade Decisions & Holdings Exit Plans (No manual approval required).'
        );
        setTimeout(() => setPolicyNotice(null), 5000);
      }
    } finally {
      setUpdatingPolicy(false);
    }
  };

  const handleUpdateHoldingModeInSettings = async (
    holdingId: string,
    nextMode: HoldingMonitorMode
  ) => {
    setUpdatingPolicy(true);
    try {
      const res = await fetch('/api/holdings-monitor/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holding_id: holdingId, mode: nextMode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.state) {
          setMonitoredHoldingsList(data.state.holdings ?? []);
          setPendingPlansList(data.state.approval_queue ?? []);
        }
        setPolicyNotice(
          `Updated holding ${holdingId} execution mode to ${nextMode}.`
        );
        setTimeout(() => setPolicyNotice(null), 4000);
      }
    } finally {
      setUpdatingPolicy(false);
    }
  };

  const handleSwitchEnvironmentInSettings = async (
    targetEnv: TradingEnvironmentMode
  ) => {
    setUpdatingPolicy(true);
    try {
      const res = await fetch('/api/holdings-monitor/environment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: targetEnv,
          mfa_code: targetEnv === 'live' ? mfaCodeInput : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setHoldingsEnv(data.environment ?? targetEnv);
        setLiveMfaVerified(Boolean(data.live_mfa_verified));
        setMonitoredHoldingsList(data.holdings ?? []);
        setPendingPlansList(data.approval_queue ?? []);
        setPolicyNotice(
          targetEnv === 'live'
            ? 'Switched to Live Trading Environment (MFA Verified).'
            : 'Switched to Alpaca Paper Trading Environment (Default).'
        );
        setTimeout(() => setPolicyNotice(null), 4000);
      }
    } finally {
      setUpdatingPolicy(false);
    }
  };

  const handleApproveOrRejectPlanInSettings = async (
    planId: string,
    action: 'approve' | 'reject'
  ) => {
    setUpdatingPolicy(true);
    try {
      const res = await fetch('/api/holdings-monitor/approve-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          action,
          operator_name: 'Settings Policy Administrator',
          mfa_code: mfaCodeInput,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.state) {
          setMonitoredHoldingsList(data.state.holdings ?? []);
          setPendingPlansList(data.state.approval_queue ?? []);
        }
        setPolicyNotice(
          action === 'approve'
            ? `Approved & submitted plan ${planId} to Alpaca.`
            : `Rejected plan ${planId}.`
        );
        setTimeout(() => setPolicyNotice(null), 4000);
      }
    } finally {
      setUpdatingPolicy(false);
    }
  };

  const handleSaveLlm = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeLmStudioEndpoints(endpointUrl);
    if (
      !normalized.openAiBase ||
      normalized.openAiBase.length < 8 ||
      !/^https?:\/\/.+$/.test(normalized.openAiBase)
    ) {
      setLlmValidationError(
        'Please enter a valid HTTP or HTTPS endpoint URL (e.g. http://localhost:1234/v1).'
      );
      return;
    }
    if (!systemPromptTemplate.trim()) {
      setLlmValidationError('System prompt template cannot be empty.');
      return;
    }

    setLlmValidationError(null);
    setSavingLlm(true);
    try {
      const resolvedModel =
        modelId.trim() || (discoveredModels[0]?.id ?? '');
      const updated = await onSaveLlmEngineConfig({
        provider,
        enabled: llmEnabled,
        endpointUrl: normalized.openAiBase,
        modelId: resolvedModel,
        thinkingMode,
        maxTokensEnabled: false,
        temperature: Number(temperature),
        topP: Number(topP),
        timeoutMs: Number(timeoutMs),
        concurrentAnalyses: Math.min(
          Math.max(Math.round(Number(concurrentAnalyses) || 3), 1),
          8
        ),
        streamResponses,
        autoAnalyzeConfirmedWhales,
        includeGexAndTideContext,
        includeAlpacaStockIndicators,
        discoveredModels,
        systemPromptTemplate: systemPromptTemplate.trim(),
      });
      setEndpointUrl(updated.endpointUrl);
      setModelId(updated.modelId);
      setConcurrentAnalyses(updated.concurrentAnalyses ?? 3);
      setLlmSavedNotice(
        `Saved LM Studio configuration (${updated.endpointUrl} · model: ${updated.modelId || 'awaiting scan'} · mode: ${updated.thinkingMode} · ${updated.concurrentAnalyses ?? 3}x concurrent AI analysis) to backend database${currentUserEmail ? ' & Cloud Firestore' : ''}.`
      );
      setTimeout(() => setLlmSavedNotice(null), 5000);
    } finally {
      setSavingLlm(false);
    }
  };

  // Merge any models discovered in current session with persisted discoveredModels from LM Studio (NO mock models)
  const liveLmStudioModels: LlmDiscoveredModel[] = React.useMemo(() => {
    const byId = new Map<string, LlmDiscoveredModel>();
    for (const m of discoveredModels) {
      if (m && m.id && m.id !== 'local-model') {
        byId.set(m.id, m);
      }
    }
    for (const m of probeResult?.models ?? []) {
      if (m && m.id && m.id !== 'local-model') {
        byId.set(m.id, m);
      }
    }
    return Array.from(byId.values());
  }, [discoveredModels, probeResult]);

  const activeDiscoveredModel = liveLmStudioModels.find(
    (m) => m.id === modelId.trim()
  );

  const handleSelectModelPreset = async (
    nextModelId: string,
    autoSave = false
  ) => {
    setModelId(nextModelId);

    if (autoSave) {
      setSavingLlm(true);
      try {
        const normalized = normalizeLmStudioEndpoints(endpointUrl);
        const updated = await onSaveLlmEngineConfig({
          provider,
          enabled: llmEnabled,
          endpointUrl: normalized.openAiBase,
          modelId: nextModelId.trim(),
          thinkingMode,
          maxTokensEnabled: false,
          temperature: Number(temperature),
          topP: Number(topP),
          timeoutMs: Number(timeoutMs),
          streamResponses,
          autoAnalyzeConfirmedWhales,
          includeGexAndTideContext,
          includeAlpacaStockIndicators,
          discoveredModels: liveLmStudioModels,
          systemPromptTemplate:
            systemPromptTemplate.trim() ||
            DEFAULT_LLM_ENGINE_CONFIG.systemPromptTemplate,
        });
        setLlmSavedNotice(
          `Switched active LM Studio model to "${updated.modelId || 'unselected'}" and persisted to backend database.`
        );
        setTimeout(() => setLlmSavedNotice(null), 4000);
      } finally {
        setSavingLlm(false);
      }
    }
  };

  const handleResetLlmDefaults = async () => {
    setProvider(DEFAULT_LLM_ENGINE_CONFIG.provider);
    setLlmEnabled(DEFAULT_LLM_ENGINE_CONFIG.enabled);
    setEndpointUrl(DEFAULT_LLM_ENGINE_CONFIG.endpointUrl);
    setModelId(liveLmStudioModels[0]?.id ?? '');
    setThinkingMode(DEFAULT_LLM_ENGINE_CONFIG.thinkingMode);
    setTemperature(DEFAULT_LLM_ENGINE_CONFIG.temperature);
    setTopP(DEFAULT_LLM_ENGINE_CONFIG.topP);
    setTimeoutMs(DEFAULT_LLM_ENGINE_CONFIG.timeoutMs);
    setConcurrentAnalyses(DEFAULT_LLM_ENGINE_CONFIG.concurrentAnalyses);
    setStreamResponses(DEFAULT_LLM_ENGINE_CONFIG.streamResponses);
    setAutoAnalyzeConfirmedWhales(
      DEFAULT_LLM_ENGINE_CONFIG.autoAnalyzeConfirmedWhales
    );
    setIncludeGexAndTideContext(
      DEFAULT_LLM_ENGINE_CONFIG.includeGexAndTideContext
    );
    setIncludeAlpacaStockIndicators(
      DEFAULT_LLM_ENGINE_CONFIG.includeAlpacaStockIndicators
    );
    setSystemPromptTemplate(DEFAULT_LLM_ENGINE_CONFIG.systemPromptTemplate);
    setLlmValidationError(null);

    const updated = await onSaveLlmEngineConfig({
      ...DEFAULT_LLM_ENGINE_CONFIG,
      maxTokensEnabled: false,
      modelId: liveLmStudioModels[0]?.id ?? '',
      discoveredModels: liveLmStudioModels,
    });
    setLlmSavedNotice(
      `Reset LM Studio configuration to default (${updated.endpointUrl}) and saved to database.`
    );
    setTimeout(() => setLlmSavedNotice(null), 4000);
  };

  const handleTestLlmConnection = async (overrideUrl?: string) => {
    const rawTarget =
      typeof overrideUrl === 'string' ? overrideUrl.trim() : endpointUrl.trim();
    const useServerDefault =
      typeof overrideUrl === 'string' && overrideUrl.trim() === '';
    const normalized = normalizeLmStudioEndpoints(
      rawTarget || llmEngineConfig.endpointUrl
    );
    if (
      !useServerDefault &&
      (!normalized.openAiBase || !/^https?:\/\/.+$/.test(normalized.openAiBase))
    ) {
      setLlmValidationError(
        'Enter a valid http:// or https:// endpoint URL before scanning LM Studio models.'
      );
      return;
    }
    if (!useServerDefault) {
      setEndpointUrl(normalized.openAiBase);
    }
    setLlmValidationError(null);
    setProbingLlm(true);
    setProbeResult(null);

    try {
      // Backend server proxy scan (bypasses browser CORS & Mixed Content, attaches Authorization: Bearer $LM_API_KEY)
      const res = await fetch('/api/settings/llm-engine/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          useServerDefault ? {} : { endpointUrl: normalized.openAiBase }
        ),
      });
      if (res.ok) {
        const data = await res.json();
        const scannedModels: LlmDiscoveredModel[] = Array.isArray(data.models)
          ? data.models.map((m: LlmDiscoveredModel | string) =>
              typeof m === 'string' ? { id: m, state: 'loaded' } : m
            )
          : [];
        const resolvedBase =
          data.normalized_openai_base || normalized.openAiBase;
        setProbeResult({
          reachable: Boolean(data.reachable),
          server_online: Boolean(data.server_online),
          auth_required: Boolean(data.auth_required),
          status: typeof data.status === 'number' ? data.status : undefined,
          endpoint_tested: data.endpoint_tested ?? normalized.openAiModelsUrl,
          latency_ms: data.latency_ms ?? 0,
          models: scannedModels,
          unexpected_endpoint_warning:
            data.unexpected_endpoint_warning ?? null,
          message:
            data.message || 'Scanned LM Studio endpoint via backend proxy.',
        });
        if (scannedModels.length > 0) {
          setEndpointUrl(resolvedBase);
          setDiscoveredModels(scannedModels);
          const loadedOrFirst =
            scannedModels.find((m) => m.state === 'loaded')?.id ??
            scannedModels[0].id;
          const nextModelId =
            modelId && scannedModels.some((m) => m.id === modelId)
              ? modelId
              : loadedOrFirst;
          setModelId(nextModelId);
          await onSaveLlmEngineConfig({
            endpointUrl: resolvedBase,
            modelId: nextModelId,
            discoveredModels: scannedModels,
            lastModelScanAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      setProbeResult({
        reachable: false,
        endpoint_tested: normalized.openAiModelsUrl,
        latency_ms: 0,
        models: [],
        message:
          'Unable to reach LM Studio endpoint. Ensure LM Studio Server is running or check network routing.',
      });
    } finally {
      setProbingLlm(false);
    }
  };

  // Auto-scan LM Studio models on mount and when persisted endpoint updates
  useEffect(() => {
    const isInitialLocalDefault =
      llmEngineConfig.endpointUrl === 'http://localhost:1234/v1' &&
      (!llmEngineConfig.discoveredModels ||
        llmEngineConfig.discoveredModels.length === 0);
    void handleTestLlmConnection(
      isInitialLocalDefault ? '' : llmEngineConfig.endpointUrl
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmEngineConfig.endpointUrl]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError('Scanner profile name cannot be empty.');
      return;
    }
    if (minDte < 0 || maxDte < minDte) {
      setValidationError(
        'Invalid DTE bounds: max_dte must be >= min_dte >= 0.'
      );
      return;
    }
    setValidationError(null);

    const updated = await onSaveScanner({
      scanner_id: activeScanner.scanner_id,
      name: name.trim(),
      mode,
      min_whale_score: Number(minWhaleScore),
      contract_filters: {
        ...activeScanner.contract_filters,
        min_premium: Number(minPremium),
        min_dte: Number(minDte),
        max_dte: Number(maxDte),
        min_volume_oi_ratio: Number(minVolOi),
        min_skew: Number(minSkew),
        max_multileg_ratio: Number(maxMultileg),
        max_spread: Number(maxSpread),
      },
      confirmation: {
        ...activeScanner.confirmation,
        enabled: requireConfirm,
      },
    });

    setSavedNotice(
      `Saved POST /v1/scanners (${updated.scanner_id}) — Persisted to Database & Synced Across Sessions`
    );
    setTimeout(() => setSavedNotice(null), 4000);
  };

  const handleManualCloudSync = async () => {
    setSyncingCloud(true);
    try {
      await onSyncAllToCloud();
    } finally {
      setSyncingCloud(false);
    }
  };

  const normalizedEndpoints = normalizeLmStudioEndpoints(endpointUrl);
  const chatCompletionsUrl = normalizedEndpoints.chatCompletionsUrl;
  const modelsDiscoveryUrl = normalizedEndpoints.openAiModelsUrl;

  const lmStudioRequestPreview = {
    endpoint: chatCompletionsUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: buildOptimizedLmStudioChatPayload({
      modelId: modelId.trim() || (liveLmStudioModels[0]?.id ?? ''),
      systemPrompt: systemPromptTemplate,
      userPrompt:
        'Evaluate WhaleCandidate NVDA $150C (Score 96, 5m Prem $840K) with Alpaca 5m confirmation (5/5 rules) and Market Tide regime.',
      temperature: Number(temperature),
      topP: Number(topP),
      maxTokens: 0,
      maxTokensEnabled: false,
      thinkingMode,
      stream: streamResponses,
    }),
  };

  const postPayloadPreview = {
    name,
    mode,
    enabled: true,
    universe: activeScanner.universe,
    contract_filters: {
      min_premium: Number(minPremium),
      min_dte: Number(minDte),
      max_dte: Number(maxDte),
      is_otm: true,
      min_volume_oi_ratio: Number(minVolOi),
      min_skew: Number(minSkew),
      max_multileg_ratio: Number(maxMultileg),
      max_spread: Number(maxSpread),
    },
    burst_rules: activeScanner.burst_rules,
    confirmation: {
      enabled: requireConfirm,
      candle_minutes: 5,
      min_relative_volume: 1.5,
      require_vwap_alignment: true,
    },
    min_whale_score: Number(minWhaleScore),
  };

  const uwEndpoints = [
    {
      use: 'Broad unusual-chain snapshot',
      endpoint: 'GET /option-activity/unusual',
      purpose:
        'Fast market-wide candidate seed ($50K+ prem, 7-60 DTE, >=70% skew)',
    },
    {
      use: 'Full chain screener',
      endpoint: 'GET /screener/option-contracts',
      purpose: 'Advanced contract filters and ranking',
    },
    {
      use: 'Raw options tape',
      endpoint: 'GET /option-trades',
      purpose:
        'Validate individual/aggregated prints & post-close reconciliation',
    },
    {
      use: 'Rule-based clusters',
      endpoint: 'GET /option-trades/flow-alerts',
      purpose: 'RepeatedHits, VolumeOverOi, SweepsFollowedByFloor patterns',
    },
    {
      use: 'Market regime',
      endpoint: 'GET /market/market-tide',
      purpose: 'Broad options-flow context',
    },
    {
      use: 'Underlying large prints',
      endpoint: 'GET /lit-flow/{ticker}',
      purpose: 'Stock-tape & 5m OHLCV VWAP candle confirmation',
    },
    {
      use: 'Historical model data',
      endpoint: 'GET /option-trades/full-tape/{date}',
      purpose: '20-session time-of-day baseline & MAD calibration',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Settings Header & Multi-Section Navigation Bar */}
      <section
        aria-label="Settings and Configuration Navigation"
        className="border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-100">
              System Settings &amp; Engine Configuration
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure your local/remote LM Studio LLM engine endpoint,
              internal scanner thresholds, and persistent database
              synchronization.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400 w-full sm:w-auto min-w-0">
            <span className="truncate max-w-full">
              Active LLM Endpoint:{' '}
              <strong className="text-sky-400">
                {llmEngineConfig.endpointUrl}
              </strong>
            </span>
            <span className="hidden sm:inline">·</span>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto min-w-0">
              <label
                htmlFor="header-model-select"
                className="text-slate-400 whitespace-nowrap shrink-0"
              >
                LM Studio Model:
              </label>
              <select
                id="header-model-select"
                data-testid="header-llm-model-select"
                aria-label="Model Selection"
                value={modelId}
                onChange={(e) => handleSelectModelPreset(e.target.value, true)}
                className="w-full sm:w-auto max-w-full sm:max-w-[320px] truncate px-2.5 py-1 text-xs font-mono bg-[#0B0F17] border border-slate-700 hover:border-sky-500/60 rounded text-slate-100 focus:outline-none focus:border-sky-400"
              >
                {liveLmStudioModels.length === 0 ? (
                  <option value={modelId}>
                    {modelId
                      ? `${modelId} (Unverified — Click Scan Models)`
                      : '— No LM Studio models scanned yet —'}
                  </option>
                ) : (
                  <optgroup label="Discovered LM Studio Models (/api/v0/models · /api/v1/models)">
                    {liveLmStudioModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                        {m.display_name ? ` (${m.display_name})` : ''}
                        {m.state === 'loaded'
                          ? ' [LOADED]'
                          : m.state === 'not-loaded'
                            ? ' [JIT READY]'
                            : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelId &&
                  liveLmStudioModels.length > 0 &&
                  !liveLmStudioModels.some((m) => m.id === modelId) && (
                    <option value={modelId}>{modelId} (Custom ID)</option>
                  )}
              </select>
              <button
                type="button"
                onClick={() => void handleTestLlmConnection()}
                disabled={probingLlm}
                className="px-2 py-1 text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded whitespace-nowrap shrink-0"
              >
                {probingLlm ? 'Scanning...' : 'Scan Models'}
              </button>
            </div>
          </div>
        </div>

        {/* Centralized Automation & Order Approval Policy Management Panel */}
        <div
          data-testid="centralized-approval-policy-panel"
          className="p-4 rounded-lg border border-emerald-500/30 bg-[#0B0F17] space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-slate-100">
                  Centralized Automation &amp; Order Approval Policy
                </h2>
                <span
                  className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${
                    !approvalRequiredByDefault
                      ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                      : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                  }`}
                >
                  {!approvalRequiredByDefault
                    ? 'DEFAULT: APPROVAL NOT REQUIRED (AUTO-EXECUTION ACTIVE)'
                    : 'MANUAL HUMAN APPROVAL REQUIRED'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Centralized control for all automated triggers and order approvals across the Whale Flow Scanner, 2-Stage Entry LLM Trade Decision Pipeline, and Holdings &amp; Exit Plans Monitor. By default, approval is not required and risk-validated orders execute automatically.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={updatingPolicy}
                onClick={() =>
                  void handleUpdateCentralAutomationPolicy({
                    approval_required_by_default: false,
                    auto_pilot_enabled: true,
                    auto_place_orders: true,
                    holdings_default_mode: 'paper_auto',
                  })
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                  !approvalRequiredByDefault
                    ? 'bg-emerald-500 text-slate-950'
                    : 'border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100'
                }`}
              >
                Automatic Execution (Default · No Approval Required)
              </button>
              <button
                type="button"
                disabled={updatingPolicy}
                onClick={() =>
                  void handleUpdateCentralAutomationPolicy({
                    approval_required_by_default: true,
                    auto_place_orders: false,
                    holdings_default_mode: 'approval_required',
                  })
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                  approvalRequiredByDefault
                    ? 'bg-amber-500 text-slate-950'
                    : 'border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100'
                }`}
              >
                Require Manual Approval
              </button>
            </div>
          </div>

          {policyNotice && (
            <div className="p-2.5 rounded border border-emerald-500/40 bg-emerald-950/30 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{policyNotice}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-800/80 text-xs">
            {/* Column 1: Entry Pipeline Auto-Triggers & Concurrent AI Analysis */}
            <div className="p-3 rounded border border-slate-800 bg-[#111726] space-y-2.5">
              <div className="font-semibold text-slate-200 flex items-center justify-between gap-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Entry Pipeline &amp; Concurrent AI</span>
                </span>
                <span className="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 font-mono text-[10px] text-sky-300">
                  {concurrentAnalyses}x Concurrent
                </span>
              </div>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-slate-300">
                  Auto-Pilot Background Scan &amp; LLM Gate
                </span>
                <input
                  type="checkbox"
                  aria-label="Auto-Pilot Background Scan and LLM Gate"
                  checked={autoPilotEnabled}
                  onChange={(e) =>
                    void handleUpdateCentralAutomationPolicy({
                      auto_pilot_enabled: e.target.checked,
                    })
                  }
                  className="rounded border-slate-700 bg-slate-900 accent-emerald-400"
                />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-slate-300">
                  Auto-Place Stage-2 Approved Smart Orders
                </span>
                <input
                  type="checkbox"
                  aria-label="Auto-Place Stage-2 Approved Smart Orders"
                  checked={autoPlaceOrders}
                  onChange={(e) =>
                    void handleUpdateCentralAutomationPolicy({
                      auto_place_orders: e.target.checked,
                      approval_required_by_default: !e.target.checked,
                    })
                  }
                  className="rounded border-slate-700 bg-slate-900 accent-emerald-400"
                />
              </label>
              <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="policy-concurrent-ai-select"
                    className="text-[11px] font-medium text-slate-300"
                  >
                    Concurrent AI Analysis Workers:
                  </label>
                  <select
                    id="policy-concurrent-ai-select"
                    data-testid="policy-concurrent-ai-select"
                    aria-label="Concurrent AI Analysis Workers"
                    disabled={updatingPolicy}
                    value={concurrentAnalyses}
                    onChange={(e) => {
                      const val = Math.min(
                        Math.max(Number(e.target.value) || 3, 1),
                        8
                      );
                      setConcurrentAnalyses(val);
                      void handleUpdateCentralAutomationPolicy({
                        concurrent_ai_analyses: val,
                      });
                    }}
                    className="px-2 py-1 text-xs font-mono bg-[#0B0F17] border border-slate-700 hover:border-sky-500/60 rounded text-sky-300"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}x {n === 1 ? '(Sequential)' : n === 3 ? '(Default Parallel)' : n === 8 ? '(Max Parallel)' : 'Parallel'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {[1, 2, 3, 4, 6, 8].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={updatingPolicy}
                      onClick={() => {
                        setConcurrentAnalyses(preset);
                        void handleUpdateCentralAutomationPolicy({
                          concurrent_ai_analyses: preset,
                        });
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        concurrentAnalyses === preset
                          ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                          : 'bg-[#0B0F17] text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {preset}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Column 2: Holdings & Exit Plans Policy */}
            <div className="p-3 rounded border border-slate-800 bg-[#111726] space-y-2.5">
              <div className="font-semibold text-slate-200 flex items-center justify-between">
                <span>Holdings &amp; Exit Plan Policy</span>
                <span className="font-mono text-[11px] text-emerald-400">
                  {holdingsDefaultMode}
                </span>
              </div>
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-400">
                  Default Holdings Execution Mode:
                </span>
                <select
                  aria-label="Default Holdings Execution Mode"
                  value={holdingsDefaultMode}
                  onChange={(e) =>
                    void handleUpdateCentralAutomationPolicy({
                      holdings_default_mode: e.target
                        .value as HoldingMonitorMode,
                      approval_required_by_default:
                        e.target.value === 'approval_required',
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                >
                  <option value="paper_auto">
                    Paper Auto-Execution (Default · No Approval Required)
                  </option>
                  <option value="approval_required">
                    Approval Required Before Order
                  </option>
                  <option value="alert_only">Alert Only (No Orders)</option>
                </select>
              </label>
            </div>

            {/* Column 3: Alpaca Trading Environment & MFA Gate */}
            <div className="p-3 rounded border border-slate-800 bg-[#111726] space-y-2.5">
              <div className="font-semibold text-slate-200 flex items-center justify-between">
                <span>Alpaca Execution Environment</span>
                <span className="font-mono text-[11px] text-sky-400">
                  {holdingsEnv.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSwitchEnvironmentInSettings('paper')}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                    holdingsEnv !== 'live'
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-700 bg-[#0B0F17] text-slate-300'
                  }`}
                >
                  Alpaca Paper (Default)
                </button>
                <button
                  type="button"
                  onClick={() => void handleSwitchEnvironmentInSettings('live')}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1 ${
                    holdingsEnv === 'live'
                      ? 'bg-amber-600 text-white'
                      : 'border border-slate-700 bg-[#0B0F17] text-slate-300'
                  }`}
                >
                  {liveMfaVerified ? (
                    <Unlock className="w-3 h-3" />
                  ) : (
                    <Lock className="w-3 h-3" />
                  )}
                  <span>Live (MFA)</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-slate-400 whitespace-nowrap">
                  Live MFA Code:
                </label>
                <input
                  type="text"
                  aria-label="Settings Live Trading MFA Code"
                  value={mfaCodeInput}
                  onChange={(e) => setMfaCodeInput(e.target.value)}
                  className="w-full px-2 py-1 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Per-Holding Mode Overrides & Any Pending Approval Plans */}
          {monitoredHoldingsList.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                Per-Holding Execution Policy Overrides ({monitoredHoldingsList.length} Monitored Positions)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                {monitoredHoldingsList.map((h) => (
                  <div
                    key={h.holding_id}
                    className="p-2 rounded border border-slate-800 bg-[#111726] flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-mono text-slate-200 truncate">
                      {h.underlying_symbol} ({h.asset_class})
                    </span>
                    <select
                      aria-label={`Settings monitor mode for ${h.osi_canonical_symbol}`}
                      value={h.monitor_config.mode}
                      onChange={(e) =>
                        void handleUpdateHoldingModeInSettings(
                          h.holding_id,
                          e.target.value as HoldingMonitorMode
                        )
                      }
                      className="px-1.5 py-0.5 text-[11px] font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-200"
                    >
                      <option value="paper_auto">Auto-Exec</option>
                      <option value="approval_required">Approval Req</option>
                      <option value="alert_only">Alert Only</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingPlansList.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <div className="text-xs font-semibold text-amber-300">
                Pending Manual Approvals ({pendingPlansList.length})
              </div>
              <div className="space-y-2">
                {pendingPlansList.map((plan) => (
                  <div
                    key={plan.plan_id}
                    className="p-2.5 rounded border border-amber-500/30 bg-amber-950/15 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="font-mono text-slate-200">
                      {plan.recommended_action} · {plan.order_side.toUpperCase()}{' '}
                      {plan.quantity_to_trade}x {plan.target_symbol} @ $
                      {plan.limit_price_logic.computed_initial_limit_price.toFixed(
                        2
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleApproveOrRejectPlanInSettings(
                            plan.plan_id,
                            'reject'
                          )
                        }
                        className="px-2.5 py-1 text-[11px] rounded border border-rose-500/40 text-rose-300 hover:bg-rose-950/40"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleApproveOrRejectPlanInSettings(
                            plan.plan_id,
                            'approve'
                          )
                        }
                        className="px-2.5 py-1 text-[11px] font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        Approve &amp; Submit Order
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Settings Section Tabs */}
        <div
          role="tablist"
          aria-label="Settings Sections"
          className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'llm_engine'}
            onClick={() => setActiveTab('llm_engine')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'llm_engine'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-[#0B0F17] text-slate-300 hover:text-slate-100 border border-slate-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>LLM Engine (LM Studio)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'scanner_rules'}
            onClick={() => setActiveTab('scanner_rules')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'scanner_rules'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-[#0B0F17] text-slate-300 hover:text-slate-100 border border-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Scanner Rules (/v1/scanners)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'data_sources'}
            onClick={() => setActiveTab('data_sources')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'data_sources'
                ? 'bg-sky-500 text-slate-950'
                : 'bg-[#0B0F17] text-slate-300 hover:text-slate-100 border border-slate-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Database &amp; API Sources</span>
          </button>
        </div>
      </section>

      {/* TAB 1: LLM ENGINE (LM STUDIO CONFIGURATION) */}
      {activeTab === 'llm_engine' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 cols: LM Studio Endpoint & Inference Configuration Form */}
          <section
            aria-label="LM Studio Configuration"
            className="lg:col-span-7 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
              <div>
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-sky-400" />
                  <span>LM Studio LLM Engine Configuration</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure your LM Studio OpenAI-compatible server endpoint and
                  inference parameters. Saved to the backend database and
                  synchronized with Cloud Firestore for downstream LLM activity.
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={llmEnabled}
                  onChange={(e) => setLlmEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                />
                <span className="font-medium">Enable LLM Engine</span>
              </label>
            </div>

            <form onSubmit={handleSaveLlm} className="space-y-4">
              {/* Endpoint URL & Quick Presets */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="lm-studio-endpoint"
                    className="block text-xs font-medium text-slate-300"
                  >
                    LM Studio Base Endpoint URL
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-400">
                    <span>Presets:</span>
                    {[
                      {
                        label: 'Firewalla:9210',
                        url: 'http://d17krzcgng2.d.firewalla.org:9210/v1',
                      },
                      {
                        label: 'localhost:1234',
                        url: 'http://localhost:1234/v1',
                      },
                      {
                        label: '127.0.0.1:1234',
                        url: 'http://127.0.0.1:1234/v1',
                      },
                      {
                        label: 'host.docker.internal',
                        url: 'http://host.docker.internal:1234/v1',
                      },
                    ].map((preset) => (
                      <button
                        key={preset.url}
                        type="button"
                        onClick={() => setEndpointUrl(preset.url)}
                        className="px-2 py-0.5 rounded bg-[#0B0F17] border border-slate-800 text-sky-400 hover:border-sky-500/50 transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <input
                    id="lm-studio-endpoint"
                    type="text"
                    maxLength={256}
                    placeholder="http://localhost:1234/v1"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    className="flex-1 w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    data-testid="scan-lm-studio-models-btn"
                    onClick={() => void handleTestLlmConnection()}
                    disabled={probingLlm}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <Activity
                      className={`w-3.5 h-3.5 text-sky-400 ${probingLlm ? 'animate-spin' : ''}`}
                    />
                    <span>
                      {probingLlm
                        ? 'Scanning LM Studio...'
                        : 'Scan LM Studio Models'}
                    </span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  Normalized Chat Route: {chatCompletionsUrl} · Multi-Endpoint
                  Scanner: {modelsDiscoveryUrl} &amp;{' '}
                  {normalizedEndpoints.nativeV0ModelsUrl}
                </p>
              </div>

              {probeResult && (
                <div
                  className={`p-3.5 rounded-md border text-xs font-mono space-y-2 ${
                    probeResult.reachable
                      ? 'bg-emerald-950/35 border-emerald-800/80 text-emerald-200'
                      : probeResult.auth_required
                        ? 'bg-sky-950/35 border-sky-700/80 text-sky-100'
                        : 'bg-amber-950/35 border-amber-800/80 text-amber-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{probeResult.message}</span>
                    <span className="text-[11px] opacity-80">
                      {probeResult.server_online ? 'SERVER ONLINE · ' : ''}
                      {probeResult.latency_ms}ms · {probeResult.endpoint_tested}
                    </span>
                  </div>
                  {probeResult.auth_required && (
                    <div className="text-[11px] text-sky-200 bg-[#0B0F17]/90 border border-sky-800/70 rounded p-2.5 space-y-1 font-sans">
                      <div className="font-semibold text-sky-300">
                        Backend Proxy Reachability Verified ({probeResult.latency_ms}ms) — LM Studio Auth Guard Active:
                      </div>
                      <div>
                        1. To connect without a token: Open LM Studio →{' '}
                        <span className="font-mono text-slate-100">
                          Developer → Server Settings
                        </span>{' '}
                        and toggle off{' '}
                        <span className="font-mono text-slate-100">
                          Require Authentication
                        </span>
                        , OR set{' '}
                        <span className="font-mono text-slate-100">
                          LLM_API_KEY
                        </span>{' '}
                        in server environment secrets.
                      </div>
                      <div className="text-emerald-300">
                        2. Fail-Safe Active: While HTTP 401 is returned, the Automated Pipeline automatically uses the Fast Institutional Synthesis &amp; Risk Gate (&lt;50ms latency) so contract scanning, Stage-1/Stage-2 analysis, and Smart Order placement run continuously without interruption.
                      </div>
                    </div>
                  )}
                  {probeResult.unexpected_endpoint_warning && (
                    <div className="text-[11px] text-amber-300 bg-amber-950/60 border border-amber-700/60 rounded p-2">
                      Diagnostic: {probeResult.unexpected_endpoint_warning}
                    </div>
                  )}
                  {probeResult.models.length > 0 && (
                    <div className="text-[11px] pt-1 flex flex-wrap items-center gap-1.5">
                      <span>Available LM Studio Models:</span>
                      {probeResult.models.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleSelectModelPreset(m.id, true)}
                          className={`px-2 py-0.5 rounded border transition-colors ${
                            modelId === m.id
                              ? 'bg-sky-500 text-slate-950 border-sky-400 font-semibold'
                              : 'bg-[#0B0F17] text-sky-300 border-slate-700 hover:border-sky-400'
                          }`}
                        >
                          {m.id}
                          {m.state === 'loaded' ? ' (loaded)' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Provider & Live LM Studio Scanned Model Selection Dropdown (No Mock Models) */}
              <div className="space-y-3 p-3.5 rounded-md bg-[#0B0F17]/90 border border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-5">
                    <label
                      htmlFor="lm-studio-provider"
                      className="block text-xs text-slate-400 mb-1"
                    >
                      Engine Provider Mode
                    </label>
                    <select
                      id="lm-studio-provider"
                      value={provider}
                      onChange={(e) =>
                        setProvider(e.target.value as LlmEngineProvider)
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#111726] border border-slate-700 rounded text-slate-100"
                    >
                      <option value="lm_studio">
                        LM Studio Local / Remote Server (OpenAI v1 + REST v0)
                      </option>
                      <option value="openai_compatible">
                        Generic OpenAI-Compatible Endpoint
                      </option>
                    </select>
                  </div>

                  <div className="sm:col-span-7">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label
                        htmlFor="lm-studio-model-select"
                        className="block text-xs font-medium text-slate-200"
                      >
                        Scanned LM Studio Model Selection (`model`)
                      </label>
                      <span className="text-[11px] font-mono text-sky-400">
                        {liveLmStudioModels.length > 0
                          ? `${liveLmStudioModels.length} model${liveLmStudioModels.length === 1 ? '' : 's'} scanned from LM Studio`
                          : 'No mock models — scan LM Studio to populate'}
                      </span>
                    </div>
                    <select
                      id="lm-studio-model-select"
                      data-testid="llm-model-preset-select"
                      aria-label="LLM Model Selection Preset"
                      value={modelId}
                      onChange={(e) =>
                        handleSelectModelPreset(e.target.value, false)
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#111726] border border-slate-700 hover:border-sky-500/60 rounded text-slate-100"
                    >
                      {liveLmStudioModels.length === 0 ? (
                        <option value={modelId}>
                          {modelId
                            ? `${modelId} (Manual ID — Click 'Scan LM Studio Models' to verify)`
                            : '— No models scanned yet (Click Scan LM Studio Models) —'}
                        </option>
                      ) : (
                        <optgroup label="Models Returned by LM Studio (/api/v0/models · /api/v1/models)">
                          {liveLmStudioModels.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                              {m.display_name ? ` (${m.display_name})` : ''}
                              {m.state === 'loaded'
                                ? ' [LOADED]'
                                : m.state === 'not-loaded'
                                  ? ' [JIT READY]'
                                  : ''}
                              {m.quantization ? ` · ${m.quantization}` : ''}
                              {m.max_context_length
                                ? ` · ${Math.round(m.max_context_length / 1024)}k ctx`
                                : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {modelId &&
                        liveLmStudioModels.length > 0 &&
                        !liveLmStudioModels.some((m) => m.id === modelId) && (
                          <option value={modelId}>
                            {modelId} (Custom Manual Identifier)
                          </option>
                        )}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-2 border-t border-slate-800/70">
                  <div className="sm:col-span-6">
                    <label
                      htmlFor="lm-studio-model"
                      className="block text-[11px] text-slate-400 mb-1"
                    >
                      Active / Manual LM Studio Model Identifier (`model`)
                    </label>
                    <input
                      id="lm-studio-model"
                      data-testid="llm-custom-model-input"
                      type="text"
                      maxLength={120}
                      placeholder="Scan LM Studio or enter exact GGUF model ID..."
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono bg-[#111726] border border-slate-700 rounded text-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-6 text-[11px] text-slate-400 leading-relaxed">
                    {activeDiscoveredModel ? (
                      <div>
                        <span className="text-emerald-300 font-semibold">
                          Verified LM Studio Model:
                        </span>{' '}
                        <span className="font-mono text-slate-100">
                          {activeDiscoveredModel.id}
                        </span>{' '}
                        ({activeDiscoveredModel.state ?? 'loaded'}
                        {activeDiscoveredModel.arch
                          ? ` · arch: ${activeDiscoveredModel.arch}`
                          : ''}
                        {activeDiscoveredModel.max_context_length
                          ? ` · max_ctx: ${activeDiscoveredModel.max_context_length}`
                          : ''}
                        )
                      </div>
                    ) : (
                      <div>
                        Model list is populated{' '}
                        <span className="text-slate-200 font-semibold">
                          exclusively from your LM Studio server response
                        </span>{' '}
                        (no mock models). Click{' '}
                        <span className="text-sky-300 font-mono">
                          Scan LM Studio Models
                        </span>{' '}
                        to query `/v1/models` and `/api/v0/models`.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reasoning Mode (Think / No-Think) Controls */}
              <div className="p-3.5 rounded-md bg-[#0B0F17]/90 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200">
                    Reasoning Mode (`think` / `no_think`)
                  </span>
                  <span className="text-[11px] font-mono text-sky-400">
                    {thinkingMode === 'no_think'
                      ? 'Fast Direct JSON (/no_think)'
                      : 'Chain-of-Thought (/think)'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="llm-thinking-mode-no-think"
                    onClick={() => setThinkingMode('no_think')}
                    className={`px-3 py-2 rounded text-xs font-mono border text-left transition-colors ${
                      thinkingMode === 'no_think'
                        ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-semibold'
                        : 'bg-[#111726] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>No-Think (`/no_think`)</div>
                    <div className="text-[10px] opacity-80 font-sans">
                      Suppresses `&lt;think&gt;` blocks for low-latency JSON
                    </div>
                  </button>
                  <button
                    type="button"
                    data-testid="llm-thinking-mode-think"
                    onClick={() => setThinkingMode('think')}
                    className={`px-3 py-2 rounded text-xs font-mono border text-left transition-colors ${
                      thinkingMode === 'think'
                        ? 'bg-violet-500/20 border-violet-400 text-violet-200 font-semibold'
                        : 'bg-[#111726] border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div>Think (`/think`)</div>
                    <div className="text-[10px] opacity-80 font-sans">
                      Enables `&lt;think&gt;` reasoning trace + JSON parser
                    </div>
                  </button>
                </div>
              </div>

              {/* Inference Generation Hyperparameters & Concurrent AI Analysis */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label
                    htmlFor="lm-studio-temp"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Temperature (0–2)
                  </label>
                  <input
                    id="lm-studio-temp"
                    type="number"
                    step="0.05"
                    min={0}
                    max={2}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="lm-studio-top-p"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Top-P (0–1)
                  </label>
                  <input
                    id="lm-studio-top-p"
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={topP}
                    onChange={(e) => setTopP(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="lm-studio-timeout"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Timeout (ms)
                  </label>
                  <input
                    id="lm-studio-timeout"
                    type="number"
                    step={1000}
                    min={2000}
                    max={180000}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="lm-studio-concurrent-ai"
                    className="block text-xs text-sky-300 font-medium mb-1"
                  >
                    Concurrent AI Analysis (1–8)
                  </label>
                  <input
                    id="lm-studio-concurrent-ai"
                    data-testid="lm-studio-concurrent-ai-input"
                    type="number"
                    step={1}
                    min={1}
                    max={8}
                    value={concurrentAnalyses}
                    onChange={(e) =>
                      setConcurrentAnalyses(
                        Math.min(Math.max(Number(e.target.value) || 1, 1), 8)
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-sky-500/50 rounded text-sky-200 font-semibold"
                  />
                </div>
              </div>

              {/* Dedicated Concurrent AI Analysis Worker Pool Control Card */}
              <div
                data-testid="concurrent-ai-analysis-settings-card"
                className="p-3.5 rounded-md bg-[#0B0F17]/95 border border-sky-500/30 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-sky-400" />
                      <span>Concurrent AI Analysis Worker Pool</span>
                      <span className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 font-mono text-[11px] text-sky-300">
                        {concurrentAnalyses}x Parallel LLM Workers
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Controls how many Stage-1 Entry Decisions, Stage-2 Position Size/Risk Assessments, and Holdings Exit Evaluations are processed simultaneously in parallel across the AI Analysis pipeline.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <input
                    type="range"
                    aria-label="Concurrent AI Analysis Slider"
                    min={1}
                    max={8}
                    step={1}
                    value={concurrentAnalyses}
                    onChange={(e) => {
                      const val = Math.min(
                        Math.max(Number(e.target.value) || 3, 1),
                        8
                      );
                      setConcurrentAnalyses(val);
                    }}
                    className="flex-1 min-w-[160px] accent-sky-400 cursor-pointer"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { val: 1, label: '1x Sequential' },
                      { val: 2, label: '2x Dual' },
                      { val: 3, label: '3x Default' },
                      { val: 4, label: '4x Quad' },
                      { val: 6, label: '6x High' },
                      { val: 8, label: '8x Max Parallel' },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => {
                          setConcurrentAnalyses(opt.val);
                          void handleUpdateCentralAutomationPolicy({
                            concurrent_ai_analyses: opt.val,
                          });
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-colors ${
                          concurrentAnalyses === opt.val
                            ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                            : 'bg-[#111726] text-slate-300 border-slate-700 hover:border-sky-500/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Context Injection & Streaming Toggles for Downstream LLM Activity */}
              <div className="p-3.5 rounded-md bg-[#0B0F17] border border-slate-800/80 space-y-2.5">
                <div className="text-xs font-medium text-slate-300">
                  LLM Activity Context &amp; Execution Options
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={streamResponses}
                      onChange={(e) => setStreamResponses(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>Stream SSE Token Responses (`stream: true`)</span>
                  </label>

                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoAnalyzeConfirmedWhales}
                      onChange={(e) =>
                        setAutoAnalyzeConfirmedWhales(e.target.checked)
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>Auto-Trigger on Confirmed Whale Candidates</span>
                  </label>

                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeGexAndTideContext}
                      onChange={(e) =>
                        setIncludeGexAndTideContext(e.target.checked)
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>Inject Market Tide &amp; GEX Wall Context</span>
                  </label>

                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAlpacaStockIndicators}
                      onChange={(e) =>
                        setIncludeAlpacaStockIndicators(e.target.checked)
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>Inject Alpaca 5m Indicators &amp; Lit Flow</span>
                  </label>
                </div>
              </div>

              {/* System Prompt Template */}
              <div>
                <label
                  htmlFor="lm-studio-system-prompt"
                  className="block text-xs text-slate-400 mb-1"
                >
                  System Prompt Template for Whale Flow &amp; Stock Analysis
                </label>
                <textarea
                  id="lm-studio-system-prompt"
                  rows={4}
                  maxLength={2000}
                  value={systemPromptTemplate}
                  onChange={(e) => setSystemPromptTemplate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100 leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetLlmDefaults}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>

                <button
                  type="submit"
                  disabled={savingLlm}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {savingLlm
                      ? 'Saving Configuration...'
                      : 'Save LM Studio Configuration'}
                  </span>
                </button>
              </div>
            </form>

            {llmValidationError && (
              <div
                role="alert"
                className="p-3 rounded bg-rose-950/40 border border-rose-800 text-xs text-rose-200"
              >
                {llmValidationError}
              </div>
            )}

            {llmSavedNotice && (
              <div
                role="status"
                className="p-3 rounded bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-2 font-mono"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{llmSavedNotice}</span>
              </div>
            )}
          </section>

          {/* Right 5 cols: Persisted Database State & OpenAI-Compatible Request Preview */}
          <section
            aria-label="LM Studio Database State and Request Preview"
            className="lg:col-span-5 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  <span>Persisted LM Studio Engine State</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Stored in `/api/settings/llm-engine` &amp; Firestore
                  `/llmEngineConfigs`
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">
                DB Synced
              </span>
            </div>

            <div className="space-y-2 text-xs font-mono bg-[#0B0F17] p-3.5 rounded border border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Saved Endpoint:</span>
                <span className="text-sky-400 font-semibold truncate">
                  {llmEngineConfig.endpointUrl}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Saved Model ID:</span>
                <span className="text-slate-100">
                  {llmEngineConfig.modelId || '(awaiting LM Studio scan)'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Reasoning Mode:</span>
                <span className="text-sky-300">
                  {(llmEngineConfig.thinkingMode ?? 'no_think') === 'no_think'
                    ? 'no_think (/no_think Fast JSON)'
                    : 'think (/think Reasoning Trace)'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Temp / Top-P / Timeout:</span>
                <span className="text-slate-200">
                  {llmEngineConfig.temperature} · {llmEngineConfig.topP} ·{' '}
                  {llmEngineConfig.timeoutMs}ms
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Concurrent AI Analysis:</span>
                <span className="text-sky-300 font-semibold">
                  {llmEngineConfig.concurrentAnalyses ?? 3}x Parallel Workers
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Context Payloads:</span>
                <span className="text-slate-200">
                  {[
                    llmEngineConfig.includeGexAndTideContext ? 'Tide+GEX' : null,
                    llmEngineConfig.includeAlpacaStockIndicators
                      ? 'Alpaca 5m'
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') || 'Flow Only'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Last Saved At:</span>
                <span className="text-slate-400">
                  {new Date(llmEngineConfig.updatedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Outgoing LM Studio API Dispatch Preview
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  POST /v1/chat/completions
                </span>
              </div>
              <pre className="p-3 rounded bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-[310px]">
                {JSON.stringify(lmStudioRequestPreview, null, 2)}
              </pre>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: INTERNAL SCANNER RULES (/v1/scanners) */}
      {activeTab === 'scanner_rules' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 7 cols: POST /v1/scanners Editor */}
          <section
            aria-label="Configure Scanner Rules"
            className="lg:col-span-7 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Internal Scanner Configuration (POST /v1/scanners)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Scanner mode is automatically routed by live Market Tide, GEX,
                  and volatility regime. Tune numerical thresholds for the active
                  auto-routed mode below.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="px-2.5 py-1 rounded bg-sky-500/20 border border-sky-400/50 text-sky-300 font-semibold">
                  Auto-Routed Mode: {activeScanner.name} ({activeScanner.mode})
                </span>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="cfg-name"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Scanner Name
                  </label>
                  <input
                    id="cfg-name"
                    type="text"
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cfg-min-score"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Min Whale Score (0-100)
                  </label>
                  <input
                    id="cfg-min-score"
                    type="number"
                    min={0}
                    max={100}
                    value={minWhaleScore}
                    onChange={(e) => setMinWhaleScore(Number(e.target.value))}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label
                    htmlFor="cfg-min-prem"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Min Premium ($)
                  </label>
                  <input
                    id="cfg-min-prem"
                    type="number"
                    step={10000}
                    value={minPremium}
                    onChange={(e) => setMinPremium(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cfg-min-dte"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Min DTE
                  </label>
                  <input
                    id="cfg-min-dte"
                    type="number"
                    value={minDte}
                    onChange={(e) => setMinDte(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cfg-max-dte"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Max DTE
                  </label>
                  <input
                    id="cfg-max-dte"
                    type="number"
                    value={maxDte}
                    onChange={(e) => setMaxDte(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cfg-vol-oi"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Min Vol/OI Ratio
                  </label>
                  <input
                    id="cfg-vol-oi"
                    type="number"
                    step="0.05"
                    value={minVolOi}
                    onChange={(e) => setMinVolOi(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="cfg-skew"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Min Dominant Skew (0..1)
                  </label>
                  <input
                    id="cfg-skew"
                    type="number"
                    step="0.05"
                    value={minSkew}
                    onChange={(e) => setMinSkew(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cfg-mleg"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Max Multileg Ratio
                  </label>
                  <input
                    id="cfg-mleg"
                    type="number"
                    step="0.05"
                    value={maxMultileg}
                    onChange={(e) => setMaxMultileg(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cfg-spread"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Max Option Spread
                  </label>
                  <input
                    id="cfg-spread"
                    type="number"
                    step="0.01"
                    value={maxSpread}
                    onChange={(e) => setMaxSpread(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireConfirm}
                    onChange={(e) => setRequireConfirm(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900"
                  />
                  <span>
                    Require 5-Minute Underlying Price &amp; VWAP Confirmation
                  </span>
                </label>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Update Scanner (POST /v1/scanners)</span>
                </button>
              </div>
            </form>

            {validationError && (
              <div
                role="alert"
                className="p-3 rounded bg-rose-950/40 border border-rose-800 text-xs text-rose-200"
              >
                {validationError}
              </div>
            )}

            {savedNotice && (
              <div
                role="status"
                className="p-3 rounded bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-200 flex items-center gap-2 font-mono"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{savedNotice}</span>
              </div>
            )}
          </section>

          {/* Right 5 cols: POST /v1/scanners JSON Payload Preview */}
          <section
            aria-label="Scanner API Payload Preview"
            className="lg:col-span-5 border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span>POST /v1/scanners Payload</span>
              </h3>
              <span className="text-xs font-mono text-slate-400">
                GET /v1/scanners/{activeScanner.scanner_id}/candidates
              </span>
            </div>
            <pre className="p-3 rounded bg-[#0B0F17] border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-[340px]">
              {JSON.stringify(postPayloadPreview, null, 2)}
            </pre>
          </section>
        </div>
      )}

      {/* TAB 3: DATABASE PERSISTENCE & API SOURCES */}
      {activeTab === 'data_sources' && (
        <div className="space-y-6">
          <section
            aria-label="Database Persistence and Session Sync"
            className="border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Database className="w-4 h-4 text-sky-400" />
                  <span>
                    Backend Database Persistence &amp; Cloud Firestore Session
                    Sync
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  All LM Studio LLM settings, acquired WhaleCandidate clusters,
                  normalized option prints, and scanner rules are persisted in
                  the backend database and synchronized across browser sessions.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {currentUserEmail ? (
                  <>
                    <span className="text-xs font-mono text-emerald-400">
                      Signed in: {currentUserEmail}
                    </span>
                    <button
                      type="button"
                      onClick={handleManualCloudSync}
                      disabled={syncingCloud}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`}
                      />
                      <span>Sync All Settings &amp; Data to Firestore</span>
                    </button>
                    <button
                      type="button"
                      onClick={onSignOut}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={onSignInGoogle}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <LogIn className="w-3.5 h-3.5 text-sky-400" />
                    <span>Sign In with Google for Cloud Firestore Sync</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-slate-800/80">
              <div className="p-3 rounded bg-[#0B0F17]/80">
                <div className="text-slate-400">
                  Backend Persisted Candidates
                </div>
                <div className="font-mono font-semibold text-slate-100 mt-0.5">
                  {backendPersistenceStats.candidatesCount} clusters ·{' '}
                  {scanners.length} scanner profiles
                </div>
              </div>
              <div className="p-3 rounded bg-[#0B0F17]/80">
                <div className="text-slate-400">
                  Persisted LM Studio Endpoint
                </div>
                <div className="font-mono font-semibold text-sky-400 mt-0.5 truncate">
                  {llmEngineConfig.endpointUrl}
                </div>
              </div>
              <div className="p-3 rounded bg-[#0B0F17]/80">
                <div className="text-slate-400">
                  Backend Recalculation Worker
                </div>
                <div className="font-mono font-semibold text-emerald-400 mt-0.5">
                  Cycle #{backendPersistenceStats.recalculationCycles} · 60s
                  interval
                </div>
              </div>
              <div className="p-3 rounded bg-[#0B0F17]/80">
                <div className="text-slate-400 flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5 text-sky-400" />
                  <span>Firestore Cloud Records</span>
                </div>
                <div className="font-mono font-semibold text-sky-400 mt-0.5">
                  {currentUserEmail
                    ? `${cloudSyncCounts.syncedCandidates} cands · ${cloudSyncCounts.syncedConfigs} configs`
                    : 'Backend DB sync active'}
                </div>
              </div>
            </div>
          </section>

          <section
            aria-label="Unusual Whales API Specification"
            className="border border-slate-800 bg-[#111726] rounded-lg p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-sky-400" />
                  <span>
                    Unusual Whales REST &amp; WebSocket Source Architecture
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Base URL: https://api.unusualwhales.com/api · Initial
                  Market-Wide Discovery Endpoint:
                </p>
              </div>
            </div>

            <div className="p-3 rounded bg-[#0B0F17] border border-slate-800 font-mono text-xs text-sky-300 overflow-x-auto">
              {buildUnusualActivityDiscoveryUrl()}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Use Case</th>
                    <th className="py-2.5 px-3 font-medium">Endpoint</th>
                    <th className="py-2.5 px-3 font-medium">Scanner Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {uwEndpoints.map((ep) => (
                    <tr key={ep.endpoint} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 text-slate-200 font-medium">
                        {ep.use}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-sky-400">
                        {ep.endpoint}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {ep.purpose}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

