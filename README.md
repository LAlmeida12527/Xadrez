# Kira Chess — V6

Treinador pessoal de xadrez, local-first, voltado para **transferir aprendizado para partidas reais**. A V6 mantém o Game Review, bots por Elo, aulas de abertura, login opcional e regras completas da V5, e adiciona um primeiro sistema de treino de pensamento e memória.

> Projeto pessoal e não oficial. Não possui afiliação com Chess.com, Lichess, Stockfish ou *Death Note*.

## O que muda na V6

### 1. Encontre o plano
A área `Treinar` agora começa com um laboratório de posições normais de meio-jogo. Em vez de perguntar apenas “qual é o melhor lance?”, o sistema pede que o jogador escolha **a prioridade da posição**.

A ordem mental ensinada é:
1. existe ameaça imediata?
2. o rei está seguro?
3. ainda falta desenvolver alguma peça?
4. qual é a pior peça?
5. existe coluna, estrutura ou ruptura importante?
6. qual plano melhora a posição nos próximos lances?

A primeira biblioteca possui 8 situações sobre:
- responder ameaças antes de inventar ataque;
- terminar desenvolvimento;
- rocar quando a posição permite;
- melhorar a pior peça;
- centralizar torres em linhas úteis;
- preparar ruptura central em estruturas da Italiana;
- não forçar ataque só porque um bispo aponta para o rei;
- evitar lances aleatórios depois da abertura.

O sistema mede **leitura de planos**, não Elo.

### 2. Memória de padrões
`Padrões` deixa de ser apenas uma lista de temas. Cada padrão possui estado próprio e progride por:

`VER → ENTENDER → ENCONTRAR → RECONHECER → APLICAR → RECORDAR`

O perfil guarda:
- tentativas;
- acertos;
- acertos sem pista;
- sequência;
- lapsos;
- estágio atual;
- próxima revisão;
- domínio estimado.

Acertar com pista não promove estágio automaticamente. Errar antes de acertar também impede que a tentativa seja tratada como domínio limpo.

Padrões iniciais:
- peça pendurada;
- consequência da última jogada;
- garfo;
- diagonal de bispo;
- desenvolvimento com propósito;
- mate em 1;
- melhorar a pior peça;
- reconhecimento sem tema informado.

### 3. Repetição espaçada
Depois de aprender um padrão, ele recebe uma data de retorno. Revisões bem-sucedidas aumentam o intervalo; erros fazem o conteúdo voltar mais cedo.

A área `Treinar` mostra separadamente:
- padrões vencidos para recordar;
- erros pessoais vencidos para tentar novamente.

### 4. Erros reais continuam voltando
A biblioteca de erros da V5 foi conectada ao novo fluxo. Erros encontrados em partidas e PGNs podem voltar como `Tentar de novo`, usando a posição real antes da decisão ruim.

O objetivo é o ciclo:

`JOGOU → ERROU → ENTENDEU → TREINOU → REVIU DEPOIS → TENTOU DE NOVO`

### 5. Partidas humanas têm peso de diagnóstico
PGNs importados continuam atualizando o Game Review, erros e currículo. A V6 também registra quantas partidas humanas foram importadas e exibe isso em `Meu jogo`, separado da força aproximada dos bots.

### 6. Meu jogo: processo, não só rating
A área de progresso ganhou métricas de processo:
- precisão em decisões de plano;
- quantidade de partidas humanas importadas;
- padrões em memória de longo prazo;
- revisões vencidas.

## Recursos mantidos da V5

### Jogar
- drag com mouse/toque e clique origem → destino;
- roque, promoção, underpromotion e en passant;
- roque por destino do rei ou rei → torre quando legal;
- última jogada destacada;
- `Com Light` separado de `Normal`.

### Bots
Níveis aproximados de ≈300, 500, 700, 900, 1100, 1300 e 1500 Elo.

Esses valores representam **dificuldade de treino** e não equivalem a rating humano competitivo.

### Aberturas jogáveis
Aulas guiadas no tabuleiro, com tentativa, explicação, resposta teórica e continuação contra bot. A Italiana inclui sequência até o roque.

### Game Review
- importação de PGN;
- tabuleiro lance a lance;
- gráfico de vantagem;
- precisão estimada;
- classificações de lance;
- momentos-chave;
- melhor alternativa;
- `Tentar de novo`.

### Login opcional
Supabase para contas reais e progresso separado, com fallback para convidado.

Para ativar:
1. crie um projeto Supabase;
2. execute `supabase-setup.sql`;
3. preencha `js/supabase-config.js` com Project URL e chave pública;
4. mantenha RLS habilitado e nunca exponha `service_role`.

## Como rodar

```bash
npm run serve
```

ou:

```bash
python3 -m http.server 8080
```

## Testes

```bash
npm test
```

A suíte valida 20 módulos JavaScript, regras do xadrez, bots, abertura, Game Review, treino adaptativo, 8 cenários de plano, progressão da memória e integridade da interface.

## GitHub Pages
O projeto continua estático, com `index.html` na raiz e `.nojekyll` incluído. Publique `main` a partir de `/(root)` em **Settings → Pages**.
