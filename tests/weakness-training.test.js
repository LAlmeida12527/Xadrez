'use strict';
const assert = require('node:assert/strict');
const Core = require('../js/chess-core');
const Training = require('../js/weakness-training');
const Diagnosis = require('../js/phase-diagnosis');
const game = (fen, uci, best, reply, theme) => ({ id:'mine', moves:[{ color:Core.parseFEN(fen).turn, fenBefore:fen, uci }], analysis:{ userColor:Core.parseFEN(fen).turn, phaseEngine:{ moves:[{ ply:1, classification:'blunder', loss:.4, best, reply, theme }] } } });
const fen = '4k3/8/5n2/3Q4/8/8/8/4K3 w - - 0 10';
const sample = game(fen, 'e1d1', 'd5d3', 'f6d5', 'Captura na resposta adversária');
const session = Training.build([sample]);
assert.equal(session.items[0].fen, fen);
assert.equal(session.items[0].ply, 1);
assert.equal(session.items.length, 2);
assert.equal(session.items[1].key, 'capture:n:q');
const context = Training.context(session.items[0]);
assert.match(Training.words(context.after, 'f6d5'), /cavalo pode capturar a dama em d5 \(Nxd5\)/);
assert.equal(Training.pattern(context.after, 'f6d5'), 'capture:n:q');
assert.equal(Training.build([sample, { id:'seen', moves:[{fenBefore:session.items[1].fen}]}]).items.length, 1);
const black = game('4k3/8/8/8/7q/5N2/8/4K3 b - - 0 10', 'e8d8', 'h4h6', 'f3h4', 'Captura na resposta adversária');
assert.equal(Core.parseFEN(Training.build([black]).items[0].fen).turn, 'b');
for (const item of Training.companions) {
  const { state, after, reply, best } = Training.context(item);
  assert.ok(best, `${item.id}: solução legal`);
  assert.ok(reply, `${item.id}: resposta legal`);
  if (item.key.startsWith('capture:')) {
    assert.equal(Training.pattern(after, item.reply), item.key);
    const fixed = Core.makeMoveCopy(state, best);
    assert.equal(Core.moveFromUCI(fixed, item.reply)?.capture || null, null, `${item.id}: a solução evita a captura`);
  } else assert.equal(Core.gameStatus(Core.makeMoveCopy(state, best)).reason, 'checkmate');
}
assert.equal(Diagnosis.summarize([sample]).smallSample, true);
assert.equal(Training.build([{id:'empty',moves:[]}]), null);
console.log('✓ Treino pessoal: origem, padrão, solução legal, novidade e lado do jogador.');
