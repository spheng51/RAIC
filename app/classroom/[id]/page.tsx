'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { useI18n } from '@/lib/hooks/use-i18n';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const classroomId = params?.id as string;
  const { t } = useI18n();

  const { loadFromStorage } = useStageStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generationStartedRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
  });

  const loadClassroom = useCallback(async () => {
    try {
      let hasServerRecord = false;
      let shouldFallbackToStorage = false;

      try {
        const res = await fetch(`/api/classroom?id=${encodeURIComponent(classroomId)}`);
        if (res.status === 401 || res.status === 403) {
          const body = await res.json().catch(() => ({ error: 'Classroom access denied' }));
          const error = new Error(body.error) as Error & { status?: number };
          error.status = res.status;
          throw error;
        }

        if (res.status === 404) {
          shouldFallbackToStorage = true;
          log.info('Classroom not found in server storage, trying local IndexedDB for:', classroomId);
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
            fetchErr.message === 'Classroom access denied' ||
            fetchErr.message === 'Classroom payload is missing' ||
            !classroomId)
        ) {
          throw fetchErr;
        }

        if (!shouldFallbackToStorage) {
          log.warn('Server-side storage check failed:', fetchErr);
        }
      }

      if (!hasServerRecord && shouldFallbackToStorage) {
        await loadFromStorage(classroomId);
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
    } catch (err) {
      log.error('Failed to load classroom:', err);
      setError(err instanceof Error ? err.message : 'Failed to load classroom');
    } finally {
      setLoading(false);
    }
  }, [classroomId, loadFromStorage]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    void loadClassroom();
  }, [loadClassroom]);

  useEffect(() => {
    // Reset loading state on course switch to unmount Stage during transition,
    // preventing stale data from syncing back to the new course
    setLoading(true);
    setError(null);
    generationStartedRef.current = false;

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
              </div>
            </div>
          ) : (
            <Stage onRetryOutline={retrySingleOutline} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
