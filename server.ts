import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  type PersistentDatabaseSnapshot,
  sharedScannerRuntime,
} from './src/engine/whalePipelineRuntime.ts';
import { sharedAlpacaStockService } from './src/engine/alpacaStockService.ts';
import { sharedAlpacaAccountService } from './src/engine/alpacaAccountService.ts';
import {
  buildUnusualActivityDiscoveryUrl,
  type MarketTideRegime,
  type ScannerModeId,
} from './src/engine/whaleScannerEngine.ts';
import {
  classifyApiServiceFromPath,
  computeAiAnalysisMetrics,
  computeApiActivityMetrics,
  sanitizePayloadForLog,
} from './src/engine/activityMonitorEngine.ts';
import { computeSmartOrderPortfolioMetrics } from './src/engine/smartOrderEngine.ts';
import {
  type StrategyRegimeId,
  evaluateRegimeWhaleStrategyPipeline,
} from './src/engine/regimeWhaleStrategyEngine.ts';
import {
  discoverLmStudioModels,
  getServerLmStudioCandidateKeys,
} from './src/engine/lmStudioClient.ts';
import {
  buildShortAndDarkPoolTelemetryForHolding,
  computeShortDarkPoolScore,
  evaluateHoldingConfirmationMatrix,
} from './src/engine/shortAndDarkPoolEngine.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE_PATH = path.join(DATA_DIR, 'whale_scanner_db.json');

let pendingPersistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;
let latestQueuedSnapshot: PersistentDatabaseSnapshot | null = null;

async function flushQueuedSnapshotAsync(): Promise<void> {
  if (persistInFlight || !latestQueuedSnapshot) return;
  persistInFlight = true;
  const snapshotToWrite = latestQueuedSnapshot;
  latestQueuedSnapshot = null;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
    }
    const payload = JSON.stringify(snapshotToWrite);
    const tmpPath = `${DB_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmpPath, payload, 'utf-8');
    await fs.promises.rename(tmpPath, DB_FILE_PATH);
  } catch (err) {
    try {
      await fs.promises.writeFile(
        DB_FILE_PATH,
        JSON.stringify(snapshotToWrite),
        'utf-8'
      );
    } catch (fallbackErr) {
      console.error('Failed to persist snapshot to disk:', fallbackErr || err);
    }
  } finally {
    persistInFlight = false;
    if (latestQueuedSnapshot) {
      void flushQueuedSnapshotAsync();
    }
  }
}

function persistSnapshotToDisk(): PersistentDatabaseSnapshot {
  const snapshot = sharedScannerRuntime.exportPersistentSnapshot();
  latestQueuedSnapshot = snapshot;
  if (!pendingPersistTimer) {
    pendingPersistTimer = setTimeout(() => {
      pendingPersistTimer = null;
      void flushQueuedSnapshotAsync();
    }, 250);
  }
  return snapshot;
}

function flushSnapshotToDiskSync(): void {
  try {
    const snapshot =
      latestQueuedSnapshot ?? sharedScannerRuntime.exportPersistentSnapshot();
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(snapshot), 'utf-8');
  } catch {
    // Ignore shutdown write errors
  }
}

process.on('SIGTERM', () => {
  flushSnapshotToDiskSync();
});
process.on('SIGINT', () => {
  flushSnapshotToDiskSync();
});

function loadSnapshotFromDisk(): void {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistentDatabaseSnapshot>;
      sharedScannerRuntime.restorePersistentSnapshot(parsed);
      // Reset transient search filters on server boot so Flow Discovery shows all latest candidates
      sharedScannerRuntime.updateSessionSettings({
        tickerQuery: '',
        statusFilter: 'all',
        directionFilter: 'all',
        includeEtfs: true,
        regimeAdaptiveEnabled: false,
        minScoreFilter: Math.min(
          50,
          sharedScannerRuntime.getSessionSettings().minScoreFilter || 50
        ),
      });
      persistSnapshotToDisk();
      return;
    }
  } catch (err) {
    console.error(
      'Failed to load persistent snapshot, initializing fresh DB:',
      err
    );
  }
  persistSnapshotToDisk();
}

async function startServer() {
  loadSnapshotFromDisk();

  // Warm up market clock, stock data, and Alpaca Trading Account Overview asynchronously without blocking port 3000 bind
  void (async () => {
    const initialClock = await sharedScannerRuntime
      .syncAlpacaMarketClock(true)
      .catch(() => sharedScannerRuntime.getMarketClockState());

    sharedScannerRuntime
      .syncLiveAlpacaStockData()
      .then(() => {
        persistSnapshotToDisk();
      })
      .catch((err) => {
        console.error('Initial Alpaca stock data sync error:', err);
      });

    sharedAlpacaAccountService.syncSmartOrderTickets(
      sharedScannerRuntime.getSmartOrderTickets()
    );
    sharedAlpacaAccountService
      .getAccountOverview(true)
      .then(() => sharedScannerRuntime.syncHoldingsWithAlpacaAccount(false))
      .then(() => {
        sharedAlpacaAccountService.syncSmartOrderTickets(
          sharedScannerRuntime.getSmartOrderTickets()
        );
        if (!initialClock.is_open) {
          sharedScannerRuntime.haltActivityForMarketClosed();
        }
        persistSnapshotToDisk();
      })
      .catch((err) => {
        console.error('Initial Alpaca account overview sync error:', err);
      });
  })();

  // Auto-discover available LM Studio models on startup so discoveredModels and modelId are pre-populated
  const initialLlmConfig = sharedScannerRuntime.getLlmEngineConfig();
  const startupKeys = getServerLmStudioCandidateKeys();
  discoverLmStudioModels(initialLlmConfig.endpointUrl, 5000, startupKeys)
    .then(async (firstScan) => {
      let scanResult = firstScan;
      if (
        !scanResult.reachable &&
        initialLlmConfig.endpointUrl.includes('localhost:1234')
      ) {
        const fallbackScan = await discoverLmStudioModels(
          'http://d17krzcgng2.d.firewalla.org:9210/v1',
          5000,
          startupKeys
        );
        if (fallbackScan.reachable && fallbackScan.models.length > 0) {
          scanResult = fallbackScan;
        }
      }
      if (scanResult.reachable && scanResult.models.length > 0) {
        const preferredId =
          scanResult.models.find((m) => m.state === 'loaded')?.id ??
          scanResult.models[0].id;
        sharedScannerRuntime.updateLlmEngineConfig({
          endpointUrl: scanResult.normalized_openai_base,
          discoveredModels: scanResult.models,
          lastModelScanAt: new Date().toISOString(),
          modelId:
            initialLlmConfig.modelId &&
            scanResult.models.some((m) => m.id === initialLlmConfig.modelId)
              ? initialLlmConfig.modelId
              : preferredId,
        });
        sharedScannerRuntime.markLmStudioCircuitHealthy(
          `${scanResult.normalized_openai_base}/chat/completions`
        );
        persistSnapshotToDisk();
      }
    })
    .catch(() => {
      // Handled gracefully by circuit breaker / manual scan
    });

  // Section 10: Recalculate active candidates every minute in the backend only while market is open
  setInterval(async () => {
    const clock = await sharedScannerRuntime
      .syncAlpacaMarketClock(false)
      .catch(() => sharedScannerRuntime.getMarketClockState());
    if (!clock.is_open) {
      sharedScannerRuntime.haltActivityForMarketClosed();
      return;
    }
    sharedScannerRuntime.runMinuteLifecycleRecalculation();
    persistSnapshotToDisk();
  }, 60_000);

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Automatic API Request / Response / Error Telemetry Middleware
  app.use((req, res, next) => {
    const urlPath = req.originalUrl || req.url || '';
    const isApiRoute =
      urlPath.startsWith('/api/') || urlPath.startsWith('/v1/');
    // Skip passive polling of the activity monitor endpoints themselves to avoid self-amplification
    const isSelfMonitorGet =
      req.method === 'GET' &&
      (urlPath.startsWith('/api/activity/') ||
        urlPath.startsWith('/api/pipeline/telemetry') ||
        urlPath.startsWith('/api/workspace/sync') ||
        urlPath.startsWith('/api/health') ||
        urlPath.startsWith('/api/session/state') ||
        urlPath.startsWith('/api/alpaca/clock'));

    if (!isApiRoute || isSelfMonitorGet) {
      next();
      return;
    }

    const startedAt = Date.now();
    let capturedResponseBody: unknown = null;
    const origJson = res.json.bind(res);
    res.json = (body: unknown) => {
      capturedResponseBody = body;
      return origJson(body);
    };

    res.on('finish', () => {
      const latencyMs = Date.now() - startedAt;
      const { direction, service } = classifyApiServiceFromPath(urlPath);
      const status = res.statusCode;
      const bodyObj = capturedResponseBody as Record<string, unknown> | null;
      const hasExplicitError =
        status >= 400 ||
        Boolean(bodyObj && typeof bodyObj.error === 'string' && bodyObj.error) ||
        Boolean(
          bodyObj &&
            bodyObj.reachable === false &&
            typeof bodyObj.message === 'string'
        );

      const errorMessage =
        status >= 400
          ? typeof bodyObj?.error === 'string'
            ? bodyObj.error
            : `HTTP ${status} error on ${req.method} ${urlPath}`
          : bodyObj?.reachable === false && typeof bodyObj?.message === 'string'
            ? bodyObj.message
            : null;

      sharedScannerRuntime.recordApiActivity({
        direction,
        service,
        method: (req.method as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'GET',
        endpoint: urlPath,
        status_code: status,
        ok: !hasExplicitError,
        latency_ms: latencyMs,
        request_payload: sanitizePayloadForLog({
          query: req.query,
          body: req.body,
        }),
        response_payload: sanitizePayloadForLog(capturedResponseBody),
        error_message: errorMessage,
      });
    });

    next();
  });

  // Production Health & Readiness Endpoint
  app.get('/api/health', (_req, res) => {
    const clock = sharedScannerRuntime.getMarketClockState();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      market_open: clock.is_open,
      market_status: clock.status_label,
      candidates_cached: sharedScannerRuntime.getTelemetryState().contract_cache_count,
    });
  });

  // Coalesced Single-Roundtrip Workspace Sync Endpoint (Candidates + Telemetry)
  app.get('/api/workspace/sync', (req, res) => {
    const mode = (req.query.mode as ScannerModeId) || 'directional_momentum';
    const status = (req.query.status as string) || 'all';
    const direction = (req.query.direction as string) || 'all';
    const ticker = (req.query.ticker as string) || '';
    const minScore = Number(req.query.min_score ?? 50);
    const includeEtfs = req.query.include_etfs !== 'false';
    const regimeAdaptive = req.query.regime_adaptive === 'true';
    const tideRegime = req.query.tide_regime as MarketTideRegime | undefined;
    const adaptiveProfile = req.query.adaptive_profile as any;
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 100);

    const candidates = sharedScannerRuntime.queryCandidates({
      mode,
      status,
      direction,
      ticker,
      min_score: Number.isFinite(minScore) ? minScore : 50,
      include_etfs: includeEtfs,
      regime_adaptive: regimeAdaptive,
      tide_regime: tideRegime,
      adaptive_profile: adaptiveProfile,
      session_date: sessionDate,
      limit,
    });

    const telemetry = sharedScannerRuntime.getTelemetryState(sessionDate);
    res.json({
      candidates,
      telemetry,
    });
  });

  // Cross-Session Settings & Acquired Data Synchronization API
  app.get('/api/session/state', (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    void sharedScannerRuntime
      .syncAlpacaMarketClock(false)
      .then((clock) => {
        if (
          !sharedScannerRuntime.isHistoricalSessionDate(sessionDate) &&
          clock.is_open
        ) {
          return sharedScannerRuntime.syncLiveMarketTideSession(false);
        }
        return undefined;
      })
      .catch(() => undefined);
    const settings = sharedScannerRuntime.getSessionSettings();
    const scanners = sharedScannerRuntime.getScanners();
    const candidates = sharedScannerRuntime.queryCandidates({
      mode: settings.selectedMode,
      status: settings.statusFilter,
      direction: settings.directionFilter,
      ticker: settings.tickerQuery,
      min_score: settings.minScoreFilter,
      include_etfs: settings.includeEtfs,
      regime_adaptive: settings.regimeAdaptiveEnabled,
      tide_regime: settings.activeTideRegime,
      adaptive_profile: settings.activeAdaptiveProfile,
      session_date: sessionDate,
      limit: 50,
    });
    const allCandidates = sharedScannerRuntime.queryCandidates({
      mode: settings.selectedMode,
      status: 'all',
      direction: 'all',
      min_score: 0,
      include_etfs: true,
      regime_adaptive: false,
      tide_regime: settings.activeTideRegime,
      adaptive_profile: settings.activeAdaptiveProfile,
      session_date: sessionDate,
      limit: 100,
    });
    res.json({
      session_settings: settings,
      llm_engine_config: sharedScannerRuntime.getLlmEngineConfig(),
      scanners,
      candidates,
      all_candidates: allCandidates,
      telemetry: sharedScannerRuntime.getTelemetryState(sessionDate),
      available_sessions: sharedScannerRuntime.getAvailableHistoricalSessions(),
    });
  });

  app.put('/api/session/state', (req, res) => {
    const body = req.body ?? {};
    const updated = sharedScannerRuntime.updateSessionSettings({
      selectedMode: body.selectedMode,
      statusFilter: body.statusFilter,
      directionFilter: body.directionFilter,
      tickerQuery: body.tickerQuery,
      minScoreFilter:
        typeof body.minScoreFilter === 'number'
          ? body.minScoreFilter
          : undefined,
      includeEtfs:
        typeof body.includeEtfs === 'boolean' ? body.includeEtfs : undefined,
      regimeAdaptiveEnabled:
        typeof body.regimeAdaptiveEnabled === 'boolean'
          ? body.regimeAdaptiveEnabled
          : undefined,
      activeTideRegime: body.activeTideRegime,
      activeAdaptiveProfile: body.activeAdaptiveProfile,
      selectedCandidateId:
        body.selectedCandidateId !== undefined
          ? body.selectedCandidateId
          : undefined,
    });
    persistSnapshotToDisk();
    res.json({
      session_settings: updated,
      market_tide: sharedScannerRuntime.getMarketTideState(),
      saved_at: updated.updatedAt,
    });
  });

  // Market Tide REST & Regime Switch Endpoints (/api/market/market-tide)
  app.get('/api/market/market-tide', async (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    if (sharedScannerRuntime.isHistoricalSessionDate(sessionDate)) {
      const historicalTide =
        sharedScannerRuntime.getMarketTideState(sessionDate);
      res.json({
        source: historicalTide.data_source ?? 'historical_archive',
        endpoint: 'https://api.unusualwhales.com/api/market/market-tide',
        market_tide: historicalTide,
      });
      return;
    }
    const force = req.query.refresh === 'true' || req.query.refresh === '1';
    const marketTide =
      await sharedScannerRuntime.syncLiveMarketTideSession(force);
    if (force) {
      persistSnapshotToDisk();
    }
    res.json({
      source: marketTide.data_source ?? 'market_tide_engine',
      endpoint: 'https://api.unusualwhales.com/api/market/market-tide',
      market_tide: marketTide,
    });
  });

  app.post('/api/market/market-tide/sync', async (_req, res) => {
    await sharedScannerRuntime
      .syncLiveAlpacaStockData(['SPY', 'QQQ', 'DIA', 'IWM'])
      .catch(() => undefined);
    const marketTide =
      await sharedScannerRuntime.syncLiveMarketTideSession(true);
    persistSnapshotToDisk();
    res.json({
      source: marketTide.data_source ?? 'unusual_whales_live',
      endpoint: 'https://api.unusualwhales.com/api/market/market-tide',
      market_tide: marketTide,
    });
  });

  app.post('/api/market/market-tide/regime', (req, res) => {
    const regime = req.body?.regime as MarketTideRegime | undefined;
    const adaptiveProfile = req.body?.adaptive_profile;
    if (adaptiveProfile) {
      const marketTide =
        sharedScannerRuntime.setAdaptiveProfilePreset(adaptiveProfile);
      persistSnapshotToDisk();
      res.json({
        market_tide: marketTide,
        session_settings: sharedScannerRuntime.getSessionSettings(),
      });
      return;
    }
    const validRegimes: MarketTideRegime[] = [
      'strong_positive',
      'strong_negative',
      'neutral',
      'mixed',
      'reversing',
    ];
    if (!regime || !validRegimes.includes(regime)) {
      res.status(400).json({ error: 'Invalid Market Tide regime specified.' });
      return;
    }
    const marketTide = sharedScannerRuntime.setMarketTideRegimePreset(regime);
    persistSnapshotToDisk();
    res.json({
      market_tide: marketTide,
      session_settings: sharedScannerRuntime.getSessionSettings(),
    });
  });

  // Section 9: Internal Scanner API - GET & POST /v1/scanners
  const getScannersHandler: express.RequestHandler = (_req, res) => {
    res.json({
      scanners: sharedScannerRuntime.getScanners(),
      discovery_url: buildUnusualActivityDiscoveryUrl(),
      uw_token_configured: Boolean(
        process.env.UW_API_TOKEN && process.env.UW_API_TOKEN.trim().length > 0
      ),
    });
  };

  const postScannersHandler: express.RequestHandler = (req, res) => {
    const body = req.body;
    if (!body || !body.name || !body.mode) {
      res.status(400).json({
        error:
          'Scanner name and mode (directional_momentum | accumulation_watch | urgent_flow) are required.',
      });
      return;
    }
    const updated = sharedScannerRuntime.upsertScanner(body);
    persistSnapshotToDisk();
    res.status(201).json(updated);
  };

  const getCandidatesHandler: express.RequestHandler = (req, res) => {
    const { scanner_id } = req.params;
    const status =
      typeof req.query.status === 'string' ? req.query.status : undefined;
    const direction =
      typeof req.query.direction === 'string' ? req.query.direction : undefined;
    const ticker =
      typeof req.query.ticker === 'string' ? req.query.ticker : undefined;
    const mode =
      typeof req.query.mode === 'string'
        ? (req.query.mode as ScannerModeId)
        : undefined;
    const min_score =
      req.query.min_score !== undefined
        ? Number(req.query.min_score)
        : undefined;
    const include_etfs = req.query.include_etfs === 'true';
    const regime_adaptive =
      req.query.regime_adaptive !== undefined
        ? req.query.regime_adaptive === 'true'
        : undefined;
    const tide_regime =
      typeof req.query.tide_regime === 'string'
        ? (req.query.tide_regime as MarketTideRegime)
        : undefined;
    const adaptive_profile =
      typeof req.query.adaptive_profile === 'string'
        ? (req.query.adaptive_profile as any)
        : undefined;
    const session_date =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    const limit =
      req.query.limit !== undefined ? Number(req.query.limit) : 50;

    const candidates = sharedScannerRuntime.queryCandidates({
      scanner_id: scanner_id === 'default' ? undefined : scanner_id,
      mode,
      status,
      direction,
      min_score,
      ticker,
      include_etfs,
      regime_adaptive,
      tide_regime,
      adaptive_profile,
      session_date,
      limit,
    });

    res.json({
      scanner_id,
      session_date:
        session_date && sharedScannerRuntime.isHistoricalSessionDate(session_date)
          ? session_date
          : sharedScannerRuntime.getMarketTideState().session_date,
      count: candidates.length,
      candidates,
    });
  };

  app.get('/v1/scanners', getScannersHandler);
  app.post('/v1/scanners', postScannersHandler);
  app.get('/v1/scanners/:scanner_id/candidates', getCandidatesHandler);

  app.get('/api/v1/scanners', getScannersHandler);
  app.post('/api/v1/scanners', postScannersHandler);
  app.get('/api/v1/scanners/:scanner_id/candidates', getCandidatesHandler);

  // Pipeline Tape Ingestion, Telemetry & Reconciliation routes
  app.get('/api/pipeline/telemetry', async (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    await sharedScannerRuntime
      .syncAlpacaMarketClock(false)
      .catch(() => undefined);
    res.json(sharedScannerRuntime.getTelemetryState(sessionDate));
  });

  // Historical Trading Sessions Calendar Discovery Endpoint
  app.get('/api/history/sessions', (_req, res) => {
    const sessions = sharedScannerRuntime.getAvailableHistoricalSessions();
    res.json({
      latest_session_date:
        sessions.find((s) => s.is_latest)?.date ??
        sharedScannerRuntime.getMarketTideState().session_date,
      sessions,
    });
  });

  app.post('/api/pipeline/ingest-print', (req, res) => {
    const body = req.body;
    if (!body || !body.ticker || !body.option_symbol) {
      res.status(400).json({ error: 'ticker and option_symbol are required.' });
      return;
    }
    const result = sharedScannerRuntime.ingestOptionPrint(body);
    persistSnapshotToDisk();
    res.json(result);
  });

  app.post('/api/pipeline/reconcile', (_req, res) => {
    const report = sharedScannerRuntime.triggerPostCloseReconciliation();
    persistSnapshotToDisk();
    res.json(report);
  });

  app.post('/api/pipeline/recalculate', (_req, res) => {
    const result = sharedScannerRuntime.runMinuteLifecycleRecalculation();
    const snap = persistSnapshotToDisk();
    res.json({
      ...result,
      saved_at: snap.saved_at,
    });
  });

  // Unusual Whales Live Proxy Endpoint
  app.get('/api/uw/unusual', async (_req, res) => {
    const token = process.env.UW_API_TOKEN?.trim();
    const url = buildUnusualActivityDiscoveryUrl();
    if (!token) {
      res.json({
        source: 'local_deterministic_engine',
        endpoint: url,
        candidates: sharedScannerRuntime.queryCandidates({ limit: 50 }),
      });
      return;
    }

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!response.ok) {
        res.status(response.status).json({
          source: 'unusual_whales_api_error',
          status: response.status,
          endpoint: url,
        });
        return;
      }
      const data = await response.json();
      res.json({
        source: 'unusual_whales_live',
        endpoint: url,
        data,
      });
    } catch (err) {
      res.status(502).json({
        source: 'unusual_whales_network_error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // Alpaca Market Data v2 Live Stock & Technical Confirmation Endpoints
  app.get('/api/alpaca/status', (_req, res) => {
    res.json(sharedAlpacaStockService.getStatus());
  });

  // Alpaca Trading API v2 Market Clock Endpoint (/v2/clock)
  app.get('/api/alpaca/clock', async (req, res) => {
    const force = req.query.refresh === 'true' || req.query.refresh === '1';
    const marketClock = await sharedScannerRuntime.syncAlpacaMarketClock(force);
    res.json({
      market_clock: marketClock,
      activity_halted: marketClock.activity_halted,
    });
  });

  app.post('/api/alpaca/clock/sync', async (_req, res) => {
    const marketClock = await sharedScannerRuntime.syncAlpacaMarketClock(true);
    persistSnapshotToDisk();
    res.json({
      market_clock: marketClock,
      telemetry: sharedScannerRuntime.getTelemetryState(),
    });
  });

  app.post('/api/alpaca/sync', async (req, res) => {
    const extraTickers = Array.isArray(req.body?.tickers)
      ? req.body.tickers
      : [];
    const status =
      await sharedScannerRuntime.syncLiveAlpacaStockData(extraTickers);
    persistSnapshotToDisk();
    res.json({
      alpaca_status: status,
      telemetry: sharedScannerRuntime.getTelemetryState(),
    });
  });

  app.get('/api/alpaca/stock-context/:ticker', async (req, res) => {
    const ticker = (req.params.ticker || 'NVDA').toUpperCase();
    const minPremium =
      req.query.min_premium !== undefined
        ? Number(req.query.min_premium)
        : 50_000;

    const [candles1m, candles5m, indicatorSeries, litFlow] = await Promise.all([
      sharedAlpacaStockService.get_ticker_candles_by_range(
        ticker,
        '1m',
        '1d',
        '0d'
      ),
      sharedAlpacaStockService.get_ticker_candles_by_range(
        ticker,
        '5m',
        '5d',
        '0d'
      ),
      sharedAlpacaStockService.get_ticker_indicator_series({
        ticker,
        range: '5m',
        interval: '5d',
        end_interval: '0d',
        indicators: [
          'vwap',
          'ema',
          'atr',
          'rsi',
          'macd',
          'bollinger',
          'adx_di',
        ],
        ema_lengths: [9, 20, 50],
        atr_length: 14,
        rsi_length: 14,
        bollinger_length: 20,
        bollinger_stddev: 2,
        adx_length: 14,
      }),
      sharedAlpacaStockService.get_ticker_lit_flow({
        ticker_symbol: ticker,
        min_premium: minPremium,
        limit: 25,
      }),
    ]);

    const cachedItem = sharedAlpacaStockService.getCachedTicker(ticker);

    res.json({
      ticker,
      alpaca_status: sharedAlpacaStockService.getStatus(),
      quote: cachedItem
        ? {
            latest_price: cachedItem.latest_price,
            daily_open: cachedItem.daily_open,
            daily_high: cachedItem.daily_high,
            daily_low: cachedItem.daily_low,
            daily_close: cachedItem.daily_close,
            daily_volume: cachedItem.daily_volume,
            prev_daily_close: cachedItem.prev_daily_close,
            change_pct: cachedItem.change_pct,
            synced_at: cachedItem.synced_at,
          }
        : null,
      candles_1m_1d: {
        range: candles1m.range,
        interval: candles1m.interval,
        data_source: candles1m.data_source,
        count: candles1m.candles.length,
        candles: candles1m.candles.slice(-30),
      },
      candles_5m_5d: {
        range: candles5m.range,
        interval: candles5m.interval,
        data_source: candles5m.data_source,
        count: candles5m.candles.length,
        candles: candles5m.candles.slice(-40),
      },
      indicator_series: {
        data_source: indicatorSeries.data_source,
        snapshot: indicatorSeries.snapshot,
        series: indicatorSeries.series.slice(-30),
      },
      lit_flow: litFlow,
    });
  });

  // Alpaca Trading API v2 Account Overview, Multi-Timeframe P/L, Day-over-Day P/L & Per-Trade P/L Endpoints
  app.get('/api/alpaca/account-overview', async (req, res) => {
    try {
      const force = req.query.refresh === 'true' || req.query.refresh === '1';
      sharedAlpacaAccountService.syncSmartOrderTickets(
        sharedScannerRuntime.getSmartOrderTickets()
      );
      const overview = await sharedAlpacaAccountService.getAccountOverview(force);
      void sharedScannerRuntime.syncHoldingsWithAlpacaAccount(false).catch(() => undefined);
      res.json(overview);
    } catch {
      res.json(
        sharedAlpacaAccountService.syncSmartOrderTickets(
          sharedScannerRuntime.getSmartOrderTickets()
        )
      );
    }
  });

  const handleRefreshAlpacaOverview = async (
    _req: express.Request,
    res: express.Response
  ) => {
    try {
      sharedAlpacaAccountService.syncSmartOrderTickets(
        sharedScannerRuntime.getSmartOrderTickets()
      );
      const overview = await sharedAlpacaAccountService.getAccountOverview(true);
      await sharedScannerRuntime.syncHoldingsWithAlpacaAccount(false);
      persistSnapshotToDisk();
      res.json(overview);
    } catch {
      res.json(
        sharedAlpacaAccountService.syncSmartOrderTickets(
          sharedScannerRuntime.getSmartOrderTickets()
        )
      );
    }
  };

  app.post('/api/alpaca/account-overview/refresh', handleRefreshAlpacaOverview);
  app.get('/api/alpaca/account-overview/refresh', handleRefreshAlpacaOverview);

  // LM Studio LLM Engine Configuration & Connection Probe Endpoints
  app.get('/api/settings/llm-engine', (_req, res) => {
    res.json({
      llm_engine_config: sharedScannerRuntime.getLlmEngineConfig(),
    });
  });

  app.put('/api/settings/llm-engine', (req, res) => {
    const body = req.body ?? {};
    const endpointUrl =
      typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : '';
    if (endpointUrl && !/^https?:\/\/.+$/.test(endpointUrl)) {
      res.status(400).json({
        error: 'LM Studio endpoint URL must start with http:// or https://',
      });
      return;
    }
    const updated = sharedScannerRuntime.updateLlmEngineConfig(body);
    const snap = persistSnapshotToDisk();
    res.json({
      llm_engine_config: updated,
      saved_at: snap.saved_at,
    });
  });

  app.post('/api/settings/llm-engine/ping', async (req, res) => {
    const current = sharedScannerRuntime.getLlmEngineConfig();
    const rawEndpoint = (
      typeof req.body?.endpointUrl === 'string' && req.body.endpointUrl.trim()
        ? req.body.endpointUrl.trim()
        : current.endpointUrl
    ).replace(/\/+$/, '');

    const customKey =
      typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const candidateKeys = getServerLmStudioCandidateKeys(customKey);

    let scanResult = await discoverLmStudioModels(
      rawEndpoint,
      5000,
      candidateKeys
    );
    if (!scanResult.reachable && rawEndpoint.includes('localhost:1234')) {
      const fallbackTarget = !current.endpointUrl.includes('localhost:1234')
        ? current.endpointUrl
        : 'http://d17krzcgng2.d.firewalla.org:9210/v1';
      const fallbackScan = await discoverLmStudioModels(
        fallbackTarget,
        5000,
        candidateKeys
      );
      if (fallbackScan.reachable && fallbackScan.models.length > 0) {
        scanResult = fallbackScan;
      }
    }
    if (scanResult.reachable && scanResult.models.length > 0) {
      const preferredId =
        scanResult.models.find((m) => m.state === 'loaded')?.id ??
        scanResult.models[0].id;
      sharedScannerRuntime.updateLlmEngineConfig({
        endpointUrl: scanResult.normalized_openai_base,
        discoveredModels: scanResult.models,
        lastModelScanAt: new Date().toISOString(),
        modelId:
          current.modelId &&
          scanResult.models.some((m) => m.id === current.modelId)
            ? current.modelId
            : preferredId,
      });
      sharedScannerRuntime.markLmStudioCircuitHealthy(
        `${scanResult.normalized_openai_base}/chat/completions`
      );
      persistSnapshotToDisk();
    } else if (scanResult.auth_required) {
      sharedScannerRuntime.tripLmStudioCircuit(
        `${scanResult.normalized_openai_base}/chat/completions`,
        'auth_required_401',
        scanResult.message
      );
    } else {
      sharedScannerRuntime.tripLmStudioCircuit(
        `${scanResult.normalized_openai_base}/chat/completions`,
        'fallback_fast_mode',
        scanResult.message
      );
    }

    sharedScannerRuntime.recordApiActivity({
      direction: 'outbound_lm_studio',
      service: 'LM Studio LLM Engine',
      method: 'GET',
      endpoint: scanResult.endpoint_tested,
      status_code: scanResult.status || (scanResult.reachable ? 200 : 502),
      ok: scanResult.reachable,
      latency_ms: scanResult.latency_ms,
      request_payload: JSON.stringify(
        {
          probe: 'lm_studio_model_discovery',
          normalized_openai_base: scanResult.normalized_openai_base,
          bearer_auth_configured: candidateKeys.length > 0,
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          reachable: scanResult.reachable,
          server_online: scanResult.server_online,
          auth_required: scanResult.auth_required,
          status: scanResult.status,
          models_count: scanResult.models.length,
          model_ids: scanResult.model_ids,
          message: scanResult.message,
        },
        null,
        2
      ),
      error_message: scanResult.reachable ? null : scanResult.message,
    });

    const latestConfig = sharedScannerRuntime.getLlmEngineConfig();
    res.json({
      ...scanResult,
      models:
        scanResult.models.length > 0
          ? scanResult.models
          : latestConfig.discoveredModels ?? [],
      llm_engine_config: latestConfig,
      automation_state: sharedScannerRuntime.getAutomationState(),
    });
  });

  // API Activity Monitor & AI Analysis Activity Monitor Endpoints
  app.get('/api/activity/api-logs', (_req, res) => {
    const logs = sharedScannerRuntime.getApiActivityLogs();
    res.json({
      logs,
      metrics: computeApiActivityMetrics(logs),
    });
  });

  app.post('/api/activity/api-logs/probe', async (req, res) => {
    const simulateError = Boolean(req.body?.simulate_error);
    const serviceTarget =
      typeof req.body?.service === 'string' ? req.body.service : 'alpaca';

    if (simulateError) {
      const entry = sharedScannerRuntime.recordApiActivity({
        direction:
          serviceTarget === 'lm_studio'
            ? 'outbound_lm_studio'
            : serviceTarget === 'unusual_whales'
              ? 'outbound_unusual_whales'
              : 'outbound_alpaca',
        service:
          serviceTarget === 'lm_studio'
            ? 'LM Studio LLM Engine'
            : serviceTarget === 'unusual_whales'
              ? 'Unusual Whales API'
              : 'Alpaca Market Data v2',
        method: serviceTarget === 'lm_studio' ? 'POST' : 'GET',
        endpoint:
          serviceTarget === 'lm_studio'
            ? `${sharedScannerRuntime.getLlmEngineConfig().endpointUrl}/chat/completions`
            : serviceTarget === 'unusual_whales'
              ? 'https://api.unusualwhales.com/api/option-activity/unusual?min_premium=50000'
              : 'https://data.alpaca.markets/v2/stocks/bars?symbols=INVALID_TICKER&timeframe=5Min',
        status_code: serviceTarget === 'lm_studio' ? 502 : 422,
        ok: false,
        latency_ms: 34,
        request_payload: JSON.stringify(
          {
            probe_mode: 'simulated_error_diagnostic',
            target_service: serviceTarget,
            parameters: {
              symbol: 'INVALID_TICKER',
              timeframe: '5Min',
            },
          },
          null,
          2
        ),
        response_payload: JSON.stringify(
          {
            error: {
              code:
                serviceTarget === 'lm_studio'
                  ? 'ECONNREFUSED_LOCAL_SERVER'
                  : 'UNPROCESSABLE_SYMBOL_PARAMETER',
              message:
                serviceTarget === 'lm_studio'
                  ? 'Failed to connect to LM Studio inference server on port 1234.'
                  : 'Invalid symbol parameter or upstream rate/validation error.',
            },
          },
          null,
          2
        ),
        error_message:
          serviceTarget === 'lm_studio'
            ? 'HTTP 502 Bad Gateway — LM Studio server refused connection at configured endpoint.'
            : 'HTTP 422 Unprocessable Entity — Upstream API rejected symbol parameter.',
      });
      persistSnapshotToDisk();
      const logs = sharedScannerRuntime.getApiActivityLogs();
      res.json({
        entry,
        logs,
        metrics: computeApiActivityMetrics(logs),
      });
      return;
    }

    const startedAt = Date.now();
    const status = await sharedScannerRuntime.syncLiveAlpacaStockData(['NVDA', 'SPY']);
    const latencyMs = Date.now() - startedAt;
    const entry = sharedScannerRuntime.recordApiActivity({
      direction: 'outbound_alpaca',
      service: 'Alpaca Market Data v2',
      method: 'GET',
      endpoint:
        'https://data.alpaca.markets/v2/stocks/bars?symbols=NVDA,SPY&timeframe=1Min,5Min&feed=sip',
      status_code: 200,
      ok: true,
      latency_ms: latencyMs,
      request_payload: JSON.stringify(
        {
          probe: 'live_alpaca_stock_confirmation_sync',
          symbols: ['NVDA', 'SPY'],
          timeframes: ['1Min (1D)', '5Min (5D)'],
          indicators: [
            'Session VWAP',
            'EMA 9/20/50',
            'ATR 14',
            'RSI 14',
            'MACD',
            'Bollinger(20,2)',
            'ADX 14',
          ],
        },
        null,
        2
      ),
      response_payload: JSON.stringify(
        {
          connected: status.connected,
          feed: status.feed,
          synced_tickers: status.synced_tickers,
          total_bars_cached: status.total_bars_cached,
          total_lit_prints_cached: status.total_lit_prints_cached,
          synced_at: status.last_synced_at,
        },
        null,
        2
      ),
      error_message: status.error,
    });
    persistSnapshotToDisk();
    const logs = sharedScannerRuntime.getApiActivityLogs();
    res.json({
      entry,
      logs,
      metrics: computeApiActivityMetrics(logs),
    });
  });

  app.delete('/api/activity/api-logs', (_req, res) => {
    sharedScannerRuntime.clearApiActivityLogs();
    persistSnapshotToDisk();
    const logs = sharedScannerRuntime.getApiActivityLogs();
    res.json({
      logs,
      metrics: computeApiActivityMetrics(logs),
    });
  });

  app.get('/api/activity/ai-logs', (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    const logs = sharedScannerRuntime.getAiAnalysisLogs(sessionDate);
    res.json({
      logs,
      metrics: computeAiAnalysisMetrics(logs),
      llm_engine_config: sharedScannerRuntime.getLlmEngineConfig(),
    });
  });

  app.post('/api/activity/ai-analysis/run', async (req, res) => {
    try {
      const body = req.body ?? {};
      const entry = await sharedScannerRuntime.executeAiAnalysisForCandidate({
        candidate_id: body.candidate_id,
        ticker: body.ticker,
        analysis_type: body.analysis_type,
        custom_instruction: body.custom_instruction,
        execution_mode: body.execution_mode,
      });
      persistSnapshotToDisk();
      const logs = sharedScannerRuntime.getAiAnalysisLogs();
      res.json({
        entry,
        logs,
        metrics: computeAiAnalysisMetrics(logs),
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to execute AI analysis on candidate.',
      });
    }
  });

  app.post('/api/activity/ai-analysis/auto-start', async (req, res) => {
    try {
      const body = req.body ?? {};
      const clock = await sharedScannerRuntime
        .syncAlpacaMarketClock(false)
        .catch(() => sharedScannerRuntime.getMarketClockState());
      if (!clock.is_open && body.force_when_market_closed !== true) {
        sharedScannerRuntime.haltActivityForMarketClosed();
        const logs = sharedScannerRuntime.getAiAnalysisLogs();
        res.json({
          started: false,
          already_running: false,
          market_closed: true,
          market_clock: clock,
          logs,
          metrics: computeAiAnalysisMetrics(logs),
          telemetry: sharedScannerRuntime.getTelemetryState(),
        });
        return;
      }

      const status = sharedScannerRuntime.startOrEnsureBackendAiActivity({
        trigger_new_if_idle: body.trigger_new_if_idle !== false,
        candidate_id: body.candidate_id,
        force_when_market_closed: body.force_when_market_closed === true,
        onStepComplete: () => {
          persistSnapshotToDisk();
        },
      });
      await new Promise((r) => setTimeout(r, 35));
      persistSnapshotToDisk();
      const logs = sharedScannerRuntime.getAiAnalysisLogs();
      res.json({
        started: status.started,
        already_running: status.already_running,
        market_closed: !clock.is_open,
        market_clock: clock,
        logs,
        metrics: computeAiAnalysisMetrics(logs),
        telemetry: sharedScannerRuntime.getTelemetryState(),
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to auto-start backend AI analysis activity.',
      });
    }
  });

  app.post('/api/activity/ai-analysis/process-pending', async (req, res) => {
    try {
      const body = req.body ?? {};
      const isTargetedSingle = Boolean(body.analysis_id || body.candidate_id);
      if (body.async_background === true || !isTargetedSingle) {
        void sharedScannerRuntime
          .processPendingAiAnalyses({
            analysis_id: body.analysis_id,
            candidate_id: body.candidate_id,
            process_all: body.process_all !== false,
            min_in_flight_ms: 2000,
            onStepComplete: () => {
              persistSnapshotToDisk();
            },
          })
          .catch((err) => {
            console.error('Background processPendingAiAnalyses error:', err);
          });
        await new Promise((r) => setTimeout(r, 35));
        persistSnapshotToDisk();
        const logs = sharedScannerRuntime.getAiAnalysisLogs();
        res.json({
          processed_count: 1,
          background_started: true,
          logs,
          metrics: computeAiAnalysisMetrics(logs),
          llm_decision_records:
            sharedScannerRuntime.getLlmTradeDecisionRecords(),
          smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
          holdings_monitor: sharedScannerRuntime.getHoldingsMonitorState(),
          telemetry: sharedScannerRuntime.getTelemetryState(),
        });
        return;
      }

      const result = await sharedScannerRuntime.processPendingAiAnalyses({
        analysis_id: body.analysis_id,
        candidate_id: body.candidate_id,
        process_all: body.process_all !== false,
        min_in_flight_ms: 1400,
        onStepComplete: () => {
          persistSnapshotToDisk();
        },
      });
      persistSnapshotToDisk();
      res.json({
        processed_count: result.processed_count,
        already_running: result.already_running,
        logs: result.logs,
        metrics: computeAiAnalysisMetrics(result.logs),
        llm_decision_records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
        smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
        holdings_monitor: sharedScannerRuntime.getHoldingsMonitorState(),
        telemetry: sharedScannerRuntime.getTelemetryState(),
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to process pending AI analyses.',
      });
    }
  });

  app.delete('/api/activity/ai-logs', (_req, res) => {
    sharedScannerRuntime.clearAiAnalysisLogs();
    persistSnapshotToDisk();
    const logs = sharedScannerRuntime.getAiAnalysisLogs();
    res.json({
      logs,
      metrics: computeAiAnalysisMetrics(logs),
    });
  });

  // Smart Options Order Filling & Spread-Crossing Engine Endpoints
  app.get('/api/orders/smart-engine/state', (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    const tickets = sharedScannerRuntime.getSmartOrderTickets(sessionDate);
    res.json({
      config: sharedScannerRuntime.getSmartOrderConfig(),
      tickets,
      metrics: computeSmartOrderPortfolioMetrics(tickets),
    });
  });

  app.put('/api/orders/smart-engine/config', (req, res) => {
    const updated = sharedScannerRuntime.updateSmartOrderConfig(req.body ?? {});
    persistSnapshotToDisk();
    const tickets = sharedScannerRuntime.getSmartOrderTickets();
    res.json({
      config: updated,
      tickets,
      metrics: computeSmartOrderPortfolioMetrics(tickets),
    });
  });

  app.post('/api/orders/smart-engine/preview', async (req, res) => {
    try {
      const body = req.body ?? {};
      if (body.sync_live_alpaca && typeof body.ticker === 'string') {
        await sharedScannerRuntime.syncLiveAlpacaStockData([
          body.ticker.toUpperCase(),
        ]);
      }
      const microstructure =
        sharedScannerRuntime.previewSmartOrderForCandidate({
          candidate_id: body.candidate_id,
          ticker: body.ticker,
          side: body.side,
          bid_override:
            typeof body.bid_override === 'number'
              ? body.bid_override
              : undefined,
          ask_override:
            typeof body.ask_override === 'number'
              ? body.ask_override
              : undefined,
          live_spot_override:
            typeof body.live_spot_override === 'number'
              ? body.live_spot_override
              : undefined,
        });
      res.json({
        microstructure,
        config: sharedScannerRuntime.getSmartOrderConfig(),
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to preview option spread microstructure.',
      });
    }
  });

  app.post('/api/orders/smart-engine/execute', async (req, res) => {
    try {
      const body = req.body ?? {};
      if (body.sync_live_alpaca && typeof body.ticker === 'string') {
        await sharedScannerRuntime.syncLiveAlpacaStockData([
          body.ticker.toUpperCase(),
        ]);
      }
      const ticket = sharedScannerRuntime.executeSmartOrderForCandidate({
        candidate_id: body.candidate_id,
        ticker: body.ticker,
        side: body.side,
        qty: typeof body.qty === 'number' ? body.qty : Number(body.qty) || 10,
        algo: body.algo,
        simulate_mode: body.simulate_mode,
        bid_override:
          typeof body.bid_override === 'number' ? body.bid_override : undefined,
        ask_override:
          typeof body.ask_override === 'number' ? body.ask_override : undefined,
      });
      persistSnapshotToDisk();
      const tickets = sharedScannerRuntime.getSmartOrderTickets();
      res.json({
        ticket,
        tickets,
        metrics: computeSmartOrderPortfolioMetrics(tickets),
        llm_decision_records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
        ai_analysis_logs: sharedScannerRuntime.getAiAnalysisLogs(),
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to execute Smart Order ticket.',
      });
    }
  });

  app.post('/api/orders/smart-engine/tickets/:orderId/action', (req, res) => {
    const { orderId } = req.params;
    const action = req.body?.action;
    if (
      action !== 'step_walk' &&
      action !== 'complete_at_fair_value' &&
      action !== 'cancel_order'
    ) {
      res.status(400).json({ error: 'Invalid smart order ticket action.' });
      return;
    }
    const updated = sharedScannerRuntime.advanceSmartOrderTicket(
      orderId,
      action
    );
    if (!updated) {
      res.status(404).json({ error: 'Smart order ticket not found.' });
      return;
    }
    persistSnapshotToDisk();
    const tickets = sharedScannerRuntime.getSmartOrderTickets();
    res.json({
      ticket: updated,
      tickets,
      metrics: computeSmartOrderPortfolioMetrics(tickets),
    });
  });

  app.delete('/api/orders/smart-engine/tickets', (_req, res) => {
    sharedScannerRuntime.clearSmartOrderTickets();
    persistSnapshotToDisk();
    const tickets = sharedScannerRuntime.getSmartOrderTickets();
    res.json({
      tickets,
      metrics: computeSmartOrderPortfolioMetrics(tickets),
    });
  });

  /**
   * Regime-Aware Whale Flow Scanner Strategy API
   */
  app.get('/api/strategy/regime-whale-scanner', (req, res) => {
    const overrideRegime = req.query.regime as StrategyRegimeId | undefined;
    const candidates = sharedScannerRuntime.queryCandidates({
      mode: 'directional_momentum',
      min_score: 0,
      include_etfs: true,
      regime_adaptive: false,
      limit: 50,
    });
    const result = evaluateRegimeWhaleStrategyPipeline({
      marketTide: sharedScannerRuntime.getMarketTideState(),
      candidates,
      overrideRegime:
        overrideRegime === 'bull_expansion' ||
        overrideRegime === 'bear_expansion' ||
        overrideRegime === 'pinned_range' ||
        overrideRegime === 'conflict'
          ? overrideRegime
          : undefined,
    });
    res.json(result);
  });

  /**
   * LLM Trade-Decision Pipeline & Non-Autonomous Gate API
   */
  app.get('/api/llm-decision-pipeline/records', (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    const records = sharedScannerRuntime.getLlmTradeDecisionRecords(sessionDate);
    res.json({
      records,
      risk_policy_config: sharedScannerRuntime.getRiskPolicyConfig(),
      counts: {
        total: records.length,
        execute: records.filter((r) => r.llm_output.decision === 'EXECUTE').length,
        watch: records.filter((r) => r.llm_output.decision === 'WATCH').length,
        skip: records.filter((r) => r.llm_output.decision === 'SKIP').length,
        human_review: records.filter(
          (r) => r.llm_output.decision === 'HUMAN REVIEW'
        ).length,
      },
    });
  });

  app.put('/api/llm-decision-pipeline/risk-policy', (req, res) => {
    const updatedPolicy = sharedScannerRuntime.updateRiskPolicyConfig(
      req.body ?? {}
    );
    persistSnapshotToDisk();
    res.json({
      risk_policy_config: updatedPolicy,
      records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
    });
  });

  app.post('/api/llm-decision-pipeline/recalculate-risk', (req, res) => {
    const decisionId = req.body?.decision_id;
    if (!decisionId) {
      res.status(400).json({ error: 'Missing decision_id.' });
      return;
    }
    const updatedRecord =
      sharedScannerRuntime.recalculateRiskFirstExecutionForDecision({
        decision_id: decisionId,
        policy: req.body?.policy,
        planned_entry_override:
          typeof req.body?.planned_entry_override === 'number'
            ? req.body.planned_entry_override
            : undefined,
        contract_stop_override:
          typeof req.body?.contract_stop_override === 'number'
            ? req.body.contract_stop_override
            : undefined,
      });
    if (!updatedRecord) {
      res.status(404).json({ error: 'Decision record not found.' });
      return;
    }
    persistSnapshotToDisk();
    res.json({
      decision_record: updatedRecord,
      risk_policy_config: sharedScannerRuntime.getRiskPolicyConfig(),
      records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
    });
  });

  app.post('/api/llm-decision-pipeline/evaluate', async (req, res) => {
    try {
      const record =
        await sharedScannerRuntime.evaluateLlmTradeDecisionForCandidate({
          candidate_id: req.body?.candidate_id,
          ticker: req.body?.ticker,
          override_regime: req.body?.override_regime,
          per_trade_max_risk_dollars: req.body?.per_trade_max_risk_dollars,
          max_daily_loss_dollars: req.body?.max_daily_loss_dollars,
          stress_scenario: req.body?.stress_scenario,
          execution_mode: req.body?.execution_mode,
          client_raw_llm_content: req.body?.client_raw_llm_content,
          client_raw_stage2_llm_content: req.body?.client_raw_stage2_llm_content,
          auto_fulfill_smart_order: Boolean(req.body?.auto_fulfill_smart_order),
        });
      persistSnapshotToDisk();
      const records = sharedScannerRuntime.getLlmTradeDecisionRecords();
      res.json({
        record,
        records,
        smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
        api_activity_logs: sharedScannerRuntime.getApiActivityLogs(),
        ai_analysis_logs: sharedScannerRuntime.getAiAnalysisLogs(),
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to evaluate LLM Trade-Decision Pipeline.',
      });
    }
  });

  app.post('/api/llm-decision-pipeline/stage2-risk-fulfill', async (req, res) => {
    try {
      const decisionId = req.body?.decision_id;
      if (!decisionId) {
        res.status(400).json({ error: 'Missing decision_id.' });
        return;
      }
      const { decision_record, staged_ticket } =
        await sharedScannerRuntime.runStage2LlmRiskAssessmentAndFulfill({
          decision_id: decisionId,
          fulfill_smart_order: req.body?.fulfill_smart_order !== false,
          client_raw_stage2_llm_content: req.body?.client_raw_stage2_llm_content,
        });
      if (!decision_record) {
        res.status(404).json({ error: 'Decision record not found.' });
        return;
      }
      persistSnapshotToDisk();
      res.json({
        decision_record,
        staged_ticket,
        records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
        smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
        api_activity_logs: sharedScannerRuntime.getApiActivityLogs(),
        ai_analysis_logs: sharedScannerRuntime.getAiAnalysisLogs(),
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to run Stage-2 LLM Risk & Order Size Assessment.',
      });
    }
  });

  app.post('/api/llm-decision-pipeline/approve', (req, res) => {
    const decisionId = req.body?.decision_id;
    const action = req.body?.action;
    if (
      !decisionId ||
      (action !== 'approve_and_stage_smart_order' &&
        action !== 'move_to_watchlist' &&
        action !== 'reject_decision')
    ) {
      res.status(400).json({ error: 'Invalid decision_id or approval action.' });
      return;
    }

    const { decision_record, staged_ticket } =
      sharedScannerRuntime.updateLlmTradeDecisionApproval({
        decision_id: decisionId,
        action,
      });

    if (!decision_record) {
      res.status(404).json({ error: 'Decision record not found.' });
      return;
    }

    persistSnapshotToDisk();
    res.json({
      decision_record,
      staged_ticket,
      records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
      smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
    });
  });

  /**
   * End-to-End Automated Pipeline (Scan -> Stage-1 LLM -> Stage-2 Risk & Sizing -> Auto Place Order)
   */
  app.get('/api/pipeline/automation', (_req, res) => {
    res.json({
      automation_state: sharedScannerRuntime.getAutomationState(),
      records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
      smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
    });
  });

  app.put('/api/pipeline/automation', (req, res) => {
    const updated = sharedScannerRuntime.updateAutomationConfig(req.body ?? {});
    persistSnapshotToDisk();
    res.json({
      automation_state: updated,
      llm_engine_config: sharedScannerRuntime.getLlmEngineConfig(),
      holdings_monitor: sharedScannerRuntime.getHoldingsMonitorState(),
    });
  });

  app.post('/api/pipeline/auto-execute', async (req, res) => {
    try {
      if (req.body?.stream_live_tick === true) {
        await sharedScannerRuntime.ingestLiveMarketAndWhaleStream({
          injectDiscoverySweep: true,
        });
      }
      const result = await sharedScannerRuntime.runAutomatedPipelineCycle({
        candidate_id: req.body?.candidate_id,
        force_re_evaluate: req.body?.force_re_evaluate !== false,
        max_candidates:
          typeof req.body?.max_candidates === 'number'
            ? req.body.max_candidates
            : undefined,
      });
      persistSnapshotToDisk();
      const settings = sharedScannerRuntime.getSessionSettings();
      const candidates = sharedScannerRuntime.queryCandidates({
        mode: settings.selectedMode,
        status: settings.statusFilter,
        direction: settings.directionFilter,
        ticker: settings.tickerQuery,
        min_score: settings.minScoreFilter,
        include_etfs: settings.includeEtfs,
        regime_adaptive: settings.regimeAdaptiveEnabled,
        tide_regime: settings.activeTideRegime,
        adaptive_profile: settings.activeAdaptiveProfile,
        limit: 50,
      });
      res.json({
        ...result,
        candidates,
        records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
        smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
        api_activity_logs: sharedScannerRuntime.getApiActivityLogs(),
        telemetry: sharedScannerRuntime.getTelemetryState(),
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to execute automated pipeline cycle.',
      });
    }
  });

  app.post('/api/pipeline/stream-live-tick', async (req, res) => {
    try {
      const streamRes =
        await sharedScannerRuntime.ingestLiveMarketAndWhaleStream({
          injectDiscoverySweep: req.body?.inject_discovery_sweep !== false,
        });
      const autoRes = await sharedScannerRuntime.runAutomatedPipelineCycle({
        force_re_evaluate: false,
      });
      persistSnapshotToDisk();
      const settings = sharedScannerRuntime.getSessionSettings();
      const candidates = sharedScannerRuntime.queryCandidates({
        mode: settings.selectedMode,
        status: settings.statusFilter,
        direction: settings.directionFilter,
        ticker: settings.tickerQuery,
        min_score: settings.minScoreFilter,
        include_etfs: settings.includeEtfs,
        regime_adaptive: settings.regimeAdaptiveEnabled,
        tide_regime: settings.activeTideRegime,
        adaptive_profile: settings.activeAdaptiveProfile,
        limit: 50,
      });
      res.json({
        stream_result: streamRes,
        ...autoRes,
        candidates,
        records: sharedScannerRuntime.getLlmTradeDecisionRecords(),
        smart_order_tickets: sharedScannerRuntime.getSmartOrderTickets(),
        api_activity_logs: sharedScannerRuntime.getApiActivityLogs(),
        telemetry: sharedScannerRuntime.getTelemetryState(),
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to stream live tick and execute automated pipeline.',
      });
    }
  });

  /**
   * Holdings Monitor With Unusual Whales, Alpaca & LLM Exit Plans Routes
   */
  app.get('/api/holdings-monitor', async (req, res) => {
    const force = req.query.refresh === 'true' || req.query.refresh === '1';
    const state = await sharedScannerRuntime.syncHoldingsWithAlpacaAccount(force);
    res.json(state);
  });

  app.get('/api/holdings-monitor/short-darkpool/:ticker', (req, res) => {
    const ticker = String(req.params.ticker || 'AAPL').toUpperCase();
    const side = req.query.side === 'short' ? 'short' : 'long';
    const spot = Number(req.query.spot) || 199.8;
    const vwap = Number(req.query.vwap) || 199.1;
    const scenario =
      typeof req.query.scenario === 'string'
        ? (req.query.scenario as any)
        : 'default';

    const bundle = buildShortAndDarkPoolTelemetryForHolding({
      ticker,
      spot_price: spot,
      vwap,
      effective_position_side: side,
      scenario_override: scenario,
    });
    const score = computeShortDarkPoolScore({
      position_side: side,
      dark_pool: {
        price_behavior: bundle.dark_pool_telemetry.primary_zone_behavior,
      },
      short: {
        shares_available_change_5d:
          bundle.short_telemetry.shares_available_change_5d,
        borrow_fee_change_5d: bundle.short_telemetry.borrow_fee_change_5d,
        days_to_cover: bundle.short_telemetry.days_to_cover,
        short_interest_pct_float:
          bundle.short_telemetry.short_interest_pct_float,
        short_volume_ratio_latest:
          bundle.short_telemetry.short_volume_ratio_latest,
      },
    });
    const matrix = evaluateHoldingConfirmationMatrix({
      effective_position_side: side,
      raw_holding_side: side,
      spot_price: spot,
      intraday_vwap: vwap,
      realized_move_pct: (spot - vwap) / vwap,
      relative_volume: 1.45,
      cumulative_net_call_premium: 1_250_000,
      cumulative_net_put_premium: 850_000,
      contract_net_premium: 240_000,
      repeated_bearish_flow: false,
      repeated_bullish_flow: true,
      short_telemetry: bundle.short_telemetry,
      dark_pool_telemetry: bundle.dark_pool_telemetry,
    });

    res.json({
      ticker,
      short_telemetry: bundle.short_telemetry,
      dark_pool_telemetry: bundle.dark_pool_telemetry,
      short_darkpool_score: score,
      confirmation_matrix: matrix,
      llm_feature_payload: bundle.llm_feature_payload,
    });
  });

  app.post('/api/holdings-monitor/evaluate', async (req, res) => {
    try {
      const holdingId = String(req.body?.holding_id || '');
      if (!holdingId) {
        res.status(400).json({ error: 'holding_id is required.' });
        return;
      }
      const result = await sharedScannerRuntime.evaluateHoldingWithLlm({
        holding_id: holdingId,
        override_decision: req.body?.override_decision,
        simulate_scenario: req.body?.simulate_scenario,
      });
      if (!result) {
        res.status(404).json({ error: 'Holding not found.' });
        return;
      }
      persistSnapshotToDisk();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to evaluate holding with LLM.',
      });
    }
  });

  app.put('/api/holdings-monitor/config', (req, res) => {
    const holdingId = String(req.body?.holding_id || '');
    if (!holdingId) {
      res.status(400).json({ error: 'holding_id is required.' });
      return;
    }
    const updated = sharedScannerRuntime.updateHoldingMonitorConfig({
      holding_id: holdingId,
      mode: req.body?.mode,
      enabled: req.body?.enabled,
      risk_config: req.body?.risk_config,
    });
    if (!updated) {
      res.status(404).json({ error: 'Holding not found.' });
      return;
    }
    persistSnapshotToDisk();
    res.json({
      holding: updated,
      state: sharedScannerRuntime.getHoldingsMonitorState(),
    });
  });

  app.post('/api/holdings-monitor/environment', (req, res) => {
    const env = req.body?.environment === 'live' ? 'live' : 'paper';
    const state = sharedScannerRuntime.setHoldingsEnvironmentAndMfa({
      environment: env,
      mfa_code: req.body?.mfa_code,
    });
    persistSnapshotToDisk();
    res.json(state);
  });

  app.post('/api/holdings-monitor/approve-plan', async (req, res) => {
    try {
      const planId = String(req.body?.plan_id || '');
      const action = req.body?.action === 'reject' ? 'reject' : 'approve';
      if (!planId) {
        res.status(400).json({ error: 'plan_id is required.' });
        return;
      }
      const result = await sharedScannerRuntime.approveOrRejectHoldingExitPlan({
        plan_id: planId,
        action,
        operator_name: req.body?.operator_name,
        mfa_code: req.body?.mfa_code,
        limit_price_override:
          typeof req.body?.limit_price_override === 'number'
            ? req.body.limit_price_override
            : undefined,
      });
      if (!result) {
        res.status(404).json({ error: 'Exit plan not found.' });
        return;
      }
      persistSnapshotToDisk();
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to approve or reject exit plan.',
      });
    }
  });

  app.delete('/api/holdings-monitor/orders/:orderId', async (req, res) => {
    try {
      const orderId = String(req.params.orderId || '');
      const result = await sharedScannerRuntime.cancelOpenHoldingOrder(orderId);
      persistSnapshotToDisk();
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error ? err.message : 'Failed to cancel open order.',
      });
    }
  });

  // Self-Learning Bake-Testing & Post-Trade Retrospective API Endpoints
  app.get('/api/backtest-learning/state', (req, res) => {
    const sessionDate =
      typeof req.query.session_date === 'string'
        ? req.query.session_date
        : undefined;
    res.json(sharedScannerRuntime.getSelfLearningBacktestState(sessionDate));
  });

  app.post('/api/backtest-learning/query-deep', async (req, res) => {
    try {
      const activityId = String(req.body?.activity_id || '');
      if (!activityId) {
        res.status(400).json({ error: 'activity_id is required.' });
        return;
      }
      const result =
        await sharedScannerRuntime.queryDeepBacktestTelemetryForActivity(
          activityId
        );
      persistSnapshotToDisk();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to query deeper Alpaca + Unusual Whales post-trade telemetry.',
      });
    }
  });

  app.post('/api/backtest-learning/analyze-llm', async (req, res) => {
    try {
      const activityId = String(req.body?.activity_id || '');
      if (!activityId) {
        res.status(400).json({ error: 'activity_id is required.' });
        return;
      }
      const result = await sharedScannerRuntime.analyzeBacktestActivityWithLlm({
        activity_id: activityId,
        extract_learned_rule: req.body?.extract_learned_rule !== false,
        client_raw_llm_content: req.body?.client_raw_llm_content ?? null,
      });
      persistSnapshotToDisk();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to run LLM bake-test grading & root-cause analysis.',
      });
    }
  });

  app.post('/api/backtest-learning/run-batch', async (req, res) => {
    try {
      const maxActivities =
        typeof req.body?.max_activities === 'number'
          ? req.body.max_activities
          : 6;
      const result = await sharedScannerRuntime.runBatchSelfLearningBacktest({
        max_activities: maxActivities,
      });
      persistSnapshotToDisk();
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to run batch self-learning bake-test.',
      });
    }
  });

  app.post('/api/backtest-learning/rules/toggle', (req, res) => {
    const ruleId = String(req.body?.rule_id || '');
    if (!ruleId) {
      res.status(400).json({ error: 'rule_id is required.' });
      return;
    }
    const result = sharedScannerRuntime.toggleLearnedConditionRule(
      ruleId,
      typeof req.body?.active === 'boolean' ? req.body.active : undefined
    );
    persistSnapshotToDisk();
    res.json(result);
  });

  app.post('/api/backtest-learning/rules/upsert', (req, res) => {
    const title = String(req.body?.title || '').trim();
    const instruction = String(
      req.body?.prompt_injection_instruction || ''
    ).trim();
    if (!title || !instruction) {
      res.status(400).json({
        error: 'Both title and prompt_injection_instruction are required.',
      });
      return;
    }
    const result = sharedScannerRuntime.upsertLearnedConditionRule(req.body);
    persistSnapshotToDisk();
    res.json(result);
  });

  // Start continuous background scanner & auto-order placement daemon (halted automatically when market is closed)
  let backgroundCycleRunning = false;
  setInterval(async () => {
    if (backgroundCycleRunning) return;
    backgroundCycleRunning = true;
    try {
      const clock = await sharedScannerRuntime
        .syncAlpacaMarketClock(false)
        .catch(() => sharedScannerRuntime.getMarketClockState());
      if (!clock.is_open) {
        sharedScannerRuntime.haltActivityForMarketClosed();
        return;
      }

      await sharedScannerRuntime.syncLiveAlpacaStockData().catch(() => undefined);
      const autoState = sharedScannerRuntime.getAutomationState();
      if (autoState.auto_pilot_enabled) {
        // Always drain any pending AI analysis items in the backend queue
        sharedScannerRuntime.startOrEnsureBackendAiActivity({
          trigger_new_if_idle: false,
          onStepComplete: () => {
            persistSnapshotToDisk();
          },
        });
        const lastCycleMs = autoState.last_cycle_at
          ? new Date(autoState.last_cycle_at).getTime()
          : 0;
        const intervalMs = Math.max(
          10_000,
          (autoState.scan_interval_seconds || 20) * 1000
        );
        if (Date.now() - lastCycleMs >= intervalMs - 1500) {
          await sharedScannerRuntime.runAutomatedPipelineCycle({
            force_re_evaluate: false,
          });
          persistSnapshotToDisk();
        }
      }
    } catch (err) {
      console.error('Background scanner daemon error:', err);
    } finally {
      backgroundCycleRunning = false;
    }
  }, 10_000);

  // Trigger an initial background scan & order placement check shortly after boot only if market is open
  setTimeout(async () => {
    try {
      const clock = await sharedScannerRuntime
        .syncAlpacaMarketClock(false)
        .catch(() => sharedScannerRuntime.getMarketClockState());
      if (!clock.is_open) {
        sharedScannerRuntime.haltActivityForMarketClosed();
        persistSnapshotToDisk();
        return;
      }
      const autoState = sharedScannerRuntime.getAutomationState();
      if (autoState.auto_pilot_enabled) {
        sharedScannerRuntime.startOrEnsureBackendAiActivity({
          trigger_new_if_idle: false,
          onStepComplete: () => {
            persistSnapshotToDisk();
          },
        });
        await sharedScannerRuntime.runAutomatedPipelineCycle({
          force_re_evaluate: false,
        });
        persistSnapshotToDisk();
      }
    } catch {
      // ignore startup auto-cycle errors
    }
  }, 1500);

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.all('/api/*', (req, res) => {
      res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`WhalePulse Scanner server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
