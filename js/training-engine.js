(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const api = factory(Core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraTrainingEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  if (!Core) throw new Error('KiraChessCore não carregado.');

  function exercise(id, fen, target, prompt, hints, solution, extra) {
    return { id, fen, target, prompt, hints, solution, ...(extra || {}) };
  }

  const EXERCISES = {
    threat: [
      exercise('threat-01', '4k3/8/5n2/7Q/8/8/8/4K3 w - - 0 1', 'h5',
        'Qual peça branca passou a exigir atenção imediata?',
        [
          'Não procure uma jogada sua ainda. Primeiro localize a peça preta mais ativa.',
          'O cavalo preto está em f6. Imagine o “L” que ele desenha no tabuleiro.',
          'Uma dessas casas é h5. Agora confira o que existe lá.',
          'A dama branca em h5 está sob ataque do cavalo.'
        ],
        'A dama em h5 está atacada pelo cavalo de f6. O hábito importante é: depois de uma peça adversária se mover, descubra quais casas novas ela passou a controlar.'),
      exercise('threat-02', '4k3/6b1/8/8/8/8/8/R3K3 w - - 0 1', 'a1',
        'Existe uma ameaça de longa distância. Qual peça branca está no fim dela?',
        [
          'Comece pelo bispo preto. Bispos enxergam diagonais até encontrar uma peça.',
          'Siga g7–f6–e5–d4–c3–b2–a1, sem pular casas.',
          'A ameaça está no canto inferior esquerdo.',
          'A torre branca em a1 está atacada pelo bispo.'
        ],
        'A torre em a1 está na mesma diagonal do bispo de g7. Treine olhar linhas inteiras; ameaças de bispo e torre muitas vezes vêm de longe.'),
      exercise('threat-03', '4k3/8/8/8/6b1/8/8/3QK3 w - - 0 1', 'd1',
        'Qual peça branca ficou exposta à diagonal do bispo em g4?',
        [
          'Ignore o resto do tabuleiro por alguns segundos e siga apenas a diagonal do bispo.',
          'A linha passa por f3 e e2.',
          'Continue até d1.',
          'A dama em d1 está sendo atacada.'
        ],
        'O bispo de g4 mira d1 pela diagonal g4–f3–e2–d1. O padrão é enxergar além da casa imediatamente próxima.'),
      exercise('threat-04', '4k3/8/8/8/1b6/2N5/8/4K3 w - - 0 1', 'c3',
        'A última ideia das pretas cria uma ameaça simples. Qual peça branca precisa reagir?',
        [
          'Veja a casa imediatamente seguinte na diagonal do bispo de b4.',
          'O bispo ataca c3.',
          'Há uma peça menor branca em c3.',
          'O cavalo em c3 está atacado.'
        ],
        'O cavalo em c3 está atacado pelo bispo de b4. Antes de pensar no seu plano, responda ao que o adversário acabou de criar.')
    ],
    hanging: [
      exercise('hanging-01', '4k3/6b1/8/8/8/8/8/R3K3 w - - 0 1', 'a1',
        'Qual peça branca pode ser capturada sem que outra peça branca consiga recapturar?',
        [
          'Primeiro identifique a peça atacada. Depois faça uma segunda pergunta: quem a defende?',
          'A ameaça vem pela diagonal longa do bispo.',
          'Chegando em a1, procure algum defensor branco dessa casa.',
          'A torre de a1 está atacada e não possui defensor.'
        ],
        'A torre em a1 está pendurada: atacada e sem defesa. “Atacado” e “pendurado” não são a mesma coisa; sempre conte defensores.'),
      exercise('hanging-02', '4k3/8/5n2/3Q4/8/8/8/4K3 w - - 0 1', 'd5',
        'Qual peça branca valiosa está solta nesta posição?',
        [
          'Procure primeiro os ataques do cavalo de f6.',
          'Uma das casas atacadas por ele é d5.',
          'Agora pergunte: existe alguma peça branca defendendo d5?',
          'A dama branca em d5 está atacada e sem defesa.'
        ],
        'A dama em d5 está pendurada para o cavalo de f6. O valor da peça torna essa verificação ainda mais urgente.'),
      exercise('hanging-03', '4k3/8/8/3p4/2B5/8/8/4K3 w - - 0 1', 'c4',
        'Qual peça branca está ameaçada por um peão e não tem defesa?',
        [
          'Peões pretos atacam diagonalmente em direção às fileiras menores.',
          'O peão em d5 ataca c4 e e4.',
          'Observe c4 e depois procure um defensor branco.',
          'O bispo em c4 está pendurado.'
        ],
        'O bispo de c4 está sem defesa e é atacado pelo peão de d5. Peões parecem pequenos, mas ameaças de peão ganham peças grandes o tempo todo.'),
      exercise('hanging-04', '4k3/1b6/8/8/8/8/8/4K2R w - - 0 1', 'h1',
        'Existe uma peça branca solta no fim de uma diagonal. Qual?',
        [
          'Trace a diagonal do bispo desde b7.',
          'A linha é b7–c6–d5–e4–f3–g2–h1.',
          'Agora veja se h1 possui algum defensor branco.',
          'A torre em h1 está pendurada.'
        ],
        'A torre de h1 está pendurada na diagonal do bispo. Linhas longas devem entrar no seu “radar” antes de confirmar um lance.')
    ],
    mate: [
      exercise('mate-01', '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', 'g6',
        'Qual peça branca pode encerrar a partida em um lance?',
        [
          'Antes de procurar jogadas bonitas, liste todos os xeques.',
          'O rei branco em f6 controla casas perto do rei preto.',
          'A dama já está perto o suficiente para fechar a última fuga.',
          'A dama em g6 pode jogar Qg7#.'
        ],
        'Qg7# funciona porque o rei branco protege g7 e o rei preto não possui casa de fuga. O método é sempre: xeques primeiro, depois casas de fuga.'),
      exercise('mate-02', '7k/5K2/8/8/8/8/8/6R1 w - - 0 1', 'g1',
        'Qual peça branca consegue dar um mate imediato?',
        [
          'Liste os xeques da torre.',
          'O rei branco já controla as casas de fuga próximas.',
          'Procure colocar a torre na coluna h.',
          'A torre em g1 pode jogar Rh1#.'
        ],
        'Rh1# fecha a coluna e o rei branco elimina as casas de fuga. Em mates simples, primeiro verifique se o rei inimigo consegue escapar.'),
      exercise('mate-03', '7k/5K2/8/8/8/8/3Q4/8 w - - 0 1', 'd2',
        'Qual peça branca possui o xeque que fecha todas as casas de fuga?',
        [
          'Liste todos os xeques possíveis da dama.',
          'Procure uma casa na coluna h alcançada por diagonal.',
          'O rei branco ajuda a controlar a fuga em g8/g7.',
          'A dama em d2 pode jogar Qh6#.'
        ],
        'Qh6# é mate porque a dama cobre h-file e g7/g8 com ajuda do rei. O objetivo não é decorar Qh6; é aprender a verificar fuga por fuga.')
    ],
    development: [
      exercise('development-01', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'g1',
        'Você começou com 1.e4 e5. Qual peça é uma candidata natural para desenvolver agora?',
        [
          'Não mova novamente o peão de e4 sem motivo. Procure uma peça que ainda está na casa inicial.',
          'Desenvolver significa colocar uma peça em uma casa mais ativa ganhando controle do centro.',
          'Um cavalo pode desenvolver atacando e5 e controlando d4.',
          'O cavalo de g1 é uma excelente peça para desenvolver com Cf3.'
        ],
        'Cf3 é uma escolha natural: desenvolve, ataca e5, controla d4 e ajuda o roque. Uma boa abertura costuma fazer várias coisas úteis com o mesmo lance.'),
      exercise('development-02', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4', 'e1',
        'Suas peças menores já começaram a sair. Qual prioridade importante está ficando disponível?',
        [
          'Olhe para o rei, não para uma peça de ataque.',
          'O caminho entre rei e torre do lado do rei está livre.',
          'Uma abertura não termina só porque bispo e cavalo saíram.',
          'O rei em e1 já pode fazer roque.'
        ],
        'O roque coloca o rei em segurança e ativa a torre. Desenvolvimento sem segurança do rei costuma deixar o trabalho pela metade.'),
      exercise('development-03', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', 'b8',
        'Você está de pretas depois de 1.e4 e5 2.Cf3. Qual peça pode desenvolver e ao mesmo tempo reforçar o peão de e5?',
        [
          'Não tente expulsar o cavalo branco com peões.',
          'Procure uma peça ainda na casa inicial que possa controlar e5.',
          'O cavalo da ala da dama pode ir para c6.',
          'O cavalo em b8 é uma peça natural para desenvolver com ...Cc6.'
        ],
        '...Cc6 desenvolve o cavalo e reforça e5. Bons lances de abertura resolvem mais de uma necessidade ao mesmo tempo.'),
      exercise('development-04', 'rnbqk2r/pppp1ppp/5n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 4', 'f8',
        'As pretas já desenvolveram um cavalo. Qual peça ainda bloqueia o roque curto e deveria entrar no jogo?',
        [
          'Olhe entre o rei preto e a torre de h8.',
          'Uma peça menor ainda ocupa sua casa inicial.',
          'Desenvolver essa peça deixa o caminho do roque livre.',
          'O bispo de f8 precisa sair antes do roque curto.'
        ],
        'O bispo de f8 é a peça que falta para liberar o roque. Abertura não é decorar lances: é remover obstáculos para suas peças funcionarem juntas.')
    ],
    bishop: [
      exercise('bishop-01', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'f1',
        'Você gosta de ativar o bispo cedo. Qual bispo já possui uma diagonal aberta?',
        [
          'O peão de e2 saiu e abriu uma diagonal.',
          'Procure a peça que estava atrás desse peão.',
          'O bispo de f1 pode ir para c4, b5, e2, d3 ou outras casas legais.',
          'O bispo de f1 está pronto para entrar no jogo.'
        ],
        'O bispo de f1 ficou livre depois de e4. A ideia boa não é “sempre jogar Bc4”; é perceber quando uma diagonal foi aberta e escolher a casa com propósito.'),
      exercise('bishop-02', 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 5', 'c4',
        'Seu bispo em c4 está ativo. O que você deve evitar fazer só porque ele mira f7?',
        [
          'Uma peça ativa pode exercer pressão sem precisar atacar imediatamente.',
          'Conte quantas peças suas participariam de um ataque em f7.',
          'Se apenas dama e bispo estiverem olhando, isso não significa que um sacrifício seja correto.',
          'Clique no bispo de c4: ele pode continuar útil sem ser movido ou sacrificado.'
        ],
        'O bispo em c4 já cumpre um papel excelente. Pressão não é obrigação de capturar. Muitas vezes a melhor decisão é terminar o desenvolvimento e manter a ameaça.'),
      exercise('bishop-03', 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2', 'c1',
        'Depois de 1.d4 d5, qual bispo ganhou uma diagonal que antes estava fechada?',
        [
          'O peão branco que saiu de d2 liberou uma peça atrás dele.',
          'Procure uma peça que se movimenta por diagonais.',
          'O bispo da ala da dama agora enxerga d2, e3, f4, g5 e h6.',
          'O bispo em c1 ganhou espaço para se desenvolver.'
        ],
        'Mover o peão de d abre o bispo de c1. Visão de abertura é também perceber quais peças foram liberadas pelos seus próprios peões.'),
      exercise('bishop-04', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5NP1/PPPP1PBP/RNBQ1RK1 w kq - 4 5', 'g2',
        'Qual bispo branco já exerce pressão de longa distância sem precisar se mover agora?',
        [
          'Procure um bispo apontado para o centro por uma diagonal longa.',
          'Siga a diagonal que começa em g2 e passa por f3, e4, d5, c6 e b7.',
          'Uma peça pode ser muito ativa mesmo sem estar perto do rei adversário.',
          'O bispo em g2 é a peça que domina a diagonal longa.'
        ],
        'O bispo em g2 influencia uma diagonal inteira. Aprender bispos é aprender a enxergar linhas, não apenas procurar Bc4 em toda partida.')
    ],
    fork: [
      exercise('fork-01', '2q1k3/8/8/5N2/8/8/8/4K3 w - - 0 1', 'd6',
        'O cavalo pode dar xeque e atacar a dama ao mesmo tempo. Clique na casa de destino do garfo.',
        [
          'Procure primeiro uma casa do cavalo de f5 que dê xeque no rei de e8.',
          'Um garfo com xeque é forte porque o rei obriga o adversário a responder.',
          'De d6, o cavalo ataca e8 e também c8.',
          'A casa d6 cria o garfo: rei em e8 e dama em c8.'
        ],
        'Cd6+ é um garfo: o cavalo ataca o rei em e8 e a dama em c8. O método é procurar xeques do cavalo e depois verificar quais outros alvos a mesma casa alcança.'),
      exercise('fork-02', '1q3k2/8/8/2N5/8/8/8/4K3 w - - 0 1', 'd7',
        'Existe outro garfo de cavalo com xeque. Qual casa ataca ao mesmo tempo o rei e a dama?',
        [
          'O cavalo está em c5. Liste mentalmente as casas que ele alcança.',
          'Procure uma dessas casas que ataque o rei preto em f8.',
          'De d7, o cavalo também alcança b8.',
          'Cd7+ ataca o rei em f8 e a dama em b8.'
        ],
        'Cd7+ obriga o rei a responder e deixa a dama em b8 atacada. Em garfos, primeiro procure alvos valiosos que caibam no mesmo “L”.'),
      exercise('fork-03', '1r1k4/8/8/4N3/8/8/8/4K3 w - - 0 1', 'c6',
        'O cavalo de e5 pode atacar rei e torre com um único lance. Qual é a casa?',
        [
          'Procure um xeque do cavalo de e5.',
          'Uma casa candidata é c6.',
          'De c6 o cavalo ataca d8 e b8.',
          'Cc6+ cria o garfo no rei de d8 e na torre de b8.'
        ],
        'Cc6+ é um ataque duplo com tempo, porque o xeque força a resposta. O padrão é mais importante que decorar a posição.'),
    ],
    afterdev: [
      exercise('afterdev-01', 'r2q1rk1/ppp1bppp/2np1n2/8/2B1P3/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 8', 'a1',
        'Você já desenvolveu e fez roque. Qual peça branca ainda está fazendo menos trabalho?',
        [
          'Quando não existe tática, procure a sua pior peça.',
          'Cavalos, bispo e rei já estão razoavelmente ativos.',
          'As torres ainda não entraram no jogo. Qual delas está mais longe do centro?',
          'A torre de a1 ainda está presa à ala e é uma candidata clara a melhorar.'
        ],
        'Depois do desenvolvimento, uma pergunta excelente é: “qual é minha pior peça?”. Aqui a torre de a1 ainda não participa do jogo. Melhorar peças é um plano válido quando não há tática imediata.'),
      exercise('afterdev-02', 'r2q1rk1/ppp1bppp/2np1n2/8/2B5/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 8', 'f1',
        'Não há tática imediata e a coluna e está livre. Qual torre tem um caminho simples para uma coluna central?',
        [
          'Depois de desenvolver, procure colunas abertas ou semiabertas para as torres.',
          'A coluna e não possui peão branco bloqueando a primeira fileira.',
          'Qual torre está ao lado de e1?',
          'A torre em f1 pode centralizar com Re1.'
        ],
        'Re1 é um exemplo de melhorar uma peça sem “inventar ataque”. Torres normalmente ficam mais úteis em colunas centrais abertas ou semiabertas.'),
      exercise('afterdev-03', 'r2q1rk1/ppp1bppp/2np1n2/8/2B1P3/N2P1N2/PPP2PPP/R2Q1RK1 w - - 0 8', 'a3',
        'Quase tudo está desenvolvido, mas uma peça branca ficou mal colocada. Qual?',
        [
          'Não procure uma peça ainda na casa inicial. Procure uma peça desenvolvida para uma casa pouco útil.',
          'Compare os cavalos: um participa do centro e o outro está na borda.',
          'Cavalos geralmente querem casas centrais porque controlam mais opções.',
          'O cavalo em a3 é a peça que mais pede uma rota melhor.'
        ],
        'O cavalo em a3 está desenvolvido, mas mal colocado. “Desenvolver” não basta: depois você precisa melhorar peças que chegaram a casas pouco úteis.')
    ]
  };

  const CHANGE_EXERCISES = [
    {
      id: 'change-01', beforeFen: 'k5n1/8/8/7Q/8/8/8/4K3 b - - 0 1', opponentMove: 'g8f6', target: 'h5',
      prompt: 'As pretas acabaram de jogar ...Cf6. O que mudou para as brancas?',
      hints: [
        'Não escolha sua jogada ainda. Olhe somente para a peça que acabou de se mover.',
        'O cavalo saiu de g8 e chegou a f6. Quais casas ele passou a controlar?',
        'Uma das novas casas controladas é h5.',
        'A dama branca em h5 passou a estar atacada.'
      ],
      solution: '...Cf6 não foi apenas “desenvolver um cavalo”: também criou um ataque sobre a dama em h5. Depois de cada lance adversário, pergunte o que aquela peça passou a atacar, defender ou abrir.'
    },
    {
      id: 'change-02', beforeFen: '4k3/8/8/2b5/8/2N5/8/4K3 b - - 0 1', opponentMove: 'c5b4', target: 'c3',
      prompt: 'As pretas acabaram de jogar ...Bb4. Qual consequência imediata apareceu?',
      hints: [
        'Não procure seu plano. Primeiro siga a linha da peça que acabou de se mover.',
        'O bispo chegou a b4 e controla a diagonal que começa em c3.',
        'Existe uma peça branca em c3.',
        'O cavalo de c3 passou a estar atacado.'
      ],
      solution: 'O bispo mudou de casa e imediatamente criou uma ameaça no cavalo de c3. Treinar “o que mudou?” reduz muito os erros causados por ignorar a última jogada.'
    },
    {
      id: 'change-03', beforeFen: '4k3/8/8/3p4/8/4B3/8/4K3 b - - 0 1', opponentMove: 'd5d4', target: 'e3',
      prompt: 'Depois de ...d4, qual peça branca ficou ameaçada?',
      hints: [
        'O peão acabou de avançar. Além de ocupar d4, quais casas ele agora ataca?',
        'Peões pretos atacam diagonalmente em direção às fileiras menores.',
        'De d4, o peão ataca c3 e e3.',
        'O bispo branco em e3 ficou atacado.'
      ],
      solution: '...d4 mudou duas coisas: ganhou espaço e passou a atacar e3. Um peão que avança pode mudar completamente as casas seguras ao redor.'
    }
  ];

  function buildChangeExercise(source) {
    const before = Core.parseFEN(source.beforeFen);
    const move = Core.moveFromUCI(before, source.opponentMove);
    if (!move) throw new Error(`Exercício ${source.id} contém um último lance inválido.`);
    const after = Core.makeMoveCopy(before, move);
    return { ...source, fen: Core.toFEN(after), lastMove: source.opponentMove };
  }

  const LABELS = {
    threat: ['VISÃO', 'Enxergue a ameaça'],
    hanging: ['MATERIAL', 'Peças sem defesa'],
    mate: ['TÁTICA', 'Mate em 1'],
    surprise: ['TESTE SURPRESA', 'Sem tema informado'],
    change: ['PROCESSO', 'O que mudou?'],
    development: ['ABERTURA', 'Desenvolvimento com propósito'],
    bishop: ['VISÃO', 'Bispos e diagonais'],
    fork: ['PADRÃO', 'Garfo'],
    afterdev: ['PLANO', 'E depois do desenvolvimento?']
  };

  function getExercise(mode, index) {
    if (mode === 'change') return buildChangeExercise(CHANGE_EXERCISES[index % CHANGE_EXERCISES.length]);
    if (mode === 'surprise') {
      const pool = [...EXERCISES.threat, ...EXERCISES.hanging, ...EXERCISES.development];
      const source = pool[index % pool.length];
      return { ...source, prompt: 'Sem tema informado: o que merece sua atenção primeiro nesta posição?' };
    }
    const list = EXERCISES[mode] || EXERCISES.threat;
    return list[index % list.length];
  }

  function labels(mode) {
    return LABELS[mode] || LABELS.threat;
  }

  function mistakeScores(profile) {
    const recent = Array.isArray(profile?.recentMistakes) ? profile.recentMistakes.slice(-36) : [];
    const scores = { hanging: 0, change: 0, mate: 0, development: 0, bishop: 0, fork: 0, afterdev: 0 };
    recent.forEach((mistake, index) => {
      const weight = 0.45 + (0.55 * ((index + 1) / Math.max(1, recent.length)));
      const concepts = Array.isArray(mistake.concepts) ? mistake.concepts : [];
      if (concepts.includes('peça exposta') || concepts.includes('peça pendurada')) scores.hanging += weight;
      if (String(mistake.likelyCause || '').includes('resposta adversária')) scores.change += weight;
      if (String(mistake.likelyCause || '').includes('mate em') || concepts.some((item) => String(item).includes('mate'))) scores.mate += weight * 1.25;
      if (concepts.includes('dama cedo')) scores.development += weight;
    });
    return scores;
  }

  function recommendFocus(profile) {
    const scores = mistakeScores(profile);
    const assessmentWeakness = profile?.assessment?.primaryWeakness;
    if (assessmentWeakness && Object.hasOwn(scores, assessmentWeakness)) scores[assessmentWeakness] += 1.35;
    const baselineWeakness = profile?.baseline?.summary?.weakest;
    if (!assessmentWeakness && baselineWeakness && Object.hasOwn(scores, baselineWeakness)) scores[baselineWeakness] += 1.15;
    const candidates = [
      { key: 'piece-exposed', mode: 'hanging', label: 'Peças sem defesa', count: scores.hanging },
      { key: 'threat-missed', mode: 'change', label: 'O que mudou?', count: scores.change },
      { key: 'mate-missed', mode: 'mate', label: 'Mate em 1', count: scores.mate },
      { key: 'development', mode: 'development', label: 'Desenvolvimento', count: scores.development },
      { key: 'after-development', mode: 'afterdev', label: 'Encontrar o plano', count: scores.afterdev },
      { key: 'fork', mode: 'fork', label: 'Garfos', count: scores.fork },
      { key: 'bishop', mode: 'bishop', label: 'Bispos e diagonais', count: scores.bishop }
    ].sort((a, b) => b.count - a.count);
    if (candidates[0].count > 0.01) return candidates[0];
    return { key: 'foundation', mode: 'change', label: 'O que mudou?', count: 0 };
  }

  function catalog(profile) {
    if (!profile?.assessment?.completed) return [];
    const scores = mistakeScores(profile);
    const style = profile.assessment.style || {};
    const assessedWeakness = profile.assessment.primaryWeakness;
    if (assessedWeakness && Object.hasOwn(scores, assessedWeakness)) scores[assessedWeakness] += 1.6;
    // Estilo influencia a ordem, mas nunca deve passar na frente de um erro real recorrente.
    if (style.bishopAffinity) scores.bishop += 0.65;
    scores.afterdev += 0.5;
    scores.fork += 0.35;
    scores.development += 0.5;

    const recent = Array.isArray(profile.recentMistakes) ? profile.recentMistakes : [];
    const personalCount = (mode) => recent.filter((mistake) => {
      const concepts = Array.isArray(mistake.concepts) ? mistake.concepts : [];
      if (mode === 'hanging') return concepts.includes('peça exposta') || concepts.includes('peça pendurada');
      if (mode === 'change') return String(mistake.likelyCause || '').includes('resposta adversária');
      if (mode === 'mate') return concepts.some((item) => String(item).includes('mate'));
      if (mode === 'development') return concepts.includes('dama cedo');
      return false;
    }).length;
    const baseCount = (mode) => mode === 'change' ? CHANGE_EXERCISES.length : mode === 'surprise'
      ? Math.min(6, EXERCISES.threat.length + EXERCISES.hanging.length + EXERCISES.development.length)
      : (EXERCISES[mode]?.length || 0);

    const modules = [
      { mode: 'change', title: 'O que mudou?', description: 'Aprenda a ler a última jogada antes de pensar na sua.', score: scores.change, icon: '↳' },
      { mode: 'hanging', title: 'Peças sem defesa', description: 'Pare de entregar material por não contar atacantes e defensores.', score: scores.hanging, icon: '◇' },
      { mode: 'development', title: 'Desenvolvimento', description: 'Saiba quais peças colocar no jogo e por quê.', score: scores.development, icon: '♞' },
      { mode: 'bishop', title: 'Bispos e diagonais', description: 'Transforme sua afinidade com bispos em visão real de linhas.', score: scores.bishop, icon: '♝' },
      { mode: 'afterdev', title: 'E agora?', description: 'O que fazer quando você já desenvolveu e não existe uma tática óbvia.', score: scores.afterdev, icon: '→' },
      { mode: 'mate', title: 'Mate em 1', description: 'Reconheça padrões decisivos antes de estudar combinações longas.', score: scores.mate, icon: '#' },
      { mode: 'fork', title: 'Garfos', description: 'Reconheça ataques duplos e aprenda também a evitá-los.', score: scores.fork, icon: 'Y' },
      { mode: 'surprise', title: 'Teste surpresa', description: 'Sem nome do tema: encontre sozinho o que importa.', score: 0.35, icon: '?' }
    ];

    return modules
      .map((item) => {
        const activities = baseCount(item.mode);
        const personalActivities = personalCount(item.mode);
        const priorityBoost = item.score >= 1.4 ? 4 : item.score >= 0.7 ? 2 : 0;
        // Isso é volume de prática, não promessa de posições únicas. Repetição espaçada
        // e erros pessoais fazem parte da sessão quando o tema realmente precisa de reforço.
        const recommendedReps = Math.max(activities, Math.min(14, activities + priorityBoost + Math.min(6, personalActivities * 2)));
        return {
          ...item,
          activities,
          personalActivities,
          recommendedReps,
          priority: item.score >= 1.4 ? 'Alta' : item.score >= 0.7 ? 'Média' : 'Base',
          reason: item.score >= 1.4 ? 'Apareceu com frequência na sua avaliação/partidas.' : item.score >= 0.7 ? 'Vale reforçar agora.' : 'Fundamento para manter disponível.'
        };
      })
      .sort((a, b) => b.score - a.score || b.personalActivities - a.personalActivities || a.title.localeCompare(b.title));
  }

  function patternCatalog(profile) {
    if (!profile?.assessment?.completed) return [];
    const catalogItems = catalog(profile);
    const byMode = Object.fromEntries(catalogItems.map((item) => [item.mode, item]));
    const patterns = [
      { id: 'loose-piece', mode: 'hanging', icon: '◇', title: 'Peça pendurada', description: 'Uma peça atacada sem defesa suficiente. É um dos padrões mais caros para qualquer iniciante.' },
      { id: 'last-move', mode: 'change', icon: '↳', title: 'A última jogada mudou algo', description: 'A peça adversária acabou de atacar, defender, abrir uma linha ou disputar o centro.' },
      { id: 'fork', mode: 'fork', icon: 'Y', title: 'Garfo', description: 'Uma única peça ataca dois alvos ao mesmo tempo. Aprenda a fazer e, principalmente, a prever.' },
      { id: 'bishop-line', mode: 'bishop', icon: '♝', title: 'Diagonal de bispo', description: 'Bispos parecem quietos até uma diagonal abrir. Treine linhas longas e ataques que surgem de longe.' },
      { id: 'tempo-development', mode: 'development', icon: '♞', title: 'Desenvolver com tempo', description: 'Coloque uma peça no jogo enquanto cria uma ameaça ou melhora sua posição.' },
      { id: 'mate-one', mode: 'mate', icon: '#', title: 'Mate em 1', description: 'Quando o rei não tem resposta, calcular mais é desperdício. Esse padrão precisa saltar aos olhos.' },
      { id: 'worst-piece', mode: 'afterdev', icon: '→', title: 'Melhorar a pior peça', description: 'Depois do desenvolvimento, encontre a peça menos útil e dê a ela uma função melhor.' },
      { id: 'unknown-theme', mode: 'surprise', icon: '?', title: 'Reconhecer sem aviso', description: 'A posição não diz qual padrão existe. É o teste mais próximo de uma partida real.' }
    ];
    return patterns
      .map((pattern) => {
        const source = byMode[pattern.mode] || {};
        return { ...pattern, score: Number(source.score) || 0, priority: source.priority || 'Base', recommendedReps: source.recommendedReps || source.activities || 0 };
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }


  function trainingPlan(profile, minutes) {
    const total = [10, 20, 30, 45, 60].includes(Number(minutes)) ? Number(minutes) : 20;
    const focus = recommendFocus(profile);
    const catalogItems = catalog(profile);
    const secondary = catalogItems.find((item) => item.mode !== focus.mode && item.mode !== 'surprise');
    const review = Math.max(2, Math.round(total * 0.18));
    const focusTime = Math.max(4, Math.round(total * 0.38));
    const application = Math.max(3, Math.round(total * 0.28));
    const remaining = Math.max(2, total - review - focusTime - application);

    return {
      total,
      focus,
      items: [
        { title: 'Revisão real', subtitle: 'Uma posição que você já errou ou um fundamento curto.', minutes: review, action: 'review', mode: secondary?.mode || 'change' },
        { title: focus.label, subtitle: 'Seu foco mais importante agora.', minutes: focusTime, action: 'focus', mode: focus.mode },
        { title: 'Aplicar jogando', subtitle: 'Partida com Light focada nesse padrão.', minutes: application, action: 'play', mode: focus.mode },
        { title: 'Sem aviso', subtitle: 'Teste surpresa para saber se você realmente reconhece.', minutes: remaining, action: 'surprise', mode: 'surprise' }
      ]
    };
  }

  return { EXERCISES, CHANGE_EXERCISES, LABELS, buildChangeExercise, getExercise, labels, mistakeScores, recommendFocus, catalog, patternCatalog, trainingPlan };
});
