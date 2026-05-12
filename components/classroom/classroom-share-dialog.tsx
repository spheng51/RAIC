'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Share2, Trash2, Video } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ClassroomLiveMeeting } from '@/lib/types/stage';

const DURATION_OPTIONS = [
  { label: '30 min', minutes: 30 },
  { label: '2 hr', minutes: 120 },
  { label: '8 hr', minutes: 480 },
  { label: '24 hr', minutes: 1440 },
] as const;

interface JoinLinkResult {
  joinUrl: string;
  joinCode: string;
  expiresAt: string;
}

interface LiveMeetingResult {
  success?: boolean;
  liveMeeting?: ClassroomLiveMeeting | null;
  error?: string;
  details?: string;
}

export interface ClassroomShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroomId: string | null;
  classroomName?: string | null;
}

async function copyToClipboard(value: string) {
  if (!navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ClassroomShareDialog({
  open,
  onOpenChange,
  classroomId,
  classroomName,
}: ClassroomShareDialogProps) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(classroomName ?? '');
  const [expiresInMinutes, setExpiresInMinutes] = useState(1440);
  const [result, setResult] = useState<JoinLinkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyUnavailable, setCopyUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveMeeting, setLiveMeeting] = useState<ClassroomLiveMeeting | null>(null);
  const [zoomJoinUrl, setZoomJoinUrl] = useState('');
  const [zoomLabel, setZoomLabel] = useState('');
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomSaving, setZoomSaving] = useState(false);
  const [zoomRemoving, setZoomRemoving] = useState(false);
  const [zoomError, setZoomError] = useState<string | null>(null);
  const zoomLoadRequestIdRef = useRef(0);
  const zoomMutationVersionRef = useRef(0);
  const zoomLoadFailedMessage = t('classroom.share.zoomLoadFailed');

  useEffect(() => {
    if (!open) return;

    zoomLoadRequestIdRef.current += 1;
    zoomMutationVersionRef.current += 1;
    setDisplayName(classroomName ?? '');
    setExpiresInMinutes(1440);
    setResult(null);
    setCopied(false);
    setCopyUnavailable(false);
    setError(null);
    setLiveMeeting(null);
    setZoomJoinUrl('');
    setZoomLabel('');
    setZoomLoading(false);
    setZoomError(null);
  }, [classroomId, classroomName, open]);

  useEffect(() => {
    if (!open || !classroomId) return;

    let disposed = false;
    const requestId = ++zoomLoadRequestIdRef.current;
    const mutationVersionAtStart = zoomMutationVersionRef.current;
    setZoomLoading(true);
    setZoomError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/classroom/${encodeURIComponent(classroomId)}/live-meeting`,
          {
            cache: 'no-store',
          },
        );
        const body = (await response.json().catch(() => null)) as LiveMeetingResult | null;
        const canApply =
          !disposed &&
          requestId === zoomLoadRequestIdRef.current &&
          mutationVersionAtStart === zoomMutationVersionRef.current;
        if (disposed) return;

        if (!response.ok || !body?.success) {
          throw new Error(body?.details || body?.error || zoomLoadFailedMessage);
        }

        if (!canApply) return;
        const nextLiveMeeting = body.liveMeeting ?? null;
        setLiveMeeting(nextLiveMeeting);
        setZoomJoinUrl(nextLiveMeeting?.joinUrl ?? '');
        setZoomLabel(nextLiveMeeting?.label ?? '');
      } catch (err) {
        if (
          !disposed &&
          requestId === zoomLoadRequestIdRef.current &&
          mutationVersionAtStart === zoomMutationVersionRef.current
        ) {
          setZoomError(err instanceof Error ? err.message : zoomLoadFailedMessage);
        }
      } finally {
        if (!disposed && requestId === zoomLoadRequestIdRef.current) {
          setZoomLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [classroomId, open, zoomLoadFailedMessage]);

  const buildInviteText = (joinUrl: string) => {
    const title = displayName.trim() || classroomName || t('classroom.share.title');
    const lines = [title, '', `${t('classroom.share.openRaicLink')}: ${joinUrl}`];
    if (liveMeeting?.joinUrl) {
      lines.push(`${t('classroom.share.zoomLink')}: ${liveMeeting.joinUrl}`);
    }
    return lines.join('\n');
  };

  const createLink = async () => {
    if (!classroomId || zoomLoading) return;

    setLoading(true);
    setError(null);
    setCopied(false);
    setCopyUnavailable(false);

    try {
      const response = await fetch('/api/classroom/join-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classroomId,
          displayName: displayName.trim() || classroomName || `Classroom ${classroomId}`,
          expiresInMinutes,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | (JoinLinkResult & { error?: string; details?: string })
        | null;

      if (!response.ok || !body?.joinUrl) {
        throw new Error(body?.details || body?.error || t('classroom.share.createFailed'));
      }

      setResult(body);
      const didCopy = await copyToClipboard(buildInviteText(body.joinUrl));
      setCopied(didCopy);
      setCopyUnavailable(!didCopy);
      toast.success(didCopy ? t('classroom.share.inviteCopied') : t('classroom.share.created'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('classroom.share.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const copyExisting = async () => {
    if (!result?.joinUrl || zoomLoading) return;

    const didCopy = await copyToClipboard(buildInviteText(result.joinUrl));
    setCopied(didCopy);
    setCopyUnavailable(!didCopy);
    if (didCopy) {
      toast.success(t('classroom.share.inviteCopied'));
    }
  };

  const saveZoomLink = async () => {
    if (!classroomId) return;

    zoomMutationVersionRef.current += 1;
    setZoomSaving(true);
    setZoomError(null);

    try {
      const response = await fetch(
        `/api/classroom/${encodeURIComponent(classroomId)}/live-meeting`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            joinUrl: zoomJoinUrl,
            label: zoomLabel,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as LiveMeetingResult | null;
      if (!response.ok || !body?.success || !body.liveMeeting) {
        throw new Error(body?.details || body?.error || t('classroom.share.zoomSaveFailed'));
      }

      setLiveMeeting(body.liveMeeting);
      setZoomJoinUrl(body.liveMeeting.joinUrl);
      setZoomLabel(body.liveMeeting.label ?? '');
      toast.success(t('classroom.share.zoomSaved'));
    } catch (err) {
      setZoomError(err instanceof Error ? err.message : t('classroom.share.zoomSaveFailed'));
    } finally {
      setZoomSaving(false);
    }
  };

  const removeZoomLink = async () => {
    if (!classroomId) return;

    zoomMutationVersionRef.current += 1;
    setZoomRemoving(true);
    setZoomError(null);

    try {
      const response = await fetch(
        `/api/classroom/${encodeURIComponent(classroomId)}/live-meeting`,
        {
          method: 'DELETE',
        },
      );
      const body = (await response.json().catch(() => null)) as LiveMeetingResult | null;
      if (!response.ok || !body?.success) {
        throw new Error(body?.details || body?.error || t('classroom.share.zoomRemoveFailed'));
      }

      setLiveMeeting(null);
      setZoomJoinUrl('');
      setZoomLabel('');
      toast.success(t('classroom.share.zoomRemoved'));
    } catch (err) {
      setZoomError(err instanceof Error ? err.message : t('classroom.share.zoomRemoveFailed'));
    } finally {
      setZoomRemoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Share2 className="size-4" />
          </div>
          <DialogTitle>{t('classroom.share.title')}</DialogTitle>
          <DialogDescription>{t('classroom.share.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="classroom-share-name">{t('classroom.share.displayName')}</Label>
            <Input
              id="classroom-share-name"
              value={displayName}
              maxLength={120}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={classroomName || t('classroom.share.displayNamePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('classroom.share.duration')}</Label>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((option) => {
                const selected = expiresInMinutes === option.minutes;
                return (
                  <Button
                    key={option.minutes}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    className={cn('h-9 px-2 text-xs', selected && 'shadow-none')}
                    onClick={() => setExpiresInMinutes(option.minutes)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
                <Video className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t('classroom.share.zoomTitle')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('classroom.share.zoomDescription')}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-2">
                <Label htmlFor="classroom-share-zoom-url">{t('classroom.share.zoomJoinUrl')}</Label>
                <Input
                  id="classroom-share-zoom-url"
                  value={zoomJoinUrl}
                  onChange={(event) => setZoomJoinUrl(event.target.value)}
                  placeholder="https://zoom.us/j/..."
                  disabled={zoomSaving || zoomRemoving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="classroom-share-zoom-label">{t('classroom.share.zoomLabel')}</Label>
                <Input
                  id="classroom-share-zoom-label"
                  value={zoomLabel}
                  maxLength={120}
                  onChange={(event) => setZoomLabel(event.target.value)}
                  placeholder="Live room"
                  disabled={zoomSaving || zoomRemoving}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={saveZoomLink}
                disabled={!classroomId || !zoomJoinUrl.trim() || zoomSaving || zoomRemoving}
              >
                {zoomSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Video className="size-4" />
                )}
                {liveMeeting ? t('classroom.share.zoomUpdate') : t('classroom.share.zoomSave')}
              </Button>
              {liveMeeting ? (
                <>
                  <Button type="button" variant="ghost" size="sm" asChild>
                    <a href={liveMeeting.joinUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" />
                      {t('classroom.share.zoomOpen')}
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeZoomLink}
                    disabled={zoomRemoving}
                  >
                    {zoomRemoving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    {t('classroom.share.zoomRemove')}
                  </Button>
                </>
              ) : null}
            </div>

            {liveMeeting ? (
              <p className="truncate text-xs text-muted-foreground">
                {t('classroom.share.zoomAttached')}: {liveMeeting.joinUrl}
              </p>
            ) : null}
            {zoomError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {zoomError}
              </p>
            ) : null}
          </div>

          {result ? (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('classroom.share.linkReady')}
                  </p>
                  <p className="truncate text-sm font-medium">{result.joinUrl}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyExisting}
                  aria-label={t('classroom.share.copyLink')}
                  disabled={zoomLoading}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {liveMeeting ? t('classroom.share.copyInvite') : t('classroom.share.copy')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('classroom.share.expiresAt', {
                  value: new Date(result.expiresAt).toLocaleString(),
                })}
              </p>
              {copyUnavailable ? (
                <p className="text-xs text-amber-600 dark:text-amber-300">
                  {t('classroom.share.copyUnavailable')}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button
            type="button"
            onClick={createLink}
            disabled={!classroomId || loading || zoomLoading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
            {result ? t('classroom.share.createAnother') : t('classroom.share.createLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
