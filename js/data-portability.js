(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraDataPortability = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BACKUP_KIND = 'kira-chess-backup';
  const BACKUP_VERSION = 1;

  function createBackup(profile, currentGame, nowValue) {
    if (!profile || typeof profile !== 'object') throw new Error('Perfil inválido para backup.');
    const now = new Date(nowValue || new Date().toISOString());
    if (Number.isNaN(now.getTime())) throw new Error('Data de backup inválida.');
    return {
      kind: BACKUP_KIND,
      backupVersion: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      profile: JSON.parse(JSON.stringify(profile)),
      currentGame: currentGame && typeof currentGame === 'object' ? JSON.parse(JSON.stringify(currentGame)) : null
    };
  }

  function parseBackup(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); }
      catch (_) { throw new Error('O arquivo não contém JSON válido.'); }
    }
    if (!data || typeof data !== 'object') throw new Error('Backup inválido.');
    if (data.kind !== BACKUP_KIND) throw new Error('Este arquivo não é um backup do Kira Chess.');
    if (Number(data.backupVersion) !== BACKUP_VERSION) throw new Error('Versão de backup não suportada.');
    if (!data.profile || typeof data.profile !== 'object') throw new Error('O backup não contém um perfil válido.');
    return {
      exportedAt: data.exportedAt || null,
      profile: data.profile,
      currentGame: data.currentGame && typeof data.currentGame === 'object' ? data.currentGame : null
    };
  }

  return { BACKUP_KIND, BACKUP_VERSION, createBackup, parseBackup };
});
