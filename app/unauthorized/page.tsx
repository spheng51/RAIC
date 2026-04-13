import Link from 'next/link';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert className="size-5" />
          </div>
          <CardTitle>That area is restricted</CardTitle>
          <CardDescription>
            Your current RAIC role does not include access to this route yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          If you expected to access this page, sign in with the correct Google account or ask an
          administrator to adjust your role.
        </CardContent>
        <CardFooter className="border-t">
          <Button asChild variant="outline">
            <Link href="/sign-in">
              <ArrowLeft className="size-4" />
              Back to sign-in
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
