import 'server-only';

import { appendAuditLog } from '@/lib/db/repositories/audit-logs';
import type { PlatformRole } from '@/lib/db/schema';

export async function recordAuditEvent(input: {
  organizationId?: string | null;
  userId?: string | null;
  actorRole?: PlatformRole | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return appendAuditLog(input);
}
