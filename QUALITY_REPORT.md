# Quality report — Kira Chess V6

## Escopo desta entrega
A V6 inicia a evolução do Kira Chess de “site com exercícios” para **treinador com memória**. O foco desta versão é desenvolvimento de jogo/meio-jogo, reconhecimento de padrões e retorno de erros reais.

Não fazem parte desta entrega ainda:
- repertório de aberturas com repetição espaçada próprio;
- finais completos;
- geração automática de dezenas de posições variantes a partir de cada erro;
- IA longitudinal em servidor;
- matchmaking multiplayer.

## Testes automáticos
`npm test` valida:
- sintaxe dos 20 módulos JavaScript;
- núcleo de xadrez e perft de referência;
- roque, promoção, underpromotion e en passant;
- bots por Elo retornando lances legais;
- avaliação e modelo do jogador;
- treino adaptativo;
- Game Review e PGN;
- biblioteca de erros;
- 8 cenários do treinador `Encontre o plano` com FEN válido;
- progressão de memória de padrões;
- acerto com pista não promovendo estágio automaticamente;
- fraqueza “depois do desenvolvimento” podendo virar foco principal;
- integridade estática e ordem dos scripts.

## QA de navegador da V6
Foi executado um smoke test com Chromium em desktop e mobile, carregando a aplicação completa em ambiente isolado.

Validado:
- `Treinar` abre com avaliação já concluída;
- tabuleiro do laboratório contém 64 casas;
- 4 alternativas de plano aparecem na primeira situação;
- resposta correta gera feedback e libera próxima posição;
- contador avança de 1/8 para 2/8;
- a decisão é persistida em `thinking.planAttempts`;
- a tentativa alimenta `patternMemory`;
- `Padrões` renderiza 8 cartões com estágio e domínio;
- não há overflow horizontal em viewport 390 px;
- uma partida normal ainda permite jogar `e4` e registra o lance no histórico;
- nenhum erro JavaScript foi observado durante o smoke test.

## Regra pedagógica importante
A memória não considera “acertou = aprendeu”. O avanço depende de acertos sem pista e de repetições. Uma tentativa errada antes do acerto é tratada como resposta assistida para fins de progressão.

## Limitações conscientes
- o estágio `APLICAR` já existe na memória, mas a variedade de aplicação prática ainda é pequena e será expandida em versões futuras;
- posições de plano usam princípios deliberadamente claros; não substituem análise profunda de meio-jogo por engine;
- Game Review local continua heurístico, com Stockfish opcional sob demanda;
- partidas humanas precisam ser importadas por PGN nesta versão;
- login real depende da configuração externa do Supabase.

## Critério de qualidade
Código verde não basta. A feature precisa passar pelo fluxo de interface e responder a três perguntas:
1. o jogador entende o que está sendo treinado?
2. o sistema diferencia acerto limpo de acerto por tentativa/pista?
3. o aprendizado volta depois, em vez de desaparecer após um check verde?
