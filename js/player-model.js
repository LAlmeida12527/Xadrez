(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const Analysis = typeof module === 'object' && module.exports ? require('./analysis-engine.js') : root.KiraAnalysisEngine;
  const api = factory(Core, Analysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraPlayerModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Analysis) {
  'use strict';

  if (!Core || !Analysis) throw new Error('Dependências do modelo do jogador não carregadas.');

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function describeStyle(scores) {
    const safe = scores || {};
    const ranked = Object.entries({
      active: Number(safe.active) || 0,
      tactical: Number(safe.tactical) || 0,
      solid: Number(safe.solid) || 0,
      positional: Number(safe.positional) || 0
    }).sort((a, b) => b[1] - a[1]);
    const lead = ranked[0]?.[0] || 'classical';
    const bishopAffinity = (Number(safe.bishopAffinity) || 0) >= 1.0;

    if (bishopAffinity && ((Number(safe.active) || 0) >= 0.7 || (Number(safe.classical) || 0) >= 1.4)) {
      return { label: 'Ativo com bispos', description: 'Você tende a gostar de desenvolver rápido e apontar os bispos para casas ativas.', bishopAffinity };
    }
    if (lead === 'active') return { label: 'Ativo e direto', description: 'Você procura iniciativa e prefere posições em que as peças entram no jogo rapidamente.', bishopAffinity };
    if (lead === 'tactical') return { label: 'Tático', description: 'Você se sente atraído por capturas, ameaças e posições com decisões concretas.', bishopAffinity };
    if (lead === 'solid') return { label: 'Sólido', description: 'Você tende a valorizar segurança, desenvolvimento e posições com menos risco imediato.', bishopAffinity };
    if (lead === 'positional') return { label: 'Posicional', description: 'Você tende a melhorar as peças e construir a posição antes de buscar confronto direto.', bishopAffinity };
    return { label: 'Clássico em formação', description: 'Você ainda está formando um estilo. Por enquanto, faz sentido aprender posições abertas e princípios claros.', bishopAffinity };
  }

  function userEntries(history, color) {
    const side = color === 'b' ? 'b' : 'w';
    return (Array.isArray(history) ? history : []).filter((entry) => entry.color === side);
  }

  function styleFromHistory(history, color) {
    const entries = userEntries(history, color);
    const early = entries.slice(0, 10);
    const scores = {
      active: 0,
      tactical: 0,
      solid: 0,
      positional: 0,
      bishopAffinity: 0,
      classical: 0
    };

    early.forEach((entry, index) => {
      const move = entry.move || {};
      const type = Core.typeOf(move.piece || '');
      const destination = Number.isInteger(move.toRow) && Number.isInteger(move.toCol)
        ? Core.squareName(move.toRow, move.toCol)
        : '';
      const notation = String(entry.notation || '');

      if (move.capture) {
        scores.active += 0.55;
        scores.tactical += 0.75;
      }
      if (notation.includes('+') || notation.includes('#')) {
        scores.active += 0.7;
        scores.tactical += 0.9;
      }
      if (move.castle) {
        scores.solid += 1.25;
        scores.classical += 0.8;
      }
      if (['n', 'b'].includes(type) && index <= 5) {
        scores.classical += 0.7;
        scores.solid += 0.25;
      }
      if (type === 'b') {
        scores.bishopAffinity += index <= 5 ? 1.15 : 0.55;
        if (['c4', 'b5', 'f4', 'g2', 'b2'].includes(destination)) scores.active += 0.35;
      }
      if (['e4', 'd4', 'e5', 'd5'].includes(destination)) {
        scores.classical += 0.45;
        scores.active += 0.2;
      }
      if (type === 'q' && index <= 4) {
        scores.active += 0.4;
        scores.tactical += 0.3;
        scores.solid -= 0.25;
      }
      if (!move.capture && ['n', 'b', 'r'].includes(type) && index >= 5) scores.positional += 0.28;
    });

    const totalMoves = Math.max(1, entries.length);
    const avgThinking = entries.reduce((sum, entry) => sum + (Number(entry.thinkingMs) || 0), 0) / totalMoves;
    if (avgThinking >= 9000) {
      scores.solid += 0.45;
      scores.positional += 0.25;
    } else if (avgThinking > 0 && avgThinking <= 3500) {
      scores.active += 0.25;
    }

    Object.keys(scores).forEach((key) => { scores[key] = Math.max(0, Number(scores[key].toFixed(2))); });

    const described = describeStyle(scores);
    return { ...described, scores, averageThinkingMs: Math.round(avgThinking) };
  }

  function estimateLevel(history, summary) {
    const whiteMoves = userEntries(history, 'w').length;
    const blackMoves = userEntries(history, 'b').length;
    const moves = Math.max(1, Number(summary?.userMoves) || Math.max(whiteMoves, blackMoves));
    const blunders = Number(summary?.blunders) || 0;
    const mistakes = Number(summary?.mistakes) || 0;
    const inaccuracies = Number(summary?.inaccuracies) || 0;
    const exposed = Number(summary?.exposedMoves) || 0;
    const weightedErrors = (blunders * 2.5) + (mistakes * 1.25) + (inaccuracies * 0.45) + (exposed * 0.35);
    const rate = weightedErrors / moves;

    // Uma partida não é um Elo. A primeira estimativa deve ser ampla e conservadora,
    // especialmente quando a partida termina cedo ou o detector local viu poucos erros.
    let center = 300;
    if (rate <= 0.20) center = 650;
    else if (rate <= 0.38) center = 525;
    else if (rate <= 0.60) center = 400;
    else if (rate <= 0.90) center = 300;
    else if (rate <= 1.25) center = 225;
    else center = 175;

    if (moves < 6) center = Math.min(center, 350);
    else if (moves < 10) center = Math.min(center, 450);
    else if (moves < 15) center = Math.min(center, 550);

    const spread = moves >= 20 ? 300 : moves >= 12 ? 350 : 400;
    let low = clamp(Math.round((center - spread) / 25) * 25, 100, 1800);
    let high = clamp(Math.round((center + spread) / 25) * 25, 250, 2000);
    center = Math.round(((low + high) / 2) / 25) * 25;

    const label = center < 250 ? 'Iniciante inicial'
      : center < 450 ? 'Iniciante'
        : center < 700 ? 'Aprendiz'
          : center < 1000 ? 'Intermediário inicial'
            : 'Em calibração avançada';

    return {
      low,
      high,
      center,
      label,
      confidence: moves >= 20 ? 'baixa, mas útil' : 'baixa',
      errorRate: Number(rate.toFixed(2)),
      userMoves: moves,
      needsMoreGames: true
    };
  }

  function weaknessFromSummary(summary) {
    const concepts = Array.isArray(summary?.topConcepts) ? summary.topConcepts : [];
    const first = concepts[0]?.name || null;
    if (first === 'peça exposta' || first === 'peça pendurada') return 'hanging';
    if (first === 'mate em 1 permitido') return 'mate';
    if (first === 'dama cedo') return 'development';
    if ((summary?.exposedMoves || 0) > 0) return 'change';
    return 'change';
  }

  function assessGame(history, userColor, summary) {
    const style = styleFromHistory(history, userColor);
    const estimate = estimateLevel(history, summary);
    return {
      completed: true,
      completedAt: new Date().toISOString(),
      games: 1,
      estimate,
      style,
      primaryWeakness: weaknessFromSummary(summary)
    };
  }

  function mergeAssessment(previous, nextAssessment) {
    if (!previous?.completed) return nextAssessment;
    const games = Math.max(1, Number(previous.games) || 1) + 1;
    const previousCenter = Number(previous.estimate?.center) || nextAssessment.estimate.center;
    const nextCenter = Number(nextAssessment.estimate?.center) || previousCenter;
    const center = Math.round(((previousCenter * (games - 1)) + nextCenter) / games / 25) * 25;
    const spread = games >= 7 ? 150 : games >= 4 ? 225 : games >= 2 ? 300 : 400;
    const low = clamp(center - spread, 100, 2000);
    const high = clamp(center + spread, 150, 2200);
    const label = center < 250 ? 'Iniciante inicial'
      : center < 450 ? 'Iniciante'
        : center < 700 ? 'Aprendiz'
          : center < 1000 ? 'Intermediário inicial'
            : 'Em calibração avançada';
    const previousScores = previous.style?.scores || {};
    const nextScores = nextAssessment.style?.scores || {};
    const keys = new Set([...Object.keys(previousScores), ...Object.keys(nextScores)]);
    const mergedScores = {};
    for (const key of keys) {
      const oldValue = Number(previousScores[key]) || 0;
      const newValue = Number(nextScores[key]) || 0;
      mergedScores[key] = Number((((oldValue * (games - 1)) + newValue) / games).toFixed(2));
    }
    const styleDescription = describeStyle(mergedScores);
    const previousThinking = Number(previous.style?.averageThinkingMs) || 0;
    const nextThinking = Number(nextAssessment.style?.averageThinkingMs) || 0;
    const averageThinkingMs = Math.round(((previousThinking * (games - 1)) + nextThinking) / games);

    return {
      ...nextAssessment,
      games,
      style: { ...styleDescription, scores: mergedScores, averageThinkingMs },
      estimate: {
        ...nextAssessment.estimate,
        center,
        low,
        high,
        label,
        needsMoreGames: games < 7,
        confidence: games >= 7 ? 'moderada' : games >= 4 ? 'crescente' : 'baixa'
      }
    };
  }

  return { describeStyle, styleFromHistory, estimateLevel, weaknessFromSummary, assessGame, mergeAssessment };
});
