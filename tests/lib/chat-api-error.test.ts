import { describe, expect, it } from 'vitest';
import { formatChatApiError, getUserFacingChatErrorMessage } from '@/lib/chat/chat-api-error';

describe('formatChatApiError', () => {
  it('extracts readable API errors from JSON responses', async () => {
    const response = new Response(
      JSON.stringify({
        success: false,
        errorCode: 'INVALID_REQUEST',
        error: 'Classroom not found',
      }),
      {
        status: 404,
        headers: { 'content-type': 'application/json' },
      },
    );

    await expect(formatChatApiError(response)).resolves.toBe(
      'API error: 404 - Classroom not found',
    );
  });

  it('includes details when the API provides them', async () => {
    const response = new Response(
      JSON.stringify({
        error: 'Failed to process request',
        details: 'Model is unavailable',
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    );

    await expect(formatChatApiError(response)).resolves.toBe(
      'API error: 500 - Failed to process request: Model is unavailable',
    );
  });

  it('maps classroom lookup failures to a friendly chat message', () => {
    expect(getUserFacingChatErrorMessage(new Error('API error: 404 - Classroom not found'))).toBe(
      'This classroom could not be found. Reopen the classroom, then try chat again.',
    );
  });

  it('maps classroom auth failures to a friendly chat message', () => {
    expect(
      getUserFacingChatErrorMessage(new Error('API error: 401 - Classroom access required')),
    ).toBe('Chat needs a valid classroom session. Re-enter or sign in, then try again.');
  });
});
