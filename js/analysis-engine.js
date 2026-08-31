(function (root, factory) {
  const core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraAnalysisEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  if (!Core) throw new Error('KiraChessCore não carregado.');

  const CENTER = new Set(['d4', 'e4', 'd5', 'e5']);

  function pieceValue(piece) {
    return Core.VALUES[Core.typeOf(piece)] || 0;
  }

  function developmentScore(state) {
    let score = 0;

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = state.board[row][col];
        if (!piece) continue;
        const colorSign = Core.colorOf(piece) === 'w' ? 1 : -1;
        const type = Core.typeOf(piece);
        const square = Core.squareName(row, col);

        if (CENTER.has(square)) score += colorSign * 0.10;
        if (type === 'n' || type === 'b') {
          const homeRow = Core.colorOf(piece) === 'w' ? 7 : 0;
          if (row !== homeRow) score += colorSign * 0.08;
        }
      }
    }

    return score;
  }

  function kingSafetyScore(state) {
    let score = 0;
    const whiteKing = Core.kingPosition(state, 'w');
    const blackKing = Core.kingPosition(state, 'b');

    if (whiteKing && ['g1', 'c1'].includes(Core.squareName(whiteKing.row, whiteKing.col))) score += 0.22;
    if (blackKing && ['g8', 'c8'].includes(Core.squareName(blackKing.row, blackKing.col))) score -= 0.22;

    return score;
  }

  function mobilityScore(state) {
    const white = Core.generateLegalMoves(state, 'w').length;
    const black = Core.generateLegalMoves(state, 'b').length;
    return (white - black) * 0.006;
  }

  function evaluate(state) {
    return Core.materialScore(state) + developmentScore(state) + kingSafetyScore(state) + mobilityScore(state);
  }

  function attacksOnSquare(state, row, col, byColor) {
    const probe = Core.cloneState(state);
    probe.board[row][col] = byColor === 'w' ? 'p' : 'P';
    return Core.generatePseudoMoves(probe, byColor).filter((move) => (
      move.toRow === row && move.toCol === col
    ));
  }

  function hangingPieces(state, color) {
    const enemy = color === 'w' ? 'b' : 'w';
    const results = [];

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = state.board[row][col];
        if (!piece || Core.colorOf(piece) !== color || Core.typeOf(piece) === 'k') continue;

        const enemyAttackers = attacksOnSquare(state, row, col, enemy);
        if (!enemyAttackers.length) continue;

        const friendlyDefenders = attacksOnSquare(state, row, col, color);
        const value = pieceValue(piece);
        const cheapestAttacker = Math.min(...enemyAttackers.map((move) => pieceValue(move.piece)));
        const defended = friendlyDefenders.length > 0;
        const loose = !defended || cheapestAttacker < value;

        if (loose) {
          results.push({
            square: Core.squareName(row, col),
            row,
            col,
            piece,
            value,
            attackers: enemyAttackers.length,
            defenders: friendlyDefenders.length,
            cheapestAttacker,
            severity: value >= 5 ? 'critical' : value >= 3 ? 'high' : 'medium'
          });
        }
      }
    }

    return results.sort((a, b) => b.value - a.value);
  }

  function missedHighValueCapture(state, color) {
    const captures = Core.generateLegalMoves(state, color)
      .filter((move) => move.capture)
      .map((move) => ({ move, gain: pieceValue(move.capture) - Math.max(0, pieceValue(move.piece) * 0.15) }))
      .sort((a, b) => b.gain - a.gain);

    return captures[0] || null;
  }

  function opponentMateInOne(after, movedColor) {
    const enemy = movedColor === 'w' ? 'b' : 'w';
    if (after.turn !== enemy) return null;

    for (const reply of Core.generateLegalMoves(after, enemy)) {
      const replyAfter = Core.makeMoveCopy(after, reply);
      const status = Core.gameStatus(replyAfter, null);
      if (status.ended && status.reason === 'checkmate' && status.winner === enemy) {
        return {
          move: reply,
          uci: Core.moveToUCI(reply),
          notation: Core.sanNotation(after, reply, replyAfter)
        };
      }
    }

    return null;
  }

  function moveRisk(before, move) {
    const after = Core.makeMoveCopy(before, move);
    const movedColor = Core.colorOf(move.piece);
    const mateInOne = opponentMateInOne(after, movedColor);
    if (mateInOne) {
      return {
        type: 'mate-in-one',
        severity: 4,
        square: Core.squareName(move.toRow, move.toCol),
        mateMove: mateInOne.uci,
        mateNotation: mateInOne.notation,
        title: 'Pare.',
        text: 'Essa jogada permite mate em um lance. Antes de confirmar, procure todos os xeques imediatos do adversário.',
        hint: 'Comece pelos xeques de dama, torre, bispo e cavalo. Existe um que encerra a partida imediatamente.'
      };
    }

    const movedPiece = after.board[move.toRow][move.toCol];
    if (!movedPiece || Core.typeOf(movedPiece) === 'k') return null;

    const enemy = movedColor === 'w' ? 'b' : 'w';
    const enemyAttackers = attacksOnSquare(after, move.toRow, move.toCol, enemy);
    if (!enemyAttackers.length) return null;

    const friendlyDefenders = attacksOnSquare(after, move.toRow, move.toCol, movedColor);
    const value = pieceValue(movedPiece);
    const cheapestAttacker = Math.min(...enemyAttackers.map((candidate) => pieceValue(candidate.piece)));
    const defended = friendlyDefenders.length > 0;

    let severity = 0;
    if (value >= 5 && (!defended || cheapestAttacker < value)) severity = 3;
    else if (value >= 3 && (!defended || cheapestAttacker < value)) severity = 2;
    else if (value >= 1 && !defended) severity = 1;

    if (!severity) return null;

    return {
      type: 'piece-exposed',
      severity,
      square: Core.squareName(move.toRow, move.toCol),
      piece: movedPiece,
      value,
      attackers: enemyAttackers.length,
      defenders: friendlyDefenders.length,
      cheapestAttacker,
      title: severity >= 3 ? 'Pare.' : 'Observe novamente.',
      text: severity >= 3
        ? 'Essa jogada coloca uma peça valiosa sob captura imediata. Antes de confirmar, procure a resposta mais simples do adversário.'
        : 'Depois desse movimento, a peça que você moveu pode ser capturada. Confira atacantes e defensores antes de continuar.',
      hint: `Observe ${Core.squareName(move.toRow, move.toCol)} e procure todas as peças adversárias que atacam essa casa.`
    };
  }

  function classifyMove(before, move, after) {
    const beforeEval = evaluate(before);
    const afterEval = evaluate(after);
    const mover = Core.colorOf(move.piece);
    const rawLoss = mover === 'w' ? beforeEval - afterEval : afterEval - beforeEval;
    const loss = Math.max(0, rawLoss);

    if (loss >= 3) return { label: 'blunder', loss };
    if (loss >= 1.5) return { label: 'mistake', loss };
    if (loss >= 0.65) return { label: 'inaccuracy', loss };
    return { label: 'ok', loss };
  }

  function detectConcepts(before, move, after) {
    const concepts = [];
    const mover = Core.colorOf(move.piece);
    const type = Core.typeOf(move.piece);

    const risk = moveRisk(before, move);
    if (risk?.type === 'mate-in-one') concepts.push('mate em 1 permitido');
    else if (risk) concepts.push('peça exposta');

    if (type === 'q' && before.fullmove <= 4) concepts.push('dama cedo');
    if (move.castle) concepts.push('segurança do rei');
    if (CENTER.has(Core.squareName(move.toRow, move.toCol))) concepts.push('centro');
    if (Core.inCheck(after, after.turn)) concepts.push('xeque');

    const ownHanging = hangingPieces(after, mover);
    if (ownHanging.length) concepts.push('peça pendurada');

    return [...new Set(concepts)];
  }

  function analyzeMove(before, move) {
    const after = Core.makeMoveCopy(before, move);
    let classification = classifyMove(before, move, after);
    const risk = moveRisk(before, move);
    if (risk?.type === 'mate-in-one') {
      classification = { label: 'blunder', loss: Math.max(8, classification.loss), reason: 'mate-in-one' };
    }
    const mover = Core.colorOf(move.piece);
    const hangingAfter = hangingPieces(after, mover);
    const missedCapture = missedHighValueCapture(before, mover);
    const concepts = detectConcepts(before, move, after);

    let likelyCause = null;
    let confidence = 'low';

    if (risk?.type === 'mate-in-one') {
      likelyCause = 'não verificou ameaça de mate em 1';
      confidence = 'high';
    } else if (risk && risk.severity >= 2) {
      likelyCause = 'não verificou a resposta adversária imediata';
      confidence = 'high';
    } else if (hangingAfter.length && classification.loss >= 1.5) {
      likelyCause = 'deixou material vulnerável';
      confidence = 'medium';
    } else if (missedCapture && missedCapture.gain >= 2.5 && classification.loss >= 0.65) {
      likelyCause = 'não verificou capturas disponíveis';
      confidence = 'medium';
    }

    return {
      before,
      after,
      classification,
      risk,
      concepts,
      likelyCause,
      confidence,
      hangingAfter,
      heuristicEvalBefore: evaluate(before),
      heuristicEvalAfter: evaluate(after)
    };
  }

  function summarizeHistory(history, userColor) {
    const side = userColor === 'b' ? 'b' : 'w';
    const userMoves = history.filter((entry) => entry.color === side);
    const issues = userMoves.filter((entry) => entry.analysis && entry.analysis.classification.label !== 'ok');
    const exposed = userMoves.filter((entry) => entry.analysis && entry.analysis.risk);

    const conceptCount = {};
    for (const entry of issues) {
      for (const concept of entry.analysis.concepts || []) {
        conceptCount[concept] = (conceptCount[concept] || 0) + 1;
      }
    }

    const topConcepts = Object.entries(conceptCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    const critical = issues
      .slice()
      .sort((a, b) => (b.analysis.classification.loss || 0) - (a.analysis.classification.loss || 0))[0] || null;

    return {
      userMoves: userMoves.length,
      inaccuracies: issues.filter((entry) => entry.analysis.classification.label === 'inaccuracy').length,
      mistakes: issues.filter((entry) => entry.analysis.classification.label === 'mistake').length,
      blunders: issues.filter((entry) => entry.analysis.classification.label === 'blunder').length,
      exposedMoves: exposed.length,
      topConcepts,
      critical
    };
  }

  return {
    evaluate,
    pieceValue,
    hangingPieces,
    missedHighValueCapture,
    opponentMateInOne,
    moveRisk,
    classifyMove,
    analyzeMove,
    summarizeHistory
  };
});
