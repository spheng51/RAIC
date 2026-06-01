import { type NextRequest } from 'next/server';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { sendDueDiscordScheduledClassReminders } from '@/lib/server/scheduled-classes';
import { createLogger } from '@/lib/logger';

const log = createLogger('DiscordScheduledClassRemindersCron');

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return (
      process.env.NODE_ENV !== 'production' &&
      process.env.CRON_ALLOW_NO_SECRET?.trim() === 'true' &&
      isLocalCronRequest(request)
    );
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function isLocalCronRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
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
