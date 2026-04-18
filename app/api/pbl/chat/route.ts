/**
 * PBL Runtime Chat API
 *
 * Handles @mention routing during PBL runtime.
 * Students @question or @judge an agent, and this endpoint generates a response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { callLLM } from '@/lib/ai/llm';
import type { PBLAgent, PBLIssue } from '@/lib/pbl/types';
import { createLogger } from '@/lib/logger';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { loadTeacherAdaptivePrompt } from '@/lib/server/adaptive-runtime-prompt';
import { toGovernedProviderApiErrorResponse } from '@/lib/server/ai-governance';
import { resolveModelFromHeadersWithScope } from '@/lib/server/resolve-model';
const log = createLogger('PBL Chat');

interface PBLChatRequest {
  classroomId: string;
  message: string;
  agent: PBLAgent;
  currentIssue: PBLIssue | null;
  recentMessages: { agent_name: string; message: string }[];
  userRole: string;
  agentType?: 'question' | 'judge';
}

export async function POST(req: NextRequest) {
  let agentName: string | undefined;
  let resolvedAgentType: string | undefined;
  try {
    const body = (await req.json()) as PBLChatRequest;
    const { classroomId, message, agent, currentIssue, recentMessages, userRole, agentType } = body;
    agentName = agent?.name;
    resolvedAgentType = agentType;

    if (!classroomId || !message || !agent) {
      return apiErrorWithRequestSession(
        req,
        'MISSING_REQUIRED_FIELD',
        400,
        'Classroom ID, message, and agent are required',
      );
    }

    const access = await requireClassroomAccess(req, classroomId);
    if (access instanceof NextResponse) {
      return access;
    }

    const adaptivePrompt = await loadTeacherAdaptivePrompt({
      classroomId,
      access,
      onError: (error) => log.warn(`Adaptive PBL context unavailable for ${classroomId}:`, error),
    });

    // Get model config from headers
    const { model } = await resolveModelFromHeadersWithScope(req, {
      auth: access.auth,
      organizationId: access.auth.organization?.id ?? null,
      userId: access.auth.user.id,
    });

    // Build context for the agent, differentiating question vs judge
    let issueContext = '';
    if (currentIssue) {
      issueContext = `\n\n## Current Issue\nTitle: ${currentIssue.title}\nDescription: ${currentIssue.description}\nPerson in Charge: ${currentIssue.person_in_charge}`;
      if (currentIssue.generated_questions) {
        if (agentType === 'judge') {
          issueContext += `\n\nQuestions to Evaluate Against:\n${currentIssue.generated_questions}`;
        } else {
          issueContext += `\n\nGenerated Questions:\n${currentIssue.generated_questions}`;
        }
      }
    }

    const recentContext =
      recentMessages.length > 0
        ? `\n\n## Recent Conversation\n${recentMessages
            .slice(-5)
            .map((m) => `${m.agent_name}: ${m.message}`)
            .join('\n')}`
        : '';

    const systemPrompt = `${agent.system_prompt}${
      adaptivePrompt ? `\n\n${adaptivePrompt}` : ''
    }${issueContext}${recentContext}${userRole ? `\n\nThe student's role is: ${userRole}` : ''}`;

    const result = await callLLM(
      {
        model,
        system: systemPrompt,
        prompt: message,
      },
      'pbl-chat',
    );

    return apiSuccessWithRequestSession(req, { message: result.text, agentName: agent.name });
  } catch (error) {
    log.error(
      `PBL chat failed [agent="${agentName ?? 'unknown'}", type=${resolvedAgentType ?? 'question'}]:`,
      error,
    );
    const governanceError = toGovernedProviderApiErrorResponse(error);
    if (governanceError) {
      return withRequestWebSession(req, governanceError);
    }
    return apiErrorWithRequestSession(
      req,
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
