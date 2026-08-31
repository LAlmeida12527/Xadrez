(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KiraAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  let client = null;
  let currentUser = null;
  let listener = null;
  let saveTimer = null;

  function config() {
    const value = root.KiraSupabaseConfig || {};
    return { url: String(value.url || '').trim(), anonKey: String(value.anonKey || '').trim() };
  }

  function configured() {
    const cfg = config();
    return Boolean(cfg.url && cfg.anonKey && !cfg.url.includes('YOUR_') && !cfg.anonKey.includes('YOUR_'));
  }

  function ensureClient() {
    if (client) return client;
    if (!configured() || !root.supabase?.createClient) return null;
    const cfg = config();
    client = root.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  function displayName(user) {
    return String(user?.user_metadata?.display_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Jogador').slice(0, 32);
  }

  async function initialize(onChange) {
    listener = typeof onChange === 'function' ? onChange : null;
    const db = ensureClient();
    if (!db) {
      currentUser = null;
      if (listener) listener({ configured: false, user: null, profile: null });
      return { configured: false, user: null, profile: null };
    }

    const { data, error } = await db.auth.getSession();
    if (error) console.warn('Falha ao recuperar sessão.', error);
    currentUser = data?.session?.user || null;
    const cloudProfile = currentUser ? await loadProfile() : null;
    const initial = { configured: true, user: currentUser, profile: cloudProfile };
    if (listener) listener(initial);

    db.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user || null;
      const profile = currentUser ? await loadProfile() : null;
      if (listener) listener({ configured: true, user: currentUser, profile });
    });
    return initial;
  }

  async function signIn(email, password) {
    const db = ensureClient();
    if (!db) throw new Error('Supabase ainda não foi configurado.');
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user || data.session?.user || null;
    return currentUser;
  }

  async function signUp(name, email, password) {
    const db = ensureClient();
    if (!db) throw new Error('Supabase ainda não foi configurado.');
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { data: { display_name: String(name || 'Jogador').trim().slice(0, 32) } }
    });
    if (error) throw error;
    currentUser = data.user || data.session?.user || null;
    return { user: currentUser, needsEmailConfirmation: Boolean(data.user && !data.session) };
  }

  async function signOut() {
    const db = ensureClient();
    if (!db) return;
    const { error } = await db.auth.signOut();
    if (error) throw error;
    currentUser = null;
  }

  async function loadProfile() {
    const db = ensureClient();
    if (!db || !currentUser) return null;
    const { data, error } = await db
      .from('kira_profiles')
      .select('profile,display_name')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error) {
      console.warn('Falha ao carregar progresso da nuvem.', error);
      return null;
    }
    if (!data) return null;
    const profile = data.profile && typeof data.profile === 'object' ? data.profile : null;
    if (profile && data.display_name) profile.name = data.display_name;
    return profile;
  }

  async function saveProfile(profile) {
    const db = ensureClient();
    if (!db || !currentUser || !profile) return false;
    const payload = {
      user_id: currentUser.id,
      display_name: String(profile.name || displayName(currentUser)).slice(0, 32),
      profile,
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('kira_profiles').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.warn('Falha ao salvar progresso na nuvem.', error);
      return false;
    }
    return true;
  }

  function queueProfileSave(profile, delay) {
    if (!currentUser || !configured()) return;
    clearTimeout(saveTimer);
    const snapshot = JSON.parse(JSON.stringify(profile));
    saveTimer = setTimeout(() => saveProfile(snapshot), Math.max(250, Number(delay) || 900));
  }

  return {
    configured,
    initialize,
    signIn,
    signUp,
    signOut,
    loadProfile,
    saveProfile,
    queueProfileSave,
    currentUser: () => currentUser,
    displayName
  };
});
