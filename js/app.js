(function () {
  'use strict';

  const Core = window.KiraChessCore;
  const Analysis = window.KiraAnalysisEngine;
  const PlayerModel = window.KiraPlayerModel;
  const Openings = window.KiraOpeningEngine;
  const CoachEngine = window.KiraCoachEngine;
  const CoachAI = window.KiraCoachAI;
  const HumanBot = window.KiraHumanBot;
  const Training = window.KiraTrainingEngine;
  const PatternMemory = window.KiraPatternMemory;
  const Development = window.KiraDevelopmentEngine;
  const Mistakes = window.KiraMistakeLibrary;
  const Archive = window.KiraGameArchive;
  const EngineReview = window.KiraEngineReview;
  const Review = window.KiraReviewEngine;
  const Auth = window.KiraAuth;
  const ProfileSync = window.KiraProfileSync;
  const Progress = window.KiraProgressEngine;
  const Portability = window.KiraDataPortability;
  const PhaseDiagnosis = window.KiraPhaseDiagnosis;
  const Weakness = window.KiraWeaknessTraining;
  const Light = window.KiraLightReactions;
  const Live = window.KiraLiveEvaluation;
  let liveExplanation = null;
  let weaknessSelected = null;
  let weaknessLegal = [];
  const { StockfishService } = window.KiraStockfish;

  if (!Core || !Analysis || !PlayerModel || !Openings || !CoachEngine || !CoachAI || !HumanBot || !Training || !PatternMemory || !Development || !Mistakes || !Archive || !EngineReview || !Review || !Auth || !Progress || !Portability || !PhaseDiagnosis || !Weakness || !StockfishService) {
    throw new Error('Falha ao carregar os módulos do Kira Chess.');
  }

  const PROFILE_KEY = 'kiraChessProfile_v5';
  const LEGACY_PROFILE_KEY = 'kiraChessProfile_v3';
  const GAME_KEY = 'kiraChessCurrentGame_v5';
  let storageScope = 'guest';
  let profileEpoch = 0;
  let authUser = null;
  let authConfigured = false;
  let pendingAuthMessage = null;
  let lastSyncStatus = { state: 'guest', text: 'Como convidado, o progresso fica neste navegador.' };
  const newLocalId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const deviceId = localStorage.getItem('kiraDeviceId') || newLocalId();
  localStorage.setItem('kiraDeviceId', deviceId);
  const guestId = localStorage.getItem('kiraGuestId') || newLocalId();
  localStorage.setItem('kiraGuestId', guestId);

  const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

  const $ = (id) => document.getElementById(id);

  const defaultProfile = {
    version: 6,
    name: 'Jogador',
    rating: null,
    target: null,
    missionStart: null,
    games: 0,
    importedGames: 0,
    assessment: { completed: false, completedAt: null, games: 0, estimate: null, style: null, primaryWeakness: null },
    baseline: { completed: false, attempts: 0, correct: 0, hints: 0, completedAt: null, results: {}, summary: null },
    wins: 0,
    losses: 0,
    draws: 0,
    hints: 0,
    reviews: { criticalAttempts: 0, criticalWins: 0, mistakeAttempts: 0, mistakeWins: 0, mistakePartials: 0 },
    stats: { blunders: 0, mistakes: 0, inaccuracies: 0, interventions: 0, materialLost: 0, materialWon: 0 },
    skills: { 'Visão': 0, 'Ameaças': 0, 'Tática': 0, 'Defesa': 0, 'Cálculo': 0, 'Final': 0 },
    training: {
      change: { attempts: 0, correct: 0, hints: 0 },
      threat: { attempts: 0, correct: 0, hints: 0 },
      hanging: { attempts: 0, correct: 0, hints: 0 },
      mate: { attempts: 0, correct: 0, hints: 0 },
      surprise: { attempts: 0, correct: 0, hints: 0 },
      development: { attempts: 0, correct: 0, hints: 0 },
      bishop: { attempts: 0, correct: 0, hints: 0 },
      fork: { attempts: 0, correct: 0, hints: 0 },
      afterdev: { attempts: 0, correct: 0, hints: 0 }
    },
    patterns: {},
    patternMemory: {},
    thinking: { planAttempts: 0, planCorrect: 0, planStreak: 0, humanGames: 0 },
    recentMistakes: [],
    gameArchive: [],
    lastAnalysis: null,
    planMinutes: 20,
    gameMode: 'coach',
    selectedOpening: null
  };

  let profile = loadProfile(storageScope);
  let game = null;
  let selected = null;
  let legalForSelected = [];
  let pendingMove = null;
  let promotionCandidates = [];
  let botThinking = false;
  let botTimer = null;
  let moveStartedAt = Date.now();
  let coachHintLevel = 0;
  let boardDrag = null;
  let suppressBoardClickUntil = 0;
  let trainingState = {
    mode: 'change',
    index: 0,
    correct: 0,
    wrong: 0,
    hints: 0,
    hintLevel: 0,
    solved: false,
    assessment: false,
    assessmentIndex: 0,
    assessmentRecorded: false,
    exerciseMisses: 0
  };

  let developmentState = { index: 0, selected: null, solved: false, correct: 0, wrong: 0, scenarioMisses: 0 };

  let openingLesson = null;
  let openingSelected = null;
  let openingLegal = [];
  let reviewData = null;
  let phaseAnalysisJob = null;
  const phaseAnalysisErrors = new Map();
  let pendingPhaseAnalysis = null;
  let reviewPly = 0;
  let reviewShowBest = false;
  let reviewBest = null;
  let reviewRetryState = null;
  let reviewRetryPreview = null;
  let reviewRetrySelected = null;
  let reviewRetryLegal = [];
  let reviewRetryMessage = null;

  const BASELINE_SEQUENCE = ['change', 'hanging', 'mate', 'threat', 'surprise', 'change'];
  const EVALUATION_DECISIONS = 12;

  const stockfish = new StockfishService({
    onStatus: updateEngineStatus
  });
  const liveQueue = new Live.Queue(stockfish);

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function profileStorageKey(scope) { return `${PROFILE_KEY}:${scope || storageScope}`; }
  function gameStorageKey(scope) { return `${GAME_KEY}:${scope || storageScope}`; }

  function loadProfile(scope) {
    try {
      const raw = localStorage.getItem(profileStorageKey(scope));
      if (raw) return normalizeProfile(JSON.parse(raw));

      const legacy = (scope || storageScope) === 'guest' ? localStorage.getItem(LEGACY_PROFILE_KEY) : null;
      if (legacy) {
        const old = JSON.parse(legacy);
        const migrated = normalizeProfile({
          ...defaultProfile,
          rating: null,
          target: null,
          missionStart: null,
          games: Number(old.games) || 0,
          wins: Number(old.wins) || 0,
          losses: Number(old.losses) || 0,
          draws: Number(old.draws) || 0,
          hints: Number(old.hints) || 0,
          recentMistakes: Array.isArray(old.recentMistakes) ? old.recentMistakes : [],
          gameArchive: Array.isArray(old.gameArchive) ? old.gameArchive : [],
          lastAnalysis: old.lastAnalysis || null,
          stats: { ...defaultProfile.stats, ...(old.stats || {}), blunders: Number(old.stats?.blunders ?? old.blunders) || 0 },
          assessment: { ...defaultProfile.assessment }
        });
        localStorage.setItem(profileStorageKey(scope), JSON.stringify(migrated));
        return migrated;
      }
    } catch (error) {
      console.warn('Não foi possível carregar o perfil salvo.', error);
    }
    return deepClone(defaultProfile);
  }

  function normalizeProfile(input) {
    const value = input && typeof input === 'object' ? input : {};
    return {
      ...deepClone(defaultProfile),
      ...value,
      assessment: { ...defaultProfile.assessment, ...(value.assessment || {}) },
      baseline: {
        ...defaultProfile.baseline,
        ...(value.baseline || {}),
        results: { ...(value.baseline?.results || {}) }
      },
      stats: { ...defaultProfile.stats, ...(value.stats || {}) },
      skills: { ...defaultProfile.skills, ...(value.skills || {}) },
      training: Object.fromEntries(Object.keys(defaultProfile.training).map((mode) => [
        mode,
        { ...defaultProfile.training[mode], ...(value.training?.[mode] || {}) }
      ])),
      reviews: { ...defaultProfile.reviews, ...(value.reviews || {}) },
      patterns: { ...(value.patterns || {}) },
      patternMemory: { ...(value.patternMemory || {}) },
      thinking: { ...defaultProfile.thinking, ...(value.thinking || {}) },
      recentMistakes: Array.isArray(value.recentMistakes) ? value.recentMistakes.map(Mistakes.normalizeMistake) : [],
      gameArchive: Array.isArray(value.gameArchive) ? value.gameArchive.map(Archive.normalizeArchiveItem) : []
    };
  }

  function saveProfile() {
    let previous = {};
    try { previous = JSON.parse(localStorage.getItem(profileStorageKey()) || '{}'); } catch (_) {}
    if (storageScope === 'guest') profile._sync = { ...profile._sync, guestId };
    profile = ProfileSync.stamp(profile, previous, deviceId);
    localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
    if (authUser) Auth.queueProfileSave(profile, 850);
    refreshProfileUI();
  }

  function showToast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => element.classList.add('hidden'), 1900);
  }

  function recordBaselineAnswer(mode, correct) {
    if (!trainingState.assessment || trainingState.assessmentRecorded) return;
    trainingState.assessmentRecorded = true;
    profile.baseline.attempts += 1;
    if (correct) profile.baseline.correct += 1;
    const current = profile.baseline.results[mode] || { attempts: 0, correct: 0 };
    current.attempts += 1;
    if (correct) current.correct += 1;
    profile.baseline.results[mode] = current;
  }

  function baselineWeakestMode() {
    const entries = Object.entries(profile.baseline.results || {}).filter(([, data]) => Number(data.attempts) > 0);
    if (!entries.length) return 'change';
    entries.sort((a, b) => ((a[1].correct / a[1].attempts) - (b[1].correct / b[1].attempts)));
    return entries[0][0];
  }

  function baselineModeLabel(mode) {
    const labels = { change: 'perceber o que mudou', threat: 'enxergar ameaças', hanging: 'proteger material', mate: 'encontrar mates', surprise: 'reconhecer padrões sem aviso', development: 'desenvolver com propósito', bishop: 'enxergar diagonais de bispo', fork: 'reconhecer garfos', afterdev: 'encontrar planos depois do desenvolvimento' };
    return labels[mode] || 'visão de tabuleiro';
  }

  function startBaselineAssessment() {
    trainingState = {
      mode: BASELINE_SEQUENCE[0],
      index: 0,
      correct: 0,
      wrong: 0,
      hints: 0,
      hintLevel: 0,
      solved: false,
      assessment: true,
      assessmentIndex: 0,
      assessmentRecorded: false,
      exerciseMisses: 0
    };
    switchView('train');
    renderTraining();
    $('sessionCoachText').textContent = '“Não estou procurando uma nota bonita. Quero descobrir o que você percebe sem ajuda.”';
  }

  function completeBaselineAssessment() {
    profile.baseline.completed = true;
    profile.baseline.completedAt = new Date().toISOString();
    const accuracy = profile.baseline.attempts ? Math.round((profile.baseline.correct / profile.baseline.attempts) * 100) : 0;
    const weakest = baselineWeakestMode();
    profile.baseline.summary = { accuracy, weakest };
    trainingState.assessment = false;
    saveProfile();
    setCoach('Linha de base criada.', `Primeira resposta correta em ${accuracy}% das posições. A prioridade inicial será ${baselineModeLabel(weakest)}.`);
    showToast('Avaliação inicial concluída.');
    switchView('home');
  }

  function selectedUserColor(explicitColor) {
    if (explicitColor === 'w' || explicitColor === 'b') return explicitColor;
    const selectedColor = $('userColor')?.value || 'w';
    if (selectedColor === 'random') return Math.random() < 0.5 ? 'w' : 'b';
    return selectedColor === 'b' ? 'b' : 'w';
  }

  function opponentColor(color) {
    return color === 'b' ? 'w' : 'b';
  }

  function selectedGameMode() {
    return profile.gameMode === 'normal' ? 'normal' : 'coach';
  }

  function botLevelDescriptor(elo) {
    const value = Number(elo) || 500;
    if (value <= 300) return 'Primeiro contato';
    if (value <= 500) return 'Iniciante';
    if (value <= 700) return 'Aprendiz';
    if (value <= 900) return 'Clube iniciante';
    if (value <= 1100) return 'Intermediário';
    if (value <= 1300) return 'Competitivo';
    return 'Desafio forte';
  }

  function isPhysicalGame() { return game?.source === 'physical'; }
  function interactionColor() { return isPhysicalGame() ? game.state.turn : game.userColor; }

  function isGuidedGame() {
    if (isPhysicalGame() || game?.liveEvaluation) return false;
    return game?.mode === 'coach' || game?.mode === 'opening';
  }

  function isEvaluationGame() {
    return game?.source === 'evaluation';
  }

  function createGame(initialState, options) {
    const opts = options || {};
    const state = initialState ? Core.cloneState(initialState) : Core.createInitialState();
    const key = Core.repetitionKey(state);
    const evaluation = opts.source === 'evaluation';
    const physical = !evaluation && (opts.source === 'physical' || (!opts.source && !initialState && $('gameType').value === 'physical'));
    const botLevel = evaluation ? 500 : (Number(opts.botLevel) || Number($('botLevel')?.value) || 500);
    const userColor = evaluation ? 'w' : selectedUserColor(opts.userColor);
    const mode = evaluation ? 'evaluation' : (opts.mode || selectedGameMode());
    return {
      version: 6,
      id: newLocalId(),
      liveEvaluation: !evaluation && Boolean(opts.liveEvaluation ?? $('liveEvaluationToggle').checked),
      state,
      history: [],
      positionCounts: { [key]: 1 },
      botLevel: physical ? 0 : botLevel,
      userColor,
      mode,
      trainingFocus: opts.trainingFocus || null,
      interventions: 0,
      materialLost: 0,
      materialWon: 0,
      status: 'playing',
      result: null,
      reason: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      source: physical ? 'physical' : opts.source || (initialState ? 'critical-replay' : 'standard'),
      sourceMistakeId: opts.sourceMistakeId || null,
      reviewComplete: false,
      coachStep: null
    };
  }

  function normalizeGame(input) {
    if (!input || ![2, 3, 5, 6].includes(input.version) || !input.state || !Array.isArray(input.history)) return null;
    return {
      ...input,
      version: 6,
      id: input.id || newLocalId(),
      liveEvaluation: Boolean(input.liveEvaluation),
      positionCounts: input.positionCounts || { [Core.repetitionKey(input.state)]: 1 },
      botLevel: input.source === 'physical' ? 0 : Number(input.botLevel) || 500,
      userColor: input.userColor === 'b' ? 'b' : 'w',
      mode: input.mode || (input.source === 'evaluation' ? 'evaluation' : 'coach'),
      trainingFocus: input.trainingFocus || null,
      interventions: Number(input.interventions) || 0,
      materialLost: Number(input.materialLost) || 0,
      materialWon: Number(input.materialWon) || 0,
      source: input.source || 'standard',
      sourceMistakeId: input.sourceMistakeId || null,
      reviewComplete: Boolean(input.reviewComplete),
      reviewOutcome: input.reviewOutcome || null,
      coachStep: input.coachStep && typeof input.coachStep === 'object' ? { ...input.coachStep } : null
    };
  }

  function saveGame() {
    if (!game) return;
    localStorage.setItem(gameStorageKey(), JSON.stringify(game));
  }

  function tryLoadGame() {
    try {
      const parsed = normalizeGame(JSON.parse(localStorage.getItem(gameStorageKey()) || 'null'));
      if (parsed && parsed.status === 'playing') {
        game = parsed;
        return true;
      }
    } catch (error) {
      console.warn('Partida salva inválida.', error);
    }
    return false;
  }

  function applyGameModeUI() {
    if (!game) return;
    const evaluation = isEvaluationGame();
    const guided = isGuidedGame();
    const physical = isPhysicalGame();
    $('gameType').value = physical ? 'physical' : 'bot';
    document.querySelector('#view-play .mode-switch').classList.toggle('hidden', physical);
    $('gameType').disabled = evaluation;
    $('liveEvaluationToggle').checked = Boolean(game.liveEvaluation);
    $('liveEvaluationToggle').disabled = evaluation;
    $('finishRecording').disabled = evaluation || game.status !== 'playing' || !game.history.length;
    document.querySelectorAll('[data-game-mode]').forEach((button) => {
      button.classList.toggle('active', !evaluation && button.dataset.gameMode === game.mode);
      button.disabled = evaluation || physical;
    });
    if ($('userColor')) $('userColor').disabled = evaluation;
    if ($('botLevel')) $('botLevel').disabled = evaluation;
    if ($('newGameButton')) $('newGameButton').disabled = evaluation;
    if ($('botLevelLabel')) $('botLevelLabel').classList.toggle('hidden', evaluation || physical);
    if ($('coachQuickActions')) $('coachQuickActions').classList.toggle('hidden', !guided);
    if ($('coachSkipButton') && !guided) $('coachSkipButton').classList.add('hidden');
    if ($('playEyebrow')) $('playEyebrow').textContent = evaluation ? 'PARTIDA DE AVALIAÇÃO' : guided ? 'JOGAR COM LIGHT' : 'PARTIDA NORMAL';
    if ($('playTitle')) $('playTitle').textContent = evaluation ? 'Jogue como você jogaria normalmente.' : guided ? 'Pense antes de mover.' : 'Sem ajuda. Revisão depois.';
    if ($('coachPanelKicker')) $('coachPanelKicker').textContent = evaluation ? 'LIGHT · SILENCIOSO' : guided ? 'LIGHT · AO VIVO' : 'PARTIDA · SEM AJUDA';
    if ($('opponentName')) $('opponentName').textContent = evaluation ? 'Adversário de avaliação' : 'Kira Bot';
    if ($('botDescription')) {
      $('botDescription').textContent = evaluation
        ? 'Força oculta durante a avaliação'
        : game.trainingFocus
          ? `${botLevelDescriptor(game.botLevel)} · foco: ${baselineModeLabel(game.trainingFocus)}`
          : `${botLevelDescriptor(game.botLevel)} · ${game.mode === 'coach' ? 'ritmo didático' : 'partida normal'}`;
    }
    if ($('botEloBadge')) {
      $('botEloBadge').textContent = evaluation ? 'Elo oculto' : `≈${game.botLevel} Elo`;
      $('botEloBadge').classList.toggle('hidden', physical);
    }
    if (physical) { $('playEyebrow').textContent = 'TABULEIRO FÍSICO'; $('playTitle').textContent = 'Registre os lances dos dois lados.'; $('opponentName').textContent = 'Partida no tabuleiro físico'; $('botDescription').textContent = 'Toque na peça e no destino de cada lance, na ordem da partida.'; }
    if (game.liveEvaluation) { $('playTitle').textContent = physical ? 'Seu tabuleiro, com avaliação ao vivo.' : 'Jogar contra o bot · avaliação ao vivo'; $('coachPanelKicker').textContent = 'LIGHT · STOCKFISH'; }
  }

  function startNewGame(options) {
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    game = createGame(null, options);
    liveExplanation = null; $('liveExplanation').classList.add('hidden');
    $('reviewFinishedGame').classList.add('hidden');
    selected = null;
    legalForSelected = [];
    pendingMove = null;
    promotionCandidates = [];
    botThinking = false;
    moveStartedAt = Date.now();
    coachHintLevel = 0;
    $('warningModal')?.classList.add('hidden');
    $('promotionModal')?.classList.add('hidden');
    saveGame();
    renderGame();
    applyGameModeUI();
    $('gameStatus').textContent = isEvaluationGame() ? 'Avaliação em andamento' : 'Em andamento';

    if (isEvaluationGame()) {
      setCoach('Eu vou ficar em silêncio.', 'Jogue normalmente. Não vou dar dicas, corrigir lances ou mostrar uma força estimada até a partida terminar.');
    } else if (isGuidedGame()) {
      setCoach('Estou observando.', 'Quando o adversário jogar, eu vou ajudar você a organizar o raciocínio antes da resposta.');
    } else {
      setCoach(isPhysicalGame() ? 'Registre a partida.' : 'Partida normal.', game.liveEvaluation ? 'O Stockfish avalia cada lance em paralelo. Toque numa etiqueta pronta para entender a continuação.' : isPhysicalGame() ? 'Registre as jogadas dos dois lados no tabuleiro. Ao encerrar, você pode abrir o diagnóstico.' : 'Nenhuma dica durante a partida. Depois eu volto para revisar as decisões importantes.');
    }

    if (isPhysicalGame() || game.state.turn === game.userColor) {
      $('turnIndicator').textContent = isPhysicalGame() ? `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o lance` : 'Sua vez · arraste ou clique';
    } else {
      botThinking = true;
      $('turnIndicator').textContent = 'Adversário pensando';
      scheduleBotTurn();
    }
    requestAnimationFrame(fitGameBoard);
  }

  function startAssessmentGame() {
    profile.gameMode = 'normal';
    saveProfile();
    startNewGame({ source: 'evaluation', mode: 'evaluation', userColor: 'w', botLevel: 400 });
    switchView('play');
  }


  function replayCriticalPosition() {
    const fen = profile.lastAnalysis?.criticalFen;
    if (!fen) {
      showToast('Ainda não existe uma posição crítica salva.');
      return;
    }

    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    const criticalState = Core.parseFEN(fen);
    game = createGame(criticalState, { userColor: profile.lastAnalysis?.userColor || criticalState.turn });
    selected = null;
    legalForSelected = [];
    pendingMove = null;
    promotionCandidates = [];
    botThinking = false;
    moveStartedAt = Date.now();
    coachHintLevel = 0;
    $('warningModal')?.classList.add('hidden');
    $('promotionModal')?.classList.add('hidden');
    $('botDescription').textContent = `Bot humano · ≈${game.botLevel}`;
    saveGame();
    renderGame();
    $('gameStatus').textContent = 'Revisão de posição';

    if (game.state.turn !== game.userColor) {
      botThinking = true;
      $('turnIndicator').textContent = 'Adversário pensando';
      botTimer = setTimeout(() => {
        botTimer = null;
        botTurn();
      }, 250);
    } else {
      $('turnIndicator').textContent = isPhysicalGame() ? `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o lance` : 'Sua vez · arraste ou clique';
      setCoach('Prove que entendeu.', 'Você voltou ao momento crítico. Encontre uma decisão melhor sem olhar a resposta antiga.');
    }

    switchView('play');
  }

  function replayMistakePosition(mistakeId) {
    const mistake = profile.recentMistakes.find((item) => item.id === mistakeId);
    if (!mistake?.fen) {
      showToast('Essa posição não está mais disponível.');
      return;
    }

    let state;
    try {
      state = Core.parseFEN(mistake.fen);
    } catch (error) {
      console.warn('Posição de erro inválida.', error);
      showToast('Não foi possível abrir essa posição.');
      return;
    }

    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    game = createGame(state, { source: 'mistake-review', sourceMistakeId: mistake.id, userColor: state.turn });
    selected = null;
    legalForSelected = [];
    pendingMove = null;
    promotionCandidates = [];
    botThinking = false;
    moveStartedAt = Date.now();
    coachHintLevel = 0;
    $('warningModal')?.classList.add('hidden');
    $('promotionModal')?.classList.add('hidden');
    $('botDescription').textContent = 'Revisão · 1 decisão';
    $('gameStatus').textContent = 'Revisão de erro';
    $('turnIndicator').textContent = 'Sua decisão';
    saveGame();
    renderGame();
    setCoach(
      'Volte ao ponto exato.',
      `Na partida você jogou ${mistake.notation}. Não procure a jogada “da engine”. Procure uma decisão que não repita o mesmo problema.`
    );
    switchView('play');
  }

  function recordPosition() {
    const key = Core.repetitionKey(game.state);
    game.positionCounts[key] = (game.positionCounts[key] || 0) + 1;
  }

  function resultFromStatus(status, userColor) {
    if (!status.ended) return null;
    if (!status.winner) return 'Empate';
    return status.winner === (userColor === 'b' ? 'b' : 'w') ? 'Vitória' : 'Derrota';
  }

  function reasonLabel(reason) {
    const labels = {
      checkmate: 'xeque-mate',
      stalemate: 'afogamento',
      'fifty-move': 'regra dos 50 lances',
      'threefold-repetition': 'repetição tripla',
      'insufficient-material': 'material insuficiente',
      imported: 'partida importada',
      'recording-ended': 'registro encerrado',
      'assessment-complete': 'janela de avaliação concluída'
    };
    return labels[reason] || 'fim de partida';
  }

  function updatePatterns(entry, plyIndex, userColor) {
    const side = userColor === 'b' ? 'b' : 'w';
    if (!entry || entry.color !== side || !entry.analysis) return;
    const analysis = entry.analysis;

    if (analysis.risk?.type === 'piece-exposed') {
      profile.patterns['piece-exposed'] = (profile.patterns['piece-exposed'] || 0) + 1;
    }
    if (analysis.risk?.type === 'mate-in-one') {
      profile.patterns['mate-missed'] = (profile.patterns['mate-missed'] || 0) + 1;
    }
    if (['não verificou a resposta adversária imediata', 'não verificou ameaça de mate em 1'].includes(analysis.likelyCause)) {
      profile.patterns['threat-missed'] = (profile.patterns['threat-missed'] || 0) + 1;
    }
    if (analysis.concepts?.includes('dama cedo')) {
      profile.patterns['queen-early'] = (profile.patterns['queen-early'] || 0) + 1;
    }

    const label = analysis.classification.label;
    if (label !== 'ok') {
      profile.recentMistakes.push(Mistakes.normalizeMistake({
        at: new Date().toISOString(),
        fen: entry.fenBefore,
        move: entry.uci,
        notation: entry.notation,
        label,
        loss: analysis.classification.loss,
        concepts: analysis.concepts || [],
        likelyCause: analysis.likelyCause,
        confidence: analysis.confidence,
        ply: Number(plyIndex) + 1,
        userColor: side
      }));
      profile.recentMistakes = profile.recentMistakes.slice(-80);
    }
  }

  function pieceName(piece) {
    const names = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };
    return names[Core.typeOf(piece || '')] || 'peça';
  }

  function gameBotDelay() {
    // O motor pode decidir em milissegundos; a interface não deve parecer uma máquina nervosa.
    // No modo guiado o tempo extra faz parte do ritmo pedagógico, não da força do bot.
    if (isEvaluationGame()) return 1700 + Math.random() * 1500;
    if (isGuidedGame()) return 2600 + Math.random() * 1900;
    return 1100 + Math.random() * 1400;
  }

  function scheduleBotTurn() {
    if (botTimer) clearTimeout(botTimer);
    const delay = gameBotDelay();
    if (isGuidedGame()) {
      $('turnIndicator').textContent = 'Light pensando…';
      setCoach('Estou calculando.', 'Não tente adivinhar meu lance. Use esse tempo para revisar o que a sua última jogada deixou atacado, defendido ou aberto.');
    }
    botTimer = setTimeout(() => {
      botTimer = null;
      botTurn();
    }, delay);
  }

  function currentCoachObservation() {
    if (!game || !isGuidedGame() || game.state.turn !== game.userColor) return null;
    return CoachEngine.buildObservation(game.state, game.history, game.userColor);
  }

  function activateCoachObservation() {
    const observation = currentCoachObservation();
    if (!observation) {
      game.coachStep = null;
      renderCoachObservation();
      return;
    }
    game.coachStep = {
      ply: game.history.length,
      resolved: false,
      attempts: 0,
      skipped: false
    };
    saveGame();
    renderCoachObservation();
    if (window.innerWidth <= 760) {
      setTimeout(() => $('coachPanel')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }), 120);
    }
  }

  function coachObservationPending() {
    return Boolean(game && isGuidedGame() && game.coachStep && !game.coachStep.resolved && game.coachStep.ply === game.history.length);
  }

  function renderCoachObservation() {
    const choices = $('coachChoices');
    const skip = $('coachSkipButton');
    if (!choices || !game || !isGuidedGame() || !coachObservationPending()) {
      choices?.classList.add('hidden');
      if (choices) choices.innerHTML = '';
      skip?.classList.add('hidden');
      return;
    }

    const observation = currentCoachObservation();
    if (!observation) {
      choices.classList.add('hidden');
      choices.innerHTML = '';
      skip?.classList.add('hidden');
      return;
    }

    $('coachStateTitle').textContent = 'Primeiro: o que mudou?';
    $('coachMessage').textContent = observation.prompt;
    choices.innerHTML = observation.choices.map(([key, label]) => (
      `<button class="coach-choice" data-coach-choice="${escapeHtml(key)}">${escapeHtml(label)}</button>`
    )).join('');
    choices.classList.remove('hidden');
    skip?.classList.remove('hidden');
    $('coachGuide')?.classList.add('hidden');
  }

  async function answerCoachObservation(choice) {
    if (!coachObservationPending()) return;
    const observation = currentCoachObservation();
    if (!observation) return;
    const outcome = CoachEngine.evaluateChoice(observation, choice);
    game.coachStep.attempts = Number(game.coachStep.attempts || 0) + 1;

    if (outcome.result === 'unknown') {
      saveGame();
      await giveCoachHint();
      return;
    }

    if (outcome.result === 'incorrect') {
      saveGame();
      $('coachStateTitle').textContent = 'Ainda não.';
      $('coachMessage').textContent = 'Não chute outra opção. Volte à última jogada e procure primeiro o efeito mais urgente: xeque, captura ou ataque direto.';
      $('coachPanel')?.classList.remove('coach-success');
      $('coachPanel')?.classList.add('coach-correction');
      setTimeout(() => $('coachPanel')?.classList.remove('coach-correction'), 700);
      return;
    }

    game.coachStep.resolved = true;
    saveGame();
    $('coachChoices').classList.add('hidden');
    $('coachChoices').innerHTML = '';
    $('coachSkipButton')?.classList.add('hidden');
    $('coachStateTitle').textContent = '✓ Isso. Agora responda.';
    $('coachMessage').textContent = observation.explanation;
    $('coachPanel')?.classList.remove('coach-correction');
    $('coachPanel')?.classList.add('coach-success');
    setTimeout(() => $('coachPanel')?.classList.remove('coach-success'), 900);
    $('gameBoard')?.classList.add('coach-ready');
    setTimeout(() => $('gameBoard')?.classList.remove('coach-ready'), 900);
    if (window.innerWidth <= 760) {
      setTimeout(() => $('gameBoard')?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }), 120);
    }
  }

  function skipCoachObservation() {
    if (!coachObservationPending()) return;
    game.coachStep.resolved = true;
    game.coachStep.skipped = true;
    saveGame();
    $('coachChoices')?.classList.add('hidden');
    if ($('coachChoices')) $('coachChoices').innerHTML = '';
    $('coachSkipButton')?.classList.add('hidden');
    setCoach('Sua vez.', 'Você pulou a leitura deste lance. Antes de mover, pelo menos faça uma verificação rápida: xeques, capturas, ameaças e peça menos ativa.');
    if (window.innerWidth <= 760) {
      setTimeout(() => $('gameBoard')?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }), 120);
    }
  }

  function responseGuideSteps() {
    if (!game) return [];
    const state = game.state;
    const side = game.userColor;
    if (Core.inCheck(state, side)) {
      return [
        'Você está em xeque. Antes de pensar em qualquer plano, descubra quais respostas realmente tiram o rei do xeque.',
        'Compare essas respostas: alguma também salva material, desenvolve uma peça ou melhora a segurança do rei?',
        'Só depois de resolver o xeque volte a pensar em ataque.'
      ];
    }

    const steps = [
      'Comece pela última jogada adversária: o que essa peça passou a atacar, defender, bloquear ou abrir?',
      'Depois faça uma varredura curta: xeques contra você, capturas do adversário e ameaças imediatas.',
      state.fullmove <= 9
        ? 'Se estiver tudo seguro, volte aos princípios: centro, desenvolver uma peça que ainda não joga e deixar o rei pronto para o roque.'
        : 'Se não existe tática urgente, procure sua pior peça: qual delas está fazendo menos e para onde poderia melhorar?',
      'Antes de confirmar seu lance, imagine a resposta mais simples e incômoda que o adversário teria.'
    ];
    return steps;
  }

  function lastMoveThreatContext() {
    if (!game?.state?.lastMove) return { last: null, movedPiece: null, destination: null, directTargets: [] };
    const state = game.state;
    const last = state.lastMove;
    const movedPiece = state.board[last.toRow][last.toCol];
    const enemy = opponentColor(game.userColor);
    const directTargets = [];

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const target = state.board[row][col];
        if (!target || Core.colorOf(target) !== game.userColor) continue;
        const attackers = Core.attackersOf(state, row, col, enemy);
        if (attackers.some((attacker) => attacker.row === last.toRow && attacker.col === last.toCol)) {
          directTargets.push({ piece: target, square: Core.squareName(row, col) });
        }
      }
    }

    return {
      last,
      movedPiece,
      destination: Core.squareName(last.toRow, last.toCol),
      directTargets
    };
  }

  function coachHintSteps() {
    if (!game) return ['Olhe a posição inteira antes de escolher um lance.'];
    const observation = currentCoachObservation();
    if (observation?.hints?.length) return observation.hints;
    return responseGuideSteps();
  }

  function renderCoachGuide() {
    const guide = $('coachGuide');
    if (!guide || !game || !isGuidedGame()) return;
    const steps = responseGuideSteps();
    guide.innerHTML = `<div class="coach-guide-title">ORDEM DE PENSAMENTO</div><ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`;
    guide.classList.remove('hidden');
  }

  async function explainHowToThink(useAi) {
    if (!game || !isGuidedGame()) return;
    const fallbackSteps = responseGuideSteps();
    const fallback = fallbackSteps.join(' ');
    let text = fallback;
    if (useAi) {
      $('coachStateTitle').textContent = 'Organizando a posição...';
      text = await CoachAI.enhance({
        turn: game.state.turn,
        fullmove: game.state.fullmove,
        lastMove: game.state.lastMove ? `${Core.squareName(game.state.lastMove.fromRow, game.state.lastMove.fromCol)}-${Core.squareName(game.state.lastMove.toRow, game.state.lastMove.toCol)}` : null,
        verifiedSteps: fallbackSteps
      }, fallback, 'Ensine o PROCESSO mental para um iniciante. Não revele qual peça está ameaçada, não sugira uma jogada e não invente fatos além dos passos verificados.');
    }
    setCoach('Pense nesta ordem.', text);
    renderCoachGuide();
  }

  async function giveCoachHint() {
    if (!game || !isGuidedGame()) return;
    const steps = coachHintSteps();
    coachHintLevel = Math.min(coachHintLevel + 1, steps.length);
    const fallback = steps[coachHintLevel - 1];
    $('coachStateTitle').textContent = coachHintLevel >= steps.length ? 'Agora você tem a informação principal.' : `Pista ${coachHintLevel} de ${steps.length}`;
    const text = await CoachAI.enhance({
      verifiedHint: fallback,
      hintLevel: coachHintLevel,
      totalHints: steps.length
    }, fallback, coachHintLevel >= steps.length
      ? 'Explique apenas o fato verificado e peça ao iniciante que encontre a resposta sozinho. Não sugira a melhor jogada.'
      : 'Reescreva como uma pista progressiva curta. Não revele mais informação do que o texto verificado. Não sugira jogada.');
    $('coachMessage').textContent = text;
    $('coachGuide')?.classList.add('hidden');
    if ($('coachHintButton')) $('coachHintButton').textContent = coachHintLevel >= steps.length ? 'PISTA COMPLETA' : 'OUTRA PISTA';
  }

  function makeMove(move, byUser, bypassCoach) {
    if (!game || game.status !== 'playing') return;

    const isUser = byUser !== false;
    const before = Core.cloneState(game.state);
    const risk = isUser && isGuidedGame() ? Analysis.moveRisk(before, move) : null;

    if (isUser && game.source !== 'mistake-review' && isGuidedGame() && !bypassCoach && risk) {
      pendingMove = move;
      showWarning(risk);
      return;
    }

    const analysis = isUser && !game.liveEvaluation ? Analysis.analyzeMove(before, move) : null;
    const thinkingMs = isUser && !isPhysicalGame() ? Math.max(0, Date.now() - moveStartedAt) : null;
    if (isUser) game.coachStep = null;
    const after = Core.makeMoveCopy(before, move);
    const notation = Core.sanNotation(before, move, after);
    const uci = Core.moveToUCI(move);

    if (Core.colorOf(move.piece) === game.userColor && move.capture) game.materialWon += Analysis.pieceValue(move.capture);
    if (Core.colorOf(move.piece) !== game.userColor && move.capture && Core.colorOf(move.capture) === game.userColor) game.materialLost += Analysis.pieceValue(move.capture);

    game.state = after;
    coachHintLevel = 0;
    if ($('coachHintButton')) $('coachHintButton').textContent = 'UMA PISTA';
    $('coachGuide')?.classList.add('hidden');
    game.history.push({ color: Core.colorOf(move.piece), notation, uci, move: { ...move }, fenBefore: Core.toFEN(before), fenAfter: Core.toFEN(after), thinkingMs, analysis });
    recordPosition();
    if (game.liveEvaluation) enqueueLiveHistory(game);
    saveGame();
    renderGame();

    if (isUser && game.source === 'mistake-review' && !game.reviewComplete) {
      finishMistakeReview(game.history[game.history.length - 1]);
      return;
    }
    if (isUser && completeEvaluationWindow()) return;
    if (checkGameEnd()) return;
    if (isPhysicalGame()) { botThinking = false; moveStartedAt = Date.now(); $('turnIndicator').textContent = `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o próximo lance`; return; }

    if (isUser) {
      $('turnIndicator').textContent = 'Adversário pensando';
      botThinking = true;
      if (isGuidedGame()) {
        setCoach('Agora observe a resposta.', move.capture
          ? 'Você capturou. Enquanto o adversário pensa, imagine qual recaptura ou ameaça pode aparecer.'
          : 'Enquanto o adversário pensa, imagine qual das suas peças ficou menos protegida depois do lance.');
      } else if (isEvaluationGame()) {
        const decisions = evaluationDecisionCount();
        $('gameStatus').textContent = `Avaliação · ${decisions}/${EVALUATION_DECISIONS} decisões`;
        setCoach('Avaliação em andamento.', `Decisão ${decisions} de ${EVALUATION_DECISIONS}. Sem dicas durante a partida.`);
      } else {
        setCoach('Adversário pensando.', game.liveEvaluation ? 'A avaliação roda em paralelo. Você pode explorar as etiquetas prontas sem alterar a partida.' : 'Partida normal: nenhuma intervenção durante o jogo.');
      }
      scheduleBotTurn();
    } else {
      botThinking = false;
      moveStartedAt = Date.now();
      $('turnIndicator').textContent = isPhysicalGame() ? `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o lance` : 'Sua vez · arraste ou clique';
      if (isGuidedGame()) {
        activateCoachObservation();
      } else if (isEvaluationGame()) {
        setCoach('Sua vez.', 'Jogue como você jogaria normalmente.');
      } else {
        setCoach('Sua vez.', game.liveEvaluation ? 'Continue jogando. A classificação aparece quando o Stockfish terminar o cálculo.' : 'Sem ajuda durante a partida normal.');
      }
    }
  }

  function botTurn() {
    botTimer = null;
    if (!game || isPhysicalGame() || game.status !== 'playing' || game.state.turn === game.userColor) {
      botThinking = false;
      return;
    }
    const move = HumanBot.chooseMove(game.state, game.botLevel || 300, { focus: game.trainingFocus });
    if (move) makeMove(move, false, true);
  }

  function botCoachObservation() {
    const last = game?.state?.lastMove;
    if (!last) return 'Não mova por impulso. Primeiro descubra o que a última jogada mudou.';
    if (Core.inCheck(game.state, game.userColor)) {
      return 'Você está em xeque. Aqui não existe “meu plano” ainda: primeiro descubra quais respostas tiram o rei do xeque.';
    }
    const movedPiece = game.state.board[last.toRow][last.toCol];
    const destination = Core.squareName(last.toRow, last.toCol);
    return `A ${pieceName(movedPiece)} adversária foi para ${destination}. Não escolha seu lance ainda. O que essa jogada mudou: atacou algo, defendeu algo ou abriu uma linha? Se travar, use “Como eu penso agora?”; se ainda não enxergar, peça uma pista.`;
  }

  function evaluationDecisionCount() {
    if (!game) return 0;
    return game.history.filter((entry) => entry.color === game.userColor).length;
  }

  function completeEvaluationWindow() {
    if (!game || !isEvaluationGame() || game.status !== 'playing') return false;
    if (evaluationDecisionCount() < EVALUATION_DECISIONS) return false;
    game.status = 'ended';
    game.result = 'Avaliação';
    game.reason = 'assessment-complete';
    game.completedAt = new Date().toISOString();
    botThinking = false;
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    saveGame();
    renderGame();
    finishGame();
    return true;
  }

  function checkGameEnd() {
    if (!game || game.status !== 'playing') return false;
    const status = Core.gameStatus(game.state, game.positionCounts);
    if (!status.ended) return false;

    game.status = 'ended';
    game.reason = status.reason;
    game.result = resultFromStatus(status, game.userColor);
    game.completedAt = new Date().toISOString();
    botThinking = false;
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    game.coachStep = null;
    saveGame();
    renderGame();
    finishGame();
    return true;
  }

  function finishGame() {
    const summary = Analysis.summarizeHistory(game.history, game.userColor);
    if (game.liveEvaluation) for (const [field,label] of [['inaccuracies','inaccuracy'],['mistakes','mistake'],['blunders','blunder']]) summary[field] = game.history.filter(entry => entry.color === game.userColor && entry.liveEvaluation?.verified?.classification === label).length;

    if (game.source === 'critical-replay') {
      finishCriticalReplay(summary);
      return;
    }

    profile.games += 1;
    if (game.result === 'Vitória') profile.wins += 1;
    else if (game.result === 'Derrota') profile.losses += 1;
    else if (game.result === 'Empate') profile.draws += 1;

    profile.stats.blunders += summary.blunders;
    profile.stats.mistakes += summary.mistakes;
    profile.stats.inaccuracies += summary.inaccuracies;
    profile.stats.interventions += game.interventions;
    profile.stats.materialLost += game.materialLost;
    profile.stats.materialWon += game.materialWon;

    game.history.forEach((entry, index) => updatePatterns(entry, index, game.userColor));
    updateSkillsFromGame(summary);
    const analysis = buildAnalysis(summary);
    if (game.liveEvaluation || game.history.some(entry => entry.liveEvaluation)) Object.assign(analysis, Live.snapshot(game.history, game.userColor), {liveEnabled:true,liveSessionId:game.id});
    const archiveItem = Archive.createArchiveItem(game, summary, pgnText(), analysis);
    game.archiveId = archiveItem.id;
    profile.gameArchive = Archive.add(profile.gameArchive, archiveItem, Infinity);
    profile.lastAnalysis = archiveItem.analysis;

    if (isEvaluationGame()) {
      const freshAssessment = PlayerModel.assessGame(game.history, game.userColor, summary);
      profile.assessment = PlayerModel.mergeAssessment(profile.assessment, freshAssessment);
      profile.rating = profile.assessment.estimate.center;
      profile.missionStart = profile.rating;
      profile.target = nextTargetForLevel(profile.rating);
      profile.baseline.completed = true;
      profile.baseline.completedAt = new Date().toISOString();
      profile.baseline.summary = { accuracy: null, weakest: profile.assessment.primaryWeakness || 'change' };
      trainingState.mode = profile.assessment.primaryWeakness || 'change';
      profile.selectedOpening = Openings.recommended(profile.assessment)[0]?.id || null;
    } else if (profile.assessment?.completed && !game.liveEvaluation && !isPhysicalGame() && game.source !== 'opening-practice' && game.source !== 'mistake-review') {
      profile.rating = updateTrainingRating(profile.rating, game.botLevel || profile.rating || 300, game.result);
      advanceMissionIfNeeded();
      const freshAssessment = PlayerModel.assessGame(game.history, game.userColor, summary);
      profile.assessment = PlayerModel.mergeAssessment(profile.assessment, freshAssessment);
      profile.assessment.estimate.center = profile.rating;
      profile.assessment.estimate.low = Math.max(100, profile.rating - (profile.assessment.games >= 5 ? 125 : 200));
      profile.assessment.estimate.high = profile.rating + (profile.assessment.games >= 5 ? 125 : 200);
    }

    saveProfile();
    saveGame();
    renderAnalysis();
    $('reviewFinishedGame').classList.remove('hidden');

    $('turnIndicator').textContent = game.result;
    $('gameStatus').textContent = `${game.result} · ${reasonLabel(game.reason)}`;

    if (isEvaluationGame()) {
      const estimate = profile.assessment.estimate;
      const style = profile.assessment.style;
      setCoach('Avaliação inicial concluída.', `Estimativa inicial: ${estimate.low}–${estimate.high}. Estilo observado: ${style.label}. Agora o catálogo e as aberturas podem usar suas decisões reais.`);
      refreshProfileUI();
      switchView('home');
      showToast('Avaliação concluída. Seu perfil e suas recomendações já foram atualizados.');
      return;
    }

    const livePending = game.liveEvaluation && liveQueue.pending(livePrefix(game));
    const message = livePending ? 'A partida terminou. As avaliações pendentes continuam em segundo plano e serão salvas no diagnóstico.' : game.result === 'Não informado' ? 'Registro concluído. Vamos examinar as decisões, sem presumir o resultado.' : game.result === 'Vitória'
      ? (summary.blunders > 0
        ? 'Você venceu. Não confunda o resultado com uma partida limpa; ainda há decisões para corrigir.'
        : 'Poucos erros graves. Desta vez o resultado acompanhou a qualidade das decisões.')
      : game.result === 'Derrota'
        ? 'A derrota não é o diagnóstico. O padrão que levou a ela é.'
        : 'Empate. Ainda existem decisões suficientes para estudar.';

    setCoach(`${game.result}.`, message);
  }


  function nextTargetForLevel(level) {
    const milestones = [300, 500, 700, 900, 1100, 1300, 1500, 1800, 2000];
    const numeric = Number(level) || 0;
    return milestones.find((milestone) => milestone > numeric) || Math.ceil((numeric + 200) / 100) * 100;
  }

  function advanceMissionIfNeeded() {
    const milestones = [300, 500, 700, 900, 1100, 1300, 1500, 1800, 2000];
    if (profile.rating < profile.target) return;
    const next = milestones.find((milestone) => milestone > profile.target);
    if (!next) return;
    profile.missionStart = profile.target;
    profile.target = next;
  }

  function updateTrainingRating(playerRating, botRating, result) {
    const current = Number(playerRating) || Number(botRating) || 300;
    const opponent = Number(botRating) || 150;
    const expected = 1 / (1 + (10 ** ((opponent - current) / 400)));
    const score = result === 'Vitória' ? 1 : result === 'Empate' ? 0.5 : 0;
    const delta = Math.max(-20, Math.min(20, Math.round(24 * (score - expected))));
    return Math.max(100, Math.min(3000, current + delta));
  }

  function finishMistakeReview(entry) {
    const index = profile.recentMistakes.findIndex((item) => item.id === game.sourceMistakeId);
    if (index < 0 || !entry?.analysis) {
      game.status = 'ended';
      game.reviewComplete = true;
      game.reviewOutcome = 'repeat';
      saveGame();
      $('gameStatus').textContent = 'Revisão concluída';
      $('turnIndicator').textContent = 'Concluída';
      setCoach('Revisão concluída.', 'A posição foi jogada, mas não encontrei dados suficientes para comparar as duas decisões.');
      return;
    }

    const mistake = profile.recentMistakes[index];
    const retry = Mistakes.evaluateRetry(mistake, entry.analysis);
    profile.recentMistakes[index] = Mistakes.applyReview(mistake, retry);
    profile.reviews.mistakeAttempts += 1;
    if (retry.result === 'success') profile.reviews.mistakeWins += 1;
    if (retry.result === 'partial') profile.reviews.mistakePartials += 1;

    if (retry.result === 'success') {
      profile.skills['Visão'] = clampSkill(profile.skills['Visão'] + 0.05);
      profile.skills['Defesa'] = clampSkill(profile.skills['Defesa'] + 0.04);
    } else if (retry.result === 'partial') {
      profile.skills['Visão'] = clampSkill(profile.skills['Visão'] + 0.02);
    }

    game.status = 'ended';
    game.reviewComplete = true;
    game.reviewOutcome = retry.result;
    game.completedAt = new Date().toISOString();
    saveProfile();
    saveGame();
    renderMistakes();

    $('gameStatus').textContent = 'Revisão concluída';
    $('turnIndicator').textContent = retry.result === 'success' ? 'Corrigido' : retry.result === 'partial' ? 'Melhorou' : 'Repetiu';

    if (retry.result === 'success') {
      setCoach(
        'Melhor decisão.',
        `Você reduziu a perda estimada de ${roundOne(retry.originalLoss)} para ${roundOne(retry.newLoss)}. O importante agora é reconhecer esse padrão numa posição diferente.`
      );
    } else if (retry.result === 'partial') {
      setCoach(
        'Melhor, mas ainda não resolvido.',
        `A nova decisão perdeu menos qualidade (${roundOne(retry.originalLoss)} → ${roundOne(retry.newLoss)}), mas ainda há um problema para eliminar.`
      );
    } else {
      setCoach(
        'O padrão se repetiu.',
        'Trocar o lance sem mudar o processo não basta. Volte à pergunta básica: o que o adversário pode fazer imediatamente depois?'
      );
    }
  }

  function finishCriticalReplay(summary) {
    profile.reviews.criticalAttempts += 1;
    if (game.result === 'Vitória') profile.reviews.criticalWins += 1;

    const clean = summary.blunders === 0 && summary.mistakes <= 1;
    if (clean) {
      profile.skills['Visão'] = clampSkill(profile.skills['Visão'] + 0.04);
      profile.skills['Defesa'] = clampSkill(profile.skills['Defesa'] + 0.04);
    }

    saveProfile();
    saveGame();
    $('turnIndicator').textContent = game.result;
    $('gameStatus').textContent = `Revisão · ${game.result}`;
    setCoach(
      'Revisão concluída.',
      clean
        ? 'Você voltou ao problema e não repetiu um erro grave. Isso vale mais do que simplesmente lembrar a resposta.'
        : 'Repetir a posição só serve se o processo mudar. Ainda há algo nessa decisão para revisar.'
    );
  }

  function updateSkillsFromGame(summary) {
    const cleanFactor = summary.userMoves ? Math.max(0, 1 - ((summary.blunders * 2 + summary.mistakes) / summary.userMoves)) : 0;
    profile.skills['Visão'] = clampSkill(profile.skills['Visão'] + (cleanFactor * 0.10));
    profile.skills['Ameaças'] = clampSkill(profile.skills['Ameaças'] + (cleanFactor * 0.11));
    if (summary.blunders === 0 && summary.userMoves >= 8) profile.skills['Defesa'] = clampSkill(profile.skills['Defesa'] + 0.08);
  }

  function clampSkill(value) {
    return Math.max(0, Math.min(10, Number(value) || 0));
  }

  function buildAnalysis(summary, sourceGame) {
    const analyzedGame = sourceGame || game;
    let headline = 'Ainda estou coletando um padrão confiável.';
    let text = 'Uma partida isolada ajuda, mas não é suficiente para afirmar uma fraqueza com segurança.';
    const tags = [];

    if (summary.blunders >= 2 || summary.exposedMoves >= 3) {
      headline = 'Você ainda confirma jogadas antes de verificar a resposta adversária.';
      text = `Nesta partida apareceram ${summary.blunders} erros graves e ${summary.exposedMoves} movimentos que deixaram peças expostas. O foco prioritário deve ser visão de ameaças, não teoria de abertura.`;
      tags.push('ameaças', 'peças expostas', 'processo de decisão');
    } else if (summary.blunders === 1 || summary.mistakes >= 2) {
      headline = 'A visão está melhorando, mas ainda existem pontos cegos.';
      text = 'O número de erros graves foi limitado, porém ainda houve decisões que perderam qualidade por falta de verificação. Vale repetir posições semelhantes sem avisar o tema.';
      tags.push('visão', 'transferência', 'consistência');
    } else if (summary.userMoves >= 6) {
      headline = 'Nenhum padrão grave dominou esta partida.';
      text = 'Isso não significa que a partida foi perfeita. Significa apenas que o detector básico não encontrou uma sequência forte de erros recorrentes. O próximo teste deve ser sem assistência.';
      tags.push('independência', 'consistência');
    }

    for (const concept of summary.topConcepts) {
      if (!tags.includes(concept.name)) tags.push(concept.name);
    }

    const critical = summary.critical;
    const allowedMateInOne = critical?.analysis?.risk?.type === 'mate-in-one';
    if (allowedMateInOne) {
      headline = 'Você permitiu mate em um lance.';
      text = `Antes de ${critical.notation}, faltou a verificação mais importante: quais xeques o adversário teria depois da sua jogada. Treine esse filtro antes de pensar no seu próprio plano.`;
      tags.length = 0;
      tags.push('mate em 1', 'xeques adversários', 'o que mudou?', 'segurança do rei');
    }

    return {
      result: analyzedGame.result,
      reason: analyzedGame.reason,
      materialLost: roundOne(analyzedGame.materialLost),
      materialWon: roundOne(analyzedGame.materialWon),
      blunders: summary.blunders,
      mistakes: summary.mistakes,
      inaccuracies: summary.inaccuracies,
      interventions: analyzedGame.interventions,
      userColor: analyzedGame.userColor === 'b' ? 'b' : 'w',
      headline,
      text,
      tags: tags.slice(0, 5),
      criticalFen: critical?.fenBefore || null,
      criticalMove: critical?.notation || null,
      criticalUci: critical?.uci || null,
      criticalText: critical
        ? allowedMateInOne
          ? `Antes de ${critical.notation}, o adversário passou a ter mate em um lance. Encontre uma alternativa que elimine essa ameaça sem olhar a resposta.`
          : `Antes de ${critical.notation}, a avaliação heurística caiu aproximadamente ${roundOne(critical.analysis.classification.loss)} ponto(s). Tente encontrar uma alternativa sem olhar a resposta.`
        : 'Não houve um momento crítico forte detectado pelo analisador local.',
      engine: null,
      engineReview: null
    };
  }

  function roundOne(number) {
    return Math.round((Number(number) || 0) * 10) / 10;
  }

  function showWarning(risk) {
    game.interventions += 1;
    saveGame();
    $('warningTitle').textContent = risk.title || 'Pare.';
    $('warningText').textContent = risk.type === 'mate-in-one'
      ? 'Antes de confirmar, quero que você pense como o adversário por um lance.'
      : `Sua ideia pode fazer sentido, mas existe um problema imediato depois de colocar essa peça em ${risk.square}.`;
    $('warningHint').textContent = '';
    $('warningHint').dataset.level = '0';
    $('warningHint').classList.add('hidden');
    $('askMoveHint').textContent = 'ME AJUDE A PENSAR';
    $('warningModal').classList.remove('hidden');
    $('coachWarnings').textContent = `${game.interventions} ${game.interventions === 1 ? 'intervenção' : 'intervenções'}`;
  }

  function setCoach(title, message) {
    showLight($('playLightPortrait'), { pending: botThinking || Boolean(game?.liveEvaluation && liveQueue.pending(livePrefix(game))), stage: game?.status === 'ended' ? 'summary' : 'start' });
    $('coachStateTitle').textContent = title;
    $('coachMessage').textContent = message;
  }

  function pieceSvgMarkup(piece) {
    const color = Core.colorOf(piece) === 'w' ? 'w' : 'b';
    const type = String(piece || 'P').toUpperCase();
    const label = pieceAriaName(piece);
    return `<img class="piece-art" src="assets/pieces/${color}${type}.svg" alt="" aria-label="${label}" draggable="false" decoding="async">`;
  }

  function setPieceGraphic(node, piece) {
    node.innerHTML = pieceSvgMarkup(piece);
    node.dataset.piece = piece;
  }

  function pieceAriaName(piece) {
    const names = {
      P: 'peão branco', N: 'cavalo branco', B: 'bispo branco', R: 'torre branca', Q: 'dama branca', K: 'rei branco',
      p: 'peão preto', n: 'cavalo preto', b: 'bispo preto', r: 'torre preta', q: 'dama preta', k: 'rei preto'
    };
    return names[piece] || 'peça';
  }

  function canInteractWithGame(showMessage) {
    if (!game || game.status !== 'playing' || (!isPhysicalGame() && (game.state.turn !== game.userColor || botThinking))) return false;
    if (coachObservationPending()) {
      if (showMessage) {
        $('coachPanel')?.classList.add('coach-attention');
        setTimeout(() => $('coachPanel')?.classList.remove('coach-attention'), 650);
        showToast('No modo Light, primeiro responda “o que mudou?” — ou pule esta etapa.');
      }
      return false;
    }
    return true;
  }

  function movesFromSquare(row, col) {
    if (!game) return [];
    return Core.generateLegalMoves(game.state, interactionColor()).filter((move) => (
      move.fromRow === row && move.fromCol === col
    ));
  }

  function chooseSelectedDestination(row, col) {
    if (!selected) return false;
    const destinationMoves = legalForSelected.filter((move) => move.toRow === row && move.toCol === col);
    if (!destinationMoves.length) return false;

    const promotionMoves = destinationMoves.filter((move) => move.promotion);
    if (promotionMoves.length) {
      promotionCandidates = promotionMoves;
      $('promotionModal').classList.remove('hidden');
      return true;
    }

    selected = null;
    legalForSelected = [];
    makeMove(destinationMoves[0], true, false);
    return true;
  }

  function castleMoveForRookTarget(row, col) {
    if (!selected || !game) return null;
    const selectedPiece = game.state.board[selected.row]?.[selected.col];
    if (!selectedPiece || Core.typeOf(selectedPiece) !== 'k') return null;
    if (row !== selected.row || ![0, 7].includes(col)) return null;
    const rook = game.state.board[row]?.[col];
    if (!rook || Core.typeOf(rook) !== 'r' || Core.colorOf(rook) !== interactionColor()) return null;
    const expectedToCol = col === 7 ? 6 : 2;
    return legalForSelected.find((move) => move.castle && move.toRow === row && move.toCol === expectedToCol) || null;
  }

  function chooseCastleViaRook(row, col) {
    const move = castleMoveForRookTarget(row, col);
    if (!move) return false;
    selected = null;
    legalForSelected = [];
    makeMove(move, true, false);
    return true;
  }

  function createDragGhost(piece, clientX, clientY) {
    const ghost = document.createElement('div');
    ghost.className = `drag-piece-ghost ${Core.colorOf(piece) === 'w' ? 'white-piece' : 'black-piece'}`;
    setPieceGraphic(ghost, piece);
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    positionDragGhost(ghost, clientX, clientY);
    return ghost;
  }

  function positionDragGhost(ghost, clientX, clientY) {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${Math.round(clientX)}px, ${Math.round(clientY)}px, 0) translate(-50%, -50%)`;
  }

  function cleanupBoardDrag() {
    if (!boardDrag) return;
    boardDrag.ghost?.remove();
    $('gameBoard')?.classList.remove('piece-dragging');
    boardDrag = null;
  }

  function beginBoardDrag(event) {
    const board = $('gameBoard');
    if (!board || event.button > 0) return;
    const pieceNode = event.target.closest('.piece');
    const square = pieceNode?.closest('.square');
    if (!pieceNode || !square || !board.contains(square)) return;
    if (!canInteractWithGame(true)) return;

    const row = Number(square.dataset.row);
    const col = Number(square.dataset.col);
    const piece = game.state.board[row]?.[col];
    if (!piece || Core.colorOf(piece) !== interactionColor()) return;

    // Se o rei já está selecionado e o jogador toca na própria torre, preserve
    // a seleção do rei para que o clique seja interpretado como roque.
    if (castleMoveForRookTarget(row, col)) return;

    const legal = movesFromSquare(row, col);
    if (!legal.length) return;

    event.preventDefault();
    selected = { row, col };
    legalForSelected = legal;
    boardDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      ghost: createDragGhost(piece, event.clientX, event.clientY)
    };
    board.classList.add('piece-dragging');
    try { board.setPointerCapture(event.pointerId); } catch (_) { /* capture opcional */ }
    renderGame();
  }

  function moveBoardDrag(event) {
    if (!boardDrag || event.pointerId !== boardDrag.pointerId) return;
    const distance = Math.hypot(event.clientX - boardDrag.startX, event.clientY - boardDrag.startY);
    if (distance > 5) boardDrag.moved = true;
    positionDragGhost(boardDrag.ghost, event.clientX, event.clientY);
  }

  function endBoardDrag(event) {
    if (!boardDrag || event.pointerId !== boardDrag.pointerId) return;
    const wasMoved = boardDrag.moved;
    const board = $('gameBoard');
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.square');
    cleanupBoardDrag();
    try { board?.releasePointerCapture(event.pointerId); } catch (_) { /* capture opcional */ }

    if (!wasMoved) return;
    event.preventDefault();
    suppressBoardClickUntil = Date.now() + 400;

    if (!target || !board?.contains(target)) {
      selected = null;
      legalForSelected = [];
      renderGame();
      return;
    }

    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    if (chooseCastleViaRook(row, col)) return;
    if (chooseSelectedDestination(row, col)) return;

    const piece = game?.state.board[row]?.[col];
    if (piece && Core.colorOf(piece) === interactionColor()) {
      selected = { row, col };
      legalForSelected = movesFromSquare(row, col);
    } else {
      selected = null;
      legalForSelected = [];
    }
    renderGame();
  }

  function renderBoard(element, state, options) {
    const opts = options || {};
    element.innerHTML = '';
    const interactive = opts.interactive !== false;
    const orientation = opts.orientation === 'b' ? 'b' : 'w';
    const rows = orientation === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = orientation === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

    for (let displayRow = 0; displayRow < 8; displayRow += 1) {
      const row = rows[displayRow];
      for (let displayCol = 0; displayCol < 8; displayCol += 1) {
        const col = cols[displayCol];
        const square = document.createElement('div');
        square.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
        square.dataset.row = row;
        square.dataset.col = col;

        const last = state.lastMove;
        if (last && last.fromRow === row && last.fromCol === col) square.classList.add('last', 'last-from');
        if (last && last.toRow === row && last.toCol === col) square.classList.add('last', 'last-to');

        if (opts.bestMove) {
          if (opts.bestMove.fromRow === row && opts.bestMove.fromCol === col) square.classList.add('best-from');
          if (opts.bestMove.toRow === row && opts.bestMove.toCol === col) square.classList.add('best-to');
        }

        if (opts.selected && opts.selected.row === row && opts.selected.col === col) {
          square.classList.add('selected');
        }

        const legal = opts.legal?.find((move) => move.toRow === row && move.toCol === col);
        if (legal) {
          square.classList.add('legal');
          if (legal.capture) square.classList.add('capture');
          if (legal.castle) square.classList.add('castle-target');
        }
        const castleForRook = opts.legal?.find((move) => move.castle && move.toRow === row && (move.toCol === 6 ? col === 7 : col === 0));
        if (castleForRook) square.classList.add('castle-rook-target');

        if (opts.hintSquare === Core.squareName(row, col)) square.classList.add('hint');

        const piece = state.board[row][col];
        if (piece) {
          const span = document.createElement('span');
          span.className = `piece ${Core.colorOf(piece) === 'w' ? 'white-piece' : 'black-piece'}`;
          setPieceGraphic(span, piece);
          square.appendChild(span);
        }
        if (legal?.castle) {
          const label = document.createElement('span');
          label.className = 'castle-label';
          label.textContent = 'ROQUE';
          square.appendChild(label);
        }

        if (displayRow === 7) {
          const file = document.createElement('span');
          file.className = 'coord file';
          file.textContent = Core.FILES[col];
          square.appendChild(file);
        }

        if (displayCol === 0) {
          const rank = document.createElement('span');
          rank.className = 'coord rank';
          rank.textContent = 8 - row;
          square.appendChild(rank);
        }

        if (interactive && opts.onClick) {
          const coordinate = Core.squareName(row, col);
          const pieceName = piece ? pieceAriaName(piece) : 'casa vazia';
          square.setAttribute('role', 'button');
          square.tabIndex = 0;
          square.setAttribute('aria-label', `${coordinate}, ${pieceName}`);
          square.addEventListener('click', () => opts.onClick(row, col));
          square.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            opts.onClick(row, col);
          });
        }

        element.appendChild(square);
      }
    }
    if (opts.arrow) {
      const a = opts.arrow;
      const point = (row, col) => orientation === 'b' ? [7.5 - col, 7.5 - row] : [col + .5, row + .5];
      const [x1,y1] = point(a.fromRow,a.fromCol), [x2,y2] = point(a.toRow,a.toCol);
      const id = `${element.id}-arrow`;
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.setAttribute('viewBox', '0 0 8 8');
      overlay.setAttribute('aria-hidden','true');
      overlay.classList.add('response-arrow');
      overlay.innerHTML = `<defs><marker id="${id}" markerWidth="3" markerHeight="3" refX="2" refY="1.5" orient="auto"><path d="M0,0 L3,1.5 L0,3 Z" fill="#c94d60"/></marker></defs><line pathLength="1" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c94d60" stroke-width=".12" marker-end="url(#${id})"/>`;
      element.appendChild(overlay);
      for (const [r,c] of [[a.fromRow,a.fromCol],[a.toRow,a.toCol]]) element.querySelector(`[data-row="${r}"][data-col="${c}"]`)?.classList.add('response-square');
    }
  }

  function livePrefix(target) { return `${storageScope}:${profileEpoch}:${target.id}`; }

  function enqueueLiveHistory(target, retryErrors = false) {
    if (!target) return;
    const scope = storageScope, epoch = profileEpoch;
    target.id ||= newLocalId();
    const prefix = livePrefix(target);
    target.history.forEach((entry, index) => {
      if (!entry.uci || !entry.fenBefore || entry.liveEvaluation?.status === 'ready' || (entry.liveEvaluation?.status === 'error' && !retryErrors)) return;
      liveQueue.enqueue({ key: `${prefix}:${index + 1}`, entry, ply: index + 1,
        valid: () => storageScope === scope && profileEpoch === epoch && (game === target || profile.gameArchive.some(item => item.id === target.archiveId || item.analysis?.liveSessionId === target.id)),
        onResult: () => {
          if (game === target) { saveGame(); renderLiveEvaluation(); }
          const archive = profile.gameArchive.find(item => item.id === target.archiveId || item.analysis?.liveSessionId === target.id);
          if (!archive || archive.moves[index]?.uci !== entry.uci || archive.moves[index]?.fenBefore !== entry.fenBefore) return;
          archive.moves[index].liveEvaluation = entry.liveEvaluation;
          if (entry.liveEvaluation.verified) archive.moves[index].classification = entry.liveEvaluation.verified.classification;
          const snapshot = Live.snapshot(archive.moves, archive.analysis?.userColor || target.userColor);
          const verified = new Map((archive.analysis?.phaseEngine?.moves || []).map(move => [move.ply, move]));
          snapshot.phaseEngine.moves.forEach(move => verified.set(move.ply, move));
          archive.analysis = { ...archive.analysis, ...snapshot, phaseEngine: { moves: [...verified.values()].sort((a,b)=>a.ply-b.ply) }, liveEnabled: true, liveSessionId: target.id };
          for (const [field,label] of [['inaccuracies','inaccuracy'],['mistakes','mistake'],['blunders','blunder']]) {
            const count = archive.analysis.phaseEngine.moves.filter(move => move.classification === label).length;
            profile.stats[field] = Math.max(0, (profile.stats[field] || 0) + count - (archive[field] || 0));
            archive[field] = count;
          }
          if (profile.lastAnalysis?.archiveId === archive.id) profile.lastAnalysis = archive.analysis;
          saveProfile();
          if (currentReviewArchiveItem()?.id === archive.id) renderAnalysis();
          if (game === target && game.status === 'ended' && !liveQueue.pending(prefix)) setCoach(`${game.result}.`, game.history.some(move => move.liveEvaluation?.status === 'error') ? 'Alguns lances não puderam ser avaliados. O registro foi preservado; você pode tentar novamente.' : 'As avaliações foram salvas. Toque nas etiquetas para estudar as respostas e abra o diagnóstico por fase.');
        }
      });
    });
  }

  function resumeArchivedLive() {
    for (const archive of profile.gameArchive) {
      if (!archive.analysis?.liveEnabled || !archive.moves.some(entry => !entry.liveEvaluation || entry.liveEvaluation.status === 'pending')) continue;
      if (game?.id === archive.analysis.liveSessionId) { enqueueLiveHistory(game); continue; }
      enqueueLiveHistory({ id: archive.analysis.liveSessionId || archive.id, archiveId: archive.id, history: archive.moves, userColor: archive.analysis.userColor });
    }
  }

  function renderLiveEvaluation() {
    if (!game) return;
    $('liveEvaluationPanel').classList.toggle('hidden', !game.liveEvaluation);
    if (!game.liveEvaluation) return;
    const ready = game.history.filter(entry => entry.liveEvaluation?.status === 'ready').length;
    const errors = game.history.filter(entry => entry.liveEvaluation?.status === 'error').length;
    $('liveEvaluationStatus').textContent = game.history.length
      ? `Stockfish · ${ready} de ${game.history.length} lances avaliados.${errors ? ` ${errors} indisponível(is); tente novamente.` : ' Você pode continuar jogando durante o cálculo.'}`
      : 'Stockfish · aguardando o primeiro lance. Registre a partida normalmente.';
    $('retryLiveEvaluation').classList.toggle('hidden', !errors);
    const list = $('liveEvaluationList');
    const follow = game.history.length > Number(list.dataset.count || 0) || list.scrollWidth - list.clientWidth - list.scrollLeft < 48;
    list.innerHTML = game.history.map((entry,index) => {
      const result = entry.liveEvaluation;
      const state = Core.parseFEN(entry.fenBefore);
      const prefix = `${state.fullmove}${entry.color === 'b' ? '...' : '.'} ${entry.notation}`;
      return result?.status === 'ready'
        ? `<button class="live-label ${result.verified.classification}" data-live-ply="${index+1}" aria-label="${escapeHtml(prefix)}: ${escapeHtml(result.label)}. Explicar avaliação.">${escapeHtml(prefix)} · ${escapeHtml(result.label)}</button>`
        : `<span class="live-label pending" data-live-pending="${index+1}">${escapeHtml(prefix)} · ${result?.status === 'error' ? 'Indisponível' : 'Calculando…'}</span>`;
    }).join('');
    list.dataset.count = String(game.history.length);
    if (follow) list.scrollLeft = list.scrollWidth;
    const last = game.history.at(-1)?.liveEvaluation;
    showLight($('playLightPortrait'), {pending: game.history.some(entry => entry.liveEvaluation?.status === 'pending'), stage: game.status === 'ended' ? 'summary' : last?.verified?.reply ? 'reply' : 'start', confirmedThreat: Boolean(last?.verified?.reply)});
  }

  function openLiveExplanation(ply) {
    const entry = game?.history[ply-1];
    if (entry?.liveEvaluation?.status !== 'ready') return;
    liveExplanation = { entry: JSON.parse(JSON.stringify(entry)), index: 0, orientation: game.userColor };
    renderLiveExplanation();
    $('liveExplanation').scrollIntoView({block:'start',behavior:'instant'});
  }

  function renderLiveExplanation() {
    if (!liveExplanation) return;
    const {entry,orientation} = liveExplanation;
    const before = Core.parseFEN(entry.fenBefore);
    let state = Core.makeMoveCopy(before, Core.moveFromUCI(before, entry.uci));
    const line = entry.liveEvaluation.continuation || [];
    liveExplanation.index = Math.min(liveExplanation.index, Math.max(0,line.length-1));
    let arrow = null, text = '';
    for (const uci of line.slice(0, liveExplanation.index+1)) {
      const move = Core.moveFromUCI(state,uci); if (!move) break;
      text = `Continuação possível das ${state.turn === 'w' ? 'brancas' : 'pretas'}: ${Weakness.words(state, uci, orientation)}.`;
      state = Core.makeMoveCopy(state,move); arrow = move;
    }
    if (!line.length) {
      const status = Core.gameStatus(state);
      text = status.reason === 'checkmate' ? 'Este lance encerra a partida com xeque-mate. O adversário não tem resposta legal.'
        : status.ended ? 'Este lance encerra a posição por empate. Não há continuação a jogar.' : 'O Stockfish não retornou uma continuação suficiente nesta avaliação. Nenhuma resposta foi inventada.';
    }
    $('liveExplanation').classList.remove('hidden');
    $('liveExplanationTitle').textContent = `${entry.notation} · ${entry.liveEvaluation.label}`;
    $('liveExplanationText').textContent = `Lance jogado: ${PhaseDiagnosis.describeMove(before,entry.uci)} (${entry.notation}). ${text}`;
    renderBoard($('liveExplanationBoard'),state,{interactive:false,orientation,arrow});
    $('nextLiveContinuation').disabled = !line.length || liveExplanation.index >= line.length-1;
    $('restartLiveContinuation').disabled = !line.length || liveExplanation.index === 0;
  }

  function renderGame() {
    if (!game) return;
    renderBoard($('gameBoard'), game.state, {
      selected,
      legal: legalForSelected,
      onClick: onGameSquare,
      orientation: game.userColor
    });
    if (isPhysicalGame() && game.status === 'playing') $('turnIndicator').textContent = `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o lance`;
    renderMoveLog();
    renderLiveEvaluation();
    $('finishRecording').disabled = isEvaluationGame() || game.status !== 'playing' || !game.history.length;
    renderCoachObservation();

    const material = Core.materialScore(game.state);
    $('materialStatus').textContent = Math.abs(material) < 0.05
      ? 'Material igual'
      : material > 0
        ? `+${material.toFixed(1)} brancas`
        : `+${Math.abs(material).toFixed(1)} pretas`;

    $('coachWarnings').textContent = `${game.interventions} ${game.interventions === 1 ? 'intervenção' : 'intervenções'}`;
    requestAnimationFrame(fitGameBoard);
  }

  function fitGameBoard() {
    const board = $('gameBoard');
    if (!board || !$('view-play')?.classList.contains('active-view')) return;
    const column = board.closest('.board-column');
    if (!column) return;
    const rect = board.getBoundingClientRect();
    const mobileNav = document.querySelector('.mobile-nav');
    const navHeight = getComputedStyle(mobileNav).display === 'none' ? 0 : mobileNav.getBoundingClientRect().height;
    const bottomReserve = 78 + navHeight;
    const availableHeight = Math.max(220, window.innerHeight - rect.top - bottomReserve);
    const availableWidth = Math.max(280, column.clientWidth);
    const cap = window.innerWidth <= 760 ? availableWidth : 760;
    const size = Math.floor(Math.min(availableWidth, availableHeight, cap));
    board.style.width = `${size}px`;
    board.style.height = `${size}px`;
  }

  function onGameSquare(row, col) {
    if (Date.now() < suppressBoardClickUntil) return;
    if (!canInteractWithGame(true)) return;

    if (chooseCastleViaRook(row, col)) return;
    if (chooseSelectedDestination(row, col)) return;

    const piece = game.state.board[row][col];
    if (piece && Core.colorOf(piece) === interactionColor()) {
      selected = { row, col };
      legalForSelected = movesFromSquare(row, col);
      renderGame();
      return;
    }

    selected = null;
    legalForSelected = [];
    renderGame();
  }

  function renderMoveLog() {
    const element = $('moveLog');
    if (!game.history.length) {
      element.innerHTML = '<div class="empty-log">A partida ainda não começou.</div>';
      return;
    }

    let html = '';
    for (let index = 0; index < game.history.length; index += 2) {
      html += `<div class="move-num">${(index / 2) + 1}.</div>`;
      html += `<div class="move-cell">${escapeHtml(game.history[index]?.notation || '')}</div>`;
      html += `<div class="move-cell">${escapeHtml(game.history[index + 1]?.notation || '')}</div>`;
    }
    element.innerHTML = html;
    element.scrollTop = element.scrollHeight;
  }

  function pgnText() {
    if (!game) return '';
    let text = '';
    for (let index = 0; index < game.history.length; index += 2) {
      text += `${(index / 2) + 1}. ${game.history[index]?.notation || ''} ${game.history[index + 1]?.notation || ''} `;
    }
    if (game.status === 'ended') {
      if (game.result === 'Empate') text += '1/2-1/2';
      else if (game.result === 'Vitória') text += game.userColor === 'w' ? '1-0' : '0-1';
      else if (game.result === 'Derrota') text += game.userColor === 'w' ? '0-1' : '1-0';
      else text += '*';
    }
    return text.trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function currentExercise() {
    return Training.getExercise(trainingState.mode, trainingState.index);
  }

  function patternMemoryForMode(mode) {
    const pattern = PatternMemory.patternByMode(mode);
    if (!pattern) return null;
    return { pattern, state: PatternMemory.stateForProfile(profile, pattern.id) };
  }

  function recordPatternMemory(mode, correct, hints) {
    const data = patternMemoryForMode(mode);
    if (!data) return;
    profile.patternMemory[data.pattern.id] = PatternMemory.recordAttempt(data.state, {
      correct: Boolean(correct),
      hints: Math.max(0, Number(hints) || 0)
    });
  }

  function renderTrainingMemoryStrip() {
    const duePatterns = PatternMemory.catalog(profile).filter((item) => item.due);
    const dueMistakes = Mistakes.dueMistakes(profile.recentMistakes);
    if ($('memoryDueCount')) $('memoryDueCount').textContent = String(duePatterns.length);
    if ($('mistakeDueCount')) $('mistakeDueCount').textContent = String(dueMistakes.length);
    if ($('memoryDueText')) $('memoryDueText').textContent = duePatterns.length
      ? `${duePatterns[0].title} está esperando uma revisão sem aviso.`
      : 'Nenhum padrão vencido agora. Continue jogando para alimentar a memória.';
    if ($('mistakeDueText')) $('mistakeDueText').textContent = dueMistakes.length
      ? `${Mistakes.primaryCategory(dueMistakes[0])}: volte à posição e tente uma resposta melhor.`
      : 'Seus erros revisados voltam em intervalos maiores quando você acerta.';
    if ($('reviewDuePattern')) $('reviewDuePattern').disabled = duePatterns.length === 0;
    if ($('reviewDueMistake')) $('reviewDueMistake').disabled = dueMistakes.length === 0;
  }

  function renderDevelopmentLab() {
    if (!$('developmentBoard') || !profile.assessment?.completed) return;
    const item = Development.scenario(developmentState.index);
    const state = Core.parseFEN(item.fen);
    renderBoard($('developmentBoard'), state, {
      hintSquare: developmentState.solved ? item.focusSquare : null
    });
    $('developmentTitle').textContent = item.title;
    $('developmentQuestion').textContent = item.question;
    $('developmentCounter').textContent = `${(developmentState.index % Development.SCENARIOS.length) + 1}/${Development.SCENARIOS.length}`;
    const attempts = Number(profile.thinking?.planAttempts) || 0;
    const correct = Number(profile.thinking?.planCorrect) || 0;
    $('developmentAccuracy').textContent = attempts ? `${Math.round((correct / attempts) * 100)}%` : '—';
    $('developmentChoices').innerHTML = item.choices.map((choice) => {
      const selected = developmentState.selected === choice;
      const className = selected ? (choice === item.answer ? ' correct' : ' wrong') : '';
      return `<button class="plan-choice${className}" data-plan-choice="${escapeHtml(choice)}" ${developmentState.solved ? 'disabled' : ''}>${escapeHtml(Development.choiceLabel(choice))}</button>`;
    }).join('');
    const feedback = $('developmentFeedback');
    if (!developmentState.selected) {
      feedback.classList.add('hidden');
      feedback.classList.remove('correct', 'wrong');
      $('developmentNext').disabled = true;
    } else {
      const result = Development.evaluateChoice(item, developmentState.selected);
      feedback.classList.remove('hidden', 'correct', 'wrong');
      feedback.classList.add(result.correct ? 'correct' : 'wrong');
      $('developmentFeedbackTitle').textContent = result.title;
      $('developmentFeedbackText').textContent = result.text;
      $('developmentFollowUp').textContent = result.followUp || '';
      $('developmentNext').disabled = !developmentState.solved;
    }
    renderTrainingMemoryStrip();
  }

  function chooseDevelopmentPlan(choice) {
    if (developmentState.solved) return;
    const item = Development.scenario(developmentState.index);
    const result = Development.evaluateChoice(item, choice);
    developmentState.selected = choice;
    profile.thinking.planAttempts = (Number(profile.thinking.planAttempts) || 0) + 1;
    if (result.correct) {
      developmentState.correct += 1;
      developmentState.solved = true;
      profile.thinking.planCorrect = (Number(profile.thinking.planCorrect) || 0) + 1;
      profile.thinking.planStreak = (Number(profile.thinking.planStreak) || 0) + 1;
    } else {
      developmentState.wrong += 1;
      developmentState.scenarioMisses = (Number(developmentState.scenarioMisses) || 0) + 1;
      profile.thinking.planStreak = 0;
    }
    if (item.patternId) {
      const current = PatternMemory.stateForProfile(profile, item.patternId);
      profile.patternMemory[item.patternId] = PatternMemory.recordAttempt(current, { correct: result.correct, hints: result.correct && developmentState.scenarioMisses > 0 ? 1 : 0 });
    }
    saveProfile();
    renderDevelopmentLab();
  }

  function nextDevelopmentScenario() {
    developmentState.index += 1;
    developmentState.selected = null;
    developmentState.solved = false;
    developmentState.scenarioMisses = 0;
    renderDevelopmentLab();
  }

  function reviewDuePattern() {
    const item = PatternMemory.catalog(profile).find((pattern) => pattern.due);
    if (!item) { showToast('Nenhum padrão está vencido agora.'); return; }
    setTrainingMode(item.mode);
    showToast(`Revisão: ${item.title}. O tema não será entregue durante a partida real.`);
  }

  function reviewDueMistake() {
    const mistake = Mistakes.dueMistakes(profile.recentMistakes)[0];
    if (!mistake) { showToast('Nenhum erro está vencido agora.'); return; }
    replayMistakePosition(mistake.id);
  }

  function renderTrainingCatalog() {
    const container = $('trainingCatalog');
    if (!container) return;
    const catalog = Training.catalog(profile);
    container.innerHTML = catalog.map((item, index) => {
      const memory = patternMemoryForMode(item.mode);
      const stage = memory ? PatternMemory.stageOf(memory.state) : null;
      const mastery = memory ? PatternMemory.mastery(memory.state) : 0;
      return `
      <button class="catalog-item ${item.mode === trainingState.mode ? 'active' : ''}" data-catalog-mode="${escapeHtml(item.mode)}">
        <span class="catalog-item-icon">${escapeHtml(item.icon)}</span>
        <span><strong>${index + 1}. ${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small><span class="catalog-meta"><b>${item.activities} posições-base${item.personalActivities ? ` · ${item.personalActivities} erro${item.personalActivities === 1 ? '' : 's'} seu${item.personalActivities === 1 ? '' : 's'}` : ''}</b><b>${escapeHtml(item.priority)}</b></span><em class="catalog-volume">${stage ? `Memória: ${stage.label} · ${mastery}%` : `Sessão: ${item.recommendedReps} repetições`}</em></span>
      </button>`;
    }).join('');
    if ($('catalogBasis')) $('catalogBasis').textContent = profile.assessment?.games > 1 ? `${profile.assessment.games} partidas` : 'avaliação';
  }

  function renderTraining() {
    const source = currentReviewArchiveItem();
    const available = source && Weakness.build([source], null, profile.gameArchive, profile.weaknessSeen || []);
    const resume = Boolean(profile.weaknessSession?.items?.length);
    $('trainFromHistory').disabled = !resume && !available;
    $('trainFromHistory').textContent = resume ? 'Continuar treino' : 'Treinar meu ponto fraco';
    $('weaknessEntryText').textContent = resume ? 'Seu treino ficou salvo. Continue da posição em que parou.' : available ? 'Comece por um erro da partida selecionada, entenda a resposta adversária e aplique o mesmo padrão em outra posição quando disponível.' : 'Importe uma partida para transformar um erro em treino. Você também pode usar os exemplos do importador.';
    const assessed = Boolean(profile.assessment?.completed);
    $('trainingLocked')?.classList.toggle('hidden', assessed);
    $('trainingExperience')?.classList.toggle('hidden', !assessed);
    if (!assessed) return;

    renderTrainingCatalog();
    renderDevelopmentLab();
    renderTrainingMemoryStrip();
    const exercise = currentExercise();
    const state = Core.parseFEN(exercise.fen);
    const memoryData = patternMemoryForMode(trainingState.mode);
    const memoryStage = memoryData ? PatternMemory.stageOf(memoryData.state) : null;
    const blindStage = ['recognize', 'apply', 'recall'].includes(memoryStage?.id);
    const seeStage = memoryStage?.id === 'see';
    const hintSquare = seeStage ? exercise.target : (trainingState.hintLevel >= exercise.hints.length ? exercise.target : null);
    renderBoard($('trainingBoard'), state, { onClick: onTrainingSquare, hintSquare });

    const [kicker, title] = Training.labels(trainingState.mode);
    $('exerciseKicker').textContent = memoryStage ? `MEMÓRIA · ${memoryStage.label}` : kicker;
    $('exerciseTitle').textContent = blindStage ? 'Sem tema informado' : title;
    $('exercisePrompt').textContent = seeStage
      ? `Primeiro veja o desenho. ${exercise.solution || exercise.prompt}`
      : blindStage
        ? 'Sem nome do tema: qual peça ou casa merece sua atenção primeiro nesta posição?'
        : exercise.prompt;

    if (seeStage && trainingState.hintLevel === 0) {
      $('exerciseHintText').textContent = 'Nesta etapa eu mostro o padrão. Clique na casa destacada e tente explicar com suas palavras por que ela importa.';
      $('trainingHint').textContent = 'PADRÃO VISÍVEL';
    } else if (trainingState.hintLevel > 0) {
      const hintIndex = Math.min(trainingState.hintLevel - 1, exercise.hints.length - 1);
      $('exerciseHintText').textContent = exercise.hints[hintIndex];
      $('trainingHint').textContent = trainingState.hintLevel >= exercise.hints.length ? 'ÚLTIMA EXPLICAÇÃO' : 'OUTRA PISTA';
    } else {
      $('exerciseHintText').textContent = 'Se travar, a primeira pista ensina por onde começar a olhar — sem entregar a resposta.';
      $('trainingHint').textContent = 'NÃO SEI COMO COMEÇAR';
    }

    $('exerciseScore').textContent = `${trainingState.correct}/${trainingState.correct + trainingState.wrong}`;
    $('trainCorrect').textContent = trainingState.correct;
    $('trainWrong').textContent = trainingState.wrong;
    $('trainHints').textContent = trainingState.hints;
    $('nextExercise').disabled = !trainingState.solved;
  }

  function showExerciseFeedback(kind, title, text) {
    const box = $('exerciseFeedback');
    if (!box) return;
    box.classList.remove('hidden', 'correct', 'wrong');
    box.classList.add(kind);
    $('exerciseFeedbackTitle').textContent = title;
    $('exerciseFeedbackText').textContent = text;
    if (window.innerWidth <= 760) {
      setTimeout(() => box.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }), 80);
    }
  }

  function onTrainingSquare(row, col) {
    if (trainingState.solved) return;
    const exercise = currentExercise();
    const square = Core.squareName(row, col);
    const bucket = profile.training[trainingState.mode] || (profile.training[trainingState.mode] = { attempts: 0, correct: 0, hints: 0 });
    bucket.attempts += 1;

    if (square === exercise.target) {
      trainingState.correct += 1;
      trainingState.solved = true;
      bucket.correct += 1;
      improveSkillForMode(trainingState.mode, 0.05);
      recordPatternMemory(trainingState.mode, true, trainingState.hintLevel + (trainingState.exerciseMisses > 0 ? 1 : 0));
      $('exerciseHintText').textContent = 'Agora pare um segundo e entenda por que você encontrou a resposta.';
      showExerciseFeedback('correct', 'Boa. Você viu a ideia.', exercise.solution || 'A resposta está correta. Agora tente reconhecer o mesmo padrão sem saber o nome do tema.');
      $('sessionCoachText').textContent = 'Uma resposta certa vale mais quando você consegue explicar o que mudou na posição.';
    } else {
      trainingState.wrong += 1;
      trainingState.exerciseMisses = (Number(trainingState.exerciseMisses) || 0) + 1;
      recordPatternMemory(trainingState.mode, false, trainingState.hintLevel);
      $('exerciseHintText').textContent = 'Ainda não. Não clique em outra casa no automático; peça uma pista ou reduza o problema.';
      showExerciseFeedback('wrong', 'Ainda não.', 'Não tente adivinhar. Separe o tabuleiro: última jogada, ataques, defensores e só depois escolha outra resposta.');
      $('sessionCoachText').textContent = 'Erro útil: agora sabemos onde seu olhar foi primeiro. Tente mudar o processo, não só a casa.';
    }

    saveProfile();
    renderTraining();
  }

  function improveSkillForMode(mode, amount) {
    const map = {
      change: ['Visão', 'Ameaças'], threat: ['Visão', 'Ameaças'], hanging: ['Visão', 'Defesa'],
      mate: ['Tática', 'Cálculo'], surprise: ['Visão', 'Ameaças'], development: ['Visão'],
      bishop: ['Visão'], fork: ['Tática', 'Cálculo'], afterdev: ['Cálculo']
    };
    for (const skill of map[mode] || ['Visão']) profile.skills[skill] = clampSkill((Number(profile.skills[skill]) || 0) + amount);
  }

  async function requestTrainingHint() {
    const exercise = currentExercise();
    if (trainingState.solved) return;

    trainingState.hints += 1;
    trainingState.hintLevel = Math.min(trainingState.hintLevel + 1, exercise.hints.length);
    profile.hints += 1;
    const bucket = profile.training[trainingState.mode] || (profile.training[trainingState.mode] = { attempts: 0, correct: 0, hints: 0 });
    bucket.hints += 1;
    saveProfile();
    renderTraining();

    const hintIndex = Math.min(trainingState.hintLevel - 1, exercise.hints.length - 1);
    const fallback = exercise.hints[hintIndex];
    if (trainingState.hintLevel <= 2) {
      const enhanced = await CoachAI.enhance({ mode: trainingState.mode, prompt: exercise.prompt, verifiedHint: fallback, hintLevel: trainingState.hintLevel }, fallback, 'Dê apenas uma pista progressiva. Ensine para onde direcionar a atenção sem revelar a resposta final.');
      if (!trainingState.solved && $('exerciseHintText')) $('exerciseHintText').textContent = enhanced;
    }
  }

  function nextExercise() {
    trainingState.index += 1;
    trainingState.solved = false;
    trainingState.hintLevel = 0;
    trainingState.exerciseMisses = 0;
    const box = $('exerciseFeedback');
    if (box) box.classList.add('hidden');
    renderTraining();
  }


  function importedResultLabel(result, side) {
    if (result === '1/2-1/2') return 'Empate';
    if (result === '1-0') return side === 'w' ? 'Vitória' : 'Derrota';
    if (result === '0-1') return side === 'b' ? 'Vitória' : 'Derrota';
    return 'Importada';
  }

  function openPgnImport() {
    $('importPgnError').classList.add('hidden');
    $('importPgnError').textContent = '';
    $('pgnImportModal').classList.remove('hidden');
    setTimeout(() => $('pgnInput').focus(), 0);
  }

  function closePgnImport() {
    $('pgnImportModal').classList.add('hidden');
  }

  function importPgnGame() {
    const raw = $('pgnInput').value.trim();
    const side = $('importSide').value === 'b' ? 'b' : 'w';
    const errorBox = $('importPgnError');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    if (!raw) {
      errorBox.textContent = 'Cole uma partida PGN antes de analisar.';
      errorBox.classList.remove('hidden');
      return;
    }

    let parsed;
    try {
      parsed = Core.parsePGN(raw);
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : 'PGN inválido.';
      errorBox.classList.remove('hidden');
      return;
    }

    if (!parsed.moves.length) {
      errorBox.textContent = 'O PGN não contém lances para analisar.';
      errorBox.classList.remove('hidden');
      return;
    }

    let materialLost = 0;
    let materialWon = 0;
    const history = [];
    try {
      for (const item of parsed.moves) {
        const before = Core.parseFEN(item.fenBefore);
        const move = Core.moveFromUCI(before, item.uci);
        if (!move) throw new Error(`Lance importado inválido: ${item.uci}`);
        const isUserMove = item.color === side;
        const analysis = isUserMove ? Analysis.analyzeMove(before, move) : null;

        if (move.capture) {
          const value = Analysis.pieceValue(move.capture);
          if (item.color === side) materialWon += value;
          else if (Core.colorOf(move.capture) === side) materialLost += value;
        }

        history.push({
          color: item.color,
          notation: item.notation,
          uci: item.uci,
          move: { ...move },
          fenBefore: item.fenBefore,
          fenAfter: item.fenAfter,
          thinkingMs: null,
          analysis
        });
      }
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : 'Não foi possível reconstruir os lances do PGN.';
      errorBox.classList.remove('hidden');
      return;
    }

    const importedGame = {
      version: 2,
      state: parsed.finalState,
      history,
      botLevel: 0,
      interventions: 0,
      materialLost,
      materialWon,
      status: 'ended',
      result: importedResultLabel(parsed.result, side),
      reason: 'imported',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      source: 'imported',
      userColor: side
    };

    const summary = Analysis.summarizeHistory(history, side);
    profile.games += 1;
    profile.importedGames += 1;
    profile.thinking.humanGames = (Number(profile.thinking.humanGames) || 0) + 1;
    if (importedGame.result === 'Vitória') profile.wins += 1;
    else if (importedGame.result === 'Derrota') profile.losses += 1;
    else if (importedGame.result === 'Empate') profile.draws += 1;

    profile.stats.blunders += summary.blunders;
    profile.stats.mistakes += summary.mistakes;
    profile.stats.inaccuracies += summary.inaccuracies;
    profile.stats.materialLost += materialLost;
    profile.stats.materialWon += materialWon;

    history.forEach((entry, index) => updatePatterns(entry, index, side));
    updateSkillsFromGame(summary);
    const analysis = buildAnalysis(summary, importedGame);
    analysis.imported = true;
    analysis.userColor = side;
    const archiveItem = Archive.createArchiveItem(importedGame, summary, raw, analysis);
    profile.gameArchive = Archive.add(profile.gameArchive, archiveItem, Infinity);
    profile.lastAnalysis = archiveItem.analysis;

    saveProfile();
    closePgnImport();
    $('pgnInput').value = '';
    renderAnalysis();
    switchView('analyze');
    showToast('Partida importada. O diagnóstico com Stockfish aparece na revisão.');
  }

  function mistakeLabel(label) {
    const labels = {
      blunder: 'erro grave',
      mistake: 'erro',
      inaccuracy: 'imprecisão',
      ok: 'correto'
    };
    return labels[label] || 'erro';
  }

  function formatShortDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'data desconhecida';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
  }

  function reviewStatusText(review) {
    if (!review?.attempts) return 'ainda não revisado';
    const next = review.nextDueAt ? formatShortDate(review.nextDueAt) : null;
    if (review.lastResult === 'success') return next ? `corrigido · revisar em ${next}` : 'corrigido na última revisão';
    if (review.lastResult === 'partial') return next ? `melhorou · revisar em ${next}` : 'melhorou, mas ainda merece revisão';
    return next ? `repetiu · revisar em ${next}` : 'o padrão se repetiu na última revisão';
  }

  function renderArchive() {
    const section = $('archiveSection');
    const listElement = $('archiveList');
    if (!section || !listElement) return;

    const archive = profile.gameArchive.map(Archive.normalizeArchiveItem).slice().reverse();
    if (!archive.length) {
      section.classList.add('hidden');
      listElement.innerHTML = '';
      return;
    }

    section.classList.remove('hidden');
    const cleanGames = archive.filter((item) => item.blunders === 0).length;
    $('archiveSummary').textContent = `${archive.length} partida(s) salva(s) neste navegador · ${cleanGames} sem erro grave detectado.`;

    listElement.innerHTML = archive.slice(0, 8).map((item) => {
      const isCurrent = item.id === profile.lastAnalysis?.archiveId;
      const issueCount = item.blunders + item.mistakes;
      return `
        <article class="archive-card${isCurrent ? ' current' : ''}">
          <div class="archive-result">
            <span>${escapeHtml(formatShortDate(item.completedAt))}</span>
            <strong>${escapeHtml(item.result)}</strong>
          </div>
          <div class="archive-meta">
            <span>${item.source === 'physical' ? 'Tabuleiro físico' : item.reason === 'imported' ? 'Partida importada' : `Bot ≈${item.botLevel || '—'}`}</span>
            <span>${issueCount} decisão(ões) para revisar</span>
            <span>${item.moves.length} meio-lance(s)</span>
          </div>
          <button class="secondary-button archive-open-button" data-archive-id="${escapeHtml(item.id)}">${isCurrent ? 'ANÁLISE ABERTA' : 'ABRIR ANÁLISE'}</button>
        </article>
      `;
    }).join('');
  }

  function openArchivedAnalysis(archiveId) {
    const item = profile.gameArchive.find((entry) => entry.id === archiveId);
    if (!item?.moves?.length) {
      showToast('Essa partida não possui lances suficientes para revisar.');
      return;
    }
    profile.lastAnalysis = deepClone(item.analysis || { archiveId: item.id, userColor: 'w', result: item.result });
    profile.lastAnalysis.archiveId = item.id;
    saveProfile();
    reviewData = null;
    renderAnalysis();
    $('analysisContent')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    if (!phaseAnalysisErrors.has(`${storageScope}:${archiveId}`)) void analyzeGamePhases();
    showToast('Partida aberta na revisão.');
  }

  function renderMistakes() {
    const section = $('mistakesSection');
    const listElement = $('mistakeList');
    if (!section || !listElement) return;

    const mistakes = profile.recentMistakes.map(Mistakes.normalizeMistake).slice().reverse();
    if (!mistakes.length) {
      section.classList.add('hidden');
      listElement.innerHTML = '';
      return;
    }

    section.classList.remove('hidden');
    const groups = Mistakes.summarize(mistakes);
    const unresolved = mistakes.filter((item) => item.review.successes === 0).length;
    const due = Mistakes.dueMistakes(mistakes).length;
    const top = groups[0]?.category || 'erros recentes';
    $('mistakeSummary').textContent = `${mistakes.length} posição(ões) salva(s), ${unresolved} sem correção confirmada e ${due} revisão(ões) disponível(is) agora. Padrão mais presente: ${top.toLowerCase()}.`;

    listElement.innerHTML = mistakes.slice(0, 10).map((mistake) => {
      const category = Mistakes.primaryCategory(mistake);
      const cause = mistake.likelyCause || 'causa ainda incerta';
      const statusClass = mistake.review.lastResult ? ` ${mistake.review.lastResult}` : '';
      const engineCheck = mistake.engineVerification;
      const engineText = engineCheck
        ? ` · Stockfish: ${engineReviewLabel(engineCheck.classification)} (${Number(engineCheck.lossPawns || 0).toFixed(2)})`
        : '';
      return `
        <article class="mistake-card${statusClass}">
          <div class="mistake-card-top">
            <div>
              <span class="mistake-category">${escapeHtml(category)}</span>
              <strong>${escapeHtml(mistake.notation)}</strong>
            </div>
            <time>${escapeHtml(formatShortDate(mistake.at))}</time>
          </div>
          <p>${escapeHtml(cause)} · ${escapeHtml(mistakeLabel(mistake.label))}${escapeHtml(engineText)}</p>
          <div class="mistake-card-footer">
            <span>${escapeHtml(reviewStatusText(mistake.review))}</span>
            <button class="secondary-button mistake-replay-button" data-mistake-id="${escapeHtml(mistake.id)}">REJOGAR ERRO</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function currentReviewArchiveItem() {
    const archive = Array.isArray(profile.gameArchive) ? profile.gameArchive.map(Archive.normalizeArchiveItem) : [];
    if (!archive.length) return null;
    const preferredId = profile.lastAnalysis?.archiveId || null;
    return archive.find((item) => item.id === preferredId) || archive[archive.length - 1] || null;
  }

  function resetReviewInteraction() {
    reviewShowBest = false;
    reviewBest = null;
    reviewRetryState = null;
    reviewRetryPreview = null;
    reviewRetrySelected = null;
    reviewRetryLegal = [];
    reviewRetryMessage = null;
  }

  function reviewStep() {
    if (!reviewData || reviewPly <= 0) return null;
    return reviewData.moves[reviewPly - 1] || null;
  }

  function reviewClassificationInfo(step) {
    if (!step) return { label: 'POSIÇÃO INICIAL', css: 'neutral', short: 'Posição inicial' };
    return Review.CLASS_INFO[step.classification] || Review.CLASS_INFO.good;
  }

  function reviewEvalText(value) {
    const numeric = Number(value) || 0;
    if (Math.abs(numeric) < 0.05) return '0.0';
    return `${numeric > 0 ? '+' : ''}${numeric.toFixed(1)}`;
  }

  function renderReviewGraph() {
    const graph = $('reviewGraph');
    if (!graph || !reviewData) return;
    const points = reviewData.graph || [];
    if (!points.length) { graph.innerHTML = ''; return; }
    const width = 1000;
    const height = 180;
    const coords = points.map((point, index) => {
      const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
      const evalClamped = Math.max(-6, Math.min(6, Number(point.eval) || 0));
      const y = (height / 2) - (evalClamped / 6) * (height * 0.42);
      return { x, y, ply: point.ply, eval: point.eval };
    });
    const poly = coords.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    graph.innerHTML = `
      <svg class="review-graph-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" class="review-zero-line" />
        <polyline points="${poly}" class="review-eval-line" fill="none" />
      </svg>
      <div class="review-graph-points">${coords.map((point, index) => {
        const left = points.length <= 1 ? 0 : (index / (points.length - 1)) * 100;
        const top = (point.y / height) * 100;
        const key = reviewData.keyMoments.includes(point.ply);
        return `<button class="review-graph-point ${key ? 'key' : ''} ${point.ply === reviewPly ? 'active' : ''}" data-review-ply="${point.ply}" style="left:${left}%;top:${top}%" title="Lance ${point.ply} · ${escapeHtml(reviewEvalText(point.eval))}"></button>`;
      }).join('')}</div>
    `;
  }

  function renderReviewMoveList() {
    const list = $('reviewMoveList');
    if (!list || !reviewData) return;
    list.innerHTML = reviewData.moves.map((step) => {
      const info = reviewClassificationInfo(step);
      const number = Math.ceil(step.ply / 2);
      const prefix = step.color === 'w' ? `${number}.` : `${number}...`;
      return `<button class="review-move-button ${info.css} ${step.ply === reviewPly ? 'active' : ''}" data-review-ply="${step.ply}" title="${escapeHtml(info.short)}"><span>${prefix}</span><strong>${escapeHtml(step.notation)}</strong></button>`;
    }).join('');
  }

  function renderReviewPosition() {
    if (!reviewData) return;
    reviewPly = Math.max(0, Math.min(reviewData.moves.length, reviewPly));
    const step = reviewStep();
    const info = reviewClassificationInfo(step);
    let state;
    let boardBestMove = null;

    if (reviewRetryState) {
      state = Core.cloneState(reviewRetryPreview || reviewRetryState);
    } else if (reviewShowBest && step) {
      state = Core.parseFEN(step.fenBefore);
      boardBestMove = reviewBest?.move || null;
    } else {
      const position = reviewData.positions[reviewPly] || reviewData.positions[0];
      state = Core.parseFEN(position.fen);
      if (step?.lastMove) state.lastMove = { ...step.lastMove };
    }

    renderBoard($('reviewBoard'), state, {
      interactive: Boolean(reviewRetryState && !reviewRetryPreview && !reviewShowBest),
      selected: reviewRetrySelected,
      legal: reviewRetryLegal,
      onClick: reviewRetryState && !reviewRetryPreview && !reviewShowBest ? onReviewRetrySquare : null,
      orientation: reviewData.userColor,
      bestMove: boardBestMove
    });

    const positionEval = reviewShowBest && step ? step.beforeEval : (reviewData.positions[reviewPly]?.eval ?? 0);
    const whiteShare = Math.max(4, Math.min(96, 50 + (Math.max(-8, Math.min(8, Number(positionEval) || 0)) * 5.3)));
    $('reviewEvalFill').style.height = `${whiteShare}%`;
    $('reviewEvalLabel').textContent = reviewEvalText(positionEval);

    const badge = $('reviewMoveBadge');
    badge.className = `move-classification ${info.css}`;
    badge.textContent = info.label;

    if (reviewRetryState) {
      $('reviewMoveTitle').textContent = reviewRetryMessage?.title || 'Tente outra decisão.';
      $('reviewCoachText').textContent = reviewRetryMessage?.text || `Voltei para antes de ${step?.notation || 'seu lance'}. Encontre uma alternativa sem olhar a resposta.`;
    } else if (reviewShowBest && step) {
      $('reviewMoveTitle').textContent = `Antes de ${step.notation}: havia uma alternativa melhor.`;
      $('reviewCoachText').textContent = reviewBest ? `${step.verified ? 'Stockfish' : 'A revisão local'} sugere: ${PhaseDiagnosis.describeMove(state, reviewBest.uci)}. Origem e destino estão marcados no tabuleiro.` : 'Não encontrei uma alternativa confiável nesta posição.';
    } else if (step) {
      $('reviewMoveTitle').textContent = step.verified
        ? PhaseDiagnosis.describeMove(Core.parseFEN(step.fenBefore), step.uci) || step.title
        : step.title;
      $('reviewCoachText').textContent = step.coachText;
    } else {
      $('reviewMoveTitle').textContent = 'Vamos revisar.';
      $('reviewCoachText').textContent = 'Avance pelos lances. Origem e destino da última jogada ficam destacados, e os momentos-chave aparecem no gráfico.';
    }

    const bestLine = $('reviewBestLine');
    if (reviewShowBest && reviewBest) {
      bestLine.innerHTML = `<span>MELHOR ALTERNATIVA</span><strong>${escapeHtml(PhaseDiagnosis.describeMove(state, reviewBest.uci))}</strong><small>${escapeHtml(reviewBest.san)}</small>`;
      bestLine.classList.remove('hidden');
    } else {
      bestLine.classList.add('hidden');
      bestLine.innerHTML = '';
    }

    const retryButton = $('reviewRetry');
    const bestButton = $('reviewBest');
    const userIssue = step && step.color === reviewData.userColor && ['inaccuracy', 'mistake', 'blunder'].includes(step.classification);
    retryButton.disabled = !userIssue;
    retryButton.textContent = reviewRetryState ? (reviewRetryPreview ? 'TENTAR OUTRA' : 'SAIR DO RETRY') : 'TENTAR DE NOVO';
    bestButton.disabled = !step;
    bestButton.textContent = reviewShowBest ? 'VOLTAR AO LANCE' : 'MOSTRAR MELHOR LANCE';

    const before = step ? Core.parseFEN(step.fenBefore) : null;
    const played = before && Core.moveFromUCI(before, step.uci);
    const after = played && Core.makeMoveCopy(before, played);
    const response = after && step.verified?.reply && Core.moveFromUCI(after, step.verified.reply);
    const issue = step && ['inaccuracy','mistake','blunder'].includes(step.classification);
    const stage = reviewRetryState ? reviewRetryPreview ? 'retry' : 'calculate' : reviewShowBest ? 'solution' : reviewPly === reviewData.moves.length ? 'summary' : issue && response ? 'reply' : 'start';
    showLight($('reviewLightPortrait'), { pending: Boolean(phaseAnalysisJob) || liveQueue.keys.size > 0, stage, confirmedThreat: Boolean(response) });
    if (!phaseAnalysisJob && response && issue && !reviewShowBest && !reviewRetryState) $('reviewCoachText').textContent += ` Depois desse lance, ${Weakness.words(after, step.verified.reply, reviewData.userColor)}.`;
    renderReviewMoveList();
    renderReviewGraph();
  }

  function startWeaknessTraining(archiveId, ply) {
    const source = archiveId ? profile.gameArchive.find((g) => g.id === archiveId) : currentReviewArchiveItem();
    if (!source) return;
    const session = Weakness.build([source], ply ? { archiveId: source.id, ply } : null, profile.gameArchive, profile.weaknessSeen || []);
    if (!session) { showToast('Ainda não há uma alternativa válida para treinar esse lance.'); return; }
    profile.weaknessSession = session;
    weaknessSelected = null;
    weaknessLegal = [];
    saveProfile();
    switchView('analyze');
    renderWeaknessTraining();
    $('weaknessPractice').scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  function showLight(element, context) {
    if (!element) return;
    const expression = Light.expression(context);
    if (element.dataset.expression !== expression) {
      element.dataset.expression = expression;
      element.src = Light.portrait(expression);
      element.alt = `Light ${expression}`;
    }
  }

  function renderWeaknessTraining() {
    const session = profile.weaknessSession;
    const item = session?.items?.[session.index];
    $('weaknessPractice').classList.toggle('hidden', !item);
    $('view-analyze').classList.toggle('training-active', Boolean(item));
    const summary = profile.weaknessSummary;
    $('weaknessSummaryPanel').classList.toggle('hidden', Boolean(item) || !summary || summary.dismissed);
    if (summary) $('weaknessSummaryText').textContent = `Você reviu ${summary.positions} posições e encontrou ${summary.found} alternativas antes de revelar a solução. Na próxima partida, confira as ameaças antes de confirmar seu lance.`;
    if (!item) return;
    const { state, after, reply, best } = Weakness.context(item);
    let shown = state, arrow = null;
    if (session.display === 'reply' && reply) { shown = Core.makeMoveCopy(after, reply); arrow = reply; }
    if (session.display === 'solution' && best) { shown = Core.makeMoveCopy(state, best); arrow = best; }
    const attempt = session.attempt && Core.moveFromUCI(state, session.attempt);
    if (session.display === 'attempt' && attempt) { shown = Core.makeMoveCopy(state, attempt); arrow = attempt; }
    const relation = session.hint >= 2 && reply && item.key !== 'mate-missed' && session.display === 'start' ? reply : null;
    if (relation) { arrow = relation; shown = after; }
    const look = reply ? Core.squareName(reply.fromRow, reply.fromCol) : best ? Core.squareName(best.fromRow, best.fromCol) : null;
    renderBoard($('weaknessBoard'), shown, { orientation: state.turn, interactive: session.display === 'start' && !relation,
      onClick: onWeaknessSquare, selected: weaknessSelected, legal: weaknessLegal,
      hintSquare: session.hint > 0 && session.display === 'start' ? look : null, arrow });
    $('weaknessStep').textContent = `${session.index + 1} / ${session.items.length} · ${session.index === 0 ? 'SEU ERRO REAL' : 'APLICAR EM POSIÇÃO NOVA'}`;
    $('weaknessPosition').textContent = `${item.phase} · ${item.source} · ${state.turn === 'w' ? 'Você joga de brancas' : 'Você joga de pretas'}`;
    $('weaknessPrompt').textContent = session.index === 0
      ? `Antes de ${state.fullmove}${state.turn === 'b' ? '...' : '.'} ${PhaseDiagnosis.describeMove(state, item.probe)}. Toque na peça e no destino para encontrar uma alternativa.`
      : 'A posição mudou; o padrão é o mesmo. Encontre uma resposta sem repetir o erro. Toque na peça e depois no destino.';
    let text = session.message || 'Sua vez. Procure xeques, capturas e ameaças antes de escolher.';
    if (session.display === 'reply') text = `Depois de ${Weakness.words(state, item.probe)}, ${Weakness.words(after, item.reply, state.turn)}. A seta mostra a resposta possível do adversário.`;
    else if (session.display === 'solution') text = `Solução: ${Weakness.words(state, item.best)}. A resposta foi aplicada no tabuleiro. ${item.key === 'mate-missed' ? 'Confira como as casas de fuga do rei ficaram fechadas.' : 'Compare essa posição com a resposta adversária ao erro original.'}`;
    else if (session.display === 'attempt' && session.solved) text = session.message;
    else if (session.hint === 1) text = `Onde olhar: observe ${look || 'o rei e as peças sem defesa'}. A casa está destacada. Não escolha um lance ainda; siga os ataques dessa peça.`;
    else if (session.hint >= 2) text = item.key === 'mate-missed' ? 'Existe uma rede de mate: seu rei limita as fugas. Procure um xeque que feche as casas restantes.' : reply ? `A ameaça: depois do lance original, ${Weakness.words(after, item.reply, state.turn)}. Como você pode evitar essa continuação?` : 'Procure os xeques e as casas de fuga do rei. Depois compare a atividade das suas peças. Não há uma resposta adversária verificada disponível para este lance.';
    if (weaknessSelected && !session.hint && !session.message) text = 'Agora calcule: depois da sua mudança, quais xeques, capturas ou ameaças o adversário teria?';
    const pending = Boolean(phaseAnalysisJob) || liveQueue.keys.size > 0;
    const stage = session.display === 'attempt' && session.solved ? 'solved' : session.display === 'solution' ? 'solution' : session.display === 'reply' ? 'reply' : session.hint === 1 ? 'hint1' : session.hint >= 2 ? 'hint2' : session.lastOutcome === 'retry' ? 'retry' : weaknessSelected ? 'calculate' : 'start';
    const decisive = session.display === 'attempt' && Core.gameStatus(shown).reason === 'checkmate';
    showLight($('weaknessLightPortrait'), { pending, stage, confirmedThreat: Boolean(reply), verified: item.source === 'Stockfish', decisive, unassisted: !session.hint && !session.revealed && !session.hadMiss });
    if (pending) text = 'Estou atento. A análise ainda está em andamento; vou esperar a confirmação antes de reagir ao resultado.';
    $('weaknessFeedback').textContent = text;
    const promotion = Core.generateLegalMoves(state, state.turn).some((m) => m.promotion);
    $('weaknessPromotion').hidden = !promotion;
    document.querySelector('label[for="weaknessPromotion"]').hidden = !promotion;
    $('weaknessReset').textContent = relation ? 'Voltar e responder' : 'Tentar novamente';
    if (relation) $('weaknessPosition').textContent += ' · Após o lance original: observe a relação e use Voltar e responder.';
    $('weaknessHint').textContent = session.hint ? 'Dica 2 · Entender a ameaça' : 'Dica 1 · Onde olhar';
    $('weaknessHint').disabled = session.hint >= 2 || session.display !== 'start';
    $('weaknessReply').disabled = !reply;
    $('weaknessNext').disabled = !session.solved;
    $('weaknessNext').textContent = session.index + 1 < session.items.length ? 'Aplicar em posição nova →' : 'Concluir treino';
    if (session.items.length === 1) $('weaknessPosition').textContent += ' · Ainda não há outra posição inédita deste padrão na biblioteca.';
  }

  function weaknessAction(action) {
    const session = profile.weaknessSession;
    if (!session) return;
    if (action === 'hint') session.hint = Math.min(2, session.hint + 1);
    if (action === 'reply') session.display = 'reply';
    if (action === 'solution') { session.display = 'solution'; session.solved = true; session.revealed = true; }
    if (action === 'reset') { session.display = 'start'; session.hint = 0; session.solved = false; session.message = ''; session.attempt = null; session.lastOutcome = null; session.revealed = false; }
    if (action === 'next') {
      if (!session.solved) return;
      session.results ||= {};
      session.results[session.index] = { played: Boolean(session.attempt && !session.revealed), hints: session.hint };
      if (session.index + 1 < session.items.length) { session.index++; profile.weaknessSeen = [...new Set([...(profile.weaknessSeen || []), session.items[session.index].id])]; session.hint = 0; session.solved = false; session.display = 'start'; session.message = ''; session.attempt = null; session.lastOutcome = null; session.revealed = false; }
      else { const results = Object.values(session.results); profile.weaknessSummary = { at: new Date().toISOString(), positions: results.length, found: results.filter(r=>r.played).length }; profile.weaknessSession = null; showLight($('reviewLightPortrait'), {stage:'summary'}); showToast(`Treino concluído: ${results.length} posições revistas, ${profile.weaknessSummary.found} alternativas encontradas antes de revelar.`); }
    }
    weaknessSelected = null; weaknessLegal = [];
    saveProfile(); renderWeaknessTraining();
  }

  function onWeaknessSquare(row, col) {
    const session = profile.weaknessSession;
    if (!session || session.display !== 'start') return;
    const item = session.items[session.index];
    const { state } = Weakness.context(item);
    const candidates = weaknessLegal.filter((m) => m.toRow === row && m.toCol === col);
    const move = candidates.find((m) => !m.promotion || m.promotion === $('weaknessPromotion').value);
    if (move) {
      const uci = Core.moveToUCI(move);
      if (uci === item.best) { session.lastOutcome = 'solved'; session.solved = true; session.attempt = uci; session.display = 'attempt'; session.message = `Isso: ${Weakness.words(state, uci)}. Você encontrou a alternativa deste exercício.`; }
      else { session.lastOutcome = 'retry'; session.hadMiss = true; session.hint = 0; session.message = `${Weakness.words(state, uci)} é legal. Compare com a ameaça; ainda não é a alternativa proposta neste exercício. Você pode tentar de novo ou ver a solução.`; }
      weaknessSelected = null; weaknessLegal = []; saveProfile(); renderWeaknessTraining(); return;
    }
    if (state.board[row][col] && Core.colorOf(state.board[row][col]) === state.turn) {
      weaknessSelected = { row, col };
      weaknessLegal = Core.generateLegalMoves(state, state.turn).filter((m) => m.fromRow === row && m.fromCol === col);
    } else { weaknessSelected = null; weaknessLegal = []; }
    renderWeaknessTraining();
  }

  function renderPhaseDiagnosis(source) {
    const history = !source;
    const report = PhaseDiagnosis.summarize(history ? profile.gameArchive : [source], { history });
    const summary = history ? $('phaseHistorySummary') : $('phaseGameSummary');
    const cards = history ? $('phaseHistoryCards') : $('phaseGameCards');
    const origin = report.source === 'stockfish' ? 'Stockfish' : 'estimativa local';
    if (!report.games) {
      summary.textContent = 'Jogue uma partida ou importe um PGN para começar.';
      cards.innerHTML = '';
      return;
    }
    const focus = report.weak
      ? history ? `Seu ponto mais fraco na amostra é ${report.weak.name.toLowerCase()}.`
        : `Nesta partida, você teve mais dificuldade em ${report.weak.name.toLowerCase()}.`
      : history ? 'Ainda não apareceu uma fase claramente mais fraca.'
        : 'Nesta partida, os dados ainda não apontam uma fase claramente mais fraca.';
    summary.textContent = (report.smallSample ? 'Amostra pequena · conclusão provisória. ' : '') + (history
      ? `${focus} ${report.games} ${report.human ? 'partida(s) humana(s)' : 'partida(s) no Kira'} · ${origin}.`
      : `${focus} Fonte: ${origin}.`);
    if (!history) {
      const available = Weakness.build([source], null, profile.gameArchive, profile.weaknessSeen || []);
      $('trainWeakness').disabled = !available;
      $('weaknessAvailability').textContent = available ? 'Comece por um erro seu. Depois, aplique o padrão em outra posição quando houver uma disponível.' : 'O treino aparece quando houver um erro com uma alternativa válida. Você pode importar outra partida.';
    }

    cards.innerHTML = report.phases.map((phase) => {
      const priority = report.weak?.id === phase.id;
      const counts = phase.moves
        ? `${phase.moves} lances seus · ${phase.inaccuracies} imprecisões · ${phase.mistakes} erros · ${phase.blunders} erros graves`
        : 'Sem lances avaliados nesta fase.';
      const smallSample = phase.moves && (history ? phase.moves < 8 || phase.games < 2 : phase.moves < 3);
      return `<article class="phase-card${priority ? ' phase-card-priority' : ''}">
        <h3>${phase.name}</h3>
        <p class="analysis-copy">${counts}${smallSample ? ' · amostra pequena' : ''}</p>
        ${phase.theme ? `<p class="phase-card-theme">${escapeHtml(phase.theme[0])} · ${phase.theme[1]} lance(s)</p>` : ''}
        ${priority ? `<p class="analysis-copy">${phase.practice}</p>` : ''}
        ${phase.examples.map((example) => `<div class="phase-example">
          <button class="text-button" data-phase-game="${escapeHtml(example.archiveId)}" data-phase-ply="${example.ply}">Ver ${example.number} ${escapeHtml(example.move)}</button>
          <button class="secondary-button" data-train-game="${escapeHtml(example.archiveId)}" data-train-ply="${example.ply}">Treinar este lance</button>
          ${example.reply ? `<small>Resposta possível: ${escapeHtml(example.reply)}.</small>` : ''}
          ${example.best ? `<small>Alternativa: ${escapeHtml(example.best)}.</small>` : ''}
        </div>`).join('')}
      </article>`;
    }).join('');
  }

  function renderPhaseEngineStatus(source) {
    const button = $('analyzeGamePhases');
    const status = $('phaseEngineStatus');
    const job = phaseAnalysisJob;
    const running = job?.scope === storageScope && job.archiveId === source.id;
    if (running) { showLight($('reviewLightPortrait'), {pending:true}); showLight($('weaknessLightPortrait'), {pending:true}); }
    const error = phaseAnalysisErrors.get(`${storageScope}:${source.id}`);
    const total = PhaseDiagnosis.positions(source).length;
    const checked = source.analysis?.phaseEngine?.moves?.length || 0;
    const complete = total > 0 && checked >= total;
    const liveRunning = !complete && source.analysis?.liveSessionId && liveQueue.pending(`${storageScope}:${profileEpoch}:${source.analysis.liveSessionId}`);
    button.disabled = Boolean(job) || Boolean(liveRunning) || !total || complete;
    button.textContent = running || liveRunning ? 'Analisando…' : complete ? 'Stockfish concluído' : error ? 'Tentar Stockfish de novo' : 'Analisar com Stockfish';
    status.textContent = running ? `Stockfish · ${job.checked} de ${job.total} lances seus avaliados.`
      : liveRunning ? `Stockfish ao vivo · ${checked} de ${total} lances seus avaliados.` : error ? error : complete ? `Stockfish · ${checked} lances seus avaliados.` : '';
    status.classList.toggle('hidden', !status.textContent);
  }

  async function analyzeGamePhases() {
    const source = currentReviewArchiveItem();
    if (!source) return;
    if (source.analysis?.liveSessionId && liveQueue.pending(`${storageScope}:${profileEpoch}:${source.analysis.liveSessionId}`)) return;
    if (phaseAnalysisJob) {
      if (phaseAnalysisJob.archiveId !== source.id || phaseAnalysisJob.scope !== storageScope) {
        pendingPhaseAnalysis = { archiveId: source.id, scope: storageScope };
      }
      return;
    }
    const positions = PhaseDiagnosis.positions(source);
    if (!positions.length || source.analysis?.phaseEngine?.moves?.length >= positions.length) return;
    const job = { scope: storageScope, epoch: profileEpoch, archiveId: source.id, total: positions.length, checked: 0 };
    const key = `${job.scope}:${job.archiveId}`;
    phaseAnalysisJob = job;
    phaseAnalysisErrors.delete(key);
    renderPhaseEngineStatus(source);
    const moves = [];
    try {
      for (const position of positions) {
        const result = await stockfish.compareMove(position.fenBefore, position.uci, { depth: 11, multipv: 1 });
        if (profileEpoch !== job.epoch || storageScope !== job.scope) return;
        moves.push(PhaseDiagnosis.verifiedMove(position, result));
        job.checked = moves.length;
        if (profile.lastAnalysis?.archiveId === source.id) renderPhaseEngineStatus(source);
      }
      const current = profile.gameArchive.find((item) => item.id === source.id || ProfileSync.gameKey(item) === ProfileSync.gameKey(source));
      if (!current) return;
      const analysis = { ...current.analysis, archiveId: current.id, phaseEngine: { moves } };
      profile.gameArchive = Archive.updateAnalysis(profile.gameArchive, current.id, analysis);
      if (profile.lastAnalysis?.archiveId === current.id) profile.lastAnalysis = analysis;
      saveProfile();
    } catch (error) {
      if (profileEpoch === job.epoch && storageScope === job.scope) phaseAnalysisErrors.set(key, 'O Stockfish ficou indisponível. Você pode tentar novamente. A estimativa local continua visível.');
      console.warn('Não foi possível concluir o diagnóstico por fase.', error);
    } finally {
      phaseAnalysisJob = null;
      const selected = currentReviewArchiveItem();
      if (selected && (selected.id === source.id || ProfileSync.gameKey(selected) === ProfileSync.gameKey(source)) && storageScope === job.scope) {
        resetReviewInteraction();
        renderAnalysis();
      } else if (selected) renderPhaseEngineStatus(selected);
      const pending = pendingPhaseAnalysis;
      pendingPhaseAnalysis = null;
      if (pending?.scope === storageScope && pending.archiveId === selected?.id) void analyzeGamePhases();
    }
  }

  function openPhaseExample(event) {
    const train = event.target.closest('[data-train-ply]');
    if (train) { startWeaknessTraining(train.dataset.trainGame, Number(train.dataset.trainPly)); return; }
    const button = event.target.closest('[data-phase-ply]');
    if (!button) return;
    if (currentReviewArchiveItem()?.id !== button.dataset.phaseGame) openArchivedAnalysis(button.dataset.phaseGame);
    if (reviewData?.archiveId !== button.dataset.phaseGame) return;
    switchView('analyze');
    goToReviewPly(button.dataset.phasePly);
    requestAnimationFrame(() => $('reviewWorkspace').scrollIntoView({ block: 'start', behavior: 'instant' }));
  }

  function renderAnalysis() {
    renderArchive();
    renderMistakes();
    const source = currentReviewArchiveItem();
    if (!source || !source.moves?.length) {
      reviewData = null;
      $('analysisEmpty').classList.remove('hidden');
      $('analysisContent').classList.add('hidden');
      return;
    }

    $('analysisEmpty').classList.add('hidden');
    $('analysisContent').classList.remove('hidden');
    const sourceChanged = !reviewData || reviewData.archiveId !== source.id;
    reviewData = Review.buildReview(source, source.analysis?.userColor);
    if (sourceChanged) {
      reviewPly = 0;
      resetReviewInteraction();
    } else reviewPly = Math.min(reviewPly, reviewData.moves.length);

    $('analysisResult').textContent = source.result || '—';
    $('analysisAccuracy').textContent = reviewData.accuracy == null ? '—' : `${reviewData.accuracy}%`;
    $('analysisAccuracy').parentElement.classList.toggle('hidden', reviewData.accuracy == null);
    $('analysisMistakesCount').textContent = String(reviewData.mistakes);
    $('analysisBlundersCount').textContent = String(reviewData.blunders);
    renderPhaseDiagnosis(source);
    renderWeaknessTraining();
    renderPhaseEngineStatus(source);
    renderReviewPosition();
  }

  function goToReviewPly(ply) {
    if (!reviewData) return;
    reviewPly = Math.max(0, Math.min(reviewData.moves.length, Number(ply) || 0));
    resetReviewInteraction();
    renderReviewPosition();
  }

  function nextReviewKeyMoment() {
    if (!reviewData?.keyMoments?.length) { showToast('Nenhum momento-chave forte detectado nesta partida.'); return; }
    const next = reviewData.keyMoments.find((ply) => ply > reviewPly) || reviewData.keyMoments[0];
    goToReviewPly(next);
  }

  function bestMoveForReview(state, step) {
    const uci = step.verified?.best;
    const move = uci && Core.moveFromUCI(state, uci);
    if (!move) return Review.bestMove(state);
    return { move, uci, san: Core.sanNotation(state, move, Core.makeMoveCopy(state, move)) };
  }

  function toggleReviewBestMove() {
    const step = reviewStep();
    if (!step) return;
    if (reviewShowBest) {
      reviewShowBest = false;
      reviewBest = null;
      renderReviewPosition();
      return;
    }
    resetReviewInteraction();
    const state = Core.parseFEN(step.fenBefore);
    reviewBest = bestMoveForReview(state, step);
    reviewShowBest = true;
    renderReviewPosition();
  }

  function startReviewRetry() {
    const step = reviewStep();
    if (!step || step.color !== reviewData?.userColor || !['inaccuracy', 'mistake', 'blunder'].includes(step.classification)) return;
    if (reviewRetryState) {
      if (reviewRetryPreview) {
        reviewRetryPreview = null;
        reviewRetrySelected = null;
        reviewRetryLegal = [];
        reviewRetryMessage = { title: 'Tente outra vez.', text: `A posição voltou para antes de ${step.notation}. Procure uma alternativa diferente.` };
      } else {
        resetReviewInteraction();
      }
      renderReviewPosition();
      return;
    }
    resetReviewInteraction();
    reviewRetryState = Core.parseFEN(step.fenBefore);
    reviewBest = bestMoveForReview(reviewRetryState, step);
    reviewRetryMessage = { title: 'Sua vez de corrigir.', text: `Voltei para antes de ${step.notation}. Não tente adivinhar o lance do motor: procure xeques, capturas, ameaças e a peça pior colocada.` };
    renderReviewPosition();
  }

  function stepRetryText(outcome) {
    return reviewStep()?.verified ? `Estimativa local da tentativa: ${outcome.text}` : outcome.text;
  }

  function onReviewRetrySquare(row, col) {
    if (!reviewRetryState || reviewRetryPreview) return;
    if (reviewRetrySelected) {
      const candidate = reviewRetryLegal.find((move) => move.toRow === row && move.toCol === col) || null;
      if (candidate) {
        const outcome = Review.evaluateRetry(reviewRetryState, candidate, reviewBest);
        reviewRetryPreview = Core.makeMoveCopy(reviewRetryState, candidate);
        reviewRetryPreview.lastMove = { fromRow: candidate.fromRow, fromCol: candidate.fromCol, toRow: candidate.toRow, toCol: candidate.toCol };
        const labels = { best: 'Isso.', good: 'Boa recuperação.', close: 'Melhorou.', bad: 'Ainda há um problema.', invalid: 'Lance inválido.' };
        reviewRetryMessage = { title: labels[outcome.verdict] || 'Resultado da tentativa', text: stepRetryText(outcome) };
        reviewRetrySelected = null;
        reviewRetryLegal = [];
        renderReviewPosition();
        return;
      }
    }
    const piece = reviewRetryState.board[row]?.[col];
    if (piece && Core.colorOf(piece) === reviewRetryState.turn) {
      reviewRetrySelected = { row, col };
      reviewRetryLegal = Core.generateLegalMoves(reviewRetryState, reviewRetryState.turn).filter((move) => move.fromRow === row && move.fromCol === col);
    } else {
      reviewRetrySelected = null;
      reviewRetryLegal = [];
    }
    renderReviewPosition();
  }


  async function runDeepAnalysis() {
    const analysis = profile.lastAnalysis;
    if (!analysis?.criticalFen) {
      showToast('Não há momento crítico para analisar ainda.');
      return;
    }

    const button = $('deepAnalysisButton');
    button.disabled = true;
    button.textContent = 'CARREGANDO STOCKFISH…';

    try {
      const result = await stockfish.compareMove(analysis.criticalFen, analysis.criticalUci, { depth: 11, multipv: 3 });
      analysis.engine = result;
      profile.lastAnalysis = analysis;
      if (analysis.archiveId) profile.gameArchive = Archive.updateAnalysis(profile.gameArchive, analysis.archiveId, analysis);
      saveProfile();
      renderEngineAnalysis(analysis.engine);
    } catch (error) {
      const box = $('engineAnalysisBox');
      box.classList.remove('hidden');
      box.textContent = `Stockfish não pôde ser carregado agora. O analisador local continua funcionando. (${error.message})`;
    } finally {
      button.disabled = false;
      button.textContent = 'ANALISAR MOMENTO COM STOCKFISH';
    }
  }

  function engineReviewLabel(label) {
    const labels = {
      ok: 'aceitável',
      inaccuracy: 'imprecisão',
      mistake: 'erro',
      blunder: 'erro grave'
    };
    return labels[label] || 'avaliado';
  }

  function syncMistakeEngineVerification(verifiedItems) {
    if (!Array.isArray(verifiedItems) || !verifiedItems.length) return;
    const byKey = new Map(verifiedItems.map((item) => [`${item.fen}|${item.uci}`, item]));
    profile.recentMistakes = profile.recentMistakes.map((mistake) => {
      const normalized = Mistakes.normalizeMistake(mistake);
      const verified = byKey.get(`${normalized.fen}|${normalized.move}`);
      if (!verified) return normalized;
      return Mistakes.normalizeMistake({
        ...normalized,
        engineVerification: {
          checkedAt: new Date().toISOString(),
          classification: verified.engineClassification,
          lossPawns: verified.lossPawns,
          bestmove: verified.bestmove,
          depth: verified.depth
        }
      });
    });
  }

  async function runGameVerification() {
    const analysis = profile.lastAnalysis;
    if (!analysis?.archiveId) {
      showToast('Abra uma partida salva antes de verificar os erros.');
      return;
    }

    const archiveItem = profile.gameArchive.find((item) => item.id === analysis.archiveId);
    if (!archiveItem) {
      showToast('Não encontrei os lances dessa partida no histórico.');
      return;
    }

    const userColor = analysis.userColor === 'b' ? 'b' : 'w';
    const candidates = EngineReview.selectCandidates(archiveItem.moves, userColor, 3);
    if (!candidates.length) {
      analysis.engineReview = {
        checkedAt: new Date().toISOString(),
        items: [],
        summary: EngineReview.summarize([]),
        note: 'O analisador local não marcou erros relevantes suficientes para uma verificação seletiva.'
      };
      profile.lastAnalysis = analysis;
      profile.gameArchive = Archive.updateAnalysis(profile.gameArchive, analysis.archiveId, analysis);
      saveProfile();
      renderGameVerification(analysis.engineReview);
      return;
    }

    const button = $('verifyGameButton');
    button.disabled = true;
    const originalText = button.textContent;
    const verifiedItems = [];

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        button.textContent = `VERIFICANDO ${index + 1}/${candidates.length}…`;
        const result = await stockfish.compareMove(candidate.fenBefore, candidate.uci, { depth: 10, multipv: 3 });
        verifiedItems.push(EngineReview.normalizeVerifiedItem(candidate, result));
      }

      analysis.engineReview = {
        checkedAt: new Date().toISOString(),
        items: verifiedItems,
        summary: EngineReview.summarize(verifiedItems),
        note: null
      };
      profile.lastAnalysis = analysis;
      profile.gameArchive = Archive.updateAnalysis(profile.gameArchive, analysis.archiveId, analysis);
      syncMistakeEngineVerification(verifiedItems);
      saveProfile();
      renderGameVerification(analysis.engineReview);
      renderMistakes();
    } catch (error) {
      const box = $('gameVerificationBox');
      box.classList.remove('hidden');
      box.textContent = `Não consegui concluir a verificação com Stockfish agora. O diagnóstico local foi preservado. (${error.message})`;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function renderGameVerification(review) {
    const box = $('gameVerificationBox');
    if (!box) return;
    if (!review) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    box.classList.remove('hidden');
    if (review.note) {
      box.innerHTML = `<strong>Verificação seletiva</strong><p>${escapeHtml(review.note)}</p>`;
      return;
    }

    const summary = review.summary || EngineReview.summarize(review.items || []);
    const rows = (review.items || []).map((item) => {
      const local = engineReviewLabel(item.localClassification);
      const engine = engineReviewLabel(item.engineClassification);
      const agreement = item.localClassification === item.engineClassification
        ? 'confirmado'
        : `ajustado de ${local} para ${engine}`;
      return `
        <div class="verification-row">
          <span><strong>${escapeHtml(item.notation)}</strong> · lance ${item.ply}</span>
          <span>${escapeHtml(agreement)}</span>
          <span>perda ${Number(item.lossPawns || 0).toFixed(2)}</span>
        </div>
      `;
    }).join('');

    box.innerHTML = `
      <strong>Erros-chave verificados com Stockfish</strong>
      <p>${summary.checked} decisão(ões) conferida(s) · ${summary.confirmed} classificação(ões) confirmada(s) · ${summary.downgraded + summary.upgraded} ajustada(s).</p>
      <div class="verification-list">${rows}</div>
    `;
  }

  function renderEngineAnalysis(engine) {
    const box = $('engineAnalysisBox');
    if (!box) return;

    if (!engine) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const alternatives = engine.alternatives
      .filter((item) => item.move)
      .map((item) => `<span>${escapeHtml(item.move)} · ${formatEngineScore(item)}</span>`)
      .join('');

    const verdicts = {
      ok: 'O Stockfish considera a diferença pequena.',
      inaccuracy: 'Havia uma alternativa claramente mais precisa.',
      mistake: 'O lance cedeu uma vantagem relevante.',
      blunder: 'O lance mudou fortemente a qualidade da posição.'
    };

    box.classList.remove('hidden');
    box.innerHTML = `
      <strong>${engine.same ? 'Seu lance coincide com a primeira escolha do Stockfish.' : `Melhor alternativa: ${escapeHtml(engine.bestmove || '—')}`}</strong>
      <p>Lance jogado: ${escapeHtml(engine.played || '—')} · perda estimada ${Number(engine.lossPawns || 0).toFixed(2)} · profundidade ${engine.depth || '—'}</p>
      <p class="engine-verdict">${escapeHtml(verdicts[engine.classification] || 'Comparação concluída.')}</p>
      <div class="engine-lines">${alternatives}</div>
    `;
  }

  function formatEngineScore(line) {
    if (line.scoreType === 'mate') return `mate ${line.score}`;
    if (line.scoreType === 'cp') return `${(line.score / 100).toFixed(2)}`;
    return '—';
  }

  function threatAccuracy() {
    const data = profile.training.threat;
    const attempts = Number(data.attempts) || 0;
    if (attempts < 4) return null;
    return Math.round((data.correct / attempts) * 100);
  }

  function refreshProfileUI() {
    const playerName = String(profile.name || (authUser ? Auth.displayName(authUser) : 'Jogador')).trim() || 'Jogador';
    const initial = playerName.charAt(0).toUpperCase() || 'J';
    if ($('sidebarName')) $('sidebarName').textContent = playerName;
    if ($('playerName')) $('playerName').textContent = playerName;
    if ($('sidebarAvatar')) $('sidebarAvatar').textContent = initial;
    if ($('playerAvatar')) $('playerAvatar').textContent = initial;
    initializeGreeting();
    const assessment = profile.assessment || {};
    const estimate = assessment.estimate || null;
    const assessed = Boolean(assessment.completed && estimate);
    const rangeText = assessed ? `${estimate.low}–${estimate.high}` : 'aguardando avaliação';
    const calibrating = assessed && (assessment.games || 0) < 3;
    const levelText = assessed ? (calibrating ? rangeText : `≈${estimate.center}`) : '—';

    if ($('sidebarRating')) $('sidebarRating').textContent = assessed
      ? (calibrating ? 'Em calibração' : `≈${estimate.center} · ${estimate.label || 'estimado'}`)
      : 'Nível não avaliado';
    if ($('mobileRating')) $('mobileRating').textContent = levelText;
    if ($('mobileRatingLabel')) $('mobileRatingLabel').textContent = assessed ? (calibrating ? 'faixa inicial' : 'estimado') : 'em avaliação';
    if ($('playerLevelLabel')) $('playerLevelLabel').textContent = assessed ? (calibrating ? `Faixa em calibração ${rangeText}` : `Nível estimado ${rangeText}`) : 'Nível em avaliação';
    if ($('progressRating')) $('progressRating').textContent = levelText;
    if ($('progressRange')) $('progressRange').textContent = rangeText;
    if ($('statGames')) $('statGames').textContent = profile.games;

    if ($('homeLevel')) $('homeLevel').textContent = assessed ? (calibrating ? 'Em calibração' : `≈${estimate.center}`) : 'Não avaliado';
    if ($('homeConfidence')) $('homeConfidence').textContent = assessed ? `Faixa ${rangeText} · confiança ${estimate.confidence}${calibrating ? ' · vou refinar com mais partidas' : ''}` : 'Jogue uma partida de avaliação';
    if ($('homeStyle')) $('homeStyle').textContent = assessed ? (calibrating ? `Hipótese: ${assessment.style?.label || 'em formação'}` : assessment.style?.label || 'Em formação') : 'Ainda não sei';
    if ($('homeStyleDetail')) $('homeStyleDetail').textContent = assessed ? assessment.style?.description || 'Continuarei refinando conforme você joga.' : 'Vou observar suas decisões, não um questionário.';
    if ($('homeStatusText')) $('homeStatusText').textContent = assessed
      ? 'Seu perfil já começou a tomar forma. Agora as recomendações mudam conforme você joga.'
      : 'Antes de recomendar qualquer coisa, quero ver como você joga.';
    if ($('assessmentCallout')) $('assessmentCallout').classList.toggle('hidden', assessed);

    const focus = assessed ? Training.recommendFocus(profile) : null;
    if ($('homeTrainingSummary')) $('homeTrainingSummary').textContent = assessed ? `Primeiro foco: ${focus.label}.` : 'O catálogo aparece depois da avaliação.';
    const openingGroups = assessed ? Openings.recommendedByContext(assessment) : { white: [], blackE4: [], blackD4: [] };
    const firstWhiteOpening = openingGroups.white[0] || null;
    if ($('homeOpeningSummary')) $('homeOpeningSummary').textContent = firstWhiteOpening ? `${calibrating ? 'Para testar' : 'De brancas'}: ${firstWhiteOpening.name}${calibrating ? ' · provisória' : ''}.` : 'Recomendações vão depender do seu estilo.';

    const threat = threatAccuracy();
    if ($('trendThreats')) $('trendThreats').textContent = threat === null ? 'Sem dados' : `${threat}%`;
    const threatAttempts = Number(profile.training.threat?.attempts) || 0;
    if ($('trendThreatsCaption')) $('trendThreatsCaption').textContent = threat === null
      ? threatAttempts ? `amostra pequena (${threatAttempts}/4)` : 'sem dados suficientes'
      : `em ${threatAttempts} respostas`;
    if ($('trendGames')) $('trendGames').textContent = profile.games;
    if ($('trendBlunders')) $('trendBlunders').textContent = profile.games ? (profile.stats.blunders / profile.games).toFixed(1) : '—';

    const attempts = Object.values(profile.training).reduce((sum, item) => sum + (Number(item.attempts) || 0), 0);
    const dependenceRatio = attempts ? profile.hints / attempts : 1;
    const dependence = attempts < 12 ? 'Coletando' : dependenceRatio > 0.45 ? 'Alta' : dependenceRatio > 0.20 ? 'Média' : 'Baixa';
    if ($('trendDependence')) $('trendDependence').textContent = dependence;

    const planAttempts = Number(profile.thinking?.planAttempts) || 0;
    const planCorrect = Number(profile.thinking?.planCorrect) || 0;
    const planAccuracy = planAttempts ? Math.round((planCorrect / planAttempts) * 100) : null;
    const patternItems = PatternMemory.catalog(profile);
    const learnedPatterns = patternItems.filter((item) => item.learned).length;
    const duePatterns = patternItems.filter((item) => item.due).length;
    const dueMistakes = Mistakes.dueMistakes(profile.recentMistakes).length;
    if ($('thinkingPlanAccuracy')) $('thinkingPlanAccuracy').textContent = planAccuracy == null ? '—' : `${planAccuracy}%`;
    if ($('thinkingPlanSample')) $('thinkingPlanSample').textContent = planAttempts ? `${planAttempts} decisões de plano` : 'sem amostra';
    if ($('thinkingHumanGames')) $('thinkingHumanGames').textContent = String(Number(profile.thinking?.humanGames) || profile.importedGames || 0);
    if ($('thinkingPatternsLearned')) $('thinkingPatternsLearned').textContent = `${learnedPatterns}/${patternItems.length}`;
    if ($('thinkingDueReviews')) $('thinkingDueReviews').textContent = String(duePatterns + dueMistakes);

    if ($('ratingProgressFill') && $('ratingProgressText')) {
      if (!assessed || !profile.target) {
        $('ratingProgressFill').style.width = '0%';
        $('ratingProgressText').textContent = 'A estimativa aparece depois de você jogar.';
      } else {
        const missionStart = Number(profile.missionStart) || estimate.center;
        const denominator = Math.max(1, profile.target - missionStart);
        const progress = Math.max(0, Math.min(100, ((estimate.center - missionStart) / denominator) * 100));
        $('ratingProgressFill').style.width = `${progress}%`;
        $('ratingProgressText').textContent = `${Math.round(progress)}% do caminho estimado até ${profile.target}`;
      }
    }

    if ($('progressStyle')) $('progressStyle').textContent = assessed ? (calibrating ? `Hipótese: ${assessment.style?.label || 'em formação'}` : assessment.style?.label || 'Em formação') : 'Ainda não avaliado';
    if ($('progressStyleDescription')) $('progressStyleDescription').textContent = assessed ? assessment.style?.description || 'Continuarei refinando com mais partidas.' : 'Seu estilo será inferido das suas decisões.';

    if ($('skillBars')) {
      $('skillBars').innerHTML = assessed
        ? Object.entries(profile.skills).map(([name, score]) => `<div class="skill-row"><span>${escapeHtml(name)}</span><div class="skill-line"><i style="width:${clampSkill(score) * 10}%"></i></div><strong>${clampSkill(score).toFixed(1)}</strong></div>`).join('')
        : '<p class="analysis-copy">As habilidades começam a aparecer depois da avaliação e ficam mais confiáveis com novas partidas.</p>';
    }

    renderPhaseDiagnosis();
    renderWeeklyReport();
    renderTraining();
    renderOpenings();
    renderPatterns();
  }


  function reportPatternLabel(value) {
    const labels = {
      'não verificou a resposta adversária imediata': 'ameaças ignoradas',
      'deixou material vulnerável': 'material vulnerável',
      'não verificou capturas disponíveis': 'capturas não vistas',
      'peça exposta': 'peças expostas',
      'peça pendurada': 'peças penduradas',
      blunder: 'erros graves',
      mistake: 'erros'
    };
    return labels[value] || String(value || 'decisões críticas');
  }

  function renderWeeklyReport() {
    if (!$('weeklyReportTitle')) return;
    const report = Progress.buildWeeklyReport(profile.gameArchive, profile.recentMistakes);
    const facts = [];

    if (!report.hasEnoughData) {
      $('weeklyReportTitle').textContent = 'Ainda estou construindo a linha de base.';
      $('weeklyReportText').textContent = report.current.games
        ? `Há ${report.current.games} partida recente. Ainda é cedo para transformar isso em uma conclusão sobre seu jogo.`
        : 'Jogue algumas partidas para eu separar acaso de padrão.';
      $('weeklyReportFacts').innerHTML = '';
      return;
    }

    if (report.trend === 'improving') {
      $('weeklyReportTitle').textContent = 'Os erros relevantes estão caindo.';
      $('weeklyReportText').textContent = 'A melhora aparece no processo antes de aparecer no rating. Continue validando sem ajuda.';
    } else if (report.trend === 'worsening') {
      $('weeklyReportTitle').textContent = 'Seu processo piorou nas partidas recentes.';
      $('weeklyReportText').textContent = 'Isso não pede mais teoria. Pede descobrir qual hábito voltou a falhar e corrigi-lo antes de acumular partidas.';
    } else if (report.trend === 'stable') {
      $('weeklyReportTitle').textContent = 'Você está em uma zona estável.';
      $('weeklyReportText').textContent = 'A estabilidade é útil, mas agora precisamos de transferência: posições novas e partidas sem assistência.';
    } else {
      $('weeklyReportTitle').textContent = 'Já existe material suficiente para começar a diagnosticar.';
      $('weeklyReportText').textContent = 'Ainda não existe uma semana anterior comparável, então vou mostrar fatos sem fingir tendência.';
    }

    facts.push(`<span><strong>${report.current.games}</strong> partidas nos últimos 7 dias</span>`);
    if (report.current.issuesPerGame != null) {
      facts.push(`<span><strong>${report.current.issuesPerGame.toFixed(1)}</strong> erros relevantes por partida</span>`);
    }
    if (report.topPattern) {
      facts.push(`<span><strong>${report.topPattern.count}</strong> ocorrência(s) de ${escapeHtml(reportPatternLabel(report.topPattern.label))}</span>`);
    }

    if (report.speedInsight?.type === 'fast-errors') {
      facts.push(`<span><strong>${report.speedInsight.fastRate}%</strong> dos lances rápidos tiveram erro relevante vs ${report.speedInsight.deliberateRate}% quando você pensou ≥3s</span>`);
      $('weeklyReportText').textContent += ' Há evidência de que decisões rápidas demais estão custando qualidade.';
    } else if (report.speedInsight?.type === 'slow-errors') {
      facts.push(`<span>Os erros não estão concentrados nos lances rápidos; pensar mais tempo, sozinho, não está resolvendo o problema.</span>`);
    }

    $('weeklyReportFacts').innerHTML = facts.join('');
  }


  function renderOpenings() {
    const assessed = Boolean(profile.assessment?.completed);
    $('openingsLocked')?.classList.toggle('hidden', assessed);
    $('openingsExperience')?.classList.toggle('hidden', !assessed);
    if (!assessed || !$('openingList')) return;

    const groups = Openings.recommendedByContext(profile.assessment);
    const allRecommended = [...groups.white, ...groups.blackE4, ...groups.blackD4];
    const style = profile.assessment.style || {};
    const provisionalStyle = (profile.assessment.games || 0) < 3;
    const firstWhite = groups.white[0] || allRecommended[0] || null;
    $('openingStyleTitle').textContent = provisionalStyle ? `Hipótese: ${style.label || 'estilo em formação'}` : style.label || 'Estilo em formação';
    $('openingStyleText').textContent = `${style.description || 'Vou continuar refinando isso conforme você joga.'}${provisionalStyle ? ' Essa leitura ainda é provisória e pode mudar nas próximas partidas.' : ''}`;
    $('topOpeningName').textContent = firstWhite ? `De brancas: ${firstWhite.name}` : '—';
    $('topOpeningReason').textContent = firstWhite ? `${firstWhite.why}${provisionalStyle ? ' Estou usando isso como teste de compatibilidade, não como identidade permanente.' : ''}` : 'Ainda coletando dados.';

    if (!profile.selectedOpening || !allRecommended.some((item) => item.id === profile.selectedOpening)) profile.selectedOpening = firstWhite?.id || null;
    const renderGroup = (title, items, limit) => {
      const visible = items.slice(0, limit);
      if (!visible.length) return '';
      return `<div class="opening-context"><div class="opening-context-label">${escapeHtml(title)}</div>${visible.map((opening, index) => `
        <button class="opening-list-item ${opening.id === profile.selectedOpening ? 'active' : ''}" data-opening-id="${escapeHtml(opening.id)}">
          <span class="opening-rank">${index + 1}</span><span><strong>${escapeHtml(opening.name)}</strong><small>${opening.difficulty === 1 ? 'fundamento' : 'próximo passo'} · ${index === 0 ? 'melhor encaixe neste grupo' : 'alternativa'}</small></span><span>→</span>
        </button>`).join('')}</div>`;
    };
    $('openingList').innerHTML = [
      renderGroup('DE BRANCAS', groups.white, 4),
      renderGroup('PRETAS CONTRA 1.e4', groups.blackE4, 3),
      renderGroup('PRETAS CONTRA 1.d4', groups.blackD4, 3)
    ].join('');
    renderOpeningDetail(profile.selectedOpening);
  }

  function renderOpeningDetail(openingId) {
    const opening = Openings.byId(openingId);
    const container = $('openingDetail');
    if (!opening || !container) return;
    if (openingLesson?.openingId === openingId) {
      renderOpeningLesson();
      return;
    }
    const context = Openings.contextLabel(opening);
    container.innerHTML = `
      <div class="opening-detail-head">
        <div><div class="panel-kicker">${escapeHtml(context.toUpperCase())} · AULA JOGÁVEL</div><h2>${escapeHtml(opening.name)}</h2><p class="analysis-copy">${escapeHtml(opening.why)}</p></div>
        <span class="opening-difficulty">${opening.difficulty === 1 ? 'FUNDAMENTO' : 'PRÓXIMO PASSO'}</span>
      </div>
      <div class="opening-line">${escapeHtml(opening.notation)}</div>
      <div class="opening-detail-grid">
        <div class="opening-detail-box"><h3>Você não vai decorar isso.</h3><ul><li>Eu mostro uma ideia.</li><li>Você encontra o lance no tabuleiro.</li><li>Eu respondo com a teoria e explico o que mudou.</li><li>No fim, a linha acaba e você continua sozinho.</li></ul></div>
        <div class="opening-detail-box"><h3>Depois de desenvolver</h3><ul>${opening.after.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
      </div>
      <div class="opening-actions"><button class="primary-button" data-start-opening-lesson="${escapeHtml(opening.id)}">APRENDER NO TABULEIRO →</button><button class="secondary-button" data-practice-opening="${escapeHtml(opening.id)}">IR DIRETO À POSIÇÃO FINAL</button></div>
    `;
  }

  function openingExpectedUci() {
    if (!openingLesson) return null;
    const opening = Openings.byId(openingLesson.openingId);
    return opening?.moves?.[openingLesson.index] || null;
  }

  function openingExpectedMove() {
    const uci = openingExpectedUci();
    if (!uci || !openingLesson) return null;
    return Core.moveFromUCI(openingLesson.state, uci);
  }

  function openingTheoryProgress() {
    if (!openingLesson) return { current: 0, total: 0 };
    const opening = Openings.byId(openingLesson.openingId);
    const userColor = openingLesson.userColor;
    const userMoves = opening.moves.filter((uci, index) => {
      const color = index % 2 === 0 ? 'w' : 'b';
      return color === userColor;
    });
    const done = opening.moves.slice(0, openingLesson.index).filter((_uci, index) => {
      const color = index % 2 === 0 ? 'w' : 'b';
      return color === userColor;
    }).length;
    return { current: Math.min(done + 1, userMoves.length), total: userMoves.length };
  }

  function applyOpeningTheoryMove(uci) {
    const move = openingLesson ? Core.moveFromUCI(openingLesson.state, uci) : null;
    if (!move) return null;
    const before = Core.cloneState(openingLesson.state);
    const after = Core.makeMoveCopy(before, move);
    const san = Core.sanNotation(before, move, after);
    openingLesson.state = after;
    openingLesson.index += 1;
    return { move, san };
  }

  function startOpeningLesson(openingId) {
    const opening = Openings.byId(openingId);
    if (!opening) return;
    const userColor = opening.side === 'Brancas' ? 'w' : 'b';
    openingLesson = {
      openingId,
      userColor,
      state: Core.createInitialState(),
      index: 0,
      hintLevel: 0,
      phase: 'prompt',
      feedbackTitle: null,
      feedbackText: null
    };
    openingSelected = null;
    openingLegal = [];

    // Se a aula é de pretas, mostre imediatamente o primeiro lance das brancas.
    if (openingLesson.state.turn !== userColor && opening.moves[0]) {
      const reply = applyOpeningTheoryMove(opening.moves[0]);
      if (reply) {
        openingLesson.feedbackTitle = `As brancas jogaram ${reply.san}.`;
        openingLesson.feedbackText = 'Agora não responda no automático. Use a ideia da abertura para escolher sua estrutura.';
      }
    }
    renderOpeningLesson();
  }

  function renderOpeningLesson() {
    const container = $('openingDetail');
    if (!container || !openingLesson) return;
    const opening = Openings.byId(openingLesson.openingId);
    if (!opening) return;
    const expectedUci = openingExpectedUci();
    const expected = openingExpectedMove();
    const complete = openingLesson.index >= opening.moves.length;
    const progress = openingTheoryProgress();
    const idea = expectedUci ? Openings.lessonIdea(opening, expectedUci, openingLesson.state) : opening.after[0];
    const waitingOpponent = !complete && openingLesson.state.turn !== openingLesson.userColor;

    container.innerHTML = `
      <div class="opening-lesson-head">
        <div><div class="panel-kicker">AULA · ${escapeHtml(Openings.contextLabel(opening).toUpperCase())}</div><h2>${escapeHtml(opening.name)}</h2></div>
        <button class="text-button" data-exit-opening-lesson="1">SAIR DA AULA</button>
      </div>
      <div class="opening-lesson-progress"><span><b>${complete ? progress.total : progress.current}</b>/${progress.total} decisões suas</span><div><i style="width:${progress.total ? Math.min(100, (Math.max(0, progress.current - (complete ? 0 : 1)) / progress.total) * 100) : 0}%"></i></div></div>
      <div class="opening-lesson-grid">
        <div class="opening-lesson-board-wrap"><div id="openingLessonBoard" class="chess-board opening-lesson-board" aria-label="Tabuleiro da aula de abertura"></div><small>Último lance marcado em dourado · clique na peça e depois na casa</small></div>
        <div class="opening-lesson-coach">
          <div class="light-mini">L</div>
          ${complete ? `
            <div class="opening-lesson-complete"><span class="move-classification excellent">LINHA CONCLUÍDA</span><h3>Agora começa o xadrez de verdade.</h3><p>Você chegou à posição sem copiar setas. A teoria para aqui; use os planos da abertura e continue contra o bot.</p><div class="opening-after-list">${opening.after.map((item) => `<span>→ ${escapeHtml(item)}</span>`).join('')}</div><button class="primary-button" data-opening-continue="${escapeHtml(opening.id)}">CONTINUAR ESTA PARTIDA →</button></div>
          ` : waitingOpponent ? `
            <span class="move-classification book">TEORIA</span><h3>Boa. Agora veja a resposta.</h3><p>${escapeHtml(openingLesson.feedbackText || 'O adversário também tem um plano. Veja a resposta teórica antes da próxima decisão.')}</p><button class="primary-button" data-opening-next="1">VER RESPOSTA →</button>
          ` : `
            <span class="move-classification book">PASSO ${progress.current}</span><h3>Encontre a ideia — não a casa.</h3><p class="opening-idea">${escapeHtml(idea)}</p>
            ${openingLesson.feedbackTitle ? `<div class="opening-lesson-feedback"><strong>${escapeHtml(openingLesson.feedbackTitle)}</strong><span>${escapeHtml(openingLesson.feedbackText || '')}</span></div>` : ''}
            <div id="openingHintBox" class="opening-hint-box ${openingLesson.hintLevel ? '' : 'hidden'}"></div>
            <button class="secondary-button" data-opening-hint="1">${openingLesson.hintLevel ? 'OUTRA PISTA' : 'NÃO SEI COMO COMEÇAR'}</button>
          `}
        </div>
      </div>
    `;

    const state = Core.cloneState(openingLesson.state);
    renderBoard($('openingLessonBoard'), state, {
      selected: openingSelected,
      legal: openingLegal,
      onClick: complete || waitingOpponent ? null : onOpeningLessonSquare,
      interactive: !(complete || waitingOpponent),
      orientation: openingLesson.userColor
    });
    renderOpeningHint();
  }

  function openingCastleViaRook(row, col) {
    if (!openingLesson || !openingSelected) return null;
    const piece = openingLesson.state.board[openingSelected.row]?.[openingSelected.col];
    if (!piece || Core.typeOf(piece) !== 'k' || row !== openingSelected.row || ![0, 7].includes(col)) return null;
    const rook = openingLesson.state.board[row]?.[col];
    if (!rook || Core.typeOf(rook) !== 'r' || Core.colorOf(rook) !== openingLesson.userColor) return null;
    const toCol = col === 7 ? 6 : 2;
    return openingLegal.find((move) => move.castle && move.toRow === row && move.toCol === toCol) || null;
  }

  function onOpeningLessonSquare(row, col) {
    if (!openingLesson || openingLesson.state.turn !== openingLesson.userColor) return;
    const expectedUci = openingExpectedUci();
    if (!expectedUci) return;

    let candidate = openingCastleViaRook(row, col);
    if (!candidate && openingSelected) candidate = openingLegal.find((move) => move.toRow === row && move.toCol === col) || null;
    if (candidate) {
      const chosenUci = Core.moveToUCI(candidate);
      if (chosenUci !== expectedUci) {
        openingLesson.feedbackTitle = 'Legal, mas não é a ideia desta aula.';
        openingLesson.feedbackText = Openings.lessonIdea(Openings.byId(openingLesson.openingId), expectedUci, openingLesson.state);
        openingLesson.hintLevel = Math.max(1, openingLesson.hintLevel);
        openingSelected = null;
        openingLegal = [];
        renderOpeningLesson();
        return;
      }
      const opening = Openings.byId(openingLesson.openingId);
      const idea = Openings.lessonIdea(opening, expectedUci, openingLesson.state);
      const played = applyOpeningTheoryMove(expectedUci);
      openingLesson.feedbackTitle = `Certo: ${played?.san || expectedUci}.`;
      openingLesson.feedbackText = idea;
      openingLesson.hintLevel = 0;
      openingSelected = null;
      openingLegal = [];
      renderOpeningLesson();
      return;
    }

    const piece = openingLesson.state.board[row]?.[col];
    if (piece && Core.colorOf(piece) === openingLesson.userColor) {
      openingSelected = { row, col };
      openingLegal = Core.generateLegalMoves(openingLesson.state, openingLesson.userColor).filter((move) => move.fromRow === row && move.fromCol === col);
      renderOpeningLesson();
      return;
    }
    openingSelected = null;
    openingLegal = [];
    renderOpeningLesson();
  }

  function renderOpeningHint() {
    if (!openingLesson || !$('openingHintBox') || !openingLesson.hintLevel) return;
    const expected = openingExpectedMove();
    const opening = Openings.byId(openingLesson.openingId);
    const uci = openingExpectedUci();
    if (!expected || !opening || !uci) return;
    const from = Core.squareName(expected.fromRow, expected.fromCol);
    const to = Core.squareName(expected.toRow, expected.toCol);
    const idea = Openings.lessonIdea(opening, uci, openingLesson.state);
    const steps = [
      `Comece pela função do lance: ${idea}`,
      `A peça que resolve essa etapa começa em ${from}.`,
      expected.castle ? `É hora do roque: mova o rei de ${from} para ${to} — ou clique na torre depois de selecionar o rei.` : `O destino desta vez é ${to}. Agora tente fazer o lance e explique mentalmente por quê.`
    ];
    const level = Math.min(openingLesson.hintLevel, steps.length);
    $('openingHintBox').textContent = steps[level - 1];
    $('openingHintBox').classList.remove('hidden');
  }

  function showNextOpeningTheoryReply() {
    if (!openingLesson) return;
    const opening = Openings.byId(openingLesson.openingId);
    const uci = opening?.moves?.[openingLesson.index];
    if (!uci || openingLesson.state.turn === openingLesson.userColor) return;
    const played = applyOpeningTheoryMove(uci);
    openingLesson.feedbackTitle = `Resposta: ${played?.san || uci}.`;
    openingLesson.feedbackText = 'Pare um segundo e veja o que esse lance mudou antes de procurar sua próxima jogada.';
    openingSelected = null;
    openingLegal = [];
    renderOpeningLesson();
  }

  function startOpeningPractice(openingId) {
    const opening = Openings.byId(openingId);
    if (!opening) return;
    if (botTimer) clearTimeout(botTimer);
    const state = Openings.stateAfterMoves(opening.moves);
    const userColor = opening.side === 'Brancas' ? 'w' : 'b';
    game = createGame(state, { source: 'opening-practice', mode: 'coach', userColor, botLevel: 300 });
    selected = null; legalForSelected = []; pendingMove = null; promotionCandidates = []; botThinking = false; moveStartedAt = Date.now();
    saveGame(); renderGame(); applyGameModeUI();
    setCoach(opening.name, `A sequência conhecida acabou. Agora não existe seta mágica: use as ideias da abertura e decida o próximo plano. ${opening.after[0]}`);
    $('gameStatus').textContent = 'Treino de abertura';
    if (game.state.turn !== game.userColor) { botThinking = true; $('turnIndicator').textContent = 'Adversário pensando'; scheduleBotTurn(); }
    else $('turnIndicator').textContent = isPhysicalGame() ? `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o lance` : 'Sua vez · arraste ou clique';
    switchView('play');
  }

  function renderPatterns() {
    const assessed = Boolean(profile.assessment?.completed);
    $('patternsLocked')?.classList.toggle('hidden', assessed);
    $('patternsExperience')?.classList.toggle('hidden', !assessed);
    if (!assessed || !$('patternCatalog')) return;
    const priorities = Object.fromEntries(Training.patternCatalog(profile).map((item) => [item.mode, item]));
    const items = PatternMemory.catalog(profile);
    const due = items.filter((item) => item.due).length;
    const learned = items.filter((item) => item.learned).length;
    if ($('patternDueSummary')) $('patternDueSummary').textContent = `${due} para revisar`;
    if ($('patternLearnedSummary')) $('patternLearnedSummary').textContent = `${learned}/${items.length} em memória longa`;
    $('patternCatalog').innerHTML = items.map((item, index) => {
      const priority = priorities[item.mode]?.priority || 'Base';
      const status = item.due ? 'REVISAR AGORA' : item.stage.label;
      return `
      <button class="pattern-card memory-pattern-card ${item.due ? 'due' : ''}" data-pattern-mode="${escapeHtml(item.mode)}">
        <div class="pattern-card-top"><span class="pattern-icon">${escapeHtml(item.icon)}</span><span class="memory-stage ${item.due ? 'due' : ''}">${escapeHtml(status)}</span></div>
        <strong>${index + 1}. ${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.description)}</p>
        <div class="memory-progress"><span style="width:${item.mastery}%"></span></div>
        <div class="memory-copy"><b>${item.mastery}%</b><span>${escapeHtml(PatternMemory.stageMessage(item.state))}</span></div>
        <footer><span>${escapeHtml(item.stage.label)} · ${escapeHtml(priority)}</span><span>${item.state.attempts} tentativas</span></footer>
      </button>`;
    }).join('');
  }


  function runPlanAction(action, mode) {
    if (action === 'review') {
      const pending = Mistakes.dueMistakes(profile.recentMistakes).slice().reverse()[0];
      if (pending) {
        replayMistakePosition(pending.id);
        return;
      }
      setTrainingMode('threat');
      switchView('train');
      return;
    }

    if (action === 'play') {
      startNewGame({ trainingFocus: mode || Training.recommendFocus(profile).mode });
      switchView('play');
      return;
    }

    if (action === 'surprise') {
      setTrainingMode('surprise');
      switchView('train');
      return;
    }

    setTrainingMode(mode || Training.recommendFocus(profile).mode);
    switchView('train');
  }

  function updateEngineStatus(status) {
    ensureEngineBadge();
    const badge = $('engineStatusBadge');
    if (!badge) return;

    const labels = {
      idle: 'Stockfish sob demanda',
      loading: 'Stockfish carregando',
      ready: 'Stockfish pronto',
      unavailable: 'Analisador local'
    };
    badge.textContent = labels[status.state] || 'Analisador local';
    badge.dataset.state = status.state;
    badge.title = status.error || '';
  }

  function ensureEngineBadge() {
    if ($('engineStatusBadge')) return;
    const footer = document.querySelector('.coach-footer');
    if (!footer) return;
    const badge = document.createElement('span');
    badge.id = 'engineStatusBadge';
    badge.className = 'engine-status-badge';
    badge.textContent = 'Stockfish sob demanda';
    footer.appendChild(badge);
  }

  function exportBackup() {
    const backup = Portability.createBackup(profile, game);
    const text = JSON.stringify(backup, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `kira-chess-backup-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('Backup exportado.');
  }

  async function restoreBackupFile(file) {
    if (!file) return;
    let parsed;
    try {
      parsed = Portability.parseBackup(await file.text());
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Backup inválido.');
      return;
    }

    if (!confirm('Juntar as partidas e treinos deste backup ao perfil atual? O histórico da conta será preservado.')) return;

    const backupGuestId = parsed.profile._sync?.guestId;
    const restoredProfile = normalizeProfile(authUser && backupGuestId ? ProfileSync.transferGuest(profile, parsed.profile, backupGuestId) : ProfileSync.merge(profile, parsed.profile));
    if (!authUser && backupGuestId) localStorage.setItem('kiraGuestId', backupGuestId);
    const restoredGame = normalizeGame(parsed.currentGame);
    localStorage.setItem(profileStorageKey(), JSON.stringify(restoredProfile));
    if (restoredGame?.status === 'playing') localStorage.setItem(gameStorageKey(), JSON.stringify(restoredGame));
    else localStorage.removeItem(gameStorageKey());
    if (storageScope === 'guest') localStorage.removeItem(LEGACY_PROFILE_KEY);
    location.reload();
  }

  function switchView(name) {
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('active-view'));
    $(`view-${name}`)?.classList.add('active-view');
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));

    if (name === 'play' && (!game || game.status !== 'playing')) startNewGame({ mode: profile.gameMode || 'coach' });
    if (name === 'train') renderTraining();
    if (name === 'openings') renderOpenings();
    if (name === 'patterns') renderPatterns();
    if (name === 'analyze') {
      renderAnalysis();
      const source = currentReviewArchiveItem();
      if (source && !phaseAnalysisErrors.has(`${storageScope}:${source.id}`)) void analyzeGamePhases();
    }
    if (name === 'progress') refreshProfileUI();
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    if (name === 'play') requestAnimationFrame(fitGameBoard);
  }

  function warningHintSteps(risk) {
    if (!risk) return ['Volte uma etapa e procure a resposta mais simples do adversário.'];
    if (risk.type === 'mate-in-one') return [
      'Não procure sua melhor jogada ainda. Imagine que você já fez esse lance e entregue a vez ao adversário.',
      'Agora liste somente os xeques que o adversário teria. Xeque é prioridade porque você seria obrigado a responder.',
      `Existe um xeque que termina a partida imediatamente (${risk.mateNotation || risk.mateMove || 'mate em 1'}). Volte e escolha um lance que elimine essa possibilidade.`
    ];
    return [
      `Olhe apenas para a peça que você pretende deixar em ${risk.square}. Esqueça seu plano por alguns segundos.`,
      `Depois do lance, essa peça terá ${risk.attackers} atacante(s) e ${risk.defenders} defensor(es). Pergunte qual captura adversária é mais simples.`,
      `${risk.text} Agora tente encontrar outra casa ou outro lance que preserve sua ideia sem oferecer material.`
    ];
  }

  function authError(message) {
    const box = $('authError');
    if (!box) return;
    if (!message) { box.classList.add('hidden'); box.textContent = ''; return; }
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function updateAuthUI() {
    const signed = Boolean(authUser);
    $('authNotConfigured')?.classList.toggle('hidden', authConfigured);
    $('authSignedIn')?.classList.toggle('hidden', !signed);
    $('authForms')?.classList.toggle('hidden', signed);
    $('continueGuest')?.classList.toggle('hidden', signed);
    if ($('authUserName')) $('authUserName').textContent = signed ? Auth.displayName(authUser) : 'Jogador';
    if ($('authUserEmail')) $('authUserEmail').textContent = signed ? (authUser.email || 'conta conectada') : '—';
    if ($('authAvatar')) $('authAvatar').textContent = signed ? Auth.displayName(authUser).charAt(0).toUpperCase() : 'J';
    document.querySelectorAll('#signInForm button[type="submit"],#signUpForm button[type="submit"]').forEach((button) => { button.disabled = !authConfigured; });
    $('accountSync').classList.toggle('hidden', !signed);
    $('syncStatus').textContent = lastSyncStatus.text;
    const offer = signed && ProfileSync.hasProgress(loadProfile('guest')) && !profile.guestTransfers?.[guestId];
    $('guestTransferPrompt').classList.toggle('hidden', !offer);
    if ($('accountButton')) $('accountButton').title = signed ? `Conta: ${Auth.displayName(authUser)}` : 'Entrar ou criar conta';
  }

  function openAuthGate() {
    updateAuthUI();
    authError(pendingAuthMessage);
    $('authGate')?.classList.remove('hidden');
    document.body.classList.add('auth-open');
  }

  function closeAuthGate(rememberGuest) {
    $('authGate')?.classList.add('hidden');
    document.body.classList.remove('auth-open');
    if (rememberGuest) localStorage.setItem('kiraChessAuthDismissed', '1');
  }

  function restoreGameForCurrentScope() {
    if (botTimer) clearTimeout(botTimer);
    botTimer = null;
    botThinking = false;
    cleanupBoardDrag();
    game = null;
    selected = null;
    legalForSelected = [];
    if (!tryLoadGame()) return;
    renderGame();
    applyGameModeUI();
    if ($('userColor') && ['w', 'b'].includes(game.userColor)) $('userColor').value = game.userColor;
    if ($('botLevel') && [...$('botLevel').options].some((option) => Number(option.value) === Number(game.botLevel))) $('botLevel').value = String(game.botLevel);
    if (game.liveEvaluation) enqueueLiveHistory(game);
    if (!isPhysicalGame() && game.state.turn !== game.userColor) {
      botThinking = true;
      $('turnIndicator').textContent = 'Adversário pensando';
      scheduleBotTurn();
    } else {
      moveStartedAt = Date.now();
      $('turnIndicator').textContent = isPhysicalGame() ? `${game.state.turn === 'w' ? 'Brancas' : 'Pretas'} jogam · registre o lance` : 'Sua vez · arraste ou clique';
    }
  }

  function handleSyncStatus(value) {
    lastSyncStatus = value;
    $('syncStatus').textContent = value.text;
    $('accountSync').dataset.state = value.state;
    $('syncNow').disabled = value.state === 'syncing';
  }

  async function transferGuestProgress() {
    if (!authUser) return;
    const owner = authUser.id;
    const button = $('transferGuestProgress'); button.disabled = true;
    $('transferStatus').textContent = 'Juntando seu progresso, sem apagar a cópia local…';
    try {
      profile = normalizeProfile(ProfileSync.transferGuest(profile, loadProfile('guest'), guestId));
      localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
      refreshProfileUI();
      await Auth.syncNow();
      if (authUser?.id !== owner) return;
      $('transferStatus').textContent = 'Progresso transferido e sincronizado. A cópia de convidado foi preservada.';
      updateAuthUI(); showToast('Seu progresso está na conta.');
    } catch (error) { if (authUser?.id === owner) $('transferStatus').textContent = 'A transferência está salva neste navegador, mas a nuvem ainda não confirmou. Use Sincronizar agora para tentar novamente.'; }
    finally { button.disabled = false; }
  }

  async function handleAuthState(state) {
    authConfigured = Boolean(state?.configured);
    const nextUser = state?.user || null;
    const nextScope = nextUser?.id || 'guest';
    const scopeChanged = nextScope !== storageScope;
    if (scopeChanged) profileEpoch++;
    authUser = nextUser;
    storageScope = nextScope;
    if (state?.profile) profile = normalizeProfile(ProfileSync.merge(state.profile, loadProfile(storageScope)));
    else if (scopeChanged) profile = loadProfile(storageScope);
    if (authUser) {
      if (!profile.name || profile.name === 'Jogador') profile = ProfileSync.stamp({ ...profile, name: Auth.displayName(authUser) }, profile, deviceId);
      localStorage.setItem(profileStorageKey(), JSON.stringify(profile));
      localStorage.removeItem('kiraChessAuthDismissed');
    }
    if (state?.authMessage) pendingAuthMessage = state.authMessage;
    updateAuthUI(); refreshProfileUI();
    if (scopeChanged) reviewData = null;
    renderAnalysis(); renderTraining(); renderOpenings(); renderPatterns();
    if (scopeChanged || !game) restoreGameForCurrentScope();
    resumeArchivedLive();
    if (authUser && (scopeChanged || state.event === 'initial')) {
      if (ProfileSync.hasProgress(loadProfile('guest')) && !profile.guestTransfers?.[guestId]) openAuthGate();
      else closeAuthGate(false);
    }
    if (pendingAuthMessage) { openAuthGate(); authError(pendingAuthMessage); }
  }

  function bindAuthEvents() {
    $('mobileAccountButton').addEventListener('click', openAuthGate);
    $('syncNow').addEventListener('click', () => { void Auth.syncNow().catch(() => {}); });
    $('transferGuestProgress').addEventListener('click', transferGuestProgress);
    $('transferGuestLater').addEventListener('click', () => closeAuthGate(false));
    $('googleSignIn').addEventListener('click', async () => {
      pendingAuthMessage = null; authError(null);
      const button = $('googleSignIn'); button.disabled = true;
      try { await Auth.signInWithGoogle(); } catch (error) { authError(error.message); }
      finally { button.disabled = false; }
    });
    $('accountButton')?.addEventListener('click', openAuthGate);
    $('closeAuth')?.addEventListener('click', () => closeAuthGate(false));
    $('continueGuest')?.addEventListener('click', () => { pendingAuthMessage = null; closeAuthGate(true); });
    $('authGate')?.addEventListener('click', (event) => { if (event.target === $('authGate')) closeAuthGate(false); });

    document.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => {
      const tab = button.dataset.authTab;
      document.querySelectorAll('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item === button));
      $('signInForm')?.classList.toggle('hidden', tab !== 'signin');
      $('signUpForm')?.classList.toggle('hidden', tab !== 'signup');
      authError(null);
    }));

    $('signInForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      pendingAuthMessage = null; authError(null);
      if (!authConfigured) { authError('Configure o Supabase antes de usar login real.'); return; }
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true; button.textContent = 'ENTRANDO…';
      try {
        await Auth.signIn($('signInEmail').value.trim(), $('signInPassword').value);
        showToast('Conta conectada.');
      } catch (error) {
        authError(error?.message || 'Não foi possível entrar.');
      } finally {
        button.disabled = false; button.textContent = 'ENTRAR →';
      }
    });

    $('signUpForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      pendingAuthMessage = null; authError(null);
      if (!authConfigured) { authError('Configure o Supabase antes de criar contas.'); return; }
      const button = event.currentTarget.querySelector('button[type="submit"]');
      button.disabled = true; button.textContent = 'CRIANDO…';
      try {
        const result = await Auth.signUp($('signUpName').value.trim(), $('signUpEmail').value.trim(), $('signUpPassword').value);
        if (result.needsEmailConfirmation) authError('Conta criada. Confirme o email e depois entre.');
        else showToast('Conta criada e conectada.');
      } catch (error) {
        authError(error?.message || 'Não foi possível criar a conta.');
      } finally {
        button.disabled = false; button.textContent = 'CRIAR CONTA →';
      }
    });

    $('signOutButton')?.addEventListener('click', async () => {
      try { await Auth.signOut(); closeAuthGate(false); showToast('Você saiu da conta.'); }
      catch (error) { authError(error?.message || 'Não foi possível sair.'); }
    });

    $('shareSiteButton')?.addEventListener('click', async () => {
      const share = { title: 'Kira Chess', text: 'Joga uma partida aqui e deixa o Light analisar seu xadrez.', url: window.location.href };
      try {
        if (navigator.share) await navigator.share(share);
        else { await navigator.clipboard.writeText(window.location.href); showToast('Link copiado.'); }
      } catch (_) { /* cancelamento de compartilhamento não é erro */ }
    });
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => switchView(button.dataset.view));
      if (button.tagName !== 'BUTTON') button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); switchView(button.dataset.view);
      });
    });
    document.querySelectorAll('[data-view-jump]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewJump)));
    document.querySelectorAll('[data-start-assessment]').forEach((button) => button.addEventListener('click', startAssessmentGame));
    $('startAssessment')?.addEventListener('click', startAssessmentGame);

    $('homeCoachPlay')?.addEventListener('click', () => {
      profile.gameMode = 'coach'; saveProfile(); startNewGame({ mode: 'coach' }); switchView('play');
    });
    $('homeNormalPlay')?.addEventListener('click', () => {
      profile.gameMode = 'normal'; saveProfile(); startNewGame({ mode: 'normal' }); switchView('play');
    });

    document.querySelectorAll('[data-game-mode]').forEach((button) => button.addEventListener('click', () => {
      profile.gameMode = button.dataset.gameMode === 'normal' ? 'normal' : 'coach';
      saveProfile();
      startNewGame({ mode: profile.gameMode });
    }));

    $('exportBackup').addEventListener('click', exportBackup);
    $('importBackup').addEventListener('click', () => $('backupFileInput').click());
    $('backupFileInput').addEventListener('change', async () => {
      const file = $('backupFileInput').files?.[0] || null; $('backupFileInput').value = ''; await restoreBackupFile(file);
    });

    $('gameType').addEventListener('change', () => startNewGame({mode:selectedGameMode()}));
    $('liveEvaluationToggle').addEventListener('change', () => { if (!game || isEvaluationGame()) return; game.liveEvaluation = $('liveEvaluationToggle').checked; if (game.liveEvaluation) enqueueLiveHistory(game); saveGame(); applyGameModeUI(); renderLiveEvaluation(); });
    $('finishRecording').addEventListener('click', () => { if (!game?.history.length || game.status !== 'playing' || isEvaluationGame()) return; if (botTimer) clearTimeout(botTimer); botTimer = null; botThinking = false; game.status = 'ended'; game.result = $('recordingResult').value; game.reason = 'recording-ended'; game.completedAt = new Date().toISOString(); saveGame(); renderGame(); finishGame(); });
    $('liveEvaluationList').addEventListener('click', (event) => { const button = event.target.closest('[data-live-ply]'); if (button) openLiveExplanation(Number(button.dataset.livePly)); });
    $('retryLiveEvaluation').addEventListener('click', () => { enqueueLiveHistory(game, true); renderLiveEvaluation(); });
    $('closeLiveExplanation').addEventListener('click', () => { liveExplanation = null; $('liveExplanation').classList.add('hidden'); });
    $('nextLiveContinuation').addEventListener('click', () => { if (liveExplanation) { liveExplanation.index++; renderLiveExplanation(); } });
    $('restartLiveContinuation').addEventListener('click', () => { if (liveExplanation) { liveExplanation.index = 0; renderLiveExplanation(); } });
    $('newGameButton').addEventListener('click', () => startNewGame({ mode: selectedGameMode() }));
    document.querySelectorAll('[data-pgn-example]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const response = await fetch(`assets/samples/${button.dataset.pgnExample}.pgn`);
        if (!response.ok) throw new Error('Exemplo indisponível');
        $('pgnInput').value = await response.text();
        $('importSide').value = button.dataset.pgnExample === 'black' ? 'b' : 'w';
      } catch (_) { showToast('Não foi possível abrir o exemplo.'); }
    }));
    $('openPgnImport').addEventListener('click', openPgnImport);
    $('cancelPgnImport').addEventListener('click', closePgnImport);
    $('confirmPgnImport').addEventListener('click', importPgnGame);
    $('pgnImportModal').addEventListener('click', (event) => { if (event.target === $('pgnImportModal')) closePgnImport(); });
    $('userColor').addEventListener('change', () => { if (game?.status === 'playing' && game.history.length) showToast('A nova cor vale para a próxima partida.'); });
    $('botLevel').addEventListener('change', () => {
      const elo = Number($('botLevel').value) || 500;
      if ($('botEloBadge') && !isEvaluationGame()) $('botEloBadge').textContent = `≈${elo} Elo`;
      if (game?.status === 'playing' && !isEvaluationGame()) {
        if (!game.history.length) { game.botLevel = elo; saveGame(); applyGameModeUI(); }
        else showToast('O novo Elo vale para a próxima partida.');
      }
    });

    $('copyPgn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pgnText()); showToast('PGN copiado.'); }
      catch (_) { showToast('Não foi possível copiar o PGN.'); }
    });

    $('coachThinkButton')?.addEventListener('click', () => explainHowToThink(true));
    $('coachHintButton')?.addEventListener('click', async () => {
      profile.hints += 1; saveProfile(); await giveCoachHint();
    });

    $('coachChoices')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-coach-choice]');
      if (!button) return;
      await answerCoachObservation(button.dataset.coachChoice);
    });
    $('coachSkipButton')?.addEventListener('click', skipCoachObservation);

    $('reconsiderMove').addEventListener('click', () => {
      $('warningModal').classList.add('hidden'); pendingMove = null; selected = null; legalForSelected = []; renderGame();
      setCoach('Boa.', 'Agora preserve sua ideia, mas verifique primeiro a resposta do adversário.');
    });

    $('askMoveHint').addEventListener('click', async () => {
      profile.hints += 1; saveProfile();
      const risk = pendingMove && game ? Analysis.moveRisk(game.state, pendingMove) : null;
      const steps = warningHintSteps(risk);
      const level = Math.min(Number($('warningHint').dataset.level || 0) + 1, steps.length);
      $('warningHint').dataset.level = String(level);
      const fallback = steps[level - 1];
      $('warningHint').textContent = 'Pensando…'; $('warningHint').classList.remove('hidden');
      $('warningHint').textContent = await CoachAI.enhance({ verifiedRisk: risk, verifiedHint: fallback, hintLevel: level }, fallback, 'Dê uma dica progressiva sobre o risco deste lance. Não sugira a melhor jogada.');
      if (level >= steps.length) $('askMoveHint').textContent = 'EXPLICAÇÃO MOSTRADA';
      else $('askMoveHint').textContent = 'OUTRA PISTA';
    });

    $('confirmMove').addEventListener('click', () => {
      const move = pendingMove; pendingMove = null; $('warningModal').classList.add('hidden'); selected = null; legalForSelected = [];
      if (move) makeMove(move, true, true);
    });

    document.querySelectorAll('[data-promote]').forEach((button) => button.addEventListener('click', () => {
      const choice = button.dataset.promote; const move = promotionCandidates.find((candidate) => candidate.promotion === choice);
      promotionCandidates = []; $('promotionModal').classList.add('hidden'); selected = null; legalForSelected = []; if (move) makeMove(move, true, false);
    }));

    $('trainingCatalog')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-catalog-mode]'); if (!button) return; setTrainingMode(button.dataset.catalogMode);
    });
    $('developmentChoices')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-plan-choice]'); if (!button) return; chooseDevelopmentPlan(button.dataset.planChoice);
    });
    $('developmentNext')?.addEventListener('click', nextDevelopmentScenario);
    $('reviewDuePattern')?.addEventListener('click', reviewDuePattern);
    $('reviewDueMistake')?.addEventListener('click', reviewDueMistake);
    $('patternCatalog')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-pattern-mode]'); if (!button) return; setTrainingMode(button.dataset.patternMode); switchView('train');
    });
    $('openingList')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-opening-id]'); if (!button) return;
      profile.selectedOpening = button.dataset.openingId; saveProfile(); renderOpenings();
    });
    $('openingDetail')?.addEventListener('click', (event) => {
      const startLesson = event.target.closest('[data-start-opening-lesson]');
      if (startLesson) { startOpeningLesson(startLesson.dataset.startOpeningLesson); return; }
      if (event.target.closest('[data-opening-hint]')) {
        if (openingLesson) { openingLesson.hintLevel = Math.min(3, (openingLesson.hintLevel || 0) + 1); renderOpeningLesson(); }
        return;
      }
      if (event.target.closest('[data-opening-next]')) { showNextOpeningTheoryReply(); return; }
      const continueButton = event.target.closest('[data-opening-continue]');
      if (continueButton) { const id = continueButton.dataset.openingContinue; openingLesson = null; startOpeningPractice(id); return; }
      if (event.target.closest('[data-exit-opening-lesson]')) { const id = openingLesson?.openingId || profile.selectedOpening; openingLesson = null; openingSelected = null; openingLegal = []; renderOpeningDetail(id); return; }
      const practice = event.target.closest('[data-practice-opening]');
      if (practice) { openingLesson = null; startOpeningPractice(practice.dataset.practiceOpening); return; }
      const related = event.target.closest('[data-opening-pattern]');
      if (related) { setTrainingMode(related.dataset.openingPattern || 'bishop'); switchView('train'); }
    });

    $('analyzeGamePhases').addEventListener('click', analyzeGamePhases);
    $('trainFromHistory').addEventListener('click', () => profile.weaknessSession ? switchView('analyze') : startWeaknessTraining());
    $('trainWeakness').addEventListener('click', () => startWeaknessTraining());
    $('closeWeaknessSummary').addEventListener('click', () => { if (profile.weaknessSummary) profile.weaknessSummary.dismissed = true; saveProfile(); renderWeaknessTraining(); });
    $('closeWeakness').addEventListener('click', () => { profile.weaknessSession = null; saveProfile(); renderWeaknessTraining(); });
    ['Hint', 'Reply', 'Solution', 'Reset', 'Next'].forEach((name) => $(`weakness${name}`).addEventListener('click', () => weaknessAction(name.toLowerCase())));
    $('phaseGameCards').addEventListener('click', openPhaseExample);
    $('phaseHistoryCards').addEventListener('click', openPhaseExample);
    $('reviewFirst')?.addEventListener('click', () => goToReviewPly(0));
    $('reviewPrev')?.addEventListener('click', () => goToReviewPly(reviewPly - 1));
    $('reviewNext')?.addEventListener('click', () => goToReviewPly(reviewPly + 1));
    $('reviewLast')?.addEventListener('click', () => goToReviewPly(reviewData?.moves?.length || 0));
    $('reviewNextKey')?.addEventListener('click', nextReviewKeyMoment);
    $('reviewRetry')?.addEventListener('click', startReviewRetry);
    $('reviewBest')?.addEventListener('click', toggleReviewBestMove);
    $('reviewAnotherGame')?.addEventListener('click', () => {
      $('archiveSection')?.classList.remove('hidden');
      $('archiveSection')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      $('archiveSection')?.classList.add('archive-focus');
      setTimeout(() => $('archiveSection')?.classList.remove('archive-focus'), 1000);
    });
    $('reviewMoveList')?.addEventListener('click', (event) => { const button = event.target.closest('[data-review-ply]'); if (button) goToReviewPly(Number(button.dataset.reviewPly)); });
    $('reviewGraph')?.addEventListener('click', (event) => { const button = event.target.closest('[data-review-ply]'); if (button) goToReviewPly(Number(button.dataset.reviewPly)); });

    $('archiveList').addEventListener('click', (event) => { const button = event.target.closest('[data-archive-id]'); if (button) openArchivedAnalysis(button.dataset.archiveId); });
    $('mistakeList').addEventListener('click', (event) => { const button = event.target.closest('[data-mistake-id]'); if (button) replayMistakePosition(button.dataset.mistakeId); });
    $('trainingHint').addEventListener('click', requestTrainingHint);
    $('nextExercise').addEventListener('click', nextExercise);

    $('resetButton').addEventListener('click', () => {
      if (authUser) {
        if (!confirm('Limpar a cópia local desta conta? O histórico sincronizado será recuperado da nuvem; a conta não será apagada.')) return;
        localStorage.removeItem(profileStorageKey()); localStorage.removeItem(gameStorageKey());
        void Auth.syncNow().then(() => showToast('Cópia local atualizada com os dados da conta.')).catch(() => showToast('A cópia local foi limpa. Reconecte para recuperar a conta.'));
        return;
      }
      if (!confirm('Apagar todo o progresso local e fazer uma nova avaliação?')) return;
      localStorage.removeItem(profileStorageKey()); localStorage.removeItem(gameStorageKey());
      if (storageScope === 'guest') localStorage.removeItem(LEGACY_PROFILE_KEY);
      profile = deepClone(defaultProfile); if (authUser) profile.name = Auth.displayName(authUser); game = null; saveProfile(); reviewData = null; renderAnalysis(); switchView('home'); showToast('Progresso resetado.');
    });

    const gameBoard = $('gameBoard');
    gameBoard?.addEventListener('pointerdown', beginBoardDrag);
    gameBoard?.addEventListener('pointermove', moveBoardDrag);
    gameBoard?.addEventListener('pointerup', endBoardDrag);
    gameBoard?.addEventListener('pointercancel', (event) => {
      if (!boardDrag || event.pointerId !== boardDrag.pointerId) return;
      cleanupBoardDrag();
      selected = null;
      legalForSelected = [];
      renderGame();
    });

    document.addEventListener('keydown', (event) => {
      if (!$('view-analyze')?.classList.contains('active-view')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); goToReviewPly(reviewPly - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); goToReviewPly(reviewPly + 1); }
    });

    bindAuthEvents();
    window.addEventListener('resize', () => requestAnimationFrame(fitGameBoard));
  }

  function setTrainingMode(mode) {
    const safeModes = ['change', 'threat', 'hanging', 'mate', 'surprise', 'development', 'bishop', 'fork', 'afterdev'];
    const safeMode = safeModes.includes(mode) ? mode : 'change';
    trainingState = { mode: safeMode, index: 0, correct: 0, wrong: 0, hints: 0, hintLevel: 0, solved: false, assessment: false, assessmentIndex: 0, assessmentRecorded: false, exerciseMisses: 0 };
    $('exerciseFeedback')?.classList.add('hidden');
    renderTraining();
  }


  function initializeGreeting() {
    const hour = new Date().getHours();
    const period = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const name = String(profile?.name || '').trim();
    $('greeting').textContent = name && name !== 'Jogador' ? `${period}, ${name}.` : `${period}.`;
  }

  async function initialize() {
    ensureEngineBadge();
    bindEvents();
    initializeGreeting();
    refreshProfileUI();
    renderAnalysis();
    renderTraining();
    renderOpenings();
    renderPatterns();

    document.querySelectorAll('[data-game-mode]').forEach((button) => button.classList.toggle('active', button.dataset.gameMode === (profile.gameMode || 'coach')));
    updateEngineStatus({ state: stockfish.state, error: null });

    try {
      await Auth.initialize(handleAuthState, handleSyncStatus);
    } catch (error) {
      console.warn('Login opcional indisponível.', error);
      await handleAuthState({ configured: false, user: null, profile: null });
    }

    if (!authUser && !localStorage.getItem('kiraChessAuthDismissed')) openAuthGate();
  }

  initialize();
})();
