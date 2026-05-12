export async function formatChatApiError(response: Response): Promise<string> {
  const prefix = `API error: ${response.status}`;
  const text = await response.text();
  if (!text.trim()) {
    return prefix;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const looksJson = contentType.includes('application/json') || text.trimStart().startsWith('{');

  if (looksJson) {
    try {
      const body = JSON.parse(text) as {
        error?: unknown;
        details?: unknown;
        message?: unknown;
      };
      const main =
        typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string'
            ? body.message
            : null;
      const details = typeof body.details === 'string' ? body.details : null;
      const readable = [main, details].filter(Boolean).join(': ');

      if (readable) {
        return `${prefix} - ${readable}`;
      }
    } catch {
      // Fall through to the raw body below when the response is not parseable JSON.
    }
  }

  return `${prefix} - ${text}`;
}

export function getUserFacingChatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('classroom not found') || normalized.includes('api error: 404')) {
    return 'This classroom could not be found. Reopen the classroom, then try chat again.';
  }

  if (
    normalized.includes('classroom access required') ||
    normalized.includes('classroom session is invalid') ||
    normalized.includes('classroom session does not match') ||
    normalized.includes('api error: 401')
  ) {
    return 'Chat needs a valid classroom session. Re-enter or sign in, then try again.';
  }

  if (normalized.includes('do not have permission') || normalized.includes('api error: 403')) {
    return 'You do not have permission to chat in this classroom.';
  }

  if (normalized.includes('api key is required') || normalized.includes('missing_api_key')) {
    return 'Set up a model API key before chatting.';
  }

  if (message.trim()) {
    return message;
  }

  return 'Chat failed. Please try again.';
}
