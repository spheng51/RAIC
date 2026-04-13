'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AccessCodeModal } from '@/components/access-code-modal';

type AccessCodeStatus = {
  enabled: boolean;
  authenticated: boolean;
  loading: boolean;
};

export function AccessCodeGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccessCodeStatus>({
    enabled: false,
    authenticated: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch('/api/access-code/status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const data = (await response.json()) as {
          enabled?: boolean;
          authenticated?: boolean;
        };
        if (cancelled) return;
        setStatus({
          enabled: !!data.enabled,
          authenticated: !!data.authenticated,
          loading: false,
        });
      } catch {
        if (cancelled) return;
        setStatus({
          enabled: true,
          authenticated: false,
          loading: false,
        });
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.loading) {
    return null;
  }

  if (status.enabled && !status.authenticated) {
    return (
      <AccessCodeModal
        open
        onSuccess={() =>
          setStatus({
            enabled: true,
            authenticated: true,
            loading: false,
          })
        }
      />
    );
  }

  return <>{children}</>;
}
