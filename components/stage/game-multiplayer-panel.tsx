'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
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
  return status.charAt(0).toUpperCase() + status.slice(1);
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
  const [collapsed, setCollapsed] = useState(false);
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
  const readyCount = reviewParticipants.filter((participant) => participant.ready).length;
  const completedCount = reviewParticipants.filter((participant) => participant.completed).length;
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
  const hostBusy = pendingAction !== null;
  const canPause = state.status === 'live' || state.status === 'paused';
  const canComplete = state.status === 'live' || state.status === 'paused';
  const startRoundLabel =
    state.status === 'completed' && state.roundNumber > 0 ? 'Start next round' : 'Start round';
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mobileQuery = window.matchMedia('(max-width: 640px)');
    const syncCollapsedState = () => {
      setCollapsed(mobileQuery.matches);
    };

    syncCollapsedState();
    mobileQuery.addEventListener('change', syncCollapsedState);
    return () => mobileQuery.removeEventListener('change', syncCollapsedState);
  }, []);

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

  const panel = (
    <div
      className={cn(
        'pointer-events-auto fixed bottom-3 left-3 z-[200] w-[min(22rem,calc(100%-1.5rem))] overflow-hidden rounded-lg border border-white/55 bg-white/92 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/88 sm:bottom-4 sm:left-4 sm:w-[22rem]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 p-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-200">
            <Gamepad2 className="size-4" />
            Multiplayer game
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{statusLabel(state.status)}</Badge>
            <Badge variant="outline">{modeLabel(state.mode)}</Badge>
            <Badge variant="outline" title={`${activeParticipants.length} active players`}>
              <Users />
              {activeParticipants.length}
              {inactiveParticipants.length > 0 ? `/${state.participants.length}` : ''}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="rounded-lg bg-violet-50 px-2 py-1 text-right text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">
            Round {state.roundNumber || 0}
          </div>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={collapsed ? 'Expand multiplayer panel' : 'Collapse multiplayer panel'}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>
        </div>
      </div>

      {!collapsed ? (
        <div className="max-h-[min(72vh,28rem)] overflow-y-auto px-3 pb-3">
          {!state.multiplayerSupported ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              Waiting for a student game bridge. Older game widgets may not support multiplayer
              events.
            </p>
          ) : null}

          {actionError ? (
            <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {actionError}
            </p>
          ) : null}

          {state.viewerCanManage ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={hostBusy}
                onClick={() => void runTeacherAction('start_round')}
              >
                {pendingAction === 'start_round' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {startRoundLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={hostBusy || !canPause}
                onClick={() =>
                  void runTeacherAction(state.status === 'paused' ? 'resume' : 'pause')
                }
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={hostBusy || !canComplete}
                onClick={() => void runTeacherAction('complete')}
              >
                {pendingAction === 'complete' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Complete
              </Button>
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
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/25 px-3 py-2">
              <div className="min-w-0 text-xs">
                <p className="truncate font-semibold">{viewer?.displayName ?? 'Student'}</p>
                <p className="text-muted-foreground">
                  Score {viewer?.score ?? 0} · Progress {viewer?.progress ?? 0}%
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onStudentReady()}
              >
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
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-lg bg-muted/35 px-2 py-1.5 text-xs',
                      player.active === false && 'opacity-60',
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {index + 1}. {player.displayName}
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
                    {completedCount}/{reviewParticipants.length}
                  </dd>
                </div>
                <div className="rounded-md bg-white/80 px-2 py-1.5 dark:bg-slate-950/50">
                  <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Ready
                  </dt>
                  <dd className="font-mono font-semibold tabular-nums">
                    {readyCount}/{reviewParticipants.length}
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
            <div className="mt-3 flex flex-wrap gap-1.5">
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
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return portalRoot ? createPortal(panel, portalRoot) : panel;
}
