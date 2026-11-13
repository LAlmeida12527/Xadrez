'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Core=require('../js/chess-core');
const base=process.env.KIRA_TEST_URL||'http://127.0.0.1:8080';
const redirect='https://kira-chess-treino-lalmeida12527.agilesunflower2.chatgpt.site/';
const project='https://test-project.supabase.co';
const user={id:'11111111-1111-4111-8111-111111111111',email:'teste@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{full_name:'Conta de teste'},app_metadata:{provider:'google',providers:['google']},created_at:'2026-11-13T10:00:00Z'};
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iss:project+'/auth/v1'})).toString('base64url')+'.simulated-signature';
const session={access_token:token,refresh_token:'simulated-refresh',token_type:'bearer',expires_in:3600,user};
const rows=new Map();
const parsed=Core.parsePGN(fs.readFileSync('assets/samples/black.pgn','utf8'));
rows.set(user.id,{user_id:user.id,revision:1,display_name:'Conta de teste',profile:{name:'Conta de teste',gameArchive:[{id:'already-cloud',source:'imported',result:'Derrota',moves:parsed.moves,analysis:{userColor:'b',archiveId:'already-cloud'}}],training:{threat:{attempts:4,correct:2,hints:0}}}});
const captures=[];let saves=0,conflictOnce=false,offline=false;
fs.mkdirSync('work/auth-browser',{recursive:true});
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
async function device(width=1440,mode='success',configured=true){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<760,hasTouch:true});
 if(configured)await context.route('**/js/supabase-config.js',route=>route.fulfill({contentType:'text/javascript',body:`window.KiraSupabaseConfig=${JSON.stringify({url:project,anonKey:'public-test-key',oauthRedirectUrl:redirect})};`}));
 await context.route(project+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(offline&&url.pathname.startsWith('/rest/'))return route.abort('internetdisconnected');
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
  if(req.method()==='OPTIONS')return json({});
  if(url.pathname==='/auth/v1/authorize'){
    captures.push(url.searchParams.get('redirect_to'));
    const query=mode==='cancel'?'?error=access_denied&error_description=Cancelled':'?code=simulated-google-return';
    return route.fulfill({status:302,headers:{location:base+'/'+query}});
  }
  if(url.pathname==='/auth/v1/token')return mode==='failure'?json({error:'invalid_grant',error_description:'Invalid test code'},400):json(session);
  if(url.pathname==='/auth/v1/signup')return json(session);
  if(url.pathname==='/auth/v1/user')return json(user);
  if(url.pathname==='/auth/v1/logout')return json({});
  const bearer=req.headers().authorization;
  if(bearer!==`Bearer ${token}`)return json({message:'not authenticated'},401);
  if(url.pathname==='/rest/v1/kira_profiles'){
    const id=(url.searchParams.get('user_id')||'').replace(/^eq\./,'');
    if(id!==user.id)return json([]);
    const row=rows.get(id);return json(row?[row]:[]);
  }
  if(url.pathname==='/rest/v1/rpc/kira_save_profile'){
    const body=req.postDataJSON();
    if(body.p_user_id!==user.id)return json({message:'wrong owner'},403);
    const row=rows.get(user.id);
    if(conflictOnce){conflictOnce=false;row.revision++;row.profile.weaknessSeen=[...(row.profile.weaknessSeen||[]),'concurrent-device'];return json(null);}
    if((row?.revision||0)!==body.p_expected_revision)return json(null);
    const revision=(row?.revision||0)+1;rows.set(user.id,{revision,profile:body.p_profile,display_name:body.p_display_name});saves++;return json(revision);
  }
  return json({message:'unexpected mocked endpoint'},404);
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('#continueGuest').click();return {page,context};
}
const nav=async(p,name)=>p.locator(`[data-view="${name}"]:visible`).first().click();
const profile=async(p,scope='guest')=>p.evaluate(key=>JSON.parse(localStorage.getItem('kiraChessProfile_v5:'+key)||'null'),scope);
const account=async p=>p.locator('#mobileAccountButton:visible,#accountButton:visible').first().click();
async function login(p){await account(p);await p.locator('#googleSignIn').click();await p.waitForFunction(()=>!document.querySelector('#authSignedIn').classList.contains('hidden'));}
try{
 const missing=await device(390,'success',false);await account(missing.page);await missing.page.locator('#googleSignIn').click();assert.match(await missing.page.locator('#authError').innerText(),/ainda não foi configurado/);await missing.context.close();
 const pc=await device();
 await nav(pc.page,'analyze');await pc.page.locator('#openPgnImport').click();await pc.page.locator('[data-pgn-example="pattern"]').click();await pc.page.waitForFunction(()=>document.querySelector('#pgnInput').value.includes('Kd1'));await pc.page.locator('#confirmPgnImport').click();
 await pc.page.waitForFunction(()=>document.querySelector('#analyzeGamePhases').textContent==='Stockfish concluído',null,{timeout:90000});
 await pc.page.locator('#trainWeakness').click();await pc.page.locator('#weaknessHint').click();
 assert.equal(await pc.page.locator('#weaknessLightPortrait').getAttribute('data-expression'),'intrigado');
 const guest=await profile(pc.page);const guestJson=JSON.stringify(guest);
 await login(pc.page);
 await pc.page.locator('#guestTransferPrompt').waitFor({state:'visible'});
 assert.equal((await profile(pc.page,user.id)).gameArchive.length,1,'Guest must not transfer before consent');
 conflictOnce=true;await pc.page.locator('#transferGuestProgress').click();
 await pc.page.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('Progresso sincronizado'));
 await pc.page.waitForFunction(uid=>JSON.parse(localStorage.getItem('kiraChessProfile_v5:'+uid)).gameArchive.length===2,user.id);
 assert.equal(JSON.stringify(await profile(pc.page)),guestJson,'Guest copy remains unchanged');
 assert.equal(rows.get(user.id).profile.gameArchive.length,2);
 assert.ok(rows.get(user.id).profile.weaknessSeen.includes('concurrent-device'));
 assert.equal(rows.get(user.id).profile.weaknessSession.hint,1);
 await pc.page.locator('#syncNow').click();await pc.page.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('Progresso sincronizado'));
 assert.equal(rows.get(user.id).profile.gameArchive.length,2);
 console.log('✓ Google SIMULADO com SDK real/PKCE: retorno exato, consentimento, convidado preservado, histórico da nuvem, deduplicação e conflito concorrente.');
 const phone=await device(390);await login(phone.page);
 await phone.page.locator('#authGate').waitFor({state:'hidden'});await nav(phone.page,'analyze');
 const phoneProfile=await profile(phone.page,user.id);assert.equal(phoneProfile.gameArchive.length,2);assert.equal(phoneProfile.weaknessSession.hint,1);
 const imported=phoneProfile.gameArchive.find(g=>g.analysis?.userColor==='w');assert.ok(imported.pgn);assert.equal(imported.analysis.phaseEngine.moves.length,1);
 assert.equal(await phone.page.locator('#weaknessLightPortrait').getAttribute('data-expression'),'intrigado');
 await phone.page.locator('#weaknessHint').click();assert.equal(await phone.page.locator('#weaknessLightPortrait').getAttribute('data-expression'),'alerta');assert.equal(await phone.page.locator('#weaknessBoard .response-arrow').count(),1);
 await account(phone.page);await phone.page.locator('#syncNow').click();await phone.page.waitForFunction(()=>document.querySelector('#syncStatus').textContent.includes('Progresso sincronizado'));
 await pc.page.locator('#syncNow').click();await pc.page.waitForFunction(uid=>JSON.parse(localStorage.getItem('kiraChessProfile_v5:'+uid)).weaknessSession.hint===2,user.id);
 console.log('✓ PC → conta → celular em contexto separado: partida, PGN, Stockfish e treino recebidos; avanço do celular retorna ao PC.');
 offline=true;await phone.page.locator('#syncNow').click();await phone.page.waitForFunction(()=>document.querySelector('#accountSync').dataset.state==='error');assert.match(await phone.page.locator('#syncStatus').innerText(),/local|navegador/);offline=false;
 await phone.page.locator('#syncNow').click();await phone.page.waitForFunction(()=>document.querySelector('#accountSync').dataset.state==='synced');
 await phone.page.screenshot({path:'work/auth-browser/mobile-account.png'});
 assert.ok(await phone.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // Restore a backup through the file input and native confirmation, then reload.
 await phone.page.locator('#closeAuth').click();
 const backup={kind:'kira-chess-backup',backupVersion:1,profile:guest,currentGame:null};
 phone.page.once('dialog',dialog=>dialog.accept());
 await phone.page.locator('#backupFileInput').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await phone.page.waitForEvent('load');
 assert.equal((await profile(phone.page,user.id)).gameArchive.length,2);
 assert.equal(await phone.page.evaluate(()=>localStorage.getItem('kiraChessProfile_v5')),null);
 console.log('✓ Sem conexão: erro claro, cópia local e recuperação. Backup usa chaves do usuário e não apaga o histórico.');
 for(const mode of ['cancel','failure']){
   const test=await device(390,mode);await account(test.page);await test.page.locator('#googleSignIn').click();
   await test.page.locator('#authError').waitFor({state:'visible'});assert.match(await test.page.locator('#authError').innerText(),mode==='cancel'?/cancelado/:/Não foi possível|não concluído/);
   if(mode==='cancel'){
     await test.page.locator('#signInEmail').fill('teste@example.invalid');await test.page.locator('#signInPassword').fill('password-simulado');await test.page.locator('#signInForm button[type=submit]').click();
     await test.page.waitForFunction(uid=>Boolean(localStorage.getItem('kiraChessProfile_v5:'+uid)),user.id);
     await test.page.locator('#authGate').waitFor({state:'hidden'});
   }
   await test.context.close();
 }
 const signup=await device(390);await account(signup.page);await signup.page.locator('[data-auth-tab=signup]').click();await signup.page.locator('#signUpName').fill('Conta de teste');await signup.page.locator('#signUpEmail').fill('teste@example.invalid');await signup.page.locator('#signUpPassword').fill('password-simulado');await signup.page.locator('#signUpForm button[type=submit]').click();await signup.page.waitForFunction(uid=>Boolean(localStorage.getItem('kiraChessProfile_v5:'+uid)),user.id);await signup.context.close();
 console.log('✓ E-mail/senha após cancelamento Google e criação de conta continuam funcionando com endpoints simulados.');
 assert.ok(captures.every(url=>url===redirect));
 assert.deepEqual(errors,[]);
 console.log('✓ Cancelamento e falha OAuth em português; Conta em largura de celular. Google REAL não testado.');
 await pc.context.close();await phone.context.close();
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
