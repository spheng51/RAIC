export interface ScheduledClassEvent {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes?: number;
  classroomId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledClassEventInput {
  title: string;
  startsAt: string;
  durationMinutes?: number | null;
  classroomId?: string | null;
}

export interface ScheduledClassGenerationInput {
  title: string;
  startsAt: string;
  durationMinutes?: number;
}
