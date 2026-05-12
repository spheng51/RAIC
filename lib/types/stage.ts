// Stage and Scene data types
import type { Slide } from '@/lib/types/slides';
import type { Action } from '@/lib/types/action';
import type { PBLProjectConfig } from '@/lib/pbl/types';
import type { GenerationCompletionStatus, GenerationWarning } from '@/lib/types/generation';

export type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl';

export type StageMode = 'autonomous' | 'playback';

export type Whiteboard = Omit<Slide, 'theme' | 'turningMode' | 'sectionTag' | 'type'>;
export type PresentationSurface = 'lesson' | 'simulation' | 'report';
export type SharedSimulationStatus = 'attached' | 'running' | 'completed' | 'error';
export type SharedSimulationCollaborationMode = 'single-controller' | 'multi-user';
export type SharedSimulationCollaborationState =
  | 'inactive'
  | 'live'
  | 'frozen'
  | 'closed'
  | 'error';

export interface ClassroomLiveMeeting {
  provider: 'zoom';
  source: 'manual-link';
  joinUrl: string;
  label?: string;
  attachedAt?: string;
  attachedByUserId?: string;
}

export interface SharedSimulation {
  provider: 'mirofish';
  simulationId: string;
  reportId?: string;
  runUrl: string;
  reportUrl?: string;
  authoring?: {
    source: 'manual-attach' | 'ai-guided';
    briefPreview?: string;
    createdAt: string;
  };
  activeSurface: PresentationSurface;
  controllerSessionId?: string;
  controllerRole: 'teacher' | 'student';
  controlLeaseExpiresAt?: string;
  collaborationMode?: SharedSimulationCollaborationMode;
  mirofishSessionId?: string;
  collaborationState?: SharedSimulationCollaborationState;
  allowStudentInteraction?: boolean;
  spotlightSessionId?: string;
  participantCount?: number;
  lastCollaborationSyncAt?: string;
  removedParticipantSessionIds?: string[];
  status: SharedSimulationStatus;
}

export interface ClassroomSourceContext {
  pdfAttached: boolean;
  pdfName?: string;
  tavilyEnabled: boolean;
  language: string;
  selectedModel: string;
}

/**
 * Stage - Represents the entire classroom/course
 */
export interface Stage {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  learningGoal?: string;
  // Stage metadata
  language?: string;
  languageDirective?: string;
  style?: string;
  sourceContext?: ClassroomSourceContext;
  // Whiteboard data
  whiteboard?: Whiteboard[];
  // Agent IDs selected when this classroom was created
  agentIds?: string[];
  /**
   * Server-generated agent configurations.
   * Embedded in persisted classroom JSON so clients can hydrate
   * the agent registry without relying on IndexedDB pre-population.
   * Only present for API-generated classrooms.
   */
  generatedAgentConfigs?: Array<{
    id: string;
    name: string;
    role: string;
    persona: string;
    avatar: string;
    color: string;
    priority: number;
  }>;
  generationCompletionStatus?: Exclude<GenerationCompletionStatus, 'failed'>;
  generationWarnings?: GenerationWarning[];
  sharedSimulation?: SharedSimulation;
  liveMeeting?: ClassroomLiveMeeting;
}

/**
 * Scene - Represents a single page/scene in the course
 */
export interface Scene {
  id: string;
  stageId: string; // ID of the parent stage (for data integrity checks)
  type: SceneType;
  title: string;
  order: number; // Display order

  // Type-specific content
  content: SceneContent;

  // Actions to execute during playback
  actions?: Action[];

  // Whiteboards to explain deeply
  whiteboards?: Slide[];

  // Multi-agent discussion configuration
  multiAgent?: {
    enabled: boolean; // Enable multi-agent for this scene
    agentIds: string[]; // Which agents to include (from registry)
    directorPrompt?: string; // Optional custom director instructions
  };

  // Metadata
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Scene content based on type
 */
export type SceneContent = SlideContent | QuizContent | InteractiveContent | PBLContent;

/**
 * Slide content - PPTist Canvas data
 */
export interface SlideContent {
  type: 'slide';
  // PPTist slide data structure
  canvas: Slide;
}

/**
 * Quiz content - React component props/data
 */
export interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];
}

export interface QuizOption {
  label: string; // Display text
  value: string; // Selection key: "A", "B", "C", "D"
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: QuizOption[];
  answer?: string[]; // Correct answer values: ["A"], ["A","C"], or undefined for text
  analysis?: string; // Explanation shown after grading
  commentPrompt?: string; // Grading guidance for text questions
  hasAnswer?: boolean; // Whether auto-grading is possible
  points?: number; // Points per question (default 1)
}

/**
 * Interactive content - Interactive web page (iframe)
 */
export interface InteractiveContent {
  type: 'interactive';
  url: string; // URL of the interactive page
  // Optional: embedded HTML content
  html?: string;
}

/**
 * PBL content - Project-based learning
 */
export interface PBLContent {
  type: 'pbl';
  projectConfig: PBLProjectConfig;
}

// Re-export generation types for convenience
export type {
  UserRequirements,
  SceneOutline,
  GenerationSession,
  GenerationProgress,
  UploadedDocument,
} from './generation';
