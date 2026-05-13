'use client';

import { Gamepad2, Pause, Play, RotateCcw, Trophy, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  ClassroomGameSessionMode,
  ClassroomGameSessionPayload,
  ClassroomGameTeacherAction,
} from '@/lib/types/classroom-game-session';
import { cn } from '@/lib/utils';

interface GameMultiplayerPanelProps {
  readonly className?: string;
  readonly state: ClassroomGameSessionPayload;
  readonly onTeacherAction: (
    action: ClassroomGameTeacherAction,
    body?: { mode?: ClassroomGameSessionMode; targetSessionId?: string },
  ) => void | Promise<void>;
  readonly onStudentReady: () => void | Promise<void>;
}

function modeLabel(mode: ClassroomGameSessionMode) {
  if (mode === 'leaderboard') return 'Leaderboard';
  if (mode === 'shared-control') return 'Shared control';
  return 'Both modes';
}

export function GameMultiplayerPanel({
  className,
  state,
  onTeacherAction,
  onStudentReady,
}: GameMultiplayerPanelProps) {
  const viewer = state.players[state.viewerSessionId];
  const topPlayers = state.leaderboard.slice(0, 4);
  const controller = state.controllerSessionId
    ? state.participants.find((participant) => participant.sessionId === state.controllerSessionId)
    : null;

  return (
    <div
      className={cn(
        'pointer-events-auto absolute bottom-4 left-4 z-30 w-[min(24rem,calc(100%-2rem))] rounded-lg border border-white/50 bg-white/90 p-3 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/82',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-200">
            <Gamepad2 className="size-4" />
            Multiplayer game
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{state.status}</Badge>
            <Badge variant="outline">{modeLabel(state.mode)}</Badge>
            <Badge variant="outline">
              <Users />
              {state.participantCount}
            </Badge>
          </div>
        </div>
        <div className="rounded-lg bg-violet-50 px-2 py-1 text-right text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">
          Round {state.roundNumber || 0}
        </div>
      </div>

      {!state.multiplayerSupported ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Waiting for the game bridge. Older game widgets may not support multiplayer events.
        </p>
      ) : null}

      {state.viewerCanManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void onTeacherAction('start_round')}
          >
            <Play className="size-4" />
            Start round
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onTeacherAction(state.status === 'paused' ? 'resume' : 'pause')}
          >
            {state.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
            {state.status === 'paused' ? 'Resume' : 'Pause'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onTeacherAction('reset')}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
          {(['both', 'leaderboard', 'shared-control'] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={state.mode === mode ? 'default' : 'outline'}
              onClick={() => void onTeacherAction('set_mode', { mode })}
            >
              {modeLabel(mode)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/25 px-3 py-2">
          <div className="min-w-0 text-xs">
            <p className="font-semibold">{viewer?.displayName ?? 'Student'}</p>
            <p className="text-muted-foreground">
              Score {viewer?.score ?? 0} · Progress {viewer?.progress ?? 0}%
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void onStudentReady()}>
            Ready
          </Button>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Trophy className="size-3.5" />
          Leaderboard
        </div>
        {topPlayers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No players yet.</p>
        ) : (
          <ol className="grid gap-1">
            {topPlayers.map((player, index) => (
              <li
                key={player.sessionId}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/35 px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate">
                  {index + 1}. {player.displayName}
                  {controller?.sessionId === player.sessionId ? ' · controller' : ''}
                </span>
                <span className="font-mono tabular-nums">
                  {player.score} · {player.progress}%
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {state.viewerCanManage && state.participants.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {state.participants.map((participant) => (
            <Button
              key={participant.sessionId}
              type="button"
              size="sm"
              variant={
                state.controllerSessionId === participant.sessionId ? 'default' : 'outline'
              }
              onClick={() =>
                void onTeacherAction('assign_controller', {
                  targetSessionId: participant.sessionId,
                })
              }
            >
              {participant.displayName}
            </Button>
          ))}
          {state.controllerSessionId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void onTeacherAction('clear_controller')}
            >
              Clear controller
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
