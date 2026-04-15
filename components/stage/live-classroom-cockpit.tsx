'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  PanelTopClose,
  PanelTopOpen,
  Pause,
  Play,
  Presentation,
  Shield,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  Wand2,
  Waves,
  BookOpen,
  MonitorPlay,
  FileBarChart2,
  PenSquare,
  RotateCcw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ParticipantPresenceCard } from '@/components/participants/participant-presence-card';
import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type { PresentationSurface } from '@/lib/types/stage';
import type { LiveClassroomApprovalItem } from '@/lib/utils/live-classroom-cockpit';
import {
  getParticipantActivityLabel,
  sortParticipantsByPresence,
} from '@/lib/utils/participant-presence';
import { cn } from '@/lib/utils';

interface LiveClassroomCockpitProps {
  readonly className?: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly currentSceneTitle: string;
  readonly currentSceneNumber: number;
  readonly totalScenesCount: number;
  readonly previousScene: { id: string; title: string } | null;
  readonly nextScene: { id: string; title: string } | null;
  readonly activeSurfaceLabel: string;
  readonly activeSurface: PresentationSurface;
  readonly simulationAvailable: boolean;
  readonly whiteboardOpen: boolean;
  readonly studentCount: number;
  readonly handRaiseCount: number;
  readonly helpCount: number;
  readonly pendingApprovalCount: number;
  readonly approvalItems: LiveClassroomApprovalItem[];
  readonly participants: ClassroomPresentationParticipant[];
  readonly controllerDisplayName: string;
  readonly viewerCanControlPresentation: boolean;
  readonly viewerCanManageSimulation: boolean;
  readonly classPaused: boolean;
  readonly ttsMuted: boolean;
  readonly autoPlayEnabled: boolean;
  readonly promptsLocked: boolean;
  readonly reportAvailable: boolean;
  readonly onTogglePause: () => void;
  readonly onPreviousScene: () => void;
  readonly onNextScene: () => void;
  readonly onReplayScene?: () => void;
  readonly onSelectScene: (sceneId: string) => void;
  readonly onSetPresentationSurface: (surface: PresentationSurface) => void;
  readonly onToggleWhiteboard: () => void;
  readonly onOpenAdvancedControls: () => void;
  readonly onTogglePromptsLock: () => void;
  readonly onToggleNarrationMute: () => void;
  readonly onToggleAutoPlay: () => void;
  readonly onRecoverToLesson: () => void;
  readonly onApproveApproval: (item: LiveClassroomApprovalItem) => void | Promise<void>;
  readonly onRejectApproval: (itemId: string) => void;
  readonly onEditApproval: (
    item: LiveClassroomApprovalItem,
    prompt: string,
  ) => void | Promise<void>;
  readonly onSendTeacherPrompt: (prompt: string) => void | Promise<void>;
}

function ApprovalCard({
  item,
  onApprove,
  onReject,
  onEdit,
}: {
  readonly item: LiveClassroomApprovalItem;
  readonly onApprove: (item: LiveClassroomApprovalItem) => void | Promise<void>;
  readonly onReject: (itemId: string) => void;
  readonly onEdit: (item: LiveClassroomApprovalItem, prompt: string) => void | Promise<void>;
}) {
  const sourceDraft = item.action.kind === 'teacher-prompt' ? item.action.prompt : item.preview;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sourceDraft);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/70 p-3 shadow-sm backdrop-blur dark:border-white/5 dark:bg-slate-950/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
              {item.type.replace('_', ' ')}
            </Badge>
            {item.targetSurface ? (
              <Badge variant="outline" className="border-gray-200 bg-white/80 text-gray-600">
                {item.targetSurface}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {item.summary}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">
            {item.preview}
          </p>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-24 bg-white/80 text-sm dark:bg-slate-900/80"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!draft.trim()) {
                  return;
                }

                void onEdit(item, draft);
                setEditing(false);
              }}
            >
              Send edited
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void onApprove(item)}>
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(sourceDraft);
            setEditing(true);
          }}
        >
          Edit
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onReject(item.id)}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function SurfaceButton({
  active,
  icon,
  label,
  disabled = false,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="sm"
      className={cn('justify-start', active && 'shadow-md shadow-sky-500/20')}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

export function LiveClassroomCockpit({
  className,
  open,
  onOpenChange,
  currentSceneTitle,
  currentSceneNumber,
  totalScenesCount,
  previousScene,
  nextScene,
  activeSurfaceLabel,
  activeSurface,
  simulationAvailable,
  whiteboardOpen,
  studentCount,
  handRaiseCount,
  helpCount,
  pendingApprovalCount,
  approvalItems,
  participants,
  controllerDisplayName,
  viewerCanControlPresentation,
  viewerCanManageSimulation,
  classPaused,
  ttsMuted,
  autoPlayEnabled,
  promptsLocked,
  reportAvailable,
  onTogglePause,
  onPreviousScene,
  onNextScene,
  onReplayScene,
  onSelectScene,
  onSetPresentationSurface,
  onToggleWhiteboard,
  onOpenAdvancedControls,
  onTogglePromptsLock,
  onToggleNarrationMute,
  onToggleAutoPlay,
  onRecoverToLesson,
  onApproveApproval,
  onRejectApproval,
  onEditApproval,
  onSendTeacherPrompt,
}: LiveClassroomCockpitProps) {
  const [interventionDraft, setInterventionDraft] = useState('');

  const studentParticipants = useMemo(
    () => participants.filter((participant) => participant.role === 'student'),
    [participants],
  );

  const sortedStudentParticipants = useMemo(
    () =>
      sortParticipantsByPresence(studentParticipants, {
        nowMs: Date.now(),
      }),
    [studentParticipants],
  );

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-4 top-4 z-30 flex flex-col gap-3',
        className,
      )}
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-3xl border border-white/40 bg-white/88 px-4 py-3 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/76">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-300">
            <Sparkles className="size-3.5" />
            Live Classroom Cockpit
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              Scene {currentSceneNumber}/{Math.max(totalScenesCount, 1)}:{' '}
              {currentSceneTitle || 'Untitled scene'}
            </span>
            <Badge variant="outline" className="border-gray-200 bg-white/70 text-gray-700">
              {activeSurfaceLabel}
            </Badge>
            <Badge variant="outline" className="border-gray-200 bg-white/70 text-gray-700">
              <Users />
              {studentCount} students
            </Badge>
            <Badge variant="outline" className="border-gray-200 bg-white/70 text-gray-700">
              <Bot />
              {pendingApprovalCount} approvals
            </Badge>
            {promptsLocked ? (
              <Badge className="bg-amber-500 text-white">
                <Shield />
                Safety lock
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!viewerCanControlPresentation}
            onClick={onTogglePause}
          >
            {classPaused ? <Play /> : <Pause />}
            {classPaused ? 'Resume class' : 'Pause class'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(!open)}>
            {open ? <PanelTopClose /> : <PanelTopOpen />}
            {open ? 'Hide controls' : 'Open controls'}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="pointer-events-auto ml-auto w-full max-w-[28rem] overflow-hidden rounded-3xl border border-white/35 bg-white/92 shadow-[0_25px_60px_-26px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/86">
          <div className="grid gap-5 p-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    AI approval inbox
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Teacher approval is required before these suggestions run.
                  </p>
                </div>
                <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                  {pendingApprovalCount} pending
                </Badge>
              </div>
              <div className="space-y-3">
                {approvalItems.length > 0 ? (
                  approvalItems.map((item) => (
                    <ApprovalCard
                      key={item.id}
                      item={item}
                      onApprove={onApproveApproval}
                      onReject={onRejectApproval}
                      onEdit={onEditApproval}
                    />
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    No approvals waiting right now.
                  </div>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Scene rail
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Move through the live lesson without leaving the stage.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => previousScene && onSelectScene(previousScene.id)}
                  disabled={!previousScene || !viewerCanControlPresentation}
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-left transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <ChevronLeft className="size-3.5" />
                    Previous
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {previousScene?.title || 'No earlier scene'}
                  </p>
                </button>
                <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-3 dark:border-sky-900/40 dark:bg-sky-950/30">
                  <div className="flex items-center gap-2 text-xs font-medium text-sky-700 dark:text-sky-300">
                    <Presentation className="size-3.5" />
                    Current
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {currentSceneTitle || 'Untitled scene'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => nextScene && onSelectScene(nextScene.id)}
                  disabled={!nextScene || !viewerCanControlPresentation}
                  className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-left transition hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-slate-700"
                >
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Next
                    <ChevronRight className="size-3.5" />
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {nextScene?.title || 'No later scene'}
                  </p>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!viewerCanControlPresentation}
                  onClick={onPreviousScene}
                >
                  <ChevronLeft />
                  Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!viewerCanControlPresentation}
                  onClick={onNextScene}
                >
                  <ChevronRight />
                  Next
                </Button>
                {onReplayScene ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!viewerCanControlPresentation}
                    onClick={onReplayScene}
                  >
                    <RotateCcw />
                    Replay scene
                  </Button>
                ) : null}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Student pulse
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Lightweight live presence for the current classroom.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Students
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {studentCount}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Hands
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {handRaiseCount}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Help</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {helpCount}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Controller
                  </div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {controllerDisplayName}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                {sortedStudentParticipants.length > 0 ? (
                  <div className="space-y-2">
                    {sortedStudentParticipants.slice(0, 5).map((participant) => {
                      const activityLabel = getParticipantActivityLabel(participant.lastSeenAt);
                      return (
                        <ParticipantPresenceCard
                          key={participant.sessionId}
                          variant="compact-card"
                          name={participant.displayName}
                          status={activityLabel.state}
                          activityLabel={activityLabel.label}
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
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    No student classroom sessions are active yet.
                  </p>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Surface switcher
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Move between lesson, whiteboard, simulation, and report without leaving class.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <SurfaceButton
                  active={activeSurface === 'lesson' && !whiteboardOpen}
                  icon={<BookOpen />}
                  label="Lesson"
                  disabled={!viewerCanControlPresentation}
                  onClick={() => onSetPresentationSurface('lesson')}
                />
                <SurfaceButton
                  active={whiteboardOpen}
                  icon={<PenSquare />}
                  label="Whiteboard"
                  disabled={!viewerCanControlPresentation}
                  onClick={onToggleWhiteboard}
                />
                <SurfaceButton
                  active={activeSurface === 'simulation'}
                  icon={<MonitorPlay />}
                  label="Simulation"
                  disabled={!viewerCanControlPresentation || !simulationAvailable}
                  onClick={() => onSetPresentationSurface('simulation')}
                />
                <SurfaceButton
                  active={activeSurface === 'report'}
                  icon={<FileBarChart2 />}
                  label="Report"
                  disabled={!viewerCanControlPresentation || !reportAvailable}
                  onClick={() => onSetPresentationSurface('report')}
                />
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Safety lock
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Freeze live prompts, mute narration, and keep the teacher in control.
                </p>
              </div>
              <div className="grid gap-2">
                <Button type="button" variant="outline" onClick={onTogglePromptsLock}>
                  <Shield />
                  {promptsLocked ? 'Unlock live prompts' : 'Freeze live prompts'}
                </Button>
                <Button type="button" variant="outline" onClick={onToggleNarrationMute}>
                  {ttsMuted ? <Volume2 /> : <VolumeX />}
                  {ttsMuted ? 'Unmute narration' : 'Mute narration'}
                </Button>
                <Button type="button" variant="outline" onClick={onToggleAutoPlay}>
                  <Waves />
                  {autoPlayEnabled ? 'Disable autoplay' : 'Enable autoplay'}
                </Button>
                <Button type="button" variant="outline" onClick={onRecoverToLesson}>
                  <BookOpen />
                  Recover to lesson
                </Button>
                {viewerCanManageSimulation || viewerCanControlPresentation ? (
                  <Button type="button" variant="outline" onClick={onOpenAdvancedControls}>
                    <Wand2 />
                    Advanced controls
                  </Button>
                ) : null}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Quick intervene
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Inject a teacher-approved prompt into the live class without leaving the cockpit.
                </p>
              </div>
              <Textarea
                value={interventionDraft}
                onChange={(event) => setInterventionDraft(event.target.value)}
                placeholder="Ask the AI teacher to slow down, clarify a term, or recap a key idea."
                className="min-h-24 bg-white/80 text-sm dark:bg-slate-900/80"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!viewerCanControlPresentation}
                  onClick={() => {
                    const nextPrompt = interventionDraft.trim();
                    if (!nextPrompt) {
                      return;
                    }

                    void onSendTeacherPrompt(nextPrompt);
                    setInterventionDraft('');
                  }}
                >
                  <Sparkles />
                  Send intervention
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setInterventionDraft('')}
                  disabled={!interventionDraft.trim()}
                >
                  Clear
                </Button>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
