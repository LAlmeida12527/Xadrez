(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraChessCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FILES = 'abcdefgh';
  const PIECES = {
    K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
    k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
  };
  const VALUES = { p: 1, n: 3.1, b: 3.25, r: 5, q: 9, k: 100 };

  function colorOf(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? 'w' : 'b';
  }

  function typeOf(piece) {
    return piece ? piece.toLowerCase() : null;
  }

  function inBoard(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function squareName(row, col) {
    if (!inBoard(row, col)) return null;
    return FILES[col] + (8 - row);
  }

  function parseSquare(name) {
    if (!/^[a-h][1-8]$/.test(name || '')) return null;
    return { row: 8 - Number(name[1]), col: FILES.indexOf(name[0]) };
  }

  function cloneBoard(board) {
    return board.map((rank) => rank.slice());
  }

  function initialBoard() {
    return [
      ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
      ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
      ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];
  }

  function createInitialState() {
    return {
      board: initialBoard(),
      turn: 'w',
      castle: { K: true, Q: true, k: true, q: true },
      ep: null,
      halfmove: 0,
      fullmove: 1,
      lastMove: null
    };
  }

  function cloneState(state) {
    return {
      board: cloneBoard(state.board),
      turn: state.turn,
      castle: { ...state.castle },
      ep: state.ep ? { ...state.ep } : null,
      halfmove: Number.isFinite(state.halfmove) ? state.halfmove : 0,
      fullmove: Number.isFinite(state.fullmove) ? state.fullmove : 1,
      lastMove: state.lastMove ? { ...state.lastMove } : null
    };
  }

  function parseFEN(fen) {
    if (typeof fen !== 'string') throw new Error('FEN inválida.');
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error('FEN incompleta.');

    const placement = parts[0];
    const turn = parts[1];
    const castleText = parts[2];
    const epText = parts[3];
    const halfmove = Number(parts[4] || 0);
    const fullmove = Number(parts[5] || 1);

    if (!['w', 'b'].includes(turn)) throw new Error('Turno inválido na FEN.');

    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error('A FEN precisa ter 8 fileiras.');

    const board = ranks.map((rank) => {
      const cells = [];
      for (const char of rank) {
        if (/^[1-8]$/.test(char)) {
          for (let i = 0; i < Number(char); i += 1) cells.push(null);
        } else if (/^[prnbqkPRNBQK]$/.test(char)) {
          cells.push(char);
        } else {
          throw new Error('Peça inválida na FEN.');
        }
      }
      if (cells.length !== 8) throw new Error('Fileira inválida na FEN.');
      return cells;
    });

    const ep = epText === '-' ? null : parseSquare(epText);
    if (epText !== '-' && !ep) throw new Error('Casa de en passant inválida.');

    return {
      board,
      turn,
      castle: {
        K: castleText.includes('K'),
        Q: castleText.includes('Q'),
        k: castleText.includes('k'),
        q: castleText.includes('q')
      },
      ep,
      halfmove: Number.isFinite(halfmove) ? halfmove : 0,
      fullmove: Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1,
      lastMove: null
    };
  }

  function toFEN(state) {
    const ranks = state.board.map((rank) => {
      let text = '';
      let empty = 0;
      for (const piece of rank) {
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) text += String(empty);
        empty = 0;
        text += piece;
      }
      if (empty) text += String(empty);
      return text;
    });

    const castle = ['K', 'Q', 'k', 'q'].filter((key) => state.castle[key]).join('') || '-';
    const ep = state.ep ? squareName(state.ep.row, state.ep.col) : '-';
    return `${ranks.join('/')} ${state.turn} ${castle} ${ep} ${state.halfmove || 0} ${state.fullmove || 1}`;
  }

  function repetitionKey(state) {
    return toFEN(state).split(' ').slice(0, 4).join(' ');
  }

  function kingPosition(state, color) {
    const king = color === 'w' ? 'K' : 'k';
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        if (state.board[row][col] === king) return { row, col };
      }
    }
    return null;
  }

  function isSquareAttacked(state, row, col, byColor) {
    const pawn = byColor === 'w' ? 'P' : 'p';
    const pawnOriginRow = row + (byColor === 'w' ? 1 : -1);
    for (const dc of [-1, 1]) {
      const sourceCol = col + dc;
      if (inBoard(pawnOriginRow, sourceCol) && state.board[pawnOriginRow][sourceCol] === pawn) return true;
    }

    const knight = byColor === 'w' ? 'N' : 'n';
    const knightOffsets = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightOffsets) {
      const r = row + dr;
      const c = col + dc;
      if (inBoard(r, c) && state.board[r][c] === knight) return true;
    }

    const king = byColor === 'w' ? 'K' : 'k';
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const r = row + dr;
        const c = col + dc;
        if (inBoard(r, c) && state.board[r][c] === king) return true;
      }
    }

    const bishop = byColor === 'w' ? 'B' : 'b';
    const rook = byColor === 'w' ? 'R' : 'r';
    const queen = byColor === 'w' ? 'Q' : 'q';
    const rays = [
      [-1, -1, [bishop, queen]], [-1, 1, [bishop, queen]],
      [1, -1, [bishop, queen]], [1, 1, [bishop, queen]],
      [-1, 0, [rook, queen]], [1, 0, [rook, queen]],
      [0, -1, [rook, queen]], [0, 1, [rook, queen]]
    ];

    for (const [dr, dc, allowed] of rays) {
      let r = row + dr;
      let c = col + dc;
      while (inBoard(r, c)) {
        const piece = state.board[r][c];
        if (piece) {
          if (allowed.includes(piece)) return true;
          break;
        }
        r += dr;
        c += dc;
      }
    }

    return false;
  }

  function inCheck(state, color) {
    const king = kingPosition(state, color);
    if (!king) return true;
    const enemy = color === 'w' ? 'b' : 'w';
    return isSquareAttacked(state, king.row, king.col, enemy);
  }

  function pushStepMove(state, moves, fromRow, fromCol, toRow, toCol, piece, color) {
    if (!inBoard(toRow, toCol)) return;
    const target = state.board[toRow][toCol];
    if (!target || colorOf(target) !== color) {
      moves.push({
        fromRow,
        fromCol,
        toRow,
        toCol,
        piece,
        capture: target || null,
        promotion: null,
        castle: null,
        enPassant: false,
        doublePawn: false
      });
    }
  }

  function generatePseudoMoves(state, color) {
    const moves = [];

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = state.board[row][col];
        if (!piece || colorOf(piece) !== color) continue;

        const type = typeOf(piece);

        if (type === 'p') {
          const direction = color === 'w' ? -1 : 1;
          const startRow = color === 'w' ? 6 : 1;
          const promotionRow = color === 'w' ? 0 : 7;
          const oneRow = row + direction;

          if (inBoard(oneRow, col) && !state.board[oneRow][col]) {
            const promotions = oneRow === promotionRow ? ['q', 'r', 'b', 'n'] : [null];
            for (const promotion of promotions) {
              moves.push({
                fromRow: row,
                fromCol: col,
                toRow: oneRow,
                toCol: col,
                piece,
                capture: null,
                promotion,
                castle: null,
                enPassant: false,
                doublePawn: false
              });
            }

            const twoRow = row + (2 * direction);
            if (row === startRow && !state.board[twoRow][col]) {
              moves.push({
                fromRow: row,
                fromCol: col,
                toRow: twoRow,
                toCol: col,
                piece,
                capture: null,
                promotion: null,
                castle: null,
                enPassant: false,
                doublePawn: true
              });
            }
          }

          for (const dc of [-1, 1]) {
            const targetRow = row + direction;
            const targetCol = col + dc;
            if (!inBoard(targetRow, targetCol)) continue;
            const target = state.board[targetRow][targetCol];

            if (target && colorOf(target) !== color) {
              const promotions = targetRow === promotionRow ? ['q', 'r', 'b', 'n'] : [null];
              for (const promotion of promotions) {
                moves.push({
                  fromRow: row,
                  fromCol: col,
                  toRow: targetRow,
                  toCol: targetCol,
                  piece,
                  capture: target,
                  promotion,
                  castle: null,
                  enPassant: false,
                  doublePawn: false
                });
              }
            }

            if (state.ep && state.ep.row === targetRow && state.ep.col === targetCol) {
              const captured = state.board[row][targetCol];
              const expected = color === 'w' ? 'p' : 'P';
              if (captured === expected) {
                moves.push({
                  fromRow: row,
                  fromCol: col,
                  toRow: targetRow,
                  toCol: targetCol,
                  piece,
                  capture: captured,
                  promotion: null,
                  castle: null,
                  enPassant: true,
                  doublePawn: false
                });
              }
            }
          }
          continue;
        }

        if (type === 'n') {
          const offsets = [
            [-2, -1], [-2, 1], [-1, -2], [-1, 2],
            [1, -2], [1, 2], [2, -1], [2, 1]
          ];
          for (const [dr, dc] of offsets) {
            pushStepMove(state, moves, row, col, row + dr, col + dc, piece, color);
          }
          continue;
        }

        if (['b', 'r', 'q'].includes(type)) {
          const directions = [];
          if (type === 'b' || type === 'q') directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
          if (type === 'r' || type === 'q') directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);

          for (const [dr, dc] of directions) {
            let targetRow = row + dr;
            let targetCol = col + dc;
            while (inBoard(targetRow, targetCol)) {
              const target = state.board[targetRow][targetCol];
              if (!target) {
                moves.push({
                  fromRow: row,
                  fromCol: col,
                  toRow: targetRow,
                  toCol: targetCol,
                  piece,
                  capture: null,
                  promotion: null,
                  castle: null,
                  enPassant: false,
                  doublePawn: false
                });
              } else {
                if (colorOf(target) !== color) {
                  moves.push({
                    fromRow: row,
                    fromCol: col,
                    toRow: targetRow,
                    toCol: targetCol,
                    piece,
                    capture: target,
                    promotion: null,
                    castle: null,
                    enPassant: false,
                    doublePawn: false
                  });
                }
                break;
              }
              targetRow += dr;
              targetCol += dc;
            }
          }
          continue;
        }

        if (type === 'k') {
          for (let dr = -1; dr <= 1; dr += 1) {
            for (let dc = -1; dc <= 1; dc += 1) {
              if (!dr && !dc) continue;
              pushStepMove(state, moves, row, col, row + dr, col + dc, piece, color);
            }
          }

          const enemy = color === 'w' ? 'b' : 'w';
          if (color === 'w' && row === 7 && col === 4 && !inCheck(state, 'w')) {
            if (
              state.castle.K && state.board[7][7] === 'R' &&
              !state.board[7][5] && !state.board[7][6] &&
              !isSquareAttacked(state, 7, 5, enemy) && !isSquareAttacked(state, 7, 6, enemy)
            ) {
              moves.push({ fromRow: 7, fromCol: 4, toRow: 7, toCol: 6, piece, capture: null, promotion: null, castle: 'K', enPassant: false, doublePawn: false });
            }
            if (
              state.castle.Q && state.board[7][0] === 'R' &&
              !state.board[7][1] && !state.board[7][2] && !state.board[7][3] &&
              !isSquareAttacked(state, 7, 3, enemy) && !isSquareAttacked(state, 7, 2, enemy)
            ) {
              moves.push({ fromRow: 7, fromCol: 4, toRow: 7, toCol: 2, piece, capture: null, promotion: null, castle: 'Q', enPassant: false, doublePawn: false });
            }
          }

          if (color === 'b' && row === 0 && col === 4 && !inCheck(state, 'b')) {
            if (
              state.castle.k && state.board[0][7] === 'r' &&
              !state.board[0][5] && !state.board[0][6] &&
              !isSquareAttacked(state, 0, 5, enemy) && !isSquareAttacked(state, 0, 6, enemy)
            ) {
              moves.push({ fromRow: 0, fromCol: 4, toRow: 0, toCol: 6, piece, capture: null, promotion: null, castle: 'k', enPassant: false, doublePawn: false });
            }
            if (
              state.castle.q && state.board[0][0] === 'r' &&
              !state.board[0][1] && !state.board[0][2] && !state.board[0][3] &&
              !isSquareAttacked(state, 0, 3, enemy) && !isSquareAttacked(state, 0, 2, enemy)
            ) {
              moves.push({ fromRow: 0, fromCol: 4, toRow: 0, toCol: 2, piece, capture: null, promotion: null, castle: 'q', enPassant: false, doublePawn: false });
            }
          }
        }
      }
    }

    return moves;
  }

  function updateCastlingRights(state, move, movingPiece) {
    if (movingPiece === 'K') {
      state.castle.K = false;
      state.castle.Q = false;
    }
    if (movingPiece === 'k') {
      state.castle.k = false;
      state.castle.q = false;
    }

    if (movingPiece === 'R' && move.fromRow === 7 && move.fromCol === 0) state.castle.Q = false;
    if (movingPiece === 'R' && move.fromRow === 7 && move.fromCol === 7) state.castle.K = false;
    if (movingPiece === 'r' && move.fromRow === 0 && move.fromCol === 0) state.castle.q = false;
    if (movingPiece === 'r' && move.fromRow === 0 && move.fromCol === 7) state.castle.k = false;

    if (move.capture === 'R' && move.toRow === 7 && move.toCol === 0) state.castle.Q = false;
    if (move.capture === 'R' && move.toRow === 7 && move.toCol === 7) state.castle.K = false;
    if (move.capture === 'r' && move.toRow === 0 && move.toCol === 0) state.castle.q = false;
    if (move.capture === 'r' && move.toRow === 0 && move.toCol === 7) state.castle.k = false;
  }

  function applyMove(state, move) {
    const movingPiece = state.board[move.fromRow][move.fromCol];
    if (!movingPiece) throw new Error('Não existe peça na casa de origem.');

    const color = colorOf(movingPiece);
    const isPawn = typeOf(movingPiece) === 'p';
    const isCapture = Boolean(move.capture);

    state.board[move.fromRow][move.fromCol] = null;

    if (move.enPassant) {
      state.board[move.fromRow][move.toCol] = null;
    }

    const promoted = move.promotion
      ? (color === 'w' ? move.promotion.toUpperCase() : move.promotion.toLowerCase())
      : movingPiece;
    state.board[move.toRow][move.toCol] = promoted;

    if (move.castle) {
      if (move.toCol === 6) {
        state.board[move.toRow][5] = state.board[move.toRow][7];
        state.board[move.toRow][7] = null;
      } else {
        state.board[move.toRow][3] = state.board[move.toRow][0];
        state.board[move.toRow][0] = null;
      }
    }

    updateCastlingRights(state, move, movingPiece);

    state.ep = move.doublePawn
      ? { row: (move.fromRow + move.toRow) / 2, col: move.fromCol }
      : null;

    state.halfmove = isPawn || isCapture ? 0 : (state.halfmove || 0) + 1;
    if (color === 'b') state.fullmove = (state.fullmove || 1) + 1;

    state.lastMove = {
      fromRow: move.fromRow,
      fromCol: move.fromCol,
      toRow: move.toRow,
      toCol: move.toCol
    };
    state.turn = color === 'w' ? 'b' : 'w';
    return state;
  }

  function makeMoveCopy(state, move) {
    const copy = cloneState(state);
    applyMove(copy, move);
    return copy;
  }

  function generateLegalMoves(state, color) {
    const movingColor = color || state.turn;
    return generatePseudoMoves(state, movingColor).filter((move) => {
      const copy = cloneState(state);
      applyMove(copy, move);
      return !inCheck(copy, movingColor);
    });
  }

  function findLegalMove(state, fromSquare, toSquare, promotion) {
    const from = typeof fromSquare === 'string' ? parseSquare(fromSquare) : fromSquare;
    const to = typeof toSquare === 'string' ? parseSquare(toSquare) : toSquare;
    if (!from || !to) return null;

    const matches = generateLegalMoves(state).filter((move) => (
      move.fromRow === from.row && move.fromCol === from.col &&
      move.toRow === to.row && move.toCol === to.col
    ));
    if (!matches.length) return null;

    if (matches.length === 1 && !matches[0].promotion) return matches[0];
    const requested = (promotion || 'q').toLowerCase();
    return matches.find((move) => move.promotion === requested) || matches[0];
  }

  function moveToUCI(move) {
    if (!move) return null;
    const promotion = move.promotion || '';
    return `${squareName(move.fromRow, move.fromCol)}${squareName(move.toRow, move.toCol)}${promotion}`;
  }

  function moveFromUCI(state, uci) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
    return findLegalMove(state, uci.slice(0, 2), uci.slice(2, 4), uci[4] || null);
  }

  function attackersOf(state, row, col, byColor, legalOnly) {
    const generator = legalOnly ? generateLegalMoves : generatePseudoMoves;
    return generator(state, byColor).filter((move) => move.toRow === row && move.toCol === col && move.capture);
  }

  function materialScore(state) {
    let score = 0;
    for (const rank of state.board) {
      for (const piece of rank) {
        if (!piece) continue;
        const value = VALUES[typeOf(piece)] || 0;
        score += colorOf(piece) === 'w' ? value : -value;
      }
    }
    return score;
  }

  function insufficientMaterial(state) {
    const nonKings = [];
    const bishops = [];

    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = state.board[row][col];
        if (!piece || typeOf(piece) === 'k') continue;
        const type = typeOf(piece);
        nonKings.push({ type, row, col, color: colorOf(piece) });
        if (type === 'b') bishops.push({ row, col });
      }
    }

    if (nonKings.length === 0) return true;
    if (nonKings.length === 1 && ['b', 'n'].includes(nonKings[0].type)) return true;

    if (nonKings.every((entry) => entry.type === 'b')) {
      const squareColors = bishops.map(({ row, col }) => (row + col) % 2);
      return squareColors.every((value) => value === squareColors[0]);
    }

    return false;
  }

  function gameStatus(state, repetitionCounts) {
    const legal = generateLegalMoves(state);
    if (legal.length === 0) {
      if (inCheck(state, state.turn)) {
        return {
          ended: true,
          reason: 'checkmate',
          winner: state.turn === 'w' ? 'b' : 'w'
        };
      }
      return { ended: true, reason: 'stalemate', winner: null };
    }

    if ((state.halfmove || 0) >= 100) return { ended: true, reason: 'fifty-move', winner: null };
    if (insufficientMaterial(state)) return { ended: true, reason: 'insufficient-material', winner: null };

    if (repetitionCounts) {
      const count = repetitionCounts[repetitionKey(state)] || 0;
      if (count >= 3) return { ended: true, reason: 'threefold-repetition', winner: null };
    }

    return { ended: false, reason: null, winner: null };
  }

  function sanNotation(before, move, after) {
    if (move.castle) return move.toCol === 6 ? 'O-O' : 'O-O-O';

    const movingType = typeOf(move.piece);
    let text = movingType === 'p' ? '' : move.piece.toUpperCase();

    if (movingType !== 'p') {
      const siblings = generateLegalMoves(before, colorOf(move.piece)).filter((candidate) => (
        candidate !== move &&
        typeOf(candidate.piece) === movingType &&
        candidate.toRow === move.toRow &&
        candidate.toCol === move.toCol &&
        (candidate.fromRow !== move.fromRow || candidate.fromCol !== move.fromCol)
      ));

      if (siblings.length) {
        const sameFile = siblings.some((candidate) => candidate.fromCol === move.fromCol);
        const sameRank = siblings.some((candidate) => candidate.fromRow === move.fromRow);
        if (!sameFile) text += FILES[move.fromCol];
        else if (!sameRank) text += String(8 - move.fromRow);
        else text += FILES[move.fromCol] + String(8 - move.fromRow);
      }
    }

    if (move.capture) {
      if (movingType === 'p') text += FILES[move.fromCol];
      text += 'x';
    }

    text += squareName(move.toRow, move.toCol);
    if (move.promotion) text += `=${move.promotion.toUpperCase()}`;

    if (inCheck(after, after.turn)) {
      text += generateLegalMoves(after).length === 0 ? '#' : '+';
    }

    return text;
  }

  function normalizeSAN(value) {
    let san = String(value || '').trim();
    san = san.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    san = san.replace(/[!?]+$/g, '');
    san = san.replace(/[+#]+$/g, '');
    san = san.replace(/\s*e\.p\.?$/i, '');
    san = san.replace(/^([a-h][18])([QRBN])$/i, '$1=$2');
    return san;
  }

  function moveFromSAN(state, san) {
    const target = normalizeSAN(san);
    if (!target) return null;

    const matches = generateLegalMoves(state).filter((move) => {
      const after = makeMoveCopy(state, move);
      return normalizeSAN(sanNotation(state, move, after)) === target;
    });

    return matches.length === 1 ? matches[0] : null;
  }

  function parsePgnHeaders(pgn) {
    const headers = {};
    const text = String(pgn || '');
    const regex = /^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\]\s*$/gm;
    let match;
    while ((match = regex.exec(text))) {
      headers[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return headers;
  }

  function removePgnVariations(text) {
    let depth = 0;
    let output = '';
    for (const char of String(text || '')) {
      if (char === '(') {
        depth += 1;
        continue;
      }
      if (char === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0) output += char;
    }
    return output;
  }

  function tokenizePGN(pgn) {
    let body = String(pgn || '')
      .replace(/^\s*\[[^\n\r]*\]\s*$/gm, ' ')
      .replace(/\{[\s\S]*?\}/g, ' ')
      .replace(/;[^\n\r]*/g, ' ')
      .replace(/\$\d+/g, ' ');

    body = removePgnVariations(body);
    body = body.replace(/\d+\.(?:\.\.)?/g, ' ');

    return body
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => token !== '...' && !/^\d+\.+$/.test(token));
  }

  function parsePGN(pgn) {
    const headers = parsePgnHeaders(pgn);
    const initial = headers.FEN ? parseFEN(headers.FEN) : createInitialState();
    const state = cloneState(initial);
    const moves = [];
    let result = headers.Result || '*';
    const resultTokens = new Set(['1-0', '0-1', '1/2-1/2', '*']);

    for (const token of tokenizePGN(pgn)) {
      if (resultTokens.has(token)) {
        result = token;
        continue;
      }
      if (/^e\.p\.?$/i.test(token)) continue;

      const before = cloneState(state);
      const move = moveFromSAN(state, token);
      if (!move) {
        throw new Error(`Não foi possível interpretar o lance "${token}" no meio-lance ${moves.length + 1}.`);
      }
      applyMove(state, move);
      const notation = sanNotation(before, move, state);
      moves.push({
        color: colorOf(move.piece),
        notation,
        uci: moveToUCI(move),
        move: { ...move },
        fenBefore: toFEN(before),
        fenAfter: toFEN(state)
      });
    }

    return {
      headers,
      result,
      initialState: cloneState(initial),
      finalState: cloneState(state),
      moves
    };
  }

  function perft(state, depth) {
    if (depth === 0) return 1;
    let nodes = 0;
    for (const move of generateLegalMoves(state)) {
      nodes += perft(makeMoveCopy(state, move), depth - 1);
    }
    return nodes;
  }

  return {
    FILES,
    PIECES,
    VALUES,
    colorOf,
    typeOf,
    inBoard,
    squareName,
    parseSquare,
    cloneBoard,
    initialBoard,
    createInitialState,
    cloneState,
    parseFEN,
    toFEN,
    repetitionKey,
    kingPosition,
    isSquareAttacked,
    inCheck,
    generatePseudoMoves,
    generateLegalMoves,
    applyMove,
    makeMoveCopy,
    findLegalMove,
    moveToUCI,
    moveFromUCI,
    attackersOf,
    materialScore,
    insufficientMaterial,
    gameStatus,
    sanNotation,
    normalizeSAN,
    moveFromSAN,
    parsePgnHeaders,
    tokenizePGN,
    parsePGN,
    perft
  };
});
