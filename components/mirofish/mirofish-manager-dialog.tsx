'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Presentation, Shield, UserRound } from 'lucide-react';
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
import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type { PresentationSurface, SharedSimulation } from '@/lib/types/stage';
import { toast } from 'sonner';

interface MiroFishManagerDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly sharedSimulation: SharedSimulation | null;
  readonly participants: ClassroomPresentationParticipant[];
  readonly onAttach: (input: {
    simulationId: string;
    reportId?: string;
    defaultSurface: 'lesson' | 'simulation';
  }) => Promise<void>;
  readonly onGrantControl: (targetSessionId: string) => Promise<void>;
  readonly onRevokeControl: () => Promise<void>;
}

export function MiroFishManagerDialog({
  open,
  onOpenChange,
  sharedSimulation,
  participants,
  onAttach,
  onGrantControl,
  onRevokeControl,
}: MiroFishManagerDialogProps) {
  const [simulationId, setSimulationId] = useState('');
  const [reportId, setReportId] = useState('');
  const [defaultSurface, setDefaultSurface] = useState<'lesson' | 'simulation'>('lesson');
  const [busyAction, setBusyAction] = useState<'attach' | 'grant' | 'revoke' | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSimulationId(sharedSimulation?.simulationId ?? '');
    setReportId(sharedSimulation?.reportId ?? '');
    setDefaultSurface(sharedSimulation?.activeSurface === 'simulation' ? 'simulation' : 'lesson');
  }, [open, sharedSimulation]);

  const controllerLabel = useMemo(() => {
    if (!sharedSimulation) {
      return 'Teacher';
    }

    if (sharedSimulation.controllerRole === 'teacher') {
      return 'Teacher';
    }

    const controllerParticipant = participants.find(
      (participant) => participant.sessionId === sharedSimulation.controllerSessionId,
    );
    return controllerParticipant?.displayName || 'Student controller';
  }, [participants, sharedSimulation]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>MiroFish classroom sidecar</DialogTitle>
          <DialogDescription>
            Attach a prepared MiroFish simulation, choose the default pane, and hand control to one
            active student session when you need it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="space-y-2">
              <Label htmlFor="mirofish-simulation-id">Simulation ID</Label>
              <Input
                id="mirofish-simulation-id"
                value={simulationId}
                onChange={(event) => setSimulationId(event.target.value)}
                placeholder="prepared-simulation-id"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mirofish-report-id">Report ID</Label>
              <Input
                id="mirofish-report-id"
                value={reportId}
                onChange={(event) => setReportId(event.target.value)}
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
                    onClick={() => setDefaultSurface(surface)}
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

            <Button
              type="button"
              className="w-full"
              disabled={busyAction !== null || !simulationId.trim()}
              onClick={async () => {
                setBusyAction('attach');
                try {
                  await onAttach({
                    simulationId: simulationId.trim(),
                    reportId: reportId.trim() || undefined,
                    defaultSurface,
                  });
                } catch (error) {
                  toast.error(
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
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <Presentation className="h-4 w-4" />
                Shared pane status
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">Surface: {activeSurfaceLabel(sharedSimulation?.activeSurface)}</Badge>
                <Badge variant="outline">
                  Control: {sharedSimulation ? controllerLabel : 'Teacher'}
                </Badge>
                <Badge variant="outline">
                  Status: {sharedSimulation?.status ?? 'Not attached'}
                </Badge>
              </div>
              {sharedSimulation?.controlLeaseExpiresAt && (
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Student lease expires at{' '}
                  {new Date(sharedSimulation.controlLeaseExpiresAt).toLocaleTimeString()}.
                </p>
              )}
            </div>

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
                  participants.map((participant) => (
                    <div
                      key={participant.sessionId}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {participant.displayName}
                          </span>
                          {participant.isController && <Badge>Controller</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Last active {new Date(participant.lastSeenAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={participant.isController ? 'secondary' : 'outline'}
                        disabled={busyAction !== null || !sharedSimulation}
                        onClick={async () => {
                          setBusyAction('grant');
                          try {
                            await onGrantControl(participant.sessionId);
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : 'Failed to grant control.',
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
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="justify-between sm:justify-between">
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
                  error instanceof Error ? error.message : 'Failed to return control to the teacher.',
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
