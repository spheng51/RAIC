import { NextRequest } from 'next/server';
import { parsePDF } from '@/lib/pdf/pdf-providers';
import { getRequestAuth } from '@/lib/auth/current-user';
import type { PDFProviderId } from '@/lib/pdf/types';
import type { ParsedPdfContent } from '@/lib/types/pdf';
import { createLogger } from '@/lib/logger';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  withRequestWebSession,
} from '@/lib/server/api-response';
import {
  resolveGovernedProviderConfig,
  toGovernedProviderApiErrorResponse,
} from '@/lib/server/ai-governance';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
const log = createLogger('Parse PDF');

export async function POST(req: NextRequest) {
  let pdfFileName: string | undefined;
  let resolvedProviderId: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      log.error('Invalid Content-Type for PDF upload:', contentType);
      return apiErrorWithRequestSession(
        req,
        'INVALID_REQUEST',
        400,
        `Invalid Content-Type: expected multipart/form-data, got "${contentType}"`,
      );
    }

    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File | null;
    const providerId = formData.get('providerId') as PDFProviderId | null;
    const apiKey = formData.get('apiKey') as string | null;
    const baseUrl = formData.get('baseUrl') as string | null;

    if (!pdfFile) {
      return apiErrorWithRequestSession(req, 'MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }

    // providerId is required from the client — no server-side store to fall back to
    const effectiveProviderId = providerId || ('unpdf' as PDFProviderId);
    pdfFileName = pdfFile?.name;
    resolvedProviderId = effectiveProviderId;

    const clientBaseUrl = baseUrl || undefined;
    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = await validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiErrorWithRequestSession(req, 'INVALID_URL', 403, ssrfError);
      }
    }

    const auth = await getRequestAuth(req);
    const resolved = await resolveGovernedProviderConfig({
      auth,
      family: 'pdf',
      providerId: effectiveProviderId,
      requestedSecret: apiKey || undefined,
      requestedBaseUrl: clientBaseUrl,
    });

    const config = {
      providerId: effectiveProviderId,
      apiKey: resolved.apiKey || undefined,
      baseUrl: resolved.baseUrl,
    };

    // Convert PDF to buffer
    const arrayBuffer = await pdfFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse PDF using the provider system
    const result = await parsePDF(config, buffer);

    // Add file metadata
    const resultWithMetadata: ParsedPdfContent = {
      ...result,
      metadata: {
        ...result.metadata,
        pageCount: result.metadata?.pageCount ?? 0, // Ensure pageCount is always a number
        fileName: pdfFile.name,
        fileSize: pdfFile.size,
      },
    };

    return apiSuccessWithRequestSession(req, { data: resultWithMetadata });
  } catch (error) {
    const governanceError = toGovernedProviderApiErrorResponse(error);
    if (governanceError) {
      return withRequestWebSession(req, governanceError);
    }

    log.error(
      `PDF parsing failed [provider=${resolvedProviderId ?? 'unknown'}, file="${pdfFileName ?? 'unknown'}"]:`,
      error,
    );
    return apiErrorWithRequestSession(
      req,
      'PARSE_FAILED',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
