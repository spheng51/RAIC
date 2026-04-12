import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { runClassroomGenerationJob } from '@/lib/server/classroom-job-runner';
import { createClassroomGenerationJob } from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('GenerateClassroom API');

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  try {
    const auth = await requireRequestRole(req, ['teacher']);
    if ('status' in auth) {
      return auth;
    }

    const rawBody = (await req.json()) as Partial<GenerateClassroomInput>;
    requirementSnippet = rawBody.requirement?.substring(0, 60);
    const body: GenerateClassroomInput = {
      requirement: rawBody.requirement || '',
      ...(rawBody.pdfContent ? { pdfContent: rawBody.pdfContent } : {}),
      ...(rawBody.language ? { language: rawBody.language } : {}),
      ...(rawBody.enableWebSearch != null ? { enableWebSearch: rawBody.enableWebSearch } : {}),
      ...(rawBody.enableImageGeneration != null
        ? { enableImageGeneration: rawBody.enableImageGeneration }
        : {}),
      ...(rawBody.enableVideoGeneration != null
        ? { enableVideoGeneration: rawBody.enableVideoGeneration }
        : {}),
      ...(rawBody.enableTTS != null ? { enableTTS: rawBody.enableTTS } : {}),
      ...(rawBody.agentMode ? { agentMode: rawBody.agentMode } : {}),
    };
    const { requirement } = body;

    if (!requirement) {
      return apiErrorWithRequestSession(
        req,
        'MISSING_REQUIRED_FIELD',
        400,
        'Missing required field: requirement',
      );
    }

    const baseUrl = buildRequestOrigin(req);
    const jobId = nanoid(10);
    const job = await createClassroomGenerationJob(jobId, body, {
      organizationId: auth.organization?.id ?? null,
      userId: auth.user.id,
      actorRole: auth.session.role,
    });
    const pollUrl = `${baseUrl}/api/generate-classroom/${jobId}`;

    after(() =>
      runClassroomGenerationJob(jobId, body, baseUrl, {
        organizationId: auth.organization?.id ?? null,
        userId: auth.user.id,
      }),
    );

    return apiSuccessWithRequestSession(
      req,
      {
        jobId,
        status: job.status,
        step: job.step,
        message: job.message,
        pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    log.error(
      `Classroom generation job creation failed [requirement="${requirementSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiErrorWithRequestSession(
      req,
      'INTERNAL_ERROR',
      500,
      'Failed to create classroom generation job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
