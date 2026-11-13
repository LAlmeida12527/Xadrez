(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraStockfish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SCRIPT = new URL('assets/engine/stockfish-18-lite-single.js', typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;
  const DEFAULT_WASM = new URL('assets/engine/stockfish-18-lite-single.wasm', typeof document !== 'undefined' ? document.baseURI : 'http://localhost/').href;

  function parseInfo(line) {
    if (!line.startsWith('info ')) return null;
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
    const pvMatch = line.match(/\bpv\s+(.+)$/);

    if (!pvMatch || (!cpMatch && !mateMatch)) return null;

    return {
      depth: depthMatch ? Number(depthMatch[1]) : 0,
      multipv: multipvMatch ? Number(multipvMatch[1]) : 1,
      scoreType: mateMatch ? 'mate' : 'cp',
      score: mateMatch ? Number(mateMatch[1]) : Number(cpMatch[1]),
      pv: pvMatch[1].trim().split(/\s+/)
    };
  }

  function buildGoCommand(depth, searchmoves) {
    const safeDepth = Math.max(6, Math.min(18, Number(depth) || 11));
    const moves = Array.isArray(searchmoves) ? searchmoves.filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(move))) : [];
    return `go depth ${safeDepth}${moves.length ? ` searchmoves ${moves.join(' ')}` : ''}`;
  }

  function scoreToComparable(scoreType, score) {
    if (scoreType === 'cp') return Number(score) || 0;
    if (scoreType === 'mate') {
      const mate = Number(score) || 0;
      if (mate > 0) return 100000 - Math.min(99, mate) * 1000;
      if (mate < 0) return -100000 - Math.max(-99, mate) * 1000;
    }
    return 0;
  }

  function classifyCentipawnLoss(lossCp) {
    const loss = Math.max(0, Number(lossCp) || 0);
    if (loss < 35) return 'ok';
    if (loss < 90) return 'inaccuracy';
    if (loss < 200) return 'mistake';
    return 'blunder';
  }

  class StockfishService {
    constructor(options) {
      const cfg = options || {};
      this.scriptUrl = cfg.scriptUrl || DEFAULT_SCRIPT;
      this.wasmUrl = cfg.wasmUrl || DEFAULT_WASM;
      this.worker = null;
      this.workerBlobUrl = null;
      this.state = 'idle';
      this.error = null;
      this.queue = [];
      this.current = null;
      this.uciReady = false;
      this.onStatus = typeof cfg.onStatus === 'function' ? cfg.onStatus : null;
    }

    setState(next, error) {
      this.state = next;
      this.error = error || null;
      if (this.onStatus) this.onStatus({ state: next, error: this.error });
    }

    async load() {
      if (this.state === 'ready') return true;
      if (this.state === 'loading') {
        return new Promise((resolve) => {
          const check = setInterval(() => {
            if (this.state === 'ready' || this.state === 'unavailable') {
              clearInterval(check);
              resolve(this.state === 'ready');
            }
          }, 100);
        });
      }

      this.setState('loading');

      try {
        const response = await fetch(this.scriptUrl, { mode: 'cors', cache: 'force-cache' });
        if (!response.ok) throw new Error(`Falha ao baixar Stockfish (${response.status}).`);
        const source = await response.text();
        const blob = new Blob([source], { type: 'text/javascript' });
        this.workerBlobUrl = URL.createObjectURL(blob);

        // This is the UCI controller. The upstream ",worker" suffix is reserved for secondary workers.
        const hash = `#${encodeURIComponent(this.wasmUrl)}`;
        this.worker = new Worker(this.workerBlobUrl + hash);
        this.worker.addEventListener('message', (event) => this.handleLine(String(event.data || '')));
        this.worker.addEventListener('error', (event) => {
          this.stopWorker(new Error(event.message || 'Erro no Stockfish.'));
        });

        this.worker.postMessage('uci');
        const ready = await this.waitUntilReady(30000);
        if (!ready) throw new Error('Stockfish não respondeu a tempo.');
        this.setState('ready');
        return true;
      } catch (error) {
        this.disposeWorker();
        this.setState('unavailable', error instanceof Error ? error.message : String(error));
        return false;
      }
    }

    waitUntilReady(timeoutMs) {
      return new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          if (this.uciReady) {
            clearInterval(timer);
            resolve(true);
          } else if (this.state === 'unavailable') {
            clearInterval(timer);
            resolve(false);
          } else if (Date.now() - started >= timeoutMs) {
            clearInterval(timer);
            resolve(false);
          }
        }, 80);
      });
    }

    handleLine(line) {
      if (!line) return;
      if (line === 'uciok') {
        this.worker.postMessage('isready');
        return;
      }
      if (line === 'readyok') {
        this.uciReady = true;
        this.pumpQueue();
        return;
      }

      if (!this.current) return;

      const info = parseInfo(line);
      if (info) this.current.lines.set(info.multipv, info);

      if (line.startsWith('bestmove ')) {
        const bestmove = line.split(/\s+/)[1] || null;
        const result = {
          bestmove,
          lines: [...this.current.lines.values()].sort((a, b) => a.multipv - b.multipv)
        };
        const current = this.current;
        this.current = null;
        clearTimeout(current.timer);
        current.resolve(result);
        this.pumpQueue();
      }
    }

    analyze(fen, options) {
      const cfg = options || {};
      if (this.state === 'unavailable') this.setState('idle');
      return new Promise((resolve, reject) => {
        this.queue.push({
          fen,
          depth: Math.max(6, Math.min(18, Number(cfg.depth) || 11)),
          multipv: Math.max(1, Math.min(5, Number(cfg.multipv) || 3)),
          searchmoves: Array.isArray(cfg.searchmoves) ? cfg.searchmoves.slice(0, 8) : [],
          resolve,
          reject
        });
        this.pumpQueue();
      });
    }

    async pumpQueue() {
      if (this.current || !this.queue.length || this.state === 'loading') return;
      if (this.state === 'idle') await this.load();
      if (this.current || !this.queue.length) return;
      if (this.state !== 'ready' || !this.worker || !this.uciReady) {
        const pending = this.queue.splice(0);
        const message = this.error || 'Stockfish indisponível.';
        pending.forEach((item) => item.reject(new Error(message)));
        return;
      }

      const request = this.queue.shift();
      const timer = setTimeout(() => {
        this.stopWorker(new Error('A análise demorou mais do que o esperado.'));
      }, 18000);

      this.current = { ...request, lines: new Map(), timer };
      this.worker.postMessage('ucinewgame');
      this.worker.postMessage(`setoption name MultiPV value ${request.multipv}`);
      this.worker.postMessage(`position fen ${request.fen}`);
      this.worker.postMessage(buildGoCommand(request.depth, request.searchmoves));
    }

    stopWorker(error) {
      const current = this.current;
      this.current = null;
      if (current) {
        clearTimeout(current.timer);
        current.reject(error);
      }
      this.disposeWorker();
      this.queue.splice(0).forEach((item) => item.reject(error));
      this.setState('unavailable', error.message);
    }

    disposeWorker() {
      if (this.worker) {
        try { this.worker.terminate(); } catch (_) { /* sem ação */ }
      }
      this.worker = null;
      if (this.workerBlobUrl) URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
      this.uciReady = false;
    }

    async compareMove(fen, playedMove, options) {
      const cfg = options || {};
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(playedMove || ''))) {
        throw new Error('Lance UCI inválido para comparação.');
      }

      const bestResult = await this.analyze(fen, { depth: cfg.depth || 10, multipv: cfg.multipv || 3 });
      const bestLine = bestResult.lines[0] || null;
      const bestMove = bestResult.bestmove || bestLine?.pv?.[0] || null;

      let playedLine = bestLine;
      if (bestMove !== playedMove) {
        const playedResult = await this.analyze(fen, { depth: cfg.depth || 10, multipv: 1, searchmoves: [playedMove] });
        playedLine = playedResult.lines[0] || null;
      }

      if (!bestLine || !playedLine) throw new Error('Stockfish não retornou avaliação suficiente.');

      const bestScore = scoreToComparable(bestLine.scoreType, bestLine.score);
      const playedScore = scoreToComparable(playedLine.scoreType, playedLine.score);
      const lossCp = Math.max(0, bestScore - playedScore);

      return {
        bestmove: bestMove,
        played: playedMove,
        same: bestMove === playedMove,
        depth: Math.min(bestLine.depth || 0, playedLine.depth || bestLine.depth || 0),
        lossCp,
        lossPawns: Math.round((lossCp / 100) * 100) / 100,
        classification: classifyCentipawnLoss(lossCp),
        best: { scoreType: bestLine.scoreType, score: bestLine.score, pv: bestLine.pv },
        playedLine: { scoreType: playedLine.scoreType, score: playedLine.score, pv: playedLine.pv },
        alternatives: bestResult.lines.slice(0, 3).map((line) => ({
          move: line.pv[0] || null,
          scoreType: line.scoreType,
          score: line.score,
          depth: line.depth
        }))
      };
    }

    dispose() {
      this.stopWorker(new Error('Serviço encerrado.'));
      this.setState('idle');
    }
  }

  return { StockfishService, parseInfo, buildGoCommand, scoreToComparable, classifyCentipawnLoss, DEFAULT_SCRIPT, DEFAULT_WASM };
});
