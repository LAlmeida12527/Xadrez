'use strict';
const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
fs.mkdirSync('work/live-browser',{recursive:true});
async function input(){if(!process.argv.includes('--private-preview'))return {url:process.env.KIRA_TEST_URL||'http://127.0.0.1:8080'};if(process.stdin.isTTY)process.stdin.setRawMode(true);console.log('Pronto para URL/autorização da prévia por stdin (entrada oculta).');return new Promise(resolve=>{let data='';process.stdin.on('data',chunk=>{data+=chunk;if(!data.includes('\n'))return;process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);resolve(JSON.parse(data.trim()));});});}
(async()=>{
 const settings=await input();const base=settings.url.replace(/\/$/,'');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const errors=[];
 const read=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('kiraChessCurrentGame_v5:guest')));
 const profile=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('kiraChessProfile_v5:guest')));
 async function device(width){
  const context=await browser.newContext({viewport:{width,height:920},hasTouch:true,isMobile:width<760,...settings.token&&process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{}});
  if(settings.token)await context.route(base+'/**',async route=>{try{const response=await route.fetch({headers:{...route.request().headers(),'OAI-Sites-Authorization':'Bearer '+settings.token},maxRedirects:0});if(response.status()!==200){errors.push('HTTP '+response.status()+' em '+new URL(route.request().url()).pathname);await route.abort();return;}await route.fulfill({response});}catch(_){if(route.request().failure()||context.pages().every(p=>p.isClosed()))return;errors.push('Não foi possível obter recurso da prévia com TLS verificado.');await route.abort().catch(()=>{});}});
  let release;const gate=new Promise(resolve=>release=resolve);
  await context.route('**/*.wasm',async route=>{await gate;await route.fallback().catch(()=>{});});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.goto(base);await page.locator('#continueGuest').click();await page.locator('[data-view="play"]:visible').first().click();return {page,context,release};
 }
 async function move(page,uci){for(const square of [uci.slice(0,2),uci.slice(2,4)])await page.locator(`#gameBoard [data-row="${8-Number(square[1])}"][data-col="${square.charCodeAt(0)-97}"]`).tap();}
 async function completed(page,count){await page.waitForFunction(n=>{const p=JSON.parse(localStorage.getItem('kiraChessProfile_v5:guest'));return p?.gameArchive?.at(-1)?.analysis?.liveEvaluations?.length===n;},count,{timeout:120000});}
 try{
  const bot=await device(1440);const p=bot.page;
  await p.locator('[data-game-mode="normal"]').click();await p.locator('#liveEvaluationToggle').check();
  await move(p,'e2e4');await p.waitForFunction(()=>JSON.parse(localStorage.getItem('kiraChessCurrentGame_v5:guest')).history.length===2);await move(p,'g1f3');
  assert.equal((await read(p)).history.length,3);assert.equal(await p.locator('[data-live-pending]').count(),3,'Moves proceed while WASM has not loaded');
  await p.locator('#finishRecording').click();const fen=(await read(p)).state;assert.equal((await read(p)).status,'ended');assert.match(await p.locator('#coachMessage').innerText(),/avaliações pendentes/);
  bot.release();await completed(p,3);
  assert.equal((await profile(p)).gameArchive.at(-1).analysis.phaseEngine.moves.length,2);
  await p.locator('[data-live-ply="1"]').click();assert.equal(await p.locator('#liveExplanationBoard .response-arrow').count(),1);assert.match(await p.locator('#liveExplanationText').innerText(),/Continuação possível|continuação possível/);
  assert.deepEqual((await read(p)).state,fen,'Explanation never changes the match');
  await p.screenshot({path:'work/live-browser/bot.png'});
  await p.reload();await p.locator('[data-view="analyze"]:visible').first().click();await p.waitForFunction(()=>document.querySelector('#analyzeGamePhases').textContent==='Stockfish concluído');assert.equal((await profile(p)).gameArchive.at(-1).moves.filter(m=>m.liveEvaluation?.status==='ready').length,3);
  console.log('✓ Bot/convidado: 3 lances antes do WASM carregar, etiquetas reais, linha com seta, conclusão e persistência.');
  const physical=await device(390);const q=physical.page;
  await q.locator('#gameType').selectOption('physical');await q.locator('#userColor').selectOption('b');await q.locator('#newGameButton').click();await q.locator('#liveEvaluationToggle').check();
  for(const uci of ['f2f3','e7e5','g2g4','d8h4'])await move(q,uci);
  assert.equal((await read(q)).history.length,4);assert.equal((await read(q)).status,'ended');assert.equal((await read(q)).result,'Vitória');assert.equal((await read(q)).source,'physical');assert.equal((await read(q)).userColor,'b');assert.equal(await q.locator('[data-live-pending]').count(),4);
  physical.release();await completed(q,4);let archived=(await profile(q)).gameArchive.at(-1);assert.equal(archived.analysis.phaseEngine.moves.length,2);assert.equal(archived.source,'physical');assert.equal(archived.botLevel,0);assert.ok(archived.pgn.includes('Qh4#'));
  await q.locator('[data-live-ply="3"]').click();assert.equal(await q.locator('#liveExplanationBoard .response-arrow').count(),1);assert.match(await q.locator('#liveExplanationText').innerText(),/dama.*h4.*xeque-mate/);
  await q.emulateMedia({reducedMotion:'reduce'});assert.equal(await q.locator('.response-arrow').evaluate(e=>getComputedStyle(e).animationDuration),'1e-06s');assert.ok(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await q.screenshot({path:'work/live-browser/physical-mobile.png'});
  await q.locator('#closeLiveExplanation').click();await q.locator('[data-live-ply="4"]').click();assert.match(await q.locator('#liveExplanationText').innerText(),/não tem resposta legal/);assert.equal(await q.locator('#liveExplanationBoard .response-arrow').count(),0);
  await q.reload();await q.locator('[data-view="analyze"]:visible').first().click();await q.waitForFunction(()=>document.querySelector('#analyzeGamePhases').textContent==='Stockfish concluído');assert.match(await q.locator('#phaseGameSummary').innerText(),/Stockfish/);
  const physicalCount=await q.evaluate(()=>KiraPhaseDiagnosis.summarize(JSON.parse(localStorage.getItem('kiraChessProfile_v5:guest')).gameArchive,{history:true}).games);assert.equal(physicalCount,1);
  console.log('✓ Físico/convidado/celular: ambos os lados, cor preta, mate completo, ameaça em português, seta, movimento reduzido e diagnóstico persistente.');
  const resumed=await device(390);const t=resumed.page;await t.locator('#gameType').selectOption('physical');await t.locator('#liveEvaluationToggle').check();for(const uci of ['f2f3','e7e5','g2g4','d8h4'])await move(t,uci);assert.equal(await t.locator('#playLightPortrait').getAttribute('data-expression'),'atento');await t.reload();await t.locator('[data-view="analyze"]:visible').first().click();resumed.release();await completed(t,4);const restored=(await profile(t)).gameArchive.at(-1);assert.ok(restored.blunders>=1);assert.equal(restored.analysis.phaseEngine.moves.length,2);assert.ok((await profile(t)).stats.blunders>=1);await resumed.context.close();
  console.log('✓ Recarregamento antes do cálculo concluir retoma a fila; erros das brancas e diagnóstico são atualizados sem duplicação.');
  assert.deepEqual(errors,[]);console.log(settings.token?'✓ Ambos os modos testados como convidado com recursos da PRÉVIA WEB privada publicada (HTTP autenticado, TLS verificado).':'✓ Ambos os modos testados no servidor local.');
  await bot.context.close();await physical.context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
