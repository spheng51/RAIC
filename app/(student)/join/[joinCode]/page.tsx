import { ArrowRight, Clock3, Presentation } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StudentJoinLiveMeetingCard } from '@/components/classroom/student-join-live-meeting-card';
import { findValidJoinToken } from '@/lib/auth/classroom-access';
import { readClassroom } from '@/lib/server/classroom-storage';

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

  const classroom = await readClassroom(joinToken.classroomId).catch(() => null);
  const liveMeeting = classroom?.stage.liveMeeting ?? null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Presentation className="size-5" />
          </div>
          <CardTitle>{joinToken.displayName}</CardTitle>
          <CardDescription>
            This secure join link opens the shared classroom in student mode with the lesson,
            simulation, and report pane kept in sync with the teacher.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-4 py-3">
            <Clock3 className="size-4 text-primary" />
            <span>Valid until {new Date(joinToken.expiresAt).toLocaleString()}</span>
          </div>
          <form action={`/join/${encodeURIComponent(joinCode)}/enter`} method="post" className="space-y-3">
            <label htmlFor="student-display-name" className="block text-sm font-medium text-foreground">
              Your display name
            </label>
            <input
              id="student-display-name"
              name="displayName"
              maxLength={80}
              autoComplete="name"
              required
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Enter your name"
            />
            <p>
              You&apos;ll enter as a classroom-scoped student session, so teacher controls stay hidden
              while the shared presentation, multiplayer games, and classroom sidecars stay aligned
              with the rest of the room.
            </p>
            {liveMeeting ? <StudentJoinLiveMeetingCard liveMeeting={liveMeeting} /> : null}
            <Button type="submit" className="w-full">
              Enter classroom
              <ArrowRight className="size-4" />
            </Button>
          </form>
        </CardContent>
        <CardFooter className="border-t text-xs text-muted-foreground">
          Direct classroom links still work for returning students.
        </CardFooter>
      </Card>
    </main>
  );
}
