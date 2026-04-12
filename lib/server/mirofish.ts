import 'server-only';

import { createHmac } from 'crypto';

interface MiroFishConfig {
  baseUrl: string;
  apiBaseUrl: string;
  apiKey: string | null;
  embedSecret: string | null;
}

interface MiroFishEmbedTokenInput {
  classroomId: string;
  simulationId: string;
  reportId?: string;
}

function normalizeBaseUrl(rawUrl: string, envName: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error(`${envName} is not configured`);
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${envName} must use http or https`);
  }

  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function createUrlFromBase(baseUrl: string, relativePath: string) {
  return new URL(
    relativePath.replace(/^\/+/, ''),
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  );
}

export function getMiroFishConfig(): MiroFishConfig {
  const baseUrl = normalizeBaseUrl(
    process.env.MIROFISH_BASE_URL?.trim() || '',
    'MIROFISH_BASE_URL',
  );
  const apiBaseUrl = normalizeBaseUrl(
    process.env.MIROFISH_API_BASE_URL?.trim() || baseUrl,
    'MIROFISH_API_BASE_URL',
  );

  return {
    baseUrl,
    apiBaseUrl,
    apiKey: process.env.MIROFISH_API_KEY?.trim() || null,
    embedSecret: process.env.MIROFISH_EMBED_SECRET?.trim() || null,
  };
}

function buildApiHeaders(config: MiroFishConfig) {
  if (!config.apiKey) {
    return undefined;
  }

  return {
    Authorization: `Bearer ${config.apiKey}`,
    'x-api-key': config.apiKey,
  };
}

async function validateMiroFishResource(
  path: string,
  resourceLabel: 'simulation' | 'report',
): Promise<void> {
  const config = getMiroFishConfig();
  const url = createUrlFromBase(config.apiBaseUrl, path);
  const response = await fetch(url, {
    method: 'GET',
    headers: buildApiHeaders(config),
    cache: 'no-store',
  });

  if (response.ok) {
    return;
  }

  if (response.status === 404) {
    throw new Error(`MiroFish ${resourceLabel} was not found`);
  }

  const responseText = await response.text().catch(() => '');
  throw new Error(
    `MiroFish ${resourceLabel} validation failed (${response.status})${responseText ? `: ${responseText.slice(0, 200)}` : ''}`,
  );
}

export async function validateMiroFishSimulation(simulationId: string) {
  await validateMiroFishResource(`/api/simulation/${encodeURIComponent(simulationId)}`, 'simulation');
}

export async function validateMiroFishReport(reportId: string) {
  await validateMiroFishResource(`/api/report/${encodeURIComponent(reportId)}`, 'report');
}

export function buildMiroFishRunUrl(simulationId: string) {
  const config = getMiroFishConfig();
  const url = createUrlFromBase(
    config.baseUrl,
    `/simulation/${encodeURIComponent(simulationId)}/start`,
  );
  url.searchParams.set('embed', '1');
  return url.toString();
}

export function buildMiroFishReportUrl(reportId: string) {
  const config = getMiroFishConfig();
  const url = createUrlFromBase(config.baseUrl, `/report/${encodeURIComponent(reportId)}`);
  url.searchParams.set('embed', '1');
  return url.toString();
}

export function createMiroFishEmbedToken(input: MiroFishEmbedTokenInput) {
  const { embedSecret } = getMiroFishConfig();
  if (!embedSecret) {
    return null;
  }

  // Keep embed tokens stable across polling and valid for a typical class session.
  const validityWindowSeconds = 2 * 60 * 60;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp =
    Math.floor(nowSeconds / validityWindowSeconds) * validityWindowSeconds +
    validityWindowSeconds;

  const payload = Buffer.from(
    JSON.stringify({
      classroomId: input.classroomId,
      simulationId: input.simulationId,
      reportId: input.reportId,
      exp,
    }),
    'utf-8',
  ).toString('base64url');
  const signature = createHmac('sha256', embedSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function withMiroFishEmbedToken(
  urlString: string,
  input: MiroFishEmbedTokenInput,
): string {
  const url = new URL(urlString);
  url.searchParams.set('embed', '1');

  const embedToken = createMiroFishEmbedToken(input);
  if (embedToken) {
    url.searchParams.set('classroomToken', embedToken);
  }

  return url.toString();
}
