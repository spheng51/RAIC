import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getDefaultLandingPath } from '@/lib/auth/authorize';
import { getCurrentAuth } from '@/lib/auth/current-user';

export default async function UnauthorizedPage() {
  const auth = await getCurrentAuth();
  const landingPath = auth ? getDefaultLandingPath(auth.session.role) : '/sign-in';
  const landingLabel = auth
    ? auth.session.role === 'teacher'
      ? 'Return to teacher studio'
      : 'Return to your default workspace'
    : 'Back to sign-in';

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert className="size-5" />
          </div>
          {auth ? <Badge variant="outline">{auth.session.role.replace('_', ' ')}</Badge> : null}
          <CardTitle>That area is restricted</CardTitle>
          <CardDescription>
            {auth
              ? 'This signed-in account does not have permission to open the requested RAIC route.'
              : 'Your current RAIC role does not include access to this route yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            {auth
              ? `Signed in as ${auth.user.email}. If you expected admin access, switch to the correct Google account or ask an organization administrator to adjust your role.`
              : 'If you expected to access this page, sign in with the correct Google account or ask an administrator to adjust your role.'}
          </p>
          {auth ? (
            <p>
              Your current session can still access the routes allowed for your role. RAIC will keep
              protected teacher and admin paths separated rather than silently redirecting you.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3 border-t sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link href={landingPath}>
              <ArrowLeft className="size-4" />
              {landingLabel}
            </Link>
          </Button>
          {auth ? <SignOutButton variant="ghost" className="sm:w-auto" /> : null}
        </CardFooter>
      </Card>
    </main>
  );
}
