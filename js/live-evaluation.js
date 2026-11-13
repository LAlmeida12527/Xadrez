(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./chess-core.js'):root.KiraChessCore,node?require('./phase-diagnosis.js'):root.KiraPhaseDiagnosis);if(node)module.exports=api;else root.KiraLiveEvaluation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Core,Diagnosis){
  'use strict';
  const LABELS={best:'Melhor lance',ok:'Bom lance',inaccuracy:'Imprecisão',mistake:'Erro',blunder:'Erro grave'};
  function evaluate(entry,ply,result){
    const state=Core.parseFEN(entry.fenBefore);
    const verified=Diagnosis.verifiedMove({state,ply,uci:entry.uci},result);
    let after=Core.makeMoveCopy(state,Core.moveFromUCI(state,entry.uci));
    const continuation=[];
    for(const uci of (result.playedLine?.pv||[]).slice(1,7)){
      const move=Core.moveFromUCI(after,uci);if(!move)break;
      continuation.push(uci);after=Core.makeMoveCopy(after,move);
    }
    return {status:'ready',verified,depth:result.depth,continuation,label:LABELS[result.same?'best':verified.classification]||'Avaliado',evaluatedAt:new Date().toISOString()};
  }
  function snapshot(history,userColor){
    const liveEvaluations=history.flatMap((entry,index)=>entry.liveEvaluation?.status==='ready'?[{ply:index+1,...entry.liveEvaluation}]:[]);
    return {liveEvaluations,phaseEngine:{moves:liveEvaluations.filter(item=>history[item.ply-1].color===userColor).map(item=>item.verified)}};
  }
  class Queue {
    constructor(service){this.service=service;this.jobs=[];this.keys=new Set();this.running=false;}
    pending(prefix){return [...this.keys].some(key=>key.startsWith(prefix+':'));}
    enqueue({key,entry,ply,valid,onResult}){
      if(entry.liveEvaluation?.status==='ready'||this.keys.has(key))return;
      this.keys.add(key);entry.liveEvaluation={status:'pending'};
      this.jobs.push({key,entry,ply,valid,onResult});
      if(!this.running){this.running=true;queueMicrotask(()=>void this.drain());}
    }
    async drain(){
      while(this.jobs.length){
        const job=this.jobs.shift();
        if(!job.valid()){this.keys.delete(job.key);continue;}
        let evaluation;
        try{const result=await this.service.compareMove(job.entry.fenBefore,job.entry.uci,{depth:11,multipv:1});evaluation=evaluate(job.entry,job.ply,result);}
        catch(_){evaluation={status:'error',message:'Não foi possível avaliar este lance. Você pode continuar jogando e tentar novamente.'};}
        this.keys.delete(job.key);
        if(job.valid()){job.entry.liveEvaluation=evaluation;try{job.onResult(evaluation);}catch(error){console.warn('Não foi possível atualizar a avaliação na interface.',error);}}
      }
      this.running=false;
    }
  }
  return {Queue,evaluate,snapshot,LABELS};
});
