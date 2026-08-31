(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraCoachAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  let session = null;
  let availability = 'unknown';
  let initializing = null;

  async function ensureSession() {
    if (session) return session;
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        if (!root.LanguageModel || typeof root.LanguageModel.availability !== 'function') {
          availability = 'unavailable';
          return null;
        }
        const status = await root.LanguageModel.availability();
        availability = status;
        if (status === 'unavailable') return null;
        session = await root.LanguageModel.create({
          initialPrompts: [{
            role: 'system',
            content: 'Você é um treinador de xadrez curto e didático. Responda em português do Brasil. Nunca invente fatos do tabuleiro. Use apenas os fatos fornecidos. Não entregue a melhor jogada se a instrução pedir apenas uma dica. Faça o aluno pensar em uma etapa por vez. Máximo 55 palavras.'
          }]
        });
        availability = 'ready';
        return session;
      } catch (error) {
        console.warn('IA local indisponível; usando treinador determinístico.', error);
        availability = 'unavailable';
        return null;
      } finally {
        initializing = null;
      }
    })();
    return initializing;
  }

  async function enhance(facts, fallback, instruction) {
    const model = await ensureSession();
    if (!model) return fallback;
    try {
      const prompt = [
        `Tarefa: ${instruction || 'Explique de forma didática sem entregar a solução.'}`,
        `Fatos verificados: ${JSON.stringify(facts || {})}`,
        `Texto-base seguro: ${fallback}`,
        'Reescreva o texto-base de modo mais natural e útil. Preserve exatamente os fatos.'
      ].join('\n');
      const result = await model.prompt(prompt);
      return String(result || '').trim() || fallback;
    } catch (error) {
      console.warn('Falha ao usar IA local.', error);
      return fallback;
    }
  }

  function status() {
    return availability;
  }

  return { ensureSession, enhance, status };
});
