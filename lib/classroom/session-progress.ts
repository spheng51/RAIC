import type { ClassroomRevisitIntent } from '@/lib/types/classroom-intelligence';
import type { Scene } from '@/lib/types/stage';

type SessionProgressScene = Pick<Scene, 'id' | 'order' | 'title' | 'type'>;

export interface SessionContextPayload {
  requirement?: string;
  stageName: string;
  language: string;
  lastCompletedSceneId: string | null;
  lastCompletedSceneTitle: string | null;
  completedSceneCount: number;
  totalSceneCount: number;
  revisitIntent: ClassroomRevisitIntent;
}

export type PersistedSessionContextSnapshot = Pick<
  SessionContextPayload,
  | 'completedSceneCount'
  | 'totalSceneCount'
  | 'lastCompletedSceneId'
  | 'lastCompletedSceneTitle'
  | 'revisitIntent'
>;

function getOrderedScenes(scenes: SessionProgressScene[]): SessionProgressScene[] {
  return [...scenes].sort((a, b) => a.order - b.order);
}

export function buildSessionContextPayload(input: {
  requirement?: string | null;
  stageName: string;
  language?: string | null;
  scenes: SessionProgressScene[];
  completedSceneIds: Set<string>;
  revisitIntent: ClassroomRevisitIntent;
  overrides?: Partial<SessionContextPayload>;
}): SessionContextPayload {
  const orderedScenes = getOrderedScenes(input.scenes);
  const completedScenes = orderedScenes.filter((scene) => input.completedSceneIds.has(scene.id));
  const lastCompletedScene = completedScenes[completedScenes.length - 1] ?? null;

  return {
    ...(input.requirement ? { requirement: input.requirement } : {}),
    stageName: input.stageName,
    language: input.language ?? 'en-US',
    lastCompletedSceneId: lastCompletedScene?.id ?? null,
    lastCompletedSceneTitle: lastCompletedScene?.title ?? null,
    completedSceneCount: completedScenes.length,
    totalSceneCount: orderedScenes.length,
    revisitIntent: input.revisitIntent,
    ...input.overrides,
  };
}

export function hydrateSessionProgressState(input: {
  scenes: SessionProgressScene[];
  context: PersistedSessionContextSnapshot | null | undefined;
}): {
  completedSceneIds: Set<string>;
  revisitIntent: ClassroomRevisitIntent;
} {
  const orderedScenes = getOrderedScenes(input.scenes);
  const completedSceneCount = Math.min(
    Math.max(0, input.context?.completedSceneCount ?? 0),
    orderedScenes.length,
  );

  if (completedSceneCount === 0) {
    return {
      completedSceneIds: new Set<string>(),
      revisitIntent: input.context?.revisitIntent ?? 'continue',
    };
  }

  const completedSceneIds = new Set<string>();
  const lastCompletedSceneId = input.context?.lastCompletedSceneId ?? null;
  const lastCompletedSceneIndex =
    lastCompletedSceneId == null
      ? -1
      : orderedScenes.findIndex((scene) => scene.id === lastCompletedSceneId);

  if (lastCompletedSceneIndex < 0) {
    for (const scene of orderedScenes.slice(0, completedSceneCount)) {
      completedSceneIds.add(scene.id);
    }
  } else {
    const scenesBeforeLast = orderedScenes.slice(0, lastCompletedSceneIndex);
    const retainedScenesBeforeLast = scenesBeforeLast.slice(
      0,
      Math.max(0, completedSceneCount - 1),
    );

    for (const scene of retainedScenesBeforeLast) {
      completedSceneIds.add(scene.id);
    }
    completedSceneIds.add(orderedScenes[lastCompletedSceneIndex].id);

    const remainingCount = completedSceneCount - completedSceneIds.size;
    if (remainingCount > 0) {
      for (const scene of orderedScenes.slice(
        lastCompletedSceneIndex + 1,
        lastCompletedSceneIndex + 1 + remainingCount,
      )) {
        completedSceneIds.add(scene.id);
      }
    }
  }

  return {
    completedSceneIds,
    revisitIntent: input.context?.revisitIntent ?? 'continue',
  };
}

export function applyPersistedSessionContextFloor(input: {
  payload: SessionContextPayload;
  persistedContext: PersistedSessionContextSnapshot | null | undefined;
  scenes: SessionProgressScene[];
}): SessionContextPayload {
  const persistedContext = input.persistedContext;
  if (!persistedContext) {
    return input.payload;
  }

  const orderedScenes = getOrderedScenes(input.scenes);
  const sceneIndexById = new Map(orderedScenes.map((scene, index) => [scene.id, index]));
  const payloadLastCompletedIndex =
    input.payload.lastCompletedSceneId == null
      ? -1
      : (sceneIndexById.get(input.payload.lastCompletedSceneId) ?? -1);
  const persistedLastCompletedIndex =
    persistedContext.lastCompletedSceneId == null
      ? -1
      : (sceneIndexById.get(persistedContext.lastCompletedSceneId) ?? -1);

  if (input.payload.completedSceneCount < persistedContext.completedSceneCount) {
    return {
      ...input.payload,
      completedSceneCount: persistedContext.completedSceneCount,
      totalSceneCount: Math.max(input.payload.totalSceneCount, persistedContext.totalSceneCount),
      lastCompletedSceneId: persistedContext.lastCompletedSceneId,
      lastCompletedSceneTitle: persistedContext.lastCompletedSceneTitle,
      revisitIntent: persistedContext.revisitIntent,
    };
  }

  if (
    input.payload.completedSceneCount === persistedContext.completedSceneCount &&
    payloadLastCompletedIndex < persistedLastCompletedIndex
  ) {
    return {
      ...input.payload,
      totalSceneCount: Math.max(input.payload.totalSceneCount, persistedContext.totalSceneCount),
      lastCompletedSceneId: persistedContext.lastCompletedSceneId,
      lastCompletedSceneTitle: persistedContext.lastCompletedSceneTitle,
      revisitIntent: persistedContext.revisitIntent,
    };
  }

  return {
    ...input.payload,
    totalSceneCount: Math.max(input.payload.totalSceneCount, persistedContext.totalSceneCount),
  };
}

export function applySceneSelectionSignal(input: {
  scenes: SessionProgressScene[];
  completedSceneIds: Set<string>;
  revisitIntent: ClassroomRevisitIntent;
  fromSceneId: string | null;
  toSceneId: string;
  reason: 'manual' | 'auto' | 'pending';
  isCourseCompletion?: boolean;
}): {
  shouldPost: boolean;
  completedSceneIds: Set<string>;
  revisitIntent: ClassroomRevisitIntent;
} {
  const nextCompletedSceneIds = new Set(input.completedSceneIds);
  if (input.reason !== 'manual') {
    return {
      shouldPost: false,
      completedSceneIds: nextCompletedSceneIds,
      revisitIntent: input.revisitIntent,
    };
  }

  const orderedScenes = getOrderedScenes(input.scenes);
  const fromScene =
    input.fromSceneId == null
      ? null
      : (orderedScenes.find((scene) => scene.id === input.fromSceneId) ?? null);
  const targetScene = orderedScenes.find((scene) => scene.id === input.toSceneId) ?? null;
  const completionSourceScene =
    input.isCourseCompletion && !fromScene
      ? (orderedScenes[orderedScenes.length - 1] ?? null)
      : fromScene;

  if (!targetScene && !input.isCourseCompletion) {
    return {
      shouldPost: false,
      completedSceneIds: nextCompletedSceneIds,
      revisitIntent: input.revisitIntent,
    };
  }

  if (
    completionSourceScene &&
    (input.isCourseCompletion ||
      (targetScene && targetScene.order > completionSourceScene.order)) &&
    !nextCompletedSceneIds.has(completionSourceScene.id)
  ) {
    nextCompletedSceneIds.add(completionSourceScene.id);
  }

  if (!targetScene) {
    return {
      shouldPost: completionSourceScene != null,
      completedSceneIds: nextCompletedSceneIds,
      revisitIntent: input.revisitIntent,
    };
  }

  const highestCompletedOrder = orderedScenes.reduce((highest, scene) => {
    if (nextCompletedSceneIds.has(scene.id)) {
      return Math.max(highest, scene.order);
    }

    return highest;
  }, 0);

  return {
    shouldPost: true,
    completedSceneIds: nextCompletedSceneIds,
    revisitIntent: targetScene.order <= highestCompletedOrder ? 'revisit' : input.revisitIntent,
  };
}
