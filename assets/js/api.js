// Capa de acceso a datos (Supabase). Toda la lógica sensible se valida en el servidor.
import { CONFIG } from './config.js?v=1.4.0';

let sb = null;
function client() {
  if (!sb) {
    if (!window.supabase) throw new Error('No se pudo cargar la librería de conexión.');
    sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'simad-auth' },
      realtime: { params: { eventsPerSecond: 5 } }
    });
  }
  return sb;
}
async function rpc(name, args = {}) {
  const { data, error } = await client().rpc(name, args);
  if (error) throw new Error(error.message || String(error));
  return data;
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || String(error));
  return data;
}
// Funciones del servidor (Edge Functions): el error trae un código propio, por ejemplo MP_ERROR
async function fn(name, body) {
  const { data, error } = await client().functions.invoke(name, { body });
  if (error) {
    let info = null;
    try { info = await error.context?.json?.(); } catch (e) { }
    const err = new Error(info?.error || error.message || 'Error del servidor');
    err.detail = info?.detail || null; err.http = info?.http || null;
    throw err;
  }
  return data;
}

const realApi = {
  async getSession() {
    const { data } = await client().auth.getSession();
    return data.session;
  },
  onAuth(cb) {
    const { data } = client().auth.onAuthStateChange((event, session) => cb(event, session));
    return () => data.subscription.unsubscribe();
  },
  async signInGoogle() {
    const redirectTo = location.origin + location.pathname;
    const { error } = await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
    if (error) throw error;
  },
  async signOut(scope = 'local') { try { await client().auth.signOut({ scope }); } catch (e) { /* sin conexión */ } },
  async revokeOtherSessions() { try { await client().auth.signOut({ scope: 'others' }); } catch (e) { /* opcional */ } },
  async getProfile(uid) { return q(client().from('profiles').select('*').eq('id', uid).maybeSingle()); },
  async updateProfile(uid, fields) { return q(client().from('profiles').update(fields).eq('id', uid).select().single()); },
  checkDevice: (key, fp, fphw, label) => rpc('check_device', { p_key: key, p_fp: fp || null, p_fphw: fphw || null, p_label: label || null }),
  claimSession: (sid, device, ua) => rpc('claim_session', { p_session: sid, p_device: device, p_ua: ua }),
  sessionAlive: (sid) => rpc('session_alive', { p_session: sid }),
  claimAdmin: (code) => rpc('claim_admin', { p_code: code }),
  subscribeDevice(uid, cb) {
    const ch = client().channel('device-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_sessions', filter: `user_id=eq.${uid}` }, payload => cb(payload))
      .subscribe();
    return () => { try { client().removeChannel(ch); } catch (e) { } };
  },

  // Exámenes y práctica
  startAttempt: (sid, o) => rpc('start_attempt', { p_session: sid, p_mode: o.mode, p_subarea: o.subarea || null, p_count: o.count || null, p_secure: o.secure ?? true, p_doc: o.doc || null, p_focus: o.focus || null }),
  activeAttempt: (sid, mode = null) => rpc('get_active_attempt', { p_session: sid, p_mode: mode }),
  saveAnswer: (sid, att, pos, choice, marked = null) => rpc('save_answer', { p_session: sid, p_attempt: att, p_pos: pos, p_choice: choice, p_marked: marked }),
  answerPractice: (sid, att, pos, choice) => rpc('answer_practice', { p_session: sid, p_attempt: att, p_pos: pos, p_choice: choice }),
  logIncident: (sid, att, type, detail) => rpc('log_incident', { p_session: sid, p_attempt: att, p_type: type, p_detail: detail || null }),
  submitAttempt: (sid, att, annul = false) => rpc('submit_attempt', { p_session: sid, p_attempt: att, p_annul: annul }),
  review: (att) => rpc('get_attempt_review', { p_attempt: att }),
  listAttempts: (uid, limit = 200) => q(client().from('attempts').select('id,mode,filter_subarea,filter_doc,focus,total,time_limit_sec,started_at,finished_at,elapsed_sec,status,correct,score,breakdown,incidents,secure_mode').eq('user_id', uid).order('started_at', { ascending: false }).limit(limit)),
  myStats: () => rpc('my_stats'),
  logStudy: (sid, doc, minutes) => rpc('log_study', { p_session: sid, p_doc: doc, p_minutes: minutes }),

  // Estudio
  listDocs: () => q(client().from('study_docs').select('id,num,title,short,subareas,pages,summary').order('num')),
  getDoc: (id) => q(client().from('study_docs').select('*').eq('id', id).maybeSingle()),
  studyProgress: (uid) => q(client().from('study_progress').select('doc_id,status,updated_at').eq('user_id', uid)),
  setStudyProgress: (uid, doc, status) => status
    ? q(client().from('study_progress').upsert({ user_id: uid, doc_id: doc, status, updated_at: new Date().toISOString() }))
    : q(client().from('study_progress').delete().eq('user_id', uid).eq('doc_id', doc)),

  // Pago de acceso (Mercado Pago)
  paymentConfig: () => rpc('payment_config'),
  payCreate: () => fn('mp-checkout', { action: 'create' }),
  paySync: () => fn('mp-checkout', { action: 'sync' }),
  myPayments: (uid) => q(client().from('payments').select('order_id,amount,status,status_detail,payment_method,live,created_at,updated_at,paid_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(10)),

  // Reportes
  reportBug: (uid, r) => q(client().from('bug_reports').insert({ user_id: uid, category: r.category, description: r.description, page: r.page, context: r.context })),
  myBugs: (uid) => q(client().from('bug_reports').select('id,category,description,status,admin_note,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(30)),
  logClientError: (uid, e) => client().from('client_errors').insert({ user_id: uid, message: e.message, source: e.source, stack: e.stack, page: e.page, ua: navigator.userAgent }).then(() => { }, () => { }),

  // Administración
  admin: {
    overview: () => rpc('admin_overview'),
    users: () => rpc('admin_users'),
    setStatus: (u, s) => rpc('admin_set_status', { p_user: u, p_status: s }),
    setRole: (u, r) => rpc('admin_set_role', { p_user: u, p_role: r }),
    resetDevice: (u) => rpc('admin_reset_device', { p_user: u }),
    allowed: () => q(client().from('allowed_emails').select('*').order('created_at', { ascending: false })),
    addAllowed: (email, note) => q(client().from('allowed_emails').insert({ email: email.trim().toLowerCase(), note: note || null })),
    removeAllowed: (email) => q(client().from('allowed_emails').delete().eq('email', email)),
    bugs: () => q(client().from('bug_reports').select('*').order('created_at', { ascending: false }).limit(300)),
    updateBug: (id, status, note) => rpc('admin_update_bug', { p_id: id, p_status: status, p_note: note || null }),
    errors: () => q(client().from('client_errors').select('*').order('created_at', { ascending: false }).limit(200)),
    importContent: (payload) => rpc('admin_import_content', { p: payload }),
    questions: () => q(client().from('questions').select('id,area,subarea,format,stem,options,answer,rationale,reference,docs,active').order('id')),
    setQuestionActive: (id, active) => q(client().from('questions').update({ active }).eq('id', id)),
    devices: () => rpc('admin_devices'),
    deviceAction: (id, action) => rpc('admin_device_action', { p_conflict: id, p_action: action }),
    bindAttempts: () => rpc('admin_bind_attempts'),
    releaseBinding: (u) => rpc('admin_release_binding', { p_user: u }),
    bindIgnore: (u) => rpc('admin_bind_ignore', { p_user: u }),
    getSettings: () => rpc('admin_get_settings'),
    setAutoApprove: (on) => rpc('admin_set_auto_approve', { p_on: !!on }),
    payments: () => rpc('admin_payments'),
    setPayments: (on, price) => rpc('admin_set_payments', { p_on: !!on, p_price: Number(price) }),
    payCheck: () => fn('mp-checkout', { action: 'check' }),
    sessionEvents: (uid) => q(client().from('session_events').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(20))
  }
};

export const api = window.SimadMockApi || realApi;
