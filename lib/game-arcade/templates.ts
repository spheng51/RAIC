import type { GameTemplateId } from '@/lib/types/generation';

export interface GameTemplateDefinition {
  id: GameTemplateId;
  label: string;
  shortLabel: string;
  description: string;
  promptHint: string;
  preferredControls: string[];
  qaExpectations: string[];
}

export const GAME_TEMPLATE_DEFINITIONS = [
  {
    id: 'physics-challenge',
    label: 'Physics Challenge',
    shortLabel: 'Physics',
    description: 'Aim, thrust, balance, timing, and trajectories.',
    promptHint:
      'Invent a physics/action challenge where the learner controls forces, angle, thrust, balance, or timing to reach a goal.',
    preferredControls: ['slider', 'aim-and-launch', 'thrust button', 'drag target'],
    qaExpectations: ['start control', 'score or progress HUD', 'safe initial state'],
  },
  {
    id: 'puzzle-lab',
    label: 'Puzzle Lab',
    shortLabel: 'Puzzle',
    description: 'Drag, sort, arrange, assemble, and classify.',
    promptHint:
      'Invent a hands-on puzzle where the learner manipulates pieces, categories, sequences, or systems to reveal the concept.',
    preferredControls: ['drag-and-drop', 'snap zones', 'reset button', 'hint button'],
    qaExpectations: ['draggable pieces', 'completion feedback', 'hint or retry path'],
  },
  {
    id: 'strategy-sim',
    label: 'Strategy Sim',
    shortLabel: 'Strategy',
    description: 'Turn decisions, resources, consequences, and tradeoffs.',
    promptHint:
      'Invent a strategic decision game where the learner chooses actions over turns and sees visible consequences.',
    preferredControls: ['choice buttons', 'resource counters', 'turn button', 'scenario cards'],
    qaExpectations: ['resource display', 'turn/progress display', 'visible consequences'],
  },
  {
    id: 'card-match',
    label: 'Card Match',
    shortLabel: 'Cards',
    description: 'Memory, matching, concept pairs, and quick recall.',
    promptHint:
      'Invent a replayable card or matching game that connects terms, examples, diagrams, causes, or outcomes.',
    preferredControls: ['flip cards', 'matching pairs', 'shuffle', 'combo feedback'],
    qaExpectations: ['card grid', 'score display', 'match feedback'],
  },
  {
    id: 'code-quest',
    label: 'Code Quest',
    shortLabel: 'Code',
    description: 'Debug, repair, predict, and run code challenges.',
    promptHint:
      'Invent a code-themed quest where the learner repairs logic, predicts output, or assembles snippets to solve a mission.',
    preferredControls: ['code blocks', 'run button', 'debug hint', 'test output panel'],
    qaExpectations: ['run or check button', 'output/status panel', 'hint or feedback path'],
  },
  {
    id: 'boss-review',
    label: 'Boss Review',
    shortLabel: 'Boss',
    description: 'A playful final challenge combining mini-game mechanics.',
    promptHint:
      'Invent a boss-style review challenge with rounds, power-ups, and mixed mechanics that recap the key concepts.',
    preferredControls: ['round selector', 'power-up button', 'progress meter', 'final challenge'],
    qaExpectations: ['round/progress display', 'score display', 'win condition'],
  },
] as const satisfies readonly GameTemplateDefinition[];

export const DEFAULT_GAME_TEMPLATE_ID: GameTemplateId = 'physics-challenge';

export function getGameTemplateDefinition(id: GameTemplateId | undefined): GameTemplateDefinition {
  return (
    GAME_TEMPLATE_DEFINITIONS.find((template) => template.id === id) ?? GAME_TEMPLATE_DEFINITIONS[0]
  );
}

export function formatGameTemplateForPrompt(id: GameTemplateId | undefined): string {
  const template = getGameTemplateDefinition(id);
  return [
    `Template: ${template.label}`,
    `Description: ${template.description}`,
    `Creative direction: ${template.promptHint}`,
    `Preferred controls: ${template.preferredControls.join(', ')}`,
    `QA expectations: ${template.qaExpectations.join(', ')}`,
  ].join('\n');
}
