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
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/hooks/use-i18n';
import type {
  ClassroomCollaborationAction,
  ClassroomCollaborationStatePayload,
} from '@/lib/types/classroom-collaboration';
import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type {
  MiroFishCreationJobStatus,
  MiroFishCreationPlanRequest,
  MiroFishCreationSpec,
} from '@/lib/types/mirofish-authoring';
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
  readonly authoringAvailable?: boolean;
  readonly classroomContext?: {
    stageName?: string;
    currentSceneId?: string;
    currentSceneTitle?: string;
    currentSceneType?: string;
  };
  readonly onAttach: (input: {
    simulationId: string;
    reportId?: string;
    defaultSurface: 'lesson' | 'simulation';
    collaborationMode?: SharedSimulationCollaborationMode;
  }) => Promise<void>;
  readonly onGeneratePlan?: (
    input: MiroFishCreationPlanRequest,
  ) => Promise<{ spec: MiroFishCreationSpec; promptPreview: string }>;
  readonly onCreateWithAI?: (input: {
    spec: MiroFishCreationSpec;
  }) => Promise<{ jobId: string }>;
  readonly onPollCreateJob?: (jobId: string) => Promise<{
    status: MiroFishCreationJobStatus;
    error?: string;
    sharedSimulation?: SharedSimulation;
  }>;
  readonly onGrantControl: (targetSessionId: string, leaseMinutes: number) => Promise<void>;
  readonly onRevokeControl: () => Promise<void>;
  readonly onCollaborationAction?: (input: {
    action: ClassroomCollaborationAction;
    targetSessionId?: string;
  }) => Promise<void>;
}

type MiroFishManagerMode = 'attach' | 'create';

function formatListField(value: string[]) {
  return value.join('\n');
}

function parseListField(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function MiroFishManagerDialog({
  open,
  onOpenChange,
  sharedSimulation,
  participants,
  collaboration,
  multiUserEnabled = false,
  authoringAvailable = false,
  classroomContext,
  onAttach,
  onGeneratePlan,
  onCreateWithAI,
  onPollCreateJob,
  onGrantControl,
  onRevokeControl,
  onCollaborationAction,
}: MiroFishManagerDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<MiroFishManagerMode>('attach');
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

  const [goal, setGoal] = useState('');
  const [activityType, setActivityType] =
    useState<MiroFishCreationPlanRequest['activityType']>('simulation');
  const [targetAudience, setTargetAudience] = useState('');
  const [includeReport, setIncludeReport] = useState(false);
  const [createDefaultSurface, setCreateDefaultSurface] =
    useState<MiroFishCreationSpec['defaultSurface']>('simulation');
  const [createCollaborationMode, setCreateCollaborationMode] =
    useState<MiroFishCreationSpec['collaborationMode']>('single-controller');
  const [generatedSpec, setGeneratedSpec] = useState<MiroFishCreationSpec | null>(null);
  const [promptPreview, setPromptPreview] = useState('');
  const [createJobId, setCreateJobId] = useState<string | null>(null);
  const [creationStatus, setCreationStatus] = useState<MiroFishCreationJobStatus | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusyAction, setCreateBusyAction] = useState<'plan' | 'create' | 'poll' | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setMode('attach');
    setSimulationId(sharedSimulation?.simulationId ?? '');
    setReportId(sharedSimulation?.reportId ?? '');
    setDefaultSurface(sharedSimulation?.activeSurface === 'simulation' ? 'simulation' : 'lesson');
    setCollaborationMode(sharedSimulation?.collaborationMode ?? 'single-controller');
    setLeaseMinutes(10);
    setAttachError(null);

    setGoal('');
    setActivityType('simulation');
    setTargetAudience('');
    setIncludeReport(Boolean(sharedSimulation?.reportId));
    setCreateDefaultSurface(
      sharedSimulation?.activeSurface === 'simulation' ? 'simulation' : 'lesson',
    );
    setCreateCollaborationMode(
      multiUserEnabled
        ? (sharedSimulation?.collaborationMode ?? 'single-controller')
        : 'single-controller',
    );
    setGeneratedSpec(null);
    setPromptPreview('');
    setCreateJobId(null);
    setCreationStatus(null);
    setCreateError(null);
    setCreateBusyAction(null);
  }, [open, sharedSimulation, multiUserEnabled]);

  useEffect(() => {
    if (!authoringAvailable && mode === 'create') {
      setMode('attach');
    }
  }, [authoringAvailable, mode]);

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

  const plannedSurface =
    sharedSimulation?.activeSurface ?? (mode === 'create' ? createDefaultSurface : defaultSurface);
  const plannedCollaborationMode = mode === 'create' ? createCollaborationMode : collaborationMode;
  const isMultiUser = plannedCollaborationMode === 'multi-user';
  const leaseCountdown = formatLeaseCountdown(sharedSimulation?.controlLeaseExpiresAt, leaseNowMs);

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

  const creationStatusLabel =
    creationStatus === 'queued'
      ? t('classroom.mirofish.createProgressQueued')
      : creationStatus === 'running'
        ? t('classroom.mirofish.createProgressRunning')
        : creationStatus === 'ready'
          ? t('classroom.mirofish.createProgressReady')
          : creationStatus === 'failed'
            ? t('classroom.mirofish.createProgressFailed')
            : null;

  function updateSpec(
    next: MiroFishCreationSpec | ((current: MiroFishCreationSpec) => MiroFishCreationSpec),
  ) {
    setGeneratedSpec((current) => {
      if (!current) {
        return current;
      }
      return typeof next === 'function' ? next(current) : next;
    });
    setCreateError(null);
  }

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
        error instanceof Error
          ? error.message
          : t('classroom.mirofish.collaborationUpdateFailed'),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGeneratePlan() {
    if (!onGeneratePlan) {
      return;
    }

    setCreateBusyAction('plan');
    setCreateError(null);
    try {
      const result = await onGeneratePlan({
        goal: goal.trim(),
        activityType,
        targetAudience: targetAudience.trim(),
        currentSceneId: classroomContext?.currentSceneId,
        includeReport,
        defaultSurface: createDefaultSurface,
        collaborationMode: createCollaborationMode,
      });
      setGeneratedSpec(result.spec);
      setPromptPreview(result.promptPreview);
      setCreationStatus(null);
      setCreateJobId(null);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : t('classroom.mirofish.createPlanFailed'),
      );
    } finally {
      setCreateBusyAction(null);
    }
  }

  async function pollCreateJob(jobId: string) {
    if (!onPollCreateJob) {
      return;
    }

    setCreateBusyAction('poll');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await onPollCreateJob(jobId);
      setCreationStatus(result.status);

      if (result.status === 'ready' && result.sharedSimulation) {
        toast.success(t('classroom.mirofish.aiAttachSuccess'));
        onOpenChange(false);
        setCreateBusyAction(null);
        return;
      }

      if (result.status === 'failed') {
        throw new Error(result.error || t('classroom.mirofish.createFailed'));
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    throw new Error(t('classroom.mirofish.createFailed'));
  }

  async function handleCreateAndAttach() {
    if (!generatedSpec || !onCreateWithAI) {
      return;
    }

    setCreateBusyAction('create');
    setCreateError(null);
    try {
      const { jobId } = await onCreateWithAI({
        spec: generatedSpec,
      });
      setCreateJobId(jobId);
      setCreationStatus('queued');
      await pollCreateJob(jobId);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('classroom.mirofish.createFailed'));
      setCreationStatus('failed');
    } finally {
      setCreateBusyAction(null);
    }
  }

  const activeSurfaceLabel = (surface: PresentationSurface | undefined) => {
    switch (surface) {
      case 'simulation':
        return t('classroom.mirofish.surfaceSimulation');
      case 'report':
        return t('classroom.mirofish.surfaceReport');
      default:
        return t('classroom.mirofish.surfaceLesson');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('classroom.mirofish.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('classroom.mirofish.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'attach' ? 'default' : 'outline'}
                onClick={() => setMode('attach')}
              >
                {t('classroom.mirofish.modeAttach')}
              </Button>
              {authoringAvailable ? (
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'create' ? 'default' : 'outline'}
                  onClick={() => setMode('create')}
                >
                  {t('classroom.mirofish.modeCreate')}
                </Button>
              ) : null}
            </div>

            {mode === 'attach' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="mirofish-simulation-id">
                    {t('classroom.mirofish.simulationIdLabel')}
                  </Label>
                  <Input
                    id="mirofish-simulation-id"
                    value={simulationId}
                    onChange={(event) => {
                      setSimulationId(event.target.value);
                      setAttachError(null);
                    }}
                    placeholder={t('classroom.mirofish.simulationIdPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mirofish-report-id">{t('classroom.mirofish.reportIdLabel')}</Label>
                  <Input
                    id="mirofish-report-id"
                    value={reportId}
                    onChange={(event) => {
                      setReportId(event.target.value);
                      setAttachError(null);
                    }}
                    placeholder={t('classroom.mirofish.reportIdPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('classroom.mirofish.defaultPaneLabel')}</Label>
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
                        {surface === 'lesson'
                          ? t('classroom.mirofish.surfaceLesson')
                          : t('classroom.mirofish.surfaceSimulation')}
                      </button>
                    ))}
                  </div>
                </div>

                {multiUserEnabled ? (
                  <div className="space-y-2">
                    <Label>{t('classroom.mirofish.interactionModeLabel')}</Label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          {
                            value: 'single-controller',
                            label: t('classroom.mirofish.singleController'),
                          },
                          { value: 'multi-user', label: t('classroom.mirofish.multiUser') },
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
                ) : null}

                {!isMultiUser ? (
                  <div className="space-y-2">
                    <Label>{t('classroom.mirofish.controlLeaseLabel')}</Label>
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
                          {t('classroom.mirofish.leaseMinutes', { count: minutes })}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

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
                        error instanceof Error ? error.message : t('classroom.mirofish.attachFailed'),
                      );
                    } finally {
                      setBusyAction(null);
                    }
                  }}
                >
                  {busyAction === 'attach' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {sharedSimulation
                    ? t('classroom.mirofish.updateAttachButton')
                    : t('classroom.mirofish.attachButton')}
                </Button>
                {attachError ? (
                  <p className="text-sm text-rose-600 dark:text-rose-400">{attachError}</p>
                ) : null}
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {t('classroom.mirofish.contextTitle')}
                  </div>
                  <div className="space-y-1 text-sm text-slate-500 dark:text-slate-400">
                    <p>
                      {t('classroom.mirofish.contextStage')}:&nbsp;
                      {classroomContext?.stageName || t('classroom.mirofish.contextUnavailable')}
                    </p>
                    <p>
                      {t('classroom.mirofish.contextScene')}:&nbsp;
                      {classroomContext?.currentSceneTitle || t('classroom.mirofish.contextUnavailable')}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mirofish-goal">{t('classroom.mirofish.goalLabel')}</Label>
                  <Textarea
                    id="mirofish-goal"
                    value={goal}
                    onChange={(event) => {
                      setGoal(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder={t('classroom.mirofish.goalPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('classroom.mirofish.activityTypeLabel')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['simulation', t('classroom.mirofish.activityTypeSimulation')],
                        ['investigation', t('classroom.mirofish.activityTypeInvestigation')],
                        ['workspace', t('classroom.mirofish.activityTypeWorkspace')],
                        ['concept-map', t('classroom.mirofish.activityTypeConceptMap')],
                        ['data-story', t('classroom.mirofish.activityTypeDataStory')],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setActivityType(value);
                          setCreateError(null);
                        }}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          activityType === value
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mirofish-target-audience">
                    {t('classroom.mirofish.targetAudienceLabel')}
                  </Label>
                  <Input
                    id="mirofish-target-audience"
                    value={targetAudience}
                    onChange={(event) => {
                      setTargetAudience(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder={t('classroom.mirofish.targetAudiencePlaceholder')}
                  />
                </div>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={includeReport}
                      onChange={(event) => setIncludeReport(event.target.checked)}
                    />
                    <span>{t('classroom.mirofish.includeReportLabel')}</span>
                  </label>
                </div>

                <div className="space-y-2">
                  <Label>{t('classroom.mirofish.defaultPaneLabel')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {(['lesson', 'simulation'] as const).map((surface) => (
                      <button
                        key={surface}
                        type="button"
                        onClick={() => setCreateDefaultSurface(surface)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          createDefaultSurface === surface
                            ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                      >
                        {surface === 'lesson'
                          ? t('classroom.mirofish.surfaceLesson')
                          : t('classroom.mirofish.surfaceSimulation')}
                      </button>
                    ))}
                  </div>
                </div>

                {multiUserEnabled ? (
                  <div className="space-y-2">
                    <Label>{t('classroom.mirofish.interactionModeLabel')}</Label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          {
                            value: 'single-controller',
                            label: t('classroom.mirofish.singleController'),
                          },
                          { value: 'multi-user', label: t('classroom.mirofish.multiUser') },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setCreateCollaborationMode(option.value)}
                          className={`rounded-full border px-3 py-1.5 text-sm transition ${
                            createCollaborationMode === option.value
                              ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={
                      createBusyAction !== null || goal.trim().length < 12 || targetAudience.trim().length < 2
                    }
                    onClick={() => {
                      void handleGeneratePlan();
                    }}
                  >
                    {createBusyAction === 'plan' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {generatedSpec
                      ? t('classroom.mirofish.regeneratePlanButton')
                      : t('classroom.mirofish.generatePlanButton')}
                  </Button>
                </div>

                {generatedSpec ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {t('classroom.mirofish.generatedPlanTitle')}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mirofish-plan-title">
                        {t('classroom.mirofish.planTitleLabel')}
                      </Label>
                      <Input
                        id="mirofish-plan-title"
                        value={generatedSpec.title}
                        onChange={(event) =>
                          updateSpec((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mirofish-plan-instructions">
                        {t('classroom.mirofish.teacherInstructionsLabel')}
                      </Label>
                      <Textarea
                        id="mirofish-plan-instructions"
                        value={formatListField(generatedSpec.teacherInstructions)}
                        onChange={(event) =>
                          updateSpec((current) => ({
                            ...current,
                            teacherInstructions: parseListField(event.target.value),
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mirofish-plan-student-tasks">
                        {t('classroom.mirofish.studentTasksLabel')}
                      </Label>
                      <Textarea
                        id="mirofish-plan-student-tasks"
                        value={formatListField(generatedSpec.studentTasks)}
                        onChange={(event) =>
                          updateSpec((current) => ({
                            ...current,
                            studentTasks: parseListField(event.target.value),
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mirofish-plan-success-checks">
                        {t('classroom.mirofish.successChecksLabel')}
                      </Label>
                      <Textarea
                        id="mirofish-plan-success-checks"
                        value={formatListField(generatedSpec.successChecks)}
                        onChange={(event) =>
                          updateSpec((current) => ({
                            ...current,
                            successChecks: parseListField(event.target.value),
                          }))
                        }
                      />
                    </div>

                    {includeReport ? (
                      <div className="space-y-2">
                        <Label htmlFor="mirofish-plan-report-focus">
                          {t('classroom.mirofish.reportFocusLabel')}
                        </Label>
                        <Textarea
                          id="mirofish-plan-report-focus"
                          value={formatListField(generatedSpec.reportFocus)}
                          onChange={(event) =>
                            updateSpec((current) => ({
                              ...current,
                              reportFocus: parseListField(event.target.value),
                            }))
                          }
                        />
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <Label htmlFor="mirofish-plan-notes">
                        {t('classroom.mirofish.authoringNotesLabel')}
                      </Label>
                      <Textarea
                        id="mirofish-plan-notes"
                        value={generatedSpec.authoringNotes ?? ''}
                        onChange={(event) =>
                          updateSpec((current) => ({
                            ...current,
                            authoringNotes: event.target.value,
                          }))
                        }
                        placeholder={t('classroom.mirofish.authoringNotesPlaceholder')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="mirofish-plan-preview">
                        {t('classroom.mirofish.promptPreviewLabel')}
                      </Label>
                      <Textarea id="mirofish-plan-preview" value={promptPreview} readOnly />
                    </div>

                    <Button
                      type="button"
                      disabled={createBusyAction !== null}
                      onClick={() => {
                        void handleCreateAndAttach();
                      }}
                    >
                      {createBusyAction === 'create' || createBusyAction === 'poll' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t('classroom.mirofish.createAndAttachButton')}
                    </Button>
                  </div>
                ) : null}

                <div aria-live="polite" className="min-h-5 text-sm text-slate-500 dark:text-slate-400">
                  {creationStatusLabel ||
                  (createJobId ? `${t('classroom.mirofish.jobIdLabel')}: ${createJobId}` : null)}
                </div>
                {createError ? (
                  <p className="text-sm text-rose-600 dark:text-rose-400">{createError}</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <Presentation className="h-4 w-4" />
                {t('classroom.mirofish.sharedPaneStatusTitle')}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {t('classroom.mirofish.statusSurface')}: {activeSurfaceLabel(plannedSurface)}
                </Badge>
                <Badge variant="outline">
                  {t('classroom.mirofish.statusMode')}:{' '}
                  {isMultiUser
                    ? t('classroom.mirofish.multiUser')
                    : t('classroom.mirofish.singleController')}
                </Badge>
                <Badge variant="outline">
                  {t('classroom.mirofish.statusState')}:{' '}
                  {sharedSimulation?.status ?? t('classroom.mirofish.notAttached')}
                </Badge>
                {isMultiUser ? (
                  <Badge variant="outline">
                    {t('classroom.mirofish.statusCollaboration')}:{' '}
                    {collaboration?.collaborationState ??
                      sharedSimulation?.collaborationState ??
                      t('classroom.mirofish.inactive')}
                  </Badge>
                ) : null}
              </div>
              {!isMultiUser ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {t('classroom.mirofish.statusControl')}:{' '}
                      {sharedSimulation ? controllerLabel : t('classroom.mirofish.teacher')}
                    </Badge>
                  </div>
                  {sharedSimulation?.controlLeaseExpiresAt ? (
                    <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <p>
                        {t('classroom.mirofish.leaseExpiresAt', {
                          time: new Date(sharedSimulation.controlLeaseExpiresAt).toLocaleTimeString(),
                        })}
                      </p>
                      {leaseCountdown ? (
                        <p>{t('classroom.mirofish.leaseCountdown', { countdown: leaseCountdown })}</p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <p>
                    {t('classroom.mirofish.participantsCount', {
                      count: collaboration?.participantCount ?? 0,
                    })}
                  </p>
                  {collaboration?.spotlightSessionId ? (
                    <p>{t('classroom.mirofish.spotlightActive')}</p>
                  ) : null}
                </div>
              )}
            </div>

            {isMultiUser ? (
              <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Snowflake className="h-4 w-4" />
                  {t('classroom.mirofish.collaborationControlsTitle')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['open', t('classroom.mirofish.collaborationOpen')],
                      ['freeze', t('classroom.mirofish.collaborationFreeze')],
                      ['unfreeze', t('classroom.mirofish.collaborationUnfreeze')],
                      ['close', t('classroom.mirofish.collaborationClose')],
                      ['reset_session', t('classroom.mirofish.collaborationReset')],
                    ] as const
                  ).map(([action, label]) => (
                    <Button
                      key={action}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyAction !== null}
                      onClick={() => {
                        void runCollaborationAction(action as ClassroomCollaborationAction);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <UserRound className="h-4 w-4" />
                    {t('classroom.mirofish.liveRosterTitle')}
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
                              ? [{ key: 'spotlight', label: t('classroom.mirofish.spotlightChip') }]
                              : []),
                            ...(participant.isRemoved
                              ? [
                                  {
                                    key: 'removed',
                                    label: t('classroom.mirofish.removedChip'),
                                    variant: 'outline' as const,
                                  },
                                ]
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
                                    ? t('classroom.mirofish.clearSpotlightAria', {
                                        name: participant.displayName,
                                      })
                                    : t('classroom.mirofish.spotlightAria', {
                                        name: participant.displayName,
                                      })
                                }
                                onClick={() => {
                                  void runCollaborationAction(
                                    participant.isSpotlighted ? 'clear_spotlight' : 'spotlight',
                                    participant.isSpotlighted ? undefined : participant.sessionId,
                                  );
                                }}
                              >
                                <Sparkles className="h-4 w-4" />
                                {participant.isSpotlighted
                                  ? t('classroom.mirofish.clearSpotlightButton')
                                  : t('classroom.mirofish.spotlightButton')}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busyAction !== null || participant.isRemoved}
                                aria-label={t('classroom.mirofish.removeParticipantAria', {
                                  name: participant.displayName,
                                })}
                                onClick={() => {
                                  void runCollaborationAction(
                                    'remove_participant',
                                    participant.sessionId,
                                  );
                                }}
                              >
                                {t('classroom.mirofish.removeButton')}
                              </Button>
                            </div>
                          }
                        />
                      );
                    })
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {t('classroom.mirofish.liveRosterEmpty')}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <UserRound className="h-4 w-4" />
                  {t('classroom.mirofish.activeStudentViewersTitle')}
                </div>
                <div className="space-y-2">
                  {participants.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {t('classroom.mirofish.activeStudentViewersEmpty')}
                    </p>
                  ) : (
                    sortedSingleControllerParticipants.map((participant) => {
                      const activityLabel = getParticipantActivityLabel(participant.lastSeenAt);
                      const statusLabel =
                        participant.isController && leaseCountdown
                          ? `${activityLabel.label} • ${t('classroom.mirofish.leaseShort', {
                              countdown: leaseCountdown,
                            })}`
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
                                    label: t('classroom.mirofish.controllerChip'),
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
                                  ? t('classroom.mirofish.currentControllerAria', {
                                      name: participant.displayName,
                                    })
                                  : t('classroom.mirofish.grantControlAria', {
                                      name: participant.displayName,
                                    })
                              }
                              onClick={async () => {
                                setBusyAction('grant');
                                try {
                                  await onGrantControl(participant.sessionId, leaseMinutes);
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : t('classroom.mirofish.grantControlFailed'),
                                  );
                                } finally {
                                  setBusyAction(null);
                                }
                              }}
                            >
                              {busyAction === 'grant' && participant.isController ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : participant.isController ? (
                                t('classroom.mirofish.currentControllerButton')
                              ) : (
                                t('classroom.mirofish.grantControlButton')
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
                      : t('classroom.mirofish.revokeControlFailed'),
                  );
                } finally {
                  setBusyAction(null);
                }
              }}
            >
              {busyAction === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <Shield className="h-4 w-4" />
              {t('classroom.mirofish.returnControlButton')}
            </Button>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t('classroom.mirofish.multiUserFootnote')}
            </div>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('classroom.mirofish.closeButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
