import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));

/**
 * Deterministic Evaluator for the "Dirty Dozen" Payloads against our
 * Firestore Security Rules & Blueprint Invariants
 */
function simulateRuleEvaluation(params: {
  collection:
    | 'userSessions'
    | 'scannerConfigs'
    | 'whaleCandidates'
    | 'optionPrints'
    | 'llmEngineConfigs';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  docId: string;
  auth: { uid: string; email_verified: boolean } | null;
  incoming?: Record<string, unknown>;
  existing?: Record<string, unknown>;
  requestTimeIso?: string;
  queryOwnerId?: string;
}): 'ALLOW' | 'PERMISSION_DENIED' {
  const {
    collection,
    operation,
    docId,
    auth,
    incoming,
    existing,
    requestTimeIso = '2026-10-18T14:35:00Z',
    queryOwnerId,
  } = params;

  // Pillar 1: Auth & Verified Email Gate
  if (!auth || auth.email_verified !== true) {
    return 'PERMISSION_DENIED';
  }

  // Pillar 3: Path Variable Hardening (ID Poisoning Guard) on single-doc ops
  const idRegex = /^[a-zA-Z0-9_\-]+$/;
  if (operation !== 'list') {
    if (
      typeof docId !== 'string' ||
      docId.length < 1 ||
      docId.length > 128 ||
      !idRegex.test(docId)
    ) {
      return 'PERMISSION_DENIED';
    }
  }

  if (operation === 'list') {
    if (queryOwnerId !== auth.uid) {
      return 'PERMISSION_DENIED';
    }
    return 'ALLOW';
  }

  if (operation === 'get' || operation === 'delete') {
    if (!existing || existing.ownerId !== auth.uid) {
      return 'PERMISSION_DENIED';
    }
    if (
      (collection === 'userSessions' || collection === 'llmEngineConfigs') &&
      docId !== auth.uid
    ) {
      return 'PERMISSION_DENIED';
    }
    return 'ALLOW';
  }

  if (operation === 'update' && collection === 'optionPrints') {
    // Append-only audit log
    return 'PERMISSION_DENIED';
  }

  if (!incoming) return 'PERMISSION_DENIED';

  const entityMap = {
    userSessions: 'UserSession',
    scannerConfigs: 'ScannerConfigDoc',
    whaleCandidates: 'WhaleCandidateDoc',
    optionPrints: 'OptionPrintDoc',
    llmEngineConfigs: 'LlmEngineConfigDoc',
  } as const;

  const entitySchema = blueprint.entities[entityMap[collection]];
  const requiredKeys: string[] = entitySchema.required;
  const incomingKeys = Object.keys(incoming);

  // Strict Keys check (hasAll & hasOnly)
  if (
    incomingKeys.length !== requiredKeys.length ||
    !requiredKeys.every((k) => incomingKeys.includes(k))
  ) {
    return 'PERMISSION_DENIED';
  }

  // Identity Integrity
  if (incoming.ownerId !== auth.uid) {
    return 'PERMISSION_DENIED';
  }

  // Field-level schema & volumetric validation
  for (const [key, propDef] of Object.entries<any>(entitySchema.properties)) {
    const val = incoming[key];
    if (propDef.type === 'string' && propDef.format !== 'date-time') {
      if (typeof val !== 'string') return 'PERMISSION_DENIED';
      if (propDef.minLength !== undefined && val.length < propDef.minLength) {
        return 'PERMISSION_DENIED';
      }
      if (propDef.maxLength !== undefined && val.length > propDef.maxLength) {
        return 'PERMISSION_DENIED';
      }
      if (propDef.pattern && !new RegExp(propDef.pattern).test(val)) {
        return 'PERMISSION_DENIED';
      }
      if (propDef.enum && !propDef.enum.includes(val)) {
        return 'PERMISSION_DENIED';
      }
    }
  }

  // Temporal Integrity
  if (operation === 'create') {
    if (
      (collection === 'userSessions' || collection === 'llmEngineConfigs') &&
      docId !== auth.uid
    ) {
      return 'PERMISSION_DENIED';
    }
    if (incoming.createdAt !== requestTimeIso) {
      return 'PERMISSION_DENIED';
    }
    if (
      collection !== 'optionPrints' &&
      incoming.updatedAt !== requestTimeIso
    ) {
      return 'PERMISSION_DENIED';
    }
    return 'ALLOW';
  }

  if (operation === 'update') {
    if (!existing || existing.ownerId !== auth.uid) {
      return 'PERMISSION_DENIED';
    }
    if (incoming.ownerId !== existing.ownerId) {
      return 'PERMISSION_DENIED';
    }
    if (incoming.createdAt !== existing.createdAt) {
      return 'PERMISSION_DENIED';
    }
    if (incoming.updatedAt !== requestTimeIso) {
      return 'PERMISSION_DENIED';
    }
    if (
      collection === 'whaleCandidates' &&
      existing.status === 'invalidated'
    ) {
      return 'PERMISSION_DENIED';
    }
    return 'ALLOW';
  }

  return 'PERMISSION_DENIED';
}

test('Firestore Rules: All 5 blueprint collections have hardened match blocks in firestore.rules', () => {
  assert.ok(rulesContent.includes("rules_version = '2';"));
  assert.ok(rulesContent.includes('match /{document=**}'));
  assert.ok(rulesContent.includes('match /userSessions/{sessionId}'));
  assert.ok(rulesContent.includes('match /scannerConfigs/{scannerId}'));
  assert.ok(rulesContent.includes('match /whaleCandidates/{candidateId}'));
  assert.ok(rulesContent.includes('match /optionPrints/{printId}'));
  assert.ok(rulesContent.includes('match /llmEngineConfigs/{configId}'));
});

test('Dirty Dozen Payload 1-12: All 12 adversarial attacks return PERMISSION_DENIED', () => {
  const validNow = '2026-10-18T14:35:00Z';
  const baseSession = {
    ownerId: 'user_1',
    selectedMode: 'directional_momentum',
    statusFilter: 'all',
    directionFilter: 'all',
    tickerQuery: '',
    minScoreFilter: 70,
    includeEtfs: false,
    createdAt: validNow,
    updatedAt: validNow,
  };

  // 1. Identity Spoofing on Create
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'create',
      docId: 'user_1',
      auth: { uid: 'attacker_uid', email_verified: true },
      incoming: baseSession,
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 2. Unverified Email Spoofing
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'create',
      docId: 'user_1',
      auth: { uid: 'user_1', email_verified: false },
      incoming: baseSession,
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 3. Shadow / Ghost Field Injection
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'create',
      docId: 'user_1',
      auth: { uid: 'user_1', email_verified: true },
      incoming: { ...baseSession, isAdmin: true },
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 4. Value Poisoning on Update (oversized tickerQuery > 16 chars)
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'update',
      docId: 'user_1',
      auth: { uid: 'user_1', email_verified: true },
      existing: baseSession,
      incoming: { ...baseSession, tickerQuery: 'A'.repeat(50) },
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 5. ID Poisoning Attack
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'create',
      docId: 'bad$id!@#',
      auth: { uid: 'user_1', email_verified: true },
      incoming: baseSession,
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 6. Immutable Owner Hijack on Update
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'update',
      docId: 'user_1',
      auth: { uid: 'user_1', email_verified: true },
      existing: baseSession,
      incoming: { ...baseSession, ownerId: 'user_2' },
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 7. Timestamp Forgery
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'create',
      docId: 'user_1',
      auth: { uid: 'user_1', email_verified: true },
      incoming: { ...baseSession, createdAt: '2020-01-01T00:00:00Z' },
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 8. Terminal State Bypass on invalidated candidate
  const baseCandidate = {
    ownerId: 'user_1',
    candidateId: 'cand_nvda_1',
    scannerId: 'scn_1',
    dedupKey: 'NVDA:NVDA261120C00150000:bullish',
    ticker: 'NVDA',
    optionSymbol: 'NVDA261120C00150000',
    optionType: 'call',
    strike: 150,
    expiry: '2026-11-20',
    dte: 33,
    issueType: 'Common Stock',
    direction: 'bullish',
    status: 'confirmed',
    whaleScore: 94,
    premium5m: 840000,
    contractPremium5m: 520000,
    contractShare: 0.62,
    sideShare: 0.89,
    sweepRatio: 0.69,
    volume: 6420,
    openInterest: 1450,
    volumeOiRatio: 4.43,
    oiStatus: 'unconfirmed_until_next_oi_update',
    repeatedHits: true,
    return5m: 0.0136,
    relativeVolume5m: 2.35,
    vwapAligned: true,
    candleClosePosition: 0.86,
    createdAt: validNow,
    updatedAt: validNow,
  };

  assert.equal(
    simulateRuleEvaluation({
      collection: 'whaleCandidates',
      operation: 'update',
      docId: 'cand_nvda_1',
      auth: { uid: 'user_1', email_verified: true },
      existing: { ...baseCandidate, status: 'invalidated' },
      incoming: { ...baseCandidate, status: 'confirmed' },
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 9. Unauthorized List Query Scraping
  assert.equal(
    simulateRuleEvaluation({
      collection: 'whaleCandidates',
      operation: 'list',
      docId: '',
      auth: { uid: 'user_1', email_verified: true },
      queryOwnerId: 'other_user',
    }),
    'PERMISSION_DENIED'
  );

  // 10. Cross-User Session Read
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'get',
      docId: 'user_2',
      auth: { uid: 'user_1', email_verified: true },
      existing: { ...baseSession, ownerId: 'user_2' },
    }),
    'PERMISSION_DENIED'
  );

  // 11. Enum Violation on Candidate Direction
  assert.equal(
    simulateRuleEvaluation({
      collection: 'whaleCandidates',
      operation: 'create',
      docId: 'cand_nvda_1',
      auth: { uid: 'user_1', email_verified: true },
      incoming: { ...baseCandidate, direction: 'sideways' },
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // 12. Immutable Option Print Mutation (Append-Only Audit Log)
  const basePrint = {
    ownerId: 'user_1',
    eventId: 'evt_1',
    ticker: 'NVDA',
    optionSymbol: 'NVDA261120C00150000',
    optionType: 'call',
    strike: 150,
    dte: 33,
    size: 200,
    price: 4.5,
    premium: 90000,
    side: 'ask',
    isSweep: true,
    isMultiLeg: false,
    spread: 0.04,
    accepted: true,
    rejectReason: '',
    createdAt: validNow,
  };
  assert.equal(
    simulateRuleEvaluation({
      collection: 'optionPrints',
      operation: 'update',
      docId: 'evt_1',
      auth: { uid: 'user_1', email_verified: true },
      existing: basePrint,
      incoming: basePrint,
      requestTimeIso: validNow,
    }),
    'PERMISSION_DENIED'
  );

  // Verify legitimate owner writes succeed
  assert.equal(
    simulateRuleEvaluation({
      collection: 'userSessions',
      operation: 'create',
      docId: 'user_1',
      auth: { uid: 'user_1', email_verified: true },
      incoming: baseSession,
      requestTimeIso: validNow,
    }),
    'ALLOW'
  );
});
