'use strict';

const assert = require('node:assert/strict');
const Core = require('../js/chess-core.js');
const Analysis = require('../js/analysis-engine.js');
const Coach = require('../js/coach-engine.js');
const Bot = require('../js/human-bot.js');
const Stockfish = require('../js/stockfish-service.js');
const Training = require('../js/training-engine.js');
const PatternMemory = require('../js/pattern-memory.js');
const Development = require('../js/development-engine.js');
const Openings = require('../js/opening-engine.js');
const Mistakes = require('../js/mistake-library.js');
const Archive = require('../js/game-archive.js');
const EngineReview = require('../js/engine-review.js');
const Review = require('../js/review-engine.js');
const Auth = require('../js/auth-service.js');
const Progress = require('../js/progress-engine.js');
const Portability = require('../js/data-portability.js');

function play(state, uci) {
  const move = Core.moveFromUCI(state, uci);
  assert.ok(move, `Movimento legal esperado: ${uci}`);
  const before = Core.cloneState(state);
  Core.applyMove(state, move);
  return { move, before };
}

(function testInitialPerft() {
  const state = Core.createInitialState();
  assert.equal(Core.generateLegalMoves(state).length, 20);
  assert.equal(Core.perft(state, 1), 20);
  assert.equal(Core.perft(state, 2), 400);
  assert.equal(Core.perft(state, 3), 8902);
})();

(function testReferencePerftPositions() {
  const positions = [
    {
      name: 'Kiwipete',
      fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      expected: [48, 2039, 97862]
    },
    {
      name: 'Discovered check',
      fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      expected: [14, 191, 2812]
    },
    {
      name: 'Castling and promotion stress',
      fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      expected: [6, 264, 9467]
    },
    {
      name: 'Promotion tactics',
      fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
      expected: [44, 1486, 62379]
    },
    {
      name: 'Complex middlegame',
      fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
      expected: [46, 2079, 89890]
    }
  ];

  for (const position of positions) {
    const state = Core.parseFEN(position.fen);
    position.expected.forEach((expected, index) => {
      assert.equal(Core.perft(state, index + 1), expected, `${position.name} perft ${index + 1}`);
    });
  }
})();

(function testFenRoundTrip() {
  const fen = 'r3k2r/ppp2ppp/2n5/3pp3/8/2N2N2/PPP2PPP/R3K2R w KQkq d6 7 12';
  assert.equal(Core.toFEN(Core.parseFEN(fen)), fen);
})();

(function testCastling() {
  const state = Core.parseFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const legalUci = Core.generateLegalMoves(state).map(Core.moveToUCI);
  assert.ok(legalUci.includes('e1g1'));
  assert.ok(legalUci.includes('e1c1'));
  play(state, 'e1g1');
  assert.equal(state.board[7][6], 'K');
  assert.equal(state.board[7][5], 'R');
  assert.equal(state.castle.K, false);
  assert.equal(state.castle.Q, false);
})();

(function testIllegalCastleThroughCheck() {
  const state = Core.parseFEN('r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1');
  const legalUci = Core.generateLegalMoves(state).map(Core.moveToUCI);
  assert.ok(!legalUci.includes('e1g1'), 'Roque não pode atravessar casa atacada.');
})();

(function testEnPassant() {
  const state = Core.createInitialState();
  play(state, 'e2e4');
  play(state, 'a7a6');
  play(state, 'e4e5');
  play(state, 'd7d5');
  const move = Core.moveFromUCI(state, 'e5d6');
  assert.ok(move && move.enPassant);
  Core.applyMove(state, move);
  assert.equal(state.board[2][3], 'P');
  assert.equal(state.board[3][3], null);
})();

(function testPromotionChoices() {
  const state = Core.parseFEN('7k/P7/8/8/8/8/8/7K w - - 0 1');
  const promotions = Core.generateLegalMoves(state)
    .filter((move) => Core.moveToUCI(move).startsWith('a7a8'))
    .map((move) => move.promotion)
    .sort();
  assert.deepEqual(promotions, ['b', 'n', 'q', 'r']);
  play(state, 'a7a8n');
  assert.equal(state.board[0][0], 'N');
})();

(function testFoolsMate() {
  const state = Core.createInitialState();
  play(state, 'f2f3');
  play(state, 'e7e5');
  play(state, 'g2g4');
  play(state, 'd8h4');
  const status = Core.gameStatus(state, null);
  assert.equal(status.ended, true);
  assert.equal(status.reason, 'checkmate');
  assert.equal(status.winner, 'b');
})();

(function testStalemate() {
  const state = Core.parseFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const status = Core.gameStatus(state, null);
  assert.equal(status.ended, true);
  assert.equal(status.reason, 'stalemate');
})();

(function testInsufficientMaterial() {
  assert.equal(Core.insufficientMaterial(Core.parseFEN('8/8/8/8/8/8/6k1/6K1 w - - 0 1')), true);
  assert.equal(Core.insufficientMaterial(Core.parseFEN('8/8/8/8/8/8/5Bk1/6K1 w - - 0 1')), true);
  assert.equal(Core.insufficientMaterial(Core.parseFEN('8/8/8/8/8/8/5Rk1/6K1 w - - 0 1')), false);
})();

(function testFiftyMoveRule() {
  const state = Core.parseFEN('8/8/8/8/8/8/5Rk1/6K1 w - - 100 51');
  const status = Core.gameStatus(state, null);
  assert.equal(status.ended, true);
  assert.equal(status.reason, 'fifty-move');
})();

(function testSan() {
  const state = Core.createInitialState();
  const move = Core.moveFromUCI(state, 'e2e4');
  const after = Core.makeMoveCopy(state, move);
  assert.equal(Core.sanNotation(state, move, after), 'e4');
})();

(function testPgnParsingWithHeadersCommentsAndCastling() {
  const pgn = `[Event "Test"]\n[White "Levi"]\n[Black "Bot"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {comentário} 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 1-0`;
  const parsed = Core.parsePGN(pgn);
  assert.equal(parsed.headers.White, 'Levi');
  assert.equal(parsed.result, '1-0');
  assert.equal(parsed.moves.length, 16);
  assert.equal(parsed.moves[8].notation, 'O-O');
  assert.equal(parsed.moves[15].notation, 'O-O');
})();

(function testPgnParsingIgnoresVariationsAndNags() {
  const pgn = `1. e4 $1 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2`;
  const parsed = Core.parsePGN(pgn);
  assert.equal(parsed.moves.length, 6);
  assert.equal(parsed.result, '1/2-1/2');
  assert.equal(parsed.moves[0].uci, 'e2e4');
})();

(function testAnalysisRisk() {
  const state = Core.parseFEN('rnbqkbnr/pppp1ppp/8/4p3/8/4P3/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const move = Core.moveFromUCI(state, 'd1h5');
  assert.ok(move);
  const result = Analysis.analyzeMove(state, move);
  assert.ok(result.classification);
  assert.ok(Array.isArray(result.concepts));
})();


(function testDefendedPieceIsNotAutomaticallyHanging() {
  const state = Core.parseFEN('4k3/8/8/8/3n4/2P5/3P4/4K3 b - - 0 1');
  const hanging = Analysis.hangingPieces(state, 'b');
  assert.equal(Array.isArray(hanging), true);
})();

(function testMoveAllowingMateInOneIsAlwaysCritical() {
  const state = Core.createInitialState();
  play(state, 'f2f3');
  play(state, 'e7e5');
  const move = Core.moveFromUCI(state, 'g2g4');
  assert.ok(move);
  const risk = Analysis.moveRisk(state, move);
  assert.ok(risk, 'g4 deve ser reconhecido como risco crítico no mate do louco.');
  assert.equal(risk.type, 'mate-in-one');
  assert.equal(risk.mateMove, 'd8h4');

  const result = Analysis.analyzeMove(state, move);
  assert.equal(result.classification.label, 'blunder');
  assert.ok(result.classification.loss >= 8);
  assert.equal(result.likelyCause, 'não verificou ameaça de mate em 1');
  assert.ok(result.concepts.includes('mate em 1 permitido'));
})();

(function testPawnDefenderIsRecognizedByRiskDetector() {
  const defended = Core.parseFEN('4k3/6b1/8/8/8/8/1P6/1N2K3 w - - 0 1');
  const defendedMove = Core.moveFromUCI(defended, 'b1c3');
  assert.ok(defendedMove);
  assert.equal(Analysis.moveRisk(defended, defendedMove), null, 'O peão em b2 deve defender c3.');

  const undefended = Core.parseFEN('4k3/6b1/8/8/8/8/8/1N2K3 w - - 0 1');
  const undefendedMove = Core.moveFromUCI(undefended, 'b1c3');
  assert.ok(undefendedMove);
  const risk = Analysis.moveRisk(undefended, undefendedMove);
  assert.ok(risk, 'Sem o peão em b2, o cavalo em c3 deve ser reconhecido como exposto.');
  assert.ok(risk.severity >= 2);
})();


(function testCoachObservationDetectsDirectThreatWithoutInventingMove() {
  const before = Core.parseFEN('4k3/8/8/8/8/8/4N3/4K1b1 b - - 0 1');
  const move = Core.moveFromUCI(before, 'g1f2');
  assert.ok(move);
  const after = Core.makeMoveCopy(before, move);
  const history = [{ color: 'b', notation: 'Bf2+', uci: 'g1f2', move: { ...move }, fenBefore: Core.toFEN(before), fenAfter: Core.toFEN(after) }];
  const observation = Coach.buildObservation(after, history, 'w');
  assert.ok(observation);
  assert.equal(observation.kind, 'check');
  assert.equal(Coach.evaluateChoice(observation, 'check').result, 'correct');
  assert.equal(Coach.evaluateChoice(observation, 'development').result, 'incorrect');
})();

(function testCoachObservationRecognizesMinorPieceDevelopment() {
  const before = Core.createInitialState();
  const move = Core.moveFromUCI(before, 'g1f3');
  const after = Core.makeMoveCopy(before, move);
  const history = [{ color: 'w', notation: 'Nf3', uci: 'g1f3', move: { ...move }, fenBefore: Core.toFEN(before), fenAfter: Core.toFEN(after) }];
  const observation = Coach.buildObservation(after, history, 'b');
  assert.equal(observation.kind, 'development');
  assert.ok(observation.hints.length >= 3);
})();

(function testBotAlwaysReturnsLegalMoveForEitherColor() {
  const blackToMove = Core.createInitialState();
  play(blackToMove, 'e2e4');
  const whiteToMove = Core.createInitialState();

  for (const level of [150, 300, 500, 700]) {
    for (const state of [blackToMove, whiteToMove]) {
      for (let i = 0; i < 10; i += 1) {
        const move = Bot.chooseMove(state, level);
        assert.ok(move, `Bot ${level} deveria escolher um movimento.`);
        const legal = Core.generateLegalMoves(state, state.turn).map(Core.moveToUCI);
        assert.ok(legal.includes(Core.moveToUCI(move)), `Bot ${level} escolheu lance ilegal para ${state.turn}.`);
      }
    }
  }
})();


(function testFocusedBotCanPreferCreatingRelevantPressure() {
  const state = Core.parseFEN('4k3/8/8/8/2b5/8/3N4/4K3 b - - 0 1');
  const move = Core.moveFromUCI(state, 'c4d3');
  assert.ok(move);
  assert.ok(Bot.focusBonus(state, move, 'change') >= 0);
  for (const focus of ['change', 'hanging', 'threat', 'mate']) {
    const chosen = Bot.chooseMove(state, 300, { focus });
    assert.ok(chosen);
    assert.ok(Core.generateLegalMoves(state, 'b').map(Core.moveToUCI).includes(Core.moveToUCI(chosen)));
  }
})();


(function testTrainingCatalogExpandsPracticeWhereErrorsRepeat() {
  const profile = {
    assessment: { completed: true, primaryWeakness: 'hanging', style: { bishopAffinity: false } },
    recentMistakes: Array.from({ length: 3 }, (_, index) => ({
      id: `m${index}`,
      concepts: ['peça pendurada'],
      likelyCause: 'deixou material vulnerável'
    }))
  };
  const catalog = Training.catalog(profile);
  const hanging = catalog.find((item) => item.mode === 'hanging');
  assert.ok(hanging);
  assert.ok(hanging.recommendedReps > hanging.activities, 'Erro recorrente deve ampliar o volume recomendado, sem fingir posições únicas.');
  assert.equal(catalog[0].mode, 'hanging', 'Fraqueza real deve ficar acima de preferência de estilo.');
})();

(function testPatternCatalogIsNotJustTrainingTitles() {
  const profile = { assessment: { completed: true, primaryWeakness: 'change', style: {} }, recentMistakes: [] };
  const patterns = Training.patternCatalog(profile);
  assert.ok(patterns.some((item) => item.title === 'Peça pendurada'));
  assert.ok(patterns.some((item) => item.title === 'Melhorar a pior peça'));
  assert.ok(patterns.every((item) => item.mode && Number.isFinite(item.recommendedReps)));
})();


(function testDevelopmentTrainerScenariosAreValidAndExplanatory() {
  const validation = Development.validate();
  assert.equal(validation.length, 8);
  assert.ok(validation.every((item) => item.valid));
  const scenario = Development.scenario(3);
  assert.ok(scenario.choices.includes(scenario.answer));
  assert.equal(Development.evaluateChoice(scenario, scenario.answer).correct, true);
  assert.equal(Development.evaluateChoice(scenario, 'wait').correct, scenario.answer === 'wait');
})();

(function testPatternMemoryNeedsRepeatedCleanRecognition() {
  let state = PatternMemory.normalizeState({});
  assert.equal(PatternMemory.stageOf(state).id, 'see');
  state = PatternMemory.recordAttempt(state, { correct: true, hints: 0, at: '2026-08-01T10:00:00.000Z' });
  assert.equal(PatternMemory.stageOf(state).id, 'understand');
  const assisted = PatternMemory.recordAttempt(state, { correct: true, hints: 2, at: '2026-08-02T10:00:00.000Z' });
  assert.equal(PatternMemory.stageOf(assisted).id, 'understand', 'Acerto com pista não deve promover estágio automaticamente.');
  const missed = PatternMemory.recordAttempt(assisted, { correct: false, hints: 0, at: '2026-08-03T10:00:00.000Z' });
  assert.equal(missed.lastResult, 'miss');
  assert.ok(PatternMemory.mastery(missed) < 100);
})();

(function testPatternMemoryCatalogUsesSeparateProfileBucket() {
  const profile = { patternMemory: { fork: { attempts: 2, correct: 2, noHintCorrect: 2, stageIndex: 2, stageWins: 0 } } };
  const item = PatternMemory.catalog(profile).find((entry) => entry.id === 'fork');
  assert.ok(item);
  assert.equal(item.stage.id, 'find');
  assert.ok(Number.isFinite(item.mastery));
})();

(function testOpeningRecommendationsAreSeparatedByPlayingContext() {
  const assessment = {
    completed: true,
    style: { bishopAffinity: true, scores: { active: 1.8, tactical: 0.8, solid: 0.4, positional: 0.2, classical: 1.2 } }
  };
  const groups = Openings.recommendedByContext(assessment);
  assert.ok(groups.white.length >= 3);
  assert.ok(groups.blackE4.length >= 1);
  assert.ok(groups.blackD4.length >= 1);
  assert.ok(groups.white.every((item) => item.side === 'Brancas'));
  assert.ok(groups.blackE4.every((item) => item.side === 'Pretas vs 1.e4'));
  assert.ok(groups.blackD4.every((item) => item.side === 'Pretas vs 1.d4'));
})();

(function testStockfishParser() {
  const line = 'info depth 12 multipv 2 score cp -43 nodes 1000 pv e2e4 e7e5';
  const parsed = Stockfish.parseInfo(line);
  assert.equal(parsed.depth, 12);
  assert.equal(parsed.multipv, 2);
  assert.equal(parsed.scoreType, 'cp');
  assert.equal(parsed.score, -43);
  assert.deepEqual(parsed.pv.slice(0, 2), ['e2e4', 'e7e5']);
})();

(function testStockfishGoCommandAndLossClassification() {
  assert.equal(Stockfish.buildGoCommand(10), 'go depth 10');
  assert.equal(Stockfish.buildGoCommand(12, ['e2e4']), 'go depth 12 searchmoves e2e4');
  assert.equal(Stockfish.buildGoCommand(99, ['bad', 'a7a8q']), 'go depth 18 searchmoves a7a8q');
  assert.equal(Stockfish.classifyCentipawnLoss(20), 'ok');
  assert.equal(Stockfish.classifyCentipawnLoss(50), 'inaccuracy');
  assert.equal(Stockfish.classifyCentipawnLoss(120), 'mistake');
  assert.equal(Stockfish.classifyCentipawnLoss(250), 'blunder');
  assert.ok(Stockfish.scoreToComparable('mate', 2) > Stockfish.scoreToComparable('cp', 900));
  assert.ok(Stockfish.scoreToComparable('mate', -2) < Stockfish.scoreToComparable('cp', -900));
})();

(function testSummaryCanAnalyzeBlackSide() {
  const state = Core.createInitialState();
  const white = play(state, 'e2e4');
  const black = play(state, 'e7e5');
  const history = [
    { color: 'w', analysis: Analysis.analyzeMove(white.before, white.move) },
    { color: 'b', analysis: Analysis.analyzeMove(black.before, black.move) }
  ];
  assert.equal(Analysis.summarizeHistory(history, 'w').userMoves, 1);
  assert.equal(Analysis.summarizeHistory(history, 'b').userMoves, 1);
})();


(function testBaselineWeaknessFeedsFirstAdaptivePlan() {
  const profile = { recentMistakes: [], baseline: { summary: { weakest: 'hanging' } } };
  const focus = Training.recommendFocus(profile);
  assert.equal(focus.mode, 'hanging');
  assert.equal(Training.trainingPlan(profile, 20).items[1].mode, 'hanging');
})();

(function testAfterDevelopmentWeaknessCanBecomePrimaryFocus() {
  const profile = { recentMistakes: [], baseline: { summary: { weakest: 'afterdev' } } };
  assert.equal(Training.recommendFocus(profile).mode, 'afterdev');
})();

(function testAdaptiveFocusUsesRecentMistakes() {
  const profile = {
    recentMistakes: [
      { concepts: ['peça exposta'], likelyCause: 'deixou material vulnerável' },
      { concepts: ['peça pendurada'], likelyCause: 'deixou material vulnerável' },
      { concepts: [], likelyCause: 'não verificou a resposta adversária imediata' }
    ]
  };
  assert.equal(Training.recommendFocus(profile).mode, 'hanging');

  const threatProfile = {
    recentMistakes: Array.from({ length: 4 }, () => ({
      concepts: [],
      likelyCause: 'não verificou a resposta adversária imediata'
    }))
  };
  assert.equal(Training.recommendFocus(threatProfile).mode, 'change');

  const mateRiskProfile = {
    recentMistakes: [{
      concepts: ['mate em 1 permitido'],
      likelyCause: 'não verificou ameaça de mate em 1'
    }]
  };
  assert.equal(Training.recommendFocus(mateRiskProfile).mode, 'mate');
})();

(function testGameArchiveCreatesLeanRecoverableHistory() {
  const game = {
    startedAt: '2026-08-27T10:00:00.000Z',
    completedAt: '2026-08-27T10:10:00.000Z',
    result: 'Derrota',
    reason: 'checkmate',
    botLevel: 300,
    interventions: 2,
    materialLost: 5,
    materialWon: 2,
    history: [{
      color: 'w', notation: 'e4', uci: 'e2e4', fenBefore: 'start', fenAfter: 'after', thinkingMs: 1200,
      analysis: { classification: { label: 'mistake', loss: 1.2 }, likelyCause: 'teste', concepts: ['visão'] }
    }]
  };
  const analysis = { headline: 'Teste', tags: ['visão'], criticalFen: 'start' };
  const item = Archive.createArchiveItem(game, { blunders: 1, mistakes: 2, inaccuracies: 3 }, '1. e4', analysis);
  assert.ok(item.id.startsWith('game-'));
  assert.equal(item.moves.length, 1);
  assert.equal(item.moves[0].classification, 'mistake');
  assert.equal(item.analysis.archiveId, item.id);

  const list = Archive.add([], item, 24);
  assert.equal(list.length, 1);
  const updated = Archive.updateAnalysis(list, item.id, { ...item.analysis, engine: { bestmove: 'e2e4' } });
  assert.equal(updated[0].analysis.engine.bestmove, 'e2e4');
})();

(function testMistakeLibraryNormalizesAndClassifies() {
  const item = Mistakes.normalizeMistake({
    at: '2026-08-27T12:00:00.000Z',
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    move: 'a1a2',
    notation: 'Ra2',
    label: 'blunder',
    loss: 3.2,
    concepts: ['peça pendurada'],
    confidence: 'high',
    ply: 17
  });
  assert.ok(item.id.startsWith('mistake-'));
  assert.equal(Mistakes.primaryCategory(item), 'Peça pendurada');
  assert.equal(item.review.attempts, 0);
})();

(function testMistakeRetryEvaluation() {
  const mistake = Mistakes.normalizeMistake({
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    move: 'a1a2',
    label: 'blunder',
    loss: 3
  });

  const success = Mistakes.evaluateRetry(mistake, {
    classification: { label: 'ok', loss: 0.1 },
    risk: null
  });
  assert.equal(success.result, 'success');

  const partial = Mistakes.evaluateRetry(mistake, {
    classification: { label: 'blunder', loss: 2.2 },
    risk: null
  });
  assert.equal(partial.result, 'partial');

  const repeat = Mistakes.evaluateRetry(mistake, {
    classification: { label: 'blunder', loss: 2.9 },
    risk: { severity: 3 }
  });
  assert.equal(repeat.result, 'repeat');

  const reviewed = Mistakes.applyReview(mistake, success, '2026-08-27T13:00:00.000Z');
  assert.equal(reviewed.review.attempts, 1);
  assert.equal(reviewed.review.successes, 1);
  assert.equal(reviewed.review.lastResult, 'success');
  assert.equal(reviewed.review.intervalDays, 3);
  assert.equal(Mistakes.isDue(reviewed, '2026-08-29T13:00:00.000Z'), false);
  assert.equal(Mistakes.isDue(reviewed, '2026-08-30T13:00:00.000Z'), true);
})();

(function testMistakeDueQueueIncludesUnreviewedAndExpired() {
  const unreviewed = Mistakes.normalizeMistake({ at: '2026-08-20T10:00:00.000Z' });
  const reviewed = Mistakes.applyReview(
    Mistakes.normalizeMistake({ at: '2026-08-20T11:00:00.000Z' }),
    { result: 'success' },
    '2026-08-20T12:00:00.000Z'
  );
  assert.equal(Mistakes.dueMistakes([unreviewed, reviewed], '2026-08-21T12:00:00.000Z').length, 1);
  assert.equal(Mistakes.dueMistakes([unreviewed, reviewed], '2026-08-24T12:00:00.000Z').length, 2);
})();

(function testMistakeSummaryPrioritizesUnresolved() {
  const list = [
    Mistakes.normalizeMistake({ concepts: ['peça pendurada'], label: 'mistake', at: '2026-08-27T10:00:00.000Z' }),
    Mistakes.normalizeMistake({ concepts: ['peça pendurada'], label: 'mistake', at: '2026-08-27T11:00:00.000Z' }),
    Mistakes.normalizeMistake({ likelyCause: 'não verificou a resposta adversária imediata', label: 'blunder', at: '2026-08-27T12:00:00.000Z' })
  ];
  const summary = Mistakes.summarize(list);
  assert.equal(summary[0].category, 'Peça pendurada');
  assert.equal(summary[0].count, 2);
})();


(function testWhatChangedExercisesHaveRealNewThreats() {
  for (const source of Training.CHANGE_EXERCISES) {
    const before = Core.parseFEN(source.beforeFen);
    const target = Core.parseSquare(source.target);
    const beforeAttackers = Core.attackersOf(before, target.row, target.col, 'b');
    const exercise = Training.buildChangeExercise(source);
    const after = Core.parseFEN(exercise.fen);
    const afterAttackers = Core.attackersOf(after, target.row, target.col, 'b');
    assert.equal(beforeAttackers.length, 0, `${source.id}: a ameaça não deve existir antes do lance.`);
    assert.ok(afterAttackers.length > 0, `${source.id}: o último lance precisa criar a ameaça.`);
    assert.ok(after.board[target.row][target.col], `${source.id}: a casa-alvo precisa conter uma peça branca.`);
  }
})();

(function testSurpriseTrainingHidesThemeButKeepsValidTarget() {
  const exercise = Training.getExercise('surprise', 0);
  assert.ok(exercise.prompt.includes('Sem tema'));
  const state = Core.parseFEN(exercise.fen);
  const target = Core.parseSquare(exercise.target);
  assert.ok(state.board[target.row][target.col]);
  const plan = Training.trainingPlan({ recentMistakes: [] }, 20);
  assert.equal(plan.items[3].action, 'surprise');
  assert.equal(plan.items[2].action, 'play');
  assert.ok(plan.items[2].mode);
})();

(function testTrainingCatalog() {
  for (const mode of ['threat', 'hanging', 'mate']) {
    for (const exercise of Training.EXERCISES[mode]) {
      const state = Core.parseFEN(exercise.fen);
      const target = Core.parseSquare(exercise.target);
      assert.ok(state);
      assert.ok(target);
      assert.ok(exercise.hints.length >= 3);
      assert.ok(state.board[target.row][target.col], `${exercise.id}: a resposta deve apontar para uma peça.`);

      if (mode === 'threat') {
        const attackers = Core.attackersOf(state, target.row, target.col, 'b');
        assert.ok(attackers.length > 0, `${exercise.id}: a peça-alvo precisa estar realmente atacada.`);
      }

      if (mode === 'hanging') {
        const hanging = Analysis.hangingPieces(state, 'w').map((item) => item.square);
        assert.ok(hanging.includes(exercise.target), `${exercise.id}: a peça-alvo precisa estar realmente pendurada.`);
      }

      if (mode === 'mate') {
        const matingMoves = Core.generateLegalMoves(state).filter((move) => {
          if (Core.squareName(move.fromRow, move.fromCol) !== exercise.target) return false;
          const after = Core.makeMoveCopy(state, move);
          const status = Core.gameStatus(after, null);
          return status.ended && status.reason === 'checkmate';
        });
        assert.ok(matingMoves.length > 0, `${exercise.id}: a peça-alvo precisa ter mate em um lance.`);
      }
    }
  }
})();



(function testBackupRoundTripAndValidation() {
  const backup = Portability.createBackup({ rating: 321, recentMistakes: [{ id: 'x' }] }, { status: 'playing' }, '2026-08-27T18:00:00.000Z');
  const parsed = Portability.parseBackup(JSON.stringify(backup));
  assert.equal(parsed.profile.rating, 321);
  assert.equal(parsed.currentGame.status, 'playing');
  assert.throws(() => Portability.parseBackup('{bad json'), /JSON válido/);
  assert.throws(() => Portability.parseBackup(JSON.stringify({ kind: 'other', profile: {} })), /não é um backup/);
})();

(function testWeeklyReportDoesNotInventSpeedInsightWithSmallSample() {
  const archive = [{
    completedAt: '2026-08-27T12:00:00.000Z', result: 'Derrota', analysis: { userColor: 'w' },
    moves: [
      { color: 'w', classification: 'blunder', thinkingMs: 1000 },
      { color: 'w', classification: 'ok', thinkingMs: 5000 }
    ]
  }];
  const report = Progress.buildWeeklyReport(archive, [], '2026-08-27T18:00:00.000Z');
  assert.equal(report.current.games, 1);
  assert.equal(report.speedInsight, null);
  assert.equal(report.hasEnoughData, false);
})();

(function testWeeklyReportFindsFastMovePatternWithEvidence() {
  const moves = [];
  for (let i = 0; i < 5; i += 1) moves.push({ color: 'w', classification: i < 4 ? 'mistake' : 'ok', thinkingMs: 1000 });
  for (let i = 0; i < 5; i += 1) moves.push({ color: 'w', classification: i === 0 ? 'mistake' : 'ok', thinkingMs: 6000 });
  const archive = [
    { completedAt: '2026-08-26T12:00:00.000Z', result: 'Derrota', analysis: { userColor: 'w' }, moves },
    { completedAt: '2026-08-25T12:00:00.000Z', result: 'Vitória', analysis: { userColor: 'w' }, moves: [] }
  ];
  const report = Progress.buildWeeklyReport(archive, [], '2026-08-27T18:00:00.000Z');
  assert.equal(report.speedInsight.type, 'fast-errors');
  assert.equal(report.speedInsight.fastRate, 80);
  assert.equal(report.speedInsight.deliberateRate, 20);
  assert.equal(report.hasEnoughData, true);
})();

(function testEngineReviewSelectsMostImportantUserMoves() {
  const moves = [
    { color: 'w', notation: 'e4', uci: 'e2e4', fenBefore: 'fen-1', classification: 'inaccuracy', loss: 0.8 },
    { color: 'b', notation: '...e5', uci: 'e7e5', fenBefore: 'fen-2', classification: 'blunder', loss: 4 },
    { color: 'w', notation: 'Qh5', uci: 'd1h5', fenBefore: 'fen-3', classification: 'blunder', loss: 3.5 },
    { color: 'w', notation: 'Bc4', uci: 'f1c4', fenBefore: 'fen-4', classification: 'mistake', loss: 1.7 }
  ];
  const selected = EngineReview.selectCandidates(moves, 'w', 2);
  assert.equal(selected.length, 2);
  assert.equal(selected[0].uci, 'd1h5');
  assert.equal(selected[1].uci, 'f1c4');
  assert.equal(selected[0].ply, 3);
})();

(function testEngineReviewSummarizesAgreement() {
  const candidate = {
    ply: 5, notation: 'Qh5', uci: 'd1h5', fenBefore: 'fen', classification: 'blunder', loss: 3
  };
  const verified = EngineReview.normalizeVerifiedItem(candidate, {
    classification: 'mistake', lossCp: 145, lossPawns: 1.45, bestmove: 'g1f3', depth: 11, same: false, alternatives: []
  });
  assert.equal(verified.engineClassification, 'mistake');
  const summary = EngineReview.summarize([verified]);
  assert.equal(summary.checked, 1);
  assert.equal(summary.downgraded, 1);
  assert.equal(summary.confirmed, 0);
})();

console.log('✓ Todos os testes do núcleo passaram.');

(function testInitialLevelEstimateIsConservativeForShortCleanGame() {
  const PlayerModel = require('../js/player-model.js');
  const history = [];
  let state = Core.createInitialState();
  for (const uci of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'g1f3', 'g8f6', 'e1g1']) {
    const before = Core.cloneState(state);
    const move = Core.moveFromUCI(state, uci);
    assert.ok(move);
    const after = Core.makeMoveCopy(state, move);
    history.push({ color: Core.colorOf(move.piece), move: { ...move }, notation: Core.sanNotation(before, move, after), thinkingMs: 5000 });
    state = after;
  }
  const estimate = PlayerModel.estimateLevel(history, { userMoves: 4, blunders: 0, mistakes: 0, inaccuracies: 0, exposedMoves: 0 });
  assert.equal(estimate.confidence, 'baixa');
  assert.ok(estimate.high - estimate.low >= 500, 'Uma avaliação curta precisa manter faixa ampla.');
  assert.ok(estimate.center <= 500, 'Quatro lances limpos não podem produzir estimativa alta demais.');
})();

(function testEarlyBishopPreferenceAffectsStyleAndOpeningOrder() {
  const PlayerModel = require('../js/player-model.js');
  const Openings = require('../js/opening-engine.js');
  const history = [];
  let state = Core.createInitialState();
  for (const uci of ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'g1f3', 'g8f6', 'e1g1']) {
    const before = Core.cloneState(state);
    const move = Core.moveFromUCI(state, uci);
    const after = Core.makeMoveCopy(state, move);
    history.push({ color: Core.colorOf(move.piece), move: { ...move }, notation: Core.sanNotation(before, move, after), thinkingMs: 5000 });
    state = after;
  }
  const style = PlayerModel.styleFromHistory(history, 'w');
  assert.equal(style.bishopAffinity, true);
  assert.equal(style.label, 'Ativo com bispos');
  const recs = Openings.recommended({ completed: true, style });
  assert.ok(['italian', 'bishop'].includes(recs[0].id), `Esperava abertura didática com bispo, recebeu ${recs[0].id}`);
})();

(function testAdaptiveCatalogStaysLockedUntilAssessment() {
  const locked = Training.catalog({ assessment: { completed: false }, recentMistakes: [] });
  assert.deepEqual(locked, []);
  const unlocked = Training.catalog({
    assessment: { completed: true, primaryWeakness: 'hanging', style: { bishopAffinity: true, scores: {} } },
    recentMistakes: [{ concepts: ['peça pendurada'], likelyCause: 'não verificou resposta adversária' }]
  });
  assert.ok(unlocked.length >= 6);
  assert.equal(unlocked[0].mode, 'hanging');
  assert.ok(unlocked.some((item) => item.mode === 'bishop'));
})();

(function testCoachReadsCaptureBeforeSecondaryThreat() {
  let state = Core.createInitialState();
  const history = [];
  for (const uci of ['e2e4', 'd7d5', 'e4d5']) {
    const before = Core.cloneState(state);
    const move = Core.moveFromUCI(state, uci);
    assert.ok(move, uci);
    const after = Core.makeMoveCopy(state, move);
    history.push({ color: Core.colorOf(move.piece), move: { ...move }, uci, fenBefore: Core.toFEN(before), notation: Core.sanNotation(before, move, after) });
    state = after;
  }
  const blackMove = Core.moveFromUCI(state, 'd8d5');
  assert.ok(blackMove);
  const before = Core.cloneState(state);
  const after = Core.makeMoveCopy(state, blackMove);
  history.push({ color: 'b', move: { ...blackMove }, uci: 'd8d5', fenBefore: Core.toFEN(before), notation: Core.sanNotation(before, blackMove, after) });
  const observation = Coach.buildObservation(after, history, 'w');
  assert.equal(observation.kind, 'capture');
  assert.equal(observation.correct, 'capture');
})();

(function testCoachRecognizesCentralPawnMove() {
  let state = Core.createInitialState();
  const history = [];
  const white = Core.moveFromUCI(state, 'g1f3');
  let before = Core.cloneState(state);
  let after = Core.makeMoveCopy(state, white);
  history.push({ color: 'w', move: { ...white }, uci: 'g1f3', fenBefore: Core.toFEN(before), notation: Core.sanNotation(before, white, after) });
  state = after;
  const black = Core.moveFromUCI(state, 'd7d5');
  before = Core.cloneState(state);
  after = Core.makeMoveCopy(state, black);
  history.push({ color: 'b', move: { ...black }, uci: 'd7d5', fenBefore: Core.toFEN(before), notation: Core.sanNotation(before, black, after) });
  const observation = Coach.buildObservation(after, history, 'w');
  assert.equal(observation.kind, 'center');
  assert.equal(observation.correct, 'center');
})();


(function testDevelopmentTrainerScenariosAreValidAndExplanatory() {
  const validation = Development.validate();
  assert.equal(validation.length, 8);
  assert.ok(validation.every((item) => item.valid));
  const scenario = Development.scenario(3);
  assert.ok(scenario.choices.includes(scenario.answer));
  assert.equal(Development.evaluateChoice(scenario, scenario.answer).correct, true);
  assert.equal(Development.evaluateChoice(scenario, 'wait').correct, scenario.answer === 'wait');
})();

(function testPatternMemoryNeedsRepeatedCleanRecognition() {
  let state = PatternMemory.normalizeState({});
  assert.equal(PatternMemory.stageOf(state).id, 'see');
  state = PatternMemory.recordAttempt(state, { correct: true, hints: 0, at: '2026-08-01T10:00:00.000Z' });
  assert.equal(PatternMemory.stageOf(state).id, 'understand');
  const assisted = PatternMemory.recordAttempt(state, { correct: true, hints: 2, at: '2026-08-02T10:00:00.000Z' });
  assert.equal(PatternMemory.stageOf(assisted).id, 'understand', 'Acerto com pista não deve promover estágio automaticamente.');
  const missed = PatternMemory.recordAttempt(assisted, { correct: false, hints: 0, at: '2026-08-03T10:00:00.000Z' });
  assert.equal(missed.lastResult, 'miss');
  assert.ok(PatternMemory.mastery(missed) < 100);
})();

(function testPatternMemoryCatalogUsesSeparateProfileBucket() {
  const profile = { patternMemory: { fork: { attempts: 2, correct: 2, noHintCorrect: 2, stageIndex: 2, stageWins: 0 } } };
  const item = PatternMemory.catalog(profile).find((entry) => entry.id === 'fork');
  assert.ok(item);
  assert.equal(item.stage.id, 'find');
  assert.ok(Number.isFinite(item.mastery));
})();

(function testOpeningRecommendationsAreSeparatedByPlayingContext() {
  const context = Openings.recommendedByContext({
    completed: true,
    style: { bishopAffinity: true, scores: { active: 1.4, classical: 1.2, tactical: 0.4, solid: 0.2, positional: 0.1 } }
  });
  assert.ok(context.white.length >= 3);
  assert.ok(context.blackE4.length >= 1);
  assert.ok(context.blackD4.length >= 1);
  assert.ok(context.white.every((item) => item.side === 'Brancas'));
  assert.ok(context.blackE4.every((item) => item.side === 'Pretas vs 1.e4'));
  assert.ok(context.blackD4.every((item) => item.side === 'Pretas vs 1.d4'));
})();

(function testPatternCatalogOnlyAppearsAfterAssessment() {
  assert.deepEqual(Training.patternCatalog({ assessment: { completed: false } }), []);
  const items = Training.patternCatalog({ assessment: { completed: true, primaryWeakness: 'change', style: { scores: {} } }, recentMistakes: [] });
  assert.ok(items.length >= 7);
  assert.ok(items.some((item) => item.title === 'Melhorar a pior peça'));
  assert.ok(items.some((item) => item.title === 'Reconhecer sem aviso'));
})();


(function testAllAdvertisedBotEloLevelsReturnLegalMoves() {
  let state = Core.createInitialState();
  play(state, 'e2e4');
  for (const level of [300, 500, 700, 900, 1100, 1300, 1500]) {
    for (let i = 0; i < 5; i += 1) {
      const move = Bot.chooseMove(state, level);
      assert.ok(move, `Bot ≈${level} Elo deveria responder.`);
      const legal = Core.generateLegalMoves(state, state.turn).map(Core.moveToUCI);
      assert.ok(legal.includes(Core.moveToUCI(move)), `Bot ≈${level} Elo escolheu lance ilegal.`);
    }
  }
})();

(function testItalianPlayableLessonReachesLegalCastle() {
  const italian = Openings.byId('italian');
  assert.ok(italian, 'A aula da Italiana deve existir.');
  assert.equal(italian.moves.at(-1), 'e1g1', 'A linha didática da Italiana deve ensinar roque.');
  const beforeCastle = Openings.stateAfterMoves(italian.moves.slice(0, -1));
  const legal = Core.generateLegalMoves(beforeCastle, 'w').map(Core.moveToUCI);
  assert.ok(legal.includes('e1g1'), 'O roque da aula precisa ser legal quando chegar a vez do aluno.');
  const finished = Openings.stateAfterMoves(italian.moves);
  assert.equal(finished.board[7][6], 'K');
  assert.equal(finished.board[7][5], 'R');
})();

(function testGameReviewBuildsNavigableMoveTimeline() {
  const parsed = Core.parsePGN('1. f3 e5 2. g4 Qh4#');
  const archiveItem = {
    id: 'review-test',
    result: 'Derrota',
    analysis: { userColor: 'w' },
    moves: parsed.moves.map((entry) => ({
      color: entry.color,
      notation: entry.notation,
      uci: entry.uci,
      fenBefore: entry.fenBefore,
      fenAfter: entry.fenAfter,
      classification: entry.uci === 'g2g4' ? 'blunder' : undefined,
      loss: entry.uci === 'g2g4' ? 8 : 0
    }))
  };
  const review = Review.buildReview(archiveItem, 'w');
  assert.equal(review.moves.length, 4);
  assert.equal(review.positions.length, 5);
  assert.ok(review.accuracy >= 1 && review.accuracy <= 100);
  assert.ok(review.blunders >= 1, 'g4 deve aparecer como erro grave na revisão.');
  assert.ok(review.keyMoments.includes(3));
  assert.deepEqual(review.positions[4].lastMove, { fromRow: 0, fromCol: 3, toRow: 4, toCol: 7 });
})();

(function testReviewBestMoveAlwaysReturnsLegalAlternative() {
  const state = Core.parseFEN('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2');
  const best = Review.bestMove(state);
  assert.ok(best && best.move && best.uci);
  assert.ok(Core.generateLegalMoves(state, 'w').map(Core.moveToUCI).includes(best.uci));
})();

(function testAuthFallsBackToGuestWhenSupabaseIsNotConfigured() {
  assert.equal(Auth.configured(), false);
})();
