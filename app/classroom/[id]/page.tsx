'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { useI18n } from '@/lib/hooks/use-i18n';
import { stageExists } from '@/lib/utils/stage-storage';
import {
  canUseLocalClassroomFallback,
  clearClassroomLaunchContext,
  getHomePathForLaunchMode,
  isPublicDemoLaunchContext,
  isTeacherServerLaunchContext,
  readClassroomLaunchContext,
  type ClassroomLaunchMode,
} from '@/lib/utils/classroom-launch';
import { Button } from '@/components/ui/button';
import { SessionReflectionDialog } from '@/components/stage/session-reflection-dialog';
import { toast } from 'sonner';
import {
  applyPersistedSessionContextFloor,
  applySceneSelectionSignal,
  buildSessionContextPayload,
  hydrateSessionProgressState,
  type PersistedSessionContextSnapshot,
} from '@/lib/classroom/session-progress';
import type { ClassroomRevisitIntent } from '@/lib/types/classroom-intelligence';

const log = createLogger('Classroom');

interface ClassroomErrorAction {
  readonly href: string;
  readonly label: string;
}

function isPersistedSessionContextSnapshot(
  value: unknown,
): value is PersistedSessionContextSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PersistedSessionContextSnapshot).completedSceneCount === 'number' &&
    typeof (value as PersistedSessionContextSnapshot).totalSceneCount === 'number'
  );
}

export default function ClassroomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const classroomId = params?.id as string;
  const { t } = useI18n();

  const { loadFromStorage } = useStageStore();
  const stage = useStageStore.use.stage();
  const scenes = useStageStore.use.scenes();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<ClassroomErrorAction | null>(null);
  const [classroomSource, setClassroomSource] = useState<ClassroomLaunchMode | null>(null);
  const [reflectionOpen, setReflectionOpen] = useState(false);

  const generationStartedRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastSessionContextPayloadRef = useRef<string | null>(null);
  const persistedSessionContextRef = useRef<PersistedSessionContextSnapshot | null>(null);
  const completedSceneIdsRef = useRef<Set<string>>(new Set());
  const revisitIntentRef = useRef<ClassroomRevisitIntent>('continue');

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
  });

  const homePath = classroomSource
    ? getHomePathForLaunchMode(classroomSource)
    : getHomePathForLaunchMode('public-demo');
  const classroomNotice = classroomSource === 'public-demo' ? t('classroom.localDemoNotice') : null;

  const buildClassroomErrorState = useCallback(
    (
      status?: number,
      options?: { preferTeacherStudio?: boolean },
    ): { message: string; action: ClassroomErrorAction | null } => {
      const preferTeacherStudio = options?.preferTeacherStudio ?? false;

      if (status === 401) {
        return {
          message: t('classroom.teacherAccessMissing'),
          action: {
            href: '/sign-in',
            label: t('classroom.signInAgain'),
          },
        };
      }

      if (status === 403) {
        return {
          message: t('classroom.serverAccessDenied'),
          action: {
            href: '/studio',
            label: t('classroom.openTeacherStudio'),
          },
        };
      }

      if (status === 404) {
        return {
          message: preferTeacherStudio
            ? t('classroom.teacherAccessMissing')
            : t('classroom.classroomNotFound'),
          action: preferTeacherStudio
            ? {
                href: '/studio',
                label: t('classroom.openTeacherStudio'),
              }
            : {
                href: '/',
                label: t('generation.backToHome'),
              },
        };
      }

      return {
        message: t('classroom.classroomNotFound'),
        action: {
          href: '/',
          label: t('generation.backToHome'),
        },
      };
    },
    [t],
  );

  const hydratePersistedSessionContext = useCallback(
    async (input: { stageName: string; language?: string | null; scenes: typeof scenes }) => {
      try {
        const response = await fetch(
          `/api/classroom/${encodeURIComponent(classroomId)}/session-context`,
          {
            cache: 'no-store',
          },
        );

        if (!response.ok) {
          if (response.status !== 401 && response.status !== 403 && response.status !== 404) {
            log.warn('Failed to load persisted session context:', response.status);
          }
          return;
        }

        const body = (await response.json().catch(() => null)) as { context?: unknown } | null;
        if (!isPersistedSessionContextSnapshot(body?.context)) {
          return;
        }

        const persistedContext = body.context;
        const hydratedState = hydrateSessionProgressState({
          scenes: input.scenes,
          context: persistedContext,
        });

        completedSceneIdsRef.current = hydratedState.completedSceneIds;
        revisitIntentRef.current = hydratedState.revisitIntent;
        persistedSessionContextRef.current = persistedContext;
        lastSessionContextPayloadRef.current = JSON.stringify(
          applyPersistedSessionContextFloor({
            payload: buildSessionContextPayload({
              stageName: input.stageName,
              language: input.language ?? 'en-US',
              scenes: input.scenes,
              completedSceneIds: hydratedState.completedSceneIds,
              revisitIntent: hydratedState.revisitIntent,
            }),
            persistedContext,
            scenes: input.scenes,
          }),
        );
      } catch (sessionContextError) {
        log.warn('Failed to hydrate classroom session context:', sessionContextError);
      }
    },
    [classroomId],
  );

  const loadClassroom = useCallback(async () => {
    const launchContext = readClassroomLaunchContext();
    const expectServerBacked = isTeacherServerLaunchContext(launchContext, classroomId);
    const preferLocalDemo = isPublicDemoLaunchContext(launchContext, classroomId);

    try {
      let hasServerRecord = false;
      const hasLocalStage = await stageExists(classroomId);
      let shouldFallbackToStorage = preferLocalDemo && hasLocalStage;
      let resolvedSource: ClassroomLaunchMode | null = null;

      if (preferLocalDemo && hasLocalStage) {
        log.info('Classroom launch context prefers local IndexedDB for:', classroomId);
      }

      if (!shouldFallbackToStorage) {
        try {
          const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
          if (res.status === 401 || res.status === 403) {
            const body = await res.json().catch(() => ({ error: 'Classroom access denied' }));
            const error = new Error(body.error) as Error & { status?: number };
            error.status = res.status;
            throw error;
          }

          if (res.status === 404) {
            shouldFallbackToStorage = canUseLocalClassroomFallback({
              expectServerBacked,
              hasLocalStage,
            });

            if (shouldFallbackToStorage) {
              log.info(
                'Classroom not found in server storage, trying local IndexedDB for:',
                classroomId,
              );
            } else {
              const notFoundError = new Error(
                expectServerBacked
                  ? t('classroom.teacherAccessMissing')
                  : t('classroom.classroomNotFound'),
              ) as Error & { status?: number };
              notFoundError.status = 404;
              throw notFoundError;
            }
          } else if (res.ok) {
            const json = await res.json();
            if (json.success && json.classroom) {
              const { stage, scenes } = json.classroom;
              useStageStore.getState().setStage(stage);
              useStageStore.setState({
                scenes,
                currentSceneId: scenes[0]?.id ?? null,
              });
              hasServerRecord = true;
              resolvedSource = 'teacher-server';
              log.info('Loaded from server-side storage:', classroomId);

              // Hydrate server-generated agents into IndexedDB + registry.
              // Don't set selectedAgentIds here yet — the general agent
              // restoration logic below handles it uniformly.
              if (stage.generatedAgentConfigs?.length) {
                const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
                await saveGeneratedAgents(stage.id, stage.generatedAgentConfigs);
                log.info('Hydrated server-generated agents for stage:', stage.id);
              }
            } else {
              throw new Error('Classroom payload is missing');
            }
          } else {
            const body = await res.json().catch(() => ({ error: 'Failed to load classroom' }));
            throw new Error(body.error);
          }
        } catch (fetchErr) {
          if (
            fetchErr instanceof Error &&
            ((fetchErr as Error & { status?: number }).status === 401 ||
              (fetchErr as Error & { status?: number }).status === 403 ||
              (fetchErr as Error & { status?: number }).status === 404 ||
              fetchErr.message === 'Classroom payload is missing' ||
              fetchErr.message === t('classroom.teacherAccessMissing') ||
              fetchErr.message === t('classroom.classroomNotFound') ||
              !classroomId)
          ) {
            throw fetchErr;
          }

          if (!shouldFallbackToStorage) {
            log.warn('Server-side storage check failed:', fetchErr);
            throw fetchErr;
          }
        }
      }

      if (!hasServerRecord && shouldFallbackToStorage) {
        await loadFromStorage(classroomId);
        const localStage = useStageStore.getState().stage;
        if (!localStage?.id) {
          throw new Error(t('classroom.classroomNotFound'));
        }
        resolvedSource = 'public-demo';
      }

      // Restore completed media generation tasks from IndexedDB
      await useMediaGenerationStore.getState().restoreFromDB(classroomId);

      // Restore agents for this stage
      const { loadGeneratedAgentsForStage, useAgentRegistry } =
        await import('@/lib/orchestration/registry/store');
      const generatedAgentIds = await loadGeneratedAgentsForStage(classroomId);
      const { useSettingsStore } = await import('@/lib/store/settings');
      if (generatedAgentIds.length > 0) {
        // Auto mode — use generated agents from IndexedDB
        useSettingsStore.getState().setAgentMode('auto');
        useSettingsStore.getState().setSelectedAgentIds(generatedAgentIds);
      } else {
        // Preset mode — restore agent IDs saved in the stage at creation time.
        // Filter out any stale generated IDs that may have been persisted before
        // the bleed-fix, so they don't resolve against a leftover registry entry.
        const stage = useStageStore.getState().stage;
        const stageAgentIds = stage?.agentIds;
        const registry = useAgentRegistry.getState();
        const cleanIds = stageAgentIds?.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        useSettingsStore.getState().setAgentMode('preset');
        useSettingsStore
          .getState()
          .setSelectedAgentIds(
            cleanIds && cleanIds.length > 0 ? cleanIds : ['default-1', 'default-2', 'default-3'],
          );
      }

      if (resolvedSource === 'teacher-server') {
        const loadedStageState = useStageStore.getState();
        if (loadedStageState.stage && loadedStageState.scenes.length > 0) {
          await hydratePersistedSessionContext({
            stageName: loadedStageState.stage.name,
            language: loadedStageState.stage.language ?? 'en-US',
            scenes: loadedStageState.scenes,
          });
        }
      }

      setClassroomSource(resolvedSource);
      setErrorAction(null);
      if (
        launchContext?.generationCompletionStatus === 'partial' &&
        launchContext.generationWarnings?.length
      ) {
        toast.warning(
          t('classroom.partialGenerationWarning', {
            count: launchContext.generationWarnings.length,
          }),
        );
      }
      clearClassroomLaunchContext(classroomId);
    } catch (err) {
      log.error('Failed to load classroom:', err);
      const status = err instanceof Error ? (err as Error & { status?: number }).status : undefined;
      const nextErrorState = buildClassroomErrorState(status, {
        preferTeacherStudio: expectServerBacked,
      });
      setError(
        err instanceof Error ? err.message || nextErrorState.message : nextErrorState.message,
      );
      setErrorAction(nextErrorState.action);
      setClassroomSource(null);
    } finally {
      setLoading(false);
    }
  }, [buildClassroomErrorState, classroomId, hydratePersistedSessionContext, loadFromStorage, t]);

  const handleRetry = useCallback(() => {
    setError(null);
    setErrorAction(null);
    setLoading(true);
    void loadClassroom();
  }, [loadClassroom]);

  const postSessionContext = useCallback(
    (
      overrides: Partial<{
        completedSceneCount: number;
        totalSceneCount: number;
        lastCompletedSceneId: string | null;
        lastCompletedSceneTitle: string | null;
        revisitIntent: ClassroomRevisitIntent;
      }> = {},
    ) => {
      if (
        loading ||
        error ||
        classroomSource !== 'teacher-server' ||
        !stage ||
        scenes.length === 0
      ) {
        return;
      }

      const orderedScenes = [...scenes].sort((a, b) => a.order - b.order);
      const payload = applyPersistedSessionContextFloor({
        payload: buildSessionContextPayload({
          stageName: stage.name,
          language: stage.language ?? 'en-US',
          scenes: orderedScenes,
          completedSceneIds: completedSceneIdsRef.current,
          revisitIntent: revisitIntentRef.current,
          overrides,
        }),
        persistedContext: persistedSessionContextRef.current,
        scenes: orderedScenes,
      });

      const payloadKey = JSON.stringify(payload);
      if (lastSessionContextPayloadRef.current === payloadKey) {
        return;
      }

      void fetch(`/api/classroom/${encodeURIComponent(classroomId)}/session-context`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
        },
        body: payloadKey,
      })
        .then((response) => {
          if (response.ok) {
            persistedSessionContextRef.current = {
              completedSceneCount: payload.completedSceneCount,
              totalSceneCount: payload.totalSceneCount,
              lastCompletedSceneId: payload.lastCompletedSceneId,
              lastCompletedSceneTitle: payload.lastCompletedSceneTitle,
              revisitIntent: payload.revisitIntent,
            };
            lastSessionContextPayloadRef.current = payloadKey;
          }
        })
        .catch(() => undefined);
    },
    [classroomId, classroomSource, error, loading, scenes, stage],
  );

  const handleSceneCompleted = useCallback(
    (sceneId: string) => {
      const scene = scenes.find((entry) => entry.id === sceneId);
      if (!scene) {
        return;
      }

      completedSceneIdsRef.current = new Set(completedSceneIdsRef.current).add(sceneId);
      postSessionContext();
    },
    [postSessionContext, scenes],
  );

  const handleSceneSelected = useCallback(
    ({
      fromSceneId,
      toSceneId,
      reason,
    }: {
      fromSceneId: string | null;
      toSceneId: string;
      reason: 'manual' | 'auto' | 'pending';
    }) => {
      if (reason !== 'manual' || classroomSource !== 'teacher-server') {
        return;
      }

      const nextState = applySceneSelectionSignal({
        scenes,
        completedSceneIds: completedSceneIdsRef.current,
        revisitIntent: revisitIntentRef.current,
        fromSceneId,
        toSceneId,
        reason,
      });

      if (!nextState.shouldPost) {
        return;
      }

      completedSceneIdsRef.current = nextState.completedSceneIds;
      revisitIntentRef.current = nextState.revisitIntent;
      postSessionContext(
        nextState.revisitIntent === 'revisit' ? { revisitIntent: 'revisit' } : undefined,
      );
    },
    [classroomSource, postSessionContext, scenes],
  );

  const handleReflectionSaved = useCallback(
    (input: {
      context?: {
        revisitIntent?: ClassroomRevisitIntent;
      } | null;
    }) => {
      if (input.context?.revisitIntent) {
        revisitIntentRef.current = input.context.revisitIntent;
        if (persistedSessionContextRef.current) {
          persistedSessionContextRef.current = {
            ...persistedSessionContextRef.current,
            revisitIntent: input.context.revisitIntent,
          };
        }
      }
      lastSessionContextPayloadRef.current = null;
    },
    [],
  );

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    setLoading(true);
    setError(null);
    setErrorAction(null);
    setClassroomSource(null);
    setReflectionOpen(false);
    generationStartedRef.current = false;
    lastSessionContextPayloadRef.current = null;
    persistedSessionContextRef.current = null;
    completedSceneIdsRef.current = new Set();
    revisitIntentRef.current = 'continue';

    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    // Placeholder IDs (gen_img_1, gen_vid_1) are not globally unique across stages,
    // so stale tasks from a previous classroom would shadow the new one's.
    const mediaStore = useMediaGenerationStore.getState();
    mediaStore.revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // Clear whiteboard history to prevent snapshots from a previous course leaking in.
    useWhiteboardHistoryStore.getState().clearHistory();

    loadClassroom();

    // Cancel ongoing generation when classroomId changes or component unmounts
    return () => {
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  useEffect(() => {
    if (error) {
      retryButtonRef.current?.focus();
    }
  }, [error]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;

    const state = useStageStore.getState();
    const { outlines, scenes, stage } = state;

    // Check if there are pending outlines
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      // Load generation params from sessionStorage (stored by generation-preview before navigating)
      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      // Reconstruct imageMapping from IndexedDB using pdfImages storageIds
      const storageIds = (params.pdfImages || [])
        .map((img: { storageId?: string }) => img.storageId)
        .filter(Boolean);

      loadImageMapping(storageIds).then((imageMapping) => {
        generateRemaining({
          classroomId: classroomSource === 'teacher-server' ? classroomId : undefined,
          pdfImages: params.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            language: stage.language,
            style: stage.style,
          },
          agents: params.agents,
          userProfile: params.userProfile,
        });
      });
    } else if (outlines.length > 0 && stage) {
      // All scenes are generated, but some media may not have finished.
      // Resume media generation for any tasks not yet in IndexedDB.
      // generateMediaForOutlines skips already-completed tasks automatically.
      generationStartedRef.current = true;
      generateMediaForOutlines(outlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div
              className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="text-center text-muted-foreground">
                <p>{t('classroom.loading')}</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center" role="alert" aria-live="assertive" aria-atomic="true">
                <h2 className="text-destructive font-medium mb-2">{t('common.error')}</h2>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <button
                  ref={retryButtonRef}
                  type="button"
                  onClick={handleRetry}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {t('common.retry')}
                </button>
                {errorAction ? (
                  <button
                    type="button"
                    onClick={() => router.push(errorAction.href)}
                    className="ml-3 px-4 py-2 rounded-md border border-border bg-background text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {errorAction.label}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="relative flex-1">
              {classroomSource === 'teacher-server' ? (
                <div className="absolute right-4 top-4 z-30">
                  <Button size="sm" variant="secondary" onClick={() => setReflectionOpen(true)}>
                    Session Reflection
                  </Button>
                </div>
              ) : null}
              <Stage
                onRetryOutline={retrySingleOutline}
                classroomSource={classroomSource}
                classroomNotice={classroomNotice}
                homePath={homePath}
                onSceneCompleted={handleSceneCompleted}
                onSceneSelected={handleSceneSelected}
              />
              <SessionReflectionDialog
                classroomId={classroomId}
                open={reflectionOpen}
                onOpenChange={setReflectionOpen}
                onSaved={handleReflectionSaved}
              />
            </div>
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
