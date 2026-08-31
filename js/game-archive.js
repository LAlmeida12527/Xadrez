(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraGameArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function createId(game) {
    return `game-${hashString([game?.startedAt, game?.completedAt, game?.result, game?.botLevel].join('|'))}`;
  }

  function normalizeMove(entry) {
    const value = entry && typeof entry === 'object' ? entry : {};
    return {
      color: value.color === 'b' ? 'b' : 'w',
      notation: String(value.notation || ''),
      uci: String(value.uci || ''),
      fenBefore: String(value.fenBefore || ''),
      fenAfter: String(value.fenAfter || ''),
      thinkingMs: value.thinkingMs == null ? null : Math.max(0, Number(value.thinkingMs) || 0),
      classification: value.analysis?.classification?.label || value.classification || 'ok',
      loss: Math.max(0, Number(value.analysis?.classification?.loss ?? value.loss) || 0),
      likelyCause: value.analysis?.likelyCause || value.likelyCause || null,
      concepts: Array.isArray(value.analysis?.concepts) ? value.analysis.concepts.slice(0, 8) : Array.isArray(value.concepts) ? value.concepts.slice(0, 8) : []
    };
  }

  function normalizeAnalysis(input) {
    if (!input || typeof input !== 'object') return null;
    return {
      ...input,
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 8) : [],
      engine: input.engine && typeof input.engine === 'object' ? input.engine : null
    };
  }

  function createArchiveItem(game, summary, pgn, analysis) {
    const item = {
      id: createId(game),
      startedAt: game?.startedAt || null,
      completedAt: game?.completedAt || new Date().toISOString(),
      result: game?.result || 'Empate',
      reason: game?.reason || null,
      botLevel: Math.max(0, Number(game?.botLevel) || 0),
      trainingFocus: game?.trainingFocus || null,
      pgn: String(pgn || ''),
      blunders: Math.max(0, Number(summary?.blunders) || 0),
      mistakes: Math.max(0, Number(summary?.mistakes) || 0),
      inaccuracies: Math.max(0, Number(summary?.inaccuracies) || 0),
      interventions: Math.max(0, Number(game?.interventions) || 0),
      materialLost: Math.max(0, Number(game?.materialLost) || 0),
      materialWon: Math.max(0, Number(game?.materialWon) || 0),
      moves: Array.isArray(game?.history) ? game.history.map(normalizeMove) : [],
      analysis: normalizeAnalysis(analysis)
    };
    if (item.analysis) item.analysis.archiveId = item.id;
    return item;
  }

  function normalizeArchiveItem(input) {
    const value = input && typeof input === 'object' ? input : {};
    const item = {
      ...value,
      id: value.id || createId(value),
      startedAt: value.startedAt || null,
      completedAt: value.completedAt || null,
      result: value.result || 'Empate',
      reason: value.reason || null,
      botLevel: Math.max(0, Number(value.botLevel) || 0),
      trainingFocus: value.trainingFocus || null,
      pgn: String(value.pgn || ''),
      blunders: Math.max(0, Number(value.blunders) || 0),
      mistakes: Math.max(0, Number(value.mistakes) || 0),
      inaccuracies: Math.max(0, Number(value.inaccuracies) || 0),
      interventions: Math.max(0, Number(value.interventions) || 0),
      materialLost: Math.max(0, Number(value.materialLost) || 0),
      materialWon: Math.max(0, Number(value.materialWon) || 0),
      moves: Array.isArray(value.moves) ? value.moves.map(normalizeMove) : [],
      analysis: normalizeAnalysis(value.analysis)
    };
    if (item.analysis) item.analysis.archiveId = item.id;
    return item;
  }

  function add(archive, item, limit) {
    const max = Math.max(1, Math.min(100, Number(limit) || 24));
    const normalized = normalizeArchiveItem(item);
    const list = Array.isArray(archive) ? archive.map(normalizeArchiveItem) : [];
    const withoutDuplicate = list.filter((entry) => entry.id !== normalized.id);
    withoutDuplicate.push(normalized);
    return withoutDuplicate.slice(-max);
  }

  function updateAnalysis(archive, archiveId, analysis) {
    if (!archiveId || !Array.isArray(archive)) return Array.isArray(archive) ? archive : [];
    return archive.map((item) => {
      const normalized = normalizeArchiveItem(item);
      if (normalized.id !== archiveId) return normalized;
      return { ...normalized, analysis: normalizeAnalysis({ ...analysis, archiveId }) };
    });
  }

  return {
    createId,
    normalizeMove,
    normalizeAnalysis,
    createArchiveItem,
    normalizeArchiveItem,
    add,
    updateAnalysis
  };
});
