import { getGameTemplateDefinition } from '@/lib/game-arcade/templates';
import { getCourseLanguageLabels } from '@/lib/generation/language-directive';
import type { GameTemplateId, SceneOutline, WidgetOutline } from '@/lib/types/generation';
import type { GameConfig, TeacherAction } from '@/lib/types/widgets';

interface FallbackGameWidget {
  html: string;
  widgetConfig: GameConfig;
  teacherActions: TeacherAction[];
}

const TEMPLATE_GAME_TYPES: Record<GameTemplateId, GameConfig['gameType']> = {
  'physics-challenge': 'action',
  'puzzle-lab': 'puzzle',
  'strategy-sim': 'strategy',
  'card-match': 'card',
  'code-quest': 'puzzle',
  'boss-review': 'action',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function toGameType(
  requestedType: WidgetOutline['gameType'],
  templateId: GameTemplateId | undefined,
): GameConfig['gameType'] {
  if (requestedType) return requestedType;
  if (templateId) return TEMPLATE_GAME_TYPES[templateId] ?? 'action';
  return 'action';
}

function firstKeyPoint(outline: SceneOutline): string {
  return outline.keyPoints?.[0] || outline.description || outline.title;
}

export function buildFallbackGameWidget(
  outline: SceneOutline,
  widgetOutline: WidgetOutline,
): FallbackGameWidget {
  const template = getGameTemplateDefinition(widgetOutline.gameTemplateId);
  const templateId = template.id;
  const objective = widgetOutline.gameGoal || widgetOutline.challenge || outline.description;
  const keyPoints = outline.keyPoints?.length ? outline.keyPoints : [firstKeyPoint(outline)];
  const controls = widgetOutline.playerControls?.length
    ? widgetOutline.playerControls
    : template.preferredControls;
  const gameType = toGameType(widgetOutline.gameType, templateId);
  const labels = getCourseLanguageLabels(outline.language);
  const isChinese = labels.language === 'zh-CN';
  const fallbackCopy = {
    defaultMechanic: isChinese
      ? '通过做出正确选择完成课堂挑战。'
      : 'Complete the classroom challenge by making good decisions.',
    frameGoal: isChinese ? `先介绍目标：${objective}` : `Start by framing the goal: ${objective}`,
    statusCoach: isChinese
      ? '使用状态面板引导学生完成每一次尝试。'
      : 'Use the status panel to coach students through each attempt.',
    revealHint: isChinese
      ? `学生需要帮助时，揭示第一个提示：${firstKeyPoint(outline)}`
      : `Reveal the first hint when students need help: ${firstKeyPoint(outline)}`,
    challengeMode: isChinese
      ? '将组件切换到挑战模式，准备下一次学习者操作。'
      : 'Move the widget into challenge mode for the next learner action.',
    goalLabel: isChinese ? '目标' : 'Goal',
    challengeLabel: isChinese ? '挑战' : 'Challenge',
    firstCheckpointName: isChinese ? '第一个检查点' : 'First Checkpoint',
    firstCheckpointDescription: isChinese
      ? '完成第一个课堂游戏挑战。'
      : 'Complete the first classroom game challenge.',
    scoreBonus: isChinese
      ? '学生解释每次成功操作时奖励加分。'
      : 'Award bonus points for explaining each successful move.',
    ready: isChinese ? '准备' : 'Ready',
    playing: isChinese ? '进行中' : 'Playing',
    complete: isChinese ? '完成' : 'Complete',
    checkpointReached: isChinese ? '到达检查点' : 'Checkpoint reached',
    hintRevealed: isChinese ? '已显示提示' : 'Hint revealed',
    challengeModeStatus: isChinese ? '挑战模式' : 'Challenge mode',
    paused: isChinese ? '暂停' : 'Paused',
    gameStatusAria: isChinese ? '游戏状态' : 'Game status',
    playableChallengeAria: isChinese ? '可玩挑战' : 'Playable challenge',
    gameControlsAria: isChinese ? '游戏控制' : 'Game controls',
    tryChallenge: isChinese ? '尝试挑战' : 'Try Challenge',
    revealHintButton: isChinese ? '显示提示' : 'Reveal Hint',
    checkpointHint: isChinese ? '检查点提示' : 'Checkpoint hint',
    consoleReady: isChinese ? '备用课堂游戏已准备好' : 'Fallback classroom game ready',
  };
  const mechanic =
    widgetOutline.coreMechanic ||
    widgetOutline.challenge ||
    template.promptHint ||
    fallbackCopy.defaultMechanic;

  const teacherActions: TeacherAction[] = [
    {
      id: 'intro_game_goal',
      type: 'speech',
      content: fallbackCopy.frameGoal,
      label: fallbackCopy.goalLabel,
    },
    {
      id: 'highlight_status',
      type: 'highlight',
      target: '#status-panel',
      content: fallbackCopy.statusCoach,
      label: labels.statusLabel,
    },
    {
      id: 'show_hint',
      type: 'reveal',
      target: '#checkpoint-panel',
      content: fallbackCopy.revealHint,
      label: labels.hintLabel,
    },
    {
      id: 'set_challenge_state',
      type: 'setState',
      target: '#game-container',
      state: { phase: 'challenge', focus: keyPoints[0] },
      content: fallbackCopy.challengeMode,
      label: fallbackCopy.challengeLabel,
    },
  ];

  const widgetConfig: GameConfig = {
    type: 'game',
    gameType,
    description: objective,
    gameConfig: {
      fallback: true,
      templateId,
      templateLabel: template.label,
      objective,
      coreMechanic: mechanic,
      difficultyCurve: widgetOutline.difficultyCurve || 'standard',
      controls,
      keyPoints,
      htmlLang: labels.htmlLang,
      multiplayerBridge: true,
    },
    scoring: {
      completionPoints: 50,
      correctPoints: 10,
      accuracyBonus: fallbackCopy.scoreBonus,
      timeBonus: false,
    },
    achievements: [
      {
        id: 'first_checkpoint',
        name: fallbackCopy.firstCheckpointName,
        description: fallbackCopy.firstCheckpointDescription,
        icon: 'star',
        condition: 'progress >= 50',
      },
    ],
    teacherActions,
  };

  const gameData = {
    title: outline.title,
    objective,
    mechanic,
    templateLabel: template.label,
    keyPoints,
  };

  const keyPointItems = keyPoints
    .map(
      (point, index) =>
        `<li><button type="button" data-point="${index}">${escapeHtml(point)}</button></li>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="${outline.language || 'en-US'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(outline.title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --ink: #172033;
      --muted: #5d667a;
      --panel: #ffffff;
      --line: #d9e2f1;
      --accent: #2563eb;
      --accent-strong: #1d4ed8;
      --success: #0f8a5f;
      --surface: #eef5ff;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: linear-gradient(180deg, #f7fbff 0%, #e9f2ff 100%);
      color: var(--ink);
    }

    #game-container {
      min-height: 100vh;
      display: grid;
      gap: 18px;
      padding: 24px;
      grid-template-rows: auto auto 1fr auto;
    }

    .hud,
    .arena,
    #checkpoint-panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 18px 45px rgba(31, 62, 112, 0.12);
    }

    .hud {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      padding: 12px;
    }

    .hud-item {
      border-radius: 12px;
      background: var(--surface);
      padding: 10px 12px;
      font-weight: 700;
    }

    .hud-item span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .objective {
      display: grid;
      gap: 8px;
    }

    h1 {
      margin: 0;
      font-size: clamp(26px, 5vw, 44px);
      line-height: 1.05;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.5;
    }

    .arena {
      position: relative;
      display: grid;
      align-content: center;
      justify-items: center;
      min-height: 300px;
      overflow: hidden;
      padding: 24px;
    }

    .challenge-orb {
      width: min(220px, 52vw);
      aspect-ratio: 1;
      border-radius: 999px;
      display: grid;
      place-items: center;
      text-align: center;
      padding: 24px;
      background: radial-gradient(circle at 30% 25%, #ffffff 0%, #c7ddff 42%, #4f8bff 100%);
      color: #10234e;
      font-weight: 800;
      box-shadow: inset 0 0 0 10px rgba(255, 255, 255, 0.42), 0 22px 60px rgba(37, 99, 235, 0.25);
      transition: transform 220ms ease, box-shadow 220ms ease;
    }

    .challenge-orb.is-active {
      transform: translateY(-8px) scale(1.03);
      box-shadow: inset 0 0 0 10px rgba(255, 255, 255, 0.5), 0 28px 80px rgba(37, 99, 235, 0.34);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    button {
      min-height: 44px;
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      background: #dce9ff;
      color: #18345f;
      font-weight: 800;
      cursor: pointer;
    }

    button:hover,
    button:focus-visible {
      outline: 3px solid rgba(37, 99, 235, 0.28);
      outline-offset: 2px;
    }

    .primary-action {
      background: var(--accent);
      color: white;
    }

    .primary-action:hover,
    .primary-action:focus-visible {
      background: var(--accent-strong);
    }

    #checkpoint-panel {
      display: none;
      padding: 16px;
      border-color: rgba(15, 138, 95, 0.35);
    }

    #checkpoint-panel.is-visible {
      display: block;
    }

    .progress-track {
      height: 12px;
      border-radius: 999px;
      background: #d9e2f1;
      overflow: hidden;
      margin-top: 8px;
    }

    #progress-bar {
      display: block;
      width: 0%;
      height: 100%;
      background: var(--success);
      transition: width 220ms ease;
    }

    @media (max-width: 640px) {
      #game-container {
        padding: 14px;
      }

      .hud {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <main id="game-container" data-game-fallback="true">
    <section id="game-objective" class="objective">
      <p>${escapeHtml(template.label)}</p>
      <h1>${escapeHtml(outline.title)}</h1>
      <p>${escapeHtml(objective)}</p>
    </section>

    <section class="hud" aria-label="${escapeHtml(fallbackCopy.gameStatusAria)}">
      <div id="score-display" class="hud-item"><span>${escapeHtml(labels.scoreLabel)}</span>0</div>
      <div id="status-panel" class="hud-item"><span>${escapeHtml(labels.statusLabel)}</span>${escapeHtml(fallbackCopy.ready)}</div>
      <div id="progress-display" class="hud-item"><span>${escapeHtml(labels.progressLabel)}</span>0%</div>
    </section>

    <section class="arena" aria-label="${escapeHtml(fallbackCopy.playableChallengeAria)}">
      <div id="challenge-target" class="challenge-orb">${escapeHtml(mechanic)}</div>
      <div class="progress-track" aria-hidden="true"><span id="progress-bar"></span></div>
    </section>

    <section class="controls" aria-label="${escapeHtml(fallbackCopy.gameControlsAria)}">
      <button id="start-button" class="primary-action" type="button" onclick="startGame()">${escapeHtml(labels.startLabel)}</button>
      <button id="challenge-button" type="button" onclick="completeChallenge()">${escapeHtml(fallbackCopy.tryChallenge)}</button>
      <button id="hint-button" type="button" onclick="revealHint()">${escapeHtml(fallbackCopy.revealHintButton)}</button>
    </section>

    <section id="checkpoint-panel" aria-live="polite">
      <strong>${escapeHtml(fallbackCopy.checkpointHint)}</strong>
      <ul>${keyPointItems}</ul>
    </section>

    <script type="application/json" id="widget-config">${toScriptJson(widgetConfig)}</script>
    <script>
      const gameData = ${toScriptJson(gameData)};
      const fallbackCopy = ${toScriptJson(fallbackCopy)};
      let score = 0;
      let progress = 0;
      let started = false;
      let animationFrame = null;
      let classroomGameSession = null;

      function postGameEvent(eventName, payload) {
        try {
          window.parent.postMessage(Object.assign({
            type: 'RAIC_GAME_EVENT',
            event: eventName
          }, payload || {}), '*');
        } catch (error) {
          console.warn('Unable to post classroom game event', error);
        }
      }

      function setText(id, value) {
        const element = document.getElementById(id);
        if (element) {
          const label = element.querySelector('span');
          element.textContent = value;
          if (label) {
            element.prepend(label);
          }
        }
      }

      function updateHud(status) {
        setText('score-display', String(score));
        setText('status-panel', status);
        setText('progress-display', progress + '%');
        const bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = progress + '%';
      }

      function pulseTarget() {
        const target = document.getElementById('challenge-target');
        if (!target) return;
        target.classList.add('is-active');
        window.setTimeout(function () {
          target.classList.remove('is-active');
        }, 600);
      }

      function gameLoop() {
        if (!started) return;
        animationFrame = window.requestAnimationFrame(gameLoop);
      }

      function startGame() {
        started = true;
        score = Math.max(score, 0);
        progress = Math.max(progress, 10);
        updateHud(fallbackCopy.playing);
        pulseTarget();
        postGameEvent('ready', { score: score, progress: progress });
        if (!animationFrame) {
          gameLoop();
        }
      }

      function completeChallenge() {
        if (!started) startGame();
        score += 10;
        progress = Math.min(100, progress + 25);
        updateHud(progress >= 100 ? fallbackCopy.complete : fallbackCopy.checkpointReached);
        pulseTarget();
        postGameEvent(progress >= 100 ? 'complete' : 'score', {
          score: score,
          progress: progress,
          state: { score: score, progress: progress }
        });
      }

      function revealHint() {
        const panel = document.getElementById('checkpoint-panel');
        if (panel) panel.classList.add('is-visible');
        updateHud(fallbackCopy.hintRevealed);
        postGameEvent('progress', { score: score, progress: progress });
      }

      window.startGame = startGame;
      window.completeChallenge = completeChallenge;
      window.revealHint = revealHint;

      window.addEventListener('message', function (event) {
        const message = event.data || {};
        const type = message.type;
        const payload = message.payload || {};

        if (type === 'HIGHLIGHT_ELEMENT') {
          const target = document.querySelector(payload.target || '#challenge-target');
          if (target) {
            target.style.outline = '4px solid rgba(37, 99, 235, 0.75)';
            target.style.outlineOffset = '4px';
            window.setTimeout(function () {
              target.style.outline = '';
              target.style.outlineOffset = '';
            }, 2200);
          }
        }

        if (type === 'SET_WIDGET_STATE') {
          const state = payload.state || {};
          if (state.phase === 'challenge') {
            startGame();
            updateHud(fallbackCopy.challengeModeStatus);
          }
        }

        if (type === 'ANNOTATE_ELEMENT') {
          revealHint();
        }

        if (type === 'REVEAL_ELEMENT') {
          revealHint();
        }

        if (type === 'RAIC_GAME_STATE') {
          classroomGameSession = message.gameSession || null;
          if (classroomGameSession && classroomGameSession.status === 'paused') {
            started = false;
            updateHud(fallbackCopy.paused);
          }
          if (classroomGameSession && classroomGameSession.status === 'live' && !started) {
            startGame();
          }
        }

        if (type === 'RAIC_GAME_CONTROL') {
          if (payload.action === 'reset') {
            score = 0;
            progress = 0;
            started = false;
            updateHud(fallbackCopy.ready);
          }
        }
      });

      updateHud(fallbackCopy.ready);
      postGameEvent('bridge_ready', { score: score, progress: progress });
      console.info(fallbackCopy.consoleReady, gameData.title);
    </script>
  </main>
</body>
</html>`;

  return {
    html,
    widgetConfig,
    teacherActions,
  };
}
