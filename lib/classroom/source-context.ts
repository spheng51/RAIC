import type { ClassroomSourceMode } from '@/lib/types/stage';

export function deriveClassroomSourceMode(input: {
  pdfAttached?: boolean;
  tavilyEnabled?: boolean;
}): ClassroomSourceMode {
  if (input.pdfAttached && input.tavilyEnabled) {
    return 'pdf-web';
  }
  if (input.pdfAttached) {
    return 'pdf';
  }
  if (input.tavilyEnabled) {
    return 'web';
  }
  return 'none';
}
