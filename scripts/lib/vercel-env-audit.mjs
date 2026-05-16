export const REQUIRED_PRODUCTION_KEYS = [
  'DATABASE_URL',
  'RAIC_SECRET_ENCRYPTION_KEY',
  'BLOB_READ_WRITE_TOKEN',
  'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_ID',
];

export const LLM_PROVIDER_KEY_CANDIDATES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
  'KIMI_API_KEY',
  'MINIMAX_API_KEY',
  'GLM_API_KEY',
  'SILICONFLOW_API_KEY',
  'DOUBAO_API_KEY',
  'OPENROUTER_API_KEY',
  'GROK_API_KEY',
  'TENCENT_API_KEY',
  'TENCENT_HUNYUAN_API_KEY',
  'XIAOMI_API_KEY',
  'MIMO_API_KEY',
];

export function parseAuditContexts(rawValue = 'production') {
  const contexts = String(rawValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return contexts.length > 0 ? [...new Set(contexts)] : ['production'];
}

export function envTargets(envRecord) {
  const rawTargets = envRecord?.target ?? envRecord?.targets ?? [];
  if (Array.isArray(rawTargets)) {
    return rawTargets.map(String);
  }
  if (typeof rawTargets === 'string' && rawTargets.trim()) {
    return [rawTargets.trim()];
  }
  return [];
}

export function envAppliesToContext(envRecord, context) {
  return envTargets(envRecord).includes(context);
}

export function keysForContext(envRecords, context) {
  return new Set(
    envRecords
      .filter((envRecord) => envRecord?.key && envAppliesToContext(envRecord, context))
      .map((envRecord) => envRecord.key),
  );
}

export function auditEnvRecords({
  envRecords,
  contexts = ['production'],
  requiredKeys = REQUIRED_PRODUCTION_KEYS,
  llmProviderKeys = LLM_PROVIDER_KEY_CANDIDATES,
}) {
  return contexts.map((context) => {
    const presentKeys = keysForContext(envRecords, context);
    const missingRequiredKeys = requiredKeys.filter((key) => !presentKeys.has(key));
    const presentLlmProviderKeys = llmProviderKeys.filter((key) => presentKeys.has(key));

    return {
      context,
      required: requiredKeys.map((key) => ({ key, present: presentKeys.has(key) })),
      missingRequiredKeys,
      presentLlmProviderKeys,
      llmProviderReady: presentLlmProviderKeys.length > 0,
      ok: missingRequiredKeys.length === 0 && presentLlmProviderKeys.length > 0,
    };
  });
}

export function summarizeAudit(auditResults) {
  const missingContexts = auditResults.filter((result) => !result.ok);
  return {
    ok: missingContexts.length === 0,
    missingContexts,
  };
}

export function manualFallbackLines({ projectId, teamId, contexts }) {
  return [
    '[vercel-env-audit] Manual fallback:',
    `- Open Vercel project environment settings for ${projectId || '<project id>'}.`,
    `- Scope/team: ${teamId || '<team id or personal scope>'}.`,
    `- Confirm these contexts: ${contexts.join(', ')}.`,
    `- Required keys: ${REQUIRED_PRODUCTION_KEYS.join(', ')}.`,
    `- At least one LLM provider key: ${LLM_PROVIDER_KEY_CANDIDATES.join(', ')}.`,
    '- Do not paste or print secret values; record only present/missing status.',
  ];
}
