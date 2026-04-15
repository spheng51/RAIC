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

## Non-Goals

- No new public API contracts for generation payloads.
- No automatic grading model swaps or external policy model changes during this slice.
- No new external provider onboarding in this slice.

## Acceptance Criteria

- New slice-specific benchmark before merge shows no more than the allowed `classroomStartToFirstSceneMs` regression versus last baseline.
- Coverage of adaptation decisions in unit/component tests.
- Measurable rubric improvement on a fixed internal prompt corpus without increased P95 classroom route latency.

## Rollback Condition

- Drop this slice if deterministic replay cannot be restored within two release cycles or if adaptation causes fallback rate to increase.
