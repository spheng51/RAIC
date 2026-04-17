import type { ProviderId } from '@/lib/ai/providers';
import type { ProviderTransportMode } from '@/lib/types/provider';
import { isBrowserLocalTransport } from '@/lib/utils/provider-transport';

export type BrowserLocalUnsupportedFlow =
  | 'classroom-generation'
  | 'scene-generation'
  | 'quiz-grading'
  | 'pbl-chat';

interface BrowserLocalModelConfig {
  readonly providerId?: ProviderId | null;
  readonly providerName?: string | null;
  readonly transportMode?: ProviderTransportMode | null;
}

function getProviderLabel(modelConfig: BrowserLocalModelConfig): string {
  return modelConfig.providerName?.trim() || 'This provider';
}

export function getBrowserLocalUnsupportedFlowMessage(
  flow: BrowserLocalUnsupportedFlow,
  providerLabel: string,
): string {
  switch (flow) {
    case 'classroom-generation':
      return `${providerLabel} browser-local mode only supports QA and Discussion. Classroom generation still runs through server orchestration, so switch this provider back to server mode or use another model.`;
    case 'scene-generation':
      return `${providerLabel} browser-local mode only supports QA and Discussion. Scene generation, regeneration, and tool-backed classroom actions still run through server orchestration, so switch this provider back to server mode or use another model.`;
    case 'quiz-grading':
      return `${providerLabel} browser-local mode only supports QA and Discussion. AI quiz grading still runs through a server route, so switch this provider back to server mode or use another model.`;
    case 'pbl-chat':
      return `${providerLabel} browser-local mode only supports QA and Discussion. PBL chat still depends on server-side agents and tools, so switch this provider back to server mode or use another model.`;
    default:
      return `${providerLabel} browser-local mode only supports QA and Discussion for now.`;
  }
}

export function getBrowserLocalUnsupportedFlowGuard(
  modelConfig: BrowserLocalModelConfig,
  flow: BrowserLocalUnsupportedFlow,
): string | null {
  if (!isBrowserLocalTransport(modelConfig.providerId, modelConfig.transportMode)) {
    return null;
  }

  return getBrowserLocalUnsupportedFlowMessage(flow, getProviderLabel(modelConfig));
}
