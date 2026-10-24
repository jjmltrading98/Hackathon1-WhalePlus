import React, { useEffect, useState, useCallback, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  ADAPTIVE_FILTER_PROFILES,
  AdaptiveFilterProfileId,
  DEFAULT_SCANNER_MODES,
  FlowAlertRule,
  IssueType,
  MarketTideRegime,
  OptionType,
  PrintSide,
  REGIME_SCANNER_PROFILES,
  ScannerConfig,
  ScannerModeId,
  WhaleCandidate,
  formatCandidateTimestampSummary,
  formatEtTimeString,
  resolveAutoScannerMode,
} from './engine/whaleScannerEngine';
import {
  type AlpacaAccountOverviewPayload,
  type AlpacaMarketClockState,
  AutomatedPipelineState,
  HistoricalTradingSessionSummary,
  LlmEngineConfig,
  MarketTideState,
  PersistedWebSocketMessage,
  ReconciliationReport,
  RejectedPrintLog,
  sharedScannerRuntime,
} from './engine/whalePipelineRuntime';
import { HistoricalDateCalendarPicker } from './components/HistoricalDateCalendarPicker';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import {
  logOptionPrintToFirestore,
  subscribeToUserWorkspace,
  syncCandidateToFirestore,
  syncLlmEngineConfigToFirestore,
  syncScannerConfigToFirestore,
  syncUserSessionToFirestore,
} from './services/firestoreSyncService';
import { CandidateInspector } from './components/CandidateInspector';
import { MarketTideView } from './components/MarketTideView';
import { PipelineWorkbenchView } from './components/PipelineWorkbenchView';
import { ScannerConfigView } from './components/ScannerConfigView';
import { AlpacaAccountView } from './components/AlpacaAccountView';
import { ApiActivityMonitorView } from './components/ApiActivityMonitorView';
import { AiAnalysisMonitorView } from './components/AiAnalysisMonitorView';
import { SmartOrderMonitorView } from './components/SmartOrderMonitorView';
import { RegimeStrategyView } from './components/RegimeStrategyView';
import { LlmTradeDecisionView } from './components/LlmTradeDecisionView';
import { HoldingsMonitorView } from './components/HoldingsMonitorView';
import { CandidateDetailChartView } from './components/CandidateDetailChartView';
import { BacktestLearningView } from './components/BacktestLearningView';
import type { LlmTradeDecisionRecord } from './engine/llmTradeDecisionEngine';
import type { LearnedConditionRule } from './engine/selfLearningBacktestEngine';
import type { RiskPolicyConfig } from './engine/riskFirstExecutionEngine';
import type {
  AiAnalysisActivityEntry,
  AiAnalysisType,
  ApiActivityLogEntry,
} from './engine/activityMonitorEngine';
import type {
  SmartExecutionAlgoId,
  SmartOrderEngineConfig,
  SmartOrderExecutionTicket,
  SmartOrderSide,
} from './engine/smartOrderEngine';
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  Search,
  RotateCcw,
  PlusCircle,
  Sliders,
  RefreshCw,
  Zap,
  Play,
  Cpu,
  Radio,
  BarChart3,
} from 'lucide-react';


type ActiveSection =
  | 'scanner'
  | 'holdings_monitor'
  | 'regime_strategy'
  | 'llm_decision_gate'
  | 'market_tide'
  | 'alpaca_account'
  | 'smart_order'
  | 'backtest_learning'
  | 'api_activity'
  | 'ai_analysis'
  | 'pipeline'
  | 'config';

const REGIME_SHORT_LABELS: Record<MarketTideRegime, string> = {
  strong_positive: 'Strong Positive',
  strong_negative: 'Strong Negative',
  neutral: 'Neutral / Flat',
  mixed: 'Mixed Tide',
  reversing: 'Rapidly Reversing',
};

const HASH_TO_SECTION: Record<string, ActiveSection> = {
  '#scanner': 'scanner',
  '#flow-discovery': 'scanner',
  '#holdings-monitor': 'holdings_monitor',
  '#portfolio': 'holdings_monitor',
  '#regime-strategy': 'regime_strategy',
  '#llm-decision-gate': 'llm_decision_gate',
  '#ai-decision-gate': 'ai_analysis',
  '#market-tide': 'market_tide',
  '#marketide': 'market_tide',
  '#alpaca-account': 'alpaca_account',
  '#account-overview': 'alpaca_account',
  '#smart-order': 'smart_order',
  '#bake-test': 'backtest_learning',
  '#backtest-learning': 'backtest_learning',
  '#self-learning': 'backtest_learning',
  '#api-activity': 'api_activity',
  '#api-monitor': 'api_activity',
  '#api-usage': 'api_activity',
  '#ai-analysis': 'ai_analysis',
  '#pipeline': 'pipeline',
  '#config': 'config',
  '#settings': 'config',
};

const SECTION_TO_HASH: Record<ActiveSection, string> = {
  scanner: '#scanner',
  holdings_monitor: '#holdings-monitor',
  regime_strategy: '#regime-strategy',
  llm_decision_gate: '#llm-decision-gate',
  market_tide: '#market-tide',
  alpaca_account: '#alpaca-account',
  smart_order: '#smart-order',
  backtest_learning: '#bake-test',
  api_activity: '#api-activity',
  ai_analysis: '#ai-analysis',
  pipeline: '#pipeline',
  config: '#config',
};

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      return HASH_TO_SECTION[window.location.hash] ?? 'scanner';
    }
    return 'scanner';
  });

  useEffect(() => {
    const onHashChange = () => {
      const matched = HASH_TO_SECTION[window.location.hash];
      if (matched) {
        setActiveSection(matched);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const targetHash = SECTION_TO_HASH[activeSection];
    if (
      typeof window !== 'undefined' &&
      targetHash &&
      window.location.hash !== targetHash
    ) {
      window.history.replaceState(null, '', targetHash);
    }
  }, [activeSection]);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [cloudSyncCounts, setCloudSyncCounts] = useState<{
    syncedCandidates: number;
    syncedConfigs: number;
    syncedPrints: number;
    lastSyncedAt: string | null;
  }>({
    syncedCandidates: 0,
    syncedConfigs: 0,
    syncedPrints: 0,
    lastSyncedAt: null,
  });

  const [scanners, setScanners] = useState<ScannerConfig[]>(() =>
    sharedScannerRuntime.getScanners()
  );
  const [llmEngineConfig, setLlmEngineConfig] = useState<LlmEngineConfig>(() =>
    sharedScannerRuntime.getLlmEngineConfig()
  );
  const [smartOrderConfig, setSmartOrderConfig] =
    useState<SmartOrderEngineConfig>(() =>
      sharedScannerRuntime.getSmartOrderConfig()
    );
  const [
    preselectedSmartOrderCandidateId,
    setPreselectedSmartOrderCandidateId,
  ] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ScannerModeId>(
    'directional_momentum'
  );
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [directionFilter, setDirectionFilter] = useState<string>('all');
  const [tickerQuery, setTickerQuery] = useState<string>('');
  const [minScoreFilter, setMinScoreFilter] = useState<number>(50);
  const [includeEtfs, setIncludeEtfs] = useState<boolean>(true);
  const [regimeAdaptiveEnabled, setRegimeAdaptiveEnabled] =
    useState<boolean>(false);
  const [activeTideRegime, setActiveTideRegime] =
    useState<MarketTideRegime>('strong_positive');
  const [activeAdaptiveProfile, setActiveAdaptiveProfile] =
    useState<AdaptiveFilterProfileId>('risk_on_trend');
  const [selectedSessionDate, setSelectedSessionDate] =
    useState<string>('latest');
  const [availableSessions, setAvailableSessions] = useState<
    HistoricalTradingSessionSummary[]
  >(() => sharedScannerRuntime.getAvailableHistoricalSessions());

  const [candidates, setCandidates] = useState<WhaleCandidate[]>(() =>
    sharedScannerRuntime.queryCandidates({
      mode: 'directional_momentum',
      min_score: 50,
      include_etfs: true,
      regime_adaptive: false,
      tide_regime: 'strong_positive',
      adaptive_profile: 'risk_on_trend',
      limit: 50,
    })
  );
  const [allAcquiredCandidates, setAllAcquiredCandidates] = useState<
    WhaleCandidate[]
  >(() =>
    sharedScannerRuntime.queryCandidates({
      mode: 'directional_momentum',
      min_score: 0,
      include_etfs: true,
      regime_adaptive: false,
      tide_regime: 'strong_positive',
      limit: 100,
    })
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    () => {
      const initial = sharedScannerRuntime.queryCandidates({
        mode: 'directional_momentum',
        min_score: 50,
        include_etfs: true,
        regime_adaptive: false,
        tide_regime: 'strong_positive',
        limit: 50,
      });
      return initial[0]?.candidate_id ?? null;
    }
  );
  const [candidateDetailChartOpen, setCandidateDetailChartOpen] =
    useState<boolean>(false);

  const [telemetry, setTelemetry] = useState<{
    market_clock?: AlpacaMarketClockState;
    market_tide: MarketTideState;
    alpaca_status?: {
      configured: boolean;
      connected: boolean;
      feed: string;
      last_synced_at: string | null;
      synced_tickers: string[];
      total_bars_cached: number;
      total_lit_prints_cached: number;
      error: string | null;
    };
    alpaca_account_overview?: AlpacaAccountOverviewPayload;
    holdings_monitor?: ReturnType<typeof sharedScannerRuntime.getHoldingsMonitorState>;
    contract_cache_count: number;
    seen_event_count: number;
    raw_ws_messages: PersistedWebSocketMessage[];
    rejected_prints: RejectedPrintLog[];
    last_reconciliation: ReconciliationReport | null;
    api_activity_logs?: ApiActivityLogEntry[];
    ai_analysis_logs?: AiAnalysisActivityEntry[];
    smart_order_config?: SmartOrderEngineConfig;
    smart_order_tickets?: SmartOrderExecutionTicket[];
    llm_decision_records?: LlmTradeDecisionRecord[];
    risk_policy_config?: RiskPolicyConfig;
    automation_state?: AutomatedPipelineState;
    recalculation_cycles?: number;
    last_saved_at?: string;
    active_ws_channels: string[];
    selected_session_date?: string;
    is_historical_session?: boolean;
    available_sessions?: HistoricalTradingSessionSummary[];
  }>(() => sharedScannerRuntime.getTelemetryState());
  const [syncingAlpaca, setSyncingAlpaca] = useState(false);
  const [syncingMarketClock, setSyncingMarketClock] = useState(false);
  const [runningAutoCycle, setRunningAutoCycle] = useState(false);
  const [autoCycleNotice, setAutoCycleNotice] = useState<string | null>(null);
  const [nextScanCountdownSec, setNextScanCountdownSec] = useState<number>(20);
  const backgroundCycleInFlight = useRef(false);

  const marketClock =
    telemetry.market_clock ?? sharedScannerRuntime.getMarketClockState();
  const isMarketOpen = marketClock.is_open;

  const initialSessionLoaded = useRef(false);

  const autoScannerResolution = resolveAutoScannerMode({
    tide_regime: telemetry.market_tide.regime ?? activeTideRegime,
    adaptive_profile:
      telemetry.market_tide.active_filter_profile ?? activeAdaptiveProfile,
    volatility_regime: telemetry.market_tide.market_state?.volatility_regime,
    extreme_tide: telemetry.market_tide.extreme_tide,
  });

  useEffect(() => {
    if (selectedMode !== autoScannerResolution.mode) {
      setSelectedMode(autoScannerResolution.mode);
    }
  }, [autoScannerResolution.mode, selectedMode]);

  const activeScanner =
    scanners.find((s) => s.mode === autoScannerResolution.mode) ??
    DEFAULT_SCANNER_MODES[autoScannerResolution.mode];

  const activeRegimeProfile =
    telemetry.market_tide.active_filter_spec ??
    REGIME_SCANNER_PROFILES[activeTideRegime];

  const activeAdaptiveSpec =
    telemetry.market_tide.active_adaptive_spec ??
    ADAPTIVE_FILTER_PROFILES[activeAdaptiveProfile];

  const persistSessionState = useCallback(
    async (next: {
      selectedMode: ScannerModeId;
      statusFilter: string;
      directionFilter: string;
      tickerQuery: string;
      minScoreFilter: number;
      includeEtfs: boolean;
      regimeAdaptiveEnabled?: boolean;
      activeTideRegime?: MarketTideRegime;
      activeAdaptiveProfile?: AdaptiveFilterProfileId;
      selectedCandidateId?: string | null;
    }) => {
      try {
        await fetch('/api/session/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
      } catch {
        sharedScannerRuntime.updateSessionSettings(next);
      }

      if (auth.currentUser && auth.currentUser.emailVerified) {
        try {
          await syncUserSessionToFirestore({
            selectedMode: next.selectedMode,
            statusFilter: next.statusFilter,
            directionFilter: next.directionFilter,
            tickerQuery: next.tickerQuery,
            minScoreFilter: next.minScoreFilter,
            includeEtfs: next.includeEtfs,
          });
        } catch {
          // Handled inside firestoreSyncService
        }
      }
    },
    []
  );

  const refreshData = useCallback(
    async (
      modeOverride?: ScannerModeId,
      statusOverride?: string,
      dirOverride?: string,
      tickerOverride?: string,
      scoreOverride?: number,
      etfOverride?: boolean,
      regimeAdaptiveOverride?: boolean,
      tideRegimeOverride?: MarketTideRegime,
      adaptiveProfileOverride?: AdaptiveFilterProfileId,
      sessionDateOverride?: string
    ) => {
      const modeToUse = modeOverride ?? selectedMode;
      const statusToUse = statusOverride ?? statusFilter;
      const dirToUse = dirOverride ?? directionFilter;
      const tickerToUse = tickerOverride ?? tickerQuery;
      const scoreToUse = scoreOverride ?? minScoreFilter;
      const etfToUse = etfOverride ?? includeEtfs;
      const adaptiveToUse =
        regimeAdaptiveOverride !== undefined
          ? regimeAdaptiveOverride
          : regimeAdaptiveEnabled;
      const regimeToUse = tideRegimeOverride ?? activeTideRegime;
      const profileToUse = adaptiveProfileOverride ?? activeAdaptiveProfile;
      const sessionDateToUse = sessionDateOverride ?? selectedSessionDate;

      const isPassivePoll =
        modeOverride === undefined &&
        statusOverride === undefined &&
        dirOverride === undefined &&
        tickerOverride === undefined &&
        scoreOverride === undefined &&
        etfOverride === undefined &&
        regimeAdaptiveOverride === undefined &&
        tideRegimeOverride === undefined &&
        adaptiveProfileOverride === undefined &&
        sessionDateOverride === undefined;

      if (isPassivePoll && backgroundCycleInFlight.current) {
        return;
      }
      if (isPassivePoll) {
        backgroundCycleInFlight.current = true;
      }

      try {
        const params = new URLSearchParams();
        params.set('mode', modeToUse);
        if (statusToUse !== 'all') params.set('status', statusToUse);
        if (dirToUse !== 'all') params.set('direction', dirToUse);
        if (tickerToUse.trim()) params.set('ticker', tickerToUse.trim());
        params.set('min_score', String(scoreToUse));
        params.set('include_etfs', String(etfToUse));
        params.set('regime_adaptive', String(adaptiveToUse));
        params.set('tide_regime', regimeToUse);
        params.set('adaptive_profile', profileToUse);
        if (sessionDateToUse && sessionDateToUse !== 'latest') {
          params.set('session_date', sessionDateToUse);
        }
        params.set('limit', '50');

        const syncRes = await fetch(`/api/workspace/sync?${params.toString()}`);

        if (syncRes.ok) {
          const data = await syncRes.json();
          const list: WhaleCandidate[] = data.candidates ?? [];
          setCandidates(list);
          setSelectedCandidateId((prev) =>
            list.some((c) => c.candidate_id === prev)
              ? prev
              : (list[0]?.candidate_id ?? null)
          );
          if (data.telemetry) {
            const telData = data.telemetry;
            setTelemetry(telData);
            if (Array.isArray(telData.available_sessions)) {
              setAvailableSessions(telData.available_sessions);
            }
            if (isPassivePoll) {
              if (telData.llm_engine_config) {
                const syncedCfg = sharedScannerRuntime.updateLlmEngineConfig(
                  telData.llm_engine_config
                );
                setLlmEngineConfig(syncedCfg);
              }
              if (telData.smart_order_config) {
                const syncedSmart = sharedScannerRuntime.updateSmartOrderConfig(
                  telData.smart_order_config
                );
                setSmartOrderConfig(syncedSmart);
              }
              if (Array.isArray(telData.scanners)) {
                setScanners(telData.scanners);
              }
            }
          }
          return;
        }
      } catch {
        // Fallback to local deterministic runtime
      } finally {
        if (isPassivePoll) {
          backgroundCycleInFlight.current = false;
        }
      }

      const localList = sharedScannerRuntime.queryCandidates({
        mode: modeToUse,
        status: statusToUse,
        direction: dirToUse,
        ticker: tickerToUse,
        min_score: scoreToUse,
        include_etfs: etfToUse,
        regime_adaptive: adaptiveToUse,
        tide_regime: regimeToUse,
        adaptive_profile: profileToUse,
        session_date: sessionDateToUse,
        limit: 50,
      });
      setCandidates(localList);
      setSelectedCandidateId((prev) =>
        localList.some((c) => c.candidate_id === prev)
          ? prev
          : (localList[0]?.candidate_id ?? null)
      );
      const localTel = sharedScannerRuntime.getTelemetryState(sessionDateToUse);
      setTelemetry(localTel);
      if (Array.isArray(localTel.available_sessions)) {
        setAvailableSessions(localTel.available_sessions);
      }
    },
    [
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      activeAdaptiveProfile,
      selectedSessionDate,
    ]
  );

  const handleSelectSessionDate = useCallback(
    (nextSessionDate: string) => {
      const normalized =
        !nextSessionDate || nextSessionDate === 'latest'
          ? 'latest'
          : nextSessionDate;
      setSelectedSessionDate(normalized);
      void refreshData(
        selectedMode,
        statusFilter,
        directionFilter,
        tickerQuery,
        minScoreFilter,
        includeEtfs,
        regimeAdaptiveEnabled,
        activeTideRegime,
        activeAdaptiveProfile,
        normalized
      );
    },
    [
      refreshData,
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      activeAdaptiveProfile,
    ]
  );

  // Restore persisted backend session state on mount
  useEffect(() => {
    let mounted = true;
    async function bootstrapSessionFromBackend() {
      try {
        const res = await fetch('/api/session/state');
        if (res.ok && mounted) {
          const data = await res.json();
          const s = data.session_settings;
          if (s) {
            const nextRegime: MarketTideRegime =
              s.activeTideRegime ?? 'strong_positive';
            const nextProfile: AdaptiveFilterProfileId =
              s.activeAdaptiveProfile ?? 'risk_on_trend';
            const autoMode = resolveAutoScannerMode({
              tide_regime: nextRegime,
              adaptive_profile: nextProfile,
            });
            setSelectedMode(autoMode.mode);
            setStatusFilter('all');
            setDirectionFilter('all');
            setTickerQuery('');
            setMinScoreFilter(50);
            setIncludeEtfs(true);
            setRegimeAdaptiveEnabled(false);
            setActiveTideRegime(nextRegime);
            setActiveAdaptiveProfile(nextProfile);
            if (s.selectedCandidateId) {
              setSelectedCandidateId(s.selectedCandidateId);
            }
          }
          if (Array.isArray(data.scanners)) {
            setScanners(data.scanners);
          }
          if (Array.isArray(data.available_sessions)) {
            setAvailableSessions(data.available_sessions);
          } else if (Array.isArray(data.telemetry?.available_sessions)) {
            setAvailableSessions(data.telemetry.available_sessions);
          }
          if (data.llm_engine_config) {
            const syncedCfg = sharedScannerRuntime.updateLlmEngineConfig(
              data.llm_engine_config
            );
            setLlmEngineConfig(syncedCfg);
            if (
              !Array.isArray(syncedCfg.discoveredModels) ||
              syncedCfg.discoveredModels.length === 0
            ) {
              fetch('/api/settings/llm-engine/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpointUrl: syncedCfg.endpointUrl }),
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((pingData) => {
                  if (mounted && pingData?.llm_engine_config) {
                    const updatedCfg =
                      sharedScannerRuntime.updateLlmEngineConfig(
                        pingData.llm_engine_config
                      );
                    setLlmEngineConfig(updatedCfg);
                  }
                  if (mounted && pingData?.automation_state) {
                    setTelemetry((prev) => ({
                      ...prev,
                      automation_state: pingData.automation_state,
                    }));
                  }
                })
                .catch(() => {});
            }
          }
          if (Array.isArray(data.all_candidates) && data.all_candidates.length > 0) {
            setAllAcquiredCandidates(data.all_candidates);
            setCandidates(data.all_candidates);
          } else if (Array.isArray(data.candidates)) {
            setCandidates(data.candidates);
          }
          if (data.telemetry) {
            setTelemetry(data.telemetry);
          }
        }
      } catch {
        // Local fallback already initialized
      } finally {
        initialSessionLoaded.current = true;
      }
    }
    bootstrapSessionFromBackend();
    return () => {
      mounted = false;
    };
  }, []);

  // Auth & Real-Time Firestore Cross-Session Sync Listener
  useEffect(() => {
    let unsubscribeFirestore: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }

      if (user && user.emailVerified) {
        unsubscribeFirestore = subscribeToUserWorkspace(user.uid, {
          onSessionUpdate: (cloudSettings) => {
            setSelectedMode(cloudSettings.selectedMode);
            setStatusFilter(cloudSettings.statusFilter);
            setDirectionFilter(cloudSettings.directionFilter);
            setTickerQuery(cloudSettings.tickerQuery);
            setMinScoreFilter(cloudSettings.minScoreFilter);
            setIncludeEtfs(cloudSettings.includeEtfs);
            refreshData(
              cloudSettings.selectedMode,
              cloudSettings.statusFilter,
              cloudSettings.directionFilter,
              cloudSettings.tickerQuery,
              cloudSettings.minScoreFilter,
              cloudSettings.includeEtfs,
              regimeAdaptiveEnabled,
              activeTideRegime,
              activeAdaptiveProfile
            );
          },
          onCloudCountsUpdate: (counts) => {
            setCloudSyncCounts(counts);
          },
          onLlmConfigUpdate: (cloudConfig) => {
            const currentRuntimeCfg =
              sharedScannerRuntime.getLlmEngineConfig();
            const keepCurrentRemoteEndpoint =
              cloudConfig.endpointUrl.includes('localhost:1234') &&
              !currentRuntimeCfg.endpointUrl.includes('localhost:1234');
            const safeCloudUpdate: Partial<LlmEngineConfig> = {
              ...cloudConfig,
              endpointUrl: keepCurrentRemoteEndpoint
                ? currentRuntimeCfg.endpointUrl
                : cloudConfig.endpointUrl,
              discoveredModels:
                Array.isArray(cloudConfig.discoveredModels) &&
                cloudConfig.discoveredModels.length > 0
                  ? cloudConfig.discoveredModels
                  : currentRuntimeCfg.discoveredModels,
              lastModelScanAt:
                cloudConfig.lastModelScanAt ??
                currentRuntimeCfg.lastModelScanAt,
              modelId:
                cloudConfig.modelId && cloudConfig.modelId !== 'local-model'
                  ? cloudConfig.modelId
                  : currentRuntimeCfg.modelId,
              timeoutMs: Math.max(
                cloudConfig.timeoutMs ?? currentRuntimeCfg.timeoutMs ?? 120000,
                90000
              ),
              maxTokens: Math.max(
                cloudConfig.maxTokens ?? currentRuntimeCfg.maxTokens ?? 2048,
                1536
              ),
              concurrentAnalyses: Math.min(
                Math.max(
                  cloudConfig.concurrentAnalyses ??
                    currentRuntimeCfg.concurrentAnalyses ??
                    3,
                  1
                ),
                8
              ),
            };
            const cloudTime = cloudConfig.updatedAt
              ? Date.parse(cloudConfig.updatedAt)
              : 0;
            const runtimeTime = currentRuntimeCfg.updatedAt
              ? Date.parse(currentRuntimeCfg.updatedAt)
              : 0;
            if (cloudTime > runtimeTime) {
              const merged =
                sharedScannerRuntime.updateLlmEngineConfig(safeCloudUpdate);
              setLlmEngineConfig(merged);
              fetch('/api/settings/llm-engine', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(merged),
              }).catch(() => {});
            }
          },
        });
      }
    });

    return () => {
      unsubAuth();
      if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, [
    refreshData,
    regimeAdaptiveEnabled,
    activeTideRegime,
    activeAdaptiveProfile,
  ]);

  const handleSyncAllToCloud = async () => {
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    await syncUserSessionToFirestore({
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
    });
    await syncLlmEngineConfigToFirestore(llmEngineConfig);
    for (const sc of scanners) {
      await syncScannerConfigToFirestore(sc);
    }
    for (const cand of allAcquiredCandidates) {
      await syncCandidateToFirestore(cand);
    }
  };

  const handleSwitchRegime = async (nextRegime: MarketTideRegime) => {
    const mappedProfile: Record<MarketTideRegime, AdaptiveFilterProfileId> = {
      strong_positive: 'risk_on_trend',
      strong_negative: 'risk_off_trend',
      neutral: 'positive_gamma_range',
      mixed: 'negative_gamma_expansion',
      reversing: 'gamma_flip_transition',
    };
    const nextProfile = mappedProfile[nextRegime];
    const nextAutoMode = resolveAutoScannerMode({
      tide_regime: nextRegime,
      adaptive_profile: nextProfile,
    });
    setActiveTideRegime(nextRegime);
    setActiveAdaptiveProfile(nextProfile);
    setSelectedMode(nextAutoMode.mode);
    setMinScoreFilter(nextAutoMode.default_min_score);
    try {
      const res = await fetch('/api/market/market-tide/regime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regime: nextRegime }),
      });
      if (res.ok) {
        await refreshData(
          nextAutoMode.mode,
          statusFilter,
          directionFilter,
          tickerQuery,
          nextAutoMode.default_min_score,
          includeEtfs,
          regimeAdaptiveEnabled,
          nextRegime,
          nextProfile
        );
        return;
      }
    } catch {
      // Fallback to local runtime
    }
    sharedScannerRuntime.setMarketTideRegimePreset(nextRegime);
    await refreshData(
      nextAutoMode.mode,
      statusFilter,
      directionFilter,
      tickerQuery,
      nextAutoMode.default_min_score,
      includeEtfs,
      regimeAdaptiveEnabled,
      nextRegime,
      nextProfile
    );
  };

  const handleSwitchAdaptiveProfile = async (
    nextProfile: AdaptiveFilterProfileId
  ) => {
    const nextAutoMode = resolveAutoScannerMode({
      tide_regime: activeTideRegime,
      adaptive_profile: nextProfile,
    });
    setActiveAdaptiveProfile(nextProfile);
    setSelectedMode(nextAutoMode.mode);
    setMinScoreFilter(nextAutoMode.default_min_score);
    try {
      const res = await fetch('/api/market/market-tide/regime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adaptive_profile: nextProfile }),
      });
      if (res.ok) {
        await refreshData(
          nextAutoMode.mode,
          statusFilter,
          directionFilter,
          tickerQuery,
          nextAutoMode.default_min_score,
          includeEtfs,
          regimeAdaptiveEnabled,
          activeTideRegime,
          nextProfile
        );
        return;
      }
    } catch {
      // Fallback to local runtime
    }
    sharedScannerRuntime.setAdaptiveProfilePreset(nextProfile);
    await refreshData(
      nextAutoMode.mode,
      statusFilter,
      directionFilter,
      tickerQuery,
      nextAutoMode.default_min_score,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      nextProfile
    );
  };

  const handleToggleRegimeAdaptive = (enabled: boolean) => {
    setRegimeAdaptiveEnabled(enabled);
    refreshData(
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      enabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled: enabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleModeSwitch = (mode: ScannerModeId) => {
    const defaultMinScore =
      mode === 'accumulation_watch' ? 60 : mode === 'urgent_flow' ? 75 : 65;
    setSelectedMode(mode);
    setMinScoreFilter(defaultMinScore);
    refreshData(
      mode,
      statusFilter,
      directionFilter,
      tickerQuery,
      defaultMinScore,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode: mode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter: defaultMinScore,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleStatusChange = (nextStatus: string) => {
    setStatusFilter(nextStatus);
    refreshData(
      selectedMode,
      nextStatus,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode,
      statusFilter: nextStatus,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleDirectionChange = (nextDir: string) => {
    setDirectionFilter(nextDir);
    refreshData(
      selectedMode,
      statusFilter,
      nextDir,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode,
      statusFilter,
      directionFilter: nextDir,
      tickerQuery,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleTickerChange = (nextTicker: string) => {
    const bounded = nextTicker.slice(0, 16);
    setTickerQuery(bounded);
    refreshData(
      selectedMode,
      statusFilter,
      directionFilter,
      bounded,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery: bounded,
      minScoreFilter,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleMinScoreChange = (nextScore: number) => {
    setMinScoreFilter(nextScore);
    refreshData(
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      nextScore,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter: nextScore,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleEtfToggle = (nextEtf: boolean) => {
    setIncludeEtfs(nextEtf);
    refreshData(
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      nextEtf,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    persistSessionState({
      selectedMode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter,
      includeEtfs: nextEtf,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleResetFilters = () => {
    setStatusFilter('all');
    setDirectionFilter('all');
    setTickerQuery('');
    setMinScoreFilter(50);
    setIncludeEtfs(true);
    setRegimeAdaptiveEnabled(false);
    setSelectedSessionDate('latest');
    refreshData(
      selectedMode,
      'all',
      'all',
      '',
      50,
      true,
      false,
      activeTideRegime,
      activeAdaptiveProfile,
      'latest'
    );
    persistSessionState({
      selectedMode,
      statusFilter: 'all',
      directionFilter: 'all',
      tickerQuery: '',
      minScoreFilter: 50,
      includeEtfs: true,
      regimeAdaptiveEnabled: false,
      activeTideRegime,
      selectedCandidateId,
    });
  };

  const handleIngestPrint = async (payload: {
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
  }) => {
    let outcome: {
      accepted: boolean;
      deduplicated: boolean;
      event_id: string;
      reject_reasons: string[];
      candidate?: WhaleCandidate;
    };

    try {
      const res = await fetch('/api/pipeline/ingest-print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        outcome = await res.json();
      } else {
        outcome = sharedScannerRuntime.ingestOptionPrint(payload);
      }
    } catch {
      outcome = sharedScannerRuntime.ingestOptionPrint(payload);
    }

    await refreshData();
    if (outcome.candidate) {
      setSelectedCandidateId(outcome.candidate.candidate_id);
      setAllAcquiredCandidates((prev) => [
        outcome.candidate!,
        ...prev.filter(
          (c) => c.candidate_id !== outcome.candidate!.candidate_id
        ),
      ]);
    }

    if (auth.currentUser && auth.currentUser.emailVerified) {
      try {
        await logOptionPrintToFirestore({
          eventId: outcome.event_id,
          ticker: payload.ticker,
          optionSymbol: payload.option_symbol,
          optionType: payload.option_type,
          strike: payload.strike,
          dte: payload.dte,
          size: payload.size,
          price: payload.price,
          premium: Math.round(payload.size * payload.price * 100),
          side: payload.side,
          isSweep: payload.is_sweep,
          isMultiLeg: payload.is_multi_leg,
          spread: payload.spread,
          accepted: outcome.accepted,
          rejectReason: outcome.reject_reasons.join('; '),
        });
        if (outcome.candidate) {
          await syncCandidateToFirestore(outcome.candidate);
        }
      } catch {
        // Handled in firestoreSyncService
      }
    }

    return outcome;
  };

  const handleTriggerReconcile = async () => {
    try {
      await fetch('/api/pipeline/reconcile', { method: 'POST' });
    } catch {
      sharedScannerRuntime.triggerPostCloseReconciliation();
    }
    await refreshData();
  };

  const handleSyncAlpacaStockData = async () => {
    setSyncingAlpaca(true);
    try {
      const res = await fetch('/api/alpaca/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.telemetry) {
          setTelemetry(data.telemetry);
        }
      }
      await refreshData();
    } catch {
      // Handled gracefully
    } finally {
      setSyncingAlpaca(false);
    }
  };

  const handleSyncMarketClock = async () => {
    setSyncingMarketClock(true);
    try {
      const res = await fetch('/api/alpaca/clock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.telemetry) {
          setTelemetry(data.telemetry);
          return;
        }
        if (data.market_clock) {
          setTelemetry((prev) => ({
            ...prev,
            market_clock: data.market_clock,
          }));
          return;
        }
      }
    } catch {
      // Fallback to local runtime
    } finally {
      setSyncingMarketClock(false);
    }
    const clock = await sharedScannerRuntime.syncAlpacaMarketClock(true);
    setTelemetry((prev) => ({
      ...prev,
      market_clock: clock,
    }));
  };


  const handleSaveScanner = async (
    payload: Partial<ScannerConfig> & { name: string; mode: ScannerModeId }
  ): Promise<ScannerConfig> => {
    let updated: ScannerConfig;
    try {
      const res = await fetch('/api/v1/scanners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        updated = await res.json();
        const scRes = await fetch('/api/v1/scanners');
        if (scRes.ok) {
          const scData = await scRes.json();
          setScanners(scData.scanners ?? []);
        }
      } else {
        updated = sharedScannerRuntime.upsertScanner(payload);
        setScanners(sharedScannerRuntime.getScanners());
      }
    } catch {
      updated = sharedScannerRuntime.upsertScanner(payload);
      setScanners(sharedScannerRuntime.getScanners());
    }

    setMinScoreFilter(updated.min_whale_score);
    await refreshData(
      updated.mode,
      statusFilter,
      directionFilter,
      tickerQuery,
      updated.min_whale_score,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime
    );
    await persistSessionState({
      selectedMode: updated.mode,
      statusFilter,
      directionFilter,
      tickerQuery,
      minScoreFilter: updated.min_whale_score,
      includeEtfs,
      regimeAdaptiveEnabled,
      activeTideRegime,
      selectedCandidateId,
    });

    if (auth.currentUser && auth.currentUser.emailVerified) {
      try {
        await syncScannerConfigToFirestore(updated);
      } catch {
        // Handled in firestoreSyncService
      }
    }

    return updated;
  };

  const handleSaveLlmEngineConfig = async (
    payload: Partial<LlmEngineConfig>
  ): Promise<LlmEngineConfig> => {
    let updated: LlmEngineConfig;
    try {
      const res = await fetch('/api/settings/llm-engine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        updated =
          data.llm_engine_config ??
          sharedScannerRuntime.updateLlmEngineConfig(payload);
      } else {
        updated = sharedScannerRuntime.updateLlmEngineConfig(payload);
      }
    } catch {
      updated = sharedScannerRuntime.updateLlmEngineConfig(payload);
    }

    sharedScannerRuntime.updateLlmEngineConfig(updated);
    setLlmEngineConfig(updated);

    if (auth.currentUser && auth.currentUser.emailVerified) {
      try {
        await syncLlmEngineConfigToFirestore(updated);
      } catch {
        // Handled in firestoreSyncService
      }
    }

    await refreshData();
    return updated;
  };

  const handleRefreshApiLogs = async () => {
    try {
      const res = await fetch('/api/activity/api-logs');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          setTelemetry((prev) => ({
            ...prev,
            api_activity_logs: data.logs,
          }));
          return;
        }
      }
    } catch {
      // Fallback to local runtime
    }
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleTriggerApiProbe = async (
    simulateError: boolean,
    service?: string
  ): Promise<ApiActivityLogEntry | null> => {
    try {
      const res = await fetch('/api/activity/api-logs/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulate_error: simulateError,
          service: service ?? (simulateError ? 'lm_studio' : 'alpaca'),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          setTelemetry((prev) => ({
            ...prev,
            api_activity_logs: data.logs,
          }));
        }
        return data.entry ?? null;
      }
    } catch {
      // Fallback to local runtime
    }
    const localEntry = sharedScannerRuntime.recordApiActivity({
      direction: simulateError ? 'outbound_lm_studio' : 'outbound_alpaca',
      service: simulateError ? 'LM Studio LLM Engine' : 'Alpaca Market Data v2',
      method: simulateError ? 'POST' : 'GET',
      endpoint: simulateError
        ? `${llmEngineConfig.endpointUrl}/chat/completions`
        : 'https://data.alpaca.markets/v2/stocks/bars?symbols=NVDA,SPY&timeframe=5Min',
      status_code: simulateError ? 502 : 200,
      ok: !simulateError,
      latency_ms: simulateError ? 29 : 118,
      request_payload: JSON.stringify({ probe: true, simulateError }, null, 2),
      response_payload: JSON.stringify(
        simulateError
          ? { error: 'Simulated endpoint failure' }
          : { status: 'ok', bars_synced: 2400 },
        null,
        2
      ),
      error_message: simulateError
        ? 'HTTP 502 Bad Gateway — LM Studio server refused connection.'
        : null,
    });
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return localEntry;
  };

  const handleClearApiLogs = async () => {
    try {
      const res = await fetch('/api/activity/api-logs', { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          api_activity_logs: data.logs ?? [],
        }));
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.clearApiActivityLogs();
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleRefreshAiLogs = useCallback(async () => {
    const query =
      selectedSessionDate && selectedSessionDate !== 'latest'
        ? `?session_date=${encodeURIComponent(selectedSessionDate)}`
        : '';
    try {
      const [aiRes, telRes] = await Promise.all([
        fetch(`/api/activity/ai-logs${query}`),
        fetch(`/api/pipeline/telemetry${query}`),
      ]);
      if (telRes.ok) {
        const telData = await telRes.json();
        setTelemetry(telData);
        return;
      }
      if (aiRes.ok) {
        const data = await aiRes.json();
        if (Array.isArray(data.logs)) {
          setTelemetry((prev) => ({
            ...prev,
            ai_analysis_logs: data.logs,
          }));
          return;
        }
      }
    } catch {
      // Fallback
    }
    setTelemetry(sharedScannerRuntime.getTelemetryState(selectedSessionDate));
  }, [selectedSessionDate]);

  const handleAutoStartAiActivity = useCallback(
    async (triggerNewIfIdle = true) => {
      if (selectedSessionDate && selectedSessionDate !== 'latest') {
        return;
      }
      if (!isMarketOpen) {
        return;
      }
      try {
        const res = await fetch('/api/activity/ai-analysis/auto-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger_new_if_idle: triggerNewIfIdle }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.telemetry) {
            setTelemetry(data.telemetry);
          } else if (Array.isArray(data.logs)) {
            setTelemetry((prev) => ({
              ...prev,
              ai_analysis_logs: data.logs,
            }));
          }
          return;
        }
      } catch {
        // Fallback to local runtime
      }
      sharedScannerRuntime.startOrEnsureBackendAiActivity({
        trigger_new_if_idle: triggerNewIfIdle,
      });
      setTelemetry(sharedScannerRuntime.getTelemetryState());
    },
    [selectedSessionDate, isMarketOpen]
  );

  const handleRunAiAnalysis = async (params: {
    candidate_id?: string;
    ticker?: string;
    analysis_type?: AiAnalysisType;
    custom_instruction?: string;
    execution_mode?:
      | 'auto'
      | 'live_endpoint_only'
      | 'deterministic_synthesis'
      | 'simulate_error';
  }): Promise<AiAnalysisActivityEntry | null> => {
    try {
      const res = await fetch('/api/activity/ai-analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        await handleRefreshApiLogs();
        if (Array.isArray(data.logs)) {
          setTelemetry((prev) => ({
            ...prev,
            ai_analysis_logs: data.logs,
          }));
        }
        return data.entry ?? null;
      }
    } catch {
      // Fallback to local runtime
    }
    const entry = await sharedScannerRuntime.executeAiAnalysisForCandidate(
      params
    );
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return entry;
  };

  const handleClearAiLogs = async () => {
    try {
      const res = await fetch('/api/activity/ai-logs', { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          ai_analysis_logs: data.logs ?? [],
        }));
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.clearAiAnalysisLogs();
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleProcessPendingAiAnalyses = async (params?: {
    analysis_id?: string;
    candidate_id?: string;
    process_all?: boolean;
  }) => {
    try {
      const res = await fetch('/api/activity/ai-analysis/process-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params ?? {}),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.telemetry) {
          setTelemetry(data.telemetry);
        } else if (Array.isArray(data.logs)) {
          setTelemetry((prev) => ({
            ...prev,
            ai_analysis_logs: data.logs,
          }));
        }
        return;
      }
    } catch {
      // Fallback to local runtime
    }
    await sharedScannerRuntime.processPendingAiAnalyses(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleRefreshSmartOrderState = async () => {
    const query =
      selectedSessionDate && selectedSessionDate !== 'latest'
        ? `?session_date=${encodeURIComponent(selectedSessionDate)}`
        : '';
    try {
      const res = await fetch(`/api/orders/smart-engine/state${query}`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setSmartOrderConfig(data.config);
        }
        if (Array.isArray(data.tickets)) {
          setTelemetry((prev) => ({
            ...prev,
            smart_order_config: data.config ?? prev.smart_order_config,
            smart_order_tickets: data.tickets,
          }));
          return;
        }
      }
    } catch {
      // Fallback
    }
    setSmartOrderConfig(sharedScannerRuntime.getSmartOrderConfig());
    setTelemetry(sharedScannerRuntime.getTelemetryState(selectedSessionDate));
  };

  const handleSaveSmartOrderConfig = async (
    patch: Partial<SmartOrderEngineConfig>
  ): Promise<SmartOrderEngineConfig> => {
    try {
      const res = await fetch('/api/orders/smart-engine/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          sharedScannerRuntime.updateSmartOrderConfig(data.config);
          setSmartOrderConfig(data.config);
          return data.config;
        }
      }
    } catch {
      // Fallback
    }
    const updated = sharedScannerRuntime.updateSmartOrderConfig(patch);
    setSmartOrderConfig(updated);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return updated;
  };

  const handleExecuteSmartOrder = async (params: {
    candidate_id?: string;
    ticker?: string;
    side?: SmartOrderSide;
    qty?: number;
    algo?: SmartExecutionAlgoId;
    simulate_mode?:
      | 'auto_fill'
      | 'working_walk'
      | 'wide_spread_guard'
      | 'broker_reject';
    bid_override?: number;
    ask_override?: number;
    sync_live_alpaca?: boolean;
  }): Promise<SmartOrderExecutionTicket | null> => {
    try {
      const res = await fetch('/api/orders/smart-engine/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        await handleRefreshApiLogs();
        if (Array.isArray(data.tickets)) {
          setTelemetry((prev) => ({
            ...prev,
            smart_order_tickets: data.tickets,
            llm_decision_records:
              data.llm_decision_records ?? prev.llm_decision_records ?? [],
            ai_analysis_logs:
              data.ai_analysis_logs ?? prev.ai_analysis_logs ?? [],
          }));
        }
        return data.ticket ?? null;
      }
    } catch {
      // Fallback
    }
    const ticket = sharedScannerRuntime.executeSmartOrderForCandidate(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return ticket;
  };

  const handleAdvanceSmartOrderTicket = async (
    orderId: string,
    action: 'step_walk' | 'complete_at_fair_value' | 'cancel_order'
  ): Promise<SmartOrderExecutionTicket | null> => {
    try {
      const res = await fetch(
        `/api/orders/smart-engine/tickets/${encodeURIComponent(orderId)}/action`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tickets)) {
          setTelemetry((prev) => ({
            ...prev,
            smart_order_tickets: data.tickets,
          }));
        }
        return data.ticket ?? null;
      }
    } catch {
      // Fallback
    }
    const updated = sharedScannerRuntime.advanceSmartOrderTicket(
      orderId,
      action
    );
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return updated;
  };

  const handleClearSmartOrderTickets = async () => {
    try {
      const res = await fetch('/api/orders/smart-engine/tickets', {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          smart_order_tickets: data.tickets ?? [],
        }));
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.clearSmartOrderTickets();
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleEvaluateLlmDecision = async (params: {
    candidate_id?: string;
    stress_scenario?:
      | 'default'
      | 'force_execute_aligned'
      | 'force_watch_vwap'
      | 'force_skip_contradicted'
      | 'force_human_review_ambiguity';
    execution_mode?: 'auto' | 'live_endpoint_only' | 'deterministic_synthesis';
    auto_fulfill_smart_order?: boolean;
  }): Promise<LlmTradeDecisionRecord | null> => {
    try {
      const res = await fetch('/api/llm-decision-pipeline/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          llm_decision_records:
            data.records ?? prev.llm_decision_records ?? [],
          smart_order_tickets:
            data.smart_order_tickets ?? prev.smart_order_tickets ?? [],
          api_activity_logs:
            data.api_activity_logs ?? prev.api_activity_logs ?? [],
          ai_analysis_logs:
            data.ai_analysis_logs ?? prev.ai_analysis_logs ?? [],
        }));
        return data.record ?? null;
      }
    } catch {
      // Fallback
    }
    const fallbackRec =
      await sharedScannerRuntime.evaluateLlmTradeDecisionForCandidate(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return fallbackRec;
  };

  const handleRunStage2RiskAndFulfill = async (params: {
    decision_id: string;
    fulfill_smart_order?: boolean;
    client_raw_stage2_llm_content?: string | null;
  }): Promise<LlmTradeDecisionRecord | null> => {
    try {
      const res = await fetch('/api/llm-decision-pipeline/stage2-risk-fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          llm_decision_records:
            data.records ?? prev.llm_decision_records ?? [],
          smart_order_tickets:
            data.smart_order_tickets ?? prev.smart_order_tickets ?? [],
          api_activity_logs:
            data.api_activity_logs ?? prev.api_activity_logs ?? [],
          ai_analysis_logs:
            data.ai_analysis_logs ?? prev.ai_analysis_logs ?? [],
        }));
        return data.decision_record ?? null;
      }
    } catch {
      // Fallback
    }
    const { decision_record } =
      await sharedScannerRuntime.runStage2LlmRiskAssessmentAndFulfill(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return decision_record;
  };

  const handleApproveLlmDecision = async (params: {
    decision_id: string;
    action:
      | 'approve_and_stage_smart_order'
      | 'move_to_watchlist'
      | 'reject_decision';
  }): Promise<void> => {
    try {
      const res = await fetch('/api/llm-decision-pipeline/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          llm_decision_records:
            data.records ?? prev.llm_decision_records ?? [],
          smart_order_tickets:
            data.smart_order_tickets ?? prev.smart_order_tickets ?? [],
        }));
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.updateLlmTradeDecisionApproval(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleUpdateRiskPolicy = async (
    patch: Partial<RiskPolicyConfig>
  ): Promise<RiskPolicyConfig> => {
    try {
      const res = await fetch('/api/llm-decision-pipeline/risk-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.risk_policy_config) {
          sharedScannerRuntime.updateRiskPolicyConfig(data.risk_policy_config);
        }
        setTelemetry((prev) => ({
          ...prev,
          risk_policy_config:
            data.risk_policy_config ?? prev.risk_policy_config,
          llm_decision_records:
            data.records ?? prev.llm_decision_records ?? [],
        }));
        return (
          data.risk_policy_config ?? sharedScannerRuntime.getRiskPolicyConfig()
        );
      }
    } catch {
      // Fallback
    }
    const updated = sharedScannerRuntime.updateRiskPolicyConfig(patch);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return updated;
  };

  const handleRecalculateRiskForDecision = async (params: {
    decision_id: string;
    policy?: Partial<RiskPolicyConfig>;
    planned_entry_override?: number;
    contract_stop_override?: number;
  }): Promise<LlmTradeDecisionRecord | null> => {
    try {
      const res = await fetch('/api/llm-decision-pipeline/recalculate-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          risk_policy_config:
            data.risk_policy_config ?? prev.risk_policy_config,
          llm_decision_records:
            data.records ?? prev.llm_decision_records ?? [],
        }));
        return data.decision_record ?? null;
      }
    } catch {
      // Fallback
    }
    const updated =
      sharedScannerRuntime.recalculateRiskFirstExecutionForDecision(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    return updated;
  };

  const handleRefreshBacktestState = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest-learning/state');
      if (res.ok) {
        const data = await res.json();
        if (data.state) {
          setTelemetry((prev) => ({
            ...prev,
            self_learning_backtest: data.state,
          }));
          return;
        }
      }
    } catch {
      // Fallback to local runtime
    }
    const localState = sharedScannerRuntime.getSelfLearningBacktestState();
    setTelemetry((prev) => ({
      ...prev,
      self_learning_backtest: localState,
    }));
  }, []);

  const handleQueryDeepBacktestTelemetry = async (activityId: string) => {
    try {
      const res = await fetch('/api/backtest-learning/query-deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_id: activityId }),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          self_learning_backtest: data.state ?? prev.self_learning_backtest,
          api_activity_logs: data.api_activity_logs ?? prev.api_activity_logs,
        }));
        return;
      }
    } catch {
      // Fallback
    }
    await sharedScannerRuntime.queryDeepBacktestTelemetryForActivity(activityId);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleAnalyzeBacktestWithLlm = async (
    activityId: string,
    autoSynthesizeRule = true
  ) => {
    try {
      const res = await fetch('/api/backtest-learning/analyze-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_id: activityId,
          auto_synthesize_rule: autoSynthesizeRule,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          self_learning_backtest: data.state ?? prev.self_learning_backtest,
          api_activity_logs: data.api_activity_logs ?? prev.api_activity_logs,
          ai_analysis_logs: data.ai_analysis_logs ?? prev.ai_analysis_logs,
        }));
        return;
      }
    } catch {
      // Fallback
    }
    await sharedScannerRuntime.analyzeBacktestActivityWithLlm({
      activity_id: activityId,
      auto_synthesize_rule: autoSynthesizeRule,
    });
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleRunBatchBacktest = async (params: {
    include_executed?: boolean;
    include_dropped?: boolean;
    run_llm_analysis?: boolean;
    auto_synthesize_rules?: boolean;
  }) => {
    try {
      const res = await fetch('/api/backtest-learning/run-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          self_learning_backtest: data.state ?? prev.self_learning_backtest,
          api_activity_logs: data.api_activity_logs ?? prev.api_activity_logs,
          ai_analysis_logs: data.ai_analysis_logs ?? prev.ai_analysis_logs,
        }));
        return;
      }
    } catch {
      // Fallback
    }
    await sharedScannerRuntime.runBatchSelfLearningBacktest(params);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleToggleLearnedRule = async (ruleId: string, enabled?: boolean) => {
    try {
      const res = await fetch('/api/backtest-learning/rules/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_id: ruleId, enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          self_learning_backtest: data.state ?? prev.self_learning_backtest,
        }));
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.toggleLearnedConditionRule(ruleId, enabled);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleUpsertLearnedRule = async (
    rule: Partial<LearnedConditionRule> & {
      title: string;
      prompt_injection_instruction: string;
    }
  ) => {
    try {
      const res = await fetch('/api/backtest-learning/rules/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          self_learning_backtest: data.state ?? prev.self_learning_backtest,
        }));
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.upsertLearnedConditionRule(rule);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleReEvaluateWithLearnedRules = async (candidateId: string) => {
    await handleEvaluateCandidateLlm({
      candidate_id: candidateId,
      execution_mode: 'auto',
    });
    await handleRefreshBacktestState();
  };

  const handleRunAutoPipelineCycle = async (
    candidateId?: string,
    options?: { streamLiveTick?: boolean; silent?: boolean }
  ) => {
    if (!options?.silent) {
      setRunningAutoCycle(true);
      setAutoCycleNotice(null);
    }
    try {
      const res = await fetch('/api/pipeline/auto-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId,
          force_re_evaluate: !options?.silent,
          stream_live_tick: options?.streamLiveTick === true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
        }
        if (data.telemetry) {
          setTelemetry(data.telemetry);
        } else {
          setTelemetry((prev) => ({
            ...prev,
            automation_state: data.automation_state ?? prev.automation_state,
            llm_decision_records:
              data.records ?? prev.llm_decision_records ?? [],
            smart_order_tickets:
              data.smart_order_tickets ?? prev.smart_order_tickets ?? [],
            api_activity_logs:
              data.api_activity_logs ?? prev.api_activity_logs ?? [],
          }));
        }
        const latestRun = data.automation_state?.recent_runs?.[0];
        if (latestRun) {
          setAutoCycleNotice(latestRun.summary);
          setTimeout(() => setAutoCycleNotice(null), 9000);
        }
        setNextScanCountdownSec(
          data.automation_state?.scan_interval_seconds ?? 20
        );
        return;
      }
    } catch {
      // Fallback
    } finally {
      if (!options?.silent) {
        setRunningAutoCycle(false);
      }
    }
    if (options?.streamLiveTick) {
      await sharedScannerRuntime.ingestLiveMarketAndWhaleStream({
        injectDiscoverySweep: true,
      });
    }
    const localRes = await sharedScannerRuntime.runAutomatedPipelineCycle({
      candidate_id: candidateId,
      force_re_evaluate: !options?.silent,
    });
    await refreshData();
    setTelemetry(sharedScannerRuntime.getTelemetryState());
    if (localRes.automation_state.recent_runs[0]) {
      setAutoCycleNotice(localRes.automation_state.recent_runs[0].summary);
      setTimeout(() => setAutoCycleNotice(null), 9000);
    }
    setNextScanCountdownSec(
      localRes.automation_state.scan_interval_seconds ?? 20
    );
  };

  const handleStreamLiveTickAndAutoTrade = async () => {
    setRunningAutoCycle(true);
    setAutoCycleNotice(null);
    try {
      const res = await fetch('/api/pipeline/stream-live-tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inject_discovery_sweep: true }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.candidates)) {
          setCandidates(data.candidates);
          if (
            data.stream_result?.discovered_option_symbol &&
            data.candidates.length > 0
          ) {
            const discovered = data.candidates.find(
              (c: WhaleCandidate) =>
                c.option_symbol === data.stream_result.discovered_option_symbol
            );
            if (discovered) {
              setSelectedCandidateId(discovered.candidate_id);
            }
          }
        }
        if (data.telemetry) {
          setTelemetry(data.telemetry);
        } else {
          setTelemetry((prev) => ({
            ...prev,
            automation_state: data.automation_state ?? prev.automation_state,
            llm_decision_records:
              data.records ?? prev.llm_decision_records ?? [],
            smart_order_tickets:
              data.smart_order_tickets ?? prev.smart_order_tickets ?? [],
            api_activity_logs:
              data.api_activity_logs ?? prev.api_activity_logs ?? [],
          }));
        }
        const latestRun = data.automation_state?.recent_runs?.[0];
        if (latestRun) {
          setAutoCycleNotice(latestRun.summary);
          setTimeout(() => setAutoCycleNotice(null), 10000);
        }
        setNextScanCountdownSec(
          data.automation_state?.scan_interval_seconds ?? 20
        );
        return;
      }
    } catch {
      // Fallback to local runtime
    } finally {
      setRunningAutoCycle(false);
    }
    await handleRunAutoPipelineCycle(undefined, { streamLiveTick: true });
  };

  // Visual countdown indicator synced with the server-side background daemon (stopped when market is closed)
  useEffect(() => {
    const autoEnabled =
      telemetry.automation_state?.auto_pilot_enabled ?? true;
    const intervalSec =
      telemetry.automation_state?.scan_interval_seconds ?? 20;
    if (!autoEnabled || !isMarketOpen) return;

    const timer = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      setNextScanCountdownSec((prev) => {
        if (prev <= 1) {
          void refreshData();
          return intervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [
    telemetry.automation_state?.auto_pilot_enabled,
    telemetry.automation_state?.scan_interval_seconds,
    isMarketOpen,
    refreshData,
  ]);

  const handleToggleAutomationConfig = async (
    patch: Partial<
      Pick<
        AutomatedPipelineState,
        'auto_pilot_enabled' | 'auto_place_orders' | 'min_whale_score'
      >
    >
  ) => {
    try {
      const res = await fetch('/api/pipeline/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setTelemetry((prev) => ({
          ...prev,
          automation_state: data.automation_state ?? prev.automation_state,
        }));
        if (data.llm_engine_config) {
          setLlmEngineConfig(data.llm_engine_config);
        }
        return;
      }
    } catch {
      // Fallback
    }
    sharedScannerRuntime.updateAutomationConfig(patch);
    setTelemetry(sharedScannerRuntime.getTelemetryState());
  };

  const handleSimulateRepeatPrintOnContract = async (
    target?: WhaleCandidate | null
  ) => {
    const cand = target ?? selectedCandidate ?? candidates[0];
    if (!cand) return;
    const prevMaxPrice =
      cand.aggregation?.max_fill_price ??
      Math.max(1.5, Number((cand.strike * 0.042).toFixed(2)));
    const nextPrice = Number((prevMaxPrice + 0.18).toFixed(2));
    const nextSize = 350;
    const res = await handleIngestPrint({
      ticker: cand.ticker,
      option_symbol: cand.option_symbol,
      option_type: cand.option_type,
      strike: cand.strike,
      expiry: cand.expiry,
      dte: cand.dte,
      size: nextSize,
      price: nextPrice,
      side: cand.direction === 'bullish' ? 'ask' : 'ask',
      is_sweep: true,
      is_multi_leg: false,
      spread: cand.flow.spread,
      open_interest: cand.flow.open_interest,
      volume: cand.flow.volume + nextSize,
      underlying_price: Number(
        (
          cand.underlying.price_at_detection *
          (cand.direction === 'bullish' ? 1.0025 : 0.9975)
        ).toFixed(2)
      ),
      return_5m: cand.underlying.return_5m,
      relative_volume_5m: cand.underlying.relative_volume_5m,
      vwap_aligned: cand.underlying.vwap_aligned,
      avg_daily_dollar_volume: cand.underlying.avg_daily_dollar_volume,
      issue_type: cand.issue_type,
      flow_alert_rules: cand.flow.flow_alert_rules,
      event_id: `uw-agg-${cand.ticker.toLowerCase()}-${Date.now().toString(36).slice(-4)}`,
    });
    if (res.candidate?.aggregation) {
      setAutoCycleNotice(res.candidate.aggregation.aggregation_summary);
      setTimeout(() => setAutoCycleNotice(null), 9000);
    }
  };

  const selectedCandidate =
    candidates.find((c) => c.candidate_id === selectedCandidateId) ??
    candidates[0] ??
    null;

  const confirmedCount = candidates.filter(
    (c) => c.status === 'confirmed'
  ).length;
  const total5mFlow = candidates.reduce((acc, c) => acc + c.flow.premium_5m, 0);
  const automationState =
    telemetry.automation_state ?? sharedScannerRuntime.getAutomationState();

  const [aiGateCombinedMode, setAiGateCombinedMode] = useState<boolean>(false);
  const [portfolioCombinedMode, setPortfolioCombinedMode] =
    useState<boolean>(false);
  const [regimeCombinedMode, setRegimeCombinedMode] = useState<boolean>(true);

  const aiLogsList =
    telemetry.ai_analysis_logs ?? sharedScannerRuntime.getAiAnalysisLogs();
  const processingAiCount = aiLogsList.filter(
    (l) => l.status === 'processing'
  ).length;
  const pendingAiCount = aiLogsList.filter(
    (l) => l.status === 'pending'
  ).length;
  const totalAiAnalysisTimeMs = aiLogsList.reduce(
    (sum, l) => sum + Math.max(0, l.latency_ms),
    0
  );
  const llmRecordsList =
    telemetry.llm_decision_records ??
    sharedScannerRuntime.getLlmTradeDecisionRecords();
  const smartTicketsList =
    telemetry.smart_order_tickets ??
    sharedScannerRuntime.getSmartOrderTickets();

  const isFlowDiscoveryStage =
    activeSection === 'scanner' || activeSection === 'pipeline';
  const isMarketTideStage =
    activeSection === 'market_tide' || activeSection === 'regime_strategy';
  const isAiGateStage =
    activeSection === 'ai_analysis' || activeSection === 'llm_decision_gate';
  const isExecutionStage = activeSection === 'smart_order';
  const isHoldingsStage = activeSection === 'holdings_monitor';
  const isAccountOverviewStage = activeSection === 'alpaca_account';
  const isPortfolioStage = isHoldingsStage || isAccountOverviewStage;
  const isBacktestLearningStage = activeSection === 'backtest_learning';
  const isSettingsStage = activeSection === 'config';
  const isApiMonitorStage = activeSection === 'api_activity';
  const apiLogsList =
    telemetry.api_activity_logs ?? sharedScannerRuntime.getApiActivityLogs();
  const backtestLearningState =
    telemetry.self_learning_backtest ??
    sharedScannerRuntime.getSelfLearningBacktestState();

  // Auto-start backend AI analysis activity when opening the 2. AI Decision Gate page (only when market is open)
  useEffect(() => {
    if (!isAiGateStage || !isMarketOpen) return;
    void handleAutoStartAiActivity(true);
    const pollTimer = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      void refreshData();
    }, 1500);
    return () => clearInterval(pollTimer);
  }, [isAiGateStage, isMarketOpen, handleAutoStartAiActivity, refreshData]);

  // If on AI Decision Gate page and pending items appear while worker slots are available, ensure backend worker drains them (only when market is open)
  const configuredConcurrency = Math.max(
    1,
    llmEngineConfig.concurrentAnalyses ?? 3
  );
  useEffect(() => {
    if (!isAiGateStage || !isMarketOpen) return;
    if (processingAiCount < configuredConcurrency && pendingAiCount > 0) {
      void handleAutoStartAiActivity(false);
    }
  }, [
    isAiGateStage,
    isMarketOpen,
    processingAiCount,
    configuredConcurrency,
    pendingAiCount,
    handleAutoStartAiActivity,
  ]);

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract (Workflow Stages + Market Tide + Account Overview + API Monitor & Settings) */}
      <header className="flex flex-wrap xl:flex-nowrap items-center justify-between gap-2.5 px-4 py-3 border-b border-slate-800 bg-[#0B0F17]">
        <a
          href="#scanner"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('scanner');
          }}
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          WhalePulse
        </a>

        <nav
          aria-label="Primary Navigation"
          className="order-3 xl:order-2 w-full xl:w-auto flex flex-wrap xl:flex-nowrap items-center justify-start xl:justify-center gap-x-2.5 gap-y-1.5 text-xs font-medium text-slate-400 pt-2 xl:pt-0 border-t xl:border-t-0 border-slate-800/70"
        >
          <a
            href="#scanner"
            onClick={(e) => {
              e.preventDefault();
              setCandidateDetailChartOpen(false);
              setActiveSection('scanner');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isFlowDiscoveryStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            1. Flow Discovery
          </a>
          <a
            href="#market-tide"
            onClick={(e) => {
              e.preventDefault();
              setRegimeCombinedMode(false);
              setActiveSection('market_tide');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isMarketTideStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            Market Tide
          </a>
          <a
            href="#ai-analysis"
            onClick={(e) => {
              e.preventDefault();
              void handleAutoStartAiActivity(true);
              setActiveSection('ai_analysis');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isAiGateStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            2. AI Decision Gate
          </a>
          <a
            href="#smart-order"
            onClick={(e) => {
              e.preventDefault();
              handleRefreshSmartOrderState();
              setActiveSection('smart_order');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isExecutionStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            3. Smart Execution
          </a>
          <a
            href="#holdings-monitor"
            onClick={(e) => {
              e.preventDefault();
              setPortfolioCombinedMode(false);
              setActiveSection('holdings_monitor');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isHoldingsStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            4. Portfolio &amp; Exits
          </a>
          <a
            href="#bake-test"
            data-testid="nav-bake-test-learning"
            onClick={(e) => {
              e.preventDefault();
              void handleRefreshBacktestState();
              setActiveSection('backtest_learning');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isBacktestLearningStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            5. Bake Test &amp; Learning
          </a>
          <a
            href="#alpaca-account"
            onClick={(e) => {
              e.preventDefault();
              setPortfolioCombinedMode(false);
              setActiveSection('alpaca_account');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isAccountOverviewStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            Account Overview
          </a>
          <a
            href="#api-activity"
            onClick={(e) => {
              e.preventDefault();
              handleRefreshApiLogs();
              setActiveSection('api_activity');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isApiMonitorStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            API Monitor ({apiLogsList.length})
          </a>
          <a
            href="#config"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('config');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              isSettingsStage
                ? 'text-slate-100 border-sky-400 font-semibold'
                : 'border-transparent'
            }`}
          >
            Settings
          </a>
        </nav>

        <div className="order-2 xl:order-3 flex flex-wrap xl:flex-nowrap items-center gap-1.5 shrink-0">
          {/* Alpaca Market Clock Status Indicator (/v2/clock) */}
          <button
            type="button"
            data-testid="header-market-status-indicator"
            onClick={() => void handleSyncMarketClock()}
            disabled={syncingMarketClock}
            title={
              marketClock.halt_reason ??
              `Alpaca Clock API (${marketClock.endpoint}) · ${marketClock.phase_label} · Click to refresh`
            }
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 ${
              isMarketOpen
                ? 'border-emerald-500/50 bg-emerald-950/35 text-emerald-300 hover:bg-emerald-900/45'
                : 'border-amber-500/50 bg-amber-950/35 text-amber-200 hover:bg-amber-900/45'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                isMarketOpen
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-amber-400'
              }`}
            />
            <span
              data-testid="header-market-status-label"
              className="font-bold tracking-tight"
            >
              {marketClock.status_label}
            </span>
            <span className="hidden 2xl:inline text-[10px] text-slate-300 border-l border-slate-700/80 pl-1.5">
              {isMarketOpen
                ? `Closes ${marketClock.next_close_formatted}`
                : `Stopped · Opens ${marketClock.next_open_formatted}`}
            </span>
            <span className="hidden sm:inline 2xl:hidden text-[10px] text-slate-300 border-l border-slate-700/80 pl-1.5">
              {isMarketOpen ? 'RTH Live' : 'Stopped'}
            </span>
            <RefreshCw
              className={`w-3 h-3 opacity-75 ${
                syncingMarketClock ? 'animate-spin' : ''
              }`}
            />
          </button>

          <HistoricalDateCalendarPicker
            selectedSessionDate={selectedSessionDate}
            latestSessionDate={
              availableSessions.find((s) => s.is_latest)?.date ?? '2026-10-21'
            }
            availableSessions={availableSessions}
            onSelectSessionDate={handleSelectSessionDate}
            compact
          />
          <button
            type="button"
            data-testid="header-auto-scan-execute-btn"
            disabled={runningAutoCycle || !isMarketOpen}
            onClick={() => handleRunAutoPipelineCycle()}
            title={
              !isMarketOpen
                ? `Stopped: ${marketClock.status_label} (${marketClock.phase_label}) · Opens ${marketClock.next_open_formatted}`
                : 'Run Automated Pipeline Scan & Execution'
            }
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Zap className="w-3 h-3" />
            <span>
              {runningAutoCycle
                ? 'Executing...'
                : !isMarketOpen
                  ? 'Halted'
                  : 'Auto-Scan'}
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 md:px-6 py-4 space-y-4">
        {selectedSessionDate !== 'latest' && (
          <div
            role="region"
            aria-label="Historical Session Time Machine Banner"
            data-testid="historical-session-active-banner"
            className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-200"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-500/25 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-amber-300 border border-amber-500/40">
                Historical Archive Mode
              </span>
              <span>
                Inspecting trading session{' '}
                <strong className="font-mono text-white">
                  {selectedSessionDate}
                </strong>{' '}
                across Flow Discovery ({candidates.length} candidates), Market Tide, AI Decision Gate ({aiLogsList.length} logs), and Smart Execution ({smartTicketsList.length} orders).
              </span>
            </div>
            <button
              type="button"
              data-testid="banner-return-latest-btn"
              onClick={() => handleSelectSessionDate('latest')}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>
                Return to Latest Live Session (
                {availableSessions.find((s) => s.is_latest)?.date ?? '2026-10-21'}
                )
              </span>
            </button>
          </div>
        )}
        {/* End-to-End Trading Workflow Pipeline Bar (Compact 4-Stage Stepper) */}
        <section
          aria-label="Trading Workflow Pipeline"
          data-testid="workflow-pipeline-bar"
          className="rounded-lg border border-slate-800 bg-[#111726] p-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pb-2 border-b border-slate-800/80">
            <div className="flex flex-wrap items-center gap-2 text-slate-300">
              <span className="font-semibold text-slate-100">
                End-to-End Trading Workflow:
              </span>
              <span className="text-slate-400">
                Unusual Whales Flow Discovery → Stage-1/2 AI Decision Gate → NBBO Smart Execution → Portfolio &amp; AI Exit Plans
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono text-slate-400">
              <span>
                LM Studio:{' '}
                <strong className="text-slate-200">
                  {llmEngineConfig.modelId || 'qwen3-32b-instruct@q4_k_m'}
                </strong>{' '}
                <span className="text-sky-400">
                  ({llmEngineConfig.thinkingMode ?? 'no_think'} ·{' '}
                  {llmEngineConfig.concurrentAnalyses ?? 3}x Workers)
                </span>
              </span>
              <span>·</span>
              <span className="text-emerald-400 tabular-nums">
                {automationState.total_orders_placed} Auto-Orders
              </span>
              <span>·</span>
              <button
                type="button"
                onClick={() => {
                  setRegimeCombinedMode(false);
                  setActiveSection('market_tide');
                }}
                className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                Market Tide →
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => {
                  setPortfolioCombinedMode(false);
                  setActiveSection('alpaca_account');
                }}
                className="text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline"
              >
                Account Overview (P/L) →
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => {
                  handleRefreshApiLogs();
                  setActiveSection('api_activity');
                }}
                className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                API Usage ({apiLogsList.length}) →
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => setActiveSection('config')}
                className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
              >
                Settings →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {/* Stage 1 Card: Flow Discovery */}
            <button
              type="button"
              aria-pressed={isFlowDiscoveryStage}
              onClick={() => {
                setCandidateDetailChartOpen(false);
                setActiveSection('scanner');
              }}
              className={`text-left px-3 py-2.5 rounded-md border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isFlowDiscoveryStage
                  ? 'border-sky-400 bg-sky-950/25'
                  : 'border-slate-800 bg-[#0B0F17]/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100 whitespace-nowrap">
                  01. Flow Discovery
                </span>
                <span className="text-[11px] font-mono tabular-nums text-sky-400 whitespace-nowrap">
                  {candidates.length} Cand · ${(total5mFlow / 1_000_000).toFixed(1)}M
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-1 truncate">
                {REGIME_SHORT_LABELS[telemetry.market_tide.regime]} (z=
                {telemetry.market_tide.tide_zscore >= 0 ? '+' : ''}
                {telemetry.market_tide.tide_zscore.toFixed(2)}) · {confirmedCount} Confirmed
              </div>
            </button>

            {/* Stage 2 Card: AI Decision Gate */}
            <button
              type="button"
              aria-pressed={isAiGateStage}
              onClick={() => {
                void handleAutoStartAiActivity(true);
                setActiveSection('ai_analysis');
              }}
              className={`text-left px-3 py-2.5 rounded-md border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isAiGateStage
                  ? 'border-sky-400 bg-sky-950/25'
                  : 'border-slate-800 bg-[#0B0F17]/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100 whitespace-nowrap">
                  02. AI Decision Gate
                </span>
                <span className="text-[11px] font-mono tabular-nums text-sky-300 whitespace-nowrap">
                  {processingAiCount} Proc · {pendingAiCount} Pend
                </span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1 truncate">
                {aiLogsList.length} AI Activity · Total:{' '}
                {(totalAiAnalysisTimeMs / 1000).toFixed(2)}s
              </div>
            </button>

            {/* Stage 3 Card: Smart Execution */}
            <button
              type="button"
              aria-pressed={isExecutionStage}
              onClick={() => {
                handleRefreshSmartOrderState();
                setActiveSection('smart_order');
              }}
              className={`text-left px-3 py-2.5 rounded-md border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isExecutionStage
                  ? 'border-sky-400 bg-sky-950/25'
                  : 'border-slate-800 bg-[#0B0F17]/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100 whitespace-nowrap">
                  03. Smart Execution
                </span>
                <span className="text-[11px] font-mono tabular-nums text-emerald-400 whitespace-nowrap">
                  {automationState.total_orders_placed} Auto-Orders
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-1 truncate">
                NBBO Microprice · Delta-Peg · {smartTicketsList.length} Tickets
              </div>
            </button>

            {/* Stage 4 Card: Portfolio & Exits */}
            <button
              type="button"
              aria-pressed={isPortfolioStage}
              onClick={() => setActiveSection('holdings_monitor')}
              className={`text-left px-3 py-2.5 rounded-md border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isPortfolioStage
                  ? 'border-sky-400 bg-sky-950/25'
                  : 'border-slate-800 bg-[#0B0F17]/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100 whitespace-nowrap">
                  04. Portfolio &amp; Exits
                </span>
                <span className="text-[11px] font-mono tabular-nums text-emerald-400 whitespace-nowrap">
                  {telemetry.alpaca_status?.connected
                    ? 'Alpaca Live'
                    : 'Alpaca Paper'}
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-1 truncate">
                Holdings &amp; AI Exit Plans · Equity &amp; FIFO Ledger
              </div>
            </button>

            {/* Stage 5 Card: Bake Test & Self-Learning */}
            <button
              type="button"
              aria-pressed={isBacktestLearningStage}
              data-testid="workflow-card-bake-test"
              onClick={() => {
                void handleRefreshBacktestState();
                setActiveSection('backtest_learning');
              }}
              className={`text-left px-3 py-2.5 rounded-md border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                isBacktestLearningStage
                  ? 'border-sky-400 bg-sky-950/25'
                  : 'border-slate-800 bg-[#0B0F17]/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100 whitespace-nowrap">
                  05. Bake Test &amp; Learn
                </span>
                <span className="text-[11px] font-mono tabular-nums text-emerald-400 whitespace-nowrap">
                  {(
                    backtestLearningState.summary
                      .projected_learned_win_rate_pct ?? 0
                  ).toFixed(1)}
                  % WinProj
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-400 mt-1 truncate">
                {backtestLearningState.summary.total_activities_collected} Audited ·{' '}
                {backtestLearningState.summary.active_learned_rules_count} Active AI Rules
              </div>
            </button>
          </div>
        </section>

        {/* WORKFLOW STAGE 1: FLOW DISCOVERY, MARKET REGIME & LIVE OPTION TAPE */}
        {isFlowDiscoveryStage && (
          <section
            aria-label="Scanner Telemetry Summary"
            className="p-3 rounded-lg border border-slate-800 bg-[#111726] space-y-2.5"
          >
            {/* Row 1: Step 1 Workspace Sub-Tabs + Live Telemetry + Auto-Pilot Actions */}
            <div
              data-testid="live-background-daemon-bar"
              className="flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] rounded-md border border-slate-800/80">
                <button
                  type="button"
                  data-testid="flow-discovery-table-view-btn"
                  onClick={() => {
                    setCandidateDetailChartOpen(false);
                    setActiveSection('scanner');
                  }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'scanner' && !candidateDetailChartOpen
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Whale Candidates ({candidates.length})
                </button>
                <button
                  type="button"
                  data-testid="flow-discovery-detail-chart-tab-btn"
                  onClick={() => {
                    setActiveSection('scanner');
                    setCandidateDetailChartOpen(true);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'scanner' && candidateDetailChartOpen
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>
                    Option Price &amp; Event Chart (
                    {selectedCandidate?.ticker ?? 'NVDA'})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCandidateDetailChartOpen(false);
                    setActiveSection('market_tide');
                  }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'market_tide' ||
                    activeSection === 'regime_strategy'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Market Tide &amp; Regime Strategy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCandidateDetailChartOpen(false);
                    setActiveSection('pipeline');
                  }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'pipeline'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Live Option Tape ({telemetry.seen_event_count})
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400 hidden xl:inline">
                  Auto-Pilot:{' '}
                  <strong
                    data-testid="daemon-autopilot-status-text"
                    className={
                      !isMarketOpen
                        ? 'text-amber-400'
                        : automationState.auto_pilot_enabled
                          ? 'text-emerald-400'
                          : 'text-slate-400'
                    }
                  >
                    {!isMarketOpen
                      ? 'STOPPED (MARKET CLOSED)'
                      : automationState.auto_pilot_enabled
                        ? 'ACTIVE'
                        : 'PAUSED'}
                  </strong>{' '}
                  (
                  <span
                    data-testid="daemon-total-orders-placed"
                    className="text-emerald-400 tabular-nums"
                  >
                    {automationState.total_orders_placed}
                  </span>{' '}
                  orders
                  {isMarketOpen ? ` · ${nextScanCountdownSec}s` : ' · Halted After Close'})
                </span>

                <button
                  type="button"
                  onClick={handleSyncAlpacaStockData}
                  disabled={syncingAlpaca}
                  aria-label="Sync Live Alpaca Stock Data"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#0B0F17] border border-slate-700 text-xs font-mono text-sky-400 hover:text-sky-300 whitespace-nowrap"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${syncingAlpaca ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {syncingAlpaca
                      ? 'Syncing...'
                      : `Alpaca SIP (${telemetry.alpaca_status?.synced_tickers.length ?? 0})`}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="simulate-repeat-contract-print-btn"
                  onClick={() =>
                    handleSimulateRepeatPrintOnContract(selectedCandidate)
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-sky-500/50 bg-sky-950/40 hover:bg-sky-900/50 text-sky-300 transition-colors whitespace-nowrap shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>
                    Repeat Print ({selectedCandidate?.ticker ?? 'NVDA'})
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="stream-live-tick-auto-trade-btn"
                  disabled={runningAutoCycle || !isMarketOpen}
                  onClick={handleStreamLiveTickAndAutoTrade}
                  title={
                    !isMarketOpen
                      ? `Stopped: ${marketClock.status_label} (${marketClock.phase_label})`
                      : 'Stream Live Tick & Auto-Trade'
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-emerald-500/60 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Radio className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Stream Live Tick</span>
                </button>

                <button
                  type="button"
                  data-testid="scanner-run-auto-pipeline-btn"
                  disabled={runningAutoCycle || !isMarketOpen}
                  onClick={() => handleRunAutoPipelineCycle()}
                  title={
                    !isMarketOpen
                      ? `Stopped: ${marketClock.status_label} (${marketClock.phase_label})`
                      : 'Scan & Execute Now'
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    {runningAutoCycle
                      ? 'Running...'
                      : !isMarketOpen
                        ? 'Stopped (Market Closed)'
                        : 'Scan & Execute Now'}
                  </span>
                </button>
              </div>
            </div>

            {autoCycleNotice && (
              <div
                role="status"
                data-testid="auto-cycle-status-banner"
                className="p-2 rounded bg-emerald-950/40 border border-emerald-700/70 text-xs font-mono text-emerald-200 flex flex-wrap items-center justify-between gap-2"
              >
                <span>{autoCycleNotice}</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveSection('llm_decision_gate')}
                    className="text-sky-300 hover:underline"
                  >
                    Step 2: AI Decision Gate →
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleRefreshSmartOrderState();
                      setActiveSection('smart_order');
                    }}
                    className="text-emerald-300 hover:underline"
                  >
                    Step 3: Smart Order Ticket →
                  </button>
                </div>
              </div>
            )}

            {/* Row 2 (Only on Whale Scanner tab): Unified Regime Profile + Candidate Filters */}
            {activeSection === 'scanner' && (
              <div
                data-testid="auto-scanner-mode-banner"
                className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label="Filter by Candidate Status"
                    className="flex flex-wrap items-center gap-1 p-0.5 bg-[#0B0F17] rounded-md border border-slate-800/80"
                  >
                    {(
                      [
                        { value: 'all', label: 'All' },
                        { value: 'confirmed', label: 'Confirmed' },
                        {
                          value: 'needs_confirmation',
                          label: 'Unconfirmed',
                        },
                      ] as const
                    ).map((st) => (
                      <button
                        key={st.value}
                        type="button"
                        onClick={() => handleStatusChange(st.value)}
                        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                          statusFilter === st.value
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>

                  <div
                    role="group"
                    aria-label="Filter by Flow Direction"
                    className="flex flex-wrap items-center gap-1 p-0.5 bg-[#0B0F17] rounded-md border border-slate-800/80"
                  >
                    {(
                      [
                        { value: 'all', label: 'All Dir' },
                        { value: 'bullish', label: 'Bullish' },
                        { value: 'bearish', label: 'Bearish' },
                      ] as const
                    ).map((dir) => (
                      <button
                        key={dir.value}
                        type="button"
                        onClick={() => handleDirectionChange(dir.value)}
                        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                          directionFilter === dir.value
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {dir.label}
                      </button>
                    ))}
                  </div>

                  <span className="text-xs font-mono text-slate-400 hidden lg:inline">
                    Mode:{' '}
                    <strong
                      data-testid="auto-scanner-mode-badge"
                      className="text-sky-300"
                    >
                      {autoScannerResolution.mode_label}
                    </strong>{' '}
                    · Profile:{' '}
                    <strong className="text-sky-400">
                      {activeAdaptiveSpec.profile}
                    </strong>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      maxLength={16}
                      aria-label="Filter by Ticker"
                      placeholder="Filter ticker (e.g. NVDA)"
                      value={tickerQuery}
                      onChange={(e) => handleTickerChange(e.target.value)}
                      className="pl-7 pr-2.5 py-1 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 w-40"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <label htmlFor="min-score-range" className="text-slate-400">
                      Min Score:
                    </label>
                    <input
                      id="min-score-range"
                      type="range"
                      min={50}
                      max={95}
                      step={5}
                      value={minScoreFilter}
                      onChange={(e) =>
                        handleMinScoreChange(Number(e.target.value))
                      }
                      className="w-20 accent-sky-400"
                    />
                    <span className="font-mono font-semibold text-sky-400 w-5">
                      {minScoreFilter}
                    </span>
                  </div>

                  <label className="inline-flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeEtfs}
                      onChange={(e) => handleEtfToggle(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900"
                    />
                    <span>ETFs</span>
                  </label>

                  <label className="inline-flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regimeAdaptiveEnabled}
                      onChange={(e) =>
                        handleToggleRegimeAdaptive(e.target.checked)
                      }
                      className="rounded border-slate-700 bg-slate-900 accent-sky-400"
                    />
                    <span>Regime Filter</span>
                  </label>
                </div>
              </div>
            )}
          </section>
        )}

        {/* View 1A: Live Whale-Activity Scanner (Immediate Candidate Table & Inspector OR Candidate Detail Event Chart) */}
        {activeSection === 'scanner' && (
          <div className="space-y-4">
            {candidateDetailChartOpen && selectedCandidate ? (
              <CandidateDetailChartView
                candidate={selectedCandidate}
                allCandidates={candidates}
                marketTide={telemetry.market_tide}
                aiLogs={aiLogsList}
                llmDecisionRecords={llmRecordsList}
                smartOrderTickets={smartTicketsList}
                onSelectCandidate={(candId) => {
                  setSelectedCandidateId(candId);
                  persistSessionState({
                    selectedMode,
                    statusFilter,
                    directionFilter,
                    tickerQuery,
                    minScoreFilter,
                    includeEtfs,
                    regimeAdaptiveEnabled,
                    activeTideRegime,
                    selectedCandidateId: candId,
                  });
                }}
                onBackToTable={() => setCandidateDetailChartOpen(false)}
                onSimulateRepeatPrint={(cand) =>
                  handleSimulateRepeatPrintOnContract(cand)
                }
                onRunAiDecisionGate={async (cand) => {
                  await handleEvaluateLlmDecision({
                    candidate_id: cand.candidate_id,
                    stress_scenario: 'default',
                    execution_mode: 'auto',
                  });
                  setActiveSection('llm_decision_gate');
                }}
                onStageSmartOrder={(cand) => {
                  setPreselectedSmartOrderCandidateId(cand.candidate_id);
                  handleRefreshSmartOrderState();
                  setActiveSection('smart_order');
                }}
                onOpenRegimeStrategy={(cand) => {
                  setSelectedCandidateId(cand.candidate_id);
                  setActiveSection('regime_strategy');
                }}
              />
            ) : (
            /* Main 12-Col Split: Candidate Table (8 cols) + Candidate Inspector (4 cols) */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <section
                aria-label="Ranked Whale Candidates"
                className="lg:col-span-8 border border-slate-800 bg-[#111726] rounded-lg overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
                  <div>
                    <h1 className="text-sm font-semibold text-slate-100">
                      Deduplicated WhaleCandidate Clusters
                    </h1>
                    <p className="text-xs text-slate-400">
                      Active Profile:{' '}
                      <span className="font-mono text-sky-400">
                        {activeAdaptiveSpec.profile}
                      </span>{' '}
                      ({activeAdaptiveSpec.market_regime}) ·{' '}
                      <span className="text-sky-300">
                        Click any row to inspect in side panel · Use side panel Chart button for full timeline
                      </span>
                    </p>
                  </div>
                  <div className="text-right font-mono tabular-nums whitespace-nowrap shrink-0">
                    <div className="text-xs text-slate-300">
                      {candidates.length} candidates
                    </div>
                    <div
                      data-testid="flow-discovery-last-scan-timestamp"
                      className="text-[10px] text-slate-400"
                    >
                      Scan{' '}
                      {formatEtTimeString(
                        telemetry.last_saved_at
                          ? Date.parse(telemetry.last_saved_at)
                          : Date.now()
                      )}
                    </div>
                  </div>
                </div>

                {candidates.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <p className="text-sm text-slate-300 font-medium">
                      No option flow candidates match the active regime &amp;
                      filter thresholds.
                    </p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Try switching the Market Tide regime, unchecking
                      regime-specific threshold enforcement, or resetting the
                      active filters.
                    </p>
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Filters</span>
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 bg-[#0B0F17]/60 whitespace-nowrap text-[11px]">
                          <th className="py-2 px-2 font-medium">
                            Ticker / Contract
                          </th>
                          <th className="py-2 px-1.5 font-medium">
                            Timestamp (ET)
                          </th>
                          <th className="py-2 px-1.5 font-medium">Direction</th>
                          <th className="py-2 px-1.5 font-medium text-right">
                            5m Prem
                          </th>
                          <th className="py-2 px-1.5 font-medium text-right">
                            Vol / OI
                          </th>
                          <th className="py-2 px-1.5 font-medium">
                            5m Candle Status
                          </th>
                          <th className="py-2 px-2 font-medium text-right">
                            Score
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {candidates.map((cand, idx) => {
                          const isSelected =
                            cand.candidate_id ===
                            selectedCandidate?.candidate_id;
                          const isBull = cand.direction === 'bullish';
                          const tsSummary =
                            formatCandidateTimestampSummary(cand);
                          return (
                            <tr
                              key={cand.candidate_id}
                              tabIndex={0}
                              data-testid={`whale-candidate-row-${cand.ticker}`}
                              onClick={() => {
                                setSelectedCandidateId(cand.candidate_id);
                                persistSessionState({
                                  selectedMode,
                                  statusFilter,
                                  directionFilter,
                                  tickerQuery,
                                  minScoreFilter,
                                  includeEtfs,
                                  regimeAdaptiveEnabled,
                                  activeTideRegime,
                                  selectedCandidateId: cand.candidate_id,
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedCandidateId(cand.candidate_id);
                                } else if (
                                  e.key === 'ArrowDown' &&
                                  idx + 1 < candidates.length
                                ) {
                                  e.preventDefault();
                                  setSelectedCandidateId(
                                    candidates[idx + 1].candidate_id
                                  );
                                } else if (e.key === 'ArrowUp' && idx > 0) {
                                  e.preventDefault();
                                  setSelectedCandidateId(
                                    candidates[idx - 1].candidate_id
                                  );
                                }
                              }}
                              aria-selected={isSelected}
                              className={`cursor-pointer transition-colors whitespace-nowrap border-l-2 focus-visible:outline-none focus-visible:bg-sky-950/45 ${
                                isSelected
                                  ? 'bg-sky-950/35 hover:bg-sky-950/45 border-l-sky-400'
                                  : 'hover:bg-slate-800/40 border-l-transparent'
                              }`}
                            >
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-1">
                                  <span className="font-bold font-mono text-slate-100">
                                    {cand.ticker}
                                  </span>
                                  <span className="text-slate-500">·</span>
                                  <span className="font-mono text-slate-300">
                                    ${cand.strike}
                                    {cand.option_type === 'call' ? 'C' : 'P'}
                                  </span>
                                  <span className="text-slate-500">·</span>
                                  <span className="font-mono text-slate-400">
                                    {cand.dte}d
                                  </span>
                                </div>
                                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                                  {cand.option_symbol}
                                </div>
                                {cand.aggregation && (
                                  <div className="text-[10px] font-mono text-sky-400 mt-0.5">
                                    {cand.aggregation.aggregated_print_count}{' '}
                                    prints · VWAP $
                                    {cand.aggregation.vwap_fill_price.toFixed(
                                      2
                                    )}{' '}
                                    ·{' '}
                                    {cand.aggregation.price_progression.replace(
                                      /_/g,
                                      ' '
                                    )}
                                  </div>
                                )}
                              </td>

                              <td
                                data-testid={`candidate-timestamp-${cand.ticker}`}
                                className="py-2 px-1.5 font-mono tabular-nums"
                              >
                                <div className="font-semibold text-slate-100 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-sky-400 shrink-0" />
                                  <span>{tsSummary.latest_time_et}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {tsSummary.date_et} ·{' '}
                                  {tsSummary.relative_age_label}
                                </div>
                                {tsSummary.is_multi_print_span && (
                                  <div className="text-[10px] text-sky-400/90 mt-0.5">
                                    1st{' '}
                                    {tsSummary.detected_time_et.replace(
                                      ' ET',
                                      ''
                                    )}{' '}
                                    (+
                                    {cand.aggregation
                                      ?.aggregation_window_seconds ?? 0}
                                    s)
                                  </div>
                                )}
                              </td>

                              <td className="py-2 px-1.5 font-medium">
                                <span
                                  className={`inline-flex items-center gap-1 ${
                                    isBull
                                      ? 'text-emerald-400'
                                      : 'text-rose-400'
                                  }`}
                                >
                                  {isBull ? (
                                    <TrendingUp className="w-3 h-3" />
                                  ) : (
                                    <TrendingDown className="w-3 h-3" />
                                  )}
                                  {cand.direction}
                                </span>
                                <div className="text-[10px] font-mono text-slate-400">
                                  {Math.round(cand.flow.side_share * 100)}% side
                                  · {Math.round(cand.flow.sweep_ratio * 100)}%
                                  swp
                                </div>
                              </td>

                              <td className="py-2 px-1.5 text-right font-mono tabular-nums">
                                <div className="font-semibold text-slate-100">
                                  ${(cand.flow.premium_5m / 1000).toFixed(0)}K
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {Math.round(cand.flow.contract_share * 100)}%
                                  · z={cand.bursts.robust_zscore.toFixed(0)}
                                </div>
                              </td>

                              <td className="py-2 px-1.5 text-right font-mono tabular-nums">
                                <div className="text-slate-100 font-semibold">
                                  {cand.flow.volume_oi_ratio.toFixed(2)}x
                                </div>
                                <div className="text-[10px] text-amber-400/90">
                                  {cand.flow.oi_status ===
                                  'verified_next_day_oi'
                                    ? 'verified OI'
                                    : 'intraday OI'}
                                </div>
                              </td>

                              <td className="py-2 px-1.5">
                                <div
                                  className={`inline-flex items-center gap-1 font-medium ${
                                    cand.status === 'confirmed'
                                      ? 'text-emerald-400'
                                      : 'text-amber-400'
                                  }`}
                                >
                                  {cand.status === 'confirmed' ? (
                                    <CheckCircle2 className="w-3 h-3" />
                                  ) : (
                                    <Clock className="w-3 h-3" />
                                  )}
                                  <span>{cand.status}</span>
                                  {cand.stock_confirmation && (
                                    <span className="text-[10px] font-mono text-sky-400">
                                      ({cand.stock_confirmation.rules_passed_count}/5)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] font-mono text-slate-400">
                                  {cand.underlying.return_5m >= 0 ? '+' : ''}
                                  {(cand.underlying.return_5m * 100).toFixed(2)}
                                  % · {cand.underlying.relative_volume_5m}x ·{' '}
                                  {cand.stock_confirmation
                                    ? `${cand.stock_confirmation.indicators.post_burst_atr_multiple}x ATR`
                                    : 'VWAP'}
                                </div>
                              </td>

                              <td className="py-2 px-2 text-right font-mono tabular-nums">
                                <span className="text-sm font-bold text-sky-400">
                                  {cand.whale_score}
                                </span>
                                {cand.stock_confirmation ? (
                                  <div className="text-[10px] text-emerald-400">
                                    70/30:{' '}
                                    {
                                      cand.stock_confirmation
                                        .final_composite_score
                                    }
                                  </div>
                                ) : (
                                  (cand.regime_bonus_applied ?? 0) > 0 && (
                                    <div className="text-[10px] text-emerald-400">
                                      +{cand.regime_bonus_applied} tide
                                    </div>
                                  )
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                  </div>
                )}
              </section>

              <div className="lg:col-span-4 lg:sticky lg:top-4">
                <CandidateInspector
                  candidate={selectedCandidate}
                  onOpenOptionEventChart={(cand) => {
                    setSelectedCandidateId(cand.candidate_id);
                    setCandidateDetailChartOpen(true);
                  }}
                  onAutoExecuteCandidate={(cand) => {
                    void handleRunAutoPipelineCycle(cand.candidate_id);
                  }}
                  runningAutoCycle={runningAutoCycle}
                  onOpenRegimeStrategy={(cand) => {
                    setSelectedCandidateId(cand.candidate_id);
                    setActiveSection('regime_strategy');
                  }}
                  onStageSmartOrderOnCandidate={(cand) => {
                    setPreselectedSmartOrderCandidateId(cand.candidate_id);
                    handleRefreshSmartOrderState();
                    setActiveSection('smart_order');
                  }}
                  onRunAiAnalysisOnCandidate={async (cand) => {
                    await handleRunAiAnalysis({
                      candidate_id: cand.candidate_id,
                      analysis_type: 'whale_candidate_evaluation',
                      execution_mode: 'auto',
                    });
                    setActiveSection('ai_analysis');
                  }}
                />
              </div>
            </div>
            )}
          </div>
        )}

        {/* View 1B: Unified Market Tide & Regime Strategy (Combines Market Tide + Regime Strategy into Step 1) */}
        {(activeSection === 'market_tide' ||
          activeSection === 'regime_strategy') && (
          <div className="space-y-5">
            <div className="p-3.5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  Step 1B · Unified Market Tide, SPX GEX &amp; Regime-Adaptive Strategy
                </h2>
                <p className="text-xs text-slate-400">
                  Consolidated market regime analysis combining Unusual Whales Market Tide net premium slopes, SPX Periscope GEX walls, and 14-Factor FlowScore profiles.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#0B0F17] rounded-md border border-slate-800">
                <button
                  type="button"
                  onClick={() => setRegimeCombinedMode(true)}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                    regimeCombinedMode
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Unified View (Tide + Strategy)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRegimeCombinedMode(false);
                    setActiveSection('market_tide');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                    !regimeCombinedMode && activeSection === 'market_tide'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Market Tide &amp; Profiles
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRegimeCombinedMode(false);
                    setActiveSection('regime_strategy');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                    !regimeCombinedMode && activeSection === 'regime_strategy'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  SPX GEX &amp; 14-Factor Strategy
                </button>
              </div>
            </div>

            {(regimeCombinedMode || activeSection === 'market_tide') && (
              <MarketTideView
                marketTide={telemetry.market_tide}
                regimeAdaptiveEnabled={regimeAdaptiveEnabled}
                candidates={candidates}
                onSwitchRegime={handleSwitchRegime}
                onSwitchAdaptiveProfile={handleSwitchAdaptiveProfile}
                onToggleRegimeAdaptive={handleToggleRegimeAdaptive}
                selectedSessionDate={selectedSessionDate}
                latestSessionDate={
                  availableSessions.find((s) => s.is_latest)?.date ??
                  '2026-10-21'
                }
                availableSessions={availableSessions}
                onSelectSessionDate={handleSelectSessionDate}
                onSyncLatestSession={async () => {
                  try {
                    const res = await fetch('/api/market/market-tide/sync', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                    });
                    if (res.ok) {
                      const data = await res.json();
                      if (data.market_tide) {
                        setTelemetry((prev) => ({
                          ...prev,
                          market_tide: data.market_tide,
                        }));
                      }
                    }
                  } catch {
                    // Handled gracefully
                  }
                  await refreshData();
                }}
                onSelectTickerInScanner={(ticker) => {
                  handleTickerChange(ticker);
                  setActiveSection('scanner');
                }}
                onInspectCandidateInScanner={(candId) => {
                  setSelectedCandidateId(candId);
                  setActiveSection('scanner');
                }}
              />
            )}

            {(regimeCombinedMode || activeSection === 'regime_strategy') && (
              <RegimeStrategyView
                marketTide={telemetry.market_tide}
                candidates={
                  allAcquiredCandidates.length > 0
                    ? allAcquiredCandidates
                    : candidates
                }
                syncingAlpaca={syncingAlpaca}
                onSyncAlpaca={handleSyncAlpacaStockData}
                onStageSmartOrderOnCandidate={(cand) => {
                  setPreselectedSmartOrderCandidateId(cand.candidate_id);
                  handleRefreshSmartOrderState();
                  setActiveSection('smart_order');
                }}
                onRunAiAnalysisOnCandidate={async (cand) => {
                  await handleRunAiAnalysis({
                    candidate_id: cand.candidate_id,
                    analysis_type: 'whale_candidate_evaluation',
                    execution_mode: 'auto',
                  });
                  setActiveSection('ai_analysis');
                }}
                onInspectCandidateInScanner={(candId) => {
                  setSelectedCandidateId(candId);
                  setActiveSection('scanner');
                }}
                onOpenLlmDecisionGate={async (cand) => {
                  await handleEvaluateLlmDecision({
                    candidate_id: cand.candidate_id,
                    stress_scenario: 'default',
                    execution_mode: 'auto',
                  });
                  setActiveSection('llm_decision_gate');
                }}
              />
            )}
          </div>
        )}

        {/* View 1C: Live Option Tape & Post-Close Reconciliation */}
        {activeSection === 'pipeline' && (
          <PipelineWorkbenchView
            rawWsMessages={telemetry.raw_ws_messages}
            rejectedPrints={telemetry.rejected_prints}
            activeWsChannels={telemetry.active_ws_channels}
            contractCacheCount={telemetry.contract_cache_count}
            seenEventCount={telemetry.seen_event_count}
            lastReconciliation={telemetry.last_reconciliation}
            onIngestPrint={handleIngestPrint}
            onTriggerReconcile={handleTriggerReconcile}
          />
        )}

        {/* WORKFLOW STAGE 2: UNIFIED AI ANALYSIS & DECISION GATE (Combines AI Activity Monitor + Stage-1/Stage-2 LLM Decision Gate) */}
        {isAiGateStage && (
          <div className="space-y-4">
            <section
              aria-label="Step 2 AI Decision Gate Workspace Navigation"
              className="px-3.5 py-2.5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] rounded-md border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setAiGateCombinedMode(false);
                    handleRefreshAiLogs();
                    setActiveSection('ai_analysis');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'ai_analysis' && !aiGateCombinedMode
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Live AI Activity &amp; Pending Queue ({aiLogsList.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiGateCombinedMode(false);
                    setActiveSection('llm_decision_gate');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'llm_decision_gate' && !aiGateCombinedMode
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Stage-1 &amp; Stage-2 Decision Gate ({llmRecordsList.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiGateCombinedMode(true);
                    handleRefreshAiLogs();
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    aiGateCombinedMode
                      ? 'bg-emerald-400 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Unified View (Queue + Gate)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-xs font-mono text-sky-400 tabular-nums hidden lg:inline">
                  {processingAiCount} Proc · {pendingAiCount} Pend · Total Time:{' '}
                  <strong className="text-emerald-400">
                    {(totalAiAnalysisTimeMs / 1000).toFixed(2)}s (
                    {totalAiAnalysisTimeMs.toLocaleString()} ms)
                  </strong>{' '}
                  · {llmEngineConfig.concurrentAnalyses ?? 3}x Workers
                </span>
                <button
                  type="button"
                  onClick={() => setActiveSection('scanner')}
                  className="px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-slate-600 text-slate-300 transition-colors whitespace-nowrap"
                >
                  ← 1. Flow Discovery
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleRefreshSmartOrderState();
                    setActiveSection('smart_order');
                  }}
                  className="px-2.5 py-1 text-xs font-mono font-semibold rounded border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 transition-colors whitespace-nowrap"
                >
                  Next: 3. Smart Execution →
                </button>
              </div>
            </section>

            {(aiGateCombinedMode || activeSection === 'ai_analysis') && (
              <AiAnalysisMonitorView
                logs={aiLogsList}
                candidates={
                  allAcquiredCandidates.length > 0
                    ? allAcquiredCandidates
                    : candidates
                }
                llmEngineConfig={llmEngineConfig}
                onRunAiAnalysis={handleRunAiAnalysis}
                onProcessPending={handleProcessPendingAiAnalyses}
                onRefreshLogs={handleRefreshAiLogs}
                onClearLogs={handleClearAiLogs}
                onOpenLlmSettings={() => setActiveSection('config')}
              />
            )}

            {(aiGateCombinedMode || activeSection === 'llm_decision_gate') && (
              <LlmTradeDecisionView
                records={llmRecordsList}
                candidates={
                  allAcquiredCandidates.length > 0
                    ? allAcquiredCandidates
                    : candidates
                }
                llmEngineConfig={llmEngineConfig}
                riskPolicyConfig={
                  telemetry.risk_policy_config ??
                  sharedScannerRuntime.getRiskPolicyConfig()
                }
                onEvaluateCandidate={handleEvaluateLlmDecision}
                onApproveAction={handleApproveLlmDecision}
                onRunStage2RiskAndFulfill={handleRunStage2RiskAndFulfill}
                onUpdateRiskPolicy={handleUpdateRiskPolicy}
                onRecalculateRiskForDecision={handleRecalculateRiskForDecision}
                onOpenSmartOrderMonitor={() => {
                  handleRefreshSmartOrderState();
                  setActiveSection('smart_order');
                }}
                onOpenLlmSettings={() => setActiveSection('config')}
                onRunAutoPipelineCycle={() => handleRunAutoPipelineCycle()}
                runningAutoCycle={runningAutoCycle}
              />
            )}
          </div>
        )}

        {/* WORKFLOW STAGE 3: SMART OPTIONS ORDER FILLING & SPREAD-CROSSING EXECUTION */}
        {isExecutionStage && (
          <div className="space-y-4">
            <section
              aria-label="Step 3 Smart Execution Navigation"
              className="px-3.5 py-2.5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-bold text-slate-100">
                  Step 3 · Smart Options Order Filling &amp; Spread-Crossing Desk
                </span>
                <span className="text-slate-500 hidden lg:inline">
                  — NBBO Microprice · Delta-Peg · Progressive Spread-Crossing
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection('llm_decision_gate')}
                  className="px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-slate-600 text-slate-300 transition-colors"
                >
                  ← 2. AI Decision Gate
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('holdings_monitor')}
                  className="px-2.5 py-1 text-xs font-mono font-semibold rounded border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 transition-colors"
                >
                  Next: 4. Portfolio &amp; Exits →
                </button>
              </div>
            </section>

            <SmartOrderMonitorView
              tickets={smartTicketsList}
              config={smartOrderConfig}
              candidates={
                allAcquiredCandidates.length > 0
                  ? allAcquiredCandidates
                  : candidates
              }
              marketTide={telemetry.market_tide}
              preselectedCandidateId={preselectedSmartOrderCandidateId}
              onSaveConfig={handleSaveSmartOrderConfig}
              onExecuteSmartOrder={handleExecuteSmartOrder}
              onAdvanceTicket={handleAdvanceSmartOrderTicket}
              onRefreshState={handleRefreshSmartOrderState}
              onClearTickets={handleClearSmartOrderTickets}
            />
          </div>
        )}

        {/* WORKFLOW STAGE 4: UNIFIED PORTFOLIO, HOLDINGS & AI EXIT PLANS (Combines Holdings Monitor + Alpaca Account) */}
        {isPortfolioStage && (
          <div className="space-y-4">
            <section
              aria-label="Step 4 Portfolio and Exits Workspace Navigation"
              className="px-3.5 py-2.5 rounded-lg border border-slate-800 bg-[#111726] flex flex-wrap items-center justify-between gap-2.5"
            >
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] rounded-md border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setPortfolioCombinedMode(false);
                    setActiveSection('alpaca_account');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'alpaca_account' && !portfolioCombinedMode
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Account Overview (P/L &amp; Trade Ledger)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPortfolioCombinedMode(false);
                    setActiveSection('holdings_monitor');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    activeSection === 'holdings_monitor' &&
                    !portfolioCombinedMode
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Monitored Holdings &amp; AI Exit Plans
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPortfolioCombinedMode(true);
                    setActiveSection('holdings_monitor');
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                    portfolioCombinedMode
                      ? 'bg-emerald-400 text-slate-950'
                      : 'text-slate-300 hover:text-slate-100'
                  }`}
                >
                  Unified Portfolio &amp; Exits (All-in-One)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleRefreshSmartOrderState();
                    setActiveSection('smart_order');
                  }}
                  className="px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-slate-600 text-slate-300 transition-colors"
                >
                  ← 3. Smart Execution
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleRefreshApiLogs();
                    setActiveSection('api_activity');
                  }}
                  className="px-2.5 py-1 text-xs font-mono rounded border border-slate-700 bg-[#0B0F17] hover:border-slate-600 text-sky-300 transition-colors"
                >
                  API Usage Monitor →
                </button>
              </div>
            </section>

            {(portfolioCombinedMode ||
              activeSection === 'holdings_monitor') && (
              <HoldingsMonitorView
                initialState={telemetry.holdings_monitor}
                onSelectTickerInScanner={(ticker) => {
                  handleTickerChange(ticker);
                  setActiveSection('scanner');
                }}
                onOpenSettings={() => setActiveSection('config')}
              />
            )}

            {(portfolioCombinedMode || activeSection === 'alpaca_account') && (
              <AlpacaAccountView
                initialData={telemetry.alpaca_account_overview}
                smartOrderTickets={smartTicketsList}
                onSelectTickerInScanner={(ticker) => {
                  handleTickerChange(ticker);
                  setActiveSection('scanner');
                }}
              />
            )}
          </div>
        )}

        {/* WORKFLOW STAGE 5: SELF-LEARNING BAKE-TESTING & POST-TRADE RETROSPECTIVE ATTRIBUTION ENGINE */}
        {isBacktestLearningStage && (
          <BacktestLearningView
            activities={backtestLearningState.activities}
            learnedRules={backtestLearningState.learned_rules}
            summary={backtestLearningState.summary}
            candidates={candidates}
            onRefreshState={handleRefreshBacktestState}
            onQueryDeepTelemetry={handleQueryDeepBacktestTelemetry}
            onAnalyzeWithLlm={handleAnalyzeBacktestWithLlm}
            onRunBatchBacktest={() => handleRunBatchBacktest({})}
            onToggleRule={handleToggleLearnedRule}
            onUpsertRule={async (input) => {
              await handleUpsertLearnedRule({
                title: input.title,
                directive_type: input.directive_type,
                confidence_delta_pct: input.confidence_delta_pct,
                recommended_decision_override:
                  input.recommended_decision_override,
                condition_summary_human: input.condition_summary_human,
                prompt_injection_instruction:
                  input.prompt_injection_instruction,
                conditions: {
                  direction: input.direction,
                  vwap_relationship: input.vwap_relationship,
                  dealer_gamma_regime: input.dealer_gamma_regime,
                },
              });
            }}
            onReEvaluateCandidateWithLearnedRules={async (
              candidateId,
              ticker
            ) => {
              await handleReEvaluateWithLearnedRules(candidateId);
              if (ticker) {
                handleTickerChange(ticker);
              }
            }}
            onInspectCandidateChart={(cand) => {
              setSelectedCandidateId(cand.candidate_id);
              setCandidateDetailChartOpen(true);
              setActiveSection('scanner');
            }}
          />
        )}

        {/* DEDICATED API USAGE & ACTIVITY MONITOR PAGE */}
        {isApiMonitorStage && (
          <ApiActivityMonitorView
            logs={apiLogsList}
            onRefreshLogs={handleRefreshApiLogs}
            onTriggerProbe={handleTriggerApiProbe}
            onClearLogs={handleClearApiLogs}
          />
        )}

        {/* DEDICATED SYSTEM SETTINGS & CONCURRENT AI CONFIGURATION PAGE */}
        {isSettingsStage && (
          <ScannerConfigView
            scanners={scanners}
            activeScanner={activeScanner}
            onSaveScanner={handleSaveScanner}
            onSelectMode={(m) => handleModeSwitch(m)}
            llmEngineConfig={llmEngineConfig}
            onSaveLlmEngineConfig={handleSaveLlmEngineConfig}
            currentUserEmail={currentUser?.email ?? null}
            onSignInGoogle={async () => {
              await signInWithGoogle();
            }}
            onSignOut={async () => {
              await signOutUser();
            }}
            onSyncAllToCloud={handleSyncAllToCloud}
            cloudSyncCounts={cloudSyncCounts}
            backendPersistenceStats={{
              candidatesCount: allAcquiredCandidates.length,
              printsCount: telemetry.seen_event_count,
              recalculationCycles: telemetry.recalculation_cycles ?? 1,
              lastSavedAt:
                telemetry.last_saved_at ?? new Date().toISOString(),
            }}
          />
        )}
      </main>

      <footer className="border-t border-slate-800/80 py-4 px-6 mt-auto text-xs text-slate-400 flex flex-wrap items-center justify-between gap-4 max-w-[1440px] w-full mx-auto">
        <span>
          WhalePulse Options Flow Scanner · Same-Contract Activity Aggregation &amp;
          Market Tide Regime-Adaptive Engine
        </span>
        <span>
          Automated Pipeline: Scan → Stage-1 LLM → Stage-2 Risk &amp; Sizing →
          Auto Smart Order Fulfillment
        </span>
      </footer>
    </div>
  );
}
