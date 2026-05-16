'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ClipboardCheck,
  Flag,
  Gamepad2,
  Loader2,
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
  ClassroomGameSessionPlayer,
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

function averageProgress(players: ClassroomGameSessionPlayer[]) {
  if (players.length === 0) return 0;
  const total = players.reduce((sum, player) => sum + player.progress, 0);
  return Math.round(total / players.length);
}

export function GameMultiplayerPanel({
  className,
  state,
  onTeacherAction,
  onStudentReady,
}: GameMultiplayerPanelProps) {
  const [controlOpen, setControlOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ClassroomGameTeacherAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const viewer = state.players[state.viewerSessionId];
  const topPlayers = state.leaderboard.slice(0, 5);
  const activeParticipants = state.participants.filter(
    (participant) => participant.active !== false,
  );
  const inactiveParticipants = state.participants.filter(
    (participant) => participant.active === false,
  );
  const reviewParticipants = activeParticipants;
  const reviewAverageProgress = averageProgress(reviewParticipants);
  const topScore = state.leaderboard[0]?.score ?? 0;
  const followUpPlayers = reviewParticipants
    .filter((participant) => !participant.completed)
    .sort(
      (left, right) =>
        left.progress - right.progress ||
        left.score - right.score ||
        left.displayName.localeCompare(right.displayName),
    )
    .slice(0, 3);
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
  const hostBusy = pendingAction !== null;

  const runTeacherAction = async (
    action: ClassroomGameTeacherAction,
    body?: { mode?: ClassroomGameSessionMode; targetSessionId?: string },
  ) => {
    if (hostBusy) return;
    setPendingAction(action);
    setActionError(null);
    try {
      await onTeacherAction(action, body);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to update multiplayer game session.',
      );
    } finally {
      setPendingAction(null);
    }
  };

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
              {activeParticipants.length}
              {inactiveParticipants.length > 0 ? `/${state.participants.length}` : ''}
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

      {actionError ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actionError}
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
            <Button
              type="button"
              size="sm"
              disabled={hostBusy}
              onClick={() => void runTeacherAction('start_round')}
            >
              {pendingAction === 'start_round' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Flag className="size-4" />
              )}
              Arm round
            </Button>
          ) : null}
          {canStartNow ? (
            <Button
              type="button"
              size="sm"
              disabled={hostBusy}
              onClick={() => void runTeacherAction('start_now')}
            >
              {pendingAction === 'start_now' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Start now
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={hostBusy || !canPause}
            onClick={() => void runTeacherAction(state.status === 'paused' ? 'resume' : 'pause')}
          >
            {pendingAction === 'pause' || pendingAction === 'resume' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : state.status === 'paused' ? (
              <Play className="size-4" />
            ) : (
              <Pause className="size-4" />
            )}
            {state.status === 'paused' ? 'Resume' : 'Pause'}
          </Button>
          {canEnd ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hostBusy}
              onClick={() => void runTeacherAction('complete')}
            >
              {pendingAction === 'complete' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              End
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={hostBusy}
            onClick={() => void runTeacherAction('reset')}
          >
            {pendingAction === 'reset' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Reset
          </Button>
          <div className="flex flex-wrap gap-1.5">
            {(['both', 'leaderboard', 'shared-control'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={state.mode === mode ? 'default' : 'outline'}
                disabled={hostBusy}
                onClick={() => void runTeacherAction('set_mode', { mode })}
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
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg bg-muted/35 px-2 py-1.5 text-xs',
                  player.active === false && 'opacity-60',
                )}
              >
                <span className="min-w-0 truncate">
                  {index + 1}. {player.displayName}
                  {player.late ? ' · late' : ''}
                  {controller?.sessionId === player.sessionId ? ' · controller' : ''}
                  {player.active === false ? ' · inactive' : ''}
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
        <div
          data-testid="multiplayer-round-review"
          className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50/80 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/55"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
              <ClipboardCheck className="size-3.5" />
              Round review
            </div>
            <Badge variant="outline">
              {state.status === 'completed' ? 'Ready to debrief' : 'Live snapshot'}
            </Badge>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded-md bg-white/80 px-2 py-1.5 dark:bg-slate-950/50">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Completed
              </dt>
              <dd className="font-mono font-semibold tabular-nums">
                {state.completedCount}/{state.eligibleCount}
              </dd>
            </div>
            <div className="rounded-md bg-white/80 px-2 py-1.5 dark:bg-slate-950/50">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Ready</dt>
              <dd className="font-mono font-semibold tabular-nums">
                {state.readyCount}/{state.eligibleCount}
              </dd>
            </div>
            <div className="rounded-md bg-white/80 px-2 py-1.5 dark:bg-slate-950/50">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Avg progress
              </dt>
              <dd className="font-mono font-semibold tabular-nums">{reviewAverageProgress}%</dd>
            </div>
            <div className="rounded-md bg-white/80 px-2 py-1.5 dark:bg-slate-950/50">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Top score
              </dt>
              <dd className="font-mono font-semibold tabular-nums">{topScore}</dd>
            </div>
          </dl>
          <div className="mt-2 rounded-md bg-white/80 px-2 py-1.5 dark:bg-slate-950/50">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Follow-up</p>
            <p className="mt-0.5 text-muted-foreground">
              {followUpPlayers.length > 0
                ? followUpPlayers.map((player) => player.displayName).join(', ')
                : 'No follow-up needed.'}
            </p>
          </div>
        </div>
      ) : null}

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
                  aria-label={
                    participant.active === false
                      ? `Inactive player ${participant.displayName}`
                      : `Grant control to ${participant.displayName}`
                  }
                  disabled={hostBusy || participant.active === false}
                  onClick={() =>
                    void runTeacherAction('assign_controller', {
                      targetSessionId: participant.sessionId,
                    })
                  }
                >
                  <span className="max-w-28 truncate">{participant.displayName}</span>
                </Button>
              ))}
              {state.controllerSessionId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={hostBusy}
                  onClick={() => void runTeacherAction('clear_controller')}
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
