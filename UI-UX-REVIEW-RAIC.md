# UI/Design UX Review: RAIC Creation-to-Classroom Flow

Date: 2026-04-11  
Scope: Accessibility-first UX refinement across Home → Generation Preview → Classroom runtime  
Coverage: interaction clarity, consistency, accessibility, mobile responsiveness, motion/feedback

---

## Outcomes
- Findings are prioritized by release impact (**P0/P1/P2**).
- Every finding includes concrete file-level references and actionable remediation.
- No feature expansion is proposed; recommendations preserve existing architecture and styling direction.

---

## 1) Journey-level mapping (evidence-based)

### 1.1 Home generation flow (`app/page.tsx`)

- **Primary actions**
  1. Sign in / profile setup via header and greeting controls.
  2. Configure generation via controls and toolbar.
  3. Provide source materials (text/file upload).
  4. Trigger generation and review generation status.
- **Secondary actions**
  - Open settings/export menu.
  - Toggle presentation/search/model/language options.
  - Theme toggle and advanced options.
- **Loading/completion states**
  - Generation button/loading states and preview handoff are present.
  - Visual progress cues are primarily motion-heavy in key hero/generation surfaces.
- **Error/recovery states**
  - Failures are likely surfaced via toasts and disabled interactions in controls.
  - Keyboard recovery is partial when interaction relies on icon-only or non-semantic controls.
- **Exit/cancel**
  - Exit paths mostly via top-level nav/actions.
  - Cancel behavior exists but should be more keyboard-visible (clear labels/status).

### 1.2 Preview-to-classroom transition (`app/generation-preview/page.tsx`)

- **Primary actions**
  1. Inspect generated scene preview and metadata.
  2. Continue into classroom route.
- **Secondary actions**
  - Reconfigure settings and reopen generation context.
  - Retry flow from generation error states.
- **Loading/completion states**
- Uses animated transitions for handoff and state changes.
- **Error/recovery states**
  - Retry actions likely available; needs clearer focus visibility and status communication.
- **Exit/cancel**
  - Back/cancel affordances should preserve focus order from preview to home.

### 1.3 Classroom runtime (`app/classroom/[id]/page.tsx`)

- **Primary actions**
  1. Enter room context.
  2. Use scene/chat interfaces via stage and controls.
  3. Access sidebars, chat, and scene controls.
- **Secondary actions**
  - Retry load flow.
  - Sidebar toggles, compactness preferences.
- **Loading/completion states**
  - Dedicated loading and error states exist.
- **Error/recovery states**
  - Retry path exists; improve announcement and focus restore after errors.
- **Exit/cancel**
  - Classroom exit/leave behavior should return focus to entry control in previous page.

### 1.4 Teacher studio + join/admin/sign-in

- Teacher studio (`app/(teacher)/studio/page.tsx`) has a clean structural flow but inherits shared controls quality from header/stage/chat patterns.
- Student join (`app/(student)/join/[joinCode]/page.tsx`) and sign-in (`app/sign-in/page.tsx`) are mostly route-structured correctly.
- Unauthorized (`app/unauthorized/page.tsx`) is straightforward but lacks enhanced keyboard-first explanation and landmarking.

---

## 2) Prioritized findings

### P0 (Release blockers)
**None identified as hard blockers in this pass.**

No immediate single-point functional regressions were observed, but several accessibility and interaction issues materially affect keyboard/screen-reader users and should be treated as **urgent P1**.

### P1 (High-priority UX friction / accessibility gaps)

1) **Icon-only interactive controls are missing accessible names**
- **Files**
  - `app/page.tsx`: top toolbar/home controls (theme toggle, settings, export menu trigger, certain prompt/toolbar actions)
  - `components/header.tsx`: back/home and other icon actions
  - `components/generation/generation-toolbar.tsx`: file upload/clear/search controls
  - `components/chat/chat-area.tsx`: collapse/open chat control
- **Impact**
  - Screen-reader users hear unlabeled/ambiguous buttons.
  - Keyboard users cannot infer action intent quickly.
- **Reproduction**
  1. Launch with screen reader and navigate controls with rotor/listing.
  2. Inspect icon-only button announcements in header and toolbar.
  3. Verify names are not descriptive enough.
- **Remediation**
  - Add explicit `aria-label` to all icon-only buttons/menus.
  - Keep visible labels where possible when affordance is primary.
  - Use consistent helper text/`title` parity only as secondary.
- **Component-level spec**
  - Create a simple rule: any icon-only control must define `aria-label`.
  - Add lint-like audit checklist in code review for every control in `generation-toolbar`, `header`, `chat-area`, and home action clusters.

2) **Non-semantic clickable regions break keyboard access**
- **Files**
  - `app/page.tsx`: avatar/name trigger wrappers around user menu/open panel interactions (line areas with `onClick` on non-button elements).
  - `components/generation/generation-toolbar.tsx`: drop zone built from non-semantic `<div>` with click/drag handlers.
- **Impact**
  - Mouse-only interactions; keyboard activation/activation roles absent.
- **Reproduction**
  1. Use `Tab` navigation only.
  2. Attempt to open the avatar/menu or drag/drop zone action without mouse.
  3. Verify no activation with Space/Enter.
- **Remediation**
  - Replace wrappers with `button` or component `Button`.
  - If custom hit area is required, apply `role="button"`, `tabIndex={0}`, `onKeyDown` (Space/Enter handling), and visible focus style.

3) **Reduced-motion handling missing for decorative/ambient animations**
- **Files**
  - `app/page.tsx` (animated hero/transition effects)
  - `app/generation-preview/page.tsx` (motion/pulses/transitions)
  - `app/globals.css` (global keyframe declarations)
- **Impact**
  - Motion-heavy users with vestibular sensitivity can suffer discomfort; task focus diluted by persistent ambient movement.
- **Reproduction**
  1. Enable OS/OS app reduced-motion.
  2. Open home and preview pages.
  3. Verify decorative motion is disabled or significantly toned down.
- **Remediation**
  - Add `@media (prefers-reduced-motion: reduce)` to disable/shorten ambient animations and long durations.
  - Keep one high-signal transition for task completion only; remove decorative infinite motion.

4) **Inconsistent heading/landmark structure for assistive navigation**
- **Files**
  - `app/page.tsx`, `app/generation-preview/page.tsx`, `app/classroom/[id]/page.tsx`
- **Impact**
  - Screen-reader users have weaker orientation in the multi-step flow.
- **Reproduction**
  1. Read landmarks/headings with keyboard + screen-reader shortcut mode.
  2. Verify unique page title/section headings per route.
- **Remediation**
  - Ensure `<main>` per route with coherent heading hierarchy (`h1` once, then logical `h2/h3`).
  - Replace purely decorative wrappers with semantic sections/landmarks where appropriate.

### P2 (Polish / consistency / quality)

1) **Interaction hierarchy and microcopy consistency drift**
- **Files**
  - `components/generation/generation-toolbar.tsx`
  - `components/header.tsx`
  - `components/stage.tsx`
  - `components/chat/chat-area.tsx`
- **Issue**
  - Button hierarchy (primary/secondary/ghost) and spacing rhythm vary by component context.
- **Fix**
  - Define local variants map per interaction class:
    - Primary = primary submit/advance
    - Secondary = alternate actions
    - Ghost = utility/tertiary
  - Apply consistent `gap`/padding rhythm and icon+label order.

2) **Focus states on mixed interaction primitives**
- **Files**
  - All key files listed above, plus `components/ui/button.tsx`
- **Issue**
  - Core Button has strong visible focus, while custom/non-button controls do not.
- **Fix**
  - Standardize any custom control to use shared focus styles and tokenized ring treatment.
  - Add explicit `focus-visible` patterns for non-button components if unavoidable.

3) **Error/retry feedback could be made more explicit**
- **Files**
  - `app/classroom/[id]/page.tsx`, generation flow pages
- **Issue**
  - Error UI appears but screen-reader announcement and focus restoration are inconsistent.
- **Fix**
  - Add `role="status"` for transient errors and set focus to retry/action control after mount.

4) **Mobile layout overflow risk in action clusters**
- **Files**
  - `components/generation/generation-toolbar.tsx`
  - `app/page.tsx`
- **Issue**
  - Dense icon/tool clusters may wrap unexpectedly.
- **Fix**
  - Introduce responsive collapse thresholds and two-row wrapping controls.
  - Validate at 375/768/1280 and clamp icon density.

---

## 3) Component-level consistency guidance

### 3.1 Cross-cutting control contract (apply to toolbar/header/stage/chat-stage surfaces)
- **Rule A**: Icon-only controls require text alternatives (`aria-label`, visible tooltip only if icon-only is necessary).
- **Rule B**: All interactive controls must be keyboard focusable and show visible focus.
- **Rule C**: Hover/active/disabled styling should be visually coherent across components (`disabled` desaturates + reduced pointer intent).
- **Rule D**: Button hierarchy must be deterministic: one primary per major decision block; at most one secondary if needed; rest ghost.
- **Rule E**: Spacing rhythm should reuse one scale (`gap-2/4/6` pattern) and token-driven sizes.

### 3.2 Recommended token touchpoints
- `app/globals.css`
  - Define/normalize:
    - spacing rhythm (4/8/12/16/20/24)
    - motion duration presets (`fast`, `normal`, `slow`, `stagger`)
    - focus ring color/token
    - disabled/hover/active state opacities
- Replace scattered hard-coded values in shared components where feasible.

### 3.3 Motion policy
- Ambient effects: `prefers-reduced-motion: reduce` disables infinite/long-duration loops.
- Task transitions: keep short, clear, and purposeful only.
- Add a standard `duration-enter`, `duration-exit` policy for route transitions.

---

## 4) Accessibility and input model audit details

- **Form controls**
  - Verify all controls in generation and classroom flows have labels and required `aria` metadata.
- **Menus/dialogs**
  - Ensure focus is trapped in modal-like overlays and restored to trigger on close.
- **Status communication**
  - Replace implicit status via color/position only with textual status where possible.
- **Error recoverability**
  - Errors should include explicit action (“Try again” + focus target).
- **Screen reader semantics**
  - Avoid icon-only critical controls and unlabeled status icons.

---

## 5) Reproducible test plan (as requested)

1. Keyboard-only:
   - Home → generate → preview → enter classroom.
   - All stage actions: chat/sidebar/panel toggles and scene controls.
   - Toolbar popovers and menus should close on Escape and restore focus.
2. Screen-reader sweep:
   - Check labels for header actions, toolbar actions, chat controls, and classroom sidebars.
3. Responsive diff pass:
   - 375 / 768 / 1280.
   - Confirm toolbars and classroom columns wrap/collapse cleanly.
4. Reduced motion + contrast:
   - OS reduced-motion + forced colors/high contrast spot checks.
5. Load/error/retry:
   - Simulate generation failure and classroom-open failure; confirm error messaging and retry action are keyboard first and announced.

---

## 6) Suggested implementation roadmap (second pass)

### Pass 1 — Accessibility hardening (highest priority)
1. Add `aria-label` to all icon-only controls.
2. Replace non-semantic click regions with semantic controls (`button`, `Button`) or keyboard handlers.
3. Add `prefers-reduced-motion` support.
4. Tighten landmarks and heading structure in home/preview/classroom.

### Pass 2 — Component consistency
1. Introduce a shared interaction spec for toolbar/header/stage/chat controls.
2. Normalize token rhythm in `app/globals.css`.
3. Standardize state styling (hover/active/disabled/focus) in shared UI tokens.

### Pass 3 — Experience quality polish
1. Tune mobile control wrapping and sidebar collapse behavior.
2. Refine status/error feedback to be explicit and accessible.
3. Validate transitions for speed, easing, and distraction level.

---

## 7) Acceptance criteria (for implementation PR)

- All journeys are fully operable without mouse.
- No icon-only primary controls without accessible names.
- Every non-button custom control has keyboard activation.
- Motion honors reduced-motion and does not include distracting ambient loops.
- At 375/768/1280, no control cluster/overlay overlap and no hidden actions.
- Error + loading states are readable and recoverable by keyboard and screen reader.

---

## 8) Continued pass findings (detailed file-level audit)

The following items were identified in the follow-up sweep and are recommended as the next implementation-ready pass. Priority is unchanged from the core plan.

### P1: Keyboard + screen-reader blockers

1) **`components/stage/scene-sidebar.tsx` — scene rows are not reliably keyboard-operable**
- Specific issues:
  - Scene entries are interactive `<div>` containers with mouse handlers instead of semantic controls (`lines 151-160`).
  - Pending scene placeholder row is also a clickable `<div>` (`lines 336-345`).
  - Failed-state retry icon uses a visual cue but no explicit accessible naming (`lines 398-410`).
- Why this matters:
  - Tab order and Enter/Space activation are inconsistent or unavailable in parts of the scene navigation path.
- Recommended fix:
  - Replace clickable `<div>` entries with `button`/`Button` and preserve selected state styling.
  - Add explicit `aria-label` to retry control and keep icon + text parity where possible.

2) **`app/page.tsx` — mixed semantic controls in profile/settings surfaces**
- Specific issues:
  - Top-right control cluster includes icon-only controls with weak names (`lines 345-355`, `407-413`).
  - Profile summary + expanded state use mixed wrappers and non-button containers for primary activation (`line 744`, `786-820`, `870`, `885-906`).
  - Error notification region is visual-only and not exposed as a live status (`lines 547-557`).
- Why this matters:
  - Home-entry flow has uneven accessibility; users may lose orientation and cannot always recover from failures via keyboard.
- Recommended fix:
  - Move all non-form action surfaces to semantic buttons/links.
  - Add explicit labels for icon-only controls and introduce `role="status"` + polite announcements for generation errors.

3) **`components/user-profile.tsx` — profile interaction names are ambiguous**
- Specific issues:
  - Avatar/name/edit controls rely on iconography without robust accessible labels (`lines 119`, `161`, `187`, `210`).
- Why this matters:
  - Profile editing entry points become invisible for screen reader users and can fail WCAG Name/Role/Value checks.
- Recommended fix:
  - Add explicit accessible names (and optionally `aria-describedby`) on icon-only triggers.

4) **`components/generation/generation-toolbar.tsx` — toolbar buttons and upload targets**
- Specific issues:
  - A selected-PDF clear action uses `span role="button"` without keyboard contract (`158-167`).
  - Upload empty-state target is a clickable `<div>` with mouse-oriented interactions (`244-270`).
  - Compact icon states can become ambiguous (`279-284`, `288-311`) when label context is hidden.
- Why this matters:
  - Core input path has multiple mouse-only or ambiguous controls, directly affecting creation completion.
- Recommended fix:
  - Use native button primitives for clear/upload actions.
  - Keep icon + label for primary actions by default; for compact mode, add clear accessible naming.

5) **`components/header.tsx` — icon controls missing explicit names**
- Specific issues:
  - Classroom back/home and utility actions are icon-only and can lack explicit accessible naming (`77-80`, `167-172`, `178-184`).
- Why this matters:
  - Header-level actions are often primary escape/return paths and should remain understandable in assistive tech.
- Recommended fix:
  - Set explicit `aria-label` and ensure focus style is visible at all states.

### P1/P2: Motion, focus, and state feedback

6) **`app/generation-preview/page.tsx` — warning + motion audit**
- Specific issues:
  - Warning badge/visual alert control lacks strong accessible labeling (`982-1007`) and sits in a motion pattern that can be noisy (`966-1007`).
  - Decorative/ambient animation behavior should be constrained with `prefers-reduced-motion`.
- Why this matters:
  - Repeated motion can mask critical action cues and harms low-motion users.
- Recommended fix:
  - Add clear accessible label and reduce ambient animation when motion preference is reduced.

7) **`app/globals.css` — no motion preference guardrails**
- Specific issue:
  - Multiple decorative keyframes exist without `@media (prefers-reduced-motion: reduce)` gating (`140-189`).
- Why this matters:
  - Global policy is difficult to enforce if animations remain active under reduced-motion conditions.
- Recommended fix:
  - Add a global reduced-motion block with disable/shorten semantics for non-essential loops.

### P1/P2: Route-level loading/error semantics

8) **`app/classroom/[id]/page.tsx` — loading/error containers are under-announced**
- Specific issues:
  - Root loading/error state containers are not structured with explicit polite status/error roles (`~194-203`).
- Why this matters:
  - On slow/failure paths, users may not receive timely assistive feedback.
- Recommended fix:
  - Add `aria-live`/`role="status"` or `role="alert"` semantics and ensure keyboard can directly reach retry after error render.

### Consolidated implementation subset (recommended immediate next pass)
- Convert all icon-only interactive elements in these files into explicit labeled buttons:
  - `components/stage/scene-sidebar.tsx`
  - `app/page.tsx`
  - `components/user-profile.tsx`
  - `components/generation/generation-toolbar.tsx`
  - `components/header.tsx`
- Replace custom clickable regions with semantic controls where practical:
  - `components/stage/scene-sidebar.tsx`
  - `components/generation/generation-toolbar.tsx`
  - `app/page.tsx`
- Add reduced-motion-safe behavior:
  - `app/page.tsx`
  - `app/generation-preview/page.tsx`
  - `app/globals.css`
- Add explicit status regions on loading/error states:
  - `app/classroom/[id]/page.tsx`
  - `app/page.tsx`
