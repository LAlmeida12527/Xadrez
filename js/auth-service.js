(function(root,factory){const sync=typeof module==='object'&&module.exports?require('./profile-sync.js'):root.KiraProfileSync;const api=factory(root,sync);if(typeof module==='object'&&module.exports)module.exports=api;else root.KiraAuth=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root,Sync){
  'use strict';
  let client=null,currentUser=null,listener=null,statusListener=null,saveTimer=null,active=null,generation=0,pollTimer=null;
  const profileKey=id=>`kiraChessProfile_v5:${id}`;
  const localRead=id=>{try{return JSON.parse(root.localStorage?.getItem(profileKey(id))||'{}');}catch(_){return {};}};
  const localWrite=(id,value)=>root.localStorage?.setItem(profileKey(id),JSON.stringify(value));
  const config=()=>root.KiraSupabaseConfig||{};
  function configured(){const c=config();return Boolean(/^https:\/\//.test(c.url||'')&&c.anonKey&&!String(c.anonKey).includes('YOUR_'));}
  function ensureClient(){
    if(client)return client;if(!configured()||!root.supabase?.createClient)return null;
    client=root.supabase.createClient(config().url,config().anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});return client;
  }
  const displayName=user=>String(user?.user_metadata?.display_name||user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email?.split('@')[0]||'Jogador').slice(0,32);
  function message(error){
    const code=String(error?.code||error?.error_code||'');
    if(code==='access_denied'||/cancel|access.denied/i.test(error?.message||''))return 'Login com Google cancelado. Seu progresso local continua salvo.';
    if(/provider|unsupported_provider|validation_failed/.test(code)||/provider.*(enable|support)/i.test(error?.message||''))return 'O login com Google ainda não foi ativado no Supabase. Você pode entrar com e-mail ou continuar como convidado.';
    if(/invalid.*credentials/i.test(error?.message||''))return 'E-mail ou senha incorretos.';
    if(/email.*confirm/i.test(error?.message||''))return 'Confirme seu e-mail antes de entrar.';
    if(/fetch|network|offline/i.test(error?.message||''))return 'Não foi possível conectar. Confira sua internet; o progresso local foi preservado.';
    return 'Não foi possível concluir o login. Tente novamente ou continue como convidado.';
  }
  const status=(state,text)=>{if(statusListener)statusListener({state,text});};
  const ownerIs=(id,epoch)=>currentUser?.id===id&&generation===epoch;
  async function readCloud(id){
    const {data,error}=await ensureClient().from('kira_profiles').select('profile,display_name,revision').eq('user_id',id).maybeSingle();
    if(error)throw new Error('Não foi possível ler a nuvem. Seu progresso local está salvo. Verifique a conexão e a configuração da sincronização.');
    if(data&&typeof data.revision!=='number')throw new Error('A sincronização precisa da atualização do banco. Seu progresso local está salvo.');
    return {profile:data?.profile||{},revision:data?.revision||0};
  }
  async function reconcile(write=true){
    if(!currentUser||!ensureClient())return null;
    const id=currentUser.id,epoch=generation;
    status('syncing','Sincronizando seu progresso…');
    try{
      for(let attempt=0;attempt<5;attempt++){
        const remote=await readCloud(id);if(!ownerIs(id,epoch))return null;
        const local=localRead(id),merged=Sync.merge(remote.profile,local);
        if(!write){localWrite(id,merged);return merged;}
        if(Sync.equivalent(merged,remote.profile)){
          localWrite(id,merged);status('synced','Progresso sincronizado entre seus dispositivos.');return merged;
        }
        const {data,error}=await ensureClient().rpc('kira_save_profile',{p_user_id:id,p_expected_revision:remote.revision,p_profile:merged,p_display_name:String(merged.name||displayName(currentUser)).slice(0,32)});
        if(!ownerIs(id,epoch))return null;
        if(error)throw new Error('Não foi possível salvar na nuvem. Seu progresso continua neste navegador. Tente sincronizar novamente.');
        if(data===null)continue; // Another device committed first; read and merge again.
        const latest=Sync.merge(merged,localRead(id));localWrite(id,latest);
        if(!Sync.equivalent(latest,merged))continue;
        status('synced','Progresso sincronizado entre seus dispositivos.');return latest;
      }
      throw new Error('Outro dispositivo está atualizando o progresso. Tente sincronizar novamente. Sua cópia local está salva.');
    }catch(error){if(ownerIs(id,epoch))status('error',error.message);throw error;}
  }
  async function syncNow(){
    if(!currentUser)return null;
    const id=currentUser.id,epoch=generation;
    if(active?.id===id)return active.promise;
    const promise=reconcile().then(profile=>{
      if(profile&&ownerIs(id,epoch)&&listener)listener({configured:true,user:currentUser,profile,event:'sync'});
      return profile;
    }).finally(()=>{if(active?.promise===promise)active=null;});
    active={id,promise};return promise;
  }
  function queueProfileSave(profile,delay=850){
    if(!currentUser||!configured())return;
    // The app already saves into the user-scoped key; never retain an old user's snapshot in a timer.
    clearTimeout(saveTimer);const id=currentUser.id,epoch=generation;
    saveTimer=setTimeout(()=>{if(ownerIs(id,epoch))void syncNow().catch(()=>{});},Math.max(50,Number(delay)||850));
  }
  async function loadProfile(){if(!currentUser)return null;return (await readCloud(currentUser.id)).profile;}
  async function saveProfile(profile){if(!currentUser)return false;localWrite(currentUser.id,profile);try{await syncNow();return true;}catch(_){return false;}}
  function oauthError(){
    if(!root.location)return null;
    const query=new URLSearchParams(root.location.search),hash=new URLSearchParams(root.location.hash.slice(1));
    const code=query.get('error_code')||query.get('error')||hash.get('error_code')||hash.get('error');
    if(!code)return null;
    const text=message({code,message:code});
    const url=new URL(root.location.href);for(const k of ['error','error_code','error_description'])url.searchParams.delete(k);
    if(hash.has('error'))url.hash='';root.history?.replaceState(null,'',url.pathname+url.search+url.hash);
    root.sessionStorage?.removeItem('kiraGooglePending');return text;
  }
  async function establish(user,event='initial',authMessage=null){
    generation++;clearTimeout(saveTimer);currentUser=user||null;
    const id=currentUser?.id,epoch=generation;let profile=null;
    if(id){
      try{const cloud=await readCloud(id);if(!ownerIs(id,epoch))return;profile=Sync.merge(cloud.profile,localRead(id));localWrite(id,profile);status('pending','Progresso local carregado; conferindo a nuvem…');}
      catch(error){profile=localRead(id);status('error',error.message);}
    }else status('guest','Como convidado, o progresso fica neste navegador.');
    if(generation!==epoch)return;
    if(listener)await listener({configured:configured()&&Boolean(client),user:currentUser,profile,event,authMessage});
    if(id){root.sessionStorage?.removeItem('kiraGooglePending');queueProfileSave(profile,100);}
  }
  async function initialize(onChange,onStatus){
    listener=typeof onChange==='function'?onChange:null;statusListener=typeof onStatus==='function'?onStatus:null;
    const returnedError=oauthError();const db=ensureClient();
    if(!db){if(listener)await listener({configured:false,user:null,profile:null,authMessage:returnedError});return {configured:false,user:null,profile:null};}
    const {data,error}=await db.auth.getSession();
    const pending=root.sessionStorage?.getItem('kiraGooglePending');
    const authMessage=returnedError||(error?message(error):!data?.session&&pending?'Login com Google não concluído. Tente novamente ou continue como convidado.':null);
    if(!data?.session)root.sessionStorage?.removeItem('kiraGooglePending');
    await establish(data?.session?.user||null,'initial',authMessage);
    // Never await another Supabase call inside onAuthStateChange's auth lock.
    db.auth.onAuthStateChange((event,session)=>{
      if(['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event))return;
      setTimeout(()=>{void establish(session?.user||null,event).catch(()=>status('error','Não foi possível atualizar a sessão. Seu progresso local está salvo.'));},0);
    });
    if(root.addEventListener){root.addEventListener('online',()=>void syncNow().catch(()=>{}));root.document?.addEventListener('visibilitychange',()=>{if(root.document.visibilityState==='visible')void syncNow().catch(()=>{});});}
    clearInterval(pollTimer);if(root.document)pollTimer=setInterval(()=>{if(root.document.visibilityState==='visible')void syncNow().catch(()=>{});},30000);
    return {configured:true,user:currentUser};
  }
  async function signIn(email,password){const db=ensureClient();if(!db)throw new Error('O login ainda não foi configurado. Continue como convidado.');const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw new Error(message(error));return data.user;}
  async function signInWithGoogle(){
    const db=ensureClient();if(!db)throw new Error('O login com Google ainda não foi configurado. Você pode continuar como convidado; seu progresso será preservado.');
    const redirectTo=config().oauthRedirectUrl;
    if(redirectTo!=='https://kira-chess-treino-lalmeida12527.agilesunflower2.chatgpt.site/')throw new Error('O retorno seguro do Google ainda não foi configurado nesta versão.');
    root.sessionStorage?.setItem('kiraGooglePending',String(Date.now()));
    const {data,error}=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo,queryParams:{prompt:'select_account'}}});
    if(error){root.sessionStorage?.removeItem('kiraGooglePending');throw new Error(message(error));}return data;
  }
  async function signUp(name,email,password){const db=ensureClient();if(!db)throw new Error('O login ainda não foi configurado. Continue como convidado.');const {data,error}=await db.auth.signUp({email,password,options:{data:{display_name:String(name||'Jogador').trim().slice(0,32)}}});if(error)throw new Error(message(error));return {user:data.user,needsEmailConfirmation:Boolean(data.user&&!data.session)};}
  async function signOut(){clearTimeout(saveTimer);try{await syncNow();}catch(_){}const db=ensureClient();if(!db)return;const {error}=await db.auth.signOut({scope:'local'});if(error)throw new Error(message(error));}
  return {configured,initialize,signIn,signInWithGoogle,signUp,signOut,loadProfile,saveProfile,queueProfileSave,syncNow,currentUser:()=>currentUser,displayName,message};
});
