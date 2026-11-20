// API simulada en memoria para probar la interfaz sin servidor (replica la lógica de las funciones SQL)
const DEMO_BINDS = () => [{ user_id: 'u-7', email: 'karla.rdz@gmail.com', full_name: 'Karla Rodríguez', user_status: 'approved', open: 2, total: 2, last_at: new Date(Date.now() - 36e5).toISOString(), last_label: 'Safari en iPhone', bound_label: 'Chrome en Android', bound_at: new Date(Date.now() - 6 * 864e5).toISOString() }];
(function () {
  const D = window.MOCK_DATA;
  const ADMIN = { id: 'u-admin', email: 'admin@example.com', user_metadata: { full_name: 'Usuario de Prueba' } };
  const LS = window.localStorage;
  const db = JSON.parse(LS.getItem('mockdb') || 'null') || {
    profiles: { 'u-admin': { id: 'u-admin', email: 'admin@example.com', full_name: 'Usuario de Prueba', avatar_url: null, role: 'admin', status: 'approved', folio: 'ADM-4821-730915', exam_date: null, daily_goal_min: 60, study_days: [1, 2, 3, 4, 5], created_at: new Date().toISOString() },
      'u-2': { id: 'u-2', email: 'maestra@example.com', full_name: 'Maestra Pendiente', role: 'user', status: 'pending', folio: 'ADM-1111-222222', created_at: new Date().toISOString() } },
    device: { 'u-admin': { session_id: null } }, attempts: [], items: {}, activity: [], progress: {}, bugs: [], errors: [], allowed: [], events: [],
    questions: D.questions.map(q => ({ ...q, active: true })), docs: D.docs
  };
  const save = () => LS.setItem('mockdb', JSON.stringify(db));
  const sleep = (ms = 60) => new Promise(r => setTimeout(r, ms));
  const uid = () => 'u-admin';
  const fail = (c) => { throw new Error(c); };
  const signed = () => LS.getItem('mock_signed') === '1';
  const assert = (sid) => { if (!signed()) fail('NO_AUTH'); if (db.profiles[uid()].status !== 'approved') fail('NOT_APPROVED'); if (db.device[uid()]?.session_id !== sid) fail('SESSION_REPLACED'); };
  const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const qmap = () => Object.fromEntries(db.questions.map(q => [q.id, q]));
  const shown = (ans, ord) => 'ABC'[ord.indexOf(ans)];
  const remap = (t, ord) => String(t || '').replace(/\{([ABC])\}/g, (_, k) => 'ABC'[ord.indexOf(k)]);
  const render = (q, ord) => ({ id: q.id, area: q.area, subarea: q.subarea, format: q.format, stem: q.stem, items: q.items, options: ord.map((k, i) => ({ k: 'ABC'[i], t: q.options.find(o => o.k === k).t })) });
  const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const payload = (a) => ({ attempt_id: a.id, mode: a.mode, total: a.total, time_limit_sec: a.time_limit_sec, started_at: a.started_at, server_now: new Date().toISOString(), secure_mode: a.secure_mode, incidents: a.incidents.length, filter_subarea: a.filter_subarea,
    items: db.items[a.id].map(it => ({ ...render(qmap()[it.question_id], it.opt_order), pos: it.pos, chosen: it.chosen, marked: it.marked })) });
  function grade(a, status) {
    const qs = qmap(); const its = db.items[a.id];
    const bd = { subarea: {}, area: {}, format: {}, answered: 0, marked: 0 };
    const relevant = a.mode === 'practica' ? its.filter(i => i.chosen) : its;
    let c = 0;
    for (const it of relevant) {
      const q = qs[it.question_id];
      for (const [k, v] of [['subarea', q.subarea], ['area', String(q.area)], ['format', q.format]]) { bd[k][v] = bd[k][v] || { total: 0, correct: 0 }; bd[k][v].total++; if (it.is_correct) bd[k][v].correct++; }
      if (it.is_correct) c++; if (it.chosen) bd.answered++; if (it.marked) bd.marked++;
    }
    if (a.mode === 'practica' && !relevant.length) status = 'abandoned';
    a.status = status; a.finished_at = new Date().toISOString();
    a.elapsed_sec = Math.min(a.time_limit_sec || 1e9, Math.round((Date.now() - new Date(a.started_at)) / 1000));
    a.correct = c; a.total = a.mode === 'practica' ? relevant.length : a.total; a.score = a.total ? Math.round(1000 * c / a.total) / 10 : 0; a.breakdown = bd;
    db.activity.push({ day: day(), kind: a.mode, minutes: a.elapsed_sec / 60, questions: relevant.filter(i => i.chosen).length, correct: c, score: a.score });
    save();
  }
  const api = {
    async getSession() { await sleep(); return signed() ? { user: ADMIN } : null; },
    onAuth(cb) { return () => { }; },
    async signInGoogle() { LS.setItem('mock_signed', '1'); location.reload(); },
    async signOut() { LS.removeItem('mock_signed'); },
    async revokeOtherSessions() { },
    async getProfile(id) { await sleep(); return db.profiles[id]; },
    async updateProfile(id, f) { Object.assign(db.profiles[id], f); save(); return db.profiles[id]; },
    async checkDevice(key, fp, fphw, label) { db.lastFp = { key, fp, fphw }; save(); if (localStorage.getItem('mock_bound')) return { ok: false, reason: 'account_bound', bound_label: 'Chrome en Android', bound_since: new Date(Date.now() - 5 * 864e5).toISOString() }; return localStorage.getItem('mock_conflict') ? { ok: false, owner_hint: 'jo•••@gmail.com' } : { ok: true }; },
    async claimSession(sid, dev, ua) { const prev = db.device[uid()]?.session_id; db.device[uid()] = { session_id: sid, device_label: dev }; db.events.push({ created_at: new Date().toISOString(), device_label: dev, user_agent: ua, replaced_other: !!prev && prev !== sid }); save(); const p = db.profiles[uid()]; return { status: p.status, role: p.role, replaced_other: !!prev && prev !== sid }; },
    async sessionAlive(sid) { return db.device[uid()]?.session_id === sid; },
    async claimAdmin(code) { return code === 'TEST-CODE'; },
    subscribeDevice(id, cb) { window.__mockKick = () => { db.device[uid()].session_id = 'otro'; save(); cb({ session_id: 'otro' }); }; return () => { }; },
    async startAttempt(sid, o) {
      assert(sid); await sleep(120);
      const qs = db.questions.filter(q => q.active);
      let picked = [];
      const seen = new Set(Object.values(db.items).flat().map(i => i.question_id));
      const wrong = new Set(Object.values(db.items).flat().filter(i => i.chosen && !i.is_correct).map(i => i.question_id));
      if (o.mode === 'practica') {
        let pool = qs.filter(q => (!o.subarea || q.subarea === o.subarea) && (!o.doc || (q.docs || []).includes(o.doc)) && (o.focus !== 'errores' || wrong.has(q.id)));
        pool = shuffle(pool).sort((a, b) => (seen.has(a.id) - seen.has(b.id)));
        picked = pool.slice(0, Math.min(o.count || 10, 50));
      } else {
        for (const a of db.attempts) if (a.status === 'in_progress' && a.mode === o.mode) a.status = 'abandoned';
        const per = o.mode === 'simulacro' ? 15 : 5;
        for (const s of ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2']) picked.push(...shuffle(qs.filter(q => q.subarea === s)).sort((a, b) => seen.has(a.id) - seen.has(b.id)).slice(0, per));
        picked = shuffle(picked);
      }
      if (!picked.length) fail('NO_QUESTIONS');
      const a = { id: 'a' + Date.now(), user_id: uid(), mode: o.mode, filter_subarea: o.subarea || null, filter_doc: o.doc || null, focus: o.focus || null, total: picked.length,
        time_limit_sec: o.mode === 'simulacro' ? (window.MOCK_SHORT ? 90 : 14400) : o.mode === 'corto' ? picked.length * 160 : null, started_at: new Date().toISOString(), status: 'in_progress', incidents: [], secure_mode: !!o.secure };
      db.attempts.unshift(a);
      db.items[a.id] = picked.map((q, i) => ({ pos: i + 1, question_id: q.id, opt_order: shuffle(['A', 'B', 'C']), chosen: null, marked: false, is_correct: null }));
      save(); return payload(a);
    },
    async activeAttempt(sid, mode) {
      assert(sid);
      const a = db.attempts.find(x => x.status === 'in_progress' && (!mode || x.mode === mode) && x.mode !== 'practica');
      if (!a) return null;
      if (a.time_limit_sec && Date.now() > new Date(a.started_at).getTime() + (a.time_limit_sec + 60) * 1000) { grade(a, 'submitted'); return { expired: true, attempt_id: a.id }; }
      return payload(a);
    },
    async saveAnswer(sid, att, pos, ch, marked) {
      assert(sid); await sleep(40);
      const a = db.attempts.find(x => x.id === att); if (a.status !== 'in_progress') fail('ATTEMPT_CLOSED');
      const it = db.items[att][pos - 1]; const q = qmap()[it.question_id];
      it.chosen = ch; if (marked !== null && marked !== undefined) it.marked = marked;
      it.is_correct = ch ? it.opt_order['ABC'.indexOf(ch)] === q.answer : null; save(); return true;
    },
    async answerPractice(sid, att, pos, ch) {
      assert(sid); await sleep(80);
      const it = db.items[att][pos - 1]; const q = qmap()[it.question_id];
      if (!it.chosen) { it.chosen = ch; it.is_correct = it.opt_order['ABC'.indexOf(ch)] === q.answer; save(); }
      return { pos, chosen: it.chosen, is_correct: it.is_correct, correct: shown(q.answer, it.opt_order), rationale: remap(q.rationale, it.opt_order), reference: q.reference, docs: q.docs };
    },
    async logIncident(sid, att, type, detail) { const a = db.attempts.find(x => x.id === att); a.incidents.push({ at: new Date().toISOString(), type, detail }); save(); return a.incidents.length; },
    async submitAttempt(sid, att, annul) { assert(sid); const a = db.attempts.find(x => x.id === att); if (a.status !== 'in_progress') fail('ATTEMPT_CLOSED'); grade(a, annul ? 'annulled' : 'submitted'); return { attempt_id: a.id, correct: a.correct, total: a.total, score: a.score, elapsed_sec: a.elapsed_sec, status: a.status }; },
    async review(att) {
      const a = db.attempts.find(x => x.id === att); const qs = qmap();
      return { attempt: a, items: db.items[att].map(it => { const q = qs[it.question_id]; return { ...render(q, it.opt_order), pos: it.pos, chosen: it.chosen, marked: it.marked, is_correct: it.is_correct, correct: shown(q.answer, it.opt_order), rationale: remap(q.rationale, it.opt_order), reference: q.reference, docs: q.docs }; }) };
    },
    async listAttempts() { return db.attempts; },
    async myStats() {
      const its = Object.values(db.items).flat().filter(i => i.chosen); const qs = qmap();
      const bs = {}, bf = {};
      for (const it of its) { const q = qs[it.question_id]; for (const [m, k] of [[bs, q.subarea], [bf, q.format]]) { m[k] = m[k] || { total: 0, correct: 0 }; m[k].total++; if (it.is_correct) m[k].correct++; } }
      const days = {}; for (const a of db.activity) { const d = days[a.day] = days[a.day] || { day: a.day, minutes: 0, questions: 0, correct: 0 }; d.minutes += a.minutes; d.questions += a.questions; d.correct += a.correct; }
      return { by_subarea: bs, by_format: bf, days: Object.values(days), bank_total: db.questions.filter(q => q.active).length, seen_total: new Set(its.map(i => i.question_id)).size };
    },
    async logStudy(sid, doc, minutes) { db.activity.push({ day: day(), kind: 'estudio', minutes, questions: 0, correct: 0 }); save(); return true; },
    async listDocs() { return db.docs.map(({ id, num, title, short, subareas, pages, summary }) => ({ id, num, title, short, subareas, pages, summary })); },
    async getDoc(id) { return db.docs.find(d => d.id === id) || null; },
    async studyProgress() { return Object.entries(db.progress).map(([doc_id, status]) => ({ doc_id, status })); },
    async setStudyProgress(u, doc, st) { if (st) db.progress[doc] = st; else delete db.progress[doc]; save(); },
    async reportBug(u, r) { db.bugs.unshift({ id: db.bugs.length + 1, user_id: u, status: 'nuevo', created_at: new Date().toISOString(), ...r }); save(); },
    async myBugs() { return db.bugs; },
    async paymentConfig() { return { enabled: !!db.payOn, price: db.price || 250, currency: 'MXN' }; },
    async payCreate() { db.payments = db.payments || []; const p = db.profiles[uid()]; if (p.status === 'approved' && p.role !== 'admin') fail('ALREADY_ACTIVE'); if (!db.payOn && p.role !== 'admin') fail('PAYMENTS_OFF'); const id = 'ORDTST' + Date.now(); db.payments.unshift({ order_id: id, user_id: uid(), email: p.email, full_name: p.full_name, amount: db.price || 250, status: 'created', status_detail: 'created', live: false, created_at: new Date().toISOString() }); save(); await sleep(300); return { checkout_url: location.pathname + '?pago=' + (LS.getItem('mock_pay_result') || 'ok') + '&order_id=' + id + '#/', order_id: id, live: false }; },
    async paySync() { const r = LS.getItem('mock_pay_result') || 'ok'; const open = (db.payments || []).filter(p => p.user_id === uid() && !['processed', 'failed', 'canceled', 'refunded'].includes(p.status));
      for (const p of open) { if (r === 'ok') { p.status = 'processed'; p.status_detail = 'accredited'; p.payment_method = 'debvisa'; p.paid_at = new Date().toISOString(); const pr = db.profiles[uid()]; if (pr.status === 'pending') pr.status = 'approved'; } else if (r === 'pendiente') { p.status = 'action_required'; p.status_detail = 'waiting_payment'; p.payment_method = 'oxxo'; } else { p.status = 'failed'; p.status_detail = 'rejected_by_issuer'; } p.updated_at = new Date().toISOString(); }
      save(); await sleep(200); return { status: db.profiles[uid()].status, orders: open.map(p => ({ id: p.order_id, status: p.status, detail: p.status_detail })) }; },
    async myPayments() { return (db.payments || []).filter(p => p.user_id === uid()); },
    logClientError(u, e) { db.errors.unshift({ ...e, created_at: new Date().toISOString(), ua: navigator.userAgent }); save(); return Promise.resolve(); },
    admin: {
      async overview() { const ps = Object.values(db.profiles); const bank = {}; db.questions.filter(q => q.active).forEach(q => bank[q.subarea] = (bank[q.subarea] || 0) + 1); return { users: ps.length, approved: ps.filter(p => p.status === 'approved').length, pending: ps.filter(p => p.status === 'pending').length, blocked: ps.filter(p => p.status === 'blocked').length, active_7d: 1, attempts: db.attempts.filter(a => a.status !== 'in_progress').length, bugs_open: db.bugs.filter(b => ['nuevo', 'revisando'].includes(b.status)).length, errors_24h: db.errors.length, bank, bank_total: db.questions.filter(q => q.active).length, docs: db.docs.length, bind_alerts: (db.binds || DEMO_BINDS()).filter(b => b.open > 0).length, payments_enabled: !!db.payOn, paid_count: (db.payments || []).filter(p => p.status === 'processed' && p.live !== false).length, paid_total: 0, paid_7d: 0 }; },
      async users() { return Object.values(db.profiles).concat(db.extraUsers || []).map(p => ({ ...p, device_label: db.device[p.id]?.device_label || p.device_label, bound_label: p.bound_label, bound_at: p.bound_at, bind_alerts: p.bind_alerts || 0, device_switches_30d: p.id === 'u-admin' ? db.events.length : 0, attempts: p.id === 'u-admin' ? db.attempts.length : 0, best_sim: null, avg_score: null, minutes_total: 0 })); },
      async setStatus(u, s) { db.profiles[u].status = s; save(); return true; },
      async setRole(u, r) { db.profiles[u].role = r; save(); return true; },
      async resetDevice() { return true; },
      async allowed() { return db.allowed; },
      async addAllowed(email, note) { if (db.allowed.find(a => a.email === email)) throw new Error('duplicate key'); db.allowed.unshift({ email, note, created_at: new Date().toISOString() }); save(); },
      async removeAllowed(email) { db.allowed = db.allowed.filter(a => a.email !== email); save(); },
      async bugs() { return db.bugs; },
      async updateBug(id, st, note) { const b = db.bugs.find(x => x.id === id); b.status = st; b.admin_note = note; save(); return true; },
      async errors() { return db.errors; },
      async importContent(p) { for (const q of p.questions) { const i = db.questions.findIndex(x => x.id === q.id); if (i >= 0) db.questions[i] = { ...q, active: true }; else db.questions.push({ ...q, active: true }); } save(); return { questions: p.questions.length, docs: p.docs.length, bank_total: db.questions.length }; },
      async questions() { return db.questions; },
      async setQuestionActive(id, a) { db.questions.find(q => q.id === id).active = a; save(); },
      async bindAttempts() { return db.binds || DEMO_BINDS(); },
      async releaseBinding(u) { db.binds = (db.binds || DEMO_BINDS()).map(b => b.user_id === u ? { ...b, open: 0, bound_label: null, bound_at: null } : b); (db.extraUsers || []).forEach(x => { if (x.id === u) { x.bound_label = null; x.bound_at = null; x.bind_alerts = 0; } }); save(); return true; },
      async bindIgnore(u) { db.binds = (db.binds || DEMO_BINDS()).map(b => b.user_id === u ? { ...b, open: 0 } : b); save(); return true; },
      async devices() { return db.conflicts || [{ id: 1, kind: 'bloqueado', resolved: false, created_at: new Date().toISOString(), device_id: 3, device_label: 'Chrome en Windows', owner_email: 'admin@example.com', owner_name: 'Usuario de Prueba', user_id: 'u-2', user_email: 'otra@example.com', user_name: 'Otra Cuenta', user_status: 'approved', attempts: 2, allowed: false }, { id: 2, kind: 'posible', resolved: false, created_at: new Date().toISOString(), device_id: 3, device_label: 'Edge en Windows', owner_email: 'admin@example.com', owner_name: 'Usuario de Prueba', user_id: 'u-3', user_email: 'tercera@example.com', user_name: 'Tercera', user_status: 'approved', attempts: 1, allowed: false }]; },
      async deviceAction(id, a) { const l = await this.devices(); const c = l.find(x => x.id === id); c.resolved = true; c.allowed = a === 'permitir'; db.conflicts = l; save(); return true; },
      async getSettings() { return { auto_approve: db.auto !== false, payments_enabled: !!db.payOn, price: db.price || 250 }; },
      async setPayments(on, price) { if (!(price >= 10 && price <= 10000)) fail('BAD_PRICE'); db.payOn = on; db.price = price; save(); return this.getSettings(); },
      async payments() { return (db.payments || []).concat(db.demoPayments || []); },
      async payCheck() { await sleep(300); return { ok: true, http: 200, test: true, site: 'MLM', webhook_secret: !!db.whSecret, detail: null }; },
      async setAutoApprove(on) { db.auto = on; save(); return on; },
      async sessionEvents() { return db.events.slice().reverse(); }
    }
  };
  window.SimadMockApi = api;
})();
