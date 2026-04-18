'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_CONFIDENCE_SCORE = '3';
const DEFAULT_REVISIT_INTENT = 'continue';

interface SessionReflectionDialogProps {
  classroomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (input: {
    reflection?: {
      summary?: string;
      challengingAreas?: string[];
      confidenceScore?: number | null;
      revisitIntent?: 'continue' | 'revisit' | 'remediate' | 'deepen';
    } | null;
    context?: {
      revisitIntent?: 'continue' | 'revisit' | 'remediate' | 'deepen';
    } | null;
  }) => void;
}

export function SessionReflectionDialog({
  classroomId,
  open,
  onOpenChange,
  onSaved,
}: SessionReflectionDialogProps) {
  const [summary, setSummary] = useState('');
  const [challengingAreas, setChallengingAreas] = useState('');
  const [confidenceScore, setConfidenceScore] = useState(DEFAULT_CONFIDENCE_SCORE);
  const [revisitIntent, setRevisitIntent] = useState<'continue' | 'revisit' | 'remediate' | 'deepen'>(
    DEFAULT_REVISIT_INTENT,
  );
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [latestReflection, setLatestReflection] = useState<{
    summary?: string;
    challengingAreas?: string[];
    confidenceScore?: number | null;
    revisitIntent?: 'continue' | 'revisit' | 'remediate' | 'deepen';
    createdAt?: string;
  } | null>(null);
  const [latestContext, setLatestContext] = useState<{
    lastCompletedSceneTitle?: string | null;
    completedSceneCount?: number;
    totalSceneCount?: number;
    masteryHints?: string[];
    reflectionSummary?: string | null;
    confidenceScore?: number | null;
    revisitIntent?: 'continue' | 'revisit' | 'remediate' | 'deepen';
  } | null>(null);

  useEffect(() => {
    const clearSnapshotState = () => {
      setLatestReflection(null);
      setLatestContext(null);
      setSummary('');
      setChallengingAreas('');
      setConfidenceScore(DEFAULT_CONFIDENCE_SCORE);
      setRevisitIntent(DEFAULT_REVISIT_INTENT);
    };

    if (!open) {
      clearSnapshotState();
      setSubmitting(false);
      setLoadingSnapshot(false);
      return;
    }

    let cancelled = false;
    clearSnapshotState();
    setLoadingSnapshot(true);
    void fetch(`/api/classroom/${encodeURIComponent(classroomId)}/reflection`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || 'Failed to load session reflection');
        }

        if (cancelled) {
          return;
        }

        const nextContext = payload.context ?? null;
        const nextLatestReflection = payload.reflections?.[0] ?? null;
        setLatestContext(nextContext);
        setLatestReflection(nextLatestReflection);
        setSummary(nextLatestReflection?.summary ?? nextContext?.reflectionSummary ?? '');
        setChallengingAreas((nextLatestReflection?.challengingAreas ?? nextContext?.masteryHints ?? []).join(', '));
        setConfidenceScore(
          String(
            nextLatestReflection?.confidenceScore ?? nextContext?.confidenceScore ?? DEFAULT_CONFIDENCE_SCORE,
          ),
        );
        setRevisitIntent(nextLatestReflection?.revisitIntent ?? nextContext?.revisitIntent ?? DEFAULT_REVISIT_INTENT);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : 'Failed to load session reflection');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSnapshot(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [classroomId, open]);

  const handleSubmit = async () => {
    if (!summary.trim()) {
      toast.error('Reflection summary is required.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/classroom/${encodeURIComponent(classroomId)}/reflection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: summary.trim(),
          challengingAreas: challengingAreas
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
          confidenceScore: Number(confidenceScore),
          revisitIntent,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to save session reflection');
      }

      setLatestReflection(payload.reflection ?? null);
      setLatestContext(payload.context ?? null);
      onSaved?.({
        reflection: payload.reflection ?? null,
        context: payload.context ?? null,
      });
      toast.success('Session reflection saved.');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save session reflection');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Session Reflection</DialogTitle>
          <DialogDescription>
            Capture what worked, what was difficult, and how the next classroom should adapt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {latestReflection || latestContext ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Last saved context</p>
              {latestContext?.lastCompletedSceneTitle ? (
                <p>Last completed segment: {latestContext.lastCompletedSceneTitle}</p>
              ) : null}
              {typeof latestContext?.completedSceneCount === 'number' &&
              typeof latestContext?.totalSceneCount === 'number' ? (
                <p>
                  Progress: {latestContext.completedSceneCount}/{latestContext.totalSceneCount} scenes
                </p>
              ) : null}
              {latestReflection?.summary ? <p>Reflection: {latestReflection.summary}</p> : null}
              {latestReflection?.challengingAreas?.length ? (
                <p>Challenging areas: {latestReflection.challengingAreas.join(', ')}</p>
              ) : null}
            </div>
          ) : null}

          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Reflection summary</span>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="What should the next session remember about this classroom?"
              rows={5}
              disabled={loadingSnapshot || submitting}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">Challenging areas</span>
            <Input
              value={challengingAreas}
              onChange={(event) => setChallengingAreas(event.target.value)}
              placeholder="Comma-separated topics or weak spots"
              disabled={loadingSnapshot || submitting}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Confidence (1-5)</span>
              <Input
                min={1}
                max={5}
                step={1}
                type="number"
                value={confidenceScore}
                onChange={(event) => setConfidenceScore(event.target.value)}
                disabled={loadingSnapshot || submitting}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-foreground">Next-session intent</span>
              <Select
                value={revisitIntent}
                onValueChange={(value) =>
                  setRevisitIntent(value as 'continue' | 'revisit' | 'remediate' | 'deepen')
                }
                disabled={loadingSnapshot || submitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose intent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="continue">Continue</SelectItem>
                  <SelectItem value="revisit">Revisit</SelectItem>
                  <SelectItem value="remediate">Remediate</SelectItem>
                  <SelectItem value="deepen">Deepen</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loadingSnapshot || submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loadingSnapshot || submitting}>
            {loadingSnapshot ? 'Loading...' : submitting ? 'Saving...' : 'Save Reflection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
