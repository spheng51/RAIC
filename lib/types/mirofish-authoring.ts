import { z } from 'zod';

export const MIROFISH_ACTIVITY_TYPES = [
  'simulation',
  'investigation',
  'workspace',
  'concept-map',
  'data-story',
] as const;

export type MiroFishActivityType = (typeof MIROFISH_ACTIVITY_TYPES)[number];
export type MiroFishCreationSurface = 'lesson' | 'simulation';
export type MiroFishCreationCollaborationMode = 'single-controller' | 'multi-user';
export type MiroFishCreationJobStatus = 'queued' | 'running' | 'ready' | 'failed';

export const miroFishCreationPlanRequestSchema = z.object({
  goal: z.string().trim().min(12).max(1200),
  activityType: z.enum(MIROFISH_ACTIVITY_TYPES),
  targetAudience: z.string().trim().min(2).max(200),
  currentSceneId: z.string().trim().optional(),
  includeReport: z.boolean().optional().default(false),
  defaultSurface: z.enum(['lesson', 'simulation']).optional().default('simulation'),
  collaborationMode: z
    .enum(['single-controller', 'multi-user'])
    .optional()
    .default('single-controller'),
});

export type MiroFishCreationPlanRequest = z.infer<typeof miroFishCreationPlanRequestSchema>;

const optionalStringListSchema = z.array(z.string().trim().min(1)).max(6).default([]);
const activityStepListSchema = z.array(z.string().trim().min(1)).min(3).max(6);
const successCheckListSchema = z.array(z.string().trim().min(1)).min(2).max(6);

export const miroFishCreationSceneContextSchema = z
  .object({
    sceneId: z.string().trim().optional(),
    sceneTitle: z.string().trim().optional(),
    sceneType: z.enum(['slide', 'quiz', 'interactive', 'pbl']).optional(),
    teacherControls: optionalStringListSchema,
    misconceptionHooks: optionalStringListSchema,
    assessmentPolicy: z.string().trim().optional(),
  })
  .optional();

export type MiroFishCreationSceneContext = z.infer<typeof miroFishCreationSceneContextSchema>;

export const miroFishCreationSpecSchema = z.object({
  title: z.string().trim().min(1).max(180),
  brief: z.string().trim().min(12).max(1200),
  goal: z.string().trim().min(12).max(1200),
  activityType: z.enum(MIROFISH_ACTIVITY_TYPES),
  targetAudience: z.string().trim().min(2).max(200),
  includeReport: z.boolean(),
  defaultSurface: z.enum(['lesson', 'simulation']),
  collaborationMode: z.enum(['single-controller', 'multi-user']),
  teacherInstructions: activityStepListSchema,
  studentTasks: activityStepListSchema,
  successChecks: successCheckListSchema,
  reportFocus: optionalStringListSchema,
  authoringNotes: z.string().trim().max(600).optional(),
  sceneContext: miroFishCreationSceneContextSchema,
});

export type MiroFishCreationSpec = z.infer<typeof miroFishCreationSpecSchema>;

export const miroFishAuthoringResultSchema = z.object({
  status: z.enum(['queued', 'running', 'ready', 'failed']),
  simulationId: z.string().trim().optional(),
  reportId: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

export type MiroFishAuthoringResult = z.infer<typeof miroFishAuthoringResultSchema>;
