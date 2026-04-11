'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';

interface SignOutButtonProps {
  redirectTo?: string;
  variant?: ButtonVariant;
  className?: string;
}

export function SignOutButton({
  redirectTo = '/sign-in',
  variant = 'ghost',
  className,
}: SignOutButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={isLoading}
      onClick={async () => {
        try {
          setIsLoading(true);
          await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
          });
        } finally {
          router.push(redirectTo);
          router.refresh();
          setIsLoading(false);
        }
      }}
    >
      {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      Sign out
    </Button>
  );
}
