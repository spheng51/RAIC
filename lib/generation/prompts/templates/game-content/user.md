Create an educational GAME widget for: {{title}}

## Game Type

{{gameType}}

## Arcade Template

Template: {{gameTemplateLabel}}

Creative direction: {{gameTemplateHint}}

Preferred controls: {{gamePreferredControls}}

QA expectations: {{gameQaExpectations}}

## Game Goal

{{gameGoal}}

## Core Mechanic

{{coreMechanic}}

## Difficulty Curve

{{difficultyCurve}}

## Description

{{description}}

## Key Points

{{keyPoints}}

## Scoring Configuration

{{scoring}}

## Language

Target language: {{courseLanguageName}}

HTML lang attribute: {{htmlLang}}

{{languageDirective}}

All visible game text must use {{courseLanguageName}}. This includes modal copy, button labels, HUD labels, score/status/progress text, hints, achievement text, error messages, and teacher-facing labels. Use these localized examples when helpful:

- Start: {{gameStartLabel}}
- Restart: {{gameRestartLabel}}
- Hint: {{gameHintLabel}}
- Score: {{gameScoreLabel}}
- Status: {{gameStatusLabel}}
- Progress: {{gameProgressLabel}}
- Pause: {{gamePauseLabel}}
- Resume: {{gameResumeLabel}}

---

Generate a FUN, INTERACTIVE HTML game with these MANDATORY features:

### Game Design (CRITICAL - NOT A QUIZ!)
1. **Interactive gameplay**: Player MUST control something meaningful (NOT just click answers)
2. **Real game mechanics**: Timing, aiming, dragging, balancing, catching, or building
3. **Skill-based success**: Outcome depends on player action, not just correct answer
4. **Engaging feedback**: Animations, sounds, visual effects for actions

### Preferred Game Types (in order of preference)
1. **Physics/Action**: Control parameters to achieve a goal (land safely, hit target, balance)
2. **Timing/Aim**: Click at right moment or adjust aim to succeed
3. **Drag-and-drop**: Sort, arrange, or build by dragging elements
4. **Simulation game**: Let player experiment with variables to find solution
5. **Card/Match**: Memory or matching games
6. **Quiz**: ONLY as last resort - make it visually interesting

### Simulation Integration (if game has visual simulation)
- Simulation MUST be interactive (player controls something)
- Simulation physics MUST match what player is learning
- Visual feedback MUST show player's progress toward goal
- Example: Don't ask "What thrust?" → LET PLAYER ADJUST thrust and see result!

### Game Elements
1. **Clear objective**: "Land safely", "Hit the target", "Sort correctly"
2. **Player controls**: Sliders, buttons, drag areas, or click targets
3. **Real-time feedback**: Score, progress bar, visual indicators
4. **Levels or challenges**: Progressive difficulty
5. **Achievement system**: Unlockable badges for accomplishments
6. **Replay value**: Random elements or multiple solutions

### Visual Design
1. Attractive theme matching the subject
2. Clear UI for controls and feedback
3. Animations for success/failure
4. Responsive layout (mobile + desktop)

### Technical (MANDATORY)
1. **Inline onclick for start button**: `<button onclick="startGame()">{{gameStartLabel}}</button>` - NOT addEventListener
2. **Custom CSS preferred**: Avoid Tailwind `@layer utilities` blocks; use plain CSS
3. **DOMContentLoaded wrapper**: Wrap game code in `document.addEventListener('DOMContentLoaded', ...)`
4. **Global start function**: `function startGame()` must be callable from onclick
5. Use `<html lang="{{htmlLang}}">`
6. Embedded `<script type="application/json" id="widget-config">`
7. `requestAnimationFrame` for smooth animations
8. Touch-friendly controls (min 44px touch targets)
9. localStorage for progress/high scores
10. Pause functionality
11. Classroom multiplayer bridge:
   - post `RAIC_GAME_EVENT` messages for `bridge_ready`, `ready`, `score`, `progress`, and `complete`
   - include numeric `score` and `progress` when those values change
   - in classroom mode, post `score`, `progress`, and `complete` only while `RAIC_GAME_STATE.gameSession.status` is `live`
   - listen for `RAIC_GAME_STATE` statuses `arming`, `live`, `paused`, `completed`, and `idle`
   - listen for `RAIC_GAME_CONTROL`, reset local score/progress on `{ action: "reset" }`, and ignore unknown actions without crashing

### Output
Return ONLY the HTML document. Make the game FUN enough that students want to play again!
