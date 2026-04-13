import { Badge } from '@/components/ui/badge';
import { AIGovernanceConsole } from '@/components/admin/ai-governance-console';
import { requireRole } from '@/lib/auth/authorize';
import { getPersistenceMode } from '@/lib/db/client';
import { getAdminConfigSnapshot, getEffectiveAIOptions } from '@/lib/server/ai-governance';
import { hasEncryptionKeyConfigured } from '@/lib/server/encrypted-secrets';

export default async function AdminPage() {
  const auth = await requireRole(['org_admin']);
  const [persistenceMode, snapshot, effectiveOptions] = await Promise.all([
    getPersistenceMode(),
    getAdminConfigSnapshot(auth),
    getEffectiveAIOptions(auth),
  ]);
  const encryptionReady = hasEncryptionKeyConfigured();

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <Badge variant="secondary">Org AI governance</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          Managed provider connectivity
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          Configure which AI providers your organization can use, store encrypted org secrets, set
          model allowlists and defaults, and control when teachers can layer personal overrides on
          top of the managed baseline.
        </p>
      </div>

      <AIGovernanceConsole
        persistenceMode={persistenceMode}
        encryptionReady={encryptionReady}
        initialConfig={snapshot}
        initialOptions={effectiveOptions}
      />
    </section>
  );
}
