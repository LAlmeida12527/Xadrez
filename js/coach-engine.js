(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const api = factory(Core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraCoachEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  if (!Core) throw new Error('KiraChessCore não carregado.');

  const PIECE_NAMES = { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' };

  function pieceName(piece) {
    return PIECE_NAMES[Core.typeOf(piece || '')] || 'peça';
  }

  function piecePhrase(piece, capitalized) {
    const type = Core.typeOf(piece || '');
    const article = type === 'q' || type === 'r' ? 'a' : 'o';
    const phrase = `${article} ${pieceName(piece)}`;
    return capitalized ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  }

  function opponentColor(color) {
    return color === 'b' ? 'w' : 'b';
  }

  function isStartingMinorSquare(move, color) {
    const row = color === 'w' ? 7 : 0;
    if (move.fromRow !== row) return false;
    const type = Core.typeOf(move.piece || '');
    if (type === 'n') return move.fromCol === 1 || move.fromCol === 6;
    if (type === 'b') return move.fromCol === 2 || move.fromCol === 5;
    return false;
  }

  function directTargets(state, move, userColor) {
    if (!move) return [];
    const enemy = opponentColor(userColor);
    const targets = [];
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const target = state.board[row][col];
        if (!target || Core.colorOf(target) !== userColor) continue;
        const attackers = Core.attackersOf(state, row, col, enemy);
        if (attackers.some((attacker) => attacker.row === move.toRow && attacker.col === move.toCol)) {
          targets.push({
            piece: target,
            type: Core.typeOf(target),
            name: pieceName(target),
            square: Core.squareName(row, col)
          });
        }
      }
    }
    return targets;
  }

  function normalizeLastEntry(state, history, userColor) {
    const entries = Array.isArray(history) ? history : [];
    const last = entries[entries.length - 1] || null;
    if (!last || last.color === userColor) return null;
    const move = last.move || (last.uci && last.fenBefore ? Core.moveFromUCI(Core.parseFEN(last.fenBefore), last.uci) : null);
    if (!move) return null;
    return { entry: last, move };
  }

  function buildObservation(state, history, userColor) {
    const normalized = normalizeLastEntry(state, history, userColor);
    if (!normalized) return null;
    const { entry, move } = normalized;
    const movedPiece = state.board[move.toRow][move.toCol] || move.piece;
    const destination = Core.squareName(move.toRow, move.toCol);
    const targets = directTargets(state, move, userColor);
    const gaveCheck = Core.inCheck(state, userColor);
    const capture = Boolean(move.capture);
    const castle = Boolean(move.castle);
    const development = isStartingMinorSquare(move, entry.color);
    const centralPawnMove = Core.typeOf(movedPiece) === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(destination);

    let kind = 'quiet';
    if (gaveCheck) kind = 'check';
    else if (capture) kind = 'capture';
    else if (targets.length) kind = 'attack';
    else if (castle) kind = 'castle';
    else if (development) kind = 'development';
    else if (centralPawnMove) kind = 'center';

    const notation = entry.notation || entry.uci || `${pieceName(movedPiece)} para ${destination}`;
    const movedName = pieceName(movedPiece);
    const base = {
      kind,
      notation,
      movedName,
      destination,
      targets,
      gaveCheck,
      capture,
      castle,
      development,
      centralPawnMove,
      move
    };

    const variants = {
      check: {
        prompt: `${notation}. Antes de responder: qual é o efeito mais urgente dessa jogada?`,
        correct: 'check',
        choices: [
          ['check', 'Meu rei ficou em xeque'],
          ['attack', 'Uma peça minha foi atacada, mas meu rei está seguro'],
          ['development', 'Foi apenas desenvolvimento'],
          ['unknown', 'Não sei ainda']
        ],
        explanation: 'Seu rei está em xeque. Isso muda a ordem de pensamento: primeiro resolva o xeque; qualquer plano anterior fica em segundo plano.',
        hints: [
          `Olhe ${piecePhrase(movedPiece)} que acabou de ir para ${destination}. Não procure sua jogada ainda.`,
          'Cheque primeiro a pergunta mais urgente do xadrez: seu rei está sob ataque?',
          'Sim. Seu rei está em xeque. Agora procure somente respostas legais ao xeque.'
        ]
      },
      attack: {
        prompt: `${notation}. O que essa jogada mudou imediatamente?`,
        correct: 'attack',
        choices: [
          ['attack', 'Criou uma ameaça direta contra uma peça minha'],
          ['check', 'Deu xeque no meu rei'],
          ['quiet', 'Não criou nenhuma urgência'],
          ['unknown', 'Não sei ainda']
        ],
        explanation: `${piecePhrase(movedPiece, true)} em ${destination} passou a atacar ${targets.map((item) => `${item.name} em ${item.square}`).join(' e ')}. Antes de criar um plano novo, você precisa decidir se essa ameaça exige resposta.`,
        hints: [
          `Olhe somente para ${piecePhrase(movedPiece)} que acabou de ir para ${destination}. Quais casas essa peça controla agora?`,
          'Existe uma ameaça direta contra material seu. Encontre a peça antes de procurar uma resposta.',
          `A peça ameaçada é ${targets.map((item) => `${item.name} em ${item.square}`).join(' e ')}. Agora encontre uma resposta que lide com isso.`
        ]
      },
      capture: {
        prompt: `${notation}. Qual foi a mudança concreta mais importante?`,
        correct: 'capture',
        choices: [
          ['capture', 'O adversário capturou material'],
          ['check', 'Meu rei ficou em xeque'],
          ['development', 'Foi só desenvolvimento'],
          ['unknown', 'Não sei ainda']
        ],
        explanation: `A jogada ${notation} foi uma captura. Antes de reagir automaticamente, verifique se existe recaptura, se a peça que capturou ficou vulnerável e o que mudou nas linhas abertas.`,
        hints: [
          `Compare a casa ${destination} antes e depois do lance.`,
          'Houve uma troca de material. Não recapture no automático: confirme primeiro se a recaptura é segura.',
          'A jogada adversária foi uma captura. Agora procure recapturas, ameaças e peças que ficaram sem defesa.'
        ]
      },
      castle: {
        prompt: `${notation}. Qual foi a ideia principal desse lance?`,
        correct: 'castle',
        choices: [
          ['castle', 'Deixou o rei mais seguro e ativou a torre'],
          ['attack', 'Criou uma ameaça direta contra uma peça minha'],
          ['capture', 'Capturou material'],
          ['unknown', 'Não sei ainda']
        ],
        explanation: 'O roque melhora duas peças ao mesmo tempo: protege o rei e aproxima a torre do centro. Não existe uma ameaça obrigatória só porque o adversário fez roque.',
        hints: [
          'Observe quais duas peças mudaram de casa no mesmo lance.',
          'O rei foi para uma zona mais segura e a torre se aproximou do centro.',
          'Foi roque: segurança do rei + ativação da torre.'
        ]
      },
      development: {
        prompt: `${notation}. Qual é a leitura mais útil dessa jogada?`,
        correct: 'development',
        choices: [
          ['development', 'Desenvolveu uma peça e aumentou o controle do tabuleiro'],
          ['check', 'Deu xeque'],
          ['capture', 'Capturou material'],
          ['unknown', 'Não sei ainda']
        ],
        explanation: `${piecePhrase(movedPiece, true)} saiu da posição inicial para ${destination}. É desenvolvimento: uma peça entrou no jogo e passou a controlar novas casas. Agora verifique se surgiu alguma ameaça indireta antes de continuar seu próprio desenvolvimento.`,
        hints: [
          `${piecePhrase(movedPiece, true)} saiu de uma casa inicial. Pergunte se ficou mais ativa.`,
          'Não houve captura nem xeque. Pense em desenvolvimento e controle de casas.',
          `${piecePhrase(movedPiece, true)} foi desenvolvida para ${destination}. Agora veja se isso também mudou alguma linha ou defesa.`
        ]
      },
      center: {
        prompt: `${notation}. Qual é a ideia principal dessa jogada?`,
        correct: 'center',
        choices: [
          ['center', 'Disputou espaço e controle no centro'],
          ['check', 'Deu xeque no meu rei'],
          ['capture', 'Capturou material'],
          ['unknown', 'Não sei ainda']
        ],
        explanation: `${piecePhrase(movedPiece, true)} avançou para ${destination} e passou a disputar o centro. Isso importa porque peças desenvolvidas ficam mais fortes quando têm espaço e casas centrais. Agora veja se você deve responder no centro ou continuar o desenvolvimento.`,
        hints: [
          `Olhe a casa ${destination}. Ela fica no coração do tabuleiro.`,
          'Não houve xeque nem captura. Pense em espaço e controle de casas centrais.',
          `O lance ${notation} disputa o centro. Agora decida se você precisa responder ali ou se pode continuar desenvolvendo.`
        ]
      },
      quiet: {
        prompt: `${notation}. Não há uma urgência óbvia. O que você faz antes de escolher seu lance?`,
        correct: 'quiet',
        choices: [
          ['quiet', 'Confirmo ameaças/capturas e depois procuro melhorar minha pior peça'],
          ['check', 'Respondo a um xeque'],
          ['capture', 'Recapturo material imediatamente'],
          ['unknown', 'Não sei como começar']
        ],
        explanation: 'Nem todo lance cria uma ameaça imediata. Quando nada é urgente, o processo é: confira xeques/capturas/ameaças e depois melhore desenvolvimento, rei ou a pior peça.',
        hints: [
          `Olhe ${piecePhrase(movedPiece)} em ${destination}: não há xeque nem captura que obrigue uma resposta imediata.`,
          'Quando não existe urgência, não invente ataque. Faça a varredura de segurança e procure sua pior peça.',
          'A posição permite pensar em plano: desenvolvimento, segurança do rei, centro e melhoria da pior peça.'
        ]
      }
    };

    return { ...base, ...variants[kind] };
  }

  function evaluateChoice(observation, choice) {
    if (!observation) return { result: 'invalid' };
    if (choice === 'unknown') return { result: 'unknown' };
    return { result: choice === observation.correct ? 'correct' : 'incorrect' };
  }

  return { buildObservation, evaluateChoice, pieceName };
});
