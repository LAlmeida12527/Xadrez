(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KiraProfileSync=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value || {}));
  const safeKey=key=>!['__proto__','prototype','constructor'].includes(key);
  const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).filter(safeKey).sort().map(k=>[k,v[k]])):v);
  const equal=(a,b)=>canonical(a)===canonical(b);
  function counterPaths(profile){
    const paths=['hints','baseline.attempts','baseline.correct','baseline.hints','thinking.planAttempts','thinking.planCorrect'];
    for(const group of ['training','reviews','patterns','patternMemory']){
      for(const [key,value] of Object.entries(profile[group] || {})){
        if(!safeKey(key))continue;
        if(typeof value==='number')paths.push(`${group}.${key}`);
        else for(const field of group==='patternMemory'?['attempts','correct','noHintCorrect','lapses']:Object.keys(value || {})){
          if(safeKey(field)&&typeof value?.[field]==='number')paths.push(`${group}.${key}.${field}`);
        }
      }
    }
    return [...new Set(paths)];
  }
  const get=(object,path)=>path.split('.').reduce((v,k)=>v?.[k],object);
  function set(object,path,value){const parts=path.split('.');if(!parts.every(safeKey))return;let target=object;for(const key of parts.slice(0,-1))target=target[key] ||= {};target[parts.at(-1)]=value;}
  function record(profile,path){return profile._sync?.counters?.[path] || {base:Math.max(0,Number(get(profile,path))||0),devices:{}};}
  function stamp(profile,previous,device,now=new Date().toISOString()){
    const next=clone(profile),old=previous || {};
    next._sync=clone(next._sync);next._sync.fields ||= {};next._sync.counters ||= {};
    const clock=`${now}|${device}`;
    for(const key of Object.keys(next).filter(k=>k!=='_sync'&&safeKey(k)))if(!equal(next[key],old[key]))next._sync.fields[key]=clock;
    for(const path of counterPaths(next)){
      const before=Number(get(old,path))||0,after=Number(get(next,path))||0;
      const entry=clone(record(old,path));entry.devices ||= {};
      entry.devices[device]=(entry.devices[device]||0)+Math.max(0,after-before);
      next._sync.counters[path]=entry;
    }
    for (const game of next.gameArchive || []) {
      const before = (old.gameArchive || []).find(g=>g.id===game.id);
      const content = g=>g?Object.fromEntries(Object.entries(g).filter(([k])=>k!=='syncUpdatedAt')):null;
      if (!equal(content(game),content(before))) game.syncUpdatedAt=clock;
    }
    next._sync.updatedAt=now;return next;
  }
  function gameKey(game){
    const side=game.analysis?.userColor==='b'?'b':'w';
    const moves=(game.moves || []).map(m=>`${m.fenBefore}|${m.uci}`).join('\n');
    return moves ? `${side}|${moves}` : `id:${game.id}`;
  }
  function mergeGames(remote,local){
    const map=new Map(),aliases={};
    for(const game of [...(remote || []),...(local || [])]){
      const key=gameKey(game),old=map.get(key);
      if(!old){const entry=clone(game);if(entry.analysis)entry.analysis.archiveId=entry.id;map.set(key,entry);aliases[game.id]=game.id;continue;}
      const newer=String(game.syncUpdatedAt||'')>String(old.syncUpdatedAt||'')?game:old;
      const other=newer===game?old:game;
      const analysis={...other.analysis,...newer.analysis,archiveId:old.id};
      if ((other.analysis?.phaseEngine?.moves?.length||0)>(analysis.phaseEngine?.moves?.length||0)) analysis.phaseEngine=clone(other.analysis.phaseEngine);
      map.set(key,{...other,...newer,id:old.id,pgn:newer.pgn || other.pgn,analysis});aliases[game.id]=old.id;
    }
    return {games:[...map.values()].sort((a,b)=>String(a.completedAt||a.startedAt||'').localeCompare(String(b.completedAt||b.startedAt||''))),aliases};
  }
  function merge(remote={},local={}){
    const result={},fields={...remote._sync?.fields,...local._sync?.fields};
    for(const key of new Set([...Object.keys(remote),...Object.keys(local)])){
      if(key==='_sync'||!safeKey(key))continue;
      const rc=remote._sync?.fields?.[key] || '',lc=local._sync?.fields?.[key] || '';
      const winner=lc>rc?local:remote;
      result[key]=cloneValue(key in winner?winner[key]:(key in remote?remote[key]:local[key]));
      fields[key]=rc>lc?rc:lc;
    }
    const {games,aliases}=mergeGames(remote.gameArchive,local.gameArchive);result.gameArchive=games;
    result.weaknessSeen=[...new Set([...(remote.weaknessSeen||[]),...(local.weaknessSeen||[])])];
    result.guestTransfers={...remote.guestTransfers,...local.guestTransfers};
    const mistakes=new Map();for(const item of [...(local.recentMistakes||[]),...(remote.recentMistakes||[])]){const key=`${item.fen}|${item.move}`;const old=mistakes.get(key);if(!old||String(item.review?.lastReviewedAt||item.at||'')>String(old.review?.lastReviewedAt||old.at||''))mistakes.set(key,clone(item));}result.recentMistakes=[...mistakes.values()];
    const counters={};
    for(const path of new Set([...counterPaths(remote),...counterPaths(local),...Object.keys(remote._sync?.counters||{}),...Object.keys(local._sync?.counters||{})])){
      const r=record(remote,path),l=record(local,path),devices={...r.devices};
      for(const [id,value] of Object.entries(l.devices||{}))if(safeKey(id))devices[id]=Math.max(devices[id]||0,value||0);
      const base=Math.max(r.base||0,l.base||0);counters[path]={base,devices};set(result,path,base+Object.values(devices).reduce((a,b)=>a+b,0));
    }
    result.patternMemory ||= {};
    for(const key of new Set([...Object.keys(remote.patternMemory||{}),...Object.keys(local.patternMemory||{})])){
      const r=remote.patternMemory?.[key],l=local.patternMemory?.[key];const latest=String(l?.lastSeenAt||'')>String(r?.lastSeenAt||'')?l:r;
      const totals=result.patternMemory[key]||{};result.patternMemory[key]={...cloneValue(latest||l||{}),...Object.fromEntries(['attempts','correct','noHintCorrect','lapses'].filter(k=>k in totals).map(k=>[k,totals[k]]))};
    }
    result.games=Math.max(remote.games||0,local.games||0,games.length);
    result.importedGames=Math.max(remote.importedGames||0,local.importedGames||0,games.filter(g=>g.source==='imported').length);
    for(const [field,label] of [['wins','Vitória'],['losses','Derrota'],['draws','Empate']])result[field]=Math.max(remote[field]||0,local[field]||0,games.filter(g=>g.result===label).length);
    result.stats ||= {};
    for (const field of ['blunders','mistakes','inaccuracies','interventions','materialLost','materialWon']) result.stats[field]=Math.max(remote.stats?.[field]||0,local.stats?.[field]||0,games.reduce((sum,g)=>sum+(Number(g[field])||0),0));
    const selected=result.lastAnalysis?.archiveId;
    if(selected){const game=games.find(g=>g.id===(aliases[selected]||selected));if(game)result.lastAnalysis=game.analysis;}
    for(const item of result.weaknessSession?.items || [])if(item.archiveId)item.archiveId=aliases[item.archiveId]||item.archiveId;
    for(const key of Object.keys(result))if(!(key in fields))fields[key]='';
    result._sync={...(remote._sync?.guestId || local._sync?.guestId ? {guestId:remote._sync?.guestId || local._sync.guestId}:{}),fields,counters,updatedAt:[remote._sync?.updatedAt||'',local._sync?.updatedAt||''].sort().at(-1)};
    return result;
  }
  function cloneValue(value){return value===undefined?null:JSON.parse(JSON.stringify(value));}
  function hasProgress(profile){return Boolean(profile?.gameArchive?.length||profile?.games||profile?.weaknessSession||Object.values(profile?.training||{}).some(v=>v.attempts)||Object.keys(profile?.patternMemory||{}).length);}
  function transferGuest(account,guest,guestId){
    const incoming=clone(guest);delete incoming._sync;delete incoming.guestTransfers;
    // Account preferences and identity stay with the account. Import learning data explicitly.
    const copy={...clone(account),gameArchive:guest.gameArchive||[],recentMistakes:guest.recentMistakes||[],weaknessSeen:guest.weaknessSeen||[]};
    const done=Boolean(account.guestTransfers?.[guestId]);
    copy._sync=clone(account._sync);copy._sync.counters ||= {};copy._sync.fields ||= {};
    for(const path of counterPaths(incoming)){
      const entry=clone(record(account,path));entry.devices ||= {};entry.devices[`guest-${guestId}`]=Math.max(entry.devices[`guest-${guestId}`]||0,Number(get(guest,path))||0);copy._sync.counters[path]=entry;
    }
    if(!done){
      copy.patternMemory={...account.patternMemory};
      for(const [key,value] of Object.entries(guest.patternMemory||{}))if(!copy.patternMemory[key]||String(value.lastSeenAt||'')>String(copy.patternMemory[key].lastSeenAt||''))copy.patternMemory[key]=cloneValue(value);
      if(guest.assessment?.completed&&!account.assessment?.completed)copy.assessment=cloneValue(guest.assessment);
      if(guest.lastAnalysis)copy.lastAnalysis=cloneValue(guest.lastAnalysis);
      for(const key of ['weaknessSession','patternMemory','assessment','lastAnalysis'])if(guest[key]&&(!account[key]||key==='weaknessSession'&&!account.weaknessSession))copy[key]=cloneValue(guest[key]);
      const now=new Date().toISOString();for(const key of ['weaknessSession','patternMemory','assessment','lastAnalysis'])if(!equal(copy[key],account[key]))copy._sync.fields[key]=`${now}|guest-${guestId}`;
    }
    copy.guestTransfers={...account.guestTransfers,[guestId]:true};
    return merge(account,copy);
  }
  return {stamp,merge,mergeGames,gameKey,hasProgress,transferGuest,equivalent:equal};
});
