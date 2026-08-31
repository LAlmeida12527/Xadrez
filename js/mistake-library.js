(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraMistakeLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LABEL_RANK = { ok: 0, inaccuracy: 1, mistake: 2, blunder: 3 };

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function createId(input) {
    const seed = [input?.at, input?.fen, input?.move, input?.ply].join('|');
    return `mistake-${hashString(seed)}`;
  }

  function normalizeReview(review) {
    const source = review && typeof review === 'object' ? review : {};
    return {
      attempts: Math.max(0, Number(source.attempts) || 0),
      successes: Math.max(0, Number(source.successes) || 0),
      partials: Math.max(0, Number(source.partials) || 0),
      streak: Math.max(0, Number(source.streak) || 0),
      intervalDays: Math.max(0, Number(source.intervalDays) || 0),
      lastReviewedAt: source.lastReviewedAt || null,
      nextDueAt: source.nextDueAt || null,
      lastResult: ['success', 'partial', 'repeat'].includes(source.lastResult) ? source.lastResult : null
    };
  }

  function normalizeMistake(input) {
    const value = input && typeof input === 'object' ? input : {};
    const normalized = {
      ...value,
      at: value.at || new Date(0).toISOString(),
      fen: String(value.fen || ''),
      move: String(value.move || ''),
      notation: String(value.notation || value.move || '—'),
      label: LABEL_RANK[value.label] === undefined ? 'inaccuracy' : value.label,
      loss: Math.max(0, Number(value.loss) || 0),
      concepts: Array.isArray(value.concepts) ? value.concepts.filter(Boolean).map(String) : [],
      likelyCause: value.likelyCause ? String(value.likelyCause) : null,
      confidence: ['low', 'medium', 'high'].includes(value.confidence) ? value.confidence : 'low',
      ply: Math.max(0, Number(value.ply) || 0),
      review: normalizeReview(value.review)
    };
    normalized.id = value.id || createId(normalized);
    return normalized;
  }

  function primaryCategory(mistake) {
    const value = normalizeMistake(mistake);
    const concepts = new Set(value.concepts.map((item) => item.toLowerCase()));

    if (concepts.has('mate perdido')) return 'Mate perdido';
    if (concepts.has('peça pendurada')) return 'Peça pendurada';
    if (concepts.has('peça exposta')) return 'Peça exposta';
    if (concepts.has('dama cedo')) return 'Dama precoce';
    if (value.likelyCause === 'não verificou a resposta adversária imediata') return 'Ameaça ignorada';
    if (value.likelyCause === 'não verificou capturas disponíveis') return 'Captura não vista';
    if (value.likelyCause === 'deixou material vulnerável') return 'Material vulnerável';
    if (value.label === 'blunder') return 'Erro grave';
    if (value.label === 'mistake') return 'Erro';
    return 'Imprecisão';
  }

  function evaluateRetry(mistake, newAnalysis) {
    const original = normalizeMistake(mistake);
    const classification = newAnalysis?.classification || {};
    const newLabel = LABEL_RANK[classification.label] === undefined ? 'inaccuracy' : classification.label;
    const newLoss = Math.max(0, Number(classification.loss) || 0);
    const originalRank = LABEL_RANK[original.label] ?? 1;
    const newRank = LABEL_RANK[newLabel] ?? 1;
    const improvement = Math.max(0, original.loss - newLoss);
    const dangerousRisk = Boolean(newAnalysis?.risk && Number(newAnalysis.risk.severity) >= 2);

    let result = 'repeat';
    if (!dangerousRisk && (
      newRank < originalRank ||
      newLoss <= Math.max(0.25, original.loss * 0.45)
    )) {
      result = 'success';
    } else if (newLoss + 0.35 < original.loss || newRank < originalRank) {
      result = 'partial';
    }

    return {
      result,
      originalLoss: original.loss,
      newLoss,
      improvement,
      originalLabel: original.label,
      newLabel,
      dangerousRisk
    };
  }

  function applyReview(mistake, retry, reviewedAt) {
    const value = normalizeMistake(mistake);
    const review = normalizeReview(value.review);
    const when = new Date(reviewedAt || new Date().toISOString());
    const result = retry?.result || 'repeat';
    review.attempts += 1;
    review.lastReviewedAt = when.toISOString();
    review.lastResult = result;

    if (result === 'success') {
      review.successes += 1;
      review.streak += 1;
      const intervals = [3, 7, 15, 30, 60];
      review.intervalDays = intervals[Math.min(review.streak - 1, intervals.length - 1)];
    } else if (result === 'partial') {
      review.partials += 1;
      review.streak = 0;
      review.intervalDays = 1;
    } else {
      review.streak = 0;
      review.intervalDays = 1;
    }

    review.nextDueAt = new Date(when.getTime() + review.intervalDays * 86400000).toISOString();
    return { ...value, review };
  }

  function isDue(mistake, now) {
    const value = normalizeMistake(mistake);
    if (value.review.attempts === 0 || !value.review.nextDueAt) return true;
    const dueAt = new Date(value.review.nextDueAt).getTime();
    const current = now ? new Date(now).getTime() : Date.now();
    if (!Number.isFinite(dueAt) || !Number.isFinite(current)) return true;
    return dueAt <= current;
  }

  function dueMistakes(mistakes, now) {
    const list = Array.isArray(mistakes) ? mistakes.map(normalizeMistake) : [];
    return list
      .filter((mistake) => isDue(mistake, now))
      .sort((a, b) => {
        const aDue = a.review.nextDueAt || a.at || '';
        const bDue = b.review.nextDueAt || b.at || '';
        return String(aDue).localeCompare(String(bDue));
      });
  }

  function summarize(mistakes) {
    const list = Array.isArray(mistakes) ? mistakes.map(normalizeMistake) : [];
    const groups = new Map();

    for (const mistake of list) {
      const category = primaryCategory(mistake);
      const current = groups.get(category) || { category, count: 0, unresolved: 0, lastAt: null };
      current.count += 1;
      if (mistake.review.successes === 0) current.unresolved += 1;
      if (!current.lastAt || mistake.at > current.lastAt) current.lastAt = mistake.at;
      groups.set(category, current);
    }

    return [...groups.values()].sort((a, b) => {
      if (b.unresolved !== a.unresolved) return b.unresolved - a.unresolved;
      if (b.count !== a.count) return b.count - a.count;
      return String(b.lastAt).localeCompare(String(a.lastAt));
    });
  }

  return {
    LABEL_RANK,
    createId,
    normalizeReview,
    normalizeMistake,
    primaryCategory,
    evaluateRetry,
    applyReview,
    isDue,
    dueMistakes,
    summarize
  };
});
