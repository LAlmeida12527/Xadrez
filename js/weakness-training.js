(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./chess-core.js') : root.KiraChessCore,
    node ? require('./phase-diagnosis.js') : root.KiraPhaseDiagnosis,
    node ? require('./review-engine.js') : root.KiraReviewEngine);
  if (node) module.exports = api;
  else root.KiraWeaknessTraining = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Diagnosis, Review) {
  'use strict';
  const names = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };
  const article = (type) => ['q', 'r'].includes(type) ? 'a' : 'o';
  function words(state, uci, player) {
    const move = Core.moveFromUCI(state, uci);
    if (!move) return '';
    const san = Core.sanNotation(state, move, Core.makeMoveCopy(state, move));
    if (move.castle) return `${Diagnosis.describeMove(state, uci)} (${san})`;
    const type = Core.typeOf(move.piece);
    const victim = Core.typeOf(move.capture);
    const target = Core.squareName(move.toRow, move.toCol);
    const ownVictim = player && move.capture && Core.colorOf(move.capture) === player;
    const owner = ownVictim ? (['q', 'r'].includes(victim) ? 'sua' : 'seu') : article(victim);
    const after = Core.makeMoveCopy(state, move);
    const check = Core.gameStatus(after).reason === 'checkmate' ? ' e dar xeque-mate' : Core.inCheck(after, after.turn) ? ', com xeque' : '';
    return `${article(type)} ${names[type]} pode ${move.capture ? `capturar ${owner} ${names[victim]}` : 'ir para'} ${move.capture ? 'em ' : ''}${target}${move.promotion ? ` e promover a ${names[move.promotion]}` : ''}${check} (${san})`;
  }
  function pattern(state, reply, theme) {
    const move = reply && Core.moveFromUCI(state, reply);
    if (theme === 'Mate forçado não aproveitado') return 'mate-missed';
    if (move?.capture) return `capture:${Core.typeOf(move.piece)}:${Core.typeOf(move.capture)}`;
    return null;
  }
  // Each companion has a legal defensive move and a concrete matching threat.
  const companions = [
    { id: 'knight-queen', key: 'capture:n:q', fen: '4k3/8/5n2/7Q/8/8/8/4K3 w - - 0 1', best: 'h5h3', reply: 'f6h5', probe: 'e1d1' },
    { id: 'bishop-rook', key: 'capture:b:r', fen: '4k3/6b1/8/8/8/8/8/R3K3 w - - 0 1', best: 'a1a2', reply: 'g7a1', probe: 'e1d1' },
    { id: 'mate-net', key: 'mate-missed', fen: '7k/5K2/8/8/8/8/8/6R1 w - - 0 1', best: 'g1h1', probe: 'g1g2', reply: 'h8h7' }
  ];
  function build(games, preferred, seenGames = games, seenExercises = []) {
    const report = Diagnosis.summarize(games);
    const phase = report.weak || report.phases.slice().sort((a, b) => b.pressure - a.pressure).find((p) => p.examples.length);
    const examples = preferred ? [preferred] : phase?.examples || [];
    for (const example of examples) {
      const game = games.find((g) => g.id === example.archiveId);
      const position = game && Diagnosis.positions(game).find((p) => p.ply === example.ply);
      if (!position) continue;
      const verified = game.analysis?.phaseEngine?.moves?.find((m) => m.ply === position.ply);
      const best = verified?.best || Review.bestMove(position.state)?.uci;
      if (!best || best === position.uci || !Core.moveFromUCI(position.state, best)) continue;
      const played = Core.moveFromUCI(position.state, position.uci);
      const after = Core.makeMoveCopy(position.state, played);
      const reply = verified?.reply && Core.moveFromUCI(after, verified.reply) ? verified.reply : null;
      const key = pattern(after, reply, verified?.theme);
      const first = { id: `${game.id}:${position.ply}`, archiveId: game.id, ply: position.ply, fen: position.fenBefore,
        best, probe: position.uci, reply, key, source: verified ? 'Stockfish' : 'estimativa local', phase: Diagnosis.PHASES?.[position.phase]?.name || report.phases.find((p) => p.id === position.phase).name };
      const seen = new Set(seenGames.flatMap((g) => (g.moves || []).map((m) => (m.fenBefore || '').split(' ').slice(0, 4).join(' '))));
      const companion = companions.find((c) => c.key === key && !seenExercises.includes(c.id) && !seen.has(c.fen.split(' ').slice(0, 4).join(' ')));
      return { items: [first, ...(companion ? [{ ...companion, source: 'posição didática', phase: first.phase }] : [])], index: 0, hint: 0, solved: false, display: 'start', message: '' };
    }
    return null;
  }
  function context(item) {
    const state = Core.parseFEN(item.fen);
    const probe = Core.moveFromUCI(state, item.probe);
    const after = probe ? Core.makeMoveCopy(state, probe) : state;
    const reply = item.reply && Core.moveFromUCI(after, item.reply);
    const best = Core.moveFromUCI(state, item.best);
    return { state, after, reply, best };
  }
  return { build, context, words, pattern, companions };
});
