// Arranque, autenticación, sesión de un solo dispositivo, navegación y reportes
import { api } from './api.js?v=1.3.0';
import { state, nav } from './state.js?v=1.3.0';
import { CONFIG } from './config.js?v=1.3.0';
import { esc, toast, modal, loadingHTML, errMsg, errCode, initials, deviceLabel, fmtDate, money, payLabel } from './ui.js?v=1.3.0';
import { examLobby, practiceSetup, resultsView } from './exam.js?v=1.3.0';
import { dashboard, studyList, studyDoc, stopStudyTimer, examGuide, calendarView, historyView, profileView } from './views.js?v=1.3.0';
import { adminView } from './admin.js?v=1.3.0';
import { deviceKey, fingerprints } from './device.js?v=1.3.0';

const app = document.getElementById('app');
const SID_KEY = 'simad_sid';
const GOOGLE_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

// ---------- Errores del navegador → registro automático ----------
const seenErrors = new Set();
function reportClientError(message, source, stack) {
  const key = String(message).slice(0, 160);
  state.lastErrors.push({ at: new Date().toISOString(), message: key });
  if (state.lastErrors.length > 10) state.lastErrors.shift();
  if (!state.user || seenErrors.has(key) || seenErrors.size > 20) return;
  seenErrors.add(key);
  try { api.logClientError(state.user.id, { message: key, source: String(source || '').slice(0, 300), stack: String(stack || '').slice(0, 2000), page: location.hash || '#/' }); } catch (e) { }
}
window.addEventListener('error', e => { if (e.message) reportClientError(e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack); });
window.addEventListener('unhandledrejection', e => { const r = e.reason; if (errCode(r)) return; reportClientError(r?.message || String(r), 'promise', r?.stack); });

// ---------- Avisos de conexión ----------
function offlineBar(show) {
  let b = document.getElementById('offline');
  if (show && !b) { b = document.createElement('div'); b.id = 'offline'; b.className = 'offline-bar'; b.textContent = 'Sin conexión a internet. Tus respuestas se guardarán al reconectar.'; document.body.appendChild(b); }
  if (!show && b) b.remove();
}
window.addEventListener('offline', () => offlineBar(true));
window.addEventListener('online', () => offlineBar(false));

// ---------- Interceptar errores de sesión en cualquier llamada ----------
function guardApi(obj) {
  for (const k of Object.keys(obj)) {
    const f = obj[k];
    if (typeof f === 'function' && !['getSession', 'onAuth', 'signInGoogle', 'signOut', 'revokeOtherSessions', 'subscribeDevice', 'logClientError', 'claimSession', 'sessionAlive', 'checkDevice'].includes(k)) {
      obj[k] = async (...args) => {
        try { return await f.apply(obj, args); }
        catch (e) {
          const c = errCode(e);
          if (c === 'SESSION_REPLACED') kicked('replaced');
          else if (c === 'NOT_APPROVED') boot();
          else if (c === 'NO_AUTH') kicked('expired');
          throw e;
        }
      };
    } else if (f && typeof f === 'object' && k === 'admin') guardApi(f);
  }
}
guardApi(api);

// ---------- Sesión única por dispositivo ----------
let hbTimer = null, unsubDevice = null, kickedOnce = false;
function stopGuard() { clearInterval(hbTimer); hbTimer = null; if (unsubDevice) { unsubDevice(); unsubDevice = null; } document.removeEventListener('visibilitychange', onVisible); }
async function checkAlive() {
  if (!state.sid || kickedOnce) return;
  try { const ok = await api.sessionAlive(state.sid); if (ok === false) kicked('replaced'); } catch (e) { /* sin conexión: se reintenta */ }
}
function onVisible() { if (!document.hidden) checkAlive(); }
function startGuard() {
  stopGuard();
  hbTimer = setInterval(checkAlive, CONFIG.heartbeatMs);
  document.addEventListener('visibilitychange', onVisible);
  try {
    unsubDevice = api.subscribeDevice(state.user.id, (row) => { if (row && row.session_id && row.session_id !== state.sid) kicked('replaced'); });
  } catch (e) { }
}
state.stopSessionGuard = stopGuard;

async function kicked(reason) {
  if (kickedOnce) return; kickedOnce = true;
  stopGuard(); stopStudyTimer();
  const wasExam = state.inExam;
  state.inExam = false; document.body.classList.remove('exam-mode');
  document.querySelectorAll('.modal-bg,.overlay,#ex-ov').forEach(x => x.remove());
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  localStorage.removeItem(SID_KEY);
  try { await api.signOut('local'); } catch (e) { }
  state.session = state.user = state.profile = null; state.sid = null;
  const msg = reason === 'expired'
    ? 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.'
    : 'Tu cuenta se abrió en otro dispositivo, o el administrador cerró tu sesión. Por seguridad, cada cuenta solo puede usarse en un dispositivo a la vez.';
  app.innerHTML = `<div class="kick"><div class="card"><div class="brand-mark" style="margin:0 auto 14px;background:var(--primary);color:#fff">!</div>
    <h2>Sesión cerrada en este dispositivo</h2><p class="muted">${msg}</p>${wasExam ? '<p class="small">Tus respuestas guardadas se conservan. El tiempo del examen sigue corriendo.</p>' : ''}
    <p class="small muted">Si no fuiste tú, vuelve a entrar y avisa al administrador.</p>
    <button class="btn primary" id="again">Volver a iniciar sesión</button></div></div>`;
  document.getElementById('again').onclick = () => { kickedOnce = false; boot(); };
}

// ---------- Pantallas de acceso ----------
function loginPage(err = '') {
  document.title = CONFIG.appName;
  app.innerHTML = `<div class="login-wrap">
    <section class="login-hero"><div><div class="brand" style="margin-bottom:40px"><div class="brand-mark">S</div><div class="brand-text"><b>${esc(CONFIG.appName)}</b><span>${esc(CONFIG.level)}</span></div></div>
      <h1>Prepárate para el examen de admisión como si fuera el día real</h1>
      <p class="lead">Simulacros de 90 reactivos en 4 horas, práctica guiada con argumentaciones y fichas de estudio de toda la bibliografía oficial.</p>
      <ul><li><i>1</i><div><b>Simulacro con navegador seguro.</b> Pantalla completa, cámara, micrófono e incidencias, como en la aplicación en línea.</div></li>
      <li><i>2</i><div><b>Reactivos de casos reales del aula.</b> Tres opciones muy parecidas, con la argumentación de cada respuesta.</div></li>
      <li><i>3</i><div><b>Tu progreso en un calendario.</b> Porcentaje de aciertos y tiempo en cada intento, por subárea.</div></li></ul></div>
      <p class="small" style="opacity:.7;margin-top:30px">Herramienta independiente de estudio. No está afiliada a la SEP ni a la USICAMM.</p><div class="deco"></div><div class="deco2"></div></section>
    <section class="login-panel"><div class="login-card"><div class="card">
      <h2 style="margin-top:0">Iniciar sesión</h2><p class="muted">Entra con tu cuenta de Google. Usa siempre la misma cuenta para conservar tu progreso.</p>
      ${err ? `<div class="notice bad small" style="margin:12px 0">${esc(err)}</div>` : ''}
      <button class="btn google lg" id="g" style="width:100%;justify-content:center;margin-top:12px">${GOOGLE_SVG}<span>Continuar con Google</span></button>
      <div class="divider"></div>
      <p class="small muted">Tu cuenta queda <b>vinculada al primer dispositivo</b> donde inicies sesión. Úsala siempre en ese mismo celular o computadora.</p></div>
      <p class="small faint" style="text-align:center;margin-top:14px">Versión ${esc(CONFIG.version)} · <a href="privacidad.html" target="_blank" rel="noopener">Aviso de privacidad</a></p></div></section></div>`;
  document.getElementById('g').onclick = async (e) => {
    e.currentTarget.disabled = true;
    localStorage.removeItem(SID_KEY);
    try { await api.signInGoogle(); } catch (er) { e.currentTarget.disabled = false; toast(errMsg(er), 'bad'); }
  };
}

function statusPage(kind) {
  const p = state.profile || {};
  const blocked = kind === 'blocked';
  app.innerHTML = `<div class="kick" style="max-width:600px"><div class="card" style="text-align:left">
    <h2>${blocked ? 'Acceso no disponible' : 'Tu solicitud está en revisión'}</h2>
    <p class="muted">${blocked ? 'Tu cuenta fue desactivada por el administrador. Si crees que es un error, comunícate con él.' : 'Ya recibimos tu solicitud. El administrador debe aprobar tu cuenta antes de que puedas usar el simulador. Comparte con él el correo con el que entraste.'}</p>
    <div class="keybox small" style="margin:14px 0"><b>Correo:</b> ${esc(p.email || state.user?.email || '')}<br><b>Folio de práctica:</b> ${esc(p.folio || '')}<br><b>Solicitud:</b> ${p.created_at ? fmtDate(p.created_at, true) : ''}</div>
    <div class="row wrap">${blocked ? '' : '<button class="btn primary" id="re">Volver a verificar</button>'}<button class="btn" id="out">Cerrar sesión</button></div>
    ${blocked ? '' : `<details style="margin-top:18px"><summary class="small muted" style="cursor:pointer">Soy el administrador</summary>
      <div class="row" style="margin-top:10px"><input type="text" id="code" placeholder="Código de administrador" autocomplete="off" style="max-width:260px"><button class="btn" id="claim">Activar</button></div></details>`}</div></div>`;
  document.getElementById('out').onclick = logout;
  const re = document.getElementById('re'); if (re) re.onclick = () => boot();
  const cl = document.getElementById('claim');
  if (cl) cl.onclick = async () => {
    const code = document.getElementById('code').value.trim(); if (!code) return;
    cl.disabled = true;
    try { const ok = await api.claimAdmin(code); if (ok) { toast('Rol de administrador activado.', 'ok'); boot(); } else { cl.disabled = false; toast('Código incorrecto.', 'bad'); } }
    catch (e) { cl.disabled = false; toast(errMsg(e), 'bad'); }
  };
}

// ---------- Pago de acceso (Mercado Pago) ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PAY_NOTICE = {
  ok: ['info', 'Mercado Pago está terminando de confirmar tu pago. En cuanto se confirme, tu acceso se activa solo. Si en unos minutos no entras, pulsa <b>Ya pagué, verificar</b>.'],
  pendiente: ['warn', 'Tu pago quedó <b>pendiente</b>. Si elegiste pagar en efectivo, completa el pago con la referencia que te dio Mercado Pago. Tu acceso se activará solo cuando se confirme; puedes cerrar esta página.'],
  error: ['bad', 'El pago <b>no se completó</b>. Puedes intentarlo de nuevo con otra tarjeta o con otra forma de pago.'],
  proceso: ['warn', 'Tienes un pago <b>en proceso</b>. Tu acceso se activará solo cuando Mercado Pago lo confirme.'],
  rechazado: ['bad', 'Tu último intento de pago fue <b>rechazado</b>. Puedes intentarlo de nuevo con otra tarjeta o con otra forma de pago.']
};

async function pendingPage(notice = null) {
  let cfg = null;
  try { cfg = await api.paymentConfig(); } catch (e) { }
  if (cfg?.enabled) { await payPage(cfg, notice); return; }
  statusPage('pending');
}

async function payPage(cfg, notice = null) {
  const p = state.profile || {};
  let last = null;
  try { last = (await api.myPayments(state.user.id))?.[0] || null; } catch (e) { }
  if (!notice && last) {
    const [lbl] = payLabel(last);
    if (lbl === 'En proceso') notice = 'proceso';
    else if (lbl === 'Rechazado' && Date.now() - new Date(last.updated_at || last.created_at).getTime() < 3 * 864e5) notice = 'rechazado';
  }
  const first = (p.full_name || '').split(' ')[0];
  const price = money(cfg.price);
  const n = notice && PAY_NOTICE[notice];
  const mail = esc(CONFIG.contactEmail);
  app.innerHTML = `<div class="kick" style="max-width:660px"><div class="card pay-card">
    <div class="brand" style="margin-bottom:18px"><div class="brand-mark">S</div><div class="brand-text"><b>${esc(CONFIG.appShort)}</b><span>Admisión · Primaria</span></div></div>
    <h2 style="margin:0 0 6px">Activa tu acceso al simulador</h2>
    <p class="muted" style="margin:0">${first ? `Hola, ${esc(first)}. ` : ''}Tu cuenta ya está creada. Para empezar a usar el simulador solo falta un pago único.</p>
    ${n ? `<div class="notice ${n[0]} small" style="margin:16px 0 0">${n[1]}</div>` : ''}
    <div class="pay-box">
      <div><div class="pay-amt">${price} <small>MXN</small></div><div class="small muted">Pago único · acceso sin fecha de vencimiento</div></div>
      <ul class="pay-list">
        <li>Simulacros de 90 reactivos en 4 horas con navegador seguro</li>
        <li>Práctica por subárea con la argumentación de cada respuesta</li>
        <li>Fichas de estudio de la bibliografía oficial</li>
        <li>Calendario, historial y repaso de tus errores</li>
      </ul>
    </div>
    <button class="btn primary lg pay-btn" id="pay"><span>Pagar ${price} con Mercado Pago</span></button>
    <p class="small muted" style="margin:10px 0 0;text-align:center">Mercado Pago te mostrará las formas de pago disponibles, como tarjeta de débito o crédito, saldo en Mercado Pago o efectivo en tiendas. Tus datos de pago los recibe Mercado Pago, no este sitio.</p>
    <div class="keybox small" style="margin:18px 0 14px"><b>Cuenta:</b> ${esc(p.email || state.user?.email || '')}<br><b>Folio de práctica:</b> ${esc(p.folio || '')}</div>
    <div class="row wrap"><button class="btn" id="re">Ya pagué, verificar</button><button class="btn ghost" id="out">Cerrar sesión</button></div>
    <p class="small faint" style="margin:16px 0 0">Al pagar aceptas las <a href="privacidad.html#pagos" target="_blank" rel="noopener">condiciones de pago</a>. Para dudas o reembolsos escribe a <a href="mailto:${mail}">${mail}</a> desde el correo de tu cuenta.</p>
    <details style="margin-top:14px"><summary class="small faint" style="cursor:pointer">Soy el administrador</summary>
      <div class="row" style="margin-top:10px"><input type="text" id="code" placeholder="Código de administrador" autocomplete="off" style="max-width:260px"><button class="btn" id="claim">Activar</button></div></details>
  </div></div>`;
  document.getElementById('out').onclick = logout;
  const pay = document.getElementById('pay');
  pay.onclick = async () => {
    pay.disabled = true; pay.innerHTML = '<span>Abriendo Mercado Pago…</span>';
    try {
      const r = await api.payCreate();
      if (!r?.checkout_url) throw new Error('MP_ERROR');
      location.href = r.checkout_url;
    } catch (e) {
      pay.disabled = false; pay.innerHTML = `<span>Pagar ${price} con Mercado Pago</span>`;
      if (errCode(e) === 'ALREADY_ACTIVE') { boot(); return; }
      toast(errMsg(e), 'bad');
    }
  };
  const re = document.getElementById('re');
  re.onclick = async () => {
    re.disabled = true; re.textContent = 'Verificando…';
    try {
      const r = await api.paySync();
      if (r?.status === 'approved') { toast('¡Pago confirmado! Tu acceso ya está activo.', 'ok'); boot(); return; }
      const st = (r?.orders || [])[0];
      toast(st && ['processing', 'action_required'].includes(st.status) ? 'Tu pago sigue en proceso. Se activará solo cuando Mercado Pago lo confirme.' : 'Todavía no encontramos un pago aprobado en tu cuenta.', 'warn');
    } catch (e) { toast(errMsg(e), 'bad'); }
    re.disabled = false; re.textContent = 'Ya pagué, verificar';
  };
  const cl = document.getElementById('claim');
  cl.onclick = async () => {
    const code = document.getElementById('code').value.trim(); if (!code) return;
    cl.disabled = true;
    try { const ok = await api.claimAdmin(code); if (ok) { toast('Rol de administrador activado.', 'ok'); boot(); } else { cl.disabled = false; toast('Código incorrecto.', 'bad'); } }
    catch (e) { cl.disabled = false; toast(errMsg(e), 'bad'); }
  };
}

// Regreso desde Mercado Pago (?pago=ok|pendiente|error)
async function handlePayReturn(kind) {
  app.innerHTML = loadingHTML(kind === 'error' ? 'Revisando tu pago…' : 'Confirmando tu pago con Mercado Pago…');
  let res = null;
  for (let i = 0; i < 5; i++) {
    try { res = await api.paySync(); } catch (e) { res = null; }
    if (res?.status === 'approved' && !state.isAdmin) break;
    const open = (res?.orders || []).some(o => ['processing', 'action_required', 'created'].includes(o.status));
    if (kind !== 'ok' || !open) break;
    await sleep(2500);
  }
  try { state.profile = await api.getProfile(state.user.id) || state.profile; } catch (e) { }
  const st = state.profile?.status;
  if (state.isAdmin) {
    const o = (res?.orders || [])[0];
    const lb = o ? payLabel({ status: o.status, status_detail: o.detail }) : null;
    toast(lb ? `Pago de prueba: ${lb[0]}.` : 'Regresaste de Mercado Pago. Revisa el estado en Pagos.', lb && lb[1] === 'ok' ? 'ok' : 'warn');
    history.replaceState(null, '', location.pathname + '#/admin/pagos');
    lastPath = null; shell(); route(); return;
  }
  if (st === 'blocked') { statusPage('blocked'); return; }
  if (st === 'approved') {
    toast('¡Pago confirmado! Tu acceso ya está activo.', 'ok');
    lastPath = null; shell(); route(); return;
  }
  await pendingPage(kind === 'ok' || kind === 'pendiente' || kind === 'error' ? kind : null);
}

function deviceConflictPage(hint) {
  stopGuard();
  app.innerHTML = `<div class="kick" style="max-width:600px"><div class="card" style="text-align:left">
    <div class="brand-mark" style="background:var(--warn,#a86a00);color:#fff;margin-bottom:14px">!</div>
    <h2 style="margin-top:0">Este equipo ya tiene una cuenta registrada</h2>
    <p>En esta computadora se registró primero la cuenta <b>${esc(hint || 'de otra persona')}</b>. Para que cada persona use una sola cuenta, en este equipo solo puede entrar esa cuenta.</p>
    <p>Cambia a <b>tu cuenta registrada</b> (la primera con la que entraste) para continuar con tu progreso.</p>
    <div class="notice info small" style="margin:14px 0">Si compartes esta computadora con otra persona que también se prepara, pídele al administrador que autorice tu cuenta en este equipo.</div>
    <div class="row wrap"><button class="btn primary" id="switch">Cambiar a mi cuenta registrada</button><button class="btn" id="out">Cerrar sesión</button></div></div></div>`;
  document.getElementById('switch').onclick = async (e) => {
    e.currentTarget.disabled = true;
    state.session = state.user = state.profile = null; state.sid = null;
    localStorage.removeItem(SID_KEY);
    try { await api.signOut('local'); } catch (er) { }
    try { await api.signInGoogle(); } catch (er) { e.currentTarget.disabled = false; toast(errMsg(er), 'bad'); }
  };
  document.getElementById('out').onclick = logout;
}

// La cuenta ya está vinculada a otro dispositivo: no se puede abrir aquí
function accountBoundPage(dv) {
  stopGuard();
  const mail = CONFIG.contactEmail;
  const email = state.user?.email || '';
  const since = dv.bound_since ? fmtDate(dv.bound_since) : '';
  const href = `mailto:${mail}?subject=${encodeURIComponent('Cambio de dispositivo · Simulador SIMAD')}&body=${encodeURIComponent(`Hola, necesito usar mi cuenta del simulador en un dispositivo nuevo.\n\nMi cuenta: ${email}\nMotivo (cambié de celular, lo perdí, etc.): `)}`;
  app.innerHTML = `<div class="kick" style="max-width:600px"><div class="card" style="text-align:left">
    <div class="brand-mark" style="background:var(--warn,#a86a00);color:#fff;margin-bottom:14px">!</div>
    <h2 style="margin-top:0">Esta cuenta ya está abierta en otro dispositivo</h2>
    <p>La cuenta <b>${esc(email)}</b> quedó vinculada al dispositivo donde se abrió por primera vez${dv.bound_label ? ` (<b>${esc(dv.bound_label)}</b>${since ? `, desde el ${esc(since)}` : ''})` : ''}. Por seguridad, solo puede usarse en ese dispositivo.</p>
    <p>Entra desde ese dispositivo para continuar con tu progreso, o intenta con otra cuenta.</p>
    <div class="notice info small" style="margin:14px 0"><b>¿Cambiaste de celular o computadora, o lo perdiste?</b> Escribe a <a href="${href}">${esc(mail)}</a> desde el correo de tu cuenta para que te ayuden a usarla en tu nuevo dispositivo.</div>
    <div class="row wrap"><button class="btn primary" id="switch">Intentar con otra cuenta</button><a class="btn" href="${href}">Escribir al administrador</a><button class="btn ghost" id="out">Cerrar sesión</button></div></div></div>`;
  document.getElementById('switch').onclick = async (e) => {
    e.currentTarget.disabled = true;
    state.session = state.user = state.profile = null; state.sid = null;
    localStorage.removeItem(SID_KEY);
    try { await api.signOut('local'); } catch (er) { }
    try { await api.signInGoogle(); } catch (er) { e.currentTarget.disabled = false; toast(errMsg(er), 'bad'); }
  };
  document.getElementById('out').onclick = logout;
}

async function logout() {
  stopGuard(); stopStudyTimer();
  state.session = state.user = state.profile = null; state.sid = null; state.isAdmin = false;
  localStorage.removeItem(SID_KEY);
  try { await api.signOut('local'); } catch (e) { }
  history.replaceState(null, '', location.pathname);
  loginPage();
}
window.addEventListener('simad:logout', logout);
window.addEventListener('simad:bug', () => bugDialog());

// ---------- Estructura de la app ----------
const NAV = [['#/', 'Inicio'], ['#/examen', 'Examen'], ['#/practica', 'Práctica'], ['#/estudio', 'Estudio'], ['#/calendario', 'Calendario'], ['#/historial', 'Historial']];
function shell() {
  const p = state.profile;
  const name = p.full_name || state.user.email;
  app.innerHTML = `<header class="topbar"><div class="topbar-inner">
      <a class="brand" href="#/"><div class="brand-mark">S</div><div class="brand-text"><b>${esc(CONFIG.appShort)}</b><span>Admisión · Primaria</span></div></a>
      <button class="menu-btn" id="mb" aria-label="Menú">☰</button>
      <nav class="nav" id="nav">${NAV.map(([h, t]) => `<a href="${h}" data-h="${h}">${t}</a>`).join('')}${state.isAdmin ? '<a href="#/admin/resumen" data-h="#/admin">Administración</a>' : ''}</nav>
      <div class="spacer"></div>
      <button class="topbug" id="bug" title="Reportar una falla">⚑ <span class="nm">Reportar falla</span></button>
      <a class="userchip" href="#/perfil" title="Mi cuenta" style="text-decoration:none"><span class="avatar">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" referrerpolicy="no-referrer">` : esc(initials(p.full_name, state.user.email))}</span><span class="nm">${esc(name.split(' ')[0])}</span></a>
    </div></header>
    <main class="main" id="view"></main>
    <footer class="footer">${esc(CONFIG.appName)} · versión ${esc(CONFIG.version)} · Herramienta de estudio independiente; los reactivos son originales y no provienen del examen oficial. · <a href="privacidad.html" target="_blank" rel="noopener">Aviso de privacidad</a></footer>
`;
  document.getElementById('mb').onclick = () => document.getElementById('nav').classList.toggle('open');
  document.getElementById('bug').onclick = bugDialog;
}
function setActiveNav(path) {
  document.querySelectorAll('#nav a').forEach(a => {
    const h = a.dataset.h;
    a.classList.toggle('active', h === '#/' ? path === '#/' : path.startsWith(h));
  });
  document.getElementById('nav')?.classList.remove('open');
}

// ---------- Reporte de fallas ----------
function bugDialog() {
  const q = state.currentQuestion;
  modal({ title: 'Reportar una falla', body: `
    <p class="small muted">Describe qué pasó. El administrador revisa los reportes y te responderá en <b>Mi cuenta</b>.</p>
    <label class="field"><span>Tipo</span><select id="bc">
      <option value="reactivo">Error en un reactivo (respuesta, redacción, referencia)</option>
      <option value="examen">Examen o temporizador</option>
      <option value="sesion">Inicio de sesión o dispositivo</option>
      <option value="estudio">Fichas de estudio</option>
      <option value="interfaz">Algo se ve mal o no responde</option>
      <option value="sugerencia">Sugerencia</option>
      <option value="otro">Otro</option></select></label>
    ${q ? `<p class="small">Se adjuntará el reactivo que estás viendo: <b>${esc(q)}</b></p>` : ''}
    <label class="field"><span>Descripción</span><textarea id="bd" rows="5" maxlength="2000" placeholder="¿Qué hacías, qué esperabas y qué ocurrió?"></textarea></label>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Enviar reporte', cls: 'primary', onClick: async (el) => {
      const d = el.querySelector('#bd').value.trim();
      if (d.length < 10) { toast('Describe la falla con al menos 10 caracteres.', 'warn'); return false; }
      await api.reportBug(state.user.id, { category: el.querySelector('#bc').value, description: d, page: location.hash || '#/', context: { question: q || null, device: deviceLabel(), version: CONFIG.version, screen: `${screen.width}x${screen.height}`, online: navigator.onLine, errors: state.lastErrors.slice(-5) } });
      toast('Gracias. Tu reporte se envió al administrador.', 'ok');
    } }] });
  if (q) setTimeout(() => { const s = document.getElementById('bc'); if (s) s.value = 'reactivo'; }, 0);
}

// ---------- Rutas ----------
let lastPath = null;
async function route() {
  if (!state.profile || state.profile.status !== 'approved') return;
  let path = location.hash || '#/';
  if (path === '#' || path === '') path = '#/';
  if (state.inExam) { if (!path.startsWith('#/examen')) { history.replaceState(null, '', '#/examen'); toast('Para salir del examen usa el botón “Salir y continuar después”.', 'warn'); } return; }
  if (path !== lastPath) stopStudyTimer();
  lastPath = path;
  state.currentQuestion = null;
  if (!document.getElementById('view')) shell();
  setActiveNav(path);
  const view = document.getElementById('view');
  const [, seg, arg] = path.split('/');
  const titles = { '': 'Inicio', examen: 'Examen', practica: 'Práctica', estudio: 'Estudio', guia: 'Cómo es el examen', calendario: 'Calendario', historial: 'Historial', resultado: 'Resultado', perfil: 'Mi cuenta', admin: 'Administración' };
  document.title = `${titles[seg || ''] || ''} · ${CONFIG.appShort}`;
  window.scrollTo(0, 0);
  try {
    switch (seg || '') {
      case '': await dashboard(view); break;
      case 'examen': await examLobby(view); break;
      case 'practica': await practiceSetup(view); break;
      case 'estudio': arg ? await studyDoc(view, decodeURIComponent(arg)) : await studyList(view); break;
      case 'guia': examGuide(view); break;
      case 'calendario': await calendarView(view); break;
      case 'historial': await historyView(view); break;
      case 'resultado': await resultsView(view, arg); break;
      case 'perfil': await profileView(view); break;
      case 'admin': await adminView(view, arg || 'resumen'); break;
      default: view.innerHTML = '<div class="card empty">Página no encontrada. <a href="#/">Ir al inicio</a></div>';
    }
  } catch (e) {
    view.innerHTML = `<div class="notice bad">Ocurrió un problema al cargar esta sección: ${esc(errMsg(e))}</div>`;
    reportClientError(e?.message || String(e), 'route ' + path, e?.stack);
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { stopStudyTimer(); if (state.inExam) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Arranque ----------
let authUnsub = null;
let payReturn = null;
async function boot() {
  stopGuard();
  app.innerHTML = loadingHTML('Iniciando…');
  // Errores devueltos por Google o Supabase en la URL
  const url = new URL(location.href);
  // Regreso desde Mercado Pago: se guarda el resultado y se limpian los parámetros que agrega
  if (url.searchParams.has('pago')) {
    payReturn = url.searchParams.get('pago');
    history.replaceState(null, '', location.pathname + (location.hash || ''));
  }
  const urlErr = url.searchParams.get('error_description') || new URLSearchParams(location.hash.replace(/^#/, '')).get('error_description');
  let session = null;
  try { session = await api.getSession(); }
  catch (e) { loginPage('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.'); return; }
  if (url.searchParams.has('code') || urlErr) history.replaceState(null, '', location.pathname + (location.hash && !location.hash.includes('error') ? location.hash : ''));
  if (!session) { loginPage(urlErr ? 'No se pudo iniciar sesión: ' + urlErr : ''); return; }
  state.session = session; state.user = session.user;

  // Una cuenta por equipo: si el equipo pertenece a otra cuenta, se pide cambiar a la cuenta registrada
  try {
    const { fp, fpHw } = await fingerprints();
    const dv = await api.checkDevice(deviceKey(), fp, fpHw, deviceLabel());
    if (dv && dv.ok === false) { if (dv.reason === 'account_bound') accountBoundPage(dv); else deviceConflictPage(dv.owner_hint); return; }
  } catch (e) {
    if (errCode(e) === 'NO_AUTH') { await api.signOut('local').catch(() => { }); loginPage('Tu sesión expiró. Inicia sesión de nuevo.'); return; }
    reportClientError(e?.message || String(e), 'check_device', e?.stack);
  }

  // Identificador de esta sesión en este dispositivo
  let sid = localStorage.getItem(SID_KEY);
  let fresh = false;
  try {
    if (sid) {
      const alive = await api.sessionAlive(sid);
      if (!alive) { state.sid = sid; kicked('replaced'); return; }
    } else {
      sid = uuid(); fresh = true;
      const r = await api.claimSession(sid, deviceLabel(), navigator.userAgent);
      localStorage.setItem(SID_KEY, sid);
      if (r?.replaced_other) toast('Se cerró tu sesión en el otro dispositivo.', 'warn');
    }
  } catch (e) {
    if (errCode(e) === 'NO_AUTH') { await api.signOut('local').catch(() => { }); loginPage('Tu sesión expiró. Inicia sesión de nuevo.'); return; }
    app.innerHTML = `<div class="kick"><div class="card"><h2>Sin conexión</h2><p class="muted">${esc(errMsg(e))}</p><button class="btn primary" id="retry">Reintentar</button></div></div>`;
    document.getElementById('retry').onclick = boot; return;
  }
  state.sid = sid;
  if (fresh) api.revokeOtherSessions().catch(() => { });

  try { state.profile = await api.getProfile(state.user.id); }
  catch (e) { app.innerHTML = `<div class="kick"><div class="card"><h2>Error</h2><p>${esc(errMsg(e))}</p><button class="btn primary" id="retry">Reintentar</button></div></div>`; document.getElementById('retry').onclick = boot; return; }
  if (!state.profile) { loginPage('No se encontró tu perfil. Intenta iniciar sesión de nuevo.'); return; }
  state.isAdmin = state.profile.role === 'admin';
  kickedOnce = false;
  startGuard();
  if (payReturn) { const k = payReturn; payReturn = null; await handlePayReturn(k); return; }
  if (state.profile.status === 'blocked') { statusPage('blocked'); return; }
  if (state.profile.status !== 'approved') { await pendingPage(); return; }
  lastPath = null;
  shell();
  route();
}

if (!authUnsub) authUnsub = api.onAuth((event) => {
  // Si la sesión se revoca desde otro dispositivo, Supabase avisa con SIGNED_OUT
  if (event === 'SIGNED_OUT' && state.user && !kickedOnce) kicked('replaced');
});
boot();
