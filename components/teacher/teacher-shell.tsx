import type { ReactNode } from 'react';
import Link from 'next/link';
import { Home, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/auth/sign-out-button';
import type { AuthContext } from '@/lib/auth/current-user';

interface TeacherShellProps {
  auth: AuthContext;
  children: ReactNode;
}

export function TeacherShell({ auth, children }: TeacherShellProps) {
  const canAccessAdmin = auth.session.role === 'org_admin' || auth.session.role === 'system_admin';

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-4 z-50">
        <div className="pointer-events-auto flex w-[min(92vw,28rem)] items-center gap-3 rounded-2xl border border-white/50 bg-background/85 px-4 py-3 shadow-lg backdrop-blur-xl">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LayoutDashboard className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">Teacher Studio</p>
            <p className="truncate text-xs text-muted-foreground">
              {auth.user.displayName} | {auth.organization?.name || 'Personal workspace'}
            </p>
          </div>
          <Badge variant="secondary" className="hidden md:inline-flex">
            {auth.session.role.replace('_', ' ')}
          </Badge>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <Home className="size-4" />
                Demo
              </Link>
            </Button>
            {canAccessAdmin ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin">
                  <ShieldCheck className="size-4" />
                  Admin
                </Link>
              </Button>
            ) : null}
            <SignOutButton variant="outline" />
          </div>
        </div>
      </div>

      {children}
    </>
  );
}
