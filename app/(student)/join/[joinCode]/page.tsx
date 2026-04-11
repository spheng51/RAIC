import Link from 'next/link';
import { ArrowRight, Clock3, Presentation } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { findValidJoinToken } from '@/lib/auth/classroom-access';

export default async function JoinClassroomPage({
  params,
}: {
  params: Promise<{ joinCode: string }>;
}) {
  const { joinCode } = await params;
  const joinToken = await findValidJoinToken(joinCode);

  if (!joinToken) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-12">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Join link unavailable</CardTitle>
            <CardDescription>
              This classroom link is invalid or has expired. Ask your teacher for a new join link.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const classroomHref = `/join/${encodeURIComponent(joinCode)}/enter`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Presentation className="size-5" />
          </div>
          <CardTitle>{joinToken.displayName}</CardTitle>
          <CardDescription>
            This secure join link opens the classroom in student mode using a time-boxed token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-4 py-3">
            <Clock3 className="size-4 text-primary" />
            <span>Valid until {new Date(joinToken.expiresAt).toLocaleString()}</span>
          </div>
          <p>
            The full student runtime is still evolving, but this link already provides a clean, classroom-scoped
            entry point instead of exposing teacher-facing settings or controls.
          </p>
        </CardContent>
        <CardFooter className="border-t">
          <Button asChild className="w-full">
            <Link href={classroomHref}>
              Continue to classroom
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
