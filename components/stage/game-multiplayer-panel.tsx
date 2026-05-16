'use client';

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Clock,
  Flag,
  Gamepad2,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

function statusLabel(status: ClassroomGameSessionPayload['status']) {
  if (status === 'arming') return 'Arming';
  if (status === 'live') return 'Live';
  if (status === 'paused') return 'Paused';
  if (status === 'completed') return 'Complete';
  return 'Idle';
}

function formatRemaining(ms: number | null) {
  if (ms === null) return '--:--';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function GameMultiplayerPanel({
  className,
  state,
  onTeacherAction,
  onStudentReady,
}: GameMultiplayerPanelProps) {
  const [controlOpen, setControlOpen] = useState(false);
  const viewer = state.players[state.viewerSessionId];
  const topPlayers = state.leaderboard.slice(0, 5);
  const controller = state.controllerSessionId
    ? state.participants.find((participant) => participant.sessionId === state.controllerSessionId)
    : null;
  const viewerRank = useMemo(() => {
    const index = state.leaderboard.findIndex(
      (player) => player.sessionId === state.viewerSessionId,
    );
    return index >= 0 ? index + 1 : null;
  }, [state.leaderboard, state.viewerSessionId]);
  const canArm = state.status === 'idle' || state.status === 'completed';
  const canStartNow = state.status === 'arming';
  const canPause =
    state.status === 'arming' || state.status === 'live' || state.status === 'paused';
  const canEnd = state.status === 'live' || state.status === 'paused';
  const timeLabel =
    state.status === 'arming'
      ? 'Starts in'
      : state.status === 'live'
        ? 'Time left'
        : state.status === 'paused'
          ? 'Paused at'
          : 'Timer';
  const viewerReady = viewer?.ready ?? false;
  const readyDisabled =
    viewerReady ||
    (state.status !== 'arming' && state.status !== 'live') ||
    !state.multiplayerSupported;

  return (
    <div
      className={cn(
        'pointer-events-auto absolute right-4 top-4 z-30 w-[min(23rem,calc(100%-2rem))] rounded-lg border border-white/50 bg-white/92 p-3 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/86',
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
            <Badge variant={state.status === 'live' ? 'default' : 'outline'}>
              {statusLabel(state.status)}
            </Badge>
            <Badge variant="outline">{modeLabel(state.mode)}</Badge>
            {state.viewerIsLate ? <Badge variant="secondary">Late join</Badge> : null}
            <Badge variant="outline">
              <Users />
              {state.participantCount}
            </Badge>
          </div>
        </div>
        <div className="rounded-md bg-violet-50 px-2 py-1 text-right text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">
          Round {state.roundNumber || 0}
        </div>
      </div>

      {!state.multiplayerSupported ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Waiting for the game bridge. Older game widgets may not support multiplayer events.
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border bg-muted/25 px-2 py-1.5">
          <div className="text-muted-foreground">Ready</div>
          <div className="font-semibold tabular-nums">
            {state.readyCount}/{state.eligibleCount}
          </div>
        </div>
        <div className="rounded-md border bg-muted/25 px-2 py-1.5">
          <div className="text-muted-foreground">Done</div>
          <div className="font-semibold tabular-nums">
            {state.completedCount}/{state.eligibleCount}
          </div>
        </div>
        <div className="rounded-md border bg-muted/25 px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3" />
            {timeLabel}
          </div>
          <div className="font-mono font-semibold tabular-nums">
            {formatRemaining(state.phaseRemainingMs)}
          </div>
        </div>
      </div>

      {state.viewerCanManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canArm ? (
            <Button type="button" size="sm" onClick={() => void onTeacherAction('start_round')}>
              <Flag className="size-4" />
              Arm round
            </Button>
          ) : null}
          {canStartNow ? (
            <Button type="button" size="sm" onClick={() => void onTeacherAction('start_now')}>
              <Play className="size-4" />
              Start now
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canPause}
            onClick={() => void onTeacherAction(state.status === 'paused' ? 'resume' : 'pause')}
          >
            {state.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
            {state.status === 'paused' ? 'Resume' : 'Pause'}
          </Button>
          {canEnd ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onTeacherAction('complete')}
            >
              End
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void onTeacherAction('reset')}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
          <div className="flex flex-wrap gap-1.5">
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
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/25 px-3 py-2">
          <div className="min-w-0 text-xs">
            <p className="font-semibold">
              {viewer?.displayName ?? 'Student'}
              {state.viewerIsLate ? ' · late' : ''}
            </p>
            <p className="text-muted-foreground">
              Score {viewer?.score ?? 0} · Progress {viewer?.progress ?? 0}%
              {viewerRank ? ` · Rank ${viewerRank}` : ''}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={viewerReady ? 'secondary' : 'outline'}
            disabled={readyDisabled}
            onClick={() => void onStudentReady()}
          >
            {viewerReady ? 'Ready' : 'Mark ready'}
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
                  {player.late ? ' · late' : ''}
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
        <Collapsible open={controlOpen} onOpenChange={setControlOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="mt-3 w-full justify-between">
              Shared control
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {controller?.displayName ?? 'None'}
                <ChevronDown className="size-4" />
              </span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 flex flex-wrap gap-1.5 rounded-md border bg-muted/20 p-2">
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
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
