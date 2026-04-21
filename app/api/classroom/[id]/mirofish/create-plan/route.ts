import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess, type ClassroomAccessContext } from '@/lib/auth/classroom-access';
import { createLogger } from '@/lib/logger';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import {
  assertMiroFishAuthoringAvailable,
  generateMiroFishCreationSpec,
} from '@/lib/server/mirofish-authoring';
import { resolveModelFromHeadersWithScope } from '@/lib/server/resolve-model';
import { miroFishCreationPlanRequestSchema } from '@/lib/types/mirofish-authoring';

const log = createLogger('Classroom MiroFish Create Plan');

export const maxDuration = 120;

function buildSceneContext(access: ClassroomAccessContext, currentSceneId?: string) {
  if (!currentSceneId) {
    return undefined;
  }

  const scene = access.classroom.scenes.find((item) => item.id === currentSceneId);
  if (!scene) {
    return undefined;
  }

  return {
    sceneId: scene.id,
    sceneTitle: scene.title,
    sceneType: scene.type,
    teacherControls: [],
    misconceptionHooks: [],
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestRole(request, ['teacher']);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const { id } = await params;
    const access = await requireClassroomAccess(request, id);
    if (access instanceof NextResponse) {
      return access;
    }

    assertMiroFishAuthoringAvailable();

    const body = miroFishCreationPlanRequestSchema.parse(await request.json());
    const { model, modelInfo } = await resolveModelFromHeadersWithScope(request, {
      auth,
      organizationId: auth.organization?.id ?? auth.session.organizationId,
      userId: auth.user.id,
      mode: 'interactive',
    });

    const aiCall = async (systemPrompt: string, userPrompt: string) => {
      const result = await callLLM(
        {
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: Math.min(modelInfo?.outputWindow ?? 4096, 4096),
        },
        'mirofish-create-plan',
      );

      return result.text;
    };

    const { spec, promptPreview } = await generateMiroFishCreationSpec({
      ...body,
      stageName: access.classroom.stage.name || 'Untitled Classroom',
      sceneContext: buildSceneContext(access, body.currentSceneId),
      aiCall,
    });

    return apiSuccessWithRequestSession(request, {
      spec,
      promptPreview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      (error instanceof Error && error.name === 'ZodError') ||
      message.includes('disabled') ||
      message.includes('required') ||
      message.includes('not enabled')
        ? 400
        : 500;
    log.error('Failed to generate MiroFish creation plan:', error);
    return apiErrorWithRequestSession(
      request,
      status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      status,
      message,
    );
  }
}
