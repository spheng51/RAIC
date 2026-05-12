import type { ReactNode } from 'react';
import { Circle, CircleDot, CircleX, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import { cn } from '@/lib/utils';
import type { ParticipantActivityState } from '@/lib/utils/participant-presence';

type ParticipantPresenceCardVariant = 'row' | 'compact-card';

export interface ParticipantPresenceCardChip {
  readonly key: string;
  readonly label: string;
  readonly variant?: 'default' | 'secondary' | 'outline';
}

interface ParticipantPresenceCardProps {
  readonly variant?: ParticipantPresenceCardVariant;
  readonly name: string;
  readonly avatar?: string;
  readonly showAvatar?: boolean;
  readonly role?: string;
  readonly status?: ParticipantActivityState;
  readonly activityLabel?: string;
  readonly lastActiveText?: string;
  readonly statusIcon?: 'online' | 'offline' | 'busy' | ReactNode;
  readonly chips?: ReadonlyArray<ParticipantPresenceCardChip>;
  readonly trailing?: ReactNode;
  readonly className?: string;
  readonly highlight?: boolean;
}

function resolveStatusIcon(statusIcon: ParticipantPresenceCardProps['statusIcon']) {
  if (typeof statusIcon === 'string') {
    if (statusIcon === 'online') {
      return <CircleDot className="h-3 w-3 text-emerald-500" aria-hidden="true" />;
    }

    if (statusIcon === 'busy') {
      return <Loader2 className="h-3 w-3 animate-spin text-amber-500" aria-hidden="true" />;
    }

    return <CircleX className="h-3 w-3 text-slate-500" aria-hidden="true" />;
  }

  return statusIcon;
}

export function ParticipantPresenceCard({
  variant = 'compact-card',
  name,
  avatar,
  showAvatar = true,
  role,
  status,
  activityLabel,
  lastActiveText,
  statusIcon,
  chips = [],
  trailing,
  className,
  highlight = false,
}: ParticipantPresenceCardProps) {
  const statusLine =
    activityLabel || lastActiveText || status
      ? `${activityLabel ?? ''} ${lastActiveText ?? ''}`.trim()
      : '';

  return (
    <div
      className={cn(
        'group relative inline-flex min-w-0 flex-shrink-0 items-center gap-2 rounded-2xl border',
        'transition-colors duration-200',
        variant === 'row'
          ? 'h-11 rounded-xl border-white/70 bg-white/90 px-2 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60'
          : 'bg-white/90 px-3 py-2 dark:bg-slate-900/70',
        highlight ? 'ring-2 ring-purple-300 dark:ring-purple-500/50' : 'hover:border-purple-200',
        className,
      )}
    >
      {showAvatar ? (
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          {avatar ? <AvatarDisplay src={avatar} alt={name} className="h-full w-full" /> : null}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{name}</p>
          {role ? (
            <Badge variant="outline" className="shrink-0 bg-sky-50 text-[10px] text-sky-700">
              <span className="truncate max-w-20">{role}</span>
            </Badge>
          ) : null}
        </div>
        {statusLine ? (
          <p className="mt-0.5 text-[11px] capitalize tracking-tight text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              {resolveStatusIcon(statusIcon)}
              <span>{statusLine}</span>
            </span>
          </p>
        ) : null}
        {chips.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Badge key={chip.key} variant={chip.variant ?? 'outline'}>
                {chip.label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {trailing ? (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : null}

      {status ? (
        <div
          className={cn(
            'pointer-events-none absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full border border-white dark:border-slate-900',
            status === 'active' ? 'bg-emerald-400' : 'bg-slate-400',
          )}
          aria-hidden="true"
        >
          {status === 'active' ? <Circle className="h-3 w-3 text-white" /> : null}
        </div>
      ) : null}
    </div>
  );
}
