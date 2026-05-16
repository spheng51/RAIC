# Feature Brief: Adaptive Classroom Intelligence

## Intent

Deliver differentiated classroom behavior that adapts to student progression and prior session context while preserving existing learning workflows.

## Problem Statement

Current sessions are strong for static content delivery but use mostly generic adaptation rules. The next iteration should improve classroom pacing and agent behavior across repeated usage while remaining deterministic and backward-compatible.

## User Stories

- As a learner, I want each classroom to adapt activity order when I repeat a topic so the pace matches my prior success level.
- As a teacher, I want classroom continuity across sessions so I can continue where students last left off.
- As a maintainer, I want deterministic context reuse so I can reproduce quality improvements in CI and local replay.

## Proposed Capabilities

1. Classroom context memory primitives that capture:
   - Last completed segment
   - Mastery hints for user cohort patterns
   - Revisit and remediation intents
2. Adaptive pacing policy that chooses next-step intensity from captured context.
3. Lightweight quality metrics that score adaptation quality against a fixed prompt corpus before merge.

## v0.3.0 Release Slice

- Activate the teacher-only repeated-session path using automatic session progress capture plus optional session reflection.
- Reuse adaptive context in server classroom generation, scene regeneration, PBL chat, and classroom chat without changing public or student API contracts.
- Keep the path fail-open: missing context, first-run classrooms, public demo flows, anonymous access, student access, and classroom-cookie-only access must continue without adaptive prompt sections.
- Defer Provider Composer, Discord scheduled-class sync, and student-facing analytics until later milestones.

## Non-Goals

- No new public API contracts for generation payloads.
- No automatic grading model swaps or external policy model changes during this slice.
- No new external provider onboarding in this slice.

## Acceptance Criteria

- New slice-specific benchmark before merge shows no more than the allowed `classroomStartToFirstSceneMs` regression versus last baseline.
- Coverage of adaptation decisions in unit/component tests.
- Measurable rubric improvement on a fixed internal prompt corpus without increased P95 classroom route latency.

## Slice C Deterministic Replay Gate

- Replay coverage stays model-free and fixture-backed. It scores only persisted session-context plus latest reflection inputs that already exist in the teacher runtime path.
- Required positive replay cases:
  - teacher repeated-session `/api/chat`
  - teacher repeated-session `/api/pbl/chat`
  - teacher repeated-session scene regeneration
- Required fail-open cases:
  - teacher first-run classrooms
  - public demo flows
  - anonymous flows
  - student flows
  - classroom-cookie-only flows
- Required positive signals:
  - last completed segment
  - mastery hints
  - revisit or remediation intent
  - latest reflection summary
- Required negative signals:
  - no adaptive prompt section or repeated-session markers in first-run, public, anonymous, student, or classroom-cookie flows
- Slice C passes only when every deterministic replay case passes and the existing reconnect, reflection reset, benchmark gating, provider-profile merge, and MiroFish regressions remain green.

## Rollback Condition

- Drop this slice if deterministic replay cannot be restored within two release cycles or if adaptation causes fallback rate to increase.
