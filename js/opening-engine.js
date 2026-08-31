(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const api = factory(Core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraOpeningEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  if (!Core) throw new Error('KiraChessCore não carregado.');

  const OPENINGS = [
    {
      id: 'italian', name: 'Abertura Italiana', side: 'Brancas', family: 'aberta', difficulty: 1,
      tags: ['active', 'bishop', 'classical', 'beginner'],
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'd2d3', 'g8f6', 'e1g1'],
      notation: '1.e4 e5 2.Cf3 Cc6 3.Bc4 Bc5 4.d3 Cf6 5.O-O',
      lessonIdeas: { e2e4: 'Ocupe o centro e abra caminho para o bispo e a dama.', g1f3: 'Desenvolva com tempo: o cavalo entra no jogo e pressiona e5.', f1c4: 'Ative o bispo na diagonal que olha para f7, sem transformar isso numa obrigação de atacar.', d2d3: 'Dê suporte ao centro e abra o bispo de c1 antes de pensar em aventuras.', e1g1: 'Agora proteja o rei e conecte a torre ao jogo: é hora do roque.' },
      why: 'Desenvolve rápido, coloca o bispo em c4 e ensina centro, roque e iniciativa sem exigir muita decoração.',
      after: ['Faça roque cedo quando for seguro.', 'Coloque a torre em e1 e prepare d4 quando fizer sentido.', 'Antes de atacar f7, termine o desenvolvimento.', 'Se não houver tática, melhore a pior peça.']
    },
    {
      id: 'bishop', name: 'Abertura do Bispo', side: 'Brancas', family: 'aberta', difficulty: 1,
      tags: ['active', 'bishop', 'familiar', 'beginner'],
      moves: ['e2e4', 'e7e5', 'f1c4', 'g8f6', 'd2d3', 'f8c5', 'g1f3', 'd7d6', 'e1g1'],
      notation: '1.e4 e5 2.Bc4 Cf6 3.d3 Bc5 4.Cf3 d6 5.O-O',
      lessonIdeas: { e2e4: 'Abra o centro e libere o bispo de f1.', f1c4: 'Leve o bispo para uma diagonal ativa e force o adversário a respeitar f7.', d2d3: 'Estabilize e4 e libere o bispo de c1.', g1f3: 'Desenvolva o cavalo e prepare o roque.', e1g1: 'Complete a primeira missão da abertura: rei seguro.' },
      why: 'Parte de uma ideia que já pode parecer natural para você: abrir o centro e ativar o bispo imediatamente.',
      after: ['Desenvolva Cf3 e faça roque.', 'Não transforme a pressão em f7 numa obrigação de atacar.', 'Use d3 ou d4 conforme a posição pedir.', 'Traga as torres para colunas centrais.']
    },
    {
      id: 'vienna', name: 'Abertura Vienense', side: 'Brancas', family: 'aberta', difficulty: 2,
      tags: ['active', 'tactical', 'classical'],
      moves: ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1'],
      notation: '1.e4 e5 2.Cc3 Cf6 3.Cf3 Cc6 4.Bc4 Bc5 5.O-O',
      lessonIdeas: { e2e4: 'Tome espaço no centro e abra suas peças.', b1c3: 'A Vienense começa desenvolvendo o cavalo de b1 sem bloquear o peão f.', g1f3: 'Traga o outro cavalo antes de iniciar qualquer ataque.', f1c4: 'Ative o bispo e coloque pressão no centro do rei.', e1g1: 'Rei seguro antes de acelerar.' },
      why: 'Mantém jogo aberto e flexível. Combina com quem gosta de iniciativa sem precisar sair cedo com a dama.',
      after: ['Desenvolva Cf3 ou f4 apenas entendendo o risco.', 'Ative o bispo de f1.', 'Faça roque antes de começar um ataque sério.', 'Procure d4 para disputar mais espaço no centro.']
    },
    {
      id: 'scotch', name: 'Abertura Escocesa', side: 'Brancas', family: 'aberta', difficulty: 2,
      tags: ['active', 'tactical', 'center'],
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6', 'b1c3'],
      notation: '1.e4 e5 2.Cf3 Cc6 3.d4 exd4 4.Cxd4 Cf6 5.Cc3',
      lessonIdeas: { e2e4: 'Ocupe o centro.', g1f3: 'Desenvolva atacando o peão e5.', d2d4: 'A Escocesa abre o centro cedo porque suas peças conseguem ocupar as linhas.', f3d4: 'Recupere o peão com uma peça desenvolvida, não com a dama.', b1c3: 'Complete o desenvolvimento central e aumente o controle de d5 e e4.' },
      why: 'Abre o centro cedo e deixa claras as consequências de cada lance. Boa para aprender cálculo curto.',
      after: ['Recupere o centro sem mover a dama por impulso.', 'Desenvolva as peças com tempo.', 'Use colunas abertas para as torres.', 'Calcule antes de capturar no centro.']
    },
    {
      id: 'london', name: 'Sistema Londres', side: 'Brancas', family: 'estrutura', difficulty: 1,
      tags: ['solid', 'positional', 'bishop'],
      moves: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4', 'e7e6', 'e2e3', 'f8d6', 'f1d3'],
      notation: '1.d4 d5 2.Cf3 Cf6 3.Bf4 e6 4.e3 Bd6 5.Bd3',
      lessonIdeas: { d2d4: 'Construa um centro estável.', g1f3: 'Desenvolva sem bloquear o bispo de c1.', c1f4: 'Coloque o bispo fora da cadeia de peões antes de jogar e3.', e2e3: 'Sustente d4 e libere o bispo de f1.', f1d3: 'Aponte para o rei e prepare o roque.' },
      why: 'Cria uma estrutura estável e ativa o bispo cedo. Útil se você preferir planos claros a confronto imediato.',
      after: ['Complete e3, Bd3 e roque.', 'Não jogue no automático: observe quando c4 ou e4 são possíveis.', 'Use Ce5 como posto avançado quando seguro.', 'Melhore a torre e a dama antes de atacar.']
    },
    {
      id: 'qg', name: 'Gambito da Dama', side: 'Brancas', family: 'posicional', difficulty: 2,
      tags: ['positional', 'classical', 'center'],
      moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'g1f3'],
      notation: '1.d4 d5 2.c4 e6 3.Cc3 Cf6 4.Cf3',
      lessonIdeas: { d2d4: 'Ocupe o centro com uma base sólida.', c2c4: 'Pressione d5: o gambito é sobre espaço e centro, não sobre dar um peão por esporte.', b1c3: 'Aumente a pressão em d5 e desenvolva.', g1f3: 'Complete o desenvolvimento natural antes de decidir a estrutura.' },
      why: 'Ensina pressão central e desenvolvimento com propósito. Ótimo quando você começa a pensar além de ataques diretos.',
      after: ['Desenvolva Cc3, Cf3 e o bispo.', 'Entenda a tensão no centro antes de trocar peões.', 'Faça roque e use as colunas semiabertas.', 'Procure rupturas e peças mal colocadas.']
    },
    {
      id: 'e5-black', name: 'Jogo Aberto com ...e5', side: 'Pretas vs 1.e4', family: 'clássica', difficulty: 1,
      tags: ['active', 'classical', 'beginner', 'solid'],
      moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'],
      notation: '1.e4 e5 2.Cf3 Cc6 3.Bc4 Cf6',
      lessonIdeas: { e7e5: 'Responda no centro. Você não precisa inventar uma defesa exótica.', b8c6: 'Defenda e5 enquanto desenvolve uma peça.', g8f6: 'Ataque e4, desenvolva e prepare o roque.' },
      why: 'É a resposta mais didática para aprender desenvolvimento, centro e defesa de ameaças sem esconder os princípios.',
      after: ['Desenvolva Cf6 ou Bc5 conforme a posição.', 'Faça roque.', 'Não tente defender e5 com peões demais.', 'Responda ao centro antes de atacar nas alas.']
    },
    {
      id: 'caro', name: 'Defesa Caro-Kann', side: 'Pretas vs 1.e4', family: 'sólida', difficulty: 2,
      tags: ['solid', 'positional'],
      moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4'],
      notation: '1.e4 c6 2.d4 d5 3.Cc3 dxe4',
      lessonIdeas: { c7c6: 'Prepare ...d5 sem bloquear o bispo de c8.', d7d5: 'Ataque o centro branco imediatamente.', d5e4: 'Quando o centro permitir, troque e force as brancas a recuperar o peão.' },
      why: 'Boa opção se o seu estilo mostrar preferência por estrutura e segurança, mas eu não priorizaria antes dos princípios básicos.',
      after: ['Ataque o centro branco.', 'Desenvolva o bispo de c8 antes de fechar demais a posição.', 'Evite jogar passivamente só porque a estrutura é sólida.', 'Complete o desenvolvimento e faça roque.']
    },
    {
      id: 'qgd-black', name: 'Gambito da Dama Recusado', side: 'Pretas vs 1.d4', family: 'sólida', difficulty: 2,
      tags: ['solid', 'positional', 'classical'],
      moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'],
      notation: '1.d4 d5 2.c4 e6 3.Cc3 Cf6',
      lessonIdeas: { d7d5: 'Responda ocupando o centro.', e7e6: 'Defenda d5 e construa uma estrutura sólida, aceitando que o bispo de c8 precisa de um plano.', g8f6: 'Desenvolva pressionando o centro e preparando o roque.' },
      why: 'Estrutura clássica e segura para aprender como defender o centro sem decorar armadilhas.',
      after: ['Desenvolva Cf6 e Be7.', 'Faça roque.', 'Prepare c5 ou e5 quando estiver desenvolvido.', 'Não prenda o bispo de c8 para sempre.']
    }
  ];

  function lessonIdea(opening, uci, state) {
    if (!opening) return 'Entenda a função do lance antes de memorizar a casa.';
    if (opening.lessonIdeas && opening.lessonIdeas[uci]) return opening.lessonIdeas[uci];
    const move = state ? Core.moveFromUCI(state, uci) : null;
    if (!move) return 'Observe qual problema este lance resolve.';
    const type = Core.typeOf(move.piece);
    const target = Core.squareName(move.toRow, move.toCol);
    if (move.castle) return 'Proteja o rei e ative a torre: o roque conclui a primeira fase da abertura.';
    if (type === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(target)) return 'Dispute o centro e abra linhas para suas peças.';
    if (type === 'n') return 'Desenvolva o cavalo para uma casa útil, olhando o centro.';
    if (type === 'b') return 'Ative o bispo numa diagonal com propósito.';
    return 'Melhore a posição de uma peça e mantenha o rei seguro.';
  }

  function stateAfterMoves(moves) {
    let state = Core.createInitialState();
    for (const uci of moves || []) {
      const move = Core.moveFromUCI(state, uci);
      if (!move) throw new Error(`Linha de abertura inválida em ${uci}.`);
      state = Core.makeMoveCopy(state, move);
    }
    return state;
  }

  function recommendationScore(opening, assessment) {
    const style = assessment?.style || {};
    const scores = style.scores || {};
    let score = 0;
    if (opening.tags.includes('beginner')) score += 2.1;
    if (opening.tags.includes('bishop') && style.bishopAffinity) score += 2.4;
    if (opening.tags.includes('active')) score += Number(scores.active || 0) * 0.45;
    if (opening.tags.includes('tactical')) score += Number(scores.tactical || 0) * 0.42;
    if (opening.tags.includes('solid')) score += Number(scores.solid || 0) * 0.45;
    if (opening.tags.includes('positional')) score += Number(scores.positional || 0) * 0.45;
    if (opening.tags.includes('classical')) score += Number(scores.classical || 0) * 0.25;
    score -= Math.max(0, opening.difficulty - 1) * 0.28;
    return score;
  }

  function recommended(assessment) {
    if (!assessment?.completed) return [];
    return OPENINGS
      .map((opening) => ({ ...opening, score: recommendationScore(opening, assessment) }))
      .sort((a, b) => b.score - a.score);
  }

  function recommendedByContext(assessment) {
    const all = recommended(assessment);
    return {
      white: all.filter((opening) => opening.side === 'Brancas'),
      blackE4: all.filter((opening) => opening.side === 'Pretas vs 1.e4'),
      blackD4: all.filter((opening) => opening.side === 'Pretas vs 1.d4')
    };
  }

  function contextLabel(opening) {
    if (!opening) return '';
    if (opening.side === 'Brancas') return 'De brancas';
    if (opening.side === 'Pretas vs 1.e4') return 'De pretas contra 1.e4';
    if (opening.side === 'Pretas vs 1.d4') return 'De pretas contra 1.d4';
    return opening.side || '';
  }

  function byId(id) {
    return OPENINGS.find((opening) => opening.id === id) || null;
  }

  return { OPENINGS, byId, recommended, recommendedByContext, contextLabel, lessonIdea, stateAfterMoves };
});
