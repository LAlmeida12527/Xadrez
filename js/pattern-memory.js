(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraPatternMemory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STAGES = [
    { id: 'see', label: 'VER', description: 'Reconhecer o desenho com explicação.', minWins: 1 },
    { id: 'understand', label: 'ENTENDER', description: 'Explicar por que o padrão funciona.', minWins: 1 },
    { id: 'find', label: 'ENCONTRAR', description: 'Achar o padrão sabendo qual tema procurar.', minWins: 2 },
    { id: 'recognize', label: 'RECONHECER', description: 'Achar sem o nome do tema.', minWins: 2 },
    { id: 'apply', label: 'APLICAR', description: 'Usar o padrão numa posição jogável.', minWins: 2 },
    { id: 'recall', label: 'RECORDAR', description: 'Reconhecer novamente depois de um intervalo.', minWins: 3 }
  ];

  const PATTERNS = [
    { id: 'loose-piece', mode: 'hanging', title: 'Peça pendurada', icon: '◇', description: 'Atacada e sem defesa suficiente.' },
    { id: 'last-move', mode: 'change', title: 'O que mudou?', icon: '↳', description: 'Ler a consequência da última jogada.' },
    { id: 'fork', mode: 'fork', title: 'Garfo', icon: 'Y', description: 'Uma peça cria dois problemas ao mesmo tempo.' },
    { id: 'bishop-line', mode: 'bishop', title: 'Diagonal de bispo', icon: '♝', description: 'Linhas longas que abrem e fecham.' },
    { id: 'development', mode: 'development', title: 'Desenvolver com propósito', icon: '♞', description: 'Colocar peças em jogo resolvendo mais de uma necessidade.' },
    { id: 'mate-one', mode: 'mate', title: 'Mate em 1', icon: '#', description: 'Xeques, fugas e casas controladas viram reflexo.' },
    { id: 'worst-piece', mode: 'afterdev', title: 'Melhorar a pior peça', icon: '→', description: 'Quando não há tática, melhorar a peça menos útil.' },
    { id: 'unknown-theme', mode: 'surprise', title: 'Sem tema informado', icon: '?', description: 'Reconhecer se existe algo sem receber a resposta no título.' }
  ];

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function nowIso(value) { return value ? new Date(value).toISOString() : new Date().toISOString(); }

  function normalizeState(input) {
    const value = input && typeof input === 'object' ? input : {};
    const stageIndex = clamp(Math.floor(Number(value.stageIndex) || 0), 0, STAGES.length - 1);
    return {
      stageIndex,
      attempts: Math.max(0, Number(value.attempts) || 0),
      correct: Math.max(0, Number(value.correct) || 0),
      noHintCorrect: Math.max(0, Number(value.noHintCorrect) || 0),
      stageWins: Math.max(0, Number(value.stageWins) || 0),
      streak: Math.max(0, Number(value.streak) || 0),
      lapses: Math.max(0, Number(value.lapses) || 0),
      lastSeenAt: value.lastSeenAt || null,
      nextDueAt: value.nextDueAt || null,
      lastResult: ['success', 'assisted', 'miss'].includes(value.lastResult) ? value.lastResult : null
    };
  }

  function stageOf(state) { return STAGES[normalizeState(state).stageIndex]; }

  function mastery(state) {
    const value = normalizeState(state);
    const stageBase = (value.stageIndex / (STAGES.length - 1)) * 78;
    const accuracy = value.attempts ? value.correct / value.attempts : 0;
    const clean = value.correct ? value.noHintCorrect / value.correct : 0;
    return Math.round(clamp(stageBase + (accuracy * 14) + (clean * 8), 0, 100));
  }

  function nextIntervalDays(state, advanced) {
    const value = normalizeState(state);
    if (!advanced) return value.lastResult === 'miss' ? 1 : 2;
    if (value.stageIndex < 3) return 1;
    if (value.stageIndex === 3) return 2;
    if (value.stageIndex === 4) return 4;
    const recallIntervals = [2, 7, 21, 45, 90];
    return recallIntervals[Math.min(value.streak, recallIntervals.length - 1)];
  }

  function recordAttempt(input, result) {
    const state = normalizeState(input);
    const when = new Date(result?.at || Date.now());
    const correct = Boolean(result?.correct);
    const hints = Math.max(0, Number(result?.hints) || 0);
    state.attempts += 1;
    state.lastSeenAt = when.toISOString();

    let advanced = false;
    if (correct) {
      state.correct += 1;
      state.streak += 1;
      if (hints === 0) {
        state.noHintCorrect += 1;
        state.stageWins += 1;
        state.lastResult = 'success';
      } else {
        state.lastResult = 'assisted';
      }
      const stage = STAGES[state.stageIndex];
      if (hints === 0 && state.stageWins >= stage.minWins && state.stageIndex < STAGES.length - 1) {
        state.stageIndex += 1;
        state.stageWins = 0;
        advanced = true;
      }
    } else {
      state.streak = 0;
      state.stageWins = Math.max(0, state.stageWins - 1);
      state.lapses += 1;
      state.lastResult = 'miss';
      if (state.stageIndex >= 4 && state.lapses % 2 === 0) state.stageIndex -= 1;
    }

    const interval = nextIntervalDays(state, advanced);
    state.nextDueAt = new Date(when.getTime() + interval * 86400000).toISOString();
    return state;
  }

  function isDue(state, now) {
    const value = normalizeState(state);
    if (!value.lastSeenAt || !value.nextDueAt) return false;
    return new Date(value.nextDueAt).getTime() <= new Date(now || Date.now()).getTime();
  }

  function patternByMode(mode) { return PATTERNS.find((item) => item.mode === mode) || PATTERNS[0]; }
  function patternById(id) { return PATTERNS.find((item) => item.id === id) || null; }

  function stateForProfile(profile, patternId) {
    return normalizeState(profile?.patternMemory?.[patternId]);
  }

  function catalog(profile, now) {
    return PATTERNS.map((pattern) => {
      const state = stateForProfile(profile, pattern.id);
      const stage = stageOf(state);
      return {
        ...pattern,
        state,
        stage,
        mastery: mastery(state),
        due: isDue(state, now),
        new: state.attempts === 0,
        dueAt: state.nextDueAt,
        learned: state.stageIndex >= STAGES.length - 1 && state.streak >= 2
      };
    }).sort((a, b) => Number(b.due) - Number(a.due) || Number(b.new) - Number(a.new) || a.mastery - b.mastery || a.title.localeCompare(b.title));
  }

  function dueCount(profile, now) { return catalog(profile, now).filter((item) => item.due).length; }

  function stageMessage(state) {
    const value = normalizeState(state);
    const stage = stageOf(value);
    if (!value.attempts) return 'Ainda não testado. Comece vendo o padrão sem pressão.';
    if (stage.id === 'recall') return value.streak >= 2 ? 'Está entrando na memória de longo prazo.' : 'Agora precisa reaparecer em dias diferentes.';
    return `Próxima meta: ${stage.label.toLowerCase()} — ${stage.description}`;
  }

  return {
    STAGES,
    PATTERNS,
    normalizeState,
    stageOf,
    mastery,
    recordAttempt,
    isDue,
    patternByMode,
    patternById,
    stateForProfile,
    catalog,
    dueCount,
    stageMessage,
    nowIso
  };
});
