'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Presentation, Shield, Snowflake, Sparkles, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  ClassroomCollaborationAction,
  ClassroomCollaborationStatePayload,
} from '@/lib/types/classroom-collaboration';
import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type {
  PresentationSurface,
  SharedSimulation,
  SharedSimulationCollaborationMode,
} from '@/lib/types/stage';
import { formatLeaseCountdown, getControllerDisplayName } from '@/lib/utils/classroom-presentation';
import { toast } from 'sonner';
import { ParticipantPresenceCard } from '@/components/participants/participant-presence-card';
import {
  getParticipantActivityLabel,
  sortParticipantsByPresence,
} from '@/lib/utils/participant-presence';

interface MiroFishManagerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sharedSimulation: SharedSimulation | null;
  readonly participants: ClassroomPresentationParticipant[];
  readonly collaboration: ClassroomCollaborationStatePayload | null;
  readonly multiUserEnabled?: boolean;
  readonly onAttach: (input: {
    simulationId: string;
    reportId?: string;
    defaultSurface: 'lesson' | 'simulation';
    collaborationMode?: SharedSimulationCollaborationMode;
  }) => Promise<void>;
  readonly onGrantControl: (targetSessionId: string, leaseMinutes: number) => Promise<void>;
  readonly onRevokeControl: () => Promise<void>;
  readonly onCollaborationAction?: (input: {
    action: ClassroomCollaborationAction;
    targetSessionId?: string;
  }) => Promise<void>;
}

export function MiroFishManagerDialog({
  open,
  onOpenChange,
  sharedSimulation,
  participants,
  collaboration,
  multiUserEnabled = false,
  onAttach,
  onGrantControl,
  onRevokeControl,
  onCollaborationAction,
}: MiroFishManagerDialogProps) {
  const [simulationId, setSimulationId] = useState('');
  const [reportId, setReportId] = useState('');
  const [defaultSurface, setDefaultSurface] = useState<'lesson' | 'simulation'>('lesson');
  const [collaborationMode, setCollaborationMode] =
    useState<SharedSimulationCollaborationMode>('single-controller');
  const [leaseMinutes, setLeaseMinutes] = useState(10);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    'attach' | 'grant' | 'revoke' | 'collaboration' | null
  >(null);
  const [leaseNowMs, setLeaseNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!open) {
      return;
    }

    setSimulationId(sharedSimulation?.simulationId ?? '');
    setReportId(sharedSimulation?.reportId ?? '');
    setDefaultSurface(sharedSimulation?.activeSurface === 'simulation' ? 'simulation' : 'lesson');
    setCollaborationMode(sharedSimulation?.collaborationMode ?? 'single-controller');
    setLeaseMinutes(10);
    setAttachError(null);
  }, [open, sharedSimulation]);

  const controllerLabel = useMemo(() => {
    return getControllerDisplayName(sharedSimulation, participants);
  }, [participants, sharedSimulation]);

  useEffect(() => {
    if (!open || !sharedSimulation?.controlLeaseExpiresAt) {
      return;
    }

    setLeaseNowMs(Date.now());
    const interval = window.setInterval(() => {
      setLeaseNowMs(Date.now());
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [open, sharedSimulation?.controlLeaseExpiresAt]);

  const activeSurfaceLabel = (surface: PresentationSurface | undefined) => {
    switch (surface) {
      case 'simulation':
        return 'Simulation';
      case 'report':
        return 'Report';
      default:
        return 'Lesson';
    }
  };

  const leaseCountdown = formatLeaseCountdown(sharedSimulation?.controlLeaseExpiresAt, leaseNowMs);
  const isMultiUser = collaborationMode === 'multi-user';

  const sortedSingleControllerParticipants = useMemo(
    () =>
      sortParticipantsByPresence(participants, {
        getIsController: (participant) => Boolean(participant.isController),
      }),
    [participants],
  );

  const sortedCollaborationParticipants = useMemo(() => {
    if (!collaboration?.participants.length) {
      return [];
    }

    return sortParticipantsByPresence(collaboration.participants, {
      getIsController: () => false,
    });
  }, [collaboration?.participants]);

  async function runCollaborationAction(
    action: ClassroomCollaborationAction,
    targetSessionId?: string,
  ) {
    if (!onCollaborationAction) {
      return;
    }

    setBusyAction('collaboration');
    try {
      await onCollaborationAction({ action, targetSessionId });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update the collaboration session.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>MiroFish classroom sidecar</DialogTitle>
          <DialogDescription>
            Attach a prepared MiroFish simulation, choose the classroom pane defaults, and manage
            either lease-based control or live multi-user collaboration from one place.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="space-y-2">
              <Label htmlFor="mirofish-simulation-id">Simulation ID</Label>
              <Input
                id="mirofish-simulation-id"
                value={simulationId}
                onChange={(event) => {
                  setSimulationId(event.target.value);
                  setAttachError(null);
                }}
                placeholder="prepared-simulation-id"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mirofish-report-id">Report ID</Label>
              <Input
                id="mirofish-report-id"
                value={reportId}
                onChange={(event) => {
                  setReportId(event.target.value);
                  setAttachError(null);
                }}
                placeholder="optional-report-id"
              />
            </div>

            <div className="space-y-2">
              <Label>Default pane</Label>
              <div className="flex flex-wrap gap-2">
                {(['lesson', 'simulation'] as const).map((surface) => (
                  <button
                    key={surface}
                    type="button"
                    onClick={() => {
                      setDefaultSurface(surface);
                      setAttachError(null);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      defaultSurface === surface
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                    }`}
                  >
                    {surface === 'lesson' ? 'Lesson' : 'Simulation'}
                  </button>
                ))}
              </div>
            </div>

            {multiUserEnabled && (
              <div className="space-y-2">
                <Label>Interaction mode</Label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { value: 'single-controller', label: 'Single controller' },
                      { value: 'multi-user', label: 'Multi-user' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setCollaborationMode(option.value);
                        setAttachError(null);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        collaborationMode === option.value
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isMultiUser && (
              <div className="space-y-2">
                <Label>Control lease</Label>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 30].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setLeaseMinutes(minutes)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        leaseMinutes === minutes
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                      }`}
                    >
                      {minutes} minutes
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              disabled={busyAction !== null || !simulationId.trim()}
              onClick={async () => {
                setBusyAction('attach');
                try {
                  setAttachError(null);
                  await onAttach({
                    simulationId: simulationId.trim(),
                    reportId: reportId.trim() || undefined,
                    defaultSurface,
                    collaborationMode,
                  });
                } catch (error) {
                  setAttachError(
                    error instanceof Error ? error.message : 'Failed to attach MiroFish.',
                  );
                } finally {
                  setBusyAction(null);
                }
              }}
            >
              {busyAction === 'attach' && <Loader2 className="h-4 w-4 animate-spin" />}
              {sharedSimulation ? 'Update attached MiroFish' : 'Attach MiroFish'}
            </Button>
            {attachError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">{attachError}</p>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <Presentation className="h-4 w-4" />
                Shared pane status
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  Surface: {activeSurfaceLabel(sharedSimulation?.activeSurface)}
                </Badge>
                <Badge variant="outline">
                  Mode: {isMultiUser ? 'Multi-user' : 'Single controller'}
                </Badge>
                <Badge variant="outline">
                  Status: {sharedSimulation?.status ?? 'Not attached'}
                </Badge>
                {isMultiUser && (
                  <Badge variant="outline">
                    Collaboration:{' '}
                    {collaboration?.collaborationState ??
                      sharedSimulation?.collaborationState ??
                      'inactive'}
                  </Badge>
                )}
              </div>
              {!isMultiUser && (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      Control: {sharedSimulation ? controllerLabel : 'Teacher'}
                    </Badge>
                  </div>
                  {sharedSimulation?.controlLeaseExpiresAt && (
                    <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <p>
                        Student lease expires at{' '}
                        {new Date(sharedSimulation.controlLeaseExpiresAt).toLocaleTimeString()}.
                      </p>
                      {leaseCountdown && <p>Countdown: {leaseCountdown}</p>}
                    </div>
                  )}
                </>
              )}
              {isMultiUser && (
                <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p>Participants: {collaboration?.participantCount ?? 0}</p>
                  {collaboration?.spotlightSessionId && (
                    <p>Spotlight is active for one student session.</p>
                  )}
                </div>
              )}
            </div>

            {isMultiUser ? (
              <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Snowflake className="h-4 w-4" />
                  Collaboration controls
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void runCollaborationAction('open');
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void runCollaborationAction('freeze');
                    }}
                  >
                    Freeze
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void runCollaborationAction('unfreeze');
                    }}
                  >
                    Unfreeze
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void runCollaborationAction('close');
                    }}
                  >
                    Close
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyAction !== null}
                    onClick={() => {
                      void runCollaborationAction('reset_session');
                    }}
                  >
                    Reset session
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <UserRound className="h-4 w-4" />
                    Live roster
                  </div>
                  {sortedCollaborationParticipants.length ? (
                    sortedCollaborationParticipants.map((participant) => {
                      const activityLabel = getParticipantActivityLabel(participant.lastSeenAt);
                      return (
                        <ParticipantPresenceCard
                          key={participant.sessionId}
                          variant="compact-card"
                          name={participant.displayName}
                          status={activityLabel.state}
                          activityLabel={activityLabel.label}
                          chips={[
                            ...(participant.isSpotlighted
                              ? [{ key: 'spotlight', label: 'Spotlight' }]
                              : []),
                            ...(participant.isRemoved
                              ? [{ key: 'removed', label: 'Removed', variant: 'outline' as const }]
                              : []),
                          ]}
                          trailing={
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busyAction !== null || participant.isRemoved}
                                aria-label={
                                  participant.isSpotlighted
                                    ? `Clear spotlight for ${participant.displayName}`
                                    : `Spotlight ${participant.displayName}`
                                }
                                onClick={() => {
                                  void runCollaborationAction(
                                    participant.isSpotlighted ? 'clear_spotlight' : 'spotlight',
                                    participant.isSpotlighted ? undefined : participant.sessionId,
                                  );
                                }}
                              >
                                <Sparkles className="h-4 w-4" />
                                {participant.isSpotlighted ? 'Clear spotlight' : 'Spotlight'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busyAction !== null || participant.isRemoved}
                                aria-label={`Remove ${participant.displayName}`}
                                onClick={() => {
                                  void runCollaborationAction(
                                    'remove_participant',
                                    participant.sessionId,
                                  );
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          }
                        />
                      );
                    })
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Students will appear here once they join the classroom and open the shared
                      simulation.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <UserRound className="h-4 w-4" />
                  Active student viewers
                </div>
                <div className="space-y-2">
                  {participants.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Students will appear here once they join and start polling the classroom.
                    </p>
                  ) : (
                    sortedSingleControllerParticipants.map((participant) => {
                      const activityLabel = getParticipantActivityLabel(participant.lastSeenAt);
                      const statusLabel =
                        participant.isController && leaseCountdown
                          ? `${activityLabel.label} • Lease: ${leaseCountdown}`
                          : activityLabel.label;
                      return (
                        <ParticipantPresenceCard
                          key={participant.sessionId}
                          variant="compact-card"
                          name={participant.displayName}
                          status={activityLabel.state}
                          activityLabel={statusLabel}
                          chips={[
                            ...(participant.isController
                              ? [
                                  {
                                    key: 'controller',
                                    label: 'Controller',
                                    variant: 'default' as const,
                                  },
                                ]
                              : []),
                          ]}
                          trailing={
                            <Button
                              type="button"
                              size="sm"
                              variant={participant.isController ? 'secondary' : 'outline'}
                              disabled={busyAction !== null || !sharedSimulation}
                              aria-label={
                                participant.isController
                                  ? `${participant.displayName} currently controls the simulation`
                                  : `Grant control to ${participant.displayName}`
                              }
                              onClick={async () => {
                                setBusyAction('grant');
                                try {
                                  await onGrantControl(participant.sessionId, leaseMinutes);
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : 'Failed to grant control.',
                                  );
                                } finally {
                                  setBusyAction(null);
                                }
                              }}
                            >
                              {busyAction === 'grant' && participant.isController ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : participant.isController ? (
                                'Current controller'
                              ) : (
                                'Grant control'
                              )}
                            </Button>
                          }
                        />
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          {!isMultiUser ? (
            <Button
              type="button"
              variant="outline"
              disabled={busyAction !== null || !sharedSimulation}
              onClick={async () => {
                setBusyAction('revoke');
                try {
                  await onRevokeControl();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : 'Failed to return control to the teacher.',
                  );
                } finally {
                  setBusyAction(null);
                }
              }}
            >
              {busyAction === 'revoke' && <Loader2 className="h-4 w-4 animate-spin" />}
              <Shield className="h-4 w-4" />
              Return control to teacher
            </Button>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Multi-user classrooms keep the teacher in charge of pane switching while students
              collaborate live inside the shared simulation.
            </div>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
