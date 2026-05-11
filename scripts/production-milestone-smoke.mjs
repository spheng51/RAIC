#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'https://open-raic.com';
const DEFAULT_MISSING_CLASSROOM_ID = 'missing-milestone-smoke-404';

const baseUrl = normalizeBaseUrl(process.env.RAIC_PRODUCTION_BASE_URL || DEFAULT_BASE_URL);
const missingClassroomId =
  process.env.RAIC_SMOKE_MISSING_CLASSROOM_ID || DEFAULT_MISSING_CLASSROOM_ID;
const allowBlockers = process.argv.includes('--allow-blockers');

const results = [];

function normalizeBaseUrl(rawValue) {
  const parsed = new URL(rawValue);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function record(status, label, detail) {
  results.push({ status, label, detail });
  const prefix = status.toUpperCase().padEnd(7);
  console.log(`[production-smoke] ${prefix} ${label}${detail ? ` - ${detail}` : ''}`);
}

function pass(label, detail) {
  record('pass', label, detail);
}

function fail(label, detail) {
  record('fail', label, detail);
}

function block(label, detail) {
  record('block', label, detail);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body = null;

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return { response, body };
}

function hasEnabledSecretProvider(groups, groupName) {
  const group = groups?.[groupName];
  if (!group || typeof group !== 'object') return false;
  return Object.values(group).some((entry) => entry?.enabled === true && entry?.hasSecret === true);
}

function allowedModelsInclude(groups, groupName, providerId, modelId) {
  const models = groups?.[groupName]?.[providerId]?.allowedModels;
  return Array.isArray(models) && models.includes(modelId);
}

async function checkHealth() {
  const { response, body } = await fetchJson('/api/health');
  if (response.status !== 200 || body?.success !== true) {
    fail('/api/health', `expected HTTP 200 success:true, got HTTP ${response.status}`);
    return;
  }

  const readiness = body.readiness || {};
  const authReady = readiness.auth?.ready === true;
  const encryptionReady = readiness.encryption?.ready === true;
  const storageReady = readiness.storage?.ready === true;
  const postgresMode = readiness.storage?.mode === 'postgres';

  if (authReady && encryptionReady && storageReady && postgresMode) {
    pass('/api/health core readiness', 'auth, encryption, and Postgres storage are ready');
  } else {
    fail(
      '/api/health core readiness',
      `auth=${authReady} encryption=${encryptionReady} storage=${storageReady} mode=${
        readiness.storage?.mode || 'unknown'
      }`,
    );
  }

  if (readiness.mirofish?.ready === true) {
    pass('MiroFish readiness', 'production MiroFish env is configured');
  } else {
    block('MiroFish readiness', readiness.mirofish?.reason || 'MiroFish is not ready');
  }
}

async function checkProviderReadiness() {
  const { response: serverProvidersResponse, body: serverProviders } =
    await fetchJson('/api/server-providers');
  if (serverProvidersResponse.status !== 200 || serverProviders?.success !== true) {
    fail(
      '/api/server-providers',
      `expected HTTP 200 success:true, got HTTP ${serverProvidersResponse.status}`,
    );
  } else {
    pass('/api/server-providers', 'endpoint responds');
  }

  const { response, body } = await fetchJson('/api/ai/options');
  if (response.status !== 200 || body?.success !== true) {
    fail('/api/ai/options', `expected HTTP 200 success:true, got HTTP ${response.status}`);
    return;
  }

  const providers = body.providers || {};
  if (hasEnabledSecretProvider(providers, 'llm')) {
    pass('LLM provider readiness', 'at least one server-backed LLM is enabled');
  } else {
    block(
      'LLM provider readiness',
      'no server-backed LLM provider is enabled with a secret; authenticated classroom generation cannot complete',
    );
  }

  if (allowedModelsInclude(providers, 'llm', 'openai', 'gpt-5.5')) {
    pass('LLM model registry', 'OpenAI gpt-5.5 is exposed through /api/ai/options');
  } else {
    fail('LLM model registry', 'OpenAI gpt-5.5 is missing from /api/ai/options');
  }

  if (allowedModelsInclude(providers, 'tts', 'elevenlabs-tts', 'eleven_v3')) {
    pass('TTS model registry', 'ElevenLabs eleven_v3 is exposed through /api/ai/options');
  } else {
    fail('TTS model registry', 'ElevenLabs eleven_v3 is missing from /api/ai/options');
  }
}

async function checkFriendlyProviderErrors() {
  const { response, body } = await fetchJson('/api/verify-model', {
    method: 'POST',
    body: JSON.stringify({
      model: 'openai:gpt-5.5',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
    }),
  });

  if (response.status === 400 && body?.errorCode === 'MISSING_API_KEY') {
    pass('/api/verify-model missing-key behavior', body.error);
  } else {
    fail(
      '/api/verify-model missing-key behavior',
      `expected HTTP 400 MISSING_API_KEY, got HTTP ${response.status} ${body?.errorCode || ''}`,
    );
  }
}

async function checkAuthGuard() {
  const { response, body } = await fetchJson('/api/generate-classroom', {
    method: 'POST',
    body: JSON.stringify({
      requirement: 'Create a tiny classroom lesson about Newton second law.',
      enableWebSearch: false,
      enableImageGeneration: false,
      enableVideoGeneration: false,
      enableTTS: false,
    }),
  });

  if (response.status === 401 && body?.errorCode === 'UNAUTHORIZED') {
    pass('/api/generate-classroom unauthenticated guard', body.error);
  } else {
    fail(
      '/api/generate-classroom unauthenticated guard',
      `expected HTTP 401 UNAUTHORIZED, got HTTP ${response.status} ${body?.errorCode || ''}`,
    );
  }
}

async function checkMissingClassroom404s() {
  const paths = [
    `/api/classroom?id=${encodeURIComponent(missingClassroomId)}`,
    `/api/classroom/${encodeURIComponent(missingClassroomId)}/session-context`,
    `/api/classroom/${encodeURIComponent(missingClassroomId)}/collaboration-state`,
    `/api/classroom/${encodeURIComponent(missingClassroomId)}/presentation-state`,
  ];

  for (const path of paths) {
    const { response, body } = await fetchJson(path);
    if (
      response.status === 404 &&
      body?.success === false &&
      body?.error === 'Classroom not found'
    ) {
      pass(`missing classroom ${path}`, 'clean classroom 404');
    } else {
      fail(
        `missing classroom ${path}`,
        `expected HTTP 404 Classroom not found, got HTTP ${response.status} ${JSON.stringify(body)}`,
      );
    }
  }
}

async function main() {
  console.log(`[production-smoke] Base URL: ${baseUrl}`);
  await checkHealth();
  await checkProviderReadiness();
  await checkFriendlyProviderErrors();
  await checkAuthGuard();
  await checkMissingClassroom404s();

  const failures = results.filter((result) => result.status === 'fail');
  const blockers = results.filter((result) => result.status === 'block');

  console.log(
    `[production-smoke] Summary: ${results.length - failures.length - blockers.length} passed, ${
      failures.length
    } failed, ${blockers.length} blocked`,
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  } else if (blockers.length > 0 && !allowBlockers) {
    process.exitCode = 2;
  }
}

await main();
