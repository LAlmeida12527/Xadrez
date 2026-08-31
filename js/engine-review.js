(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraEngineReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LABEL_RANK = { ok: 0, inaccuracy: 1, mistake: 2, blunder: 3 };

  function isValidUci(value) {
    return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(value || ''));
  }

  function candidateScore(move) {
    const rank = LABEL_RANK[move?.classification] ?? 0;
    const loss = Math.max(0, Number(move?.loss) || 0);
    return (rank * 100) + Math.min(99, loss * 10);
  }

  function selectCandidates(moves, userColor, limit) {
    const side = userColor === 'b' ? 'b' : 'w';
    const max = Math.max(1, Math.min(5, Number(limit) || 3));
    const list = Array.isArray(moves) ? moves : [];

    return list
      .map((move, index) => ({ ...move, ply: index + 1 }))
      .filter((move) => (
        move.color === side &&
        LABEL_RANK[move.classification] > 0 &&
        Boolean(move.fenBefore) &&
        isValidUci(move.uci)
      ))
      .sort((a, b) => {
        const scoreDiff = candidateScore(b) - candidateScore(a);
        if (scoreDiff) return scoreDiff;
        return a.ply - b.ply;
      })
      .slice(0, max);
  }

  function normalizeVerifiedItem(candidate, engine) {
    const localClassification = LABEL_RANK[candidate?.classification] === undefined ? 'ok' : candidate.classification;
    const engineClassification = LABEL_RANK[engine?.classification] === undefined ? 'ok' : engine.classification;
    return {
      ply: Math.max(1, Number(candidate?.ply) || 1),
      notation: String(candidate?.notation || candidate?.uci || '—'),
      uci: String(candidate?.uci || ''),
      fen: String(candidate?.fenBefore || ''),
      localClassification,
      localLoss: Math.max(0, Number(candidate?.loss) || 0),
      engineClassification,
      lossCp: Math.max(0, Number(engine?.lossCp) || 0),
      lossPawns: Math.max(0, Number(engine?.lossPawns) || 0),
      bestmove: engine?.bestmove || null,
      same: Boolean(engine?.same),
      depth: Math.max(0, Number(engine?.depth) || 0),
      alternatives: Array.isArray(engine?.alternatives) ? engine.alternatives.slice(0, 3) : []
    };
  }

  function summarize(items) {
    const list = Array.isArray(items) ? items : [];
    const counts = { ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    let confirmed = 0;
    let downgraded = 0;
    let upgraded = 0;

    for (const item of list) {
      const localRank = LABEL_RANK[item.localClassification] ?? 0;
      const engineRank = LABEL_RANK[item.engineClassification] ?? 0;
      counts[item.engineClassification] = (counts[item.engineClassification] || 0) + 1;
      if (engineRank === localRank) confirmed += 1;
      else if (engineRank < localRank) downgraded += 1;
      else upgraded += 1;
    }

    return {
      checked: list.length,
      confirmed,
      downgraded,
      upgraded,
      counts
    };
  }

  return {
    LABEL_RANK,
    isValidUci,
    candidateScore,
    selectCandidates,
    normalizeVerifiedItem,
    summarize
  };
});
