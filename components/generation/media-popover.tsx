'use client';

import { Fragment, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronRight,
  Image as ImageIcon,
  Mic,
  SlidersHorizontal,
  Video,
  Volume2,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/lib/store/settings';
import { CUSTOM_ASR_DEFAULT_LANGUAGES } from '@/lib/audio/constants';
import { ASR_PROVIDERS, getASRSupportedLanguages } from '@/lib/audio/constants';
import type { ASRProviderId } from '@/lib/audio/types';
import { isCustomASRProvider } from '@/lib/audio/types';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import type { SettingsSection } from '@/lib/types/settings';

interface MediaPopoverProps {
  onSettingsOpen: (section: SettingsSection) => void;
}

const IMAGE_PROVIDER_ICONS: Record<string, string> = {
  seedream: '/logos/doubao.svg',
  'qwen-image': '/logos/bailian.svg',
  'nano-banana': '/logos/gemini.svg',
  'grok-image': '/logos/grok.svg',
};

const VIDEO_PROVIDER_ICONS: Record<string, string> = {
  seedance: '/logos/doubao.svg',
  kling: '/logos/kling.svg',
  veo: '/logos/gemini.svg',
  sora: '/logos/openai.svg',
  'grok-video': '/logos/grok.svg',
};

type TabId = 'image' | 'video' | 'tts' | 'asr';

const TABS: Array<{ id: TabId; icon: LucideIcon; label: string }> = [
  { id: 'image', icon: ImageIcon, label: 'Image' },
  { id: 'video', icon: Video, label: 'Video' },
  { id: 'tts', icon: Volume2, label: 'TTS' },
  { id: 'asr', icon: Mic, label: 'ASR' },
];

interface SelectGroupData {
  groupId: string;
  groupName: string;
  groupIcon?: string;
  available: boolean;
  items: Array<{ id: string; name: string }>;
}

function hasRequiredConfig(
  configs: Record<string, { apiKey?: string; isServerConfigured?: boolean }>,
  id: string,
  requiresKey: boolean,
) {
  return !requiresKey || !!configs[id]?.apiKey || !!configs[id]?.isServerConfigured;
}

export function MediaPopover({ onSettingsOpen }: MediaPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('image');

  const imageGenerationEnabled = useSettingsStore((state) => state.imageGenerationEnabled);
  const videoGenerationEnabled = useSettingsStore((state) => state.videoGenerationEnabled);
  const ttsEnabled = useSettingsStore((state) => state.ttsEnabled);
  const asrEnabled = useSettingsStore((state) => state.asrEnabled);
  const setImageGenerationEnabled = useSettingsStore((state) => state.setImageGenerationEnabled);
  const setVideoGenerationEnabled = useSettingsStore((state) => state.setVideoGenerationEnabled);
  const setTTSEnabled = useSettingsStore((state) => state.setTTSEnabled);
  const setASREnabled = useSettingsStore((state) => state.setASREnabled);

  const imageProviderId = useSettingsStore((state) => state.imageProviderId);
  const imageModelId = useSettingsStore((state) => state.imageModelId);
  const imageProvidersConfig = useSettingsStore((state) => state.imageProvidersConfig);
  const setImageProvider = useSettingsStore((state) => state.setImageProvider);
  const setImageModelId = useSettingsStore((state) => state.setImageModelId);

  const videoProviderId = useSettingsStore((state) => state.videoProviderId);
  const videoModelId = useSettingsStore((state) => state.videoModelId);
  const videoProvidersConfig = useSettingsStore((state) => state.videoProvidersConfig);
  const setVideoProvider = useSettingsStore((state) => state.setVideoProvider);
  const setVideoModelId = useSettingsStore((state) => state.setVideoModelId);

  const asrProviderId = useSettingsStore((state) => state.asrProviderId);
  const asrLanguage = useSettingsStore((state) => state.asrLanguage);
  const asrProvidersConfig = useSettingsStore((state) => state.asrProvidersConfig);
  const setASRProvider = useSettingsStore((state) => state.setASRProvider);
  const setASRLanguage = useSettingsStore((state) => state.setASRLanguage);

  const enabledMap: Record<TabId, boolean> = {
    image: imageGenerationEnabled,
    video: videoGenerationEnabled,
    tts: ttsEnabled,
    asr: asrEnabled,
  };

  const enabledCount = [
    imageGenerationEnabled,
    videoGenerationEnabled,
    ttsEnabled,
    asrEnabled,
  ].filter(Boolean).length;

  const imageGroups = useMemo(
    () =>
      Object.values(IMAGE_PROVIDERS)
        .filter((provider) =>
          hasRequiredConfig(imageProvidersConfig, provider.id, provider.requiresApiKey),
        )
        .map((provider) => ({
          groupId: provider.id,
          groupName: provider.name,
          groupIcon: IMAGE_PROVIDER_ICONS[provider.id],
          available: true,
          items: [
            ...provider.models,
            ...(imageProvidersConfig[provider.id]?.customModels || []),
          ].map((model) => ({
            id: model.id,
            name: model.name,
          })),
        })),
    [imageProvidersConfig],
  );

  const videoGroups = useMemo(
    () =>
      Object.values(VIDEO_PROVIDERS)
        .filter((provider) =>
          hasRequiredConfig(videoProvidersConfig, provider.id, provider.requiresApiKey),
        )
        .map((provider) => ({
          groupId: provider.id,
          groupName: provider.name,
          groupIcon: VIDEO_PROVIDER_ICONS[provider.id],
          available: true,
          items: [
            ...provider.models,
            ...(videoProvidersConfig[provider.id]?.customModels || []),
          ].map((model) => ({
            id: model.id,
            name: model.name,
          })),
        })),
    [videoProvidersConfig],
  );

  const asrGroups = useMemo(() => {
    const groups: SelectGroupData[] = [];

    for (const provider of Object.values(ASR_PROVIDERS)) {
      if (!hasRequiredConfig(asrProvidersConfig, provider.id, provider.requiresApiKey)) {
        continue;
      }

      groups.push({
        groupId: provider.id,
        groupName: provider.name,
        groupIcon: provider.icon,
        available: true,
        items: getASRSupportedLanguages(provider.id).map((language) => ({
          id: language,
          name: language,
        })),
      });
    }

    for (const [id, config] of Object.entries(asrProvidersConfig)) {
      if (!isCustomASRProvider(id)) {
        continue;
      }

      const requiresApiKey = config.requiresApiKey === true;
      const hasApiKey = typeof config.apiKey === 'string' && config.apiKey.trim().length > 0;
      if (requiresApiKey && !hasApiKey && config.isServerConfigured !== true) {
        continue;
      }

      const customModels = config.customModels || [];
      if (customModels.length === 0) {
        continue;
      }

      groups.push({
        groupId: id,
        groupName: config.customName || id,
        available: true,
        items: CUSTOM_ASR_DEFAULT_LANGUAGES.map((language) => ({
          id: language,
          name: language,
        })),
      });
    }

    return groups;
  }, [asrProvidersConfig]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      return;
    }

    const firstEnabled = (['image', 'video', 'tts', 'asr'] as TabId[]).find(
      (tabId) => enabledMap[tabId],
    );
    setActiveTab(firstEnabled || 'image');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
            enabledCount > 0
              ? 'border-violet-200/60 bg-violet-100 text-violet-700 dark:border-violet-700/50 dark:bg-violet-900/30 dark:text-violet-300'
              : 'border-border/50 text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          {imageGenerationEnabled && <ImageIcon className="size-3.5" />}
          {videoGenerationEnabled && <Video className="size-3.5" />}
          {ttsEnabled && <Volume2 className="size-3.5" />}
          {asrEnabled && <Mic className="size-3.5" />}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" avoidCollisions={false} className="w-80 p-0">
        <div className="p-2 pb-0">
          <div className="flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const isEnabled = enabledMap[tab.id];
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex-1 rounded-md py-1.5 text-[11px] font-medium transition-all',
                    'flex items-center justify-center gap-1.5',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground/80',
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {isEnabled && !isActive && (
                    <span className="absolute right-1 top-1 size-1.5 rounded-full bg-violet-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3 pt-2.5">
          {activeTab === 'image' && (
            <TabPanel
              icon={ImageIcon}
              label={t('media.imageCapability')}
              enabled={imageGenerationEnabled}
              onToggle={setImageGenerationEnabled}
            >
              <GroupedSelect
                groups={imageGroups}
                selectedGroupId={imageProviderId}
                selectedItemId={imageModelId}
                onSelect={(groupId, itemId) => {
                  setImageProvider(groupId as ImageProviderId);
                  setImageModelId(itemId);
                }}
              />
            </TabPanel>
          )}

          {activeTab === 'video' && (
            <TabPanel
              icon={Video}
              label={t('media.videoCapability')}
              enabled={videoGenerationEnabled}
              onToggle={setVideoGenerationEnabled}
            >
              <GroupedSelect
                groups={videoGroups}
                selectedGroupId={videoProviderId}
                selectedItemId={videoModelId}
                onSelect={(groupId, itemId) => {
                  setVideoProvider(groupId as VideoProviderId);
                  setVideoModelId(itemId);
                }}
              />
            </TabPanel>
          )}

          {activeTab === 'tts' && (
            <TabPanel
              icon={Volume2}
              label={t('media.ttsCapability')}
              enabled={ttsEnabled}
              onToggle={setTTSEnabled}
            >
              <p className="text-[11px] text-muted-foreground/60">
                {t('settings.ttsVoiceConfigHint')}
              </p>
            </TabPanel>
          )}

          {activeTab === 'asr' && (
            <TabPanel
              icon={Mic}
              label={t('media.asrCapability')}
              enabled={asrEnabled}
              onToggle={setASREnabled}
            >
              <GroupedSelect
                groups={asrGroups}
                selectedGroupId={asrProviderId}
                selectedItemId={asrLanguage}
                onSelect={(groupId, itemId) => {
                  setASRProvider(groupId as ASRProviderId);
                  setASRLanguage(itemId);
                }}
              />
            </TabPanel>
          )}
        </div>

        <div className="border-t border-border/40">
          <button
            onClick={() => {
              setOpen(false);
              onSettingsOpen(activeTab);
            }}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <span>{t('toolbar.advancedSettings')}</span>
            <ChevronRight className="size-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TabPanel({
  icon: Icon,
  label,
  enabled,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Icon
          className={cn(
            'size-4 shrink-0 transition-colors',
            enabled ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground/50',
          )}
        />
        <span
          className={cn(
            'flex-1 text-sm font-medium transition-colors',
            !enabled && 'text-muted-foreground',
          )}
        >
          {label}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="origin-right scale-[0.85]"
        />
      </div>
      {enabled && children}
    </div>
  );
}

function GroupedSelect({
  groups,
  selectedGroupId,
  selectedItemId,
  onSelect,
}: {
  groups: SelectGroupData[];
  selectedGroupId: string;
  selectedItemId: string;
  onSelect: (groupId: string, itemId: string) => void;
}) {
  const compositeValue = `${selectedGroupId}::${selectedItemId}`;
  const selectedGroup =
    groups.find(
      (group) =>
        group.groupId === selectedGroupId && group.items.some((item) => item.id === selectedItemId),
    ) || groups.find((group) => group.groupId === selectedGroupId);

  return (
    <Select
      value={compositeValue}
      onValueChange={(value) => {
        const separatorIndex = value.indexOf('::');
        if (separatorIndex === -1) {
          return;
        }

        onSelect(value.slice(0, separatorIndex), value.slice(separatorIndex + 2));
      }}
    >
      <SelectTrigger className="h-8 w-full rounded-lg border-border/40 bg-background/80 px-2.5 text-xs shadow-none hover:bg-muted/40 focus:ring-1 focus:ring-ring/30">
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {selectedGroup?.groupIcon && (
            <img src={selectedGroup.groupIcon} alt="" className="size-4 shrink-0 rounded-sm" />
          )}
          <span className="truncate font-medium">{selectedGroup?.groupName}</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="truncate text-muted-foreground">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {groups.map((group, index) => (
          <Fragment key={`${group.groupId}-${index}`}>
            {index > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                {group.groupIcon && (
                  <img
                    src={group.groupIcon}
                    alt=""
                    className={cn('size-3.5 rounded-sm', !group.available && 'opacity-40')}
                  />
                )}
                {group.groupName}
              </SelectLabel>
              {group.items.map((item) => (
                <SelectItem
                  key={`${group.groupId}::${item.id}`}
                  value={`${group.groupId}::${item.id}`}
                  disabled={!group.available}
                  className="text-xs"
                >
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  );
}
