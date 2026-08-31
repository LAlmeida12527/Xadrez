(function (root, factory) {
  const Core = typeof module === 'object' && module.exports ? require('./chess-core.js') : root.KiraChessCore;
  const api = factory(Core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraDevelopmentEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('KiraChessCore não carregado.');

  const OPTIONS = {
    threat: 'Responder à ameaça imediata',
    develop: 'Terminar o desenvolvimento',
    castle: 'Colocar o rei em segurança',
    worst: 'Melhorar a pior peça',
    file: 'Colocar uma torre numa coluna útil',
    break: 'Preparar uma ruptura no centro',
    attack: 'Começar um ataque ao rei',
    trade: 'Procurar trocas',
    wait: 'Fazer um lance neutro e esperar'
  };

  const SCENARIOS = [
    {
      id: 'plan-threat-first',
      patternId: 'last-move',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2',
      title: 'Antes de criar um plano',
      question: 'Você acabou de jogar e4/Cf3. Qual é a primeira pergunta antes de inventar um ataque?',
      choices: ['threat', 'attack', 'develop', 'wait'],
      answer: 'threat',
      focusSquare: 'e4',
      explanation: 'Plano nenhum vale se existe um problema imediato. Primeiro confirme xeques, capturas e ameaças adversárias; só depois escolha como melhorar a posição.',
      followUp: 'Nesta posição não há emergência grave. Depois de confirmar isso, desenvolver o bispo e preparar o roque faz sentido.'
    },
    {
      id: 'plan-finish-development',
      patternId: 'development',
      fen: 'r1bq1rk1/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 4 6',
      title: 'Uma peça ainda dorme',
      question: 'Você já fez roque e ativou várias peças. Qual plano é mais saudável antes de começar um ataque?',
      choices: ['attack', 'develop', 'trade', 'wait'],
      answer: 'develop',
      focusSquare: 'b1',
      explanation: 'O cavalo de b1 ainda não participa do jogo. Antes de atacar com duas peças, termine o desenvolvimento e faça todas as peças trabalharem.',
      followUp: 'Cbd2 ou Cc3 são ideias naturais dependendo da estrutura. O importante é enxergar a peça que ainda não entrou no jogo.'
    },
    {
      id: 'plan-king-safety',
      patternId: 'development',
      fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 5',
      title: 'Desenvolveu. Falta fechar a porta.',
      question: 'Bispo e cavalo já saíram e o caminho está livre. Qual prioridade transforma seu desenvolvimento em posição segura?',
      choices: ['castle', 'attack', 'break', 'trade'],
      answer: 'castle',
      focusSquare: 'e1',
      explanation: 'O roque não é um “lance decorativo”. Ele reduz táticas contra o rei e coloca uma torre mais perto do centro.',
      followUp: 'Quando o roque é seguro e não existe uma urgência tática, fazer O-O costuma completar a primeira fase da abertura.'
    },
    {
      id: 'plan-worst-piece',
      patternId: 'worst-piece',
      fen: 'r2q1rk1/ppp1bppp/2np1n2/8/2B1P3/N2P1N2/PPP2PPP/R2Q1RK1 w - - 0 8',
      title: 'Todo mundo saiu. Nem todo mundo está bem.',
      question: 'Não existe tática óbvia. O que você deve procurar agora?',
      choices: ['attack', 'worst', 'trade', 'wait'],
      answer: 'worst',
      focusSquare: 'a3',
      explanation: 'O cavalo em a3 está desenvolvido, mas mal colocado. “Desenvolvido” não significa “útil”. No meio-jogo, melhorar a pior peça é um plano completo.',
      followUp: 'Procure uma rota para o cavalo voltar ao centro. O objetivo é aumentar quantas casas importantes ele controla.'
    },
    {
      id: 'plan-open-file',
      patternId: 'worst-piece',
      fen: 'r2q1rk1/ppp1bppp/2np1n2/8/2B5/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 8',
      title: 'A posição não pede ataque',
      question: 'Sem tática imediata, qual plano aumenta a atividade das suas peças com menos risco?',
      choices: ['file', 'attack', 'trade', 'wait'],
      answer: 'file',
      focusSquare: 'f1',
      explanation: 'A torre de f1 pode centralizar e entrar numa coluna útil. Torres ficam fortes quando deixam o canto e passam a disputar linhas abertas/semiabertas.',
      followUp: 'Re1 é um exemplo de lance que melhora a posição sem precisar criar uma ameaça artificial.'
    },
    {
      id: 'plan-center-break',
      patternId: 'development',
      fen: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 4 6',
      title: 'Estrutura Italiana',
      question: 'Você tem c3 e d3, rei seguro e peças saindo. Qual plano típico pode disputar mais espaço no centro?',
      choices: ['break', 'attack', 'trade', 'wait'],
      answer: 'break',
      focusSquare: 'd3',
      explanation: 'Em muitas estruturas da Italiana, c3 prepara d4. Você não está decorando um lance: está reconhecendo uma ruptura de peão que muda o centro.',
      followUp: 'Antes de jogar d4, confirme se o centro está suficientemente apoiado e qual troca pode acontecer em d4/e4.'
    },
    {
      id: 'plan-dont-force-attack',
      patternId: 'worst-piece',
      fen: 'r1bq1rk1/pppp1ppp/2n2n2/4p3/2B1P3/2NP1N2/PPP2PPP/R2Q1RK1 w - - 4 6',
      title: 'Não existe fogos de artifício',
      question: 'Você vê o bispo apontando para f7, mas não há combinação concreta. O que é mais maduro?',
      choices: ['attack', 'worst', 'wait', 'trade'],
      answer: 'worst',
      focusSquare: 'a1',
      explanation: 'Uma diagonal bonita não obriga um ataque. Se não há tática, melhore a coordenação. A torre de a1 ainda não participa do jogo.',
      followUp: 'Ataques funcionam quando várias peças participam. Aprenda a distinguir “tenho uma peça apontando” de “tenho ataque suficiente”.'
    },
    {
      id: 'plan-random-move',
      patternId: 'worst-piece',
      fen: 'r3r1k1/ppp2ppp/2np1n2/8/2B1P3/2NP1N2/PPP2PPP/R2R2K1 w - - 0 12',
      title: 'Qual pergunta evita o lance aleatório?',
      question: 'A abertura acabou e não existe tática. Qual processo costuma produzir um plano melhor que mover um peão qualquer?',
      choices: ['worst', 'wait', 'attack', 'trade'],
      answer: 'worst',
      focusSquare: 'c3',
      explanation: 'Procure a peça menos útil, a pior casa e a linha que você quer disputar. Meio-jogo é muito mais “melhorar” do que “achar golpe” o tempo todo.',
      followUp: 'Depois de escolher a pior peça, compare 2 ou 3 casas candidatas para ela. Isso cria um plano de vários lances.'
    }
  ];

  function scenario(index) { return SCENARIOS[Math.abs(Number(index) || 0) % SCENARIOS.length]; }
  function choiceLabel(id) { return OPTIONS[id] || id; }
  function evaluateChoice(item, choice) {
    const correct = item && choice === item.answer;
    return {
      correct,
      title: correct ? 'Boa leitura de posição.' : 'Esse plano veio cedo demais.',
      text: correct ? item.explanation : `Antes dessa ideia, compare prioridades: ameaça imediata, segurança do rei, peças sem desenvolver e pior peça. ${item.explanation}`,
      followUp: item.followUp
    };
  }

  function validate() {
    return SCENARIOS.map((item) => {
      const state = Core.parseFEN(item.fen);
      return { id: item.id, valid: Boolean(state && item.answer && item.choices.includes(item.answer)) };
    });
  }

  return { OPTIONS, SCENARIOS, scenario, choiceLabel, evaluateChoice, validate };
});
