(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraProgressEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ISSUE_LABELS = new Set(['mistake', 'blunder']);

  function validTime(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function inWindow(value, start, end) {
    const time = validTime(value);
    return time >= start && time < end;
  }

  function gameUserColor(game) {
    return game?.analysis?.userColor === 'b' ? 'b' : 'w';
  }

  function userMoves(game) {
    const side = gameUserColor(game);
    return (Array.isArray(game?.moves) ? game.moves : []).filter((move) => move.color === side);
  }

  function summarizeGames(games) {
    const list = Array.isArray(games) ? games : [];
    const moves = list.flatMap(userMoves);
    const issues = moves.filter((move) => ISSUE_LABELS.has(move.classification));
    const timed = moves.filter((move) => Number.isFinite(Number(move.thinkingMs)) && Number(move.thinkingMs) >= 0);
    const fast = timed.filter((move) => Number(move.thinkingMs) < 3000);
    const deliberate = timed.filter((move) => Number(move.thinkingMs) >= 3000);

    function issueRate(subset) {
      if (!subset.length) return null;
      const count = subset.filter((move) => ISSUE_LABELS.has(move.classification)).length;
      return count / subset.length;
    }

    return {
      games: list.length,
      wins: list.filter((game) => game.result === 'Vitória').length,
      losses: list.filter((game) => game.result === 'Derrota').length,
      draws: list.filter((game) => game.result === 'Empate').length,
      userMoves: moves.length,
      issues: issues.length,
      issuesPerGame: list.length ? issues.length / list.length : null,
      averageThinkingMs: timed.length ? timed.reduce((sum, move) => sum + Number(move.thinkingMs), 0) / timed.length : null,
      fastMoves: fast.length,
      fastIssueRate: issueRate(fast),
      deliberateMoves: deliberate.length,
      deliberateIssueRate: issueRate(deliberate)
    };
  }

  function recentMistakeCategory(mistakes, start, end) {
    const list = (Array.isArray(mistakes) ? mistakes : []).filter((item) => inWindow(item.at, start, end));
    const counts = new Map();
    for (const item of list) {
      const key = item.likelyCause || (Array.isArray(item.concepts) && item.concepts[0]) || item.label || 'erro';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  }

  function percentage(value) {
    return value == null ? null : Math.round(value * 100);
  }

  function buildWeeklyReport(archive, mistakes, nowValue) {
    const now = validTime(nowValue || new Date().toISOString()) || Date.now();
    const day = 86400000;
    const currentStart = now - (7 * day);
    const previousStart = now - (14 * day);
    const games = Array.isArray(archive) ? archive : [];
    const currentGames = games.filter((game) => inWindow(game.completedAt, currentStart, now + 1));
    const previousGames = games.filter((game) => inWindow(game.completedAt, previousStart, currentStart));
    const current = summarizeGames(currentGames);
    const previous = summarizeGames(previousGames);
    const topPattern = recentMistakeCategory(mistakes, currentStart, now + 1);

    let trend = 'baseline';
    if (current.games >= 2 && previous.games >= 2 && current.issuesPerGame != null && previous.issuesPerGame != null) {
      const delta = current.issuesPerGame - previous.issuesPerGame;
      if (delta <= -0.4) trend = 'improving';
      else if (delta >= 0.4) trend = 'worsening';
      else trend = 'stable';
    }

    let speedInsight = null;
    if (current.fastMoves >= 4 && current.deliberateMoves >= 4) {
      const fastRate = current.fastIssueRate || 0;
      const deliberateRate = current.deliberateIssueRate || 0;
      if (fastRate >= deliberateRate + 0.15) {
        speedInsight = {
          type: 'fast-errors',
          fastRate: percentage(fastRate),
          deliberateRate: percentage(deliberateRate)
        };
      } else if (deliberateRate >= fastRate + 0.15) {
        speedInsight = {
          type: 'slow-errors',
          fastRate: percentage(fastRate),
          deliberateRate: percentage(deliberateRate)
        };
      }
    }

    return {
      generatedAt: new Date(now).toISOString(),
      current,
      previous,
      trend,
      topPattern: topPattern ? { label: topPattern[0], count: topPattern[1] } : null,
      speedInsight,
      hasEnoughData: current.games >= 2 || current.userMoves >= 12
    };
  }

  return { summarizeGames, buildWeeklyReport, percentage };
});
