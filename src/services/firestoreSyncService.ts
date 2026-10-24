import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  ScannerConfig,
  ScannerModeId,
  WhaleCandidate,
} from '../engine/whaleScannerEngine';
import {
  DEFAULT_LLM_ENGINE_CONFIG,
  LlmEngineConfig,
} from '../engine/whalePipelineRuntime';

export interface SessionSettingsState {
  selectedMode: ScannerModeId;
  statusFilter: string;
  directionFilter: string;
  tickerQuery: string;
  minScoreFilter: number;
  includeEtfs: boolean;
}

const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeFirestoreId(raw: string, maxLen = 64): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : 'default_id';
}

export function sanitizeBoundedString(
  raw: string,
  maxLen: number,
  minLen = 0
): string {
  const trimmed = (raw ?? '').slice(0, maxLen);
  if (trimmed.length < minLen) {
    return trimmed.padEnd(minLen, '_');
  }
  return trimmed;
}

/**
 * Save or update the current user's workspace session settings in /userSessions/{uid}
 */
export async function syncUserSessionToFirestore(
  settings: SessionSettingsState
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const sessionId = sanitizeFirestoreId(user.uid, 128);
  if (!ID_PATTERN.test(sessionId)) return;

  const path = `userSessions/${sessionId}`;
  const docRef = doc(db, 'userSessions', sessionId);

  const sanitizedTicker = sanitizeBoundedString(settings.tickerQuery, 16, 0);
  const clampedScore = Math.min(
    Math.max(Math.round(settings.minScoreFilter), 0),
    100
  );

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        ownerId: user.uid,
        selectedMode: settings.selectedMode,
        statusFilter: settings.statusFilter,
        directionFilter: settings.directionFilter,
        tickerQuery: sanitizedTicker,
        minScoreFilter: clampedScore,
        includeEtfs: Boolean(settings.includeEtfs),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        selectedMode: settings.selectedMode,
        statusFilter: settings.statusFilter,
        directionFilter: settings.directionFilter,
        tickerQuery: sanitizedTicker,
        minScoreFilter: clampedScore,
        includeEtfs: Boolean(settings.includeEtfs),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Save or update a ScannerConfig in /scannerConfigs/{docId}
 */
export async function syncScannerConfigToFirestore(
  scanner: ScannerConfig
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const safeScannerId = sanitizeFirestoreId(scanner.scanner_id, 64);
  const docId = sanitizeFirestoreId(`${user.uid}_${safeScannerId}`, 128);
  const path = `scannerConfigs/${docId}`;
  const docRef = doc(db, 'scannerConfigs', docId);

  const safeName = sanitizeBoundedString(scanner.name, 80, 1);

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        ownerId: user.uid,
        scannerId: safeScannerId,
        name: safeName,
        mode: scanner.mode,
        enabled: Boolean(scanner.enabled),
        minWhaleScore: Math.min(Math.max(scanner.min_whale_score, 0), 100),
        minPremium: Math.min(
          Math.max(scanner.contract_filters.min_premium, 0),
          100_000_000
        ),
        minDte: Math.min(Math.max(scanner.contract_filters.min_dte, 0), 730),
        maxDte: Math.min(
          Math.max(
            scanner.contract_filters.max_dte,
            scanner.contract_filters.min_dte
          ),
          1095
        ),
        minVolumeOiRatio: Math.min(
          Math.max(scanner.contract_filters.min_volume_oi_ratio, 0),
          100
        ),
        minSkew: Math.min(Math.max(scanner.contract_filters.min_skew, 0), 1),
        maxMultilegRatio: Math.min(
          Math.max(scanner.contract_filters.max_multileg_ratio, 0),
          1
        ),
        maxSpread: Math.min(
          Math.max(scanner.contract_filters.max_spread, 0),
          1
        ),
        requireConfirmation: Boolean(scanner.confirmation.enabled),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        name: safeName,
        mode: scanner.mode,
        enabled: Boolean(scanner.enabled),
        minWhaleScore: Math.min(Math.max(scanner.min_whale_score, 0), 100),
        minPremium: Math.min(
          Math.max(scanner.contract_filters.min_premium, 0),
          100_000_000
        ),
        minDte: Math.min(Math.max(scanner.contract_filters.min_dte, 0), 730),
        maxDte: Math.min(
          Math.max(
            scanner.contract_filters.max_dte,
            scanner.contract_filters.min_dte
          ),
          1095
        ),
        minVolumeOiRatio: Math.min(
          Math.max(scanner.contract_filters.min_volume_oi_ratio, 0),
          100
        ),
        minSkew: Math.min(Math.max(scanner.contract_filters.min_skew, 0), 1),
        maxMultilegRatio: Math.min(
          Math.max(scanner.contract_filters.max_multileg_ratio, 0),
          1
        ),
        maxSpread: Math.min(
          Math.max(scanner.contract_filters.max_spread, 0),
          1
        ),
        requireConfirmation: Boolean(scanner.confirmation.enabled),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Save or update an acquired WhaleCandidate in /whaleCandidates/{docId}
 */
export async function syncCandidateToFirestore(
  cand: WhaleCandidate
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const safeCandId = sanitizeFirestoreId(cand.candidate_id, 64);
  const docId = sanitizeFirestoreId(`${user.uid}_${safeCandId}`, 128);
  const path = `whaleCandidates/${docId}`;
  const docRef = doc(db, 'whaleCandidates', docId);

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        ownerId: user.uid,
        candidateId: safeCandId,
        scannerId: sanitizeBoundedString(cand.scanner_id, 64, 1),
        dedupKey: sanitizeBoundedString(cand.dedup_key, 120, 1),
        ticker: sanitizeBoundedString(cand.ticker, 16, 1),
        optionSymbol: sanitizeBoundedString(cand.option_symbol, 40, 1),
        optionType: cand.option_type,
        strike: Math.max(cand.strike, 0.01),
        expiry: sanitizeBoundedString(cand.expiry, 16, 8),
        dte: Math.min(Math.max(cand.dte, 0), 1095),
        issueType: cand.issue_type,
        direction: cand.direction,
        status: cand.status,
        whaleScore: Math.min(Math.max(cand.whale_score, 0), 100),
        premium5m: Math.max(cand.flow.premium_5m, 0),
        contractPremium5m: Math.max(cand.flow.contract_premium_5m, 0),
        contractShare: Math.min(Math.max(cand.flow.contract_share, 0), 1),
        sideShare: Math.min(Math.max(cand.flow.side_share, 0), 1),
        sweepRatio: Math.min(Math.max(cand.flow.sweep_ratio, 0), 1),
        volume: Math.max(cand.flow.volume, 0),
        openInterest: Math.max(cand.flow.open_interest, 0),
        volumeOiRatio: Math.max(cand.flow.volume_oi_ratio, 0),
        oiStatus: cand.flow.oi_status,
        repeatedHits: Boolean(cand.flow.repeated_hits),
        return5m: cand.underlying.return_5m,
        relativeVolume5m: Math.max(cand.underlying.relative_volume_5m, 0),
        vwapAligned: Boolean(cand.underlying.vwap_aligned),
        candleClosePosition: Math.min(
          Math.max(cand.underlying.candle_close_position, 0),
          1
        ),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (snap.data()?.status !== 'invalidated') {
      await updateDoc(docRef, {
        status: cand.status,
        whaleScore: Math.min(Math.max(cand.whale_score, 0), 100),
        premium5m: Math.max(cand.flow.premium_5m, 0),
        contractPremium5m: Math.max(cand.flow.contract_premium_5m, 0),
        contractShare: Math.min(Math.max(cand.flow.contract_share, 0), 1),
        sideShare: Math.min(Math.max(cand.flow.side_share, 0), 1),
        sweepRatio: Math.min(Math.max(cand.flow.sweep_ratio, 0), 1),
        volume: Math.max(cand.flow.volume, 0),
        openInterest: Math.max(cand.flow.open_interest, 0),
        volumeOiRatio: Math.max(cand.flow.volume_oi_ratio, 0),
        oiStatus: cand.flow.oi_status,
        repeatedHits: Boolean(cand.flow.repeated_hits),
        return5m: cand.underlying.return_5m,
        relativeVolume5m: Math.max(cand.underlying.relative_volume_5m, 0),
        vwapAligned: Boolean(cand.underlying.vwap_aligned),
        candleClosePosition: Math.min(
          Math.max(cand.underlying.candle_close_position, 0),
          1
        ),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Append an OptionPrintDoc audit record in /optionPrints/{docId}
 */
export async function logOptionPrintToFirestore(params: {
  eventId: string;
  ticker: string;
  optionSymbol: string;
  optionType: 'call' | 'put';
  strike: number;
  dte: number;
  size: number;
  price: number;
  premium: number;
  side: 'ask' | 'bid' | 'mid' | 'unknown';
  isSweep: boolean;
  isMultiLeg: boolean;
  spread: number;
  accepted: boolean;
  rejectReason: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const safeEventId = sanitizeFirestoreId(params.eventId, 64);
  const docId = sanitizeFirestoreId(`${user.uid}_${safeEventId}`, 128);
  const path = `optionPrints/${docId}`;
  const docRef = doc(db, 'optionPrints', docId);

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        ownerId: user.uid,
        eventId: safeEventId,
        ticker: sanitizeBoundedString(params.ticker, 16, 1),
        optionSymbol: sanitizeBoundedString(params.optionSymbol, 40, 1),
        optionType: params.optionType,
        strike: Math.max(params.strike, 0.01),
        dte: Math.min(Math.max(params.dte, 0), 1095),
        size: Math.max(params.size, 1),
        price: Math.max(params.price, 0.01),
        premium: Math.max(params.premium, 1),
        side: params.side,
        isSweep: Boolean(params.isSweep),
        isMultiLeg: Boolean(params.isMultiLeg),
        spread: Math.min(Math.max(params.spread, 0), 1),
        accepted: Boolean(params.accepted),
        rejectReason: sanitizeBoundedString(params.rejectReason, 240, 0),
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Save or update the current user's LM Studio LLM Engine configuration in /llmEngineConfigs/{uid}
 */
export async function syncLlmEngineConfigToFirestore(
  config: LlmEngineConfig
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const configId = sanitizeFirestoreId(user.uid, 128);
  if (!ID_PATTERN.test(configId)) return;

  const path = `llmEngineConfigs/${configId}`;
  const docRef = doc(db, 'llmEngineConfigs', configId);

  const rawEndpoint = (config.endpointUrl || 'http://localhost:1234/v1').trim();
  const safeEndpoint = /^https?:\/\/.+$/.test(rawEndpoint)
    ? sanitizeBoundedString(rawEndpoint, 256, 8)
    : 'http://localhost:1234/v1';

  const payload = {
    provider:
      config.provider === 'openai_compatible'
        ? ('openai_compatible' as const)
        : ('lm_studio' as const),
    enabled: Boolean(config.enabled),
    endpointUrl: safeEndpoint,
    modelId: sanitizeBoundedString(config.modelId || 'local-model', 120, 1),
    temperature: Math.min(Math.max(Number(config.temperature) || 0, 0), 2),
    maxTokens: Math.min(
      Math.max(Math.round(Number(config.maxTokens) || 1024), 64),
      32768
    ),
    topP: Math.min(Math.max(Number(config.topP) || 0.95, 0), 1),
    timeoutMs: Math.min(
      Math.max(Math.round(Number(config.timeoutMs) || 30000), 1000),
      120000
    ),
    streamResponses: Boolean(config.streamResponses),
    autoAnalyzeConfirmedWhales: Boolean(config.autoAnalyzeConfirmedWhales),
    includeGexAndTideContext: Boolean(config.includeGexAndTideContext),
    includeAlpacaStockIndicators: Boolean(config.includeAlpacaStockIndicators),
    systemPromptTemplate: sanitizeBoundedString(
      config.systemPromptTemplate ||
        DEFAULT_LLM_ENGINE_CONFIG.systemPromptTemplate,
      2000,
      1
    ),
  };

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        ownerId: user.uid,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Subscribe to real-time cross-session changes in Firestore for the signed-in user
 */
export function subscribeToUserWorkspace(
  uid: string,
  callbacks: {
    onSessionUpdate: (settings: SessionSettingsState) => void;
    onLlmConfigUpdate?: (llmConfig: LlmEngineConfig) => void;
    onCloudCountsUpdate: (counts: {
      syncedCandidates: number;
      syncedConfigs: number;
      syncedPrints: number;
      lastSyncedAt: string;
    }) => void;
  }
): Unsubscribe {
  const sessionId = sanitizeFirestoreId(uid, 128);
  const sessionRef = doc(db, 'userSessions', sessionId);
  const llmRef = doc(db, 'llmEngineConfigs', sessionId);

  let candCount = 0;
  let cfgCount = 0;
  let prtCount = 0;

  const emitCounts = () => {
    callbacks.onCloudCountsUpdate({
      syncedCandidates: candCount,
      syncedConfigs: cfgCount,
      syncedPrints: prtCount,
      lastSyncedAt: new Date().toISOString(),
    });
  };

  const unsubSession = onSnapshot(
    sessionRef,
    (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        callbacks.onSessionUpdate({
          selectedMode: d.selectedMode ?? 'directional_momentum',
          statusFilter: d.statusFilter ?? 'all',
          directionFilter: d.directionFilter ?? 'all',
          tickerQuery: d.tickerQuery ?? '',
          minScoreFilter:
            typeof d.minScoreFilter === 'number' ? d.minScoreFilter : 60,
          includeEtfs: Boolean(d.includeEtfs),
        });
      }
    },
    (error) => {
      handleFirestoreError(
        error,
        OperationType.GET,
        `userSessions/${sessionId}`
      );
    }
  );

  const unsubLlm = onSnapshot(
    llmRef,
    (snap) => {
      if (snap.exists() && callbacks.onLlmConfigUpdate) {
        const d = snap.data();
        callbacks.onLlmConfigUpdate({
          provider:
            d.provider === 'openai_compatible'
              ? 'openai_compatible'
              : 'lm_studio',
          enabled:
            typeof d.enabled === 'boolean'
              ? d.enabled
              : DEFAULT_LLM_ENGINE_CONFIG.enabled,
          endpointUrl:
            typeof d.endpointUrl === 'string'
              ? d.endpointUrl
              : DEFAULT_LLM_ENGINE_CONFIG.endpointUrl,
          modelId:
            typeof d.modelId === 'string'
              ? d.modelId
              : DEFAULT_LLM_ENGINE_CONFIG.modelId,
          thinkingMode:
            d.thinkingMode === 'think' ? 'think' : 'no_think',
          maxTokensEnabled:
            typeof d.maxTokensEnabled === 'boolean'
              ? d.maxTokensEnabled
              : DEFAULT_LLM_ENGINE_CONFIG.maxTokensEnabled,
          discoveredModels: Array.isArray(d.discoveredModels)
            ? d.discoveredModels
            : DEFAULT_LLM_ENGINE_CONFIG.discoveredModels,
          lastModelScanAt:
            typeof d.lastModelScanAt === 'string' ? d.lastModelScanAt : null,
          temperature:
            typeof d.temperature === 'number'
              ? d.temperature
              : DEFAULT_LLM_ENGINE_CONFIG.temperature,
          maxTokens:
            typeof d.maxTokens === 'number'
              ? d.maxTokens
              : DEFAULT_LLM_ENGINE_CONFIG.maxTokens,
          topP:
            typeof d.topP === 'number'
              ? d.topP
              : DEFAULT_LLM_ENGINE_CONFIG.topP,
          timeoutMs:
            typeof d.timeoutMs === 'number'
              ? d.timeoutMs
              : DEFAULT_LLM_ENGINE_CONFIG.timeoutMs,
          concurrentAnalyses:
            typeof d.concurrentAnalyses === 'number'
              ? d.concurrentAnalyses
              : DEFAULT_LLM_ENGINE_CONFIG.concurrentAnalyses,
          streamResponses:
            typeof d.streamResponses === 'boolean'
              ? d.streamResponses
              : DEFAULT_LLM_ENGINE_CONFIG.streamResponses,
          autoAnalyzeConfirmedWhales:
            typeof d.autoAnalyzeConfirmedWhales === 'boolean'
              ? d.autoAnalyzeConfirmedWhales
              : DEFAULT_LLM_ENGINE_CONFIG.autoAnalyzeConfirmedWhales,
          includeGexAndTideContext:
            typeof d.includeGexAndTideContext === 'boolean'
              ? d.includeGexAndTideContext
              : DEFAULT_LLM_ENGINE_CONFIG.includeGexAndTideContext,
          includeAlpacaStockIndicators:
            typeof d.includeAlpacaStockIndicators === 'boolean'
              ? d.includeAlpacaStockIndicators
              : DEFAULT_LLM_ENGINE_CONFIG.includeAlpacaStockIndicators,
          systemPromptTemplate:
            typeof d.systemPromptTemplate === 'string'
              ? d.systemPromptTemplate
              : DEFAULT_LLM_ENGINE_CONFIG.systemPromptTemplate,
          updatedAt: new Date().toISOString(),
        });
      }
    },
    (error) => {
      handleFirestoreError(
        error,
        OperationType.GET,
        `llmEngineConfigs/${sessionId}`
      );
    }
  );

  const candQuery = query(
    collection(db, 'whaleCandidates'),
    where('ownerId', '==', uid)
  );
  const unsubCands = onSnapshot(
    candQuery,
    (snap) => {
      candCount = snap.size;
      emitCounts();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'whaleCandidates');
    }
  );

  const cfgQuery = query(
    collection(db, 'scannerConfigs'),
    where('ownerId', '==', uid)
  );
  const unsubCfgs = onSnapshot(
    cfgQuery,
    (snap) => {
      cfgCount = snap.size;
      emitCounts();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'scannerConfigs');
    }
  );

  const prtQuery = query(
    collection(db, 'optionPrints'),
    where('ownerId', '==', uid)
  );
  const unsubPrts = onSnapshot(
    prtQuery,
    (snap) => {
      prtCount = snap.size;
      emitCounts();
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'optionPrints');
    }
  );

  return () => {
    unsubSession();
    unsubLlm();
    unsubCands();
    unsubCfgs();
    unsubPrts();
  };
}
