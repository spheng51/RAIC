'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStageStore } from '@/lib/store';
import { PENDING_SCENE_ID } from '@/lib/store/stage';
import { useCanvasStore } from '@/lib/store/canvas';
import { useSettingsStore } from '@/lib/store/settings';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import { useClassroomCollaborationState } from '@/lib/hooks/use-classroom-collaboration-state';
import { useClassroomPresentationState } from '@/lib/hooks/use-classroom-presentation-state';
import { useI18n } from '@/lib/hooks/use-i18n';
import { SceneSidebar } from './stage/scene-sidebar';
import { LiveClassroomCockpit } from './stage/live-classroom-cockpit';
import { BoardNotesPanel } from './stage/board-notes-panel';
import { LessonFlowPanel } from './stage/lesson-flow-panel';
import { Header } from './header';
import { CanvasArea } from '@/components/canvas/canvas-area';
import { MiroFishManagerDialog } from '@/components/mirofish/mirofish-manager-dialog';
import type { MiroFishHostEvent } from '@/components/mirofish/mirofish-pane';
import { Roundtable } from '@/components/roundtable';
import { PlaybackEngine, computePlaybackView } from '@/lib/playback';
import type { EngineMode, TriggerEvent, Effect } from '@/lib/playback';
import { ActionEngine } from '@/lib/action/engine';
import { createAudioPlayer } from '@/lib/utils/audio-player';
import { useDiscussionTTS } from '@/lib/hooks/use-discussion-tts';
import type { AudioIndicatorState } from '@/components/roundtable/audio-indicator';
import type { Action, DiscussionAction, SpeechAction } from '@/lib/types/action';
import type {
  ClassroomCollaborationAction,
  ClassroomCollaborationStatePayload,
} from '@/lib/types/classroom-collaboration';
import type { ClassroomPresentationStatePayload } from '@/lib/types/classroom-presentation';
import type {
  MiroFishCreationJobStatus,
  MiroFishCreationPlanRequest,
  MiroFishCreationSpec,
} from '@/lib/types/mirofish-authoring';
import type {
  ClassroomLiveMeeting,
  PresentationSurface,
  SharedSimulation,
  SharedSimulationCollaborationMode,
  SharedSimulationStatus,
} from '@/lib/types/stage';
import { cn } from '@/lib/utils';
import { buildClassroomLessonState } from '@/lib/classroom/lesson-state';
import {
  getSharedSimulationCollaborationMode,
  getSharedSimulationInteractionReason,
  getControllerDisplayName,
  hasSharedSimulationReport,
  mergePresentationStateSharedSimulation,
  preserveStageSharedSimulation,
} from '@/lib/utils/classroom-presentation';
import {
  buildLiveClassroomApprovalItems,
  buildLiveClassroomStudentPulse,
  canShowLiveClassroomCockpit,
  getLiveClassroomSurfaceLabel,
} from '@/lib/utils/live-classroom-cockpit';
// Playback state persistence removed — refresh always starts from the beginning
import { ChatArea, type ChatAreaRef } from '@/components/chat/chat-area';
import { agentsToParticipants, useAgentRegistry } from '@/lib/orchestration/registry/store';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { VisuallyHidden } from 'radix-ui';
import { toast } from 'sonner';

/**
 * Stage Component
 *
 * The main container for the classroom/course.
 * Combines sidebar (scene navigation) and content area (scene viewer).
 * Supports two modes: autonomous and playback.
 */
function getInitialPresentationState(
  sharedSimulation: SharedSimulation | null | undefined,
): ClassroomPresentationStatePayload | null {
  if (!sharedSimulation) {
    return null;
  }

  return {
    activeSurface: sharedSimulation.activeSurface,
    controllerSessionId: sharedSimulation.controllerSessionId ?? null,
    controllerRole: sharedSimulation.controllerRole,
    controlLeaseExpiresAt: sharedSimulation.controlLeaseExpiresAt ?? null,
    simulationStatus: sharedSimulation.status,
    reportAvailable: hasSharedSimulationReport(sharedSimulation),
    sharedSimulation,
    liveMeeting: null,
    runUrl: sharedSimulation.runUrl,
    reportUrl: sharedSimulation.reportUrl ?? null,
    viewerSessionId: '',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanManageSimulation: false,
    viewerCanControlPresentation: false,
    viewerHasSimulationControl: false,
    participants: [],
  };
}

function getInitialCollaborationState(
  sharedSimulation: SharedSimulation | null | undefined,
): ClassroomCollaborationStatePayload | null {
  if (!sharedSimulation) {
    return null;
  }

  return {
    collaborationMode: sharedSimulation.collaborationMode ?? 'single-controller',
    collaborationState: sharedSimulation.collaborationState ?? 'inactive',
    allowStudentInteraction: sharedSimulation.allowStudentInteraction !== false,
    spotlightSessionId: sharedSimulation.spotlightSessionId ?? null,
    participantCount: sharedSimulation.participantCount ?? 0,
    participants: [],
    mirofishSessionId: sharedSimulation.mirofishSessionId ?? null,
    lastCollaborationSyncAt: sharedSimulation.lastCollaborationSyncAt ?? null,
    viewerSessionId: '',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanModerateCollaboration: false,
    viewerCanInteract: false,
    viewerIsRemoved: false,
    viewerInteractionReason: getSharedSimulationInteractionReason(sharedSimulation, {
      id: '',
      kind: 'web',
      role: 'teacher',
    }),
    multiUserEnabled: false,
  };
}

export function Stage({
  onRetryOutline,
  classroomSource,
  classroomNotice,
  homePath,
  onSceneCompleted,
  onSceneSelected,
  onOpenClassroomShare,
  onMakeShareable,
  makeShareablePending,
}: {
  onRetryOutline?: (outlineId: string) => Promise<void>;
  classroomSource?: 'public-demo' | 'teacher-server' | null;
  classroomNotice?: string | null;
  homePath?: string;
  onSceneCompleted?: (sceneId: string) => void;
  onSceneSelected?: (input: {
    fromSceneId: string | null;
    toSceneId: string;
    reason: 'manual' | 'auto' | 'pending';
  }) => void;
  onOpenClassroomShare?: () => void;
  onMakeShareable?: () => void;
  makeShareablePending?: boolean;
}) {
  const { t } = useI18n();
  const stage = useStageStore.use.stage();
  const { mode, getCurrentScene, scenes, currentSceneId, setCurrentSceneId, generatingOutlines } =
    useStageStore();
  const failedOutlines = useStageStore.use.failedOutlines();

  const currentScene = getCurrentScene();

  // Layout state from settings store (persisted via localStorage)
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const chatAreaWidth = useSettingsStore((s) => s.chatAreaWidth);
  const setChatAreaWidth = useSettingsStore((s) => s.setChatAreaWidth);
  const chatAreaCollapsed = useSettingsStore((s) => s.chatAreaCollapsed);
  const setChatAreaCollapsed = useSettingsStore((s) => s.setChatAreaCollapsed);
  const selectedModelFallback = useSettingsStore((s) => `${s.providerId}:${s.modelId}`);
  const setTTSMuted = useSettingsStore((s) => s.setTTSMuted);
  const setTTSVolume = useSettingsStore((s) => s.setTTSVolume);
  const autoPlayLecture = useSettingsStore((s) => s.autoPlayLecture);
  const setAutoPlayLecture = useSettingsStore((s) => s.setAutoPlayLecture);

  // PlaybackEngine state
  const [engineMode, setEngineMode] = useState<EngineMode>('idle');
  const [playbackCompleted, setPlaybackCompleted] = useState(false); // Distinguishes "never played" idle from "finished" idle
  const [lectureSpeech, setLectureSpeech] = useState<string | null>(null); // From PlaybackEngine (lecture)
  const [liveSpeech, setLiveSpeech] = useState<string | null>(null); // From buffer (discussion/QA)
  const [speechProgress, setSpeechProgress] = useState<number | null>(null); // StreamBuffer reveal progress (0–1)
  const [discussionTrigger, setDiscussionTrigger] = useState<TriggerEvent | null>(null);

  // Speaking agent tracking (Issue 2)
  const [speakingAgentId, setSpeakingAgentId] = useState<string | null>(null);

  // Thinking state (Issue 5)
  const [thinkingState, setThinkingState] = useState<{
    stage: string;
    agentId?: string;
    text?: string;
  } | null>(null);

  // Cue user state (Issue 7)
  const [isCueUser, setIsCueUser] = useState(false);

  // End flash state (Issue 3)
  const [showEndFlash, setShowEndFlash] = useState(false);
  const [endFlashSessionType, setEndFlashSessionType] = useState<'qa' | 'discussion'>('discussion');

  // Streaming state for stop button (Issue 1)
  const [chatIsStreaming, setChatIsStreaming] = useState(false);
  const [chatSessionType, setChatSessionType] = useState<string | null>(null);

  // Topic pending state: session is soft-paused, bubble stays visible, waiting for user input
  const [isTopicPending, setIsTopicPending] = useState(false);

  // Active bubble ID for playback highlight in chat area (Issue 8)
  const [activeBubbleId, setActiveBubbleId] = useState<string | null>(null);

  // Scene switch confirmation dialog state
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [isPresenting, setIsPresenting] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isPresentationInteractionActive, setIsPresentationInteractionActive] = useState(false);
  const [miroFishManagerOpen, setMiroFishManagerOpen] = useState(false);
  const [cockpitOpen, setCockpitOpen] = useState(false);
  const [livePromptsLocked, setLivePromptsLocked] = useState(false);
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState<string[]>([]);
  const [presentationState, setPresentationState] =
    useState<ClassroomPresentationStatePayload | null>(() =>
      getInitialPresentationState(stage?.sharedSimulation),
    );
  const [collaborationState, setCollaborationState] =
    useState<ClassroomCollaborationStatePayload | null>(() =>
      getInitialCollaborationState(stage?.sharedSimulation),
    );
  const [miroFishSessionEmbed, setMiroFishSessionEmbed] = useState<{
    simulationId: string;
    mirofishSessionId: string;
    embedUrl: string;
    tokenExpiresAt: string | null;
    capabilities: string[];
  } | null>(null);
  const [presentationFallbackMessage, setPresentationFallbackMessage] = useState<string | null>(
    null,
  );
  const [miroFishAuthoringAvailable, setMiroFishAuthoringAvailable] = useState(false);

  // Whiteboard state (from canvas store so AI tools can open it)
  const whiteboardOpen = useCanvasStore.use.whiteboardOpen();
  const setWhiteboardOpen = useCanvasStore.use.setWhiteboardOpen();

  // Selected agents from settings store (Zustand)
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const ttsMuted = useSettingsStore((s) => s.ttsMuted);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);

  // Generate participants from selected agents
  const participants = useMemo(
    () => agentsToParticipants(selectedAgentIds, t),
    [selectedAgentIds, t],
  );

  // Resolved AgentConfig array for hooks that need full agent objects
  // Subscribe to the agents record so voiceConfig changes trigger re-resolution
  const agentsRecord = useAgentRegistry((s) => s.agents);
  const selectedAgents = useMemo(
    () => selectedAgentIds.map((id) => agentsRecord[id]).filter((a): a is AgentConfig => a != null),
    [agentsRecord, selectedAgentIds],
  );

  // Discussion TTS: audio indicator state
  const [audioIndicatorState, setAudioIndicatorState] = useState<AudioIndicatorState>('idle');
  const [audioAgentId, setAudioAgentId] = useState<string | null>(null);

  const discussionTTS = useDiscussionTTS({
    enabled: ttsEnabled && !ttsMuted,
    agents: selectedAgents,
    onAudioStateChange: (agentId, state) => {
      setAudioAgentId(agentId);
      setAudioIndicatorState(state);
    },
  });

  // Pick a student agent for discussion trigger (prioritize student > non-teacher > fallback)
  const pickStudentAgent = useCallback((): string => {
    const registry = useAgentRegistry.getState();
    const agents = selectedAgentIds
      .map((id) => registry.getAgent(id))
      .filter((a): a is AgentConfig => a != null);
    const students = agents.filter((a) => a.role === 'student');
    if (students.length > 0) {
      return students[Math.floor(Math.random() * students.length)].id;
    }
    const nonTeachers = agents.filter((a) => a.role !== 'teacher');
    if (nonTeachers.length > 0) {
      return nonTeachers[Math.floor(Math.random() * nonTeachers.length)].id;
    }
    return agents[0]?.id || 'default-1';
  }, [selectedAgentIds]);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const audioPlayerRef = useRef(createAudioPlayer());
  const chatAreaRef = useRef<ChatAreaRef>(null);
  const lectureSessionIdRef = useRef<string | null>(null);
  const lectureActionCounterRef = useRef(0);
  const discussionAbortRef = useRef<AbortController | null>(null);
  const presentationIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentationFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previousApprovalCountRef = useRef(0);
  // Guard to prevent double flash when manual stop triggers onDiscussionEnd
  const manualStopRef = useRef(false);
  // Monotonic counter incremented on each scene switch — used to discard stale SSE callbacks
  const sceneEpochRef = useRef(0);
  // When true, the next engine init will auto-start playback (for auto-play scene advance)
  const autoStartRef = useRef(false);
  // Discussion buffer-level pause state (distinct from soft-pause which aborts SSE)
  const [isDiscussionPaused, setIsDiscussionPaused] = useState(false);

  /**
   * Resume a soft-paused topic: re-call /chat with existing session messages.
   * The director picks the next agent to continue.
   */
  const doResumeTopic = useCallback(async () => {
    // Clear old bubble immediately — no lingering on interrupted text
    setIsTopicPending(false);
    setLiveSpeech(null);
    setSpeakingAgentId(null);
    setThinkingState({ stage: 'director' });
    setChatIsStreaming(true);
    // Transition engine back to live — onInputActivate paused it when soft-pausing,
    // so we must explicitly resume to keep engine mode in sync with the chat loop.
    engineRef.current?.resume();
    // Fire new chat round — SSE events will drive thinking → agent_start → speech
    await chatAreaRef.current?.resumeActiveSession();
  }, []);

  /** Reset all live/discussion state (shared by doSessionCleanup & onDiscussionEnd) */
  const resetLiveState = useCallback(() => {
    setLiveSpeech(null);
    setSpeakingAgentId(null);
    setSpeechProgress(null);
    setThinkingState(null);
    setIsCueUser(false);
    setIsTopicPending(false);
    setChatIsStreaming(false);
    setChatSessionType(null);
    setIsDiscussionPaused(false);
  }, []);

  /** Full scene reset (scene switch) — resetLiveState + lecture/visual state */
  const resetSceneState = useCallback(() => {
    resetLiveState();
    setPlaybackCompleted(false);
    setLectureSpeech(null);
    setSpeechProgress(null);
    setShowEndFlash(false);
    setActiveBubbleId(null);
    setDiscussionTrigger(null);
  }, [resetLiveState]);

  /** Request failure should exit live discussion UI without hard-closing the session. */
  const handleLiveSessionError = useCallback(() => {
    engineRef.current?.handleDiscussionError();
    resetLiveState();
    setActiveBubbleId(null);
  }, [resetLiveState]);

  /**
   * Unified session cleanup — called by both roundtable stop button and chat area end button.
   * Handles: engine transition, flash, roundtable state clearing.
   */
  const doSessionCleanup = useCallback(() => {
    const activeType = chatSessionType;

    // Engine cleanup — guard to avoid double flash from onDiscussionEnd
    manualStopRef.current = true;
    engineRef.current?.handleEndDiscussion();
    manualStopRef.current = false;

    // Show end flash with correct session type
    if (activeType === 'qa' || activeType === 'discussion') {
      setEndFlashSessionType(activeType);
      setShowEndFlash(true);
      setTimeout(() => setShowEndFlash(false), 1800);
    }

    // Stop any in-flight discussion TTS audio
    discussionTTS.cleanup();

    resetLiveState();
  }, [chatSessionType, resetLiveState, discussionTTS]);

  // Shared stop-discussion handler (used by both Roundtable and Canvas toolbar)
  const handleStopDiscussion = useCallback(async () => {
    await chatAreaRef.current?.endActiveSession();
    doSessionCleanup();
  }, [doSessionCleanup]);

  const clearPresentationIdleTimer = useCallback(() => {
    if (presentationIdleTimerRef.current) {
      clearTimeout(presentationIdleTimerRef.current);
      presentationIdleTimerRef.current = null;
    }
  }, []);

  const resetPresentationIdleTimer = useCallback(() => {
    setControlsVisible(true);
    clearPresentationIdleTimer();
    if (isPresenting && !isPresentationInteractionActive) {
      presentationIdleTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [clearPresentationIdleTimer, isPresenting, isPresentationInteractionActive]);

  const togglePresentation = useCallback(async () => {
    const stageElement = stageRef.current;
    if (!stageElement) return;

    try {
      if (document.fullscreenElement === stageElement) {
        // Unlock Escape key before exiting fullscreen
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
        await document.exitFullscreen();
        return;
      }

      setControlsVisible(true);
      await stageElement.requestFullscreen();
      // Lock Escape key so it doesn't auto-exit fullscreen (#255)
      // Escape is handled manually in our keydown handler instead
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (navigator as any).keyboard?.lock?.(['Escape']).catch(() => {});
      setSidebarCollapsed(true);
      setChatAreaCollapsed(true);
    } catch {
      // Firefox may deny fullscreen from certain keyboard events (e.g. F11)
      console.warn('[Presentation] Fullscreen request denied — browser policy');
    }
  }, [setChatAreaCollapsed, setSidebarCollapsed]);

  const syncPresentationContextInStore = useCallback(
    (input: {
      sharedSimulation: SharedSimulation | null;
      liveMeeting?: ClassroomLiveMeeting | null;
    }) => {
      useStageStore.setState((state) => {
        if (!state.stage) {
          return state;
        }

        const stageWithSharedSimulation = preserveStageSharedSimulation(
          state.stage,
          input.sharedSimulation,
        );
        const { liveMeeting: _previousLiveMeeting, ...stageWithoutLiveMeeting } =
          stageWithSharedSimulation;

        return {
          stage: input.liveMeeting
            ? {
                ...stageWithSharedSimulation,
                liveMeeting: input.liveMeeting,
              }
            : stageWithoutLiveMeeting,
        };
      });
    },
    [],
  );

  const syncPresentationState = useCallback(
    (nextState: ClassroomPresentationStatePayload | null) => {
      setPresentationState(nextState);
      syncPresentationContextInStore({
        sharedSimulation: nextState?.sharedSimulation ?? null,
        liveMeeting: nextState?.liveMeeting ?? null,
      });
    },
    [syncPresentationContextInStore],
  );

  const syncCollaborationState = useCallback(
    (nextState: ClassroomCollaborationStatePayload | null) => {
      setCollaborationState(nextState);
    },
    [],
  );

  const showPresentationFallback = useCallback((message: string) => {
    setPresentationFallbackMessage(message);
    if (presentationFallbackTimerRef.current) {
      clearTimeout(presentationFallbackTimerRef.current);
    }
    presentationFallbackTimerRef.current = setTimeout(() => {
      setPresentationFallbackMessage(null);
      presentationFallbackTimerRef.current = null;
    }, 6000);
  }, []);

  const { refreshPresentationState } = useClassroomPresentationState({
    classroomId: stage?.id,
    enabled: classroomSource === 'teacher-server',
    onStateChange: syncPresentationState,
  });
  const { refreshCollaborationState } = useClassroomCollaborationState({
    classroomId: stage?.id,
    enabled: Boolean(stage?.id && (presentationState?.sharedSimulation ?? stage?.sharedSimulation)),
    onStateChange: syncCollaborationState,
  });

  useEffect(() => {
    if (!stage?.id || classroomSource !== 'teacher-server') {
      setMiroFishAuthoringAvailable(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const json = (await response.json().catch(() => null)) as {
          success?: boolean;
          readiness?: {
            mirofish?: {
              authoringEnabled?: boolean;
              authoringReady?: boolean;
            };
          };
        } | null;

        if (cancelled) {
          return;
        }

        setMiroFishAuthoringAvailable(
          Boolean(
            response.ok &&
            json?.success &&
            json.readiness?.mirofish?.authoringEnabled &&
            json.readiness?.mirofish?.authoringReady,
          ),
        );
      } catch {
        if (!cancelled) {
          setMiroFishAuthoringAvailable(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classroomSource, stage?.id]);

  const patchPresentationState = useCallback(
    async (
      body: Partial<{ activeSurface: PresentationSurface; status: SharedSimulationStatus }>,
      { silent = false }: { silent?: boolean } = {},
    ) => {
      if (!stage?.id) {
        return;
      }

      const response = await fetch(`/api/classroom/${encodeURIComponent(stage.id)}/presentation`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success) {
        if (!silent) {
          throw new Error(errorMessage || 'Failed to update the shared presentation.');
        }
        return;
      }

      await refreshPresentationState(true);
    },
    [refreshPresentationState, stage?.id],
  );

  const handleAttachMiroFish = useCallback(
    async (input: {
      simulationId: string;
      reportId?: string;
      defaultSurface: 'lesson' | 'simulation';
      collaborationMode?: SharedSimulationCollaborationMode;
    }) => {
      if (!stage?.id) {
        return;
      }

      const response = await fetch(
        `/api/classroom/${encodeURIComponent(stage.id)}/mirofish/attach`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success) {
        throw new Error(errorMessage || 'Failed to attach the MiroFish sidecar.');
      }

      await refreshPresentationState(true);
      await refreshCollaborationState(true);
      setMiroFishSessionEmbed(null);
      setMiroFishManagerOpen(false);
      toast.success('MiroFish is now attached to this classroom.');
    },
    [refreshCollaborationState, refreshPresentationState, stage?.id],
  );

  const handleSetPresentationSurface = useCallback(
    async (surface: PresentationSurface) => {
      try {
        await patchPresentationState({ activeSurface: surface });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to update the shared presentation.',
        );
      }
    },
    [patchPresentationState],
  );

  const handleGenerateMiroFishPlan = useCallback(
    async (input: MiroFishCreationPlanRequest) => {
      if (!stage?.id) {
        throw new Error('Classroom is not ready');
      }

      const response = await fetch(
        `/api/classroom/${encodeURIComponent(stage.id)}/mirofish/create-plan`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        spec?: MiroFishCreationSpec;
        promptPreview?: string;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success || !json.spec || !json.promptPreview) {
        throw new Error(errorMessage || 'Failed to generate the MiroFish plan.');
      }

      return {
        spec: json.spec,
        promptPreview: json.promptPreview,
      };
    },
    [stage?.id],
  );

  const handleCreateMiroFish = useCallback(
    async (input: { spec: MiroFishCreationSpec }) => {
      if (!stage?.id) {
        throw new Error('Classroom is not ready');
      }

      const response = await fetch(
        `/api/classroom/${encodeURIComponent(stage.id)}/mirofish/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        jobId?: string;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success || !json.jobId) {
        throw new Error(errorMessage || 'Failed to start MiroFish creation.');
      }

      return {
        jobId: json.jobId,
      };
    },
    [stage?.id],
  );

  const handlePollMiroFishCreateJob = useCallback(
    async (jobId: string) => {
      if (!stage?.id) {
        throw new Error('Classroom is not ready');
      }

      const response = await fetch(
        `/api/classroom/${encodeURIComponent(stage.id)}/mirofish/create/${encodeURIComponent(jobId)}`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        status?: MiroFishCreationJobStatus;
        sharedSimulation?: SharedSimulation;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success || !json.status) {
        throw new Error(errorMessage || 'Failed to poll MiroFish creation.');
      }

      if (json.status === 'ready' && json.sharedSimulation) {
        await refreshPresentationState(true);
        await refreshCollaborationState(true);
        setMiroFishSessionEmbed(null);
      }

      return {
        status: json.status,
        error: errorMessage,
        sharedSimulation: json.sharedSimulation,
      };
    },
    [refreshCollaborationState, refreshPresentationState, stage?.id],
  );

  const handleGrantMiroFishControl = useCallback(
    async (targetSessionId: string, leaseMinutes: number) => {
      if (!stage?.id) {
        return;
      }

      const response = await fetch(`/api/classroom/${encodeURIComponent(stage.id)}/control`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'grant',
          targetSessionId,
          leaseMinutes,
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        sharedSimulation?: SharedSimulation;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success) {
        throw new Error(errorMessage || 'Failed to grant control.');
      }

      if (json.sharedSimulation) {
        syncPresentationState(
          presentationState
            ? mergePresentationStateSharedSimulation(presentationState, json.sharedSimulation)
            : null,
        );
      }

      await refreshPresentationState(true);
      toast.success('Student control granted.');
    },
    [presentationState, refreshPresentationState, stage?.id, syncPresentationState],
  );

  const handleRevokeMiroFishControl = useCallback(async () => {
    if (!stage?.id) {
      return;
    }

    const response = await fetch(`/api/classroom/${encodeURIComponent(stage.id)}/control`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'revoke',
      }),
    });
    const json = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: string;
      sharedSimulation?: SharedSimulation;
    } | null;
    const errorMessage = json && 'error' in json ? json.error : undefined;

    if (!response.ok || !json?.success) {
      throw new Error(errorMessage || 'Failed to return control to the teacher.');
    }

    if (json.sharedSimulation) {
      syncPresentationState(
        presentationState
          ? mergePresentationStateSharedSimulation(presentationState, json.sharedSimulation)
          : null,
      );
    }

    await refreshPresentationState(true);
    toast.success('Teacher control restored.');
  }, [presentationState, refreshPresentationState, stage?.id, syncPresentationState]);

  const handleMiroFishCollaborationAction = useCallback(
    async (input: { action: ClassroomCollaborationAction; targetSessionId?: string }) => {
      if (!stage?.id) {
        return;
      }

      const response = await fetch(`/api/classroom/${encodeURIComponent(stage.id)}/collaboration`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success) {
        throw new Error(errorMessage || 'Failed to update the MiroFish collaboration session.');
      }

      if (input.action === 'reset_session') {
        setMiroFishSessionEmbed(null);
      }

      await refreshCollaborationState(true);
      await refreshPresentationState(true);
      toast.success('Collaboration settings updated.');
    },
    [refreshCollaborationState, refreshPresentationState, stage?.id],
  );

  const requestMiroFishSessionEmbed = useCallback(
    async (forceNew = false) => {
      if (!stage?.id) {
        return null;
      }

      const response = await fetch(
        `/api/classroom/${encodeURIComponent(stage.id)}/mirofish/session`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ forceNew }),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        mirofishSessionId?: string;
        embedUrl?: string;
        tokenExpiresAt?: string | null;
        capabilities?: string[];
      } | null;
      const errorMessage = json && 'error' in json ? json.error : undefined;

      if (!response.ok || !json?.success || !json?.mirofishSessionId || !json?.embedUrl) {
        throw new Error(errorMessage || 'Failed to start the shared MiroFish session.');
      }

      const nextState = {
        simulationId:
          presentationState?.sharedSimulation?.simulationId ??
          stage?.sharedSimulation?.simulationId ??
          '',
        mirofishSessionId: json.mirofishSessionId,
        embedUrl: json.embedUrl,
        tokenExpiresAt: json.tokenExpiresAt ?? null,
        capabilities: json.capabilities ?? [],
      };
      setMiroFishSessionEmbed(nextState);
      return nextState;
    },
    [
      presentationState?.sharedSimulation?.simulationId,
      stage?.id,
      stage?.sharedSimulation?.simulationId,
    ],
  );

  const handleMiroFishEvent = useCallback(
    (event: MiroFishHostEvent) => {
      if (!presentationState || !presentationState.viewerCanControlPresentation) {
        if (event.type === 'presenceSummary' || event.type === 'sessionStatus') {
          void refreshCollaborationState(true);
        }
        return;
      }

      if (event.type === 'ready' && presentationState.activeSurface === 'simulation') {
        if (presentationState.simulationStatus !== 'running') {
          void patchPresentationState({ status: 'running' }, { silent: true });
        }
        return;
      }

      if (
        event.type === 'runStatus' &&
        event.status &&
        event.status !== 'error' &&
        event.status !== presentationState.simulationStatus
      ) {
        void patchPresentationState({ status: event.status }, { silent: true });
        return;
      }

      if (event.type === 'reportReady' && presentationState.simulationStatus !== 'completed') {
        void patchPresentationState({ status: 'completed' }, { silent: true });
        return;
      }

      if (event.type === 'presenceSummary' || event.type === 'sessionStatus') {
        void refreshCollaborationState(true);
      }
    },
    [patchPresentationState, presentationState, refreshCollaborationState],
  );

  const handleRecoverMiroFishToLesson = useCallback(
    async (message: string) => {
      showPresentationFallback(message);

      if (
        presentationState &&
        presentationState.viewerCanControlPresentation &&
        presentationState.activeSurface !== 'lesson'
      ) {
        await patchPresentationState(
          {
            activeSurface: 'lesson',
            status: 'error',
          },
          { silent: true },
        );
      }
    },
    [patchPresentationState, presentationState, showPresentationFallback],
  );

  useEffect(() => {
    return () => {
      if (presentationFallbackTimerRef.current) {
        clearTimeout(presentationFallbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPresentationFallbackMessage(null);
    setPresentationState(
      getInitialPresentationState(useStageStore.getState().stage?.sharedSimulation),
    );
    setCollaborationState(
      getInitialCollaborationState(useStageStore.getState().stage?.sharedSimulation),
    );
    setMiroFishSessionEmbed(null);
    setCockpitOpen(false);
    setDismissedApprovalIds([]);
    setLivePromptsLocked(false);
  }, [stage?.id]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === stageRef.current;
      setIsPresenting(active);

      if (!active) {
        // Ensure keyboard unlock on any fullscreen exit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
        setControlsVisible(true);
        clearPresentationIdleTimer();
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [clearPresentationIdleTimer]);

  useEffect(() => {
    if (!isPresenting) {
      setControlsVisible(true);
      clearPresentationIdleTimer();
      return;
    }

    const handleActivity = () => {
      resetPresentationIdleTimer();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    if (isPresentationInteractionActive) {
      setControlsVisible(true);
      clearPresentationIdleTimer();
    } else {
      resetPresentationIdleTimer();
    }

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      clearPresentationIdleTimer();
    };
  }, [
    clearPresentationIdleTimer,
    isPresenting,
    isPresentationInteractionActive,
    resetPresentationIdleTimer,
  ]);

  // Initialize playback engine when scene changes
  useEffect(() => {
    // Bump epoch so any stale SSE callbacks from the previous scene are discarded
    sceneEpochRef.current++;

    // End any active QA/discussion session — this synchronously aborts the SSE
    // stream inside use-chat-sessions (abortControllerRef.abort()), preventing
    // stale onLiveSpeech callbacks from leaking into the new scene.
    chatAreaRef.current?.endActiveSession();

    // Also abort the engine-level discussion controller
    if (discussionAbortRef.current) {
      discussionAbortRef.current.abort();
      discussionAbortRef.current = null;
    }

    // Stop any in-flight discussion TTS audio on scene switch
    discussionTTS.cleanup();

    // Reset all roundtable/live state so scenes are fully isolated
    resetSceneState();

    if (!currentScene || !currentScene.actions || currentScene.actions.length === 0) {
      engineRef.current = null;
      setEngineMode('idle');

      return;
    }

    // Stop previous engine
    if (engineRef.current) {
      engineRef.current.stop();
    }

    // Create ActionEngine for playback (with audioPlayer for TTS)
    const widgetSendMessage = (type: string, payload: Record<string, unknown>) => {
      useWidgetIframeStore.getState().getSendMessage(currentScene.id)?.(type, payload);
    };
    const actionEngine = new ActionEngine(useStageStore, audioPlayerRef.current, widgetSendMessage);

    // Create new PlaybackEngine
    const engine = new PlaybackEngine([currentScene], actionEngine, audioPlayerRef.current, {
      onModeChange: (mode) => {
        setEngineMode(mode);
      },
      onSceneChange: (_sceneId) => {
        // Scene change handled by engine
      },
      onSpeechStart: (text) => {
        setLectureSpeech(text);
        // Add to lecture session with incrementing index for dedup
        // Chat area pacing is handled by the StreamBuffer (onTextReveal)
        if (lectureSessionIdRef.current) {
          const idx = lectureActionCounterRef.current++;
          const speechId = `speech-${Date.now()}`;
          chatAreaRef.current?.addLectureMessage(
            lectureSessionIdRef.current,
            { id: speechId, type: 'speech', text } as Action,
            idx,
          );
          // Track active bubble for highlight (Issue 8)
          const msgId = chatAreaRef.current?.getLectureMessageId(lectureSessionIdRef.current!);
          if (msgId) setActiveBubbleId(msgId);
        }
      },
      onSpeechEnd: () => {
        // Don't clear lectureSpeech — let it persist until the next
        // onSpeechStart replaces it or the scene transitions.
        // Clearing here causes fallback to idleText (first sentence).
        setActiveBubbleId(null);
      },
      onEffectFire: (effect: Effect) => {
        // Add to lecture session with incrementing index
        if (
          lectureSessionIdRef.current &&
          (effect.kind === 'spotlight' || effect.kind === 'laser')
        ) {
          const idx = lectureActionCounterRef.current++;
          chatAreaRef.current?.addLectureMessage(
            lectureSessionIdRef.current,
            {
              id: `${effect.kind}-${Date.now()}`,
              type: effect.kind,
              elementId: effect.targetId,
            } as Action,
            idx,
          );
        }
      },
      onProactiveShow: (trigger) => {
        if (!trigger.agentId) {
          // Mutate in-place so engine.currentTrigger also gets the agentId
          // (confirmDiscussion reads agentId from the same object reference)
          trigger.agentId = pickStudentAgent();
        }
        setDiscussionTrigger(trigger);
      },
      onProactiveHide: () => {
        setDiscussionTrigger(null);
      },
      onDiscussionConfirmed: (topic, prompt, agentId) => {
        // Start SSE discussion via ChatArea
        handleDiscussionSSE(topic, prompt, agentId);
      },
      onDiscussionEnd: () => {
        // Abort any active SSE
        if (discussionAbortRef.current) {
          discussionAbortRef.current.abort();
          discussionAbortRef.current = null;
        }
        setDiscussionTrigger(null);
        // Stop any in-flight discussion TTS audio
        discussionTTS.cleanup();
        // Clear roundtable state (idempotent — may already be cleared by doSessionCleanup)
        resetLiveState();
        // Only show flash for engine-initiated ends (not manual stop — that's handled by doSessionCleanup)
        if (!manualStopRef.current) {
          setEndFlashSessionType('discussion');
          setShowEndFlash(true);
          setTimeout(() => setShowEndFlash(false), 1800);
        }
        // If all actions are exhausted (discussion was the last action), mark
        // playback as completed so the bubble shows reset instead of play.
        if (engineRef.current?.isExhausted()) {
          setPlaybackCompleted(true);
        }
      },
      onUserInterrupt: (text) => {
        // User interrupted → start a discussion via chat
        chatAreaRef.current?.sendMessage(text);
      },
      isAgentSelected: (agentId) => {
        const ids = useSettingsStore.getState().selectedAgentIds;
        return ids.includes(agentId);
      },
      getPlaybackSpeed: () => useSettingsStore.getState().playbackSpeed || 1,
      onComplete: () => {
        // lectureSpeech intentionally NOT cleared — last sentence stays visible
        // until scene transition (auto-play) or user restarts. Scene change
        // effect handles the reset.
        setPlaybackCompleted(true);
        if (currentScene?.id) {
          onSceneCompleted?.(currentScene.id);
        }

        // End lecture session on playback complete
        if (lectureSessionIdRef.current) {
          chatAreaRef.current?.endSession(lectureSessionIdRef.current);
          lectureSessionIdRef.current = null;
        }
        // Auto-play: advance to next scene after a short pause
        const { autoPlayLecture } = useSettingsStore.getState();
        if (autoPlayLecture) {
          setTimeout(() => {
            const stageState = useStageStore.getState();
            if (!useSettingsStore.getState().autoPlayLecture) return;
            const allScenes = stageState.scenes;
            const curId = stageState.currentSceneId;
            const idx = allScenes.findIndex((s) => s.id === curId);
            if (idx >= 0 && idx < allScenes.length - 1) {
              const currentScene = allScenes[idx];
              if (
                currentScene.type === 'quiz' ||
                currentScene.type === 'interactive' ||
                currentScene.type === 'pbl'
              ) {
                return;
              }
              autoStartRef.current = true;
              onSceneSelected?.({
                fromSceneId: curId,
                toSceneId: allScenes[idx + 1].id,
                reason: 'auto',
              });
              stageState.setCurrentSceneId(allScenes[idx + 1].id);
            } else if (idx === allScenes.length - 1 && stageState.generatingOutlines.length > 0) {
              // Last scene exhausted but next is still generating — go to pending page
              const currentScene = allScenes[idx];
              if (
                currentScene.type === 'quiz' ||
                currentScene.type === 'interactive' ||
                currentScene.type === 'pbl'
              ) {
                return;
              }
              autoStartRef.current = true;
              onSceneSelected?.({
                fromSceneId: curId,
                toSceneId: PENDING_SCENE_ID,
                reason: 'pending',
              });
              stageState.setCurrentSceneId(PENDING_SCENE_ID);
            }
          }, 1500);
        }
      },
    });

    engineRef.current = engine;

    // Auto-start if triggered by auto-play scene advance
    if (autoStartRef.current) {
      autoStartRef.current = false;
      (async () => {
        if (currentScene && chatAreaRef.current) {
          const sessionId = await chatAreaRef.current.startLecture(currentScene.id);
          lectureSessionIdRef.current = sessionId;
          lectureActionCounterRef.current = 0;
        }
        engine.start();
      })();
    } else {
      // Load saved playback state and restore position (but never auto-play).
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when scene changes, functions are stable refs
  }, [currentScene]);

  // Cleanup on unmount
  useEffect(() => {
    const audioPlayer = audioPlayerRef.current;
    const chatArea = chatAreaRef.current;
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
      }
      audioPlayer.destroy();
      if (discussionAbortRef.current) {
        discussionAbortRef.current.abort();
      }
      discussionTTS.cleanup();
      chatArea?.endActiveSession();
      clearPresentationIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup, clearPresentationIdleTimer is stable
  }, []);

  // Sync mute state from settings store to audioPlayer
  useEffect(() => {
    audioPlayerRef.current.setMuted(ttsMuted);
  }, [ttsMuted]);

  // Sync volume from settings store to audioPlayer
  const ttsVolume = useSettingsStore((s) => s.ttsVolume);
  useEffect(() => {
    if (!ttsMuted) {
      audioPlayerRef.current.setVolume(ttsVolume);
    }
  }, [ttsVolume, ttsMuted]);

  // Sync playback speed to audio player (for live-updating current audio)
  const playbackSpeed = useSettingsStore((s) => s.playbackSpeed);
  useEffect(() => {
    audioPlayerRef.current.setPlaybackRate(playbackSpeed);
  }, [playbackSpeed]);

  /**
   * Handle discussion SSE — POST /api/chat and push events to engine
   */
  const handleDiscussionSSE = useCallback(
    async (topic: string, prompt?: string, agentId?: string) => {
      // Start discussion display in ChatArea (lecture speech is preserved independently)
      chatAreaRef.current?.startDiscussion({
        topic,
        prompt,
        agentId: agentId || 'default-1',
      });
      // Auto-switch to chat tab when discussion starts
      chatAreaRef.current?.switchToTab('chat');
      // Immediately mark streaming for synchronized stop button
      setChatIsStreaming(true);
      setChatSessionType('discussion');
      // Optimistic thinking: show thinking dots immediately (same as onMessageSend)
      setThinkingState({ stage: 'director' });
    },
    [],
  );

  // First speech text for idle display (extracted here for playbackView)
  const firstSpeechText = useMemo(
    () => currentScene?.actions?.find((a): a is SpeechAction => a.type === 'speech')?.text ?? null,
    [currentScene],
  );

  // Whether the speaking agent is a student (for bubble role derivation)
  const speakingStudentFlag = useMemo(() => {
    if (!speakingAgentId) return false;
    const agent = useAgentRegistry.getState().getAgent(speakingAgentId);
    return agent?.role !== 'teacher';
  }, [speakingAgentId]);

  // Centralised derived playback view
  const playbackView = useMemo(
    () =>
      computePlaybackView({
        engineMode,
        lectureSpeech,
        liveSpeech,
        speakingAgentId,
        thinkingState,
        isCueUser,
        isTopicPending,
        chatIsStreaming,
        discussionTrigger,
        playbackCompleted,
        idleText: firstSpeechText,
        speakingStudent: speakingStudentFlag,
        sessionType: chatSessionType,
      }),
    [
      engineMode,
      lectureSpeech,
      liveSpeech,
      speakingAgentId,
      thinkingState,
      isCueUser,
      isTopicPending,
      chatIsStreaming,
      discussionTrigger,
      playbackCompleted,
      firstSpeechText,
      speakingStudentFlag,
      chatSessionType,
    ],
  );

  const isTopicActive = playbackView.isTopicActive;
  const commitSceneSelection = useCallback(
    (targetSceneId: string, reason: 'manual' | 'auto' | 'pending') => {
      onSceneSelected?.({
        fromSceneId: currentSceneId,
        toSceneId: targetSceneId,
        reason,
      });
      setCurrentSceneId(targetSceneId);
    },
    [currentSceneId, onSceneSelected, setCurrentSceneId],
  );

  /**
   * Gated scene switch — if a topic is active, show AlertDialog before switching.
   * Returns true if the switch was immediate, false if gated (dialog shown).
   */
  const gatedSceneSwitch = useCallback(
    (targetSceneId: string): boolean => {
      if (targetSceneId === currentSceneId) return false;
      if (isTopicActive) {
        setPendingSceneId(targetSceneId);
        return false;
      }
      commitSceneSelection(targetSceneId, 'manual');
      return true;
    },
    [commitSceneSelection, currentSceneId, isTopicActive],
  );

  /** User confirmed scene switch via AlertDialog */
  const confirmSceneSwitch = useCallback(() => {
    if (!pendingSceneId) return;
    chatAreaRef.current?.endActiveSession();
    doSessionCleanup();
    commitSceneSelection(pendingSceneId, 'manual');
    setPendingSceneId(null);
  }, [commitSceneSelection, pendingSceneId, doSessionCleanup]);

  /** User cancelled scene switch via AlertDialog */
  const cancelSceneSwitch = useCallback(() => {
    setPendingSceneId(null);
  }, []);

  // play/pause toggle
  const handlePlayPause = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const mode = engine.getMode();
    if (mode === 'playing' || mode === 'live') {
      engine.pause();
      // Pause lecture buffer so text stops immediately
      if (lectureSessionIdRef.current) {
        chatAreaRef.current?.pauseBuffer(lectureSessionIdRef.current);
      }
    } else if (mode === 'paused') {
      engine.resume();
      // Resume lecture buffer
      if (lectureSessionIdRef.current) {
        chatAreaRef.current?.resumeBuffer(lectureSessionIdRef.current);
      }
    } else {
      const wasCompleted = playbackCompleted;
      setPlaybackCompleted(false);
      // Starting playback - create/reuse lecture session
      if (currentScene && chatAreaRef.current) {
        const sessionId = await chatAreaRef.current.startLecture(currentScene.id);
        lectureSessionIdRef.current = sessionId;
      }
      if (wasCompleted) {
        // Restart from beginning (user clicked restart after completion)
        lectureActionCounterRef.current = 0;
        engine.start();
      } else {
        // Continue from current position (e.g. after discussion end)
        engine.continuePlayback();
      }
    }
  }, [playbackCompleted, currentScene]);

  // get scene information
  const isPendingScene = currentSceneId === PENDING_SCENE_ID;
  const hasNextPending = generatingOutlines.length > 0;
  const isCourseComplete = scenes.length > 0 && generatingOutlines.length === 0;

  // previous scene (gated)
  const handlePreviousScene = useCallback(() => {
    if (isPendingScene) {
      // From pending page → go to last real scene
      if (scenes.length > 0) {
        gatedSceneSwitch(scenes[scenes.length - 1].id);
      }
      return;
    }
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (currentIndex > 0) {
      gatedSceneSwitch(scenes[currentIndex - 1].id);
    }
  }, [currentSceneId, gatedSceneSwitch, isPendingScene, scenes]);

  // next scene (gated)
  const handleNextScene = useCallback(() => {
    if (isPendingScene) return; // Already on pending, nowhere to go
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (currentIndex < scenes.length - 1) {
      gatedSceneSwitch(scenes[currentIndex + 1].id);
    } else if (hasNextPending || isCourseComplete) {
      // On last real scene -> advance to pending/completion page
      commitSceneSelection(PENDING_SCENE_ID, 'pending');
    }
  }, [
    commitSceneSelection,
    currentSceneId,
    gatedSceneSwitch,
    hasNextPending,
    isCourseComplete,
    isPendingScene,
    scenes,
  ]);

  const currentSceneIndex = isPendingScene
    ? scenes.length
    : scenes.findIndex((s) => s.id === currentSceneId);
  const totalScenesCount = scenes.length + (hasNextPending || isCourseComplete ? 1 : 0);
  const lessonState = useMemo(
    () =>
      buildClassroomLessonState({
        stage,
        scenes,
        currentSceneId,
        selectedModelFallback,
      }),
    [currentSceneId, scenes, selectedModelFallback, stage],
  );

  // get action information
  const totalActions = currentScene?.actions?.length || 0;

  // whiteboard toggle
  const handleWhiteboardToggle = useCallback(() => {
    setWhiteboardOpen(!whiteboardOpen);
  }, [setWhiteboardOpen, whiteboardOpen]);

  const runTeacherPrompt = useCallback(
    async (message: string, { bypassPromptLock = false }: { bypassPromptLock?: boolean } = {}) => {
      const nextMessage = message.trim();
      if (!nextMessage) {
        return true;
      }

      if (livePromptsLocked && !bypassPromptLock) {
        toast.error('Live prompts are currently frozen by the teacher cockpit.');
        return true;
      }

      setIsDiscussionPaused(false);
      chatAreaRef.current?.resumeActiveLiveBuffer();
      discussionTTS.cleanup();

      if (isTopicPending) {
        setIsTopicPending(false);
        setLiveSpeech(null);
        setSpeakingAgentId(null);
      }

      if (
        engineRef.current &&
        (engineMode === 'playing' || engineMode === 'live' || engineMode === 'paused')
      ) {
        engineRef.current.handleUserInterrupt(nextMessage);
      } else {
        await chatAreaRef.current?.sendMessage(nextMessage);
      }

      chatAreaRef.current?.switchToTab('chat');
      setIsCueUser(false);
      setChatIsStreaming(true);
      setChatSessionType(chatSessionType || 'qa');
      setThinkingState({ stage: 'director' });
      return true;
    },
    [chatSessionType, discussionTTS, engineMode, isTopicPending, livePromptsLocked],
  );

  const isPresentationShortcutTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;

    if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
      return true;
    }

    return (
      target.closest(
        ['input', 'textarea', 'select', '[role="slider"]', 'input[type="range"]'].join(', '),
      ) !== null
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Let modifier-key combos (Ctrl+C, Ctrl+S, etc.) pass through to the browser
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        isPresentationShortcutTarget(event.target) ||
        isPresentationShortcutTarget(document.activeElement)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          if (!isPresenting) return;
          event.preventDefault();
          handlePreviousScene();
          resetPresentationIdleTimer();
          break;
        case 'ArrowRight':
          if (!isPresenting) return;
          event.preventDefault();
          handleNextScene();
          resetPresentationIdleTimer();
          break;
        case ' ':
        case 'Spacebar':
          // During active QA/discussion, Roundtable owns Space for
          // buffer-level pause/resume — don't also fire engine play/pause.
          if (chatSessionType === 'qa' || chatSessionType === 'discussion') break;
          event.preventDefault();
          handlePlayPause();
          break;
        case 'Escape':
          // With keyboard.lock(), Escape no longer auto-exits fullscreen.
          // If panels are open, roundtable handles Escape (close panels).
          // If no panels are open, manually exit fullscreen.
          if (isPresenting && !isPresentationInteractionActive) {
            event.preventDefault();
            togglePresentation();
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          setTTSVolume(ttsVolume + 0.1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setTTSVolume(ttsVolume - 0.1);
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          setTTSMuted(!ttsMuted);
          break;
        case 's':
        case 'S':
          event.preventDefault();
          setSidebarCollapsed(!sidebarCollapsed);
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          setChatAreaCollapsed(!chatAreaCollapsed);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    chatSessionType,
    chatAreaCollapsed,
    handleNextScene,
    handlePlayPause,
    handlePreviousScene,
    isPresenting,
    isPresentationInteractionActive,
    isPresentationShortcutTarget,
    resetPresentationIdleTimer,
    setChatAreaCollapsed,
    setSidebarCollapsed,
    setTTSMuted,
    setTTSVolume,
    sidebarCollapsed,
    togglePresentation,
    ttsMuted,
    ttsVolume,
  ]);

  // Intercept F11 to use our presentation fullscreen instead of browser fullscreen
  // This way ESC can exit fullscreen (browser F11 fullscreen requires F11 to exit)
  useEffect(() => {
    const onF11 = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        togglePresentation();
      }
    };

    window.addEventListener('keydown', onF11);
    return () => window.removeEventListener('keydown', onF11);
  }, [togglePresentation]);

  const sharedSimulation = presentationState?.sharedSimulation ?? stage?.sharedSimulation ?? null;
  const liveMeeting = presentationState?.liveMeeting ?? stage?.liveMeeting ?? null;
  const collaborationMode =
    collaborationState?.collaborationMode ?? getSharedSimulationCollaborationMode(sharedSimulation);
  const isMultiUserSimulation = collaborationMode === 'multi-user';
  const activePresentationSurface =
    presentationState?.activeSurface ?? sharedSimulation?.activeSurface ?? 'lesson';
  const miroFishRunUrl =
    isMultiUserSimulation && activePresentationSurface === 'simulation'
      ? (miroFishSessionEmbed?.embedUrl ??
        presentationState?.runUrl ??
        sharedSimulation?.runUrl ??
        null)
      : (presentationState?.runUrl ?? sharedSimulation?.runUrl ?? null);
  const miroFishReportUrl = presentationState?.reportUrl ?? sharedSimulation?.reportUrl ?? null;
  const reportAvailable =
    presentationState?.reportAvailable ?? hasSharedSimulationReport(sharedSimulation);
  const viewerCanManageSimulation = presentationState?.viewerCanManageSimulation ?? false;
  const canManageMiroFish =
    viewerCanManageSimulation ||
    (classroomSource === 'teacher-server' && miroFishAuthoringAvailable);
  const openMiroFishManager =
    classroomSource === 'teacher-server' || canManageMiroFish
      ? () => {
          if (!canManageMiroFish) {
            toast.info(t('classroom.mirofish.setupNeeded'));
            return;
          }

          setMiroFishManagerOpen(true);
        }
      : undefined;
  const viewerCanControlPresentation = presentationState?.viewerCanControlPresentation ?? false;
  const viewerHasSimulationControl = presentationState?.viewerHasSimulationControl ?? false;
  const presentationParticipants = useMemo(
    () => presentationState?.participants ?? [],
    [presentationState?.participants],
  );
  const viewerCanInteractWithSimulation = isMultiUserSimulation
    ? (collaborationState?.viewerCanInteract ?? viewerCanManageSimulation)
    : viewerHasSimulationControl;
  const spotlightDisplayName =
    collaborationState?.participants.find(
      (participant) => participant.sessionId === collaborationState.spotlightSessionId,
    )?.displayName ?? null;
  const controllerDisplayName = getControllerDisplayName(
    sharedSimulation,
    presentationParticipants,
  );
  useEffect(() => {
    if (
      !stage?.id ||
      !sharedSimulation ||
      !isMultiUserSimulation ||
      activePresentationSurface !== 'simulation'
    ) {
      return;
    }

    const desiredSessionId =
      collaborationState?.mirofishSessionId ?? sharedSimulation.mirofishSessionId ?? null;
    const currentSimulationId =
      presentationState?.sharedSimulation?.simulationId ??
      stage?.sharedSimulation?.simulationId ??
      null;
    if (
      miroFishSessionEmbed &&
      miroFishSessionEmbed.simulationId === currentSimulationId &&
      miroFishSessionEmbed.mirofishSessionId === desiredSessionId
    ) {
      return;
    }

    void requestMiroFishSessionEmbed(false).catch((error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to start the shared MiroFish session.',
      );
    });
  }, [
    activePresentationSurface,
    collaborationState?.mirofishSessionId,
    isMultiUserSimulation,
    miroFishSessionEmbed,
    presentationState?.sharedSimulation?.simulationId,
    requestMiroFishSessionEmbed,
    sharedSimulation,
    stage?.id,
    stage?.sharedSimulation?.simulationId,
  ]);
  const isTeacherCockpitViewer = canShowLiveClassroomCockpit(presentationState);
  const studentPulse = useMemo(
    () => buildLiveClassroomStudentPulse(presentationParticipants),
    [presentationParticipants],
  );
  const previousScene =
    !isPendingScene && currentSceneIndex > 0 ? scenes[currentSceneIndex - 1] : null;
  const nextScene =
    !isPendingScene && currentSceneIndex >= 0 && currentSceneIndex < scenes.length - 1
      ? scenes[currentSceneIndex + 1]
      : null;
  const activeSurfaceLabel = getLiveClassroomSurfaceLabel(
    activePresentationSurface,
    whiteboardOpen,
  );
  const approvalSuggestions = useMemo(
    () =>
      buildLiveClassroomApprovalItems({
        currentSceneId,
        currentSceneTitle: currentScene?.title,
        activeSurface: activePresentationSurface,
        whiteboardOpen,
        reportAvailable,
        playbackCompleted,
        hasNextScene: Boolean(nextScene || hasNextPending),
        hasSharedSimulation: Boolean(sharedSimulation),
      }),
    [
      activePresentationSurface,
      currentScene?.title,
      currentSceneId,
      hasNextPending,
      nextScene,
      playbackCompleted,
      reportAvailable,
      sharedSimulation,
      whiteboardOpen,
    ],
  );
  const visibleApprovalItems = approvalSuggestions.filter(
    (item) => !dismissedApprovalIds.includes(item.id),
  );
  const showTeacherCockpit =
    isTeacherCockpitViewer && (!isPresenting || controlsVisible || cockpitOpen);

  useEffect(() => {
    const suggestionIds = new Set(approvalSuggestions.map((item) => item.id));
    setDismissedApprovalIds((current) => {
      const next = current.filter((itemId) => suggestionIds.has(itemId));
      return next.length === current.length ? current : next;
    });
  }, [approvalSuggestions]);

  useEffect(() => {
    if (!isTeacherCockpitViewer) {
      previousApprovalCountRef.current = 0;
      setCockpitOpen(false);
      setDismissedApprovalIds([]);
      setLivePromptsLocked(false);
      return;
    }

    if (visibleApprovalItems.length > previousApprovalCountRef.current) {
      setCockpitOpen(true);
    }

    previousApprovalCountRef.current = visibleApprovalItems.length;
  }, [isTeacherCockpitViewer, visibleApprovalItems.length]);

  const dismissCockpitApproval = useCallback((approvalId: string) => {
    setDismissedApprovalIds((current) =>
      current.includes(approvalId) ? current : [...current, approvalId],
    );
  }, []);

  const handleApproveCockpitApproval = useCallback(
    async (item: (typeof approvalSuggestions)[number]) => {
      switch (item.action.kind) {
        case 'set-surface':
          await handleSetPresentationSurface(item.action.surface);
          break;
        case 'toggle-whiteboard':
          if (whiteboardOpen !== item.action.open) {
            handleWhiteboardToggle();
          }
          break;
        case 'next-scene':
          handleNextScene();
          break;
        case 'replay-scene':
          if (playbackCompleted) {
            await handlePlayPause();
          }
          break;
        case 'teacher-prompt':
          await runTeacherPrompt(item.action.prompt, { bypassPromptLock: true });
          break;
      }

      dismissCockpitApproval(item.id);
    },
    [
      dismissCockpitApproval,
      handleNextScene,
      handlePlayPause,
      handleSetPresentationSurface,
      handleWhiteboardToggle,
      playbackCompleted,
      runTeacherPrompt,
      whiteboardOpen,
    ],
  );

  const handleEditCockpitApproval = useCallback(
    async (item: (typeof approvalSuggestions)[number], prompt: string) => {
      if (item.action.kind === 'teacher-prompt') {
        const sent = await runTeacherPrompt(prompt, { bypassPromptLock: true });
        if (sent) {
          dismissCockpitApproval(item.id);
        }
        return;
      }

      dismissCockpitApproval(item.id);
    },
    [dismissCockpitApproval, runTeacherPrompt],
  );

  // Map engine mode to the CanvasArea's expected engine state
  const canvasEngineState = (() => {
    switch (engineMode) {
      case 'playing':
      case 'live':
        return 'playing';
      case 'paused':
        return 'paused';
      default:
        return 'idle';
    }
  })();

  // Build discussion request for Roundtable ProactiveCard from trigger
  const discussionRequest: DiscussionAction | null = discussionTrigger
    ? {
        type: 'discussion',
        id: discussionTrigger.id,
        topic: discussionTrigger.question,
        prompt: discussionTrigger.prompt,
        agentId: discussionTrigger.agentId || 'default-1',
      }
    : null;

  // Calculate scene viewer height (subtract Header's 80px height)
  const sceneViewerHeight = (() => {
    const headerHeight = isPresenting ? 0 : 80; // Header h-20 = 80px
    const lessonGuideHeight = isPresenting ? 0 : 194;
    const roundtableHeight = mode === 'playback' && !isPresenting ? 192 : 0;
    return `calc(100% - ${headerHeight + lessonGuideHeight + roundtableHeight}px)`;
  })();

  return (
    <div
      ref={stageRef}
      className={cn(
        'flex h-full min-h-0 flex-1 overflow-hidden overscroll-none bg-gray-50 dark:bg-gray-900',
        isPresenting && !controlsVisible && 'cursor-none',
      )}
    >
      {/* Scene Sidebar */}
      <SceneSidebar
        collapsed={sidebarCollapsed}
        onCollapseChange={setSidebarCollapsed}
        onSceneSelect={gatedSceneSwitch}
        onRetryOutline={onRetryOutline}
        homePath={homePath}
      />

      {/* Main Content Area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        {!isPresenting && (
          <Header
            currentSceneTitle={currentScene?.title || ''}
            classroomSource={classroomSource}
            homePath={homePath}
            onOpenMiroFishManager={openMiroFishManager}
            onOpenClassroomShare={onOpenClassroomShare}
            liveMeeting={liveMeeting}
          />
        )}

        {!isPresenting ? (
          <>
            <LessonFlowPanel
              lessonState={lessonState}
              currentSceneTitle={currentScene?.title}
              currentSceneNumber={Math.max(currentSceneIndex + 1, 1)}
              totalScenesCount={totalScenesCount}
            />
            <BoardNotesPanel lessonState={lessonState} currentScene={currentScene} />
          </>
        ) : null}

        {!isPresenting && classroomNotice ? (
          <div className="px-6 pb-2">
            <Alert className="border-blue-200/70 bg-white/80 dark:border-blue-900/50 dark:bg-slate-950/80">
              <AlertTriangle className="size-4 text-blue-500 dark:text-blue-300" />
              <AlertTitle>{t('classroom.localDemoBadge')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{classroomNotice}</span>
                {onMakeShareable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={onMakeShareable}
                    disabled={makeShareablePending}
                  >
                    {makeShareablePending
                      ? t('classroom.share.publishing')
                      : t('classroom.share.makeShareable')}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        {/* Canvas Area */}
        <div
          className="overflow-hidden relative flex-1 min-h-0 isolate"
          style={{
            height: sceneViewerHeight,
          }}
          suppressHydrationWarning
        >
          {showTeacherCockpit ? (
            <div
              onMouseEnter={() => setIsPresentationInteractionActive(true)}
              onMouseLeave={() => setIsPresentationInteractionActive(false)}
            >
              <LiveClassroomCockpit
                open={cockpitOpen}
                onOpenChange={setCockpitOpen}
                currentSceneTitle={currentScene?.title || ''}
                currentSceneNumber={Math.max(currentSceneIndex + 1, 1)}
                totalScenesCount={totalScenesCount}
                previousScene={
                  previousScene
                    ? {
                        id: previousScene.id,
                        title: previousScene.title,
                      }
                    : null
                }
                nextScene={
                  nextScene
                    ? {
                        id: nextScene.id,
                        title: nextScene.title,
                      }
                    : null
                }
                activeSurfaceLabel={activeSurfaceLabel}
                activeSurface={activePresentationSurface}
                simulationAvailable={Boolean(sharedSimulation)}
                whiteboardOpen={whiteboardOpen}
                studentCount={studentPulse.studentCount}
                handRaiseCount={0}
                helpCount={0}
                pendingApprovalCount={visibleApprovalItems.length}
                approvalItems={visibleApprovalItems}
                participants={presentationParticipants}
                controllerDisplayName={controllerDisplayName}
                viewerCanControlPresentation={viewerCanControlPresentation}
                viewerCanManageSimulation={canManageMiroFish}
                classPaused={engineMode !== 'playing' && engineMode !== 'live'}
                ttsMuted={ttsMuted}
                autoPlayEnabled={autoPlayLecture}
                promptsLocked={livePromptsLocked}
                reportAvailable={reportAvailable}
                liveMeeting={liveMeeting}
                onTogglePause={() => {
                  void handlePlayPause();
                }}
                onPreviousScene={handlePreviousScene}
                onNextScene={handleNextScene}
                onReplayScene={playbackCompleted ? () => void handlePlayPause() : undefined}
                onSelectScene={gatedSceneSwitch}
                onSetPresentationSurface={handleSetPresentationSurface}
                onToggleWhiteboard={handleWhiteboardToggle}
                onOpenAdvancedControls={() => setMiroFishManagerOpen(true)}
                onTogglePromptsLock={() => setLivePromptsLocked((current) => !current)}
                onToggleNarrationMute={() => setTTSMuted(!ttsMuted)}
                onToggleAutoPlay={() => setAutoPlayLecture(!autoPlayLecture)}
                onRecoverToLesson={() => {
                  void handleRecoverMiroFishToLesson('Teacher cockpit requested lesson recovery.');
                }}
                onApproveApproval={(item) => {
                  void handleApproveCockpitApproval(item);
                }}
                onRejectApproval={dismissCockpitApproval}
                onEditApproval={(item, prompt) => {
                  void handleEditCockpitApproval(item, prompt);
                }}
                onSendTeacherPrompt={(prompt) => {
                  void runTeacherPrompt(prompt, { bypassPromptLock: true });
                }}
              />
            </div>
          ) : null}
          <CanvasArea
            currentScene={currentScene}
            currentSceneIndex={currentSceneIndex}
            scenesCount={totalScenesCount}
            mode={mode}
            engineState={canvasEngineState}
            isLiveSession={
              chatIsStreaming || isTopicPending || engineMode === 'live' || !!chatSessionType
            }
            whiteboardOpen={whiteboardOpen}
            sidebarCollapsed={sidebarCollapsed}
            chatCollapsed={chatAreaCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onToggleChat={() => setChatAreaCollapsed(!chatAreaCollapsed)}
            onPrevSlide={handlePreviousScene}
            onNextSlide={handleNextScene}
            onPlayPause={handlePlayPause}
            onWhiteboardClose={handleWhiteboardToggle}
            isPresenting={isPresenting}
            onTogglePresentation={togglePresentation}
            showStopDiscussion={
              engineMode === 'live' ||
              (chatIsStreaming && (chatSessionType === 'qa' || chatSessionType === 'discussion'))
            }
            onStopDiscussion={handleStopDiscussion}
            sharedSimulation={sharedSimulation}
            activeSurface={activePresentationSurface}
            reportAvailable={reportAvailable}
            viewerCanManageSimulation={canManageMiroFish}
            viewerCanControlPresentation={viewerCanControlPresentation}
            onSetPresentationSurface={handleSetPresentationSurface}
            onOpenMiroFishManager={openMiroFishManager}
            runUrl={miroFishRunUrl}
            reportUrl={miroFishReportUrl}
            viewerHasSimulationControl={viewerHasSimulationControl}
            collaboration={collaborationState}
            viewerCanInteractWithSimulation={viewerCanInteractWithSimulation}
            viewerInteractionReason={collaborationState?.viewerInteractionReason ?? null}
            spotlightDisplayName={spotlightDisplayName}
            controllerDisplayName={controllerDisplayName}
            controlLeaseExpiresAt={sharedSimulation?.controlLeaseExpiresAt ?? null}
            presentationFallbackMessage={presentationFallbackMessage}
            onMiroFishEvent={handleMiroFishEvent}
            onReclaimMiroFishControl={() => {
              void handleRevokeMiroFishControl().catch((error) => {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : 'Failed to return control to the teacher.',
                );
              });
            }}
            onRecoverToLesson={(message) => {
              void handleRecoverMiroFishToLesson(message).catch((error) => {
                toast.error(
                  error instanceof Error ? error.message : 'Failed to return to the lesson view.',
                );
              });
            }}
            hideToolbar={mode === 'playback' || (isPresenting && !controlsVisible)}
            isPendingScene={isPendingScene}
            isCourseComplete={isCourseComplete}
            isGenerationFailed={
              isPendingScene && failedOutlines.some((f) => f.id === generatingOutlines[0]?.id)
            }
            onRetryGeneration={
              onRetryOutline && generatingOutlines[0]
                ? () => onRetryOutline(generatingOutlines[0].id)
                : undefined
            }
          />
        </div>

        {/* Roundtable Area */}
        {mode === 'playback' && (
          <div
            className={cn(
              'transition-opacity duration-300',
              !isPresenting && 'shrink-0',
              isPresenting && 'absolute inset-x-0 bottom-0 z-20',
            )}
          >
            <Roundtable
              mode={mode}
              initialParticipants={participants}
              playbackView={playbackView}
              currentSpeech={liveSpeech}
              lectureSpeech={lectureSpeech}
              idleText={firstSpeechText}
              playbackCompleted={playbackCompleted}
              discussionRequest={discussionRequest}
              engineMode={engineMode}
              isStreaming={chatIsStreaming}
              audioIndicatorState={audioIndicatorState}
              audioAgentId={audioAgentId}
              sessionType={
                chatSessionType === 'qa'
                  ? 'qa'
                  : chatSessionType === 'discussion'
                    ? 'discussion'
                    : undefined
              }
              speakingAgentId={speakingAgentId}
              speechProgress={speechProgress}
              showEndFlash={showEndFlash}
              endFlashSessionType={endFlashSessionType}
              thinkingState={thinkingState}
              isCueUser={isCueUser}
              isTopicPending={isTopicPending}
              onMessageSend={async (msg) => {
                if (await runTeacherPrompt(msg)) {
                  return;
                }
                // Always clear Level-1 pause state — the closure may hold a stale
                // isDiscussionPaused value (e.g. voice input's onTranscription callback
                // captures onMessageSend before React re-renders with the updated state).
                setIsDiscussionPaused(false);
                // Clear the sticky livePausedRef so the next agent-loop buffer
                // starts unpaused. (pauseActiveLiveBuffer sets a ref that new
                // buffers inherit — must be cleared before sendMessage creates one.)
                chatAreaRef.current?.resumeActiveLiveBuffer();
                // Flush any buffered / in-flight TTS audio from the previous
                // agent turn so it doesn't leak into the next round.
                discussionTTS.cleanup();
                // Clear soft-paused state — user is continuing the topic
                if (isTopicPending) {
                  setIsTopicPending(false);
                  setLiveSpeech(null);
                  setSpeakingAgentId(null);
                }
                // User interrupts during playback — handleUserInterrupt triggers
                // onUserInterrupt callback which already calls sendMessage, so skip
                // the direct sendMessage below to avoid sending twice.
                // Include 'paused' because onInputActivate pauses the engine before
                // the user finishes typing — without this the interrupt position
                // would never be saved and resuming after QA skips to the next sentence.
                if (
                  engineRef.current &&
                  (engineMode === 'playing' || engineMode === 'live' || engineMode === 'paused')
                ) {
                  engineRef.current.handleUserInterrupt(msg);
                } else {
                  chatAreaRef.current?.sendMessage(msg);
                }
                // Auto-switch to chat tab when user sends a message
                chatAreaRef.current?.switchToTab('chat');
                setIsCueUser(false);
                // Immediately mark streaming for synchronized stop button
                setChatIsStreaming(true);
                setChatSessionType(chatSessionType || 'qa');
                // Optimistic thinking: show thinking dots immediately so there's
                // no blank gap between userMessage expiry and the SSE thinking event.
                // The real SSE event will overwrite this with the same or updated value.
                setThinkingState({ stage: 'director' });
              }}
              onDiscussionStart={() => {
                // User clicks "Join" on ProactiveCard
                engineRef.current?.confirmDiscussion();
              }}
              onDiscussionSkip={() => {
                // User clicks "Skip" on ProactiveCard
                engineRef.current?.skipDiscussion();
              }}
              onStopDiscussion={handleStopDiscussion}
              onInputActivate={() => {
                // Level-1 pause: freeze buffer tick + TTS audio while SSE keeps buffering.
                // User resumes manually via Space / pause button after closing the input.
                // No isDiscussionPaused guard — always attempt to pause the buffer.
                // The return value ensures UI state stays in sync with buffer state.
                if (chatSessionType === 'qa' || chatSessionType === 'discussion') {
                  const paused = chatAreaRef.current?.pauseActiveLiveBuffer();
                  if (paused) {
                    discussionTTS.pause();
                    setIsDiscussionPaused(true);
                  }
                }
                // Also pause playback engine
                if (engineRef.current && (engineMode === 'playing' || engineMode === 'live')) {
                  engineRef.current.pause();
                }
              }}
              onResumeTopic={doResumeTopic}
              onPlayPause={handlePlayPause}
              isDiscussionPaused={isDiscussionPaused}
              onDiscussionPause={() => {
                const paused = chatAreaRef.current?.pauseActiveLiveBuffer();
                if (paused) {
                  discussionTTS.pause();
                  setIsDiscussionPaused(true);
                }
              }}
              onDiscussionResume={() => {
                chatAreaRef.current?.resumeActiveLiveBuffer();
                discussionTTS.resume();
                setIsDiscussionPaused(false);
              }}
              totalActions={totalActions}
              currentActionIndex={0}
              currentSceneIndex={currentSceneIndex}
              scenesCount={totalScenesCount}
              whiteboardOpen={whiteboardOpen}
              sidebarCollapsed={sidebarCollapsed}
              chatCollapsed={chatAreaCollapsed}
              onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
              onToggleChat={() => setChatAreaCollapsed(!chatAreaCollapsed)}
              onPrevSlide={handlePreviousScene}
              onNextSlide={handleNextScene}
              onWhiteboardClose={handleWhiteboardToggle}
              isPresenting={isPresenting}
              controlsVisible={controlsVisible}
              onTogglePresentation={togglePresentation}
              onPresentationInteractionChange={setIsPresentationInteractionActive}
              sharedSimulation={sharedSimulation}
              activeSurface={activePresentationSurface}
              reportAvailable={reportAvailable}
              viewerCanManageSimulation={canManageMiroFish}
              viewerCanControlPresentation={viewerCanControlPresentation}
              onSetPresentationSurface={handleSetPresentationSurface}
              onOpenMiroFishManager={openMiroFishManager}
              fullscreenContainerRef={stageRef}
            />
          </div>
        )}
      </div>

      {/* Chat Area */}
      <ChatArea
        ref={chatAreaRef}
        width={chatAreaWidth}
        onWidthChange={setChatAreaWidth}
        collapsed={chatAreaCollapsed}
        onCollapseChange={setChatAreaCollapsed}
        activeBubbleId={activeBubbleId}
        onActiveBubble={(id) => setActiveBubbleId(id)}
        currentSceneId={currentSceneId}
        classroomSource={classroomSource}
        onLiveSpeech={(text, agentId) => {
          // Capture epoch at call time — discard if scene has changed since
          const epoch = sceneEpochRef.current;
          // Use queueMicrotask to let any pending scene-switch reset settle first
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return; // stale — scene changed
            setLiveSpeech(text);
            if (agentId !== undefined) {
              setSpeakingAgentId(agentId);
            }
            if (text !== null || agentId) {
              setChatIsStreaming(true);
              setChatSessionType(chatAreaRef.current?.getActiveSessionType?.() ?? null);
              setIsTopicPending(false);
            } else if (text === null && agentId === null) {
              setChatIsStreaming(false);
              // Don't clear chatSessionType here — it's needed by the stop
              // button when director cues user (cue_user → done → liveSpeech null).
              // It gets properly cleared in doSessionCleanup and scene change.
            }
          });
        }}
        onSpeechProgress={(ratio) => {
          const epoch = sceneEpochRef.current;
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return;
            setSpeechProgress(ratio);
          });
        }}
        onThinking={(state) => {
          const epoch = sceneEpochRef.current;
          queueMicrotask(() => {
            if (sceneEpochRef.current !== epoch) return;
            setThinkingState(state);
          });
        }}
        onCueUser={(_fromAgentId, _prompt) => {
          setIsCueUser(true);
        }}
        onLiveSessionError={handleLiveSessionError}
        onStopSession={doSessionCleanup}
        onSegmentSealed={discussionTTS.handleSegmentSealed}
        shouldHoldAfterReveal={discussionTTS.shouldHold}
      />

      <MiroFishManagerDialog
        open={miroFishManagerOpen}
        onOpenChange={setMiroFishManagerOpen}
        sharedSimulation={sharedSimulation}
        participants={presentationParticipants}
        collaboration={collaborationState}
        multiUserEnabled={collaborationState?.multiUserEnabled ?? false}
        authoringAvailable={classroomSource === 'teacher-server' && miroFishAuthoringAvailable}
        classroomContext={{
          stageName: stage?.name,
          currentSceneId: currentScene?.id,
          currentSceneTitle: currentScene?.title,
          currentSceneType: currentScene?.type,
        }}
        onAttach={handleAttachMiroFish}
        onGeneratePlan={handleGenerateMiroFishPlan}
        onCreateWithAI={handleCreateMiroFish}
        onPollCreateJob={handlePollMiroFishCreateJob}
        onGrantControl={handleGrantMiroFishControl}
        onRevokeControl={handleRevokeMiroFishControl}
        onCollaborationAction={handleMiroFishCollaborationAction}
      />

      {/* Scene switch confirmation dialog */}
      <AlertDialog
        open={!!pendingSceneId}
        onOpenChange={(open) => {
          if (!open) cancelSceneSwitch();
        }}
      >
        <AlertDialogContent
          container={isPresenting ? stageRef.current : undefined}
          className="max-w-sm rounded-2xl p-0 overflow-hidden border-0 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.5)]"
        >
          <VisuallyHidden.Root>
            <AlertDialogTitle>{t('stage.confirmSwitchTitle')}</AlertDialogTitle>
          </VisuallyHidden.Root>
          {/* Top accent bar */}
          <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-red-400" />

          <div className="px-6 pt-5 pb-2 flex flex-col items-center text-center">
            {/* Icon */}
            <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4 ring-1 ring-amber-200/50 dark:ring-amber-700/30">
              <AlertTriangle className="w-6 h-6 text-amber-500 dark:text-amber-400" />
            </div>
            {/* Title */}
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-1.5">
              {t('stage.confirmSwitchTitle')}
            </h3>
            {/* Description */}
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {t('stage.confirmSwitchMessage')}
            </p>
          </div>

          <AlertDialogFooter className="px-6 pb-5 pt-3 flex-row gap-3">
            <AlertDialogCancel onClick={cancelSceneSwitch} className="flex-1 rounded-xl">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSceneSwitch}
              className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-md shadow-amber-200/50 dark:shadow-amber-900/30"
            >
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
