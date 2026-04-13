import { cookies } from 'next/headers';
import { apiSuccess } from '@/lib/server/api-response';
import { ACCESS_CODE_COOKIE_NAME, verifyAccessToken } from '@/lib/server/access-code';

export async function GET() {
  const accessCode = process.env.ACCESS_CODE?.trim() || '';
  if (!accessCode) {
    return apiSuccess({ enabled: false, authenticated: true });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_CODE_COOKIE_NAME)?.value ?? null;

  return apiSuccess({
    enabled: true,
    authenticated: token ? verifyAccessToken(token, accessCode) : false,
  });
}
