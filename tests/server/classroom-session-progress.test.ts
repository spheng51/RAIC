import { describe, expect, it } from 'vitest';
import {
  applyPersistedSessionContextFloor,
  applySceneSelectionSignal,
  buildSessionContextPayload,
  hydrateSessionProgressState,
} from '@/lib/classroom/session-progress';

const scenes = [
  {
    id: 'scene-1',
    order: 1,
    type: 'quiz',
    title: 'Orbit recap',
  },
  {
    id: 'scene-2',
    order: 2,
    type: 'slide',
    title: 'Transfer windows',
  },
  {
    id: 'scene-3',
    order: 3,
    type: 'interactive',
    title: 'Burn timing lab',
  },
] as const;

describe('classroom session progress signals', () => {
  it('does not post or mark completion for passive auto navigation', () => {
    const result = applySceneSelectionSignal({
      scenes: [...scenes],
      completedSceneIds: new Set<string>(),
      revisitIntent: 'continue',
      fromSceneId: 'scene-1',
      toSceneId: 'scene-2',
      reason: 'auto',
    });

    expect(result).toEqual({
      shouldPost: false,
      completedSceneIds: new Set<string>(),
      revisitIntent: 'continue',
    });
  });

  it('marks the source scene complete when a teacher manually advances', () => {
    const result = applySceneSelectionSignal({
      scenes: [...scenes],
      completedSceneIds: new Set<string>(),
      revisitIntent: 'continue',
      fromSceneId: 'scene-1',
      toSceneId: 'scene-2',
      reason: 'manual',
    });

    expect(result.shouldPost).toBe(true);
    expect([...result.completedSceneIds]).toEqual(['scene-1']);
    expect(result.revisitIntent).toBe('continue');
  });

  it('marks slide scenes complete when a teacher manually advances through them', () => {
    const result = applySceneSelectionSignal({
      scenes: [...scenes],
      completedSceneIds: new Set<string>(['scene-1']),
      revisitIntent: 'continue',
      fromSceneId: 'scene-2',
      toSceneId: 'scene-3',
      reason: 'manual',
    });

    expect(result.shouldPost).toBe(true);
    expect([...result.completedSceneIds]).toEqual(['scene-1', 'scene-2']);
    expect(result.revisitIntent).toBe('continue');
  });

  it('marks the final real scene complete when a teacher advances to course completion', () => {
    const result = applySceneSelectionSignal({
      scenes: [...scenes],
      completedSceneIds: new Set<string>(['scene-1', 'scene-2']),
      revisitIntent: 'continue',
      fromSceneId: 'scene-3',
      toSceneId: '__completion__',
      reason: 'manual',
      isCourseCompletion: true,
    });

    expect(result.shouldPost).toBe(true);
    expect([...result.completedSceneIds]).toEqual(['scene-1', 'scene-2', 'scene-3']);
    expect(result.revisitIntent).toBe('continue');
  });

  it('uses the final ordered scene when course completion starts from a sentinel scene id', () => {
    const result = applySceneSelectionSignal({
      scenes: [...scenes],
      completedSceneIds: new Set<string>(['scene-1', 'scene-2']),
      revisitIntent: 'continue',
      fromSceneId: '__pending__',
      toSceneId: '__completion__',
      reason: 'manual',
      isCourseCompletion: true,
    });

    expect(result.shouldPost).toBe(true);
    expect([...result.completedSceneIds]).toEqual(['scene-1', 'scene-2', 'scene-3']);
    expect(result.revisitIntent).toBe('continue');
  });

  it('switches the revisit intent when the teacher manually returns to a completed scene', () => {
    const result = applySceneSelectionSignal({
      scenes: [...scenes],
      completedSceneIds: new Set<string>(['scene-1', 'scene-2']),
      revisitIntent: 'continue',
      fromSceneId: 'scene-3',
      toSceneId: 'scene-1',
      reason: 'manual',
    });

    expect(result.shouldPost).toBe(true);
    expect(result.revisitIntent).toBe('revisit');
  });

  it('builds the persisted session-context payload from explicit completion state', () => {
    const payload = buildSessionContextPayload({
      requirement: 'Teach orbital mechanics with simulations',
      stageName: 'Orbital Mechanics',
      language: 'en-US',
      scenes: [...scenes],
      completedSceneIds: new Set<string>(['scene-1', 'scene-2']),
      revisitIntent: 'revisit',
    });

    expect(payload).toEqual({
      requirement: 'Teach orbital mechanics with simulations',
      stageName: 'Orbital Mechanics',
      language: 'en-US',
      lastCompletedSceneId: 'scene-2',
      lastCompletedSceneTitle: 'Transfer windows',
      completedSceneCount: 2,
      totalSceneCount: 3,
      revisitIntent: 'revisit',
    });
  });

  it('hydrates reconnect progress refs from persisted session context', () => {
    const result = hydrateSessionProgressState({
      scenes: [...scenes],
      context: {
        completedSceneCount: 2,
        totalSceneCount: 3,
        lastCompletedSceneId: 'scene-3',
        lastCompletedSceneTitle: 'Burn timing lab',
        revisitIntent: 'revisit',
      },
    });

    expect([...result.completedSceneIds]).toEqual(['scene-1', 'scene-3']);
    expect(result.revisitIntent).toBe('revisit');
  });

  it('prevents reconnect posts from regressing below the persisted session context', () => {
    const payload = applyPersistedSessionContextFloor({
      payload: buildSessionContextPayload({
        requirement: 'Teach orbital mechanics with simulations',
        stageName: 'Orbital Mechanics',
        language: 'en-US',
        scenes: [...scenes],
        completedSceneIds: new Set<string>(),
        revisitIntent: 'continue',
      }),
      persistedContext: {
        completedSceneCount: 2,
        totalSceneCount: 3,
        lastCompletedSceneId: 'scene-3',
        lastCompletedSceneTitle: 'Burn timing lab',
        revisitIntent: 'revisit',
      },
      scenes: [...scenes],
    });

    expect(payload).toEqual({
      requirement: 'Teach orbital mechanics with simulations',
      stageName: 'Orbital Mechanics',
      language: 'en-US',
      lastCompletedSceneId: 'scene-3',
      lastCompletedSceneTitle: 'Burn timing lab',
      completedSceneCount: 2,
      totalSceneCount: 3,
      revisitIntent: 'revisit',
    });
  });
});
