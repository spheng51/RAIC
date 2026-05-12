'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Clock3, Edit3, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { ScheduledClassEvent, ScheduledClassEventInput } from '@/lib/types/scheduled-classes';
import { getUpcomingScheduledClassEvents } from '@/lib/utils/scheduled-classes';

const NO_CLASSROOM_VALUE = '__none__';

export interface ScheduleClassroomOption {
  id: string;
  name: string;
}

interface ScheduleClassesBoxProps {
  readonly events: ScheduledClassEvent[];
  readonly classrooms: ScheduleClassroomOption[];
  readonly onCreate: (input: ScheduledClassEventInput) => Promise<void>;
  readonly onUpdate: (id: string, input: ScheduledClassEventInput) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onOpenClassroom: (classroomId: string) => void;
}

interface ScheduleFormState {
  title: string;
  date: string;
  time: string;
  durationMinutes: string;
  classroomId: string;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function getDefaultStartDate() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

function toLocalDateInput(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toLocalTimeInput(value: Date) {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function buildInitialForm(event?: ScheduledClassEvent | null): ScheduleFormState {
  const date = event ? new Date(event.startsAt) : getDefaultStartDate();
  return {
    title: event?.title ?? '',
    date: toLocalDateInput(date),
    time: toLocalTimeInput(date),
    durationMinutes: event?.durationMinutes ? String(event.durationMinutes) : '',
    classroomId: event?.classroomId ?? '',
  };
}

function buildInputFromForm(form: ScheduleFormState): ScheduledClassEventInput {
  const start = new Date(`${form.date}T${form.time || '00:00'}`);
  return {
    title: form.title,
    startsAt: start.toISOString(),
    durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
    classroomId: form.classroomId || undefined,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ScheduleClassesBox({
  events,
  classrooms,
  onCreate,
  onUpdate,
  onDelete,
  onOpenClassroom,
}: ScheduleClassesBoxProps) {
  const { t } = useI18n();
  const upcomingEvents = useMemo(() => getUpcomingScheduledClassEvents(events), [events]);
  const classroomById = useMemo(
    () => new Map(classrooms.map((classroom) => [classroom.id, classroom])),
    [classrooms],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduledClassEvent | null>(null);
  const [form, setForm] = useState<ScheduleFormState>(() => buildInitialForm());
  const [busyAction, setBusyAction] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openCreateDialog = () => {
    setEditingEvent(null);
    setForm(buildInitialForm());
    setError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (event: ScheduledClassEvent) => {
    setEditingEvent(event);
    setForm(buildInitialForm(event));
    setError(null);
    setDialogOpen(true);
  };

  const saveEvent = async () => {
    setBusyAction('save');
    setError(null);
    try {
      const input = buildInputFromForm(form);
      if (editingEvent) {
        await onUpdate(editingEvent.id, input);
      } else {
        await onCreate(input);
        if (input.classroomId) {
          onOpenClassroom(input.classroomId);
        }
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('home.schedule.saveFailed'));
    } finally {
      setBusyAction(null);
    }
  };

  const deleteEvent = async () => {
    if (!editingEvent) return;

    setBusyAction('delete');
    setError(null);
    try {
      await onDelete(editingEvent.id);
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('home.schedule.deleteFailed'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <section
        aria-labelledby="schedule-classes-heading"
        data-testid="schedule-classes-box"
        className="mb-5 w-full max-w-[800px] px-1"
      >
        <div className="relative overflow-hidden rounded-2xl border border-violet-200/60 bg-white/82 p-3 shadow-[0_18px_44px_rgba(88,28,135,0.10)] backdrop-blur-xl dark:border-violet-500/20 dark:bg-slate-950/72">
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-400 via-fuchsia-400 to-indigo-400" />
          <div className="flex items-center justify-between gap-3 pl-2">
            <div className="min-w-0">
              <h2
                id="schedule-classes-heading"
                className="relative inline-flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50"
              >
                <span className="absolute -inset-x-2 -inset-y-1 rounded-full bg-violet-400/15 blur-md" />
                <Sparkles className="relative size-3.5 text-violet-500" />
                <span className="relative">{t('home.schedule.title')}</span>
              </h2>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full border border-violet-200/70 bg-violet-50/90 px-3 text-xs text-violet-700 hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20"
              onClick={openCreateDialog}
            >
              <Plus className="size-3.5" />
              {t('home.schedule.add')}
            </Button>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-violet-100/70 bg-violet-50/40 dark:border-violet-500/15 dark:bg-violet-500/5">
            {upcomingEvents.length === 0 ? (
              <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-muted-foreground">
                <span>{t('home.schedule.empty')}</span>
                <CalendarClock className="size-4 text-violet-400" />
              </div>
            ) : (
              <ul className="divide-y divide-violet-100/80 dark:divide-violet-500/15">
                {upcomingEvents.map((event) => {
                  const classroom = event.classroomId
                    ? classroomById.get(event.classroomId)
                    : undefined;
                  const canOpen = Boolean(classroom);
                  const rowLabel = `${event.title} ${formatDate(event.startsAt)} ${formatTime(
                    event.startsAt,
                  )}`;

                  return (
                    <li key={event.id} className="group flex items-center gap-2 px-2 py-2">
                      <button
                        type="button"
                        disabled={!canOpen}
                        aria-label={canOpen ? rowLabel : undefined}
                        onClick={() => {
                          if (event.classroomId && canOpen) {
                            onOpenClassroom(event.classroomId);
                          }
                        }}
                        className={cn(
                          'min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors',
                          canOpen ? 'hover:bg-white/80 dark:hover:bg-white/5' : 'cursor-default',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm ring-1 ring-violet-100 dark:bg-slate-950 dark:text-violet-200 dark:ring-violet-500/20">
                            <Clock3 className="size-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">
                              {event.title}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatDate(event.startsAt)} · {formatTime(event.startsAt)}
                              {event.durationMinutes
                                ? ` · ${event.durationMinutes} ${t('home.schedule.minutes')}`
                                : ''}
                              {classroom
                                ? ` · ${classroom.name}`
                                : event.classroomId
                                  ? ` · ${t('home.schedule.unlinkedClassroom')}`
                                  : ''}
                            </p>
                          </div>
                        </div>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('home.schedule.edit')}
                        className="opacity-80 hover:bg-white/80 dark:hover:bg-white/5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        onClick={() => openEditDialog(event)}
                      >
                        <Edit3 className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingEvent ? t('home.schedule.editTitle') : t('home.schedule.addTitle')}
            </DialogTitle>
            <DialogDescription>{t('home.schedule.dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduled-class-title">{t('home.schedule.formTitle')}</Label>
              <Input
                id="scheduled-class-title"
                value={form.title}
                maxLength={120}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="scheduled-class-date">{t('home.schedule.date')}</Label>
                <Input
                  id="scheduled-class-date"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scheduled-class-time">{t('home.schedule.time')}</Label>
                <Input
                  id="scheduled-class-time"
                  type="time"
                  value={form.time}
                  onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-2">
                <Label htmlFor="scheduled-class-duration">{t('home.schedule.duration')}</Label>
                <Input
                  id="scheduled-class-duration"
                  type="number"
                  min={1}
                  max={1440}
                  value={form.durationMinutes}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, durationMinutes: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('home.schedule.classroom')}</Label>
                <Select
                  value={form.classroomId || NO_CLASSROOM_VALUE}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      classroomId: value === NO_CLASSROOM_VALUE ? '' : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLASSROOM_VALUE}>
                      {t('home.schedule.noClassroom')}
                    </SelectItem>
                    {classrooms.map((classroom) => (
                      <SelectItem key={classroom.id} value={classroom.id}>
                        {classroom.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            {editingEvent ? (
              <Button
                type="button"
                variant="ghost"
                onClick={deleteEvent}
                disabled={busyAction !== null}
                className="mr-auto text-destructive hover:text-destructive"
              >
                {busyAction === 'delete' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {t('home.schedule.delete')}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={saveEvent} disabled={busyAction !== null}>
              {busyAction === 'save' ? <Loader2 className="size-4 animate-spin" /> : null}
              {editingEvent ? t('home.schedule.save') : t('home.schedule.createAndJoin')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
