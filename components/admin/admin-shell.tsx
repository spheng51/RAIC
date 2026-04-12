import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/auth/sign-out-button';
import type { AuthContext } from '@/lib/auth/current-user';

interface AdminShellProps {
  auth: AuthContext;
  children: ReactNode;
}

export function AdminShell({ auth, children }: AdminShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.16),_transparent_48%),linear-gradient(180deg,_rgba(15,23,42,0.02),_transparent)]">
      <header className="border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">RAIC Admin</p>
              <p className="text-xs text-muted-foreground">
                {auth.organization?.name || 'Organization'} policy controls
              </p>
            </div>
            <Badge variant="secondary">{auth.session.role.replace('_', ' ')}</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/studio">
                <ArrowLeft className="size-4" />
                Studio
              </Link>
            </Button>
            <SignOutButton variant="outline" />
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
