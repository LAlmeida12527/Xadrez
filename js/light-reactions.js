(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KiraLightReactions=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EXPRESSIONS=['atento','intrigado','alerta','concentrado','paciente','satisfeito','impressionado','reflexivo'];
  function expression(context={}){
    if(context.pending)return 'atento';
    if(context.stage==='summary')return 'reflexivo';
    if(context.stage==='solved')return context.verified&&context.decisive&&context.unassisted?'impressionado':'satisfeito';
    if(context.stage==='retry')return 'paciente';
    if(context.stage==='hint1')return 'intrigado';
    if(context.stage==='hint2'||context.stage==='reply')return context.confirmedThreat?'alerta':'paciente';
    if(context.stage==='calculate'||context.stage==='solution')return 'concentrado';
    return 'atento';
  }
  function portrait(name){return `assets/light/${EXPRESSIONS.includes(name)?name:'atento'}.webp`;}
  return {EXPRESSIONS,expression,portrait};
});
