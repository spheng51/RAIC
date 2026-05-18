/**
 * Generation Types - Two-Stage Content Generation System
 *
 * Stage 1: User requirements + documents → Scene Outlines (per-page)
 * Stage 2: Scene Outlines → Full Scenes (slide/quiz/interactive/pbl with actions)
 */

import type { ActionType } from './action';
import type { MediaGenerationRequest } from '@/lib/media/types';
import type { WidgetConfig, TeacherAction, WidgetType } from './widgets';

export type ExperiencePreset = 'historical-vlogger';

// ==================== PDF Image Types ====================

/**
 * Image extracted from PDF with metadata
 */
export interface PdfImage {
  id: string; // e.g., "img_1", "img_2"
  src: string; // base64 data URL (empty when stored in IndexedDB)
  pageNumber: number; // Page number in PDF
  description?: string; // Optional description for AI context
  storageId?: string; // Reference to IndexedDB (session_xxx_img_1)
  width?: number; // Image width (px or normalized)
  height?: number; // Image height (px or normalized)
}

/**
 * Image mapping for post-processing: image_id → base64 URL
 */
export type ImageMapping = Record<string, string>;

// ==================== Stage 1 Input ====================

export interface AudienceProfile {
  gradeLevel: string; // "K-12", "University", "Professional"
  ageRange?: string; // "6-12", "18-25"
  prerequisites?: string[]; // Required prior knowledge
  learningStyles?: ('visual' | 'auditory' | 'kinesthetic' | 'reading')[];
}

export interface StylePreferences {
  tone: 'formal' | 'casual' | 'engaging' | 'academic';
  visualStyle: 'minimalist' | 'colorful' | 'professional' | 'playful';
  interactivityLevel: 'low' | 'medium' | 'high';
  includeExamples: boolean;
  includePractice: boolean;
  language: string; // 'zh-CN', 'en-US'
}

export interface UploadedDocument {
  id: string;
  name: string; // Original filename
  type: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'image' | 'other';
  size: number; // Bytes
  uploadedAt: Date;
  contentSummary?: string; // Placeholder for parsing
  extractedTopics?: string[]; // Placeholder for parsing
  pageCount?: number;
  storageRef?: string;
}

/**
 * Simplified user requirements for course generation
 * All details (topic, duration, style, etc.) should be included in the requirement text
 */
export interface UserRequirements {
  requirement: string; // Single free-form text for all user input
  language: 'zh-CN' | 'en-US'; // Course language - critical for generation
  userNickname?: string; // Student nickname for personalization
  userBio?: string; // Student background for personalization
  experiencePreset?: ExperiencePreset; // Optional course experience preset
  webSearch?: boolean; // Enable web search for richer context
  interactiveMode?: boolean; // Enable widget-first Deep Interactive generation
  creationMode?: 'course' | 'game-arcade'; // Course generation mode
  gameTemplateId?: GameTemplateId; // Template arcade choice for classroom games
  gameCreativeBrief?: string; // Game-specific creative direction
}

/**
 * @deprecated Use UserRequirements instead
 * Legacy structured requirements - kept for backward compatibility
 */
export interface LegacyUserRequirements {
  topic: string;
  description?: string;
  learningObjectives: string[];
  audience: AudienceProfile;
  durationMinutes: number;
  style: StylePreferences;
  documents?: UploadedDocument[];
  additionalNotes?: string;
}

// ==================== Stage 1 Output: Scene Outlines (Simplified) ====================

/**
 * Widget outline configuration for interactive scenes.
 */
export interface WidgetOutline {
  concept?: string;
  keyVariables?: string[]; // simulation
  diagramType?: 'flowchart' | 'mindmap' | 'hierarchy' | 'system'; // diagram
  language?: 'python' | 'javascript' | 'typescript' | 'java' | 'cpp'; // code
  gameType?: 'quiz' | 'puzzle' | 'strategy' | 'card' | 'action'; // game
  gameTemplateId?: GameTemplateId; // game
  gameGoal?: string; // game
  coreMechanic?: string; // game
  difficultyCurve?: 'gentle' | 'standard' | 'spiky'; // game
  visualizationType?: 'molecular' | 'solar' | 'anatomy' | 'geometry' | 'physics' | 'custom';
  objects?: string[]; // visualization3d
  interactions?: string[]; // visualization3d
  challenge?: string; // game
  playerControls?: string[]; // game
  nodeCount?: number; // diagram
  challengeType?: string; // code
}

export type GameTemplateId =
  | 'physics-challenge'
  | 'puzzle-lab'
  | 'strategy-sim'
  | 'card-match'
  | 'code-quest'
  | 'boss-review';

/**
 * Simplified scene outline
 * Gives AI more freedom, only requiring intent description and key points
 */
export interface SceneOutline {
  id: string;
  type: 'slide' | 'quiz' | 'interactive' | 'pbl';
  title: string;
  description: string; // 1-2 sentences describing the purpose
  keyPoints: string[]; // 3-5 core key points
  teachingObjective?: string;
  estimatedDuration?: number; // seconds
  order: number;
  language?: 'zh-CN' | 'en-US'; // Generation language (inherited from requirements)
  languageNote?: string; // Optional per-scene language nuance from outline generation
  experiencePreset?: ExperiencePreset; // Optional course experience preset
  // Suggested image IDs (from PDF-extracted images)
  suggestedImageIds?: string[]; // e.g., ["img_1", "img_3"]
  // AI-generated media requests (when PDF images are insufficient)
  mediaGenerations?: MediaGenerationRequest[]; // e.g., [{ type: 'image', prompt: '...', elementId: 'gen_img_1' }]
  // Quiz-specific config
  quizConfig?: {
    questionCount: number;
    difficulty: 'easy' | 'medium' | 'hard';
    questionTypes: ('single' | 'multiple' | 'text')[];
  };
  /**
   * @deprecated Use widgetType + widgetOutline for Deep Interactive scenes.
   * Legacy interactive config remains supported for existing classrooms.
   */
  interactiveConfig?: {
    conceptName: string;
    conceptOverview: string;
    designIdea: string;
    subject?: string;
  };
  // Deep Interactive widget fields
  widgetType?: WidgetType;
  widgetOutline?: WidgetOutline;
  // PBL-specific config
  pblConfig?: {
    projectTopic: string;
    projectDescription: string;
    targetSkills: string[];
    issueCount?: number;
    language: 'zh-CN' | 'en-US';
  };
}

export type GenerationCompletionStatus = 'complete' | 'partial' | 'failed';

export type SceneFailureStage = 'content' | 'actions' | 'create';

export interface SceneExecutionPolicy {
  concurrency: number;
  maxAttempts: number;
  retryDelaysMs: number[];
  retryableErrorCodes: string[];
}

export interface SceneOutcome {
  index: number;
  title: string;
  status: 'generated' | 'failed';
  stage: SceneFailureStage;
  sceneId?: string;
  attempts: number;
  retryable: boolean;
  code: string;
  message: string;
}

export interface GenerationWarning {
  stage: 'scene' | 'media' | 'tts';
  code: string;
  message: string;
  sceneIndex?: number;
  sceneTitle?: string;
  sceneId?: string;
  elementId?: string;
  actionId?: string;
  retryable: boolean;
  attempts: number;
}

export interface SceneGenerationSummary {
  sceneIds: string[];
  totalScenes: number;
  generatedScenes: number;
  failedScenes: number;
  completionStatus: GenerationCompletionStatus;
  warnings: GenerationWarning[];
  sceneOutcomes: SceneOutcome[];
}

// ==================== Stage 3 Output: Generated Content ====================

import type { PPTElement, SlideBackground } from './slides';
import type { QuizQuestion } from './stage';

/**
 * AI-generated slide content
 */
export interface GeneratedSlideContent {
  elements: PPTElement[];
  background?: SlideBackground;
  remark?: string;
}

/**
 * AI-generated quiz content
 */
export interface GeneratedQuizContent {
  questions: QuizQuestion[];
}

// ==================== PBL Generation Types ====================

import type { PBLProjectConfig } from '@/lib/pbl/types';

/**
 * AI-generated PBL content
 */
export interface GeneratedPBLContent {
  projectConfig: PBLProjectConfig;
}

// ==================== Interactive Generation Types ====================

/**
 * Scientific model output from scientific modeling stage
 */
export interface ScientificModel {
  core_formulas: string[];
  mechanism: string[];
  constraints: string[];
  forbidden_errors: string[];
}

/**
 * AI-generated interactive content
 */
export interface GeneratedInteractiveContent {
  html: string;
  scientificModel?: ScientificModel;
  widgetType?: WidgetType;
  widgetConfig?: WidgetConfig;
  teacherActions?: TeacherAction[];
}

// ==================== Legacy Types (for compatibility) ====================

export interface SuggestedSlideElement {
  type: 'text' | 'image' | 'shape' | 'chart' | 'latex' | 'line';
  purpose: 'title' | 'subtitle' | 'content' | 'example' | 'diagram' | 'formula' | 'highlight';
  contentHint: string;
  position?: 'top' | 'center' | 'bottom' | 'left' | 'right';
  chartType?: 'bar' | 'line' | 'pie' | 'radar';
  textOutline?: string[];
}

export interface SuggestedQuizQuestion {
  type: 'single' | 'multiple' | 'short_answer';
  questionOutline: string;
  suggestedOptions?: string[];
  targetConceptId?: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface SuggestedAction {
  type: ActionType;
  description: string;
  timing?: 'start' | 'middle' | 'end' | 'after-content';
}

// ==================== Generation Session ====================

export interface GenerationProgress {
  currentStage: 1 | 2 | 3;
  overallProgress: number; // 0-100
  stageProgress: number; // 0-100
  statusMessage: string;
  scenesGenerated: number;
  totalScenes: number;
  errors?: string[];
}

export interface GenerationSession {
  id: string;
  requirements: UserRequirements;
  sceneOutlines?: SceneOutline[];
  progress: GenerationProgress;
  startedAt: Date;
  completedAt?: Date;
  generatedStageId?: string;
}
