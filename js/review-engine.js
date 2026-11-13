(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const Analysis = typeof module === 'object' && module.exports ? require('./analysis-engine.js') : root.KiraAnalysisEngine;
  const api = factory(Core, Analysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraReviewEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Analysis) {
  'use strict';

  if (!Core || !Analysis) throw new Error('Dependências da revisão não carregadas.');

  const CLASS_INFO = {
    ok: { label: 'OK', short: 'OK', weight: 0, css: 'good' },
    book: { label: 'TEORIA', short: 'Teoria', weight: 0, css: 'book' },
    best: { label: 'MELHOR', short: 'Melhor', weight: 0, css: 'best' },
    excellent: { label: 'EXCELENTE', short: 'Excelente', weight: 0.1, css: 'excellent' },
    good: { label: 'BOA', short: 'Boa', weight: 0.25, css: 'good' },
    inaccuracy: { label: 'IMPRECISÃO', short: 'Imprecisão', weight: 1, css: 'inaccuracy' },
    mistake: { label: 'ERRO', short: 'Erro', weight: 2.2, css: 'mistake' },
    blunder: { label: 'ERRO GRAVE', short: 'Erro grave', weight: 4, css: 'blunder' }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeState(fen, fallback) {
    try {
      return fen ? Core.parseFEN(fen) : Core.cloneState(fallback || Core.createInitialState());
    } catch (_) {
      return Core.cloneState(fallback || Core.createInitialState());
    }
  }

  function evalState(state) {
    return clamp(Number(Analysis.evaluate(state)) || 0, -12, 12);
  }

  function lossForMover(beforeEval, afterEval, color) {
    const raw = color === 'b' ? afterEval - beforeEval : beforeEval - afterEval;
    return Math.max(0, Number(raw) || 0);
  }

  function inferClass(loss, ply) {
    if (loss >= 3) return 'blunder';
    if (loss >= 1.45) return 'mistake';
    if (loss >= 0.62) return 'inaccuracy';
    if (ply <= 8 && loss < 0.18) return 'book';
    if (loss <= 0.07) return 'best';
    if (loss <= 0.22) return 'excellent';
    return 'good';
  }

  function normalizeStoredClass(value) {
    if (value === 'blunder' || value === 'mistake' || value === 'inaccuracy') return value;
    return null;
  }

  function describeMove(step, userColor) {
    if (!step || step.ply === 0) return {
      title: 'Vamos revisar.',
      text: 'Use as setas para avançar. O último lance fica marcado no tabuleiro e eu vou parar nos momentos que realmente mudaram a posição.'
    };

    const info = CLASS_INFO[step.classification] || CLASS_INFO.good;
    const isUser = step.color === userColor;
    const subject = isUser ? 'Seu lance' : 'O lance adversário';
    const lossText = step.loss >= 0.25 ? ` A posição mudou cerca de ${step.loss.toFixed(1)} ponto${step.loss >= 1.95 ? 's' : ''} contra quem jogou.` : '';
    const concept = Array.isArray(step.concepts) && step.concepts.length ? ` Tema principal: ${step.concepts[0]}.` : '';
    const cause = step.likelyCause ? ` Provável causa: ${step.likelyCause}.` : '';

    const messages = {
      book: `${subject} segue uma ideia de abertura saudável. Mais importante que decorar é saber qual peça foi desenvolvida e qual problema o lance resolveu.`,
      best: `${subject} preservou a melhor avaliação encontrada pela revisão local. Procure entender por que as alternativas eram menos precisas.`,
      excellent: `${subject} foi muito preciso e manteve a posição sob controle.`,
      good: `${subject} é jogável e mantém o plano, embora possa existir uma alternativa mais limpa.`,
      inaccuracy: `${subject} não perde a partida, mas deixou escapar uma pequena melhoria.${lossText}`,
      mistake: `${subject} criou um problema concreto.${lossText} Antes de mover, a pergunta útil era: “qual é a resposta mais forte do outro lado?”.`,
      blunder: `${subject} mudou bastante a posição.${lossText} Vale voltar uma casa e tentar de novo antes de revelar a alternativa.`
    };

    return {
      title: isUser ? `${info.short}: ${step.notation || step.uci}` : `${info.short} do adversário: ${step.notation || step.uci}`,
      text: `${messages[step.classification] || messages.good}${cause}${concept}`
    };
  }

  function buildReview(archiveItem, explicitUserColor) {
    const item = archiveItem && typeof archiveItem === 'object' ? archiveItem : {};
    const moves = Array.isArray(item.moves) ? item.moves : [];
    const userColor = explicitUserColor === 'b' || explicitUserColor === 'w'
      ? explicitUserColor
      : (item.analysis?.userColor === 'b' ? 'b' : 'w');

    let running = moves[0]?.fenBefore ? safeState(moves[0].fenBefore) : Core.createInitialState();
    const initialEval = evalState(running);
    const positions = [{ ply: 0, fen: Core.toFEN(running), eval: initialEval, lastMove: null }];
    const steps = [];
    const verifiedMoves = new Map((item.analysis?.phaseEngine?.moves || []).map((move) => [move.ply, move]));

    moves.forEach((entry, index) => {
      const ply = index + 1;
      const before = entry.fenBefore ? safeState(entry.fenBefore, running) : Core.cloneState(running);
      const beforeEval = evalState(before);
      let move = entry.uci ? Core.moveFromUCI(before, entry.uci) : null;
      let after;
      if (entry.fenAfter) after = safeState(entry.fenAfter, before);
      else if (move) after = Core.makeMoveCopy(before, move);
      else after = Core.cloneState(before);

      if (!move && entry.uci) move = Core.moveFromUCI(before, entry.uci);
      const color = entry.color === 'b' ? 'b' : 'w';
      const afterEval = evalState(after);
      let loss = lossForMover(beforeEval, afterEval, color);
      const stored = color === userColor ? normalizeStoredClass(entry.classification) : null;
      if (stored && Number(entry.loss) > loss) loss = Number(entry.loss) || loss;
      const verified = color === userColor ? verifiedMoves.get(ply) : null;
      if (verified) loss = verified.loss * 10;
      const classification = verified ? (verified.same ? 'best' : verified.classification) : stored || inferClass(loss, ply);
      const lastMove = move ? {
        fromRow: move.fromRow, fromCol: move.fromCol, toRow: move.toRow, toCol: move.toCol
      } : null;
      after.lastMove = lastMove;

      const step = {
        ply,
        index,
        color,
        notation: entry.notation || entry.uci || `Lance ${ply}`,
        uci: entry.uci || '',
        fenBefore: Core.toFEN(before),
        fenAfter: Core.toFEN(after),
        beforeEval,
        afterEval,
        loss,
        classification,
        verified,
        likelyCause: entry.likelyCause || null,
        concepts: Array.isArray(entry.concepts) ? entry.concepts : [],
        thinkingMs: entry.thinkingMs == null ? null : Number(entry.thinkingMs),
        lastMove,
        key: ['inaccuracy', 'mistake', 'blunder'].includes(classification) || Math.abs(afterEval - beforeEval) >= 0.85
      };
      const explanation = describeMove(step, userColor);
      step.title = explanation.title;
      step.coachText = verified
        ? [verified.theme, verified.same ? 'O Stockfish também escolheu este lance.' : 'Lance comparado com a melhor alternativa encontrada pelo Stockfish.'].filter(Boolean).join('. ')
        : explanation.text;
      steps.push(step);
      positions.push({ ply, fen: step.fenAfter, eval: afterEval, lastMove });
      running = after;
    });

    const userSteps = steps.filter((step) => step.color === userColor);
    const mistakes = userSteps.filter((step) => step.classification === 'mistake').length;
    const blunders = userSteps.filter((step) => step.classification === 'blunder').length;
    const inaccuracies = userSteps.filter((step) => step.classification === 'inaccuracy').length;
    const meanLoss = userSteps.length ? userSteps.reduce((sum, step) => sum + Math.min(6, step.loss), 0) / userSteps.length : 0;
    const weightedIssues = userSteps.reduce((sum, step) => sum + (CLASS_INFO[step.classification]?.weight || 0), 0) / Math.max(1, userSteps.length);
    const accuracy = verifiedMoves.size
      ? null
      : Math.round(clamp(100 - (meanLoss * 10.5) - (weightedIssues * 3.2), 1, 100));
    const keyMoments = steps.filter((step) => step.key).map((step) => step.ply);

    return {
      archiveId: item.id || null,
      result: item.result || '—',
      reason: item.reason || null,
      userColor,
      accuracy,
      mistakes,
      blunders,
      inaccuracies,
      moves: steps,
      positions,
      keyMoments,
      graph: positions.map((position) => ({ ply: position.ply, eval: position.eval }))
    };
  }

  function bestMove(state) {
    const legal = Core.generateLegalMoves(state, state.turn);
    if (!legal.length) return null;
    const mover = state.turn;
    const perspective = mover === 'w' ? 1 : -1;
    let best = null;

    for (const move of legal) {
      const after = Core.makeMoveCopy(state, move);
      const status = Core.gameStatus(after, null);
      let score;
      if (status.ended && status.reason === 'checkmate') score = 1000;
      else {
        const base = evalState(after) * perspective;
        const replies = Core.generateLegalMoves(after, after.turn);
        if (!replies.length) score = base;
        else {
          let worst = Infinity;
          for (const reply of replies) {
            const response = Core.makeMoveCopy(after, reply);
            const responseStatus = Core.gameStatus(response, null);
            let value = evalState(response) * perspective;
            if (responseStatus.ended && responseStatus.reason === 'checkmate') value = -1000;
            if (value < worst) worst = value;
          }
          score = (base * 0.35) + (worst * 0.65);
        }
      }
      if (!best || score > best.score) {
        const san = Core.sanNotation(state, move, after);
        best = { move, uci: Core.moveToUCI(move), san, score, eval: evalState(after) };
      }
    }
    return best;
  }

  function evaluateRetry(state, move, best) {
    if (!move) return { verdict: 'invalid', text: 'Escolha um lance legal.' };
    const after = Core.makeMoveCopy(state, move);
    const beforeEval = evalState(state);
    const afterEval = evalState(after);
    const loss = lossForMover(beforeEval, afterEval, state.turn);
    const classification = inferClass(loss, 99);
    const uci = Core.moveToUCI(move);
    if (best && uci === best.uci) return { verdict: 'best', classification: 'best', text: `Isso. ${best.san} é a alternativa principal encontrada aqui.`, loss };
    if (loss < 0.45) return { verdict: 'good', classification: loss < 0.12 ? 'excellent' : 'good', text: 'Boa recuperação. Esse lance mantém a posição saudável mesmo sem ser a primeira escolha.', loss };
    if (classification === 'inaccuracy') return { verdict: 'close', classification, text: 'Melhor que o erro original, mas ainda existe uma resposta mais precisa.', loss };
    return { verdict: 'bad', classification, text: 'Ainda existe um problema concreto nessa tentativa. Procure primeiro xeques, capturas e ameaças adversárias.', loss };
  }

  return { CLASS_INFO, buildReview, bestMove, evaluateRetry, describeMove, inferClass };
});
