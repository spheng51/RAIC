'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  KeyRound,
  Plus,
  Save,
  Shield,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ASR_PROVIDERS, TTS_PROVIDERS } from '@/lib/audio/constants';
import { PROVIDERS } from '@/lib/ai/providers';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import { cn } from '@/lib/utils';
import type {
  AIPolicySettings,
  AIProviderDefinition,
  AIProviderFamily,
  AIProviderSource,
  EffectiveAIOption,
  EffectiveAIOptionsResponse,
} from '@/lib/types/ai-governance';

type PersistenceMode = 'postgres' | 'json';

interface AdminConfigSnapshot {
  policy: AIPolicySettings;
  configs: Array<{
    family: AIProviderFamily;
    providerId: string;
    enabled: boolean;
    baseUrl?: string | null;
    allowedModels?: string[];
    defaultModel?: string | null;
    hasSecret?: boolean;
    definition?: AIProviderDefinition | null;
    updatedAt?: string;
  }>;
}

interface RegistryProvider {
  family: AIProviderFamily;
  providerId: string;
  name: string;
  providerType?: 'openai' | 'anthropic' | 'google';
  defaultBaseUrl?: string;
  icon?: string;
  requiresApiKey: boolean;
  models: string[];
  isCustom: boolean;
}

interface ProviderDraft {
  family: AIProviderFamily;
  providerId: string;
  enabled: boolean;
  baseUrl: string;
  allowedModelsText: string;
  defaultModel: string;
  secret: string;
  clearSecret: boolean;
  hasSecret: boolean;
  definition: AIProviderDefinition | null;
  updatedAt?: string;
  touched: boolean;
}

interface AIGovernanceConsoleProps {
  persistenceMode: PersistenceMode;
  encryptionReady: boolean;
  initialConfig: AdminConfigSnapshot;
  initialOptions: EffectiveAIOptionsResponse;
}

const FAMILY_ORDER: AIProviderFamily[] = [
  'llm',
  'tts',
  'asr',
  'pdf',
  'image',
  'video',
  'webSearch',
];

const FAMILY_LABELS: Record<AIProviderFamily, string> = {
  llm: 'LLM',
  tts: 'Text to Speech',
  asr: 'Speech to Text',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  webSearch: 'Web Search',
};

const SOURCE_LABELS: Record<AIProviderSource, string> = {
  personal: 'Personal override',
  organization: 'Organization',
  bootstrap: 'Bootstrap',
  legacy: 'Local request credentials',
  none: 'Not configured',
};

function makeProviderKey(family: AIProviderFamily, providerId: string) {
  return `${family}:${providerId}`;
}

function parseModelList(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function serializeModelList(models?: string[]) {
  return (models ?? []).join('\n');
}

function buildRegistryProviders(
  snapshot: AdminConfigSnapshot,
  options: EffectiveAIOptionsResponse,
) {
  const builtIns: Record<AIProviderFamily, RegistryProvider[]> = {
    llm: Object.values(PROVIDERS).map((provider) => ({
      family: 'llm',
      providerId: provider.id,
      name: provider.name,
      providerType: provider.type,
      defaultBaseUrl: provider.defaultBaseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      models: provider.models.map((model) => model.id),
      isCustom: false,
    })),
    tts: Object.values(TTS_PROVIDERS).map((provider) => ({
      family: 'tts',
      providerId: provider.id,
      name: provider.name,
      defaultBaseUrl: provider.defaultBaseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      models: provider.models.map((model) => model.id),
      isCustom: false,
    })),
    asr: Object.values(ASR_PROVIDERS).map((provider) => ({
      family: 'asr',
      providerId: provider.id,
      name: provider.name,
      defaultBaseUrl: provider.defaultBaseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      models: provider.models.map((model) => model.id),
      isCustom: false,
    })),
    pdf: Object.values(PDF_PROVIDERS).map((provider) => ({
      family: 'pdf',
      providerId: provider.id,
      name: provider.name,
      defaultBaseUrl: provider.baseUrl,
      icon: provider.icon,
      requiresApiKey: provider.requiresApiKey,
      models: [],
      isCustom: false,
    })),
    image: Object.values(IMAGE_PROVIDERS).map((provider) => ({
      family: 'image',
      providerId: provider.id,
      name: provider.name,
      defaultBaseUrl: provider.defaultBaseUrl,
      requiresApiKey: provider.requiresApiKey,
      models: provider.models.map((model) => model.id),
      isCustom: false,
    })),
    video: Object.values(VIDEO_PROVIDERS).map((provider) => ({
      family: 'video',
      providerId: provider.id,
      name: provider.name,
      defaultBaseUrl: provider.defaultBaseUrl,
      requiresApiKey: provider.requiresApiKey,
      models: provider.models.map((model) => model.id),
      isCustom: false,
    })),
    webSearch: Object.values(WEB_SEARCH_PROVIDERS).map((provider) => ({
      family: 'webSearch',
      providerId: provider.id,
      name: provider.name,
      defaultBaseUrl: provider.defaultBaseUrl,
      requiresApiKey: provider.requiresApiKey,
      models: [],
      isCustom: false,
    })),
  };

  const customProviders = new Map<string, RegistryProvider>();
  for (const config of snapshot.configs) {
    if (config.family !== 'llm' || !config.definition) continue;
    customProviders.set(makeProviderKey(config.family, config.providerId), {
      family: 'llm',
      providerId: config.providerId,
      name: config.definition.name,
      providerType: config.definition.providerType,
      defaultBaseUrl: config.definition.defaultBaseUrl,
      icon: config.definition.icon,
      requiresApiKey: config.definition.requiresApiKey ?? true,
      models: config.definition.models?.map((model) => model.id) ?? [],
      isCustom: true,
    });
  }

  for (const [providerId, option] of Object.entries(options.providers.llm)) {
    if (!option.isCustom || customProviders.has(makeProviderKey('llm', providerId))) continue;
    customProviders.set(makeProviderKey('llm', providerId), {
      family: 'llm',
      providerId,
      name: option.displayName || providerId,
      providerType: option.providerType,
      defaultBaseUrl: option.baseUrl,
      icon: option.icon,
      requiresApiKey: option.requiresApiKey ?? true,
      models: option.allowedModels ?? [],
      isCustom: true,
    });
  }

  return {
    ...builtIns,
    llm: [
      ...builtIns.llm,
      ...Array.from(customProviders.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    ],
  } satisfies Record<AIProviderFamily, RegistryProvider[]>;
}

function buildDraftFromSources(input: {
  provider: RegistryProvider;
  snapshotConfig?: AdminConfigSnapshot['configs'][number];
  option?: EffectiveAIOption;
}): ProviderDraft {
  const { provider, snapshotConfig, option } = input;
  const allowedModels = snapshotConfig?.allowedModels?.length
    ? snapshotConfig.allowedModels
    : option?.allowedModels?.length
      ? option.allowedModels
      : provider.models;

  const definition =
    snapshotConfig?.definition ??
    (provider.isCustom
      ? {
          name: provider.name,
          providerType: provider.providerType,
          defaultBaseUrl: provider.defaultBaseUrl,
          icon: provider.icon,
          requiresApiKey: provider.requiresApiKey,
          models: provider.models.map((modelId) => ({
            id: modelId,
            name: modelId,
          })),
        }
      : null);

  return {
    family: provider.family,
    providerId: provider.providerId,
    enabled: snapshotConfig?.enabled ?? false,
    baseUrl: snapshotConfig?.baseUrl ?? '',
    allowedModelsText: serializeModelList(allowedModels),
    defaultModel: snapshotConfig?.defaultModel ?? option?.defaultModel ?? '',
    secret: '',
    clearSecret: false,
    hasSecret: snapshotConfig?.hasSecret ?? false,
    definition,
    updatedAt: snapshotConfig?.updatedAt,
    touched: false,
  };
}

function buildDraftMap(
  registry: Record<AIProviderFamily, RegistryProvider[]>,
  snapshot: AdminConfigSnapshot,
  options: EffectiveAIOptionsResponse,
) {
  const snapshotMap = new Map(
    snapshot.configs.map((config) => [makeProviderKey(config.family, config.providerId), config]),
  );
  const drafts: Record<string, ProviderDraft> = {};

  for (const family of FAMILY_ORDER) {
    for (const provider of registry[family]) {
      const key = makeProviderKey(family, provider.providerId);
      const snapshotConfig = snapshotMap.get(key);
      if (!snapshotConfig) continue;
      drafts[key] = buildDraftFromSources({
        provider,
        snapshotConfig,
        option: options.providers[family][provider.providerId],
      });
    }
  }

  return drafts;
}

function countEnabledConfigs(snapshot: AdminConfigSnapshot) {
  return snapshot.configs.filter((config) => config.enabled).length;
}

function nextCustomProviderId(registry: Record<AIProviderFamily, RegistryProvider[]>) {
  const existing = new Set(registry.llm.map((provider) => provider.providerId));
  let index = registry.llm.filter((provider) => provider.isCustom).length + 1;
  while (existing.has(`custom-org-${index}`)) {
    index += 1;
  }
  return `custom-org-${index}`;
}

export function AIGovernanceConsole({
  persistenceMode,
  encryptionReady,
  initialConfig,
  initialOptions,
}: AIGovernanceConsoleProps) {
  const [policy, setPolicy] = useState(initialConfig.policy);
  const [snapshot, setSnapshot] = useState(initialConfig);
  const [effectiveOptions, setEffectiveOptions] = useState(initialOptions);
  const [drafts, setDrafts] = useState(() =>
    buildDraftMap(
      buildRegistryProviders(initialConfig, initialOptions),
      initialConfig,
      initialOptions,
    ),
  );
  const [selectedFamily, setSelectedFamily] = useState<AIProviderFamily>('llm');
  const [selectedProviderId, setSelectedProviderId] = useState<string>('openai');
  const [isPending, startTransition] = useTransition();

  const registry = useMemo(
    () => buildRegistryProviders(snapshot, effectiveOptions),
    [snapshot, effectiveOptions],
  );

  const selectedProvider =
    registry[selectedFamily].find((provider) => provider.providerId === selectedProviderId) ??
    registry[selectedFamily][0];

  const selectedKey = selectedProvider
    ? makeProviderKey(selectedProvider.family, selectedProvider.providerId)
    : null;

  const selectedOption = selectedProvider
    ? effectiveOptions.providers[selectedProvider.family][selectedProvider.providerId]
    : undefined;

  const currentDraft =
    selectedProvider && selectedKey
      ? (drafts[selectedKey] ??
        buildDraftFromSources({
          provider: selectedProvider,
          option: selectedOption,
        }))
      : null;

  const parsedAllowedModels = currentDraft ? parseModelList(currentDraft.allowedModelsText) : [];
  const isReadOnly = !encryptionReady || isPending;

  const updateDraft = (
    provider: RegistryProvider,
    updater: (draft: ProviderDraft) => ProviderDraft,
  ) => {
    const key = makeProviderKey(provider.family, provider.providerId);
    setDrafts((current) => {
      const base =
        current[key] ??
        buildDraftFromSources({
          provider,
          option: effectiveOptions.providers[provider.family][provider.providerId],
        });
      return {
        ...current,
        [key]: {
          ...updater(base),
          touched: true,
        },
      };
    });
  };

  const handleAddCustomProvider = () => {
    const providerId = nextCustomProviderId(registry);

    setDrafts((current) => ({
      ...current,
      [makeProviderKey('llm', providerId)]: {
        family: 'llm',
        providerId,
        enabled: false,
        baseUrl: '',
        allowedModelsText: '',
        defaultModel: '',
        secret: '',
        clearSecret: false,
        hasSecret: false,
        definition: {
          name: `Custom Provider ${providerId.replace('custom-org-', '#')}`,
          providerType: 'openai',
          defaultBaseUrl: '',
          requiresApiKey: true,
          models: [],
        },
        touched: true,
      },
    }));

    setSnapshot((current) => ({
      ...current,
      configs: [
        ...current.configs,
        {
          family: 'llm',
          providerId,
          enabled: false,
          baseUrl: '',
          allowedModels: [],
          defaultModel: null,
          hasSecret: false,
          definition: {
            name: `Custom Provider ${providerId.replace('custom-org-', '#')}`,
            providerType: 'openai',
            defaultBaseUrl: '',
            requiresApiKey: true,
            models: [],
          },
        },
      ],
    }));

    setSelectedFamily('llm');
    setSelectedProviderId(providerId);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        const configs = Object.values(drafts)
          .filter((draft) => {
            const hasExisting = snapshot.configs.some(
              (config) => config.family === draft.family && config.providerId === draft.providerId,
            );
            return hasExisting || draft.touched || draft.enabled || !!draft.definition;
          })
          .map((draft) => {
            const allowedModels = parseModelList(draft.allowedModelsText);
            const baseUrl = draft.baseUrl.trim();
            const secret = draft.secret.trim();
            const definition =
              draft.family === 'llm' && draft.definition
                ? {
                    ...draft.definition,
                    name: draft.definition.name.trim() || draft.providerId,
                    defaultBaseUrl: baseUrl || draft.definition.defaultBaseUrl || undefined,
                    models: allowedModels.map((modelId) => ({
                      id: modelId,
                      name: modelId,
                    })),
                  }
                : draft.definition;

            return {
              family: draft.family,
              providerId: draft.providerId,
              enabled: draft.enabled,
              baseUrl: baseUrl || null,
              allowedModels,
              defaultModel: draft.defaultModel.trim() || null,
              ...(secret ? { secret } : {}),
              ...(draft.clearSecret ? { clearSecret: true } : {}),
              ...(definition ? { definition } : {}),
            };
          });

        const response = await fetch('/api/admin/ai/config', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            policy,
            configs,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Save failed' }));
          throw new Error(errorData.error || 'Save failed');
        }

        const savedPayload = (await response.json()) as { success?: boolean } & AdminConfigSnapshot;
        setPolicy(savedPayload.policy);
        setSnapshot(savedPayload);

        let nextOptions = effectiveOptions;
        const optionsResponse = await fetch('/api/ai/options');
        if (optionsResponse.ok) {
          const optionsPayload = (await optionsResponse.json()) as {
            success?: boolean;
          } & EffectiveAIOptionsResponse;
          nextOptions = optionsPayload;
          setEffectiveOptions(optionsPayload);
        }

        setDrafts(
          buildDraftMap(
            buildRegistryProviders(savedPayload, nextOptions),
            savedPayload,
            nextOptions,
          ),
        );
        toast.success('Organization AI settings saved');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save AI settings');
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_2fr]">
        <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(17,24,39,0.02),transparent),radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_58%)]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                <Shield className="mr-1 size-3.5" />
                Governance
              </Badge>
              <Badge variant="outline">
                <Database className="mr-1 size-3.5" />
                {persistenceMode === 'postgres' ? 'Postgres' : 'JSON fallback'}
              </Badge>
            </div>
            <CardTitle>Organization AI policy</CardTitle>
            <CardDescription>
              Choose whether teachers can save personal server-side overrides and whether those
              overrides may change provider base URLs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-background/80 p-4">
              <div>
                <p className="font-medium text-foreground">Allow personal overrides</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Teachers can store their own provider secrets for approved provider IDs.
                </p>
              </div>
              <Switch
                checked={policy.allowPersonalOverrides}
                disabled={isReadOnly}
                onCheckedChange={(checked) =>
                  setPolicy((current) => ({
                    ...current,
                    allowPersonalOverrides: checked,
                    allowPersonalCustomBaseUrls: checked
                      ? current.allowPersonalCustomBaseUrls
                      : false,
                  }))
                }
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-background/80 p-4">
              <div>
                <p className="font-medium text-foreground">Allow personal custom base URLs</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Teachers can point approved providers at their own endpoints instead of the org
                  default.
                </p>
              </div>
              <Switch
                checked={policy.allowPersonalCustomBaseUrls}
                disabled={isReadOnly || !policy.allowPersonalOverrides}
                onCheckedChange={(checked) =>
                  setPolicy((current) => ({
                    ...current,
                    allowPersonalCustomBaseUrls: checked,
                  }))
                }
              />
            </div>

            {!encryptionReady && (
              <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Encrypted credential storage is unavailable</p>
                    <p className="mt-1 text-amber-800/90">
                      Set <code>RAIC_SECRET_ENCRYPTION_KEY</code> to enable org-managed saves.
                      Bootstrap providers still work, but this console is read-only until the key is
                      configured.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{countEnabledConfigs(snapshot)} org-managed configs</Badge>
              <Badge variant="outline">
                {
                  Object.values(effectiveOptions.providers.llm).filter((option) => option.isCustom)
                    .length
                }{' '}
                custom LLMs
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Save target</CardTitle>
            <CardDescription>
              Org configs become the default path for authenticated studio and admin requests.
              Background jobs only use org-managed or bootstrap credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-primary" />
                Effective options
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Source badges, default models, and allowlists are all derived from the same resolver
                used by generation routes.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <KeyRound className="size-4 text-primary" />
                Encrypted secrets
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Credentials are stored with AES-256-GCM and never returned to the browser after
                save.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wand2 className="size-4 text-primary" />
                Scope enforcement
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Org-scoped studio, classroom, and admin requests must use bootstrap, org-managed, or
                policy-approved personal credentials. Request-supplied credentials only apply
                outside organization-managed flows.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Provider controls</CardTitle>
              <CardDescription>
                Enable providers by family, store org credentials, define model allowlists, and
                approve custom LLM providers.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {selectedFamily === 'llm' && (
                <Button
                  variant="outline"
                  onClick={handleAddCustomProvider}
                  disabled={isReadOnly}
                  data-testid="add-custom-llm"
                >
                  <Plus className="mr-1.5 size-4" />
                  Custom LLM
                </Button>
              )}
              <Button onClick={handleSave} disabled={isReadOnly} data-testid="save-org-ai-config">
                <Save className="mr-1.5 size-4" />
                {isPending ? 'Saving...' : 'Save org AI config'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs
            value={selectedFamily}
            onValueChange={(value) => {
              const family = value as AIProviderFamily;
              setSelectedFamily(family);
              setSelectedProviderId(registry[family][0]?.providerId || '');
            }}
          >
            <TabsList variant="line" className="mb-5 flex w-full flex-wrap justify-start">
              {FAMILY_ORDER.map((family) => (
                <TabsTrigger key={family} value={family} className="flex-none">
                  {FAMILY_LABELS[family]}
                </TabsTrigger>
              ))}
            </TabsList>

            {FAMILY_ORDER.map((family) => {
              const providers = registry[family];
              const selectedInFamily =
                providers.find((provider) => provider.providerId === selectedProviderId) ??
                providers[0];

              return (
                <TabsContent key={family} value={family}>
                  <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      {providers.map((provider) => {
                        const option =
                          effectiveOptions.providers[provider.family][provider.providerId];
                        const key = makeProviderKey(provider.family, provider.providerId);
                        const draft =
                          drafts[key] ??
                          buildDraftFromSources({
                            provider,
                            option,
                          });
                        const isSelected =
                          selectedInFamily?.providerId === provider.providerId &&
                          selectedFamily === family;

                        return (
                          <button
                            key={provider.providerId}
                            type="button"
                            data-testid={`admin-provider-${provider.family}-${provider.providerId}`}
                            onClick={() => setSelectedProviderId(provider.providerId)}
                            className={cn(
                              'w-full rounded-2xl border p-4 text-left transition-colors',
                              isSelected
                                ? 'border-primary/60 bg-primary/5 shadow-sm'
                                : 'border-border/60 bg-background hover:border-primary/30 hover:bg-muted/40',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {provider.name}
                                </p>
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  {provider.providerId}
                                </p>
                              </div>
                              <Switch
                                checked={draft.enabled}
                                disabled={isReadOnly}
                                onCheckedChange={(checked) =>
                                  updateDraft(provider, (current) => ({
                                    ...current,
                                    enabled: checked,
                                  }))
                                }
                                onClick={(event) => event.stopPropagation()}
                              />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge variant={draft.enabled ? 'default' : 'outline'}>
                                {draft.enabled ? 'Enabled' : 'Disabled'}
                              </Badge>
                              <Badge variant="secondary">
                                {SOURCE_LABELS[option?.source ?? 'none']}
                              </Badge>
                              {provider.isCustom && <Badge variant="outline">Custom</Badge>}
                              {draft.hasSecret && <Badge variant="outline">Secret stored</Badge>}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {selectedProvider && currentDraft && (
                      <div className="space-y-5 rounded-3xl border border-border/60 bg-[linear-gradient(180deg,rgba(17,24,39,0.02),transparent)] p-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl font-semibold text-foreground">
                                {selectedProvider.name}
                              </h3>
                              <Badge variant="outline">
                                {FAMILY_LABELS[selectedProvider.family]}
                              </Badge>
                              {selectedProvider.isCustom && (
                                <Badge variant="secondary">Custom</Badge>
                              )}
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {selectedProvider.providerId}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary">
                              {SOURCE_LABELS[selectedOption?.source ?? 'none']}
                            </Badge>
                            {currentDraft.updatedAt && (
                              <Badge variant="outline">
                                Updated {new Date(currentDraft.updatedAt).toLocaleDateString()}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`${selectedKey}-enabled`}>Organization enabled</Label>
                            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/80 px-4 py-3">
                              <div>
                                <p className="font-medium text-foreground">
                                  {currentDraft.enabled
                                    ? 'Available to org users'
                                    : 'Blocked by org policy'}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Disabled org configs also block personal overrides and org-scoped
                                  access to this provider.
                                </p>
                              </div>
                              <Switch
                                id={`${selectedKey}-enabled`}
                                data-testid={`org-enabled-${selectedProvider.family}-${selectedProvider.providerId}`}
                                checked={currentDraft.enabled}
                                disabled={isReadOnly}
                                onCheckedChange={(checked) =>
                                  updateDraft(selectedProvider, (draft) => ({
                                    ...draft,
                                    enabled: checked,
                                  }))
                                }
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`${selectedKey}-secret`}>Organization secret</Label>
                            <Input
                              id={`${selectedKey}-secret`}
                              type="password"
                              autoComplete="new-password"
                              placeholder={
                                currentDraft.hasSecret
                                  ? 'Stored on server. Enter to rotate.'
                                  : 'Enter API key or token'
                              }
                              value={currentDraft.secret}
                              disabled={isReadOnly}
                              onChange={(event) =>
                                updateDraft(selectedProvider, (draft) => ({
                                  ...draft,
                                  secret: event.target.value,
                                  clearSecret: false,
                                }))
                              }
                            />
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {currentDraft.hasSecret ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                                  Secret currently stored
                                </span>
                              ) : (
                                <span>No secret stored yet</span>
                              )}
                              {currentDraft.hasSecret && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto px-2 py-1 text-xs"
                                  disabled={isReadOnly}
                                  onClick={() =>
                                    updateDraft(selectedProvider, (draft) => ({
                                      ...draft,
                                      secret: '',
                                      clearSecret: true,
                                      hasSecret: false,
                                    }))
                                  }
                                >
                                  Clear stored secret on save
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`${selectedKey}-base-url`}>Base URL</Label>
                            <Input
                              id={`${selectedKey}-base-url`}
                              placeholder={
                                selectedProvider.defaultBaseUrl || 'https://api.example.com/v1'
                              }
                              value={currentDraft.baseUrl}
                              disabled={isReadOnly}
                              onChange={(event) =>
                                updateDraft(selectedProvider, (draft) => ({
                                  ...draft,
                                  baseUrl: event.target.value,
                                  definition:
                                    draft.family === 'llm' && draft.definition
                                      ? {
                                          ...draft.definition,
                                          defaultBaseUrl: event.target.value,
                                        }
                                      : draft.definition,
                                }))
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`${selectedKey}-default-model`}>Default model</Label>
                            <Select
                              value={currentDraft.defaultModel || '__none__'}
                              onValueChange={(value) =>
                                updateDraft(selectedProvider, (draft) => ({
                                  ...draft,
                                  defaultModel: value === '__none__' ? '' : value,
                                }))
                              }
                              disabled={isReadOnly}
                            >
                              <SelectTrigger id={`${selectedKey}-default-model`} className="w-full">
                                <SelectValue placeholder="Choose a default model" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">No enforced default</SelectItem>
                                {parsedAllowedModels.map((modelId) => (
                                  <SelectItem key={modelId} value={modelId}>
                                    {modelId}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${selectedKey}-models`}>Allowlisted models</Label>
                          <Textarea
                            id={`${selectedKey}-models`}
                            value={currentDraft.allowedModelsText}
                            disabled={isReadOnly}
                            onChange={(event) =>
                              updateDraft(selectedProvider, (draft) => ({
                                ...draft,
                                allowedModelsText: event.target.value,
                              }))
                            }
                            placeholder="One model ID per line"
                            className="min-h-32 font-mono text-sm"
                          />
                          <p className="text-xs text-muted-foreground">
                            Leave empty to allow no models until you define an allowlist. Use one
                            model ID per line or comma-separated values.
                          </p>
                        </div>

                        {selectedProvider.family === 'llm' &&
                          selectedProvider.isCustom &&
                          currentDraft.definition && (
                            <div className="space-y-4 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">Custom LLM definition</Badge>
                                <span className="text-sm text-muted-foreground">
                                  Org admins own custom provider metadata.
                                </span>
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`${selectedKey}-custom-name`}>Display name</Label>
                                  <Input
                                    id={`${selectedKey}-custom-name`}
                                    value={currentDraft.definition.name}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                      updateDraft(selectedProvider, (draft) => ({
                                        ...draft,
                                        definition: draft.definition
                                          ? {
                                              ...draft.definition,
                                              name: event.target.value,
                                            }
                                          : draft.definition,
                                      }))
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`${selectedKey}-custom-type`}>
                                    Provider API shape
                                  </Label>
                                  <Select
                                    value={currentDraft.definition.providerType || 'openai'}
                                    onValueChange={(value) =>
                                      updateDraft(selectedProvider, (draft) => ({
                                        ...draft,
                                        definition: draft.definition
                                          ? {
                                              ...draft.definition,
                                              providerType: value as
                                                | 'openai'
                                                | 'anthropic'
                                                | 'google',
                                            }
                                          : draft.definition,
                                      }))
                                    }
                                    disabled={isReadOnly}
                                  >
                                    <SelectTrigger
                                      id={`${selectedKey}-custom-type`}
                                      className="w-full"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="openai">OpenAI-compatible</SelectItem>
                                      <SelectItem value="anthropic">
                                        Anthropic-compatible
                                      </SelectItem>
                                      <SelectItem value="google">Google-compatible</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor={`${selectedKey}-custom-icon`}>Icon URL</Label>
                                  <Input
                                    id={`${selectedKey}-custom-icon`}
                                    placeholder="https://example.com/logo.svg"
                                    value={currentDraft.definition.icon || ''}
                                    disabled={isReadOnly}
                                    onChange={(event) =>
                                      updateDraft(selectedProvider, (draft) => ({
                                        ...draft,
                                        definition: draft.definition
                                          ? {
                                              ...draft.definition,
                                              icon: event.target.value,
                                            }
                                          : draft.definition,
                                      }))
                                    }
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor={`${selectedKey}-custom-api-key`}>
                                    Requires API key
                                  </Label>
                                  <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/80 px-4 py-3">
                                    <div>
                                      <p className="font-medium text-foreground">
                                        {currentDraft.definition.requiresApiKey === false
                                          ? 'Optional credentials'
                                          : 'Credential required'}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        Controls how this provider appears in the governed options
                                        endpoint.
                                      </p>
                                    </div>
                                    <Switch
                                      id={`${selectedKey}-custom-api-key`}
                                      checked={currentDraft.definition.requiresApiKey !== false}
                                      disabled={isReadOnly}
                                      onCheckedChange={(checked) =>
                                        updateDraft(selectedProvider, (draft) => ({
                                          ...draft,
                                          definition: draft.definition
                                            ? {
                                                ...draft.definition,
                                                requiresApiKey: checked,
                                              }
                                            : draft.definition,
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
