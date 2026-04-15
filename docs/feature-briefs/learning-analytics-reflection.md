# Feature Brief: Learning Analytics + Reflection

## Intent

Increase originality by adding post-session quality signals and learner reflection capture in a way that improves future classroom adaptation and reporting quality.

## User Stories

- As a learner, I want a simple reflection checkpoint after each session so I can capture what was challenging.
- As a teacher, I want class quality signals surfaced in-session to guide adjustments on the next generation.
- As an operator, I want stable aggregate signals that can later feed a classroom recommendation loop.

## Proposed Capabilities

1. Add lightweight in-session reflection events and metadata capture.
2. Add optional recap quality summary for internal experimentation (private and non-PHI).
3. Add deterministic reporting fixtures used by offline quality checks.

## Non-Goals

- No persistent learner-identifying storage changes in the first slice.
- No external analytics pipeline until privacy and retention decisions are finalized.
- No new public schema changes to classroom routes.

## Acceptance Criteria

- Reflection capture and quality telemetry are test-covered and off by default for anonymous/public flows.
- No runtime API contract break for classroom state endpoints.
- Baseline/performance checks pass and replay artifacts remain deterministic.

## Rollback Condition

- Revert the slice if reflection capture causes class start latency to exceed `classroomReuseReconnectMs` threshold in baseline runs.
