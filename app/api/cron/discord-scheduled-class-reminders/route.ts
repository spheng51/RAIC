import { type NextRequest } from 'next/server';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { sendDueDiscordScheduledClassReminders } from '@/lib/server/scheduled-classes';
import { createLogger } from '@/lib/logger';

const log = createLogger('DiscordScheduledClassRemindersCron');

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return apiError(API_ERROR_CODES.FORBIDDEN, 403, 'Forbidden');
  }

  try {
    const result = await sendDueDiscordScheduledClassReminders();
    return apiSuccess(result);
  } catch (error) {
    log.error('Failed to send Discord scheduled class reminders:', error);
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to send Discord scheduled class reminders',
      error instanceof Error ? error.message : String(error),
    );
  }
}
