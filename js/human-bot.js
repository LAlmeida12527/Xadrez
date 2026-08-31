(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const Analysis = typeof module === 'object' && module.exports ? require('./analysis-engine.js') : root.KiraAnalysisEngine;
  const api = factory(Core, Analysis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraHumanBot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Analysis) {
  'use strict';

  if (!Core || !Analysis) throw new Error('Dependências do bot não carregadas.');

  // Elo aqui é uma faixa de comportamento, não um rating oficial. Todos os níveis
  // usam o mesmo motor heurístico; os mais fortes escolhem de um conjunto menor,
  // verificam melhor a resposta imediata e toleram menos lances ruins.
  const LEVELS = {
    150:  { pool: 16, temperature: 2.60, replyDepth: 0, tacticalAwareness: 0.16, blunderTolerance: 0.95 },
    300:  { pool: 12, temperature: 1.95, replyDepth: 0, tacticalAwareness: 0.28, blunderTolerance: 0.82 },
    400:  { pool: 10, temperature: 1.55, replyDepth: 1, tacticalAwareness: 0.38, blunderTolerance: 0.68 },
    500:  { pool: 8,  temperature: 1.22, replyDepth: 1, tacticalAwareness: 0.50, blunderTolerance: 0.54 },
    700:  { pool: 6,  temperature: 0.86, replyDepth: 1, tacticalAwareness: 0.66, blunderTolerance: 0.34 },
    900:  { pool: 5,  temperature: 0.62, replyDepth: 1, tacticalAwareness: 0.76, blunderTolerance: 0.22 },
    1100: { pool: 4,  temperature: 0.46, replyDepth: 1, tacticalAwareness: 0.84, blunderTolerance: 0.13 },
    1300: { pool: 3,  temperature: 0.34, replyDepth: 1, tacticalAwareness: 0.91, blunderTolerance: 0.07 },
    1500: { pool: 2,  temperature: 0.25, replyDepth: 1, tacticalAwareness: 0.96, blunderTolerance: 0.03 }
  };

  function naturalness(state, move) {
    let score = 0;
    const type = Core.typeOf(move.piece);
    const square = Core.squareName(move.toRow, move.toCol);

    if (move.capture) score += Analysis.pieceValue(move.capture) * 0.42;
    if (move.castle) score += 0.32;
    if (['d4', 'e4', 'd5', 'e5'].includes(square)) score += 0.10;

    if (['n', 'b'].includes(type)) {
      const homeRow = Core.colorOf(move.piece) === 'w' ? 7 : 0;
      if (move.fromRow === homeRow) score += 0.12;
    }

    if (type === 'q' && state.fullmove <= 4) score -= 0.22;
    if (type === 'k' && !move.castle && state.fullmove <= 8) score -= 0.08;

    const after = Core.makeMoveCopy(state, move);
    const risk = Analysis.moveRisk(state, move);
    if (risk) score -= risk.severity * 0.34;

    if (Core.inCheck(after, after.turn)) score += 0.16;
    return score;
  }

  function focusBonus(state, move, focus) {
    if (!focus) return 0;
    const after = Core.makeMoveCopy(state, move);
    const opponent = after.turn;
    let bonus = 0;

    if (focus === 'hanging' || focus === 'change' || focus === 'threat') {
      const vulnerable = Analysis.hangingPieces(after, opponent);
      if (vulnerable.length) {
        const maxValue = Math.max(...vulnerable.map((item) => item.value || 0));
        bonus += Math.min(0.62, (vulnerable.length * 0.10) + (maxValue * 0.055));
      }
    }

    if (focus === 'mate') {
      if (Core.inCheck(after, opponent)) bonus += 0.26;
      const king = Core.kingPosition(after, opponent);
      if (king) {
        const mover = state.turn;
        let pressure = 0;
        for (let row = Math.max(0, king.row - 1); row <= Math.min(7, king.row + 1); row += 1) {
          for (let col = Math.max(0, king.col - 1); col <= Math.min(7, king.col + 1); col += 1) {
            pressure += Core.attackersOf(after, row, col, mover).length;
          }
        }
        bonus += Math.min(0.30, pressure * 0.025);
      }
    }

    return bonus;
  }

  function scoreMove(state, move, cfg, focus) {
    const mover = state.turn === 'b' ? 'b' : 'w';
    const perspective = mover === 'w' ? 1 : -1;
    const after = Core.makeMoveCopy(state, move);
    const baseEval = Analysis.evaluate(after) * perspective;
    let score = baseEval;
    score += naturalness(state, move);
    score += focusBonus(state, move, focus);

    if (cfg.replyDepth > 0) {
      const replies = Core.generateLegalMoves(after, after.turn);
      if (replies.length) {
        const worstReply = Math.min(...replies.map((reply) => (
          Analysis.evaluate(Core.makeMoveCopy(after, reply)) * perspective
        )));
        score += Math.min(0, worstReply - baseEval) * 0.55;
      }
    }

    if (move.capture && Math.random() < cfg.tacticalAwareness) score += Analysis.pieceValue(move.capture) * 0.30;
    return score;
  }

  function weightedChoice(items, cfg) {
    const best = items[0].score;
    const weights = items.map((item, index) => {
      const relative = Math.exp((item.score - best) / cfg.temperature);
      const rankPenalty = 1 / (1 + index * 0.12);
      return Math.max(0.0001, relative * rankPenalty);
    });

    let cursor = Math.random() * weights.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < items.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) return items[index].move;
    }
    return items[0].move;
  }

  function chooseMove(state, requestedLevel, options) {
    const level = Number(requestedLevel) || 500;
    const available = Object.keys(LEVELS).map(Number).sort((a, b) => a - b);
    const resolved = available.reduce((best, candidate) => (
      Math.abs(candidate - level) < Math.abs(best - level) ? candidate : best
    ), available[0]);
    const cfg = LEVELS[resolved];
    const focus = options?.focus || null;
    const legal = Core.generateLegalMoves(state, state.turn);
    if (!legal.length) return null;

    const scored = legal
      .map((move) => ({ move, score: scoreMove(state, move, cfg, focus) + (Math.random() - 0.5) * 0.03 }))
      .sort((a, b) => b.score - a.score);

    const pool = scored.slice(0, Math.min(cfg.pool, scored.length));

    if (Math.random() < cfg.blunderTolerance * 0.18 && pool.length >= 4) {
      const lowerStart = Math.floor(pool.length * 0.45);
      const lower = pool.slice(lowerStart);
      if (lower.length) return lower[Math.floor(Math.random() * lower.length)].move;
    }

    return weightedChoice(pool, cfg);
  }

  return { LEVELS, focusBonus, chooseMove };
});
