import { describe, expect, it } from 'vitest';
import { computePlaybackView } from '@/lib/playback/derived-state';

describe('computePlaybackView', () => {
  it('surfaces browser-local reasoning text through the agent bubble before visible content arrives', () => {
    const result = computePlaybackView({
      engineMode: 'live',
      lectureSpeech: null,
      liveSpeech: null,
      speakingAgentId: 'default-1',
      thinkingState: {
        stage: 'agent_loading',
        agentId: 'default-1',
        text: 'Thinking through the answer...',
      },
      isCueUser: false,
      isTopicPending: false,
      chatIsStreaming: true,
      discussionTrigger: null,
      playbackCompleted: false,
      idleText: null,
      speakingStudent: true,
      sessionType: 'qa',
    });

    expect(result.sourceText).toBe('Thinking through the answer...');
    expect(result.bubbleRole).toBe('agent');
    expect(result.activeRole).toBe('agent');
  });
});
