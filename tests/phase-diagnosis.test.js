'use strict';

const assert = require('node:assert/strict');
const Core = require('../js/chess-core.js');
const Diagnosis = require('../js/phase-diagnosis.js');
const Review = require('../js/review-engine.js');

const opening = Core.createInitialState();
const middle = Core.parseFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 16');
const ending = Core.parseFEN('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');

assert.equal(Diagnosis.phaseOf(opening), 'opening');
assert.equal(Diagnosis.phaseOf(middle), 'middlegame');
assert.equal(Diagnosis.phaseOf(ending), 'endgame');

const whitePosition = (state, uci) => ({ color: 'w', fenBefore: Core.toFEN(state), uci, classification: 'ok' });
const moves = [
  ...['e2e4', 'd2d4', 'c2c4', 'g1f3'].map((uci) => whitePosition(opening, uci)),
  ...['e2e4', 'd2d4', 'c2c4', 'g1f3'].map((uci) => whitePosition(middle, uci)),
  whitePosition(ending, 'g6g5')
];
const engineMoves = moves.map((_, index) => ({
  ply: index + 1, classification: index >= 4 && index <= 6 ? 'mistake' : 'ok', loss: 0.12
}));
const first = { id: 'first', reason: 'imported', moves, analysis: { userColor: 'w', phaseEngine: { moves: engineMoves } } };
const report = Diagnosis.summarize([first]);
assert.equal(report.weak.id, 'middlegame');
assert.equal(report.phases[1].examples[0].ply, 5);
assert.equal(report.phases[2].games, 1);
assert.equal(Diagnosis.summarize([first], { history: true }).weak, null);
assert.equal(Diagnosis.summarize([first, { ...first, id: 'duplicate' }], { history: true }).games, 1);

const second = { ...first, id: 'second', moves: [...moves.slice(0, -1), whitePosition(ending, 'g6g4')] };
const history = Diagnosis.summarize([first, second, { id: 'bot', moves }], { history: true });
assert.equal(history.weak.id, 'middlegame');
assert.equal(history.games, 2);
assert.equal(history.phases[2].moves, 2);

const black = { moves: [
  whitePosition(opening, 'e2e4'),
  { color: 'b', fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', uci: 'e7e5' }
], analysis: { userColor: 'b' } };
assert.deepEqual(Diagnosis.positions(black).map((move) => move.ply), [2]);
assert.equal(Diagnosis.describeMove(ending, 'g6g7'), 'Dama vai para g7');

const tested = Diagnosis.verifiedMove({ state: ending, ply: 1, uci: 'g6g5' }, {
  bestmove: 'g6g7', same: false,
  best: { scoreType: 'mate', score: 1 },
  playedLine: { scoreType: 'cp', score: 500, pv: ['g6g5'] }
});
assert.equal(tested.theme, 'Mate forçado não aproveitado');
assert.equal(tested.best, 'g6g7');

const verifiedReview = Review.buildReview(first);
assert.equal(verifiedReview.moves[4].classification, 'mistake');
assert.equal(verifiedReview.accuracy, null);
assert.ok(verifiedReview.keyMoments.includes(5));
console.log('✓ Diagnóstico por fase validado, incluindo amostras pequenas e partidas de pretas.');
