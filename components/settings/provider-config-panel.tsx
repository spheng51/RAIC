'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  RotateCcw,
  Plus,
  Zap,
  Settings2,
  Trash2,
  Sparkles,
  Wrench,
  FileText,
  Send,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import type { ProviderConfig } from '@/lib/ai/providers';
import type { ProvidersConfig } from '@/lib/types/settings';
import type { ProviderTransportMode } from '@/lib/types/provider';
import { formatContextWindow } from './utils';
import { cn } from '@/lib/utils';
import {
  hasHostedLocalProviderTopologyMismatch,
  isHostedOrigin,
  normalizeBuiltInOpenAICompatibleBaseUrl,
} from '@/lib/utils/url';
import { verifyBrowserLocalOpenAIModel } from '@/lib/utils/browser-local-openai';
import {
  isBrowserLocalTransport,
  supportsBrowserLocalTransport,
} from '@/lib/utils/provider-transport';

interface ProviderConfigPanelProps {
  provider: ProviderConfig;
  initialApiKey: string;
  initialBaseUrl: string;
  initialRequiresApiKey: boolean;
  initialTransportMode: ProviderTransportMode;
  originHostname?: string;
  providersConfig: ProvidersConfig;
  onConfigChange: (
    apiKey: string,
    baseUrl: string,
    requiresApiKey: boolean,
    transportMode: ProviderTransportMode,
  ) => void;
  onSave: () => void; // Auto-save on blur
  onEditModel: (index: number) => void;
  onDeleteModel: (index: number) => void;
  onAddModel: () => void;
  onResetToDefault?: () => void; // Reset provider to default configuration
  isBuiltIn: boolean; // To determine if reset button should be shown
}

export function ProviderConfigPanel({
  provider,
  initialApiKey,
  initialBaseUrl,
  initialRequiresApiKey,
  initialTransportMode,
  originHostname,
  providersConfig,
  onConfigChange,
  onSave,
  onEditModel,
  onDeleteModel,
  onAddModel,
  onResetToDefault,
  isBuiltIn,
}: ProviderConfigPanelProps) {
  const { t } = useI18n();
  const aiPolicy = useSettingsStore((state) => state.aiPolicy);
  const currentProviderId = useSettingsStore((state) => state.providerId);
  const currentModelId = useSettingsStore((state) => state.modelId);
  const setModel = useSettingsStore((state) => state.setModel);

  // Local state for this provider
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [requiresApiKey, setRequiresApiKey] = useState(initialRequiresApiKey);
  const [transportMode, setTransportMode] = useState<ProviderTransportMode>(initialTransportMode);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [showResetDialog, setShowResetDialog] = useState(false);

  // Update local state when provider changes or initial values change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync local state from props on provider change
    setApiKey(initialApiKey);

    setBaseUrl(initialBaseUrl);

    setRequiresApiKey(initialRequiresApiKey);

    setTransportMode(initialTransportMode);

    setTestStatus('idle');

    setTestMessage('');
  }, [provider.id, initialApiKey, initialBaseUrl, initialRequiresApiKey, initialTransportMode]);

  // Notify parent of changes
  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    onConfigChange(key, baseUrl, requiresApiKey, transportMode);
  };

  const handleBaseUrlChange = (url: string) => {
    setBaseUrl(url);
    onConfigChange(apiKey, url, requiresApiKey, transportMode);
  };

  const handleBaseUrlBlur = () => {
    const normalizedBaseUrl = normalizeBuiltInOpenAICompatibleBaseUrl(provider.id, baseUrl);
    if (normalizedBaseUrl !== baseUrl) {
      setBaseUrl(normalizedBaseUrl);
      onConfigChange(apiKey, normalizedBaseUrl, requiresApiKey, transportMode);
    }
    onSave();
  };

  const handleRequiresApiKeyChange = (requires: boolean) => {
    setRequiresApiKey(requires);
    onConfigChange(apiKey, baseUrl, requires, transportMode);
  };

  const handleTransportModeChange = (nextMode: ProviderTransportMode) => {
    setTransportMode(nextMode);
    onConfigChange(apiKey, baseUrl, requiresApiKey, nextMode);
  };

  const governedConfig = providersConfig[provider.id];
  const models = governedConfig?.models || [];
  const isServerConfigured = governedConfig?.isServerConfigured;
  const isGovernedProvider = !!governedConfig?.hasOrganizationConfig;
  const hasPersonalOverride = !!governedConfig?.hasPersonalOverride;
  const source = governedConfig?.source;
  const legacyFallbackAllowed = governedConfig?.legacyFallbackAllowed !== false;
  const isLegacyFallbackInUse = !!apiKey && !isServerConfigured && legacyFallbackAllowed;
  const canOverrideBaseUrl = !isGovernedProvider || aiPolicy.allowPersonalCustomBaseUrls;
  const canUseOptionalApiKey = provider.supportsOptionalApiKey === true;
  const canEditApiKey = requiresApiKey || isServerConfigured || canUseOptionalApiKey;
  const supportsBrowserLocalMode = supportsBrowserLocalTransport(provider.id);
  const normalizedInputBaseUrl = normalizeBuiltInOpenAICompatibleBaseUrl(provider.id, baseUrl);
  const effectiveBaseUrl = normalizeBuiltInOpenAICompatibleBaseUrl(
    provider.id,
    normalizedInputBaseUrl || governedConfig?.serverBaseUrl || provider.defaultBaseUrl || '',
  );
  const serverTopologyMismatch = hasHostedLocalProviderTopologyMismatch({
    providerId: provider.id,
    originHostname,
    baseUrl: effectiveBaseUrl,
  });
  const browserLocalMode = isBrowserLocalTransport(provider.id, transportMode);
  const hostedLocalProviderWarning =
    !browserLocalMode && serverTopologyMismatch
      ? t('settings.hostedLocalProviderWarning', { provider: provider.name })
      : '';
  const hostedOrigin = isHostedOrigin(originHostname);
  const browserLocalModeNotice = browserLocalMode
    ? t('settings.browserLocalModeNotice', { provider: provider.name })
    : '';
  const browserLocalPermissionHint =
    browserLocalMode && hostedOrigin ? t('settings.browserLocalPermissionHint') : '';
  const browserLocalLmstudioCorsHint =
    browserLocalMode && provider.id === 'lmstudio'
      ? t('settings.browserLocalLmstudioCorsHint', {
          command: 'lms server start --cors',
        })
      : '';
  const activeModelId = provider.id === currentProviderId ? currentModelId : '';

  const handleTestApi = useCallback(async () => {
    if (hostedLocalProviderWarning) {
      setTestStatus('error');
      setTestMessage(hostedLocalProviderWarning);
      return;
    }

    setTestStatus('testing');
    setTestMessage('');

    const availableModels = providersConfig[provider.id]?.models || [];
    const testModelId =
      (provider.id === currentProviderId ? currentModelId : '') ||
      providersConfig[provider.id]?.serverDefaultModel ||
      availableModels[0]?.id;

    if (!testModelId) {
      setTestStatus('error');
      setTestMessage(t('settings.noModelsAvailable') || 'No models available for testing');
      return;
    }

    try {
      if (browserLocalMode) {
        await verifyBrowserLocalOpenAIModel({
          providerId: provider.id,
          providerName: provider.name,
          modelId: testModelId,
          baseUrl: effectiveBaseUrl,
          apiKey,
        });

        setTestStatus('success');
        setTestMessage(t('settings.connectionSuccess'));
        return;
      }

      const response = await fetch('/api/verify-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          baseUrl: normalizedInputBaseUrl,
          model: `${provider.id}:${testModelId}`,
          providerType: provider.type,
          requiresApiKey: requiresApiKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setTestStatus('success');
        setTestMessage(t('settings.connectionSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(data.error || t('settings.connectionFailed'));
      }
    } catch (error) {
      setTestStatus('error');
      setTestMessage(error instanceof Error ? error.message : t('settings.connectionFailed'));
    }
  }, [
    apiKey,
    browserLocalMode,
    currentModelId,
    currentProviderId,
    effectiveBaseUrl,
    provider.id,
    provider.name,
    provider.type,
    requiresApiKey,
    providersConfig,
    normalizedInputBaseUrl,
    t,
    hostedLocalProviderWarning,
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      {source === 'personal' && hasPersonalOverride && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300">
          {t('settings.personalConfiguredNotice')}
        </div>
      )}

      {/* Server-configured notice */}
      {isServerConfigured && source !== 'personal' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {isLegacyFallbackInUse && (
        <div
          data-testid="legacy-fallback-notice"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300"
        >
          {t('settings.legacyBrowserOnlyNotice')}
        </div>
      )}

      {supportsBrowserLocalMode && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor={`browser-local-mode-${provider.id}`}>
                {t('settings.browserLocalModeLabel')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.browserLocalModeDescription')}
              </p>
            </div>
            <Switch
              id={`browser-local-mode-${provider.id}`}
              checked={browserLocalMode}
              onCheckedChange={(checked) =>
                handleTransportModeChange(checked ? 'browser-local' : 'server')
              }
            />
          </div>
          {browserLocalModeNotice && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300">
              <div className="space-y-2">
                <p>{browserLocalModeNotice}</p>
                {browserLocalPermissionHint && <p>{browserLocalPermissionHint}</p>}
                {browserLocalLmstudioCorsHint && <p>{browserLocalLmstudioCorsHint}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* API Key */}
      <div className="space-y-2">
        <Label>{t('settings.apiSecret')}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              data-testid={`provider-api-key-${provider.id}`}
              name={`llm-api-key-${provider.id}`}
              type={showApiKey ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={isServerConfigured ? t('settings.optionalOverride') : 'sk-...'}
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              onBlur={onSave}
              disabled={!canEditApiKey}
              className="h-8 pr-8"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={!canEditApiKey}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            data-testid={`provider-test-${provider.id}`}
            variant="outline"
            size="sm"
            onClick={handleTestApi}
            disabled={
              testStatus === 'testing' ||
              (requiresApiKey && !apiKey && !isServerConfigured) ||
              !!hostedLocalProviderWarning
            }
            className="gap-1.5"
          >
            {testStatus === 'testing' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                {t('settings.testConnection')}
              </>
            )}
          </Button>
        </div>
        {testMessage && (
          <div
            className={cn(
              'rounded-lg p-3 text-sm overflow-hidden',
              testStatus === 'success' && 'bg-green-50 text-green-700 border border-green-200',
              testStatus === 'error' && 'bg-red-50 text-red-700 border border-red-200',
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              <p className="flex-1 min-w-0 break-all">{testMessage}</p>
            </div>
          </div>
        )}
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`requires-api-key-${provider.id}`}
            checked={requiresApiKey}
            onCheckedChange={(checked) => {
              handleRequiresApiKeyChange(checked as boolean);
              onSave();
            }}
          />
          <label
            htmlFor={`requires-api-key-${provider.id}`}
            className="text-sm cursor-pointer text-muted-foreground"
          >
            {t('settings.requiresApiKey')}
          </label>
        </div>
      </div>

      {/* API Host */}
      <div className="space-y-2">
        <Label>{t('settings.apiHost')}</Label>
        <Input
          data-testid={`provider-base-url-${provider.id}`}
          name={`llm-base-url-${provider.id}`}
          type="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={provider.defaultBaseUrl || 'https://api.example.com/v1'}
          value={baseUrl}
          onChange={(e) => handleBaseUrlChange(e.target.value)}
          onBlur={handleBaseUrlBlur}
          className="h-8"
          disabled={!canOverrideBaseUrl}
        />
        {(() => {
          if (!effectiveBaseUrl) return null;

          // Generate endpoint path based on provider type
          let endpointPath = '';
          switch (provider.type) {
            case 'openai':
              endpointPath = '/chat/completions';
              break;
            case 'anthropic':
              endpointPath = '/messages';
              break;
            case 'google':
              endpointPath = '/models/[model]';
              break;
            default:
              endpointPath = '';
          }

          const fullUrl = effectiveBaseUrl + endpointPath;

          return (
            <p className="text-xs text-muted-foreground break-all">
              {t('settings.requestUrl')}: {fullUrl}
            </p>
          );
        })()}
        {hostedLocalProviderWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
            {hostedLocalProviderWarning}
          </div>
        )}
      </div>

      {/* Active model selection */}
      <div className="space-y-3">
        <Label className="text-base">{t('settings.activeModel')}</Label>
        <p className="text-xs text-muted-foreground">{t('settings.activeModelDescription')}</p>
        {models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
            {t('settings.noModelsAvailable')}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {models.map((model) => {
              const isActiveModel = activeModelId === model.id;

              return (
                <Button
                  key={model.id}
                  type="button"
                  size="sm"
                  variant={isActiveModel ? 'default' : 'outline'}
                  className="max-w-full"
                  data-testid={`activate-model-${provider.id}-${model.id}`}
                  onClick={() => setModel(provider.id, model.id)}
                >
                  {isActiveModel && <CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate font-mono text-xs">{model.name}</span>
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {/* Models management list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Label className="text-base">{t('settings.models')}</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {!isGovernedProvider && isBuiltIn && onResetToDefault && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowResetDialog(true)}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('settings.reset')}
              </Button>
            )}
            {!isGovernedProvider && (
              <Button variant="outline" size="sm" onClick={onAddModel} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {t('settings.addNewModel')}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.modelsManagementDescription')}</p>

        <div className="space-y-1.5">
          {models.map((model, index) => {
            return (
              <div
                key={model.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card"
              >
                <div className="flex-1">
                  <div className="font-mono text-sm font-medium mb-1.5">{model.name}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {/* Capabilities */}
                    <div className="flex items-center gap-1">
                      {model.capabilities?.vision && (
                        <div title={t('settings.capabilities.vision')}>
                          <Sparkles className="h-3 w-3" />
                        </div>
                      )}
                      {model.capabilities?.tools && (
                        <div title={t('settings.capabilities.tools')}>
                          <Wrench className="h-3 w-3" />
                        </div>
                      )}
                      {model.capabilities?.streaming && (
                        <div title={t('settings.capabilities.streaming')}>
                          <Zap className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    {/* Context Window */}
                    {model.contextWindow && (
                      <span className="flex items-center gap-0.5">
                        <FileText className="h-3 w-3" />
                        <span className="text-[10px]">
                          {formatContextWindow(model.contextWindow)}
                        </span>
                      </span>
                    )}
                    {/* Output Window */}
                    {model.outputWindow && (
                      <span className="flex items-center gap-0.5">
                        <Send className="h-3 w-3" />
                        <span className="text-[10px]">
                          {formatContextWindow(model.outputWindow)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Edit/Delete Buttons */}
                {!isGovernedProvider && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => onEditModel(index)}
                      title={t('settings.editModel')}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => onDeleteModel(index)}
                      title={t('settings.deleteModel')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.resetToDefault')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.resetConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancelEdit')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowResetDialog(false);
                onResetToDefault?.();
              }}
            >
              {t('settings.confirmReset')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
