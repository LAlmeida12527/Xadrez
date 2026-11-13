'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../js/chess-core');
const base = process.env.KIRA_TEST_URL || 'http://127.0.0.1:8080';
const profileKey='kiraChessProfile_v5:guest';
const output='work/browser';
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(12000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const readProfile=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),profileKey);
  const nav=async(name)=>page.locator(`[data-view="${name}"]:visible`).first().click();
  const shot=async(name)=>{
    await page.locator('.active-view').evaluate(async e=>{await Promise.all(e.getAnimations().map(a=>a.finished.catch(()=>{})));});
    await page.screenshot({path:`${output}/${name}.png`});
  };
  async function imported(name, side) {
    await nav('analyze');
    if(await page.locator('#weaknessPractice').isVisible())await page.locator('#closeWeakness').click();
    await page.locator('#openPgnImport').click();
    const sample=page.locator(`[data-pgn-example="${name}"]`);
    if(await sample.count()) {
      await sample.click();
      await page.waitForFunction(n=>document.querySelector('#pgnInput').value.includes(n), name==='pattern'?'Kd1':name==='all-phases'?'Nc3':name==='black'?'Bc4':'f3');
    } else await page.locator('#pgnInput').fill(fs.readFileSync(`assets/samples/${name}.pgn`,'utf8'));
    await page.locator('#importSide').selectOption(side);
    await page.locator('#confirmPgnImport').click();
    await page.waitForFunction(()=>document.querySelector('#analyzeGamePhases').textContent==='Stockfish concluído',null,{timeout:120000});
    const p=await readProfile();const item=p.gameArchive.find(g=>g.id===p.lastAnalysis.archiveId);
    const own=item.moves.filter(m=>m.color===side).length;
    assert.equal(item.analysis.phaseEngine.moves.length,own);
    assert.match(await page.locator('#phaseGameSummary').innerText(),/Stockfish/);
    console.log(`✓ ${name}: Stockfish verificou ${own} decisões de ${side==='w'?'brancas':'pretas'}.`);
    return item;
  }
  async function tapMove(board,uci){
    const point=s=>`[data-row="${8-Number(s[1])}"][data-col="${s.charCodeAt(0)-97}"]`;
    await page.locator(`#${board} ${point(uci.slice(0,2))}`).tap();
    await page.locator(`#${board} ${point(uci.slice(2,4))}`).tap();
  }
  try {
    await page.goto(base);
    await page.locator('#continueGuest').click();
    const white=await imported('white','w');
    assert.match(await page.locator('#phaseGameSummary').innerText(),/[Aa]mostra pequena/);
    const example=page.locator('#phaseGameCards [data-phase-ply]').first();
    const ply=Number(await example.getAttribute('data-phase-ply'));
    await example.click();
    assert.equal(await page.locator('.review-move-button.active').getAttribute('data-review-ply'),String(ply));
    const uci=white.moves[ply-1].uci;
    assert.equal(await page.locator('#reviewBoard .last-to').getAttribute('data-row'),String(8-Number(uci[3])));
    await page.reload(); await nav('analyze');
    assert.deepEqual((await readProfile()).lastAnalysis.phaseEngine,white.analysis.phaseEngine);
    console.log('✓ Exemplo abre o lance correto; diagnóstico persiste após recarregar.');
    await imported('black','b');
    const black=page.locator('#phaseGameCards [data-phase-ply]').first();await black.click();
    assert.equal(await page.locator('#reviewBoard .square').first().getAttribute('data-row'),'7');
    const all=await imported('all-phases','w');
    const count=await page.evaluate(g=>KiraPhaseDiagnosis.summarize([g]).phases.map(p=>p.moves),all);
    assert.ok(count.every(n=>n>0));
    console.log('✓ Partida desde a posição inicial alcança o final: fases',count);
    await shot('mobile-diagnosis');
    await imported('endgame','w');
    await imported('pattern','w');
    await nav('train');
    assert.equal(await page.locator('#trainFromHistory').isEnabled(),true);
    await page.locator('#trainFromHistory').click();
    await page.locator('#weaknessPractice').evaluate(e=>e.scrollIntoView({block:'start'}));
    await shot('mobile-training-start');
    let session=(await readProfile()).weaknessSession;
    assert.equal(session.items.length,2);
    assert.equal(session.items[0].source,'Stockfish');
    await page.locator('#weaknessHint').click();
    assert.equal(await page.locator('#weaknessBoard .hint').count(),1);
    await page.locator('#weaknessHint').click();
    assert.match(await page.locator('#weaknessFeedback').innerText(),/cavalo pode capturar sua dama em d5 \(Nxd5\)/);
    await page.locator('#weaknessReply').click();
    assert.equal(await page.locator('#weaknessBoard .response-arrow').count(),1);
    assert.equal(await page.locator('#weaknessBoard .response-square').count(),2);
    await shot('mobile-opponent-reply');
    await page.reload(); await nav('analyze');
    assert.equal((await readProfile()).weaknessSession.display,'reply');
    await page.locator('#weaknessReset').click();
    await tapMove('weaknessBoard',session.items[0].best);
    assert.equal((await readProfile()).weaknessSession.solved,true);
    await page.locator('#weaknessNext').click();
    session=(await readProfile()).weaknessSession;
    assert.equal(session.index,1);
    assert.notEqual(session.items[0].fen.split(' ').slice(0,4).join(' '),session.items[1].fen.split(' ').slice(0,4).join(' '));
    await page.locator('#weaknessHint').click();await page.locator('#weaknessHint').click();
    assert.match(await page.locator('#weaknessFeedback').innerText(),/cavalo pode capturar sua dama em h5 \(Nxh5\)/);
    await page.locator('#weaknessSolution').click();
    assert.ok(await page.locator('#weaknessBoard .response-square .piece').count());
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.response-arrow').evaluate(e=>getComputedStyle(e).animationDuration),'1e-06s');
    await shot('mobile-training');
    for(const width of [360,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow em ${width}`);
      const rect=await page.locator('#weaknessBoard').boundingBox();assert.ok(rect.width>=Math.min(280,width-50));
      await shot(`training-${width}`);
    }
    await page.locator('#weaknessNext').click();
    assert.equal((await readProfile()).weaknessSession,null);
    console.log('✓ Treino real → posição inédita; dicas, toque, resposta, solução, persistência, movimento reduzido e larguras 360/390/768/1440.');
    // Seed only the position; the final move and game completion use the public UI.
    const state=Core.parseFEN('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
    await page.evaluate(s=>localStorage.setItem('kiraChessCurrentGame_v5:guest',JSON.stringify({version:6,state:s,history:[],status:'playing',userColor:'w',mode:'normal',source:'standard',startedAt:new Date().toISOString()})),state);
    await page.reload();await nav('play');
    await tapMove('gameBoard','g6g7');
    await page.locator('#reviewFinishedGame').waitFor({state:'visible'});
    await page.locator('#reviewFinishedGame').click();
    await page.waitForFunction(()=>document.querySelector('#analyzeGamePhases').textContent==='Stockfish concluído');
    assert.equal((await readProfile()).lastAnalysis.userColor,'w');
    assert.match(await page.locator('#analysisResult').innerText(),/Vitória/);
    console.log('✓ Partida finalizada no tabuleiro → botão de diagnóstico → Stockfish.');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
