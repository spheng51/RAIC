'use client';

import { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkles, Wrench, Zap, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { getProvider, type ProviderId } from '@/lib/ai/providers';
import type { ProviderTransportMode } from '@/lib/types/provider';
import type { EditingModel } from '@/lib/types/settings';
import { cn } from '@/lib/utils';
import { hasHostedLocalProviderTopologyMismatch, isHostedOrigin } from '@/lib/utils/url';
import { verifyBrowserLocalOpenAIModel } from '@/lib/utils/browser-local-openai';
import { isBrowserLocalTransport } from '@/lib/utils/provider-transport';

interface ModelEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingModel: EditingModel | null;
  setEditingModel: (model: EditingModel | null) => void;
  onSave: () => void;
  onAutoSave?: () => void; // Auto-save on blur
  providerId: ProviderId;
  apiKey: string;
  baseUrl?: string;
  effectiveBaseUrl?: string;
  originHostname?: string;
  transportMode: ProviderTransportMode;
  providerType?: string;
  requiresApiKey?: boolean;
  isServerConfigured?: boolean;
}

export function ModelEditDialog({
  open,
  onOpenChange,
  editingModel,
  setEditingModel,
  onSave,
  onAutoSave,
  providerId,
  apiKey,
  baseUrl,
  effectiveBaseUrl,
  originHostname,
  transportMode,
  providerType,
  requiresApiKey,
  isServerConfigured,
}: ModelEditDialogProps) {
  const { t } = useI18n();
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const providerName = getProvider(providerId)?.name || providerId;
  const browserLocalMode = isBrowserLocalTransport(providerId, transportMode);
  const hostedLocalProviderWarning =
    !browserLocalMode &&
    hasHostedLocalProviderTopologyMismatch({
      providerId,
      originHostname,
      baseUrl: effectiveBaseUrl,
    })
      ? t('settings.hostedLocalProviderWarning', { provider: providerName })
      : '';
  const browserLocalModeNotice = browserLocalMode
    ? t('settings.browserLocalModeNotice', { provider: providerName })
    : '';
  const browserLocalPermissionHint =
    browserLocalMode && isHostedOrigin(originHostname)
      ? t('settings.browserLocalPermissionHint')
      : '';
  const browserLocalLmstudioCorsHint =
    browserLocalMode && providerId === 'lmstudio'
      ? t('settings.browserLocalLmstudioCorsHint', {
          command: 'lms server start --cors',
        })
      : '';

  // Reset test status when dialog closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset state when dialog closes
      setTestStatus('idle');

      setTestMessage('');
    }
  }, [open]);

  const handleClose = () => {
    onOpenChange(false);
    setEditingModel(null);
  };

  const handleTestModel = useCallback(async () => {
    if (!editingModel) {
      return;
    }

    if (hostedLocalProviderWarning) {
      setTestStatus('error');
      setTestMessage(hostedLocalProviderWarning);
      return;
    }

    setTestStatus('testing');
    setTestMessage('');

    try {
      if (browserLocalMode) {
        await verifyBrowserLocalOpenAIModel({
          providerId,
          providerName,
          modelId: editingModel.model.id,
          baseUrl: effectiveBaseUrl || baseUrl || '',
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
          baseUrl,
          model: `${providerId}:${editingModel.model.id}`,
          providerType,
          requiresApiKey,
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
    editingModel,
    apiKey,
    baseUrl,
    browserLocalMode,
    effectiveBaseUrl,
    providerId,
    providerName,
    providerType,
    requiresApiKey,
    t,
    hostedLocalProviderWarning,
  ]);

  if (!editingModel) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogTitle className="sr-only">
          {editingModel.modelIndex === null ? t('settings.addNewModel') : t('settings.editModel')}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {editingModel.modelIndex === null
            ? t('settings.addNewModelDescription')
            : t('settings.editModelDescription')}
        </DialogDescription>
        <div className="space-y-4">
          <div className="pb-3 border-b">
            <h2 className="text-lg font-semibold">
              {editingModel.modelIndex === null
                ? t('settings.addNewModel')
                : t('settings.editModel')}
            </h2>
          </div>

          {/* Model ID */}
          <div className="space-y-2">
            <Label>{t('settings.modelId')}</Label>
            <Input
              placeholder={t('settings.modelIdPlaceholder')}
              value={editingModel.model.id}
              onChange={(e) => {
                const newId = e.target.value;
                const currentName = editingModel.model.name;
                const currentId = editingModel.model.id;

                // Auto-sync name if it's empty or matches the old ID
                const shouldSyncName = !currentName || currentName === currentId;

                setEditingModel({
                  ...editingModel,
                  model: {
                    ...editingModel.model,
                    id: newId,
                    name: shouldSyncName ? newId : currentName,
                  },
                });

                // Reset test status when model ID changes
                setTestStatus('idle');
                setTestMessage('');
              }}
              onBlur={() => onAutoSave?.()}
            />
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label>{t('settings.modelName')}</Label>
            <Input
              placeholder={t('settings.modelNamePlaceholder')}
              value={editingModel.model.name}
              onChange={(e) =>
                setEditingModel({
                  ...editingModel,
                  model: { ...editingModel.model, name: e.target.value },
                })
              }
              onBlur={() => onAutoSave?.()}
            />
          </div>

          {/* Capabilities */}
          <div className="space-y-2">
            <Label>{t('settings.modelCapabilities')}</Label>
            <div className="flex gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="cap-vision"
                  checked={editingModel.model.capabilities?.vision || false}
                  onCheckedChange={(checked) => {
                    setEditingModel({
                      ...editingModel,
                      model: {
                        ...editingModel.model,
                        capabilities: {
                          ...editingModel.model.capabilities,
                          vision: checked as boolean,
                        },
                      },
                    });
                    onAutoSave?.();
                  }}
                />
                <label
                  htmlFor="cap-vision"
                  className="text-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('settings.capabilities.vision')}
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="cap-tools"
                  checked={editingModel.model.capabilities?.tools || false}
                  onCheckedChange={(checked) => {
                    setEditingModel({
                      ...editingModel,
                      model: {
                        ...editingModel.model,
                        capabilities: {
                          ...editingModel.model.capabilities,
                          tools: checked as boolean,
                        },
                      },
                    });
                    onAutoSave?.();
                  }}
                />
                <label
                  htmlFor="cap-tools"
                  className="text-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  {t('settings.capabilities.tools')}
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="cap-streaming"
                  checked={editingModel.model.capabilities?.streaming || false}
                  onCheckedChange={(checked) => {
                    setEditingModel({
                      ...editingModel,
                      model: {
                        ...editingModel.model,
                        capabilities: {
                          ...editingModel.model.capabilities,
                          streaming: checked as boolean,
                        },
                      },
                    });
                    onAutoSave?.();
                  }}
                />
                <label
                  htmlFor="cap-streaming"
                  className="text-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Zap className="h-3.5 w-3.5" />
                  {t('settings.capabilities.streaming')}
                </label>
              </div>
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-3 pt-3 border-t">
            <Label className="text-base">{t('settings.advancedSettings')}</Label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm">{t('settings.contextWindowLabel')}</Label>
                <Input
                  type="number"
                  placeholder={t('settings.contextWindowPlaceholder')}
                  value={editingModel.model.contextWindow || ''}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      model: {
                        ...editingModel.model,
                        contextWindow: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    })
                  }
                  onBlur={() => onAutoSave?.()}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">{t('settings.outputWindowLabel')}</Label>
                <Input
                  type="number"
                  placeholder={t('settings.outputWindowPlaceholder')}
                  value={editingModel.model.outputWindow || ''}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      model: {
                        ...editingModel.model,
                        outputWindow: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    })
                  }
                  onBlur={() => onAutoSave?.()}
                />
              </div>
            </div>
          </div>

          {/* Test Model */}
          <div className="space-y-3 pt-3 border-t">
            <div className="flex items-center justify-between">
              <Label className="text-base">{t('settings.testModel')}</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestModel}
                disabled={
                  !editingModel.model.id ||
                  testStatus === 'testing' ||
                  (requiresApiKey && !apiKey && !isServerConfigured) ||
                  !!hostedLocalProviderWarning
                }
                className={cn(
                  testStatus === 'success' && 'border-green-600 text-green-600 hover:bg-green-50',
                  testStatus === 'error' && 'border-red-600 text-red-600 hover:bg-red-50',
                )}
              >
                {testStatus === 'testing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {testStatus === 'success' && <CheckCircle className="mr-2 h-4 w-4" />}
                {testStatus === 'error' && <XCircle className="mr-2 h-4 w-4" />}
                {testStatus === 'testing' ? t('settings.testing') : t('settings.testConnection')}
              </Button>
            </div>
            {hostedLocalProviderWarning && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
                {hostedLocalProviderWarning}
              </div>
            )}
            {browserLocalModeNotice && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300">
                <div className="space-y-2">
                  <p>{browserLocalModeNotice}</p>
                  {browserLocalPermissionHint && <p>{browserLocalPermissionHint}</p>}
                  {browserLocalLmstudioCorsHint && <p>{browserLocalLmstudioCorsHint}</p>}
                </div>
              </div>
            )}
            {testMessage && (
              <div
                className={cn(
                  'rounded-lg p-3 text-sm',
                  testStatus === 'success' && 'bg-green-50 text-green-700 border border-green-200',
                  testStatus === 'error' && 'bg-red-50 text-red-700 border border-red-200',
                )}
              >
                <div className="flex items-start gap-2 flex-wrap">
                  {testStatus === 'success' && <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
                  <p className="flex-1 break-words">{testMessage}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t">
            <Button variant="outline" size="sm" onClick={handleClose}>
              {t('settings.cancelEdit')}
            </Button>
            <Button size="sm" onClick={onSave}>
              {t('settings.saveModel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
