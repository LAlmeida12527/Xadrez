'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

(function testReferencedAssetsExist() {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((ref) => !/^(?:https?:|#|data:)/.test(ref));
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(root, ref)), `Arquivo referenciado não existe: ${ref}`);
  }
})();

(function testUniqueIds() {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], `IDs duplicados: ${duplicates.join(', ')}`);
})();

(function testAppIdReferences() {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const dynamicIds = new Set(['deepAnalysisButton', 'verifyGameButton', 'engineAnalysisBox', 'gameVerificationBox', 'engineStatusBadge', 'openingLessonBoard', 'openingHintBox']);
  const refs = [...app.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(refs.filter((id) => !ids.has(id) && !dynamicIds.has(id)))];
  assert.deepEqual(missing, [], `IDs usados pelo app e ausentes no HTML: ${missing.join(', ')}`);
})();

(function testCssStructuralBalance() {
  const opening = (css.match(/{/g) || []).length;
  const closing = (css.match(/}/g) || []).length;
  assert.equal(opening, closing, 'Chaves CSS desbalanceadas.');
  assert.ok(css.includes('@media'), 'Responsividade CSS ausente.');
})();

(function testCssVariablesAreDefined() {
  const definitions = new Set([...css.matchAll(/(--[a-zA-Z0-9-_]+)\s*:/g)].map((match) => match[1]));
  const references = new Set([...css.matchAll(/var\((--[a-zA-Z0-9-_]+)/g)].map((match) => match[1]));
  const missing = [...references].filter((name) => !definitions.has(name));
  assert.deepEqual(missing, [], `Variáveis CSS usadas e não definidas: ${missing.join(', ')}`);
})();


(function testNoKnownFakeFallbackMetrics() {
  assert.ok(!html.includes('id="focusScore">32%'), 'A home não pode fingir precisão de ameaças sem dados.');
  assert.ok(!html.includes('id="trendThreats">32%'), 'Progresso não pode exibir estatística fictícia.');
})();

(function testNoVisualFakeFocusMetric() {
  assert.ok(!css.includes('0 32%'), 'O gráfico de foco não pode exibir 32% fixos sem dados.');
  assert.ok(css.includes('--focus-progress'), 'O gráfico de foco deve ser alimentado por dado real.');
})();

(function testCoreScriptsLoadBeforeApp() {
  const order = [
    'js/chess-core.js',
    'js/analysis-engine.js',
    'js/player-model.js',
    'js/coach-engine.js',
    'js/opening-engine.js',
    'js/coach-ai.js',
    'js/human-bot.js',
    'js/training-engine.js',
    'js/pattern-memory.js',
    'js/development-engine.js',
    'js/mistake-library.js',
    'js/game-archive.js',
    'js/engine-review.js',
    'js/review-engine.js',
    'js/supabase-config.js',
    'js/auth-service.js',
    'js/progress-engine.js',
    'js/data-portability.js',
    'js/stockfish-service.js',
    'js/app.js'
  ];
  let previous = -1;
  for (const script of order) {
    const index = html.indexOf(`src="${script}"`);
    assert.ok(index > previous, `Ordem de scripts incorreta em ${script}`);
    previous = index;
  }
})();

(function testPlayableBoardSupportsDragAndClick() {
  assert.ok(app.includes("addEventListener('pointerdown', beginBoardDrag)"), 'O tabuleiro deve aceitar arrastar peças com Pointer Events.');
  assert.ok(app.includes('function chooseSelectedDestination'), 'Clique e arraste devem compartilhar a mesma validação de destino.');
  assert.ok(css.includes('.drag-piece-ghost'), 'O arraste deve ter feedback visual da peça.');
})();

(function testAssessmentRedirectsAfterCompletion() {
  const evaluationBlock = app.slice(app.indexOf("if (isEvaluationGame()) {", app.indexOf('function finishGame')), app.indexOf("const message = game.result", app.indexOf('function finishGame')));
  assert.ok(evaluationBlock.includes("switchView('home')"), 'Após a avaliação, o jogador deve ser redirecionado para a Home atualizada.');
  assert.ok(evaluationBlock.includes('refreshProfileUI()'), 'O perfil deve ser atualizado antes do redirecionamento da avaliação.');
})();



(function testV5ExperienceHooksExist() {
  assert.ok(app.includes('function chooseCastleViaRook'), 'A interface deve aceitar roque pelo rei sobre a torre.');
  assert.ok(css.includes('.castle-target'), 'Roque legal deve ter indicação visual própria.');
  assert.ok(css.includes('.last-from') && css.includes('.last-to'), 'A jogada anterior deve destacar origem e destino.');
  assert.ok(html.includes('≈900 Elo') && html.includes('≈1500 Elo'), 'Os níveis do bot devem ser apresentados com Elo claro.');
  assert.ok(html.includes('id="reviewGraph"') && html.includes('id="reviewMoveList"'), 'Game Review deve ter gráfico e lista navegável de lances.');
  assert.ok(app.includes('startOpeningLesson') && app.includes('openingExpectedMove'), 'Aberturas devem ser aulas jogáveis no tabuleiro.');
  assert.ok(!html.includes('Boa tarde, Levi.'), 'A Home não deve fixar o nome de um único usuário.');
})();


(function testV6ThinkingAndMemoryHooksExist() {
  assert.ok(html.includes('id="developmentBoard"') && html.includes('id="developmentChoices"'), 'Treinar deve incluir o laboratório Encontre o plano.');
  assert.ok(html.includes('VER → ENTENDER → ENCONTRAR → RECONHECER → APLICAR → RECORDAR'), 'Padrões devem explicar a progressão de memória.');
  assert.ok(app.includes('recordPatternMemory') && app.includes('renderDevelopmentLab'), 'O app deve registrar memória e renderizar treino de planos.');
  assert.ok(html.includes('js/pattern-memory.js') && html.includes('js/development-engine.js'), 'Módulos V6 devem estar carregados.');
})();

console.log('✓ Auditoria estática passou.');
