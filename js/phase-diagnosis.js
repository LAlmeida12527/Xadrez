(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const api = factory(Core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraPhaseDiagnosis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const PHASES = {
    opening: { name: 'Abertura e desenvolvimento', practice: 'Pratique sair da abertura com as peças menores em jogo e o rei seguro. Use o lance marcado para testar uma alternativa.' },
    middlegame: { name: 'Meio-jogo', practice: 'Antes de escolher um plano, procure a ameaça do adversário e calcule a resposta mais forte ao seu lance.' },
    endgame: { name: 'Final', practice: 'Rejogue o final a partir do lance marcado. Compare a atividade dos reis e o avanço dos peões nas duas continuações.' }
  };
  const PHASE_IDS = Object.keys(PHASES);
  const MATERIAL = { n: 3, b: 3, r: 5, q: 9 };
  const PIECES = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };
  const ISSUES = { inaccuracy: 1, mistake: 2, blunder: 3 };
  const KNOWN_THEMES = {
    'não verificou ameaça de mate em 1': 'Mate em um permitido',
    'não verificou a resposta adversária imediata': 'Resposta imediata do adversário',
    'deixou material vulnerável': 'Material vulnerável',
    'não verificou capturas disponíveis': 'Capturas não vistas'
  };

  function phaseOf(state) {
    const material = state.board.flat().reduce((sum, piece) => sum + (MATERIAL[Core.typeOf(piece)] || 0), 0);
    const hasQueen = state.board.some((rank) => rank.includes('Q') || rank.includes('q'));
    if (material <= 12 || (!hasQueen && material <= 20)) return 'endgame';
    const undeveloped = [1, 2, 5, 6].filter((col) => 'NBBN'.includes(state.board[7][col] || '-')).length
      + [1, 2, 5, 6].filter((col) => 'nbbn'.includes(state.board[0][col] || '-')).length;
    return state.fullmove <= 12 && (state.fullmove < 7 || undeveloped >= 3) ? 'opening' : 'middlegame';
  }

  function positions(game) {
    const side = game.analysis?.userColor === 'b' ? 'b' : 'w';
    let phaseIndex = 0;
    return (game.moves || []).flatMap((move, index) => {
      if (!move.fenBefore || !move.uci) return [];
      let state;
      try {
        state = Core.parseFEN(move.fenBefore);
      } catch (_) {
        return [];
      }
      phaseIndex = Math.max(phaseIndex, PHASE_IDS.indexOf(phaseOf(state)));
      if (move.color !== side || state.turn !== side) return [];
      return [{ ...move, phase: PHASE_IDS[phaseIndex], ply: index + 1, fullmove: state.fullmove, state }];
    });
  }

  function describeMove(state, uci) {
    const move = Core.moveFromUCI(state, uci);
    if (!move) return '';
    if (move.castle) return move.toCol === 6 ? 'Roque curto' : 'Roque longo';
    const piece = PIECES[Core.typeOf(move.piece)];
    const target = Core.squareName(move.toRow, move.toCol);
    const promotion = move.promotion ? ` e promove a ${PIECES[move.promotion]}` : '';
    return `${piece[0].toUpperCase()}${piece.slice(1)} ${move.capture ? 'captura em' : 'vai para'} ${target}${promotion}`;
  }

  function outcome(score) {
    if (score.scoreType === 'mate') return score.score > 0 ? 1 : 0;
    return 1 / (1 + Math.exp(-score.score / 170));
  }

  function verifiedMove(position, result) {
    const loss = Math.max(0, outcome(result.best) - outcome(result.playedLine));
    const classification = loss >= 0.20 ? 'blunder' : loss >= 0.10 ? 'mistake' : loss >= 0.05 ? 'inaccuracy' : 'ok';
    const missedMate = result.best.scoreType === 'mate' && result.best.score > 0
      && !(result.playedLine.scoreType === 'mate' && result.playedLine.score > 0);
    const allowedMate = result.playedLine.scoreType === 'mate' && result.playedLine.score < 0;
    const reply = result.playedLine.pv?.[1] || '';
    const played = reply ? Core.moveFromUCI(position.state, position.uci) : null;
    const after = played ? Core.makeMoveCopy(position.state, played) : null;
    const replyMove = after ? Core.moveFromUCI(after, reply) : null;
    let theme = null;
    if (missedMate) theme = 'Mate forçado não aproveitado';
    else if (allowedMate && ISSUES[classification]) theme = 'Mate forçado permitido';
    else if (replyMove?.capture && ISSUES[classification]) theme = 'Captura na resposta adversária';
    return { ply: position.ply, classification, loss, same: result.same, best: result.bestmove, reply, theme };
  }

  function summarize(games, { history = false } = {}) {
    const eligible = history ? games.filter((game) => (
      game.reason !== 'assessment-complete' && (!game.source || ['imported', 'standard'].includes(game.source))
    )) : games;
    const imported = eligible.filter((game) => game.source === 'imported' || game.reason === 'imported');
    const pool = imported.length ? imported : eligible;
    const useEngine = pool.some((game) => game.analysis?.phaseEngine?.moves?.length);
    const seen = new Set();
    const phases = PHASE_IDS.map((id) => ({ id, ...PHASES[id], moves: 0, games: 0, inaccuracies: 0, mistakes: 0, blunders: 0, examples: [], pressure: 0, themes: {} }));

    for (const game of pool) {
      const decisions = positions(game);
      const key = decisions.map((move) => `${move.fenBefore}|${move.uci}`).join('\n');
      if (!key || seen.has(key)) continue;
      const engineMoves = new Map((game.analysis?.phaseEngine?.moves || []).map((move) => [move.ply, move]));
      if (useEngine && !engineMoves.size) continue;
      seen.add(key);
      const counted = new Set();
      for (const move of decisions) {
        const verified = engineMoves.get(move.ply);
        if (useEngine && !verified) continue;
        const phase = phases[PHASE_IDS.indexOf(move.phase)];
        const classification = verified?.classification || move.classification;
        const severity = ISSUES[classification] || 0;
        const theme = verified?.theme || (!useEngine ? KNOWN_THEMES[move.likelyCause] : null);
        phase.moves += 1;
        counted.add(phase);
        if (classification === 'blunder') phase.blunders += 1;
        if (classification === 'mistake') phase.mistakes += 1;
        if (classification === 'inaccuracy') phase.inaccuracies += 1;
        phase.pressure += severity;
        if (theme && (severity || verified?.theme)) phase.themes[theme] = (phase.themes[theme] || 0) + 1;
        if (!severity && !verified?.theme) continue;
        const played = Core.moveFromUCI(move.state, move.uci);
        const after = played && verified?.reply ? Core.makeMoveCopy(move.state, played) : null;
        phase.examples.push({
          archiveId: game.id, ply: move.ply, number: `${move.fullmove}${move.color === 'b' ? '...' : '.'}`,
          move: describeMove(move.state, move.uci) || move.notation, classification, severity,
          loss: verified?.loss ?? move.loss ?? 0, theme,
          best: verified?.best ? describeMove(move.state, verified.best) : '',
          reply: after ? describeMove(after, verified.reply) : ''
        });
      }
      counted.forEach((phase) => { phase.games += 1; });
    }

    for (const phase of phases) {
      phase.pressure = phase.moves ? phase.pressure / phase.moves : 0;
      phase.examples.sort((a, b) => b.severity - a.severity || b.loss - a.loss);
      phase.examples = phase.examples.slice(0, 2);
      phase.theme = Object.entries(phase.themes).sort((a, b) => b[1] - a[1])[0] || null;
    }
    const comparable = phases.filter((phase) => phase.moves >= (history ? 8 : 3) && phase.games >= (history ? 2 : 1));
    comparable.sort((a, b) => b.pressure - a.pressure);
    const [first, second] = comparable;
    const weak = first && second && first.pressure >= 0.3 && first.pressure - second.pressure >= 0.12 ? first : null;
    return { phases, weak, smallSample: seen.size < 2 || phases.filter((p) => p.moves >= 8).length < 2, games: seen.size, source: useEngine ? 'stockfish' : 'local', human: imported.length > 0 };
  }

  return { PHASES, phaseOf, positions, describeMove, verifiedMove, summarize };
});
