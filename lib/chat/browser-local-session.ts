import type { UIMessage } from 'ai';
import type { BrowserLocalOpenAIMessage } from '@/lib/utils/browser-local-openai';
import type { ChatMessageMetadata, SessionConfig, SessionType } from '@/lib/types/chat';
import type { Stage, Scene } from '@/lib/types/stage';
import type { AgentConfig } from '@/lib/orchestration/registry/types';

interface BrowserLocalPromptContext {
  sessionType: SessionType;
  sessionConfig: Pick<SessionConfig, 'agentIds' | 'defaultAgentId' | 'triggerAgentId'>;
  messages: UIMessage<ChatMessageMetadata>[];
  agent: AgentConfig | null;
  stage: Stage | null;
  scenes: Scene[];
  currentSceneId: string | null;
  userProfile?: {
    nickname?: string;
    bio?: string;
  };
  discussionTopic?: string;
  discussionPrompt?: string;
}

function getMessageText(message: UIMessage<ChatMessageMetadata>): string {
  return message.parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }

      if (part.type === 'step-start') {
        return '';
      }

      return '';
    })
    .join('')
    .trim();
}

function buildStageContext(
  stage: Stage | null,
  scenes: Scene[],
  currentSceneId: string | null,
): string {
  const lines: string[] = [];

  if (stage?.name) {
    lines.push(`Stage: ${stage.name}`);
  }
  if (stage?.description) {
    lines.push(`Stage description: ${stage.description}`);
  }

  const currentScene = scenes.find((scene) => scene.id === currentSceneId) ?? null;
  if (currentScene) {
    lines.push(`Current scene: ${currentScene.title} (${currentScene.type})`);
  }

  return lines.join('\n');
}

function buildUserProfileContext(userProfile?: { nickname?: string; bio?: string }): string {
  if (!userProfile?.nickname && !userProfile?.bio) {
    return '';
  }

  const lines: string[] = [];
  if (userProfile.nickname) {
    lines.push(`User nickname: ${userProfile.nickname}`);
  }
  if (userProfile.bio) {
    lines.push(`User bio: ${userProfile.bio}`);
  }

  return lines.join('\n');
}

function buildSystemPrompt({
  agent,
  sessionType,
  stage,
  scenes,
  currentSceneId,
  userProfile,
}: Pick<
  BrowserLocalPromptContext,
  'agent' | 'sessionType' | 'stage' | 'scenes' | 'currentSceneId' | 'userProfile'
>): string {
  const sections: string[] = [];

  if (agent?.name) {
    sections.push(`You are ${agent.name}.`);
  }
  if (agent?.role) {
    sections.push(`Role: ${agent.role}.`);
  }
  if (agent?.persona) {
    sections.push(agent.persona.trim());
  }

  sections.push(
    'You are responding in Open-RAIC browser-local mode.',
    'This mode is single-agent, text-only, and limited to QA or discussion chat.',
    'Do not claim to use tools, whiteboards, scene generation, web search, multi-agent coordination, or any server-only workflow.',
    'If the user asks for unsupported work, explain that browser-local mode only supports QA and discussion text chat.',
  );

  if (sessionType === 'discussion') {
    sections.push('Keep the response conversational and discussion-oriented.');
  } else {
    sections.push('Answer the user directly and helpfully.');
  }

  const stageContext = buildStageContext(stage, scenes, currentSceneId);
  if (stageContext) {
    sections.push(`Classroom context:\n${stageContext}`);
  }

  const profileContext = buildUserProfileContext(userProfile);
  if (profileContext) {
    sections.push(`User context:\n${profileContext}`);
  }

  return sections.join('\n\n');
}

export function getBrowserLocalAgentId(
  sessionType: SessionType,
  sessionConfig: Pick<SessionConfig, 'agentIds' | 'defaultAgentId' | 'triggerAgentId'>,
): string | null {
  if (sessionType === 'discussion') {
    return sessionConfig.triggerAgentId || sessionConfig.agentIds[0] || null;
  }

  return sessionConfig.defaultAgentId || sessionConfig.agentIds[0] || null;
}

export function buildBrowserLocalChatMessages(
  context: BrowserLocalPromptContext,
): BrowserLocalOpenAIMessage[] {
  const messages: BrowserLocalOpenAIMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(context),
    },
  ];

  for (const message of context.messages) {
    const text = getMessageText(message);
    if (!text) {
      continue;
    }

    if (message.role === 'user') {
      messages.push({ role: 'user', content: text });
      continue;
    }

    if (message.role === 'assistant') {
      messages.push({ role: 'assistant', content: text });
    }
  }

  if (
    context.sessionType === 'discussion' &&
    messages.filter((message) => message.role !== 'system').length === 0
  ) {
    const promptLines = [
      `Start the discussion as ${context.agent?.name || 'the selected classroom agent'}.`,
    ];

    if (context.discussionTopic) {
      promptLines.push(`Topic: ${context.discussionTopic}`);
    }
    if (context.discussionPrompt) {
      promptLines.push(`Guidance: ${context.discussionPrompt}`);
    }

    messages.push({
      role: 'user',
      content: promptLines.join('\n'),
    });
  }

  return messages;
}
