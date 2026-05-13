'use client';

import { useMemo } from 'react';
import type { Scene, StageMode } from '@/lib/types/stage';
import { SlideEditor as SlideRenderer } from '../slide-renderer/Editor';
import { QuizView } from '../scene-renderers/quiz-view';
import { InteractiveRenderer } from '../scene-renderers/interactive-renderer';
import { PBLRenderer } from '../scene-renderers/pbl-renderer';
import type {
  ClassroomGameSessionPayload,
  ClassroomGameStudentEventType,
} from '@/lib/types/classroom-game-session';

interface SceneRendererProps {
  readonly scene: Scene;
  readonly mode: StageMode;
  readonly gameSession?: ClassroomGameSessionPayload | null;
  readonly onGameEvent?: (event: {
    event: ClassroomGameStudentEventType;
    score?: number;
    progress?: number;
    state?: Record<string, unknown>;
    input?: Record<string, unknown>;
  }) => void;
}

export function SceneRenderer({ scene, mode, gameSession, onGameEvent }: SceneRendererProps) {
  const renderer = useMemo(() => {
    switch (scene.type) {
      case 'slide':
        if (scene.content.type !== 'slide') return <div>Invalid slide content</div>;
        return <SlideRenderer mode={mode} />;
      case 'quiz':
        if (scene.content.type !== 'quiz') return <div>Invalid quiz content</div>;
        return <QuizView key={scene.id} questions={scene.content.questions} sceneId={scene.id} />;
      case 'interactive':
        if (scene.content.type !== 'interactive') return <div>Invalid interactive content</div>;
        return (
          <InteractiveRenderer
            content={scene.content}
            mode={mode}
            sceneId={scene.id}
            gameSession={gameSession}
            onGameEvent={onGameEvent}
          />
        );
      case 'pbl':
        if (scene.content.type !== 'pbl') return <div>Invalid PBL content</div>;
        return <PBLRenderer content={scene.content} mode={mode} sceneId={scene.id} />;
      default:
        return <div>Unknown scene type</div>;
    }
  }, [scene, mode, gameSession, onGameEvent]);

  return <div className="w-full h-full">{renderer}</div>;
}
