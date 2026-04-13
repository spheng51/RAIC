import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
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

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const auth = await getCurrentAuth();
  if (auth) {
    redirect(getDefaultLandingPath(auth.session.role));
  }

  const params = await searchParams;
  const redirectTo = params.next?.startsWith('/') ? params.next : '/studio';

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_45%),linear-gradient(180deg,_rgba(15,23,42,0.05),_transparent)] px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-white/40 bg-background/70 p-8 shadow-xl backdrop-blur-xl">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
            <Sparkles className="size-4" />
            RAIC Teacher Launchpad
          </div>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Sign in with Google to run a safer, teacher-ready AI classroom.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            The new studio path keeps lesson generation, classroom launches, and future roster or
            policy controls behind a first-party RAIC session while leaving the existing demo flow
            intact.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              ['Teacher studio', 'Protected lesson creation, preview, and launch'],
              ['Student join links', 'Share time-boxed classroom entry without exposing settings'],
              [
                'Server-backed classrooms',
                'Teacher sessions keep classroom launches and controls on the governed path',
              ],
            ].map(([title, description]) => (
              <div key={title} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <Card className="self-start border-white/40 bg-background/80 shadow-xl backdrop-blur-xl">
          <CardHeader>
            <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <CardTitle>Teacher sign-in</CardTitle>
            <CardDescription>
              Use your Google account to enter the protected RAIC studio. Student participation
              stays on a separate join-token flow, and org-admin rollout can stay disabled until
              you are ready to assign it explicitly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleSignInButton redirectTo={redirectTo} />
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 border-t">
            <Button asChild variant="ghost" className="justify-between">
              <Link href="/">
                Continue to the public demo
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
