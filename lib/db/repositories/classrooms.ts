import 'server-only';

import { runPostgresQuery, runPostgresTransaction } from '@/lib/db/client';
import type { ClassroomRecord } from '@/lib/db/schema';
import type { Scene, Stage } from '@/lib/types/stage';

interface ClassroomRow {
  id: string;
  owner_user_id: string | null;
  organization_id: string | null;
  room_version: number;
  stage: Stage | string;
  scenes: Scene[] | string;
  created_at: string;
  updated_at: string;
}

const CLASSROOM_COLUMNS = `
  id,
  owner_user_id,
  organization_id,
  room_version,
  stage,
  scenes,
  created_at,
  updated_at
`;

function parseJsonValue<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function mapClassroomRow(row: ClassroomRow): ClassroomRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    roomVersion: Math.max(0, Math.floor(Number(row.room_version) || 0)),
    stage: parseJsonValue<Stage>(row.stage),
    scenes: parseJsonValue<Scene[]>(row.scenes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function readClassroomRecord(id: string): Promise<ClassroomRecord | null> {
  const rows = await runPostgresQuery<ClassroomRow>(
    `SELECT ${CLASSROOM_COLUMNS}
     FROM classrooms
     WHERE id = $1
     LIMIT 1`,
    [id],
  );

  if (!rows) return null;
  return rows[0] ? mapClassroomRow(rows[0]) : null;
}

export async function upsertClassroomRecord(
  classroom: ClassroomRecord,
): Promise<ClassroomRecord | null> {
  const rows = await runPostgresQuery<ClassroomRow>(
    `INSERT INTO classrooms (
        id,
        owner_user_id,
        organization_id,
        room_version,
        stage,
        scenes,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        organization_id = EXCLUDED.organization_id,
        room_version = EXCLUDED.room_version,
        stage = EXCLUDED.stage,
        scenes = EXCLUDED.scenes,
        updated_at = EXCLUDED.updated_at
      RETURNING ${CLASSROOM_COLUMNS}`,
    [
      classroom.id,
      classroom.ownerUserId,
      classroom.organizationId,
      classroom.roomVersion,
      JSON.stringify(classroom.stage),
      JSON.stringify(classroom.scenes),
      classroom.createdAt,
      classroom.updatedAt,
    ],
  );

  if (!rows) return null;
  return rows[0] ? mapClassroomRow(rows[0]) : null;
}

export async function updateClassroomRecord(
  id: string,
  updater: (current: ClassroomRecord) => ClassroomRecord,
): Promise<ClassroomRecord | null> {
  return runPostgresTransaction(async (executor) => {
    const currentRows = await executor.unsafe<ClassroomRow>(
      `SELECT ${CLASSROOM_COLUMNS}
       FROM classrooms
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (!currentRows[0]) {
      return null;
    }

    const next = updater(mapClassroomRow(currentRows[0]));
    const updatedRows = await executor.unsafe<ClassroomRow>(
      `UPDATE classrooms
       SET owner_user_id = $2,
           organization_id = $3,
           room_version = $4,
           stage = $5::jsonb,
           scenes = $6::jsonb,
           updated_at = $7
       WHERE id = $1
       RETURNING ${CLASSROOM_COLUMNS}`,
      [
        id,
        next.ownerUserId,
        next.organizationId,
        next.roomVersion,
        JSON.stringify(next.stage),
        JSON.stringify(next.scenes),
        next.updatedAt,
      ],
    );

    return updatedRows[0] ? mapClassroomRow(updatedRows[0]) : null;
  });
}
