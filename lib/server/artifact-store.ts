import 'server-only';

import { promises as fs } from 'fs';
import { writeJsonFileAtomic } from '@/lib/server/classroom-storage';
import { getDataPath } from '@/lib/server/data-root';

export interface ArtifactManifest {
  lessonId: string;
  artifacts: Array<{
    id: string;
    kind: 'audio' | 'image' | 'video' | 'slides' | 'html' | 'transcript' | 'other';
    path: string;
    contentType?: string;
    createdAt: string;
  }>;
  updatedAt: string;
}

function getArtifactManifestPath(lessonId: string) {
  return getDataPath('artifacts', lessonId, 'manifest.json');
}

export async function readArtifactManifest(lessonId: string): Promise<ArtifactManifest | null> {
  const manifestPath = getArtifactManifestPath(lessonId);
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as ArtifactManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeArtifactManifest(manifest: ArtifactManifest) {
  const manifestPath = getArtifactManifestPath(manifest.lessonId);
  await writeJsonFileAtomic(manifestPath, manifest);
  return manifest;
}
