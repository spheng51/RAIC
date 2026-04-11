import type { ReactNode } from 'react';
import { requireRole } from '@/lib/auth/authorize';
import { AdminShell } from '@/components/admin/admin-shell';

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await requireRole(['org_admin']);
  return <AdminShell auth={auth}>{children}</AdminShell>;
}
