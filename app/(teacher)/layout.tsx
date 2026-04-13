import type { ReactNode } from 'react';
import { requireRole } from '@/lib/auth/authorize';
import { TeacherShell } from '@/components/teacher/teacher-shell';

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const auth = await requireRole(['teacher']);
  return <TeacherShell auth={auth}>{children}</TeacherShell>;
}
