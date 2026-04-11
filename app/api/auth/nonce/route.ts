import { NextResponse } from 'next/server';
import { attachNonceCookie, createNonceToken } from '@/lib/auth/session';

export async function GET() {
  const nonce = createNonceToken();
  const response = NextResponse.json({
    success: true,
    nonce,
  });
  attachNonceCookie(response, nonce);
  return response;
}
