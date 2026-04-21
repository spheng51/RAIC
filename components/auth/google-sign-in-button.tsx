'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

interface GoogleSignInButtonProps {
  redirectTo?: string;
}

export function GoogleSignInButton({ redirectTo = '/studio' }: GoogleSignInButtonProps) {
  const router = useRouter();
  const buttonContainerRef = useRef<HTMLDivElement | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [currentOrigin, setCurrentOrigin] = useState<string | null>(null);
  const [isScriptReady, setIsScriptReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreparing, setIsPreparing] = useState(true);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    setCurrentOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!clientId) {
      setIsPreparing(false);
      return;
    }

    let cancelled = false;

    async function loadNonce() {
      try {
        const response = await fetch('/api/auth/nonce', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error('Failed to prepare Google sign-in');
        }
        const data = (await response.json()) as { nonce: string };
        if (!cancelled) {
          setNonce(data.nonce);
          setError(null);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Failed to prepare sign-in');
        }
      } finally {
        if (!cancelled) {
          setIsPreparing(false);
        }
      }
    }

    loadNonce();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    if (
      !clientId ||
      !isScriptReady ||
      !nonce ||
      !buttonContainerRef.current ||
      !window.google?.accounts?.id
    ) {
      return;
    }

    const accountsApi = window.google.accounts.id;

    accountsApi.initialize({
      client_id: clientId,
      nonce,
      callback: async (response: { credential?: string }) => {
        if (!response.credential) {
          setError('Google did not return a credential');
          return;
        }

        try {
          setIsLoading(true);
          setError(null);
          setScriptError(null);

          const authResponse = await fetch('/api/auth/google', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'same-origin',
            body: JSON.stringify({
              credential: response.credential,
              redirectTo,
            }),
          });

          const data = (await authResponse.json()) as {
            success?: boolean;
            error?: string;
            redirectTo?: string;
          };

          if (!authResponse.ok || !data.success) {
            throw new Error(data.error || 'Google sign-in failed');
          }

          router.push(data.redirectTo || redirectTo);
          router.refresh();
        } catch (authError) {
          setError(authError instanceof Error ? authError.message : 'Google sign-in failed');
        } finally {
          setIsLoading(false);
        }
      },
    });

    buttonContainerRef.current.innerHTML = '';
    accountsApi.renderButton(buttonContainerRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: buttonContainerRef.current.clientWidth || 320,
      logo_alignment: 'left',
    });
  }, [clientId, isScriptReady, nonce, redirectTo, router]);

  const statusError = scriptError || error;

  if (!clientId) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p>NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured yet.</p>
          <p className="text-xs leading-5 text-amber-800/90 dark:text-amber-200/90">
            Create a Google Web application client, add{' '}
            <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono">
              {currentOrigin ?? 'http://localhost:3005'}
            </code>{' '}
            as an Authorized JavaScript origin, set the client ID in{' '}
            <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono">.env.local</code>, and
            restart <code className="rounded bg-amber-500/10 px-1 py-0.5 font-mono">pnpm dev</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setIsScriptReady(true)}
        onError={() =>
          setScriptError(
            'Google sign-in failed to load. Check network access or content blockers and retry.',
          )
        }
      />

      <div
        ref={buttonContainerRef}
        className="min-h-11"
        aria-hidden={isPreparing || !!statusError || isLoading}
      />

      {isPreparing || (!isScriptReady && !statusError) ? (
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Preparing secure Google sign-in...
        </div>
      ) : null}

      {isLoading ? (
        <Button variant="outline" disabled className="w-full justify-center">
          <LoaderCircle className="size-4 animate-spin" />
          Signing you in securely...
        </Button>
      ) : null}

      {statusError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p>{statusError}</p>
            <p className="text-xs leading-5 text-destructive/80">
              Google sign-in only works on exact authorized origins for this deployment.
              {currentOrigin ? (
                <>
                  {' '}
                  Current origin:{' '}
                  <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono">
                    {currentOrigin}
                  </code>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          Google sign-in is limited to the exact authorized origins configured for this deployment.
        </p>
      )}
    </div>
  );
}
