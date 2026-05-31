'use client';

import { useCallback, useState, useEffect, useRef, useDeferredValue, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ImagePlus,
  Pencil,
  Trash2,
  Search,
  Settings,
  Sun,
  Moon,
  Monitor,
  BotOff,
  ChevronUp,
  Share2,
  Landmark,
  Atom,
  BookOpen,
  Brain,
  Code2,
  Gamepad2,
  Layers,
  Puzzle,
  Rocket,
  Trophy,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { useTheme } from '@/lib/hooks/use-theme';
import { useDiscordStudioCallback } from '@/lib/hooks/use-discord-studio-callback';
import { nanoid } from 'nanoid';
import { storePdfBlob } from '@/lib/utils/image-storage';
import type { ExperiencePreset, GameTemplateId, UserRequirements } from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import {
  StageListItem,
  listStages,
  deleteStageData,
  renameStage,
  getFirstSlideByStages,
} from '@/lib/utils/stage-storage';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import type { Slide } from '@/lib/types/slides';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { EXAMPLE_COURSE_ID, ensureOpenRaicExampleSeeded } from '@/lib/utils/example-classroom-seed';
import {
  clearClassroomLaunchContext,
  getHomePathForLaunchMode,
  type ClassroomLaunchMode,
  writeClassroomLaunchContext,
} from '@/lib/utils/classroom-launch';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { getBrowserLocalUnsupportedFlowGuard } from '@/lib/utils/browser-local-guards';
import { ClassroomShareDialog } from '@/components/classroom/classroom-share-dialog';
import { ScheduleClassesBox } from '@/components/schedule/schedule-classes-box';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import {
  experiencePresetRequiresSource,
  getExperiencePresetDefinition,
  HISTORICAL_VLOGGER_PRESET,
} from '@/lib/generation/experience-presets';
import type {
  DiscordIntegrationSnapshot,
  ScheduledClassEvent,
  ScheduledClassEventInput,
} from '@/lib/types/scheduled-classes';
import {
  createLocalScheduledClassEvent,
  deleteLocalScheduledClassEvent,
  listLocalScheduledClassEvents,
  updateLocalScheduledClassEvent,
} from '@/lib/utils/scheduled-classes-storage';
import {
  mergeScheduledClassEvent,
  normalizeScheduledClassInput,
  sortScheduledClassEvents,
} from '@/lib/utils/scheduled-classes';
import {
  DEFAULT_GAME_TEMPLATE_ID,
  GAME_TEMPLATE_DEFINITIONS,
  getGameTemplateDefinition,
} from '@/lib/game-arcade/templates';

const log = createLogger('Home');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const LANGUAGE_STORAGE_KEY = 'generationLanguage';
const INTERACTIVE_MODE_STORAGE_KEY = 'interactiveModeEnabled';
const RECENT_OPEN_STORAGE_KEY = 'recentClassroomsOpen';

interface FormState {
  pdfFile: File | null;
  requirement: string;
  language: 'zh-CN' | 'en-US';
  webSearch: boolean;
  interactiveMode: boolean;
  experiencePreset?: ExperiencePreset;
  creationMode: 'course' | 'game-arcade';
  gameTemplateId: GameTemplateId;
}

interface ServerClassroomSummary {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
  interactiveMode?: boolean;
  creationMode?: 'course' | 'game-arcade';
}

interface ScheduledClassesApiBody {
  events?: ScheduledClassEvent[];
  event?: ScheduledClassEvent | null;
  error?: string;
  details?: string;
}

interface DiscordIntegrationApiBody extends Partial<DiscordIntegrationSnapshot> {
  error?: string;
  details?: string;
}

const initialFormState: FormState = {
  pdfFile: null,
  requirement: '',
  language: 'en-US',
  webSearch: false,
  interactiveMode: false,
  creationMode: 'course',
  gameTemplateId: DEFAULT_GAME_TEMPLATE_ID,
};

const GAME_TEMPLATE_ICONS: Record<GameTemplateId, typeof Gamepad2> = {
  'physics-challenge': Rocket,
  'puzzle-lab': Puzzle,
  'strategy-sim': Brain,
  'card-match': Layers,
  'code-quest': Code2,
  'boss-review': Trophy,
};

const HISTORY_VLOG_PRESET_DEFINITION = getExperiencePresetDefinition(HISTORICAL_VLOGGER_PRESET);

function parseServerTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

async function readApiError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    details?: string;
  } | null;
  return body?.details || body?.error || fallback;
}

function toDiscordIntegrationSnapshot(
  body: DiscordIntegrationApiBody | null,
): DiscordIntegrationSnapshot {
  const connection = body?.connection ?? null;
  return {
    configured: Boolean(body?.configured),
    connection,
    connections: body?.connections ?? (connection ? [connection] : []),
    channels: body?.channels ?? [],
    ...(body?.channelsError ? { channelsError: body.channelsError } : {}),
  };
}

interface HomePageProps {
  readonly launchMode?: ClassroomLaunchMode;
}

export function HomePage({ launchMode = 'public-demo' }: HomePageProps) {
  const { t, locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Draft cache for requirement text
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  // Model setup state
  const currentModelId = useSettingsStore((s) => s.modelId);
  const [recentOpen, setRecentOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const persistRecentOpen = useCallback((next: boolean) => {
    setRecentOpen(next);
    try {
      localStorage.setItem(RECENT_OPEN_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  // Hydrate client-only state after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_OPEN_STORAGE_KEY);
      if (saved !== null) setRecentOpen(saved !== 'false');
    } catch {
      /* localStorage unavailable */
    }
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const savedInteractiveMode = localStorage.getItem(INTERACTIVE_MODE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedWebSearch === 'true') updates.webSearch = true;
      if (savedInteractiveMode === 'true') updates.interactiveMode = true;
      if (savedLanguage === 'zh-CN' || savedLanguage === 'en-US') {
        updates.language = savedLanguage;
      } else {
        const detected = navigator.language?.startsWith('zh') ? 'zh-CN' : 'en-US';
        updates.language = detected;
      }
      if (Object.keys(updates).length > 0) {
        setForm((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // Restore requirement draft from cache (derived state pattern — no effect needed)
  const [prevCachedRequirement, setPrevCachedRequirement] = useState(cachedRequirement);
  if (cachedRequirement !== prevCachedRequirement) {
    setPrevCachedRequirement(cachedRequirement);
    if (cachedRequirement) {
      setForm((prev) => ({ ...prev, requirement: cachedRequirement }));
    }
  }

  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const [scheduledClassEvents, setScheduledClassEvents] = useState<ScheduledClassEvent[]>([]);
  const [discordIntegration, setDiscordIntegration] = useState<DiscordIntegrationSnapshot>({
    configured: false,
    connection: null,
    connections: [],
    channels: [],
  });
  const [discordIntegrationLoading, setDiscordIntegrationLoading] = useState(false);
  const [discordIntegrationBusy, setDiscordIntegrationBusy] = useState(false);
  const [discordIntegrationError, setDiscordIntegrationError] = useState<string | null>(null);
  const [discordSyncingEventId, setDiscordSyncingEventId] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [shareClassroom, setShareClassroom] = useState<StageListItem | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!themeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [themeOpen]);

  const loadClassrooms = useCallback(async () => {
    try {
      if (launchMode === 'teacher-server') {
        const response = await fetch('/api/classrooms', { cache: 'no-store' });
        const body = (await response.json().catch(() => null)) as {
          classrooms?: ServerClassroomSummary[];
          error?: string;
        } | null;
        if (!response.ok) {
          throw new Error(body?.error || 'Failed to load classrooms');
        }

        const serverClassrooms = (body?.classrooms ?? []).map((classroom) => ({
          id: classroom.id,
          name: classroom.name,
          description: classroom.description,
          sceneCount: classroom.sceneCount,
          createdAt: parseServerTimestamp(classroom.createdAt),
          updatedAt: parseServerTimestamp(classroom.updatedAt),
          interactiveMode: classroom.interactiveMode,
          creationMode: classroom.creationMode,
        }));
        setClassrooms(serverClassrooms);
        setThumbnails({});
        return;
      }

      const list = await listStages();
      setClassrooms(list);
      // Load first slide thumbnails
      if (list.length > 0) {
        const slides = await getFirstSlideByStages(list.map((c) => c.id));
        setThumbnails(slides);
      }
    } catch (err) {
      log.error('Failed to load classrooms:', err);
    }
  }, [launchMode]);

  const loadScheduledClassEvents = useCallback(async () => {
    try {
      if (launchMode === 'teacher-server') {
        const response = await fetch('/api/scheduled-classes', { cache: 'no-store' });
        const body = (await response.json().catch(() => null)) as ScheduledClassesApiBody | null;
        if (!response.ok) {
          throw new Error(body?.details || body?.error || 'Failed to load scheduled classes');
        }
        setScheduledClassEvents(sortScheduledClassEvents(body?.events ?? []));
        return;
      }

      setScheduledClassEvents(await listLocalScheduledClassEvents());
    } catch (err) {
      log.error('Failed to load scheduled classes:', err);
    }
  }, [launchMode]);

  const loadDiscordIntegration = useCallback(async () => {
    if (launchMode !== 'teacher-server') {
      return;
    }

    setDiscordIntegrationLoading(true);
    setDiscordIntegrationError(null);
    try {
      const response = await fetch('/api/integrations/discord/connection', { cache: 'no-store' });
      const body = (await response.json().catch(() => null)) as DiscordIntegrationApiBody | null;
      if (!response.ok) {
        throw new Error(body?.details || body?.error || 'Failed to load Discord integration');
      }
      setDiscordIntegration(toDiscordIntegrationSnapshot(body));
      setDiscordIntegrationError(body?.channelsError ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Discord integration';
      setDiscordIntegrationError(message);
      log.error('Failed to load Discord integration:', err);
    } finally {
      setDiscordIntegrationLoading(false);
    }
  }, [launchMode]);

  useDiscordStudioCallback({
    launchMode,
    refreshConnection: loadDiscordIntegration,
    t,
  });

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    loadClassrooms();
    loadScheduledClassEvents();
    loadDiscordIntegration();
  }, [loadClassrooms, loadDiscordIntegration, loadScheduledClassEvents]);

  const handleScheduleRequestFailure = async (response: Response) => {
    const body = (await response.json().catch(() => null)) as ScheduledClassesApiBody | null;
    throw new Error(body?.details || body?.error || 'Failed to save scheduled class');
  };

  const startScheduledClassGeneration = (input: ScheduledClassEventInput) => {
    const normalized = normalizeScheduledClassInput(input, { requireFutureStart: true });
    if (!normalized.ok) {
      throw new Error(normalized.error);
    }

    if (launchMode === 'public-demo' && !currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      throw new Error(t('settings.setupNeeded'));
    }

    const browserLocalGuardMessage = getBrowserLocalUnsupportedFlowGuard(
      getCurrentModelConfig(),
      'classroom-generation',
    );
    if (browserLocalGuardMessage) {
      throw new Error(browserLocalGuardMessage);
    }

    if (
      experiencePresetRequiresSource(form.experiencePreset) &&
      !hasHistoricalVlogSourcePath(false)
    ) {
      throw new Error(t('upload.historyVlogSourceRequired'));
    }

    clearClassroomLaunchContext();

    const requirements = buildRequirements(normalized.value.title);
    const scheduledClass = {
      title: normalized.value.title,
      startsAt: normalized.value.startsAt,
      ...(normalized.value.durationMinutes
        ? { durationMinutes: normalized.value.durationMinutes }
        : {}),
      ...(normalized.value.multiplayerGame
        ? { multiplayerGame: normalized.value.multiplayerGame }
        : {}),
    };

    sessionStorage.setItem(
      'generationSession',
      JSON.stringify({
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        sceneOutlines: null,
        currentStep: 'generating' as const,
        launchMode,
        homePath: getHomePathForLaunchMode(launchMode),
        scheduledClass,
      }),
    );

    router.push('/generation-preview');
  };

  const handleCreateScheduledClass = async (input: ScheduledClassEventInput) => {
    if (!input.classroomId) {
      startScheduledClassGeneration(input);
      return;
    }

    if (launchMode === 'teacher-server') {
      const response = await fetch('/api/scheduled-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        await handleScheduleRequestFailure(response);
      }
      const body = (await response.json()) as ScheduledClassesApiBody;
      if (!body.event) {
        throw new Error('Failed to save scheduled class');
      }
      setScheduledClassEvents((prev) => sortScheduledClassEvents([...prev, body.event!]));
      return;
    }

    const event = await createLocalScheduledClassEvent(input);
    setScheduledClassEvents((prev) => sortScheduledClassEvents([...prev, event]));
  };

  const handleUpdateScheduledClass = async (id: string, input: ScheduledClassEventInput) => {
    if (launchMode === 'teacher-server') {
      const response = await fetch('/api/scheduled-classes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...input }),
      });
      if (!response.ok) {
        await handleScheduleRequestFailure(response);
      }
      const body = (await response.json()) as ScheduledClassesApiBody;
      if (!body.event) {
        throw new Error('Failed to save scheduled class');
      }
      setScheduledClassEvents((prev) => mergeScheduledClassEvent(prev, body.event!));
      return;
    }

    const event = await updateLocalScheduledClassEvent(id, input);
    setScheduledClassEvents((prev) =>
      sortScheduledClassEvents(prev.map((item) => (item.id === id ? event : item))),
    );
  };

  const handleDeleteScheduledClass = async (id: string) => {
    if (launchMode === 'teacher-server') {
      const response = await fetch('/api/scheduled-classes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        await handleScheduleRequestFailure(response);
      }
      setScheduledClassEvents((prev) => prev.filter((event) => event.id !== id));
      return;
    }

    await deleteLocalScheduledClassEvent(id);
    setScheduledClassEvents((prev) => prev.filter((event) => event.id !== id));
  };

  const handleDiscordConnect = useCallback(() => {
    window.location.assign('/api/integrations/discord/oauth/start');
  }, []);

  const handleDiscordSelectConnection = useCallback(async (connectionId: string) => {
    if (!connectionId) return;

    setDiscordIntegrationBusy(true);
    setDiscordIntegrationError(null);
    try {
      const response = await fetch(
        `/api/integrations/discord/connection?connectionId=${encodeURIComponent(connectionId)}`,
        { cache: 'no-store' },
      );
      const body = (await response.json().catch(() => null)) as DiscordIntegrationApiBody | null;
      if (!response.ok) {
        throw new Error(body?.details || body?.error || 'Failed to load Discord connection');
      }
      setDiscordIntegration(toDiscordIntegrationSnapshot(body));
      setDiscordIntegrationError(body?.channelsError ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Discord connection';
      setDiscordIntegrationError(message);
      throw err;
    } finally {
      setDiscordIntegrationBusy(false);
    }
  }, []);

  const handleDiscordSaveChannel = useCallback(
    async (connectionId: string, channelId: string) => {
      setDiscordIntegrationBusy(true);
      setDiscordIntegrationError(null);
      try {
        const response = await fetch('/api/integrations/discord/connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, channelId }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response, 'Failed to save Discord channel'));
        }
        const body = (await response.json()) as DiscordIntegrationApiBody;
        setDiscordIntegration(toDiscordIntegrationSnapshot(body));
        setDiscordIntegrationError(body.channelsError ?? null);
        toast.success(t('home.schedule.discord.channelSaved'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save Discord channel';
        setDiscordIntegrationError(message);
        throw err;
      } finally {
        setDiscordIntegrationBusy(false);
      }
    },
    [t],
  );

  const handleDiscordDisconnect = useCallback(
    async (connectionId: string) => {
      setDiscordIntegrationBusy(true);
      setDiscordIntegrationError(null);
      try {
        const response = await fetch('/api/integrations/discord/connection', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: connectionId }),
        });
        if (!response.ok) {
          throw new Error(await readApiError(response, 'Failed to disconnect Discord'));
        }
        const body = (await response.json()) as DiscordIntegrationApiBody;
        setDiscordIntegration(toDiscordIntegrationSnapshot(body));
        setDiscordIntegrationError(body.channelsError ?? null);
        toast.success(t('home.schedule.discord.disconnected'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to disconnect Discord';
        setDiscordIntegrationError(message);
        throw err;
      } finally {
        setDiscordIntegrationBusy(false);
      }
    },
    [t],
  );

  const handleDiscordSyncScheduledClass = useCallback(
    async (eventId: string, connectionId?: string) => {
      setDiscordSyncingEventId(eventId);
      setDiscordIntegrationError(null);
      try {
        const requestOptions: RequestInit = {
          method: 'POST',
          ...(connectionId
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connectionId }),
              }
            : {}),
        };
        const response = await fetch(`/api/scheduled-classes/${eventId}/discord-sync`, {
          ...requestOptions,
        });
        const body = (await response.json().catch(() => null)) as ScheduledClassesApiBody | null;
        if (body?.event) {
          setScheduledClassEvents((prev) => mergeScheduledClassEvent(prev, body.event!));
        }
        if (!response.ok) {
          throw new Error(body?.details || body?.error || 'Failed to sync scheduled class');
        }
        if (!body?.event) {
          throw new Error('Failed to sync scheduled class');
        }
        toast.success(t('home.schedule.discord.synced'));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to sync scheduled class';
        setDiscordIntegrationError(message);
        throw err;
      } finally {
        setDiscordSyncingEventId(null);
      }
    },
    [t],
  );

  const openClassroom = useCallback(
    (classroomId: string) => {
      clearClassroomLaunchContext();
      writeClassroomLaunchContext({
        classroomId,
        launchMode,
        homePath: getHomePathForLaunchMode(launchMode),
      });
      router.push(`/classroom/${classroomId}`);
    },
    [launchMode, router],
  );

  const handleOpenExampleClassroom = useCallback(async () => {
    try {
      await ensureOpenRaicExampleSeeded();
      clearClassroomLaunchContext();
      writeClassroomLaunchContext({
        classroomId: EXAMPLE_COURSE_ID,
        launchMode: 'public-demo',
        homePath: getHomePathForLaunchMode('public-demo'),
      });
      router.push(`/classroom/${EXAMPLE_COURSE_ID}`);
    } catch (err) {
      log.error('Failed to seed example classroom:', err);
      setError('Unable to open the example classroom.');
    }
  }, [router]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const confirmDelete = async (id: string) => {
    setPendingDeleteId(null);
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const handleRename = async (id: string, newName: string) => {
    try {
      await renameStage(id, newName);
      setClassrooms((prev) => prev.map((c) => (c.id === id ? { ...c, name: newName } : c)));
    } catch (err) {
      log.error('Failed to rename classroom:', err);
      toast.error(t('classroom.renameFailed'));
    }
  };

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'language') localStorage.setItem(LANGUAGE_STORAGE_KEY, String(value));
      if (field === 'interactiveMode') {
        localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, String(value));
      }
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {
      /* ignore */
    }
  };

  const hasConfiguredWebSearchSource = useCallback(() => {
    if (!form.webSearch) {
      return false;
    }

    const settings = useSettingsStore.getState();
    const provider = WEB_SEARCH_PROVIDERS[settings.webSearchProviderId];
    const config = settings.webSearchProvidersConfig?.[settings.webSearchProviderId];
    if (!provider) {
      return false;
    }

    return Boolean(
      !provider.requiresApiKey ||
      config?.apiKey?.trim() ||
      config?.isServerConfigured ||
      config?.serverEnabled ||
      config?.hasOrganizationConfig ||
      config?.hasPersonalOverride,
    );
  }, [form.webSearch]);

  const hasHistoricalVlogSourcePath = useCallback(
    (allowPdf: boolean) => Boolean((allowPdf && form.pdfFile) || hasConfiguredWebSearchSource()),
    [form.pdfFile, hasConfiguredWebSearchSource],
  );

  const updateCreationMode = (creationMode: FormState['creationMode']) => {
    const interactiveMode = creationMode === 'game-arcade';
    setForm((prev) => ({
      ...prev,
      creationMode,
      interactiveMode,
      experiencePreset: creationMode === 'game-arcade' ? undefined : prev.experiencePreset,
    }));
    try {
      localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, String(interactiveMode));
    } catch {
      /* ignore */
    }
  };

  const updateExperiencePreset = (experiencePreset: ExperiencePreset) => {
    setForm((prev) => {
      const nextPreset = prev.experiencePreset === experiencePreset ? undefined : experiencePreset;
      return {
        ...prev,
        creationMode: 'course',
        experiencePreset: nextPreset,
      };
    });
  };

  const buildRequirements = useCallback(
    (requirement: string): UserRequirements => {
      const userProfile = useUserProfileStore.getState();
      const selectedTemplate = getGameTemplateDefinition(form.gameTemplateId);
      return {
        requirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
        interactiveMode: form.interactiveMode || undefined,
        experiencePreset:
          form.creationMode === 'course' ? form.experiencePreset || undefined : undefined,
        creationMode: form.creationMode === 'game-arcade' ? 'game-arcade' : undefined,
        gameTemplateId: form.creationMode === 'game-arcade' ? selectedTemplate.id : undefined,
        gameCreativeBrief:
          form.creationMode === 'game-arcade'
            ? `${requirement}\n\nArcade template: ${selectedTemplate.label}. ${selectedTemplate.promptHint}`
            : undefined,
      };
    },
    [
      form.creationMode,
      form.experiencePreset,
      form.gameTemplateId,
      form.interactiveMode,
      form.language,
      form.webSearch,
    ],
  );

  const showSetupToast = (icon: React.ReactNode, title: string, desc: string) => {
    toast.custom(
      (id) => (
        <button
          type="button"
          aria-label={`${title}. ${desc}.`}
          className="w-[356px] rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-gradient-to-r from-amber-50 via-white to-amber-50 dark:from-amber-950/60 dark:via-slate-900 dark:to-amber-950/60 shadow-lg shadow-amber-500/8 dark:shadow-amber-900/20 p-4 flex items-start gap-3 cursor-pointer"
          onClick={() => {
            toast.dismiss(id);
            setSettingsOpen(true);
          }}
        >
          <div className="shrink-0 mt-0.5 size-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center ring-1 ring-amber-200/50 dark:ring-amber-800/30">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 leading-tight">
              {title}
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-0.5 leading-relaxed">
              {desc}
            </p>
          </div>
          <div className="shrink-0 mt-1 text-[10px] font-medium text-amber-500 dark:text-amber-500/70 tracking-wide">
            <Settings className="size-3.5 motion-safe:animate-[spin_3s_linear_infinite] motion-reduce:animate-none" />
          </div>
        </button>
      ),
      { duration: 4000 },
    );
  };

  const handleGenerate = async () => {
    // Validate setup before proceeding
    if (launchMode === 'public-demo' && !currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600 dark:text-amber-400" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    if (
      experiencePresetRequiresSource(form.experiencePreset) &&
      !hasHistoricalVlogSourcePath(true)
    ) {
      setError(t('upload.historyVlogSourceRequired'));
      return;
    }

    const browserLocalGuardMessage = getBrowserLocalUnsupportedFlowGuard(
      getCurrentModelConfig(),
      'classroom-generation',
    );
    if (browserLocalGuardMessage) {
      setError(browserLocalGuardMessage);
      return;
    }

    setError(null);

    try {
      clearClassroomLaunchContext();

      const requirements = buildRequirements(form.requirement);

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (form.pdfFile) {
        pdfStorageKey = await storePdfBlob(form.pdfFile);
        pdfFileName = form.pdfFile.name;

        const settings = useSettingsStore.getState();
        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.baseUrl,
          };
        }
      }

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey,
        pdfFileName,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
        launchMode,
        homePath: getHomePathForLaunchMode(launchMode),
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    }
  };

  const formatDate = useCallback(
    (timestamp: number) => {
      const date = new Date(timestamp);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - date.getTime());
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return t('classroom.today');
      if (diffDays === 1) return t('classroom.yesterday');
      if (diffDays < 7) return `${diffDays} ${t('classroom.daysAgo')}`;
      return date.toLocaleDateString();
    },
    [t],
  );

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filteredClassrooms = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    if (!q) return classrooms;
    return classrooms.filter((classroom) => {
      const haystack = [
        classroom.name,
        classroom.description,
        classroom.sceneCount,
        formatDate(classroom.updatedAt),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [classrooms, deferredSearchQuery, formatDate]);

  const needsModelSetup = launchMode === 'public-demo' && !currentModelId;
  const canGenerate = !!form.requirement.trim();
  const primaryActionLabel = needsModelSetup
    ? t('toolbar.configureProvider')
    : t('toolbar.enterClassroom');
  const interactiveModeStateLabel = form.interactiveMode
    ? t('toolbar.interactiveModeOn')
    : t('toolbar.interactiveModeOff');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate) handleGenerate();
    }
  };

  return (
    <main className="min-h-[100dvh] w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col items-center p-4 pt-16 md:p-8 md:pt-16 overflow-x-hidden">
      {/* ═══ Top-right pill (unchanged) ═══ */}
      <div
        ref={toolbarRef}
        className="fixed top-4 right-4 z-50 flex items-center gap-1 bg-white/60 dark:bg-gray-800/60 backdrop-blur-md px-2 py-1.5 rounded-full border border-gray-100/50 dark:border-gray-700/50 shadow-sm"
      >
        {/* Language Selector */}
        <LanguageSwitcher onOpen={() => setThemeOpen(false)} />

        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

        {/* Theme Selector */}
        <div className="relative">
          <button
            type="button"
            aria-label={t('settings.theme')}
            onClick={() => {
              setThemeOpen(!themeOpen);
            }}
            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all"
          >
            {theme === 'light' && <Sun className="w-4 h-4" />}
            {theme === 'dark' && <Moon className="w-4 h-4" />}
            {theme === 'system' && <Monitor className="w-4 h-4" />}
          </button>
          {themeOpen && (
            <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[140px]">
              <button
                onClick={() => {
                  setTheme('light');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'light' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Sun className="w-4 h-4" />
                {t('settings.themeOptions.light')}
              </button>
              <button
                onClick={() => {
                  setTheme('dark');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'dark' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Moon className="w-4 h-4" />
                {t('settings.themeOptions.dark')}
              </button>
              <button
                onClick={() => {
                  setTheme('system');
                  setThemeOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2',
                  theme === 'system' &&
                    'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
                )}
              >
                <Monitor className="w-4 h-4" />
                {t('settings.themeOptions.system')}
              </button>
            </div>
          )}
        </div>

        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />

        {/* Settings Button */}
        <div className="relative">
          <button
            type="button"
            aria-label={t('settings.title')}
            data-testid="settings-button"
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-full text-gray-400 dark:text-gray-500 hover:bg-white dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 hover:shadow-sm transition-all group"
          >
            <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
          </button>
        </div>
      </div>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
        initialSection={settingsSection}
      />

      {/* ═══ Background Decor ═══ */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl motion-safe:animate-pulse motion-reduce:animate-none"
          style={{ animationDuration: 'var(--motion-duration-ambient)' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl motion-safe:animate-pulse motion-reduce:animate-none"
          style={{ animationDuration: 'calc(var(--motion-duration-ambient) + 1600ms)' }}
        />
      </div>

      {/* ═══ Hero section: title + input (centered, wider) ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={cn(
          'relative z-20 w-full max-w-[960px] flex flex-col items-center',
          classrooms.length === 0 ? 'justify-center min-h-[calc(100dvh-8rem)]' : 'mt-[10vh]',
        )}
      >
        <h1 className="sr-only">{t('home.slogan')}</h1>
        {/* ── Logo ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: 0.1,
            type: 'spring',
            stiffness: 180,
            damping: 18,
          }}
          className="mb-4 w-full px-1"
        >
          <div
            className="mx-auto w-full max-w-[880px] rounded-[32px] border border-white/50 dark:border-white/10 px-4 py-4 shadow-[0_28px_90px_rgba(43,20,97,0.22)] backdrop-blur-sm"
            style={{
              background:
                'radial-gradient(circle at 18% 28%, rgba(92, 225, 255, 0.18), transparent 24%), radial-gradient(circle at 76% 64%, rgba(184, 102, 255, 0.22), transparent 24%), linear-gradient(135deg, rgba(10, 8, 20, 0.96), rgba(18, 12, 40, 0.92))',
            }}
          >
            <motion.img
              src="/openraic-logo.svg"
              alt="Open-RAIC"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.45, ease: 'easeOut' }}
              className="mx-auto h-auto w-full max-w-[760px]"
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-5 w-full max-w-[800px] rounded-2xl border border-border/50 bg-background/80 px-4 py-3 shadow-sm"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Public demo classroom:</span> Open an
              example course that shows student-by-student differentiation by NWEA MAP RIT score.
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="open-example-classroom-button"
                onClick={() => void handleOpenExampleClassroom()}
              >
                Open demo classroom
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push('/example')}
              >
                Open /example
              </Button>
            </div>
          </div>
        </motion.div>

        <ScheduleClassesBox
          events={scheduledClassEvents}
          classrooms={classrooms.map((classroom) => ({
            id: classroom.id,
            name: classroom.name,
            creationMode: classroom.creationMode,
          }))}
          gameModeActive={form.creationMode === 'game-arcade'}
          onCreate={handleCreateScheduledClass}
          onUpdate={handleUpdateScheduledClass}
          onDelete={handleDeleteScheduledClass}
          onOpenClassroom={openClassroom}
          discordIntegration={
            launchMode === 'teacher-server'
              ? {
                  ...discordIntegration,
                  loading: discordIntegrationLoading,
                  busy: discordIntegrationBusy,
                  error: discordIntegrationError,
                  syncingEventId: discordSyncingEventId,
                  onConnect: handleDiscordConnect,
                  onSelectConnection: handleDiscordSelectConnection,
                  onSaveChannel: handleDiscordSaveChannel,
                  onDisconnect: handleDiscordDisconnect,
                  onSyncEvent: handleDiscordSyncScheduledClass,
                }
              : undefined
          }
        />

        {/* ── Slogan ── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="text-sm text-muted-foreground/60 mb-8"
        >
          {t('home.slogan')}
        </motion.p>

        {/* ── Unified input area ── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35 }}
          className="w-full max-w-[800px]"
        >
          <div className="w-full rounded-2xl border border-border/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-black/[0.03] dark:shadow-black/20 transition-shadow focus-within:shadow-2xl focus-within:shadow-violet-500/[0.06]">
            {/* ── Greeting + Profile + Agents ── */}
            <div className="relative z-20 flex items-start justify-between">
              <GreetingBar />
              <div className="pr-3 pt-3.5 shrink-0">
                <AgentBar />
              </div>
            </div>

            <div className="px-3 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
                  <button
                    type="button"
                    data-testid="creation-mode-course"
                    aria-pressed={form.creationMode === 'course'}
                    onClick={() => updateCreationMode('course')}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                      form.creationMode === 'course'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <BookOpen className="size-3.5" />
                    {t('toolbar.courseMode')}
                  </button>
                  <button
                    type="button"
                    data-testid="creation-mode-game"
                    aria-pressed={form.creationMode === 'game-arcade'}
                    onClick={() => updateCreationMode('game-arcade')}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors',
                      form.creationMode === 'game-arcade'
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Gamepad2 className="size-3.5" />
                    {t('toolbar.gameMode')}
                  </button>
                </div>

                {form.creationMode === 'course' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-testid="experience-preset-history-vlog"
                        aria-pressed={form.experiencePreset === HISTORICAL_VLOGGER_PRESET}
                        onClick={() => updateExperiencePreset(HISTORICAL_VLOGGER_PRESET)}
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold transition-colors',
                          form.experiencePreset === HISTORICAL_VLOGGER_PRESET
                            ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-950/45 dark:text-sky-200'
                            : 'border-border/60 bg-background/70 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Landmark className="size-3" />
                        {t(HISTORY_VLOG_PRESET_DEFINITION?.labelKey ?? 'toolbar.historyVlogPreset')}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      <div className="max-w-64 text-xs">
                        {t(
                          HISTORY_VLOG_PRESET_DEFINITION?.hintKey ??
                            'toolbar.historyVlogPresetHint',
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ) : null}

                {form.creationMode === 'game-arcade' ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
                      {t('toolbar.gameTemplateLabel')}
                    </span>
                    <div
                      data-testid="game-template-selector"
                      className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5"
                    >
                      {GAME_TEMPLATE_DEFINITIONS.map((template) => {
                        const TemplateIcon = GAME_TEMPLATE_ICONS[template.id];
                        const selected = form.gameTemplateId === template.id;
                        return (
                          <Tooltip key={template.id}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                data-testid={`game-template-${template.id}`}
                                aria-pressed={selected}
                                onClick={() => updateForm('gameTemplateId', template.id)}
                                className={cn(
                                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold transition-colors',
                                  selected
                                    ? 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950/45 dark:text-violet-200'
                                    : 'border-border/60 bg-background/70 text-muted-foreground hover:text-foreground',
                                )}
                              >
                                <TemplateIcon className="size-3" />
                                {template.shortLabel}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8}>
                              <div className="max-w-56">
                                <div className="font-medium">{template.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {template.description}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Textarea */}
            <label htmlFor="requirement-input" className="sr-only">
              {t('upload.requirementPlaceholder')}
            </label>
            <textarea
              id="requirement-input"
              ref={textareaRef}
              data-testid="requirement-input"
              aria-label={t('upload.requirementPlaceholder')}
              placeholder={
                form.creationMode === 'game-arcade'
                  ? t('upload.gameRequirementPlaceholder')
                  : t('upload.requirementPlaceholder')
              }
              className="w-full resize-none border-0 bg-transparent px-4 pt-1 pb-2 text-[13px] leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none min-h-[140px] max-h-[300px]"
              value={form.requirement}
              onChange={(e) => updateForm('requirement', e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
            />

            {/* Toolbar row */}
            <div className="px-3 pb-3 flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <GenerationToolbar
                  language={form.language}
                  onLanguageChange={(lang) => updateForm('language', lang)}
                  webSearch={form.webSearch}
                  onWebSearchChange={(v) => updateForm('webSearch', v)}
                  onSettingsOpen={(section) => {
                    setSettingsSection(section);
                    setSettingsOpen(true);
                  }}
                  pdfFile={form.pdfFile}
                  onPdfFileChange={(f) => updateForm('pdfFile', f)}
                  onPdfError={setError}
                />
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    data-testid="deep-interactive-toggle"
                    onClick={() => {
                      if (form.creationMode === 'game-arcade') return;
                      updateForm('interactiveMode', !form.interactiveMode);
                    }}
                    className={cn(
                      'relative inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[11px] font-semibold shadow-sm transition-colors',
                      form.creationMode === 'game-arcade' ? 'cursor-default' : 'cursor-pointer',
                      form.interactiveMode
                        ? 'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-700 dark:bg-violet-950/45 dark:text-violet-200'
                        : 'border-border/60 bg-background/80 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {form.interactiveMode ? (
                      <span className="absolute inset-0 rounded-lg border border-violet-300/70 opacity-60 motion-safe:animate-[interactive-mode-breathe_1.8s_ease-in-out_infinite] dark:border-violet-500/60" />
                    ) : null}
                    <Atom className="relative size-3.5" />
                    <span className="relative hidden sm:inline">
                      {t('toolbar.interactiveModeLabel')}
                    </span>
                    <span
                      data-testid="deep-interactive-state"
                      className={cn(
                        'relative rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none',
                        form.interactiveMode
                          ? 'bg-violet-600 text-white dark:bg-violet-500 dark:text-violet-950'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {interactiveModeStateLabel}
                    </span>
                    <Switch
                      checked={form.interactiveMode}
                      onCheckedChange={(checked) => updateForm('interactiveMode', checked)}
                      onClick={(event) => event.stopPropagation()}
                      disabled={form.creationMode === 'game-arcade'}
                      aria-label={`${t('toolbar.interactiveModeLabel')}: ${interactiveModeStateLabel}`}
                      className="relative origin-right scale-[0.78] data-[state=checked]:bg-violet-600"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <div className="flex flex-col gap-1">
                    <span>{t('toolbar.interactiveModeHint')}</span>
                    <span className="font-medium">
                      {t('toolbar.interactiveModeLabel')}: {interactiveModeStateLabel}
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>

              {/* Voice input */}
              <SpeechButton
                size="md"
                onTranscription={(text) => {
                  setForm((prev) => {
                    const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                    updateRequirementCache(next);
                    return { ...prev, requirement: next };
                  });
                }}
              />

              {/* Send button */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                type="button"
                aria-label={primaryActionLabel}
                data-testid="enter-classroom-button"
                className={cn(
                  'shrink-0 h-8 rounded-lg flex items-center justify-center gap-1.5 transition-all px-3',
                  canGenerate
                    ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm cursor-pointer'
                    : 'bg-muted text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                <span className="text-xs font-medium">{primaryActionLabel}</span>
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          </div>
        </motion.div>

        {/* ── Error ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              role={error.includes('setup') ? 'alert' : 'status'}
              aria-live={error.includes('setup') ? 'assertive' : 'polite'}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
            >
              <p className="text-sm text-destructive">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ═══ Recent classrooms — collapsible ═══ */}
      {classrooms.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="relative z-10 mt-10 w-full max-w-6xl flex flex-col items-center"
        >
          {/* Trigger — divider-line with centered text */}
          <button
            type="button"
            aria-expanded={recentOpen}
            aria-controls="recent-classrooms-panel"
            aria-label={t('classroom.recentClassrooms')}
            onClick={() => persistRecentOpen(!recentOpen)}
            className="group w-full flex items-center gap-4 py-2 cursor-pointer"
          >
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
            <span className="shrink-0 flex items-center gap-2 text-[13px] text-muted-foreground/60 group-hover:text-foreground/70 transition-colors select-none">
              <Clock className="size-3.5" />
              {t('classroom.recentClassrooms')}
              <span className="text-[11px] tabular-nums opacity-60">{classrooms.length}</span>
              <motion.div
                animate={{ rotate: recentOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
              >
                <ChevronDown className="size-3.5" />
              </motion.div>
            </span>
            <div className="flex-1 h-px bg-border/40 group-hover:bg-border/70 transition-colors" />
          </button>

          <div className="mt-3 flex w-full justify-end">
            <AnimatePresence mode="wait">
              {!searchOpen ? (
                <motion.button
                  key="search-button"
                  ref={searchButtonRef}
                  type="button"
                  aria-label={locale === 'zh-CN' ? '搜索最近课堂' : 'Search recent classrooms'}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  onClick={() => {
                    setSearchOpen(true);
                    if (!recentOpen) persistRecentOpen(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 text-xs text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                >
                  <Search className="size-3.5" />
                  {locale === 'zh-CN' ? '搜索' : 'Search'}
                </motion.button>
              ) : (
                <motion.div
                  key="search-input"
                  initial={{ opacity: 0, width: 44 }}
                  animate={{ opacity: 1, width: 260 }}
                  exit={{ opacity: 0, width: 44 }}
                  className="relative"
                >
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        if (searchQuery) {
                          setSearchQuery('');
                        } else {
                          setSearchOpen(false);
                          requestAnimationFrame(() => searchButtonRef.current?.focus());
                        }
                      }
                    }}
                    onBlur={() => {
                      if (!searchQuery) setSearchOpen(false);
                    }}
                    placeholder={locale === 'zh-CN' ? '按名称或日期搜索' : 'Search name or date'}
                    aria-label={locale === 'zh-CN' ? '搜索最近课堂' : 'Search recent classrooms'}
                    className="h-8 w-full rounded-full border border-border/60 bg-background/90 pl-8 pr-8 text-xs outline-none transition-shadow focus:border-ring focus:ring-2 focus:ring-ring/20"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      aria-label={locale === 'zh-CN' ? '清除搜索' : 'Clear search'}
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Expandable content */}
          <AnimatePresence>
            {recentOpen && (
              <motion.div
                id="recent-classrooms-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-full overflow-hidden"
              >
                <div className="pt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-8">
                  {searchQuery.trim() && filteredClassrooms.length === 0 ? (
                    <div className="col-span-full rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground">
                      {locale === 'zh-CN' ? '没有找到匹配的课堂' : 'No matching classrooms'}
                    </div>
                  ) : null}
                  {filteredClassrooms.map((classroom, i) => (
                    <motion.div
                      key={classroom.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: i * 0.04,
                        duration: 0.35,
                        ease: 'easeOut',
                      }}
                    >
                      <ClassroomCard
                        classroom={classroom}
                        slide={thumbnails[classroom.id]}
                        formatDate={formatDate}
                        onDelete={handleDelete}
                        onRename={handleRename}
                        confirmingDelete={pendingDeleteId === classroom.id}
                        onConfirmDelete={() => confirmDelete(classroom.id)}
                        onCancelDelete={() => setPendingDeleteId(null)}
                        showLocalActions={launchMode === 'public-demo'}
                        onShare={
                          launchMode === 'teacher-server'
                            ? () => setShareClassroom(classroom)
                            : undefined
                        }
                        onClick={() => {
                          openClassroom(classroom.id);
                        }}
                      />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      <ClassroomShareDialog
        open={shareClassroom !== null}
        onOpenChange={(open) => {
          if (!open) setShareClassroom(null);
        }}
        classroomId={shareClassroom?.id ?? null}
        classroomName={shareClassroom?.name}
      />

      {/* Footer — flows with content, at the very end */}
      <div className="mt-auto pt-12 pb-4 text-center text-xs text-muted-foreground/40">
        <a
          href="https://github.com/spheng51/RAIC"
          target="_blank"
          rel="noreferrer"
          className="transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Open-RAIC Open Source Project
        </a>
      </div>
    </main>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  // Click-outside to collapse
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative pl-4 pr-2 pt-3.5 pb-1 w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

      {/* ── Collapsed pill (always in flow) ── */}
      {!open && (
        <button
          className="flex items-center gap-2.5 cursor-pointer transition-all duration-200 group rounded-full px-2.5 py-1.5 border border-border/50 text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
          type="button"
          aria-label={t('home.greetingWithName', { name: displayName })}
          onClick={() => setOpen(true)}
        >
          <div className="shrink-0 relative">
            <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-border/30 group-hover:ring-violet-400/60 dark:group-hover:ring-violet-400/40 transition-all duration-300">
              <img src={avatar} alt="" className="size-full object-cover" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/40 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
              <Pencil className="size-[7px] text-muted-foreground/70" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="leading-none select-none flex items-center gap-1">
                  <span className="text-[13px] font-semibold text-foreground/85 group-hover:text-foreground transition-colors">
                    {t('home.greetingWithName', { name: displayName })}
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t('profile.editTooltip')}
              </TooltipContent>
            </Tooltip>
          </div>
        </button>
      )}

      {/* ── Expanded panel (absolute, floating) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-4 top-3.5 z-50 w-64"
          >
            <div className="rounded-2xl bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_8px_-2px_rgba(0,0,0,0.3)] px-2.5 py-2">
              {/* ── Row: avatar + name ── */}
              <div className="flex items-center gap-2.5 transition-all duration-200">
                {/* Avatar */}
                <button
                  type="button"
                  className="shrink-0 relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                  aria-label={t('profile.uploadAvatar')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-violet-300/70 dark:ring-violet-500/40 transition-all duration-300">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white dark:bg-slate-800 border border-border/60 flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-muted-foreground/70 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </button>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b border-border/80 text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/40"
                      />
                      <button
                        type="button"
                        aria-label="Save profile name"
                        onClick={commitName}
                        className="shrink-0 size-5 rounded flex items-center justify-center text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('profile.editTooltip')}
                      title={t('profile.editTooltip')}
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-foreground/85 group-hover/name:text-foreground transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-muted-foreground/30 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </button>
                  )}
                </div>

                {/* Collapse arrow */}
                <motion.button
                  type="button"
                  aria-label={t('common.close')}
                  onClick={() => {
                    setOpen(false);
                    setEditingName(false);
                    setAvatarPickerOpen(false);
                  }}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-full flex items-center justify-center hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <ChevronUp className="size-3.5 text-muted-foreground/50" />
                </motion.button>
              </div>

              {/* ── Expandable content ── */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                {/* Avatar picker */}
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2.5 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-full overflow-hidden bg-gray-50 dark:bg-gray-800 cursor-pointer transition-all duration-150',
                              'hover:scale-110 active:scale-95',
                              avatar === url
                                ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0'
                                : 'hover:ring-1 hover:ring-muted-foreground/30',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <button
                          type="button"
                          aria-label={t('profile.uploadAvatar')}
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-110 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'ring-2 ring-violet-400 dark:ring-violet-500 ring-offset-0 border-violet-300 dark:border-violet-600 bg-violet-50 dark:bg-violet-900/30'
                              : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bio */}
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border-border/40 bg-transparent min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-border/60"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Classroom Card — clean, minimal style ──────────────────────
function ClassroomCard({
  classroom,
  slide,
  formatDate,
  onDelete,
  onRename,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  showLocalActions,
  onShare,
  onClick,
}: {
  classroom: StageListItem;
  slide?: Slide;
  formatDate: (ts: number) => string;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onRename: (id: string, newName: string) => void;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  showLocalActions?: boolean;
  onShare?: () => void;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameDraft(classroom.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (!editing) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== classroom.name) {
      onRename(classroom.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      role="button"
      tabIndex={confirmingDelete ? -1 : 0}
      aria-label={`Open classroom ${classroom.name}`}
      className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
      onClick={confirmingDelete ? undefined : onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!confirmingDelete) {
            onClick();
          }
        }
      }}
    >
      {/* Thumbnail — large radius, no border, subtle bg */}
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] rounded-2xl bg-slate-100 dark:bg-slate-800/80 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02]"
      >
        {slide && thumbWidth > 0 ? (
          <ThumbnailSlide
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
          />
        ) : !slide ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-violet-100 to-blue-100 dark:from-violet-900/30 dark:to-blue-900/30 flex items-center justify-center">
              <span className="text-xl opacity-50">📄</span>
            </div>
          </div>
        ) : null}

        {onShare ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('classroom.share.open')}
            className="absolute top-2 left-2 size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity bg-black/30 hover:bg-blue-500/80 text-white hover:text-white backdrop-blur-sm rounded-full"
            onClick={(e) => {
              e.stopPropagation();
              onShare();
            }}
          >
            <Share2 className="size-3.5" />
          </Button>
        ) : null}

        {classroom.interactiveMode ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="absolute bottom-2 left-2 inline-flex size-7 items-center justify-center rounded-full bg-violet-600/90 text-white shadow-sm backdrop-blur">
                <Atom className="size-3.5" />
                <span className="sr-only">{t('toolbar.interactiveModeLabel')}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {t('toolbar.interactiveModeLabel')}
            </TooltipContent>
          </Tooltip>
        ) : null}

        {/* Delete — top-right, only on hover */}
        <AnimatePresence>
          {showLocalActions && !confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('classroom.delete')}
                className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-destructive/80 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(classroom.id, e);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('common.rename')}
                className="absolute top-2 right-11 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 hover:bg-black/50 text-white hover:text-white backdrop-blur-sm rounded-full"
                onClick={startRename}
              >
                <Pencil className="size-3.5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inline delete confirmation overlay */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/50 backdrop-blur-[6px]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[13px] font-medium text-white/90">
                {t('classroom.deleteConfirmTitle')}?
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={t('common.cancel')}
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-white/15 text-white/80 hover:bg-white/25 backdrop-blur-sm transition-colors"
                  onClick={onCancelDelete}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  aria-label={t('classroom.delete')}
                  className="px-3.5 py-1 rounded-lg text-[12px] font-medium bg-red-500/90 text-white hover:bg-red-500 transition-colors"
                  onClick={onConfirmDelete}
                >
                  {t('classroom.delete')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info — outside the thumbnail */}
      <div className="mt-2.5 px-1 flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
          {showLocalActions ? t('classroom.localDemoBadge') : t('classroom.teacherBackedBadge')} ·{' '}
          {classroom.sceneCount} {t('classroom.slides')} · {formatDate(classroom.updatedAt)}
        </span>
        {editing ? (
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={commitRename}
              maxLength={100}
              placeholder={t('classroom.renamePlaceholder')}
              className="w-full bg-transparent border-b border-violet-400/60 text-[15px] font-medium text-foreground/90 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="font-medium text-[15px] truncate text-foreground/90 min-w-0 cursor-text"
                onDoubleClick={startRename}
              >
                {classroom.name}
              </p>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={4}
              className="!max-w-[min(90vw,32rem)] break-words whitespace-normal"
            >
              <div className="flex items-center gap-1.5">
                <span className="break-all">{classroom.name}</span>
                <button
                  aria-label={t('classroom.nameCopied')}
                  className="shrink-0 p-0.5 rounded hover:bg-foreground/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(classroom.name);
                    toast.success(t('classroom.nameCopied'));
                  }}
                >
                  <Copy className="size-3 opacity-60" />
                </button>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}
