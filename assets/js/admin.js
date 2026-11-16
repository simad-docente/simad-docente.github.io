// Panel de administración
import { api } from './api.js?v=1.2.2';
import { state } from './state.js?v=1.2.2';
import { esc, fmtDate, fmtTime, toast, modal, confirmDialog, loadingHTML, errMsg, errCode, SUBAREAS, FORMATS, plainLetters, pct, money, payLabel, payMethod } from './ui.js?v=1.2.2';
import { CONFIG } from './config.js?v=1.2.2';

const TABS = [['resumen', 'Resumen'], ['usuarios', 'Usuarios'], ['correos', 'Acceso'], ['pagos', 'Pagos'], ['equipos', 'Equipos'], ['reportes', 'Reportes de fallas'], ['errores', 'Errores técnicos'], ['contenido', 'Contenido']];
const USTATUS = { pending: ['Pendiente', 'warn'], approved: ['Aprobado', 'ok'], blocked: ['Bloqueado', 'bad'] };
const BSTATUS = { nuevo: 'warn', revisando: '', resuelto: 'ok', descartado: 'gray' };

export async function adminView(root, tab = 'resumen') {
  if (!state.isAdmin) { root.innerHTML = '<div class="card empty">Esta sección es solo para el administrador.</div>'; return; }
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Administración</div><h1>Panel de administración</h1><p class="muted">Controla quién usa el simulador, revisa reportes y actualiza el contenido.</p></div></div>
    <div class="tabs">${TABS.map(([k, v]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${v}</a>`).join('')}</div><div id="ad">${loadingHTML()}</div>`;
  const box = root.querySelector('#ad');
  try {
    if (tab === 'usuarios') await users(box);
    else if (tab === 'correos') await allowed(box);
    else if (tab === 'pagos') await payments(box);
    else if (tab === 'equipos') await devices(box);
    else if (tab === 'reportes') await bugs(box);
    else if (tab === 'errores') await errors(box);
    else if (tab === 'contenido') await content(box);
    else await overview(box);
  } catch (e) { box.innerHTML = `<div class="notice bad">${esc(errMsg(e))}</div>`; }
}

async function overview(box) {
  const o = await api.admin.overview();
  box.innerHTML = `<div class="grid g4">
    <div class="card stat"><div class="label">Usuarios</div><div class="value">${o.users}</div><div class="sub">${o.approved} aprobados · ${o.blocked} bloqueados</div></div>
    <a class="card stat" href="#/admin/usuarios" style="text-decoration:none"><div class="label">Solicitudes pendientes</div><div class="value" style="color:${o.pending ? 'var(--warn)' : 'inherit'}">${o.pending}</div><div class="sub">Revisar y aprobar</div></a>
    <div class="card stat"><div class="label">Activos (7 días)</div><div class="value">${o.active_7d}</div><div class="sub">${o.attempts} intentos concluidos en total</div></div>
    <a class="card stat" href="#/admin/reportes" style="text-decoration:none"><div class="label">Reportes abiertos</div><div class="value" style="color:${o.bugs_open ? 'var(--bad)' : 'inherit'}">${o.bugs_open}</div><div class="sub">${o.errors_24h} errores técnicos en 24 h</div></a></div>
    ${o.payments_enabled || o.paid_count ? `<a class="notice ${o.payments_enabled ? 'ok' : 'info'}" href="#/admin/pagos" style="display:block;margin-top:16px;text-decoration:none;color:inherit"><b>${o.payments_enabled ? 'Cobro de acceso activo.' : 'Cobro de acceso desactivado.'}</b> ${o.paid_count} ${o.paid_count === 1 ? 'pago aprobado' : 'pagos aprobados'} por ${money(o.paid_total)}${o.paid_7d ? ` · ${o.paid_7d} en los últimos 7 días` : ''}. <u>Ver pagos</u></a>` : ''}
    ${o.device_alerts ? `<div class="notice warn" style="margin-top:16px"><b>${o.device_alerts} ${o.device_alerts === 1 ? 'aviso' : 'avisos'} de cuentas en equipos ajenos.</b> Alguien intentó usar otra cuenta en un equipo ya registrado. <a href="#/admin/equipos">Revisar</a></div>` : ''}
    <div class="grid g2" style="margin-top:16px"><div class="card"><div class="card-head"><h3>Banco de reactivos activos</h3><b>${o.bank_total}</b></div>
      ${Object.keys(SUBAREAS).map(k => { const n = o.bank?.[k] || 0; return `<div class="subarea-row"><span class="code">${k}</span><div><div class="name">${esc(SUBAREAS[k].name)}</div><div class="bar ${n >= 15 ? 'ok' : 'bad'}"><i style="width:${Math.min(100, pct(n, 60))}%"></i></div></div><span class="pct">${n}</span></div>`; }).join('')}
      ${o.bank_total === 0 ? '<div class="notice warn" style="margin-top:10px">El banco está vacío. Ve a <a href="#/admin/contenido">Contenido</a> e importa el archivo <b>contenido_simulador.json</b>.</div>' : ''}</div>
      <div class="card"><h3>Fichas de estudio</h3><p><b>${o.docs}</b> fichas cargadas.</p>
      <h3 style="margin-top:16px">Cómo dar acceso</h3><ol class="small" style="padding-left:18px;line-height:1.7"><li>Con el <b>cobro de acceso</b> activado (en <a href="#/admin/pagos">Pagos</a>), quien entre por primera vez ve la pantalla de pago y su cuenta se aprueba sola al pagar.</li><li>Sin cobro, con la <b>aprobación automática</b> activada (en <a href="#/admin/correos">Acceso</a>), basta con compartir el enlace: quien entre con su cuenta de Google queda aprobado.</li><li>Si la desactivas, solo entran directo los correos autorizados y los demás quedan <b>pendientes</b> en Usuarios.</li><li>Cada cuenta funciona en un solo dispositivo a la vez; en Usuarios puedes ver cuántas veces cambió de equipo.</li></ol></div></div>`;
}

async function users(box) {
  const list = await api.admin.users();
  const render = (filter = '') => {
    const f = filter.trim().toLowerCase();
    const sel = list.filter(u => !f || (u.email || '').toLowerCase().includes(f) || (u.full_name || '').toLowerCase().includes(f));
    box.querySelector('#ul').innerHTML = sel.length ? `<div class="table-wrap"><table class="t"><tr><th>Usuario</th><th>Estado</th><th>Actividad</th><th>Desempeño</th><th>Dispositivo</th><th></th></tr>
      ${sel.map(u => `<tr><td><b>${esc(u.full_name || '(sin nombre)')}</b>${u.role === 'admin' ? ' <span class="chip gold">Admin</span>' : ''}<br><span class="small muted">${esc(u.email)}</span><br><span class="small faint">${esc(u.folio || '')} · desde ${fmtDate(u.created_at)}</span></td>
        <td><span class="chip ${USTATUS[u.status][1]}">${USTATUS[u.status][0]}</span></td>
        <td class="small">${u.attempts} intentos<br>${Math.round(u.minutes_total || 0)} min de estudio<br><span class="faint">Última vez: ${u.last_seen ? fmtDate(u.last_seen, true) : '—'}</span></td>
        <td class="small">Mejor simulacro: <b>${u.best_sim != null ? Math.round(u.best_sim) + '%' : '—'}</b><br>Promedio: ${u.avg_score != null ? u.avg_score + '%' : '—'}</td>
        <td class="small">${esc(u.device_label || '—')}<br><span class="${u.device_switches_30d > 6 ? 'chip warn' : 'faint'}">${u.device_switches_30d} inicios en 30 días</span>${u.device_alerts ? `<br><a class="chip bad" href="#/admin/equipos">${u.device_alerts} ${u.device_alerts === 1 ? 'aviso' : 'avisos'} de equipo</a>` : ''}</td>
        <td><div class="row" style="gap:6px;flex-wrap:wrap">${u.id === state.user.id ? '<span class="small faint">Tú</span>' : `
          ${u.status !== 'approved' ? `<button class="btn sm ok" data-a="approve" data-u="${u.id}">Aprobar</button>` : ''}
          ${u.status !== 'blocked' ? `<button class="btn sm danger" data-a="block" data-u="${u.id}">Bloquear</button>` : ''}
          <button class="btn sm" data-a="device" data-u="${u.id}">Cerrar sesión</button>
          <button class="btn sm ghost" data-a="events" data-u="${u.id}">Dispositivos</button>
          <button class="btn sm ghost" data-a="role" data-u="${u.id}">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>`}</div></td></tr>`).join('')}</table></div>` : '<div class="card empty">Sin usuarios.</div>';
    box.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a, list.find(x => x.id === b.dataset.u)));
  };
  const act = async (a, u) => {
    try {
      if (a === 'approve') { await api.admin.setStatus(u.id, 'approved'); toast('Usuario aprobado.', 'ok'); }
      else if (a === 'block') { if (!await confirmDialog('Bloquear usuario', `${u.email} ya no podrá entrar y su sesión se cerrará de inmediato.`, 'Bloquear', 'danger')) return; await api.admin.setStatus(u.id, 'blocked'); toast('Usuario bloqueado.', 'ok'); }
      else if (a === 'device') { if (!await confirmDialog('Cerrar sesión', `Se cerrará la sesión de ${u.email} en el dispositivo donde esté abierta.`, 'Cerrar sesión')) return; await api.admin.resetDevice(u.id); toast('Sesión cerrada.', 'ok'); return; }
      else if (a === 'role') { const r = u.role === 'admin' ? 'user' : 'admin'; if (!await confirmDialog('Cambiar rol', r === 'admin' ? `${u.email} tendrá acceso completo a este panel.` : `${u.email} dejará de ser administrador.`, 'Confirmar')) return; await api.admin.setRole(u.id, r); toast('Rol actualizado.', 'ok'); }
      else if (a === 'events') {
        const ev = await api.admin.sessionEvents(u.id);
        modal({ title: 'Inicios de sesión recientes', wide: true, body: ev.length ? `<p class="small muted">Cada fila es un inicio de sesión. Si “reemplazó otra sesión”, la cuenta estaba abierta en otro equipo y se cerró allí.</p><div class="table-wrap"><table class="t"><tr><th>Fecha</th><th>Dispositivo</th><th>Reemplazó otra sesión</th></tr>${ev.map(e => `<tr><td>${fmtDate(e.created_at, true)}</td><td class="small">${esc(e.device_label || '')}<br><span class="faint">${esc((e.user_agent || '').slice(0, 80))}</span></td><td>${e.replaced_other ? '<span class="chip warn">Sí</span>' : 'No'}</td></tr>`).join('')}</table></div>` : '<p>Sin registros.</p>', actions: [{ label: 'Cerrar', value: null }] });
        return;
      }
      adminView(box.parentElement, 'usuarios');
    } catch (e) { toast(errMsg(e), 'bad'); }
  };
  box.innerHTML = `<div class="row between" style="margin-bottom:12px"><input type="search" id="uf" placeholder="Buscar por nombre o correo" style="max-width:340px"><span class="small muted">${list.length} usuarios</span></div><div id="ul"></div>`;
  box.querySelector('#uf').oninput = e => render(e.target.value);
  render();
}

async function allowed(box) {
  const [list, cfg] = await Promise.all([api.admin.allowed(), api.admin.getSettings()]);
  const auto = !!cfg?.auto_approve;
  box.innerHTML = `${cfg?.payments_enabled ? `<div class="notice ok" style="margin-bottom:16px"><b>El cobro de acceso está activo.</b> Las cuentas nuevas pagan ${money(cfg.price)} para entrar y la aprobación automática no se aplica. Los correos autorizados de esta página entran sin pagar. <a href="#/admin/pagos">Ir a Pagos</a></div>` : ''}<div class="card pad-lg" style="margin-bottom:16px"><div class="row between" style="align-items:flex-start;gap:16px">
      <div><h3 style="margin-top:0">Aprobación automática</h3>
      <p class="small muted" style="margin:4px 0 0">${auto ? '<b>Activada.</b> Cualquier persona a la que le compartas el enlace y entre con su cuenta de Google queda aprobada sola.' : '<b>Desactivada.</b> Solo entran directo los correos autorizados; los demás quedan pendientes hasta que los apruebes en Usuarios.'}</p>
      <p class="small muted" style="margin:6px 0 0">Siempre puedes bloquear a alguien en Usuarios. Si el enlace circula de más, desactívala.</p></div>
      <label class="check" style="flex:none;margin:0"><input type="checkbox" id="auto" ${auto ? 'checked' : ''}><div><b>${auto ? 'Activada' : 'Desactivada'}</b></div></label></div></div>
    <div class="grid g2"><div class="card pad-lg"><h3>Autorizar un correo</h3>
    <p class="small muted">La persona debe entrar con <b>esa misma cuenta de Google</b>. Al hacerlo, su cuenta quedará aprobada automáticamente.</p>
    <label class="field"><span>Correo de Gmail</span><input type="email" id="em" placeholder="nombre@gmail.com"></label>
    <label class="field"><span>Nota (opcional)</span><input type="text" id="nt" placeholder="Por ejemplo: compañera de la normal"></label>
    <button class="btn primary" id="add">Autorizar</button>
    <div class="divider"></div><label class="field"><span>Agregar varios (uno por línea)</span><textarea id="bulk" rows="4" placeholder="correo1@gmail.com&#10;correo2@gmail.com"></textarea></label><button class="btn" id="addb">Autorizar todos</button></div>
    <div class="card"><div class="card-head"><h3>Correos autorizados</h3><span class="chip">${list.length}</span></div>
    ${list.length ? `<div class="table-wrap"><table class="t"><tr><th>Correo</th><th>Nota</th><th>Desde</th><th></th></tr>${list.map(a => `<tr><td>${esc(a.email)}</td><td class="small">${esc(a.note || '')}</td><td class="small">${fmtDate(a.created_at)}</td><td><button class="btn sm ghost" data-del="${esc(a.email)}">Quitar</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Aún no has autorizado correos.</div>'}</div></div>`;
  const valid = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const reload = () => adminView(box.parentElement, 'correos');
  box.querySelector('#auto').onchange = async (e) => {
    const on = e.target.checked;
    if (!on && !await confirmDialog('Desactivar aprobación automática', 'Las personas nuevas quedarán pendientes hasta que las apruebes. Quienes ya tienen cuenta no se ven afectados.', 'Desactivar')) { e.target.checked = true; return; }
    try { await api.admin.setAutoApprove(on); toast(on ? 'Aprobación automática activada.' : 'Aprobación automática desactivada.', 'ok'); reload(); }
    catch (err) { e.target.checked = !on; toast(errMsg(err), 'bad'); }
  };
  box.querySelector('#add').onclick = async () => {
    const em = box.querySelector('#em').value.trim();
    if (!valid(em)) { toast('Escribe un correo válido.', 'warn'); return; }
    try { await api.admin.addAllowed(em, box.querySelector('#nt').value.trim()); toast('Correo autorizado.', 'ok'); reload(); } catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'Ese correo ya estaba autorizado.' : errMsg(e), 'bad'); }
  };
  box.querySelector('#addb').onclick = async () => {
    const ems = [...new Set(box.querySelector('#bulk').value.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(valid))];
    if (!ems.length) { toast('No se encontraron correos válidos.', 'warn'); return; }
    let ok = 0; for (const em of ems) { try { await api.admin.addAllowed(em, null); ok++; } catch (e) { } }
    toast(`${ok} correos autorizados.`, 'ok'); reload();
  };
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!await confirmDialog('Quitar autorización', `${b.dataset.del} ya no se aprobará automáticamente. Si ya tiene cuenta, bloquéala en Usuarios.`, 'Quitar', 'danger')) return;
    try { await api.admin.removeAllowed(b.dataset.del); reload(); } catch (e) { toast(errMsg(e), 'bad'); }
  });
}

async function bugs(box) {
  const [list, us] = await Promise.all([api.admin.bugs(), api.admin.users()]);
  const who = Object.fromEntries(us.map(u => [u.id, u.full_name || u.email]));
  const render = (f) => {
    const sel = list.filter(b => f === 'all' || (f === 'open' ? ['nuevo', 'revisando'].includes(b.status) : b.status === f));
    box.querySelector('#bl').innerHTML = sel.length ? sel.map(b => `<div class="card" style="margin-bottom:12px"><div class="row between"><div><span class="chip ${BSTATUS[b.status]}">${esc(b.status)}</span> <b>${esc(b.category)}</b> <span class="small muted">· ${esc(who[b.user_id] || 'usuario')} · ${fmtDate(b.created_at, true)}</span></div><button class="btn sm" data-b="${b.id}">Responder / cambiar estado</button></div>
      <p style="white-space:pre-wrap;margin:10px 0">${esc(b.description)}</p>
      <div class="small faint">Página: ${esc(b.page || '')}${b.context?.question ? ' · Reactivo: ' + esc(b.context.question) : ''}${b.context?.device ? ' · ' + esc(b.context.device) : ''}</div>
      ${b.admin_note ? `<div class="notice info small" style="margin-top:8px"><b>Respuesta:</b> ${esc(b.admin_note)}</div>` : ''}</div>`).join('') : '<div class="card empty">Sin reportes en este filtro.</div>';
    box.querySelectorAll('[data-b]').forEach(btn => btn.onclick = () => edit(list.find(x => String(x.id) === btn.dataset.b)));
  };
  const edit = (b) => modal({ title: 'Reporte #' + b.id, body: `<label class="field"><span>Estado</span><select id="bs">${Object.keys(BSTATUS).map(s => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label class="field"><span>Respuesta para el usuario</span><textarea id="bn" rows="4">${esc(b.admin_note || '')}</textarea></label>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', cls: 'primary', onClick: async (el) => { await api.admin.updateBug(b.id, el.querySelector('#bs').value, el.querySelector('#bn').value.trim()); toast('Reporte actualizado.', 'ok'); adminView(box.parentElement, 'reportes'); } }] });
  box.innerHTML = `<div class="tabs" id="bt"><button class="on" data-f="open">Abiertos</button><button data-f="resuelto">Resueltos</button><button data-f="descartado">Descartados</button><button data-f="all">Todos (${list.length})</button></div><div id="bl"></div>`;
  box.querySelectorAll('#bt button').forEach(b => b.onclick = () => { box.querySelectorAll('#bt button').forEach(x => x.classList.remove('on')); b.classList.add('on'); render(b.dataset.f); });
  render('open');
}

async function errors(box) {
  const list = await api.admin.errors();
  box.innerHTML = `<div class="card"><div class="card-head"><h3>Errores técnicos registrados automáticamente</h3><span class="chip">${list.length}</span></div>
    <p class="small muted">Se registran solos cuando algo falla en el navegador de un usuario. Sirven para encontrar y corregir fallas aunque nadie las reporte.</p>
    ${list.length ? `<div class="table-wrap"><table class="t"><tr><th>Fecha</th><th>Mensaje</th><th>Página</th><th>Navegador</th></tr>${list.map(e => `<tr><td class="small">${fmtDate(e.created_at, true)}</td><td class="small"><b>${esc(e.message || '')}</b><br><span class="faint">${esc((e.source || '') + ' ' + (e.stack || '').slice(0, 160))}</span></td><td class="small">${esc(e.page || '')}</td><td class="small faint">${esc((e.ua || '').slice(0, 60))}</td></tr>`).join('')}</table></div>` : '<div class="empty">Sin errores registrados.</div>'}</div>`;
}

async function content(box) {
  const qs = await api.admin.questions();
  box.innerHTML = `<div class="grid g2"><div class="card pad-lg"><h3>Importar contenido</h3>
    <p class="small muted">Selecciona el archivo <b>contenido_simulador.json</b>. Agrega o actualiza los reactivos y las fichas de estudio sin borrar el historial de los usuarios.</p>
    <input type="file" id="fi" accept=".json,application/json"><div id="fr" class="small" style="margin-top:10px"></div>
    <button class="btn primary" id="imp" disabled style="margin-top:10px">Importar</button></div>
    <div class="card"><h3>Banco actual</h3><p><b>${qs.filter(q => q.active).length}</b> reactivos activos de ${qs.length}.</p>
    <div class="grid g3 small">${Object.keys(SUBAREAS).map(k => `<div><b>${k}</b>: ${qs.filter(q => q.subarea === k && q.active).length}</div>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">Desactiva un reactivo si tiene un error; dejará de aparecer en los exámenes nuevos.</p></div></div>
    <div class="card" style="margin-top:16px"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0">Reactivos</h3><div class="row"><select id="qs"><option value="">Todas las subáreas</option>${Object.keys(SUBAREAS).map(k => `<option>${k}</option>`).join('')}</select><input type="search" id="qf" placeholder="Buscar por clave o texto"></div></div><div id="ql"></div></div>`;
  let payload = null;
  box.querySelector('#fi').onchange = async (e) => {
    const f = e.target.files[0]; payload = null; box.querySelector('#imp').disabled = true;
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const qn = (j.questions || []).length, dn = (j.docs || []).length;
      const bad = (j.questions || []).filter(q => !q.id || !q.subarea || !Array.isArray(q.options) || q.options.length !== 3 || !['A', 'B', 'C'].includes(q.answer));
      if (!qn && !dn) throw new Error('El archivo no contiene reactivos ni fichas.');
      if (bad.length) throw new Error(`${bad.length} reactivos tienen un formato incorrecto (por ejemplo ${bad[0].id || 'sin clave'}).`);
      payload = { questions: j.questions || [], docs: j.docs || [] };
      box.querySelector('#fr').innerHTML = `<span class="chip ok">Archivo válido</span> ${qn} reactivos · ${dn} fichas · versión ${esc(j.version || 's/v')}`;
      box.querySelector('#imp').disabled = false;
    } catch (err) { box.querySelector('#fr').innerHTML = `<span class="chip bad">Error</span> ${esc(err.message)}`; }
  };
  box.querySelector('#imp').onclick = async (e) => {
    if (!payload) return; e.target.disabled = true; box.querySelector('#fr').innerHTML = 'Importando…';
    try {
      let tq = 0, td = 0, total = 0;
      const docs = payload.docs; const chunks = [];
      for (let i = 0; i < payload.questions.length; i += 60) chunks.push(payload.questions.slice(i, i + 60));
      if (!chunks.length) chunks.push([]);
      for (let i = 0; i < chunks.length; i++) {
        const r = await api.admin.importContent({ questions: chunks[i], docs: i === 0 ? docs : [] });
        tq += r.questions; td += r.docs; total = r.bank_total;
        box.querySelector('#fr').textContent = `Importando… ${Math.min((i + 1) * 60, payload.questions.length)}/${payload.questions.length}`;
      }
      toast(`Importados ${tq} reactivos y ${td} fichas. Banco activo: ${total}.`, 'ok');
      adminView(box.parentElement, 'contenido');
    } catch (err) { e.target.disabled = false; box.querySelector('#fr').innerHTML = `<span class="chip bad">Error</span> ${esc(errMsg(err))}`; }
  };
  const list = () => {
    const s = box.querySelector('#qs').value, f = box.querySelector('#qf').value.trim().toLowerCase();
    const sel = qs.filter(q => (!s || q.subarea === s) && (!f || q.id.toLowerCase().includes(f) || q.stem.toLowerCase().includes(f))).slice(0, 80);
    box.querySelector('#ql').innerHTML = sel.length ? sel.map(q => `<details class="review-item"><summary><b>${esc(q.id)}</b> <span class="chip gray">${esc(FORMATS[q.format])}</span> ${q.active ? '' : '<span class="chip bad">Inactivo</span>'} <span class="small">${esc(q.stem.slice(0, 120))}…</span></summary>
      <div style="margin-top:10px"><div class="q-stem">${esc(q.stem)}</div><ol type="A">${q.options.map(o => `<li ${o.k === q.answer ? 'style="font-weight:700;color:var(--ok)"' : ''}>${esc(o.t)}</li>`).join('')}</ol>
      <p class="small"><b>Argumentación:</b> ${esc(plainLetters(q.rationale))}</p><p class="small muted"><b>Referencia:</b> ${esc(q.reference || '')}</p>
      <button class="btn sm ${q.active ? 'danger' : 'ok'}" data-q="${esc(q.id)}">${q.active ? 'Desactivar' : 'Activar'}</button></div></details>`).join('') + (qs.length > 80 ? '<p class="small muted">Se muestran hasta 80; usa el buscador.</p>' : '') : '<div class="empty">Sin reactivos.</div>';
    box.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => { const q = qs.find(x => x.id === b.dataset.q); try { await api.admin.setQuestionActive(q.id, !q.active); q.active = !q.active; list(); toast('Reactivo actualizado.', 'ok'); } catch (e) { toast(errMsg(e), 'bad'); } });
  };
  box.querySelector('#qs').onchange = list; box.querySelector('#qf').oninput = list;
  list();
}

async function devices(box) {
  const list = await api.admin.devices();
  const render = (f) => {
    const sel = list.filter(c => f === 'all' || !c.resolved);
    box.querySelector('#dl').innerHTML = sel.length ? sel.map(c => {
      const who = esc(c.user_name || c.user_email || 'Usuario');
      const owner = esc(c.owner_name || c.owner_email || 'otra cuenta');
      const text = c.kind === 'bloqueado'
        ? `<b>${who}</b> <span class="small muted">(${esc(c.user_email || '')})</span> intentó entrar en el equipo registrado de <b>${owner}</b> <span class="small muted">(${esc(c.owner_email || '')})</span>. Se le pidió cambiar a su cuenta registrada.`
        : `<b>${who}</b> <span class="small muted">(${esc(c.user_email || '')})</span> entró desde otro navegador en una computadora que parece ser la de <b>${owner}</b> <span class="small muted">(${esc(c.owner_email || '')})</span>. Puede ser la misma persona con otra cuenta o una computadora compartida.`;
      return `<div class="card" style="margin-bottom:12px"><div class="row between" style="align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px"><div class="row" style="gap:6px;margin-bottom:6px"><span class="chip ${c.kind === 'bloqueado' ? 'bad' : 'warn'}">${c.kind === 'bloqueado' ? 'Cuenta en equipo ajeno' : 'Posible mismo equipo'}</span>${c.resolved ? `<span class="chip ${c.allowed ? 'ok' : 'gray'}">${c.allowed ? 'Permitido' : 'Revisado'}</span>` : ''}${c.user_status === 'blocked' ? '<span class="chip bad">Cuenta bloqueada</span>' : ''}</div>
        <p style="margin:0">${text}</p><p class="small faint" style="margin:6px 0 0">${fmtDate(c.created_at, true)} · ${c.attempts} ${c.attempts == 1 ? 'vez' : 'veces'} · ${esc(c.device_label || '')}</p></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${c.resolved ? '' : `${c.kind === 'bloqueado' ? `<button class="btn sm ok" data-a="permitir" data-c="${c.id}">Permitir en ese equipo</button>` : ''}<button class="btn sm" data-a="ignorar" data-c="${c.id}">Marcar como revisado</button>`}
          ${c.user_status !== 'blocked' ? `<button class="btn sm danger" data-a="bloquear" data-c="${c.id}">Bloquear cuenta</button>` : ''}
          ${c.kind === 'bloqueado' ? `<button class="btn sm ghost" data-a="liberar" data-c="${c.id}">Liberar equipo</button>` : ''}</div></div></div>`;
    }).join('') : '<div class="card empty">Sin avisos en este filtro.</div>';
    box.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a, list.find(x => String(x.id) === b.dataset.c)));
  };
  const act = async (a, c) => {
    try {
      if (a === 'permitir') { await api.admin.deviceAction(c.id, 'permitir'); toast('La cuenta ya puede usarse en ese equipo.', 'ok'); }
      else if (a === 'ignorar') { await api.admin.deviceAction(c.id, 'ignorar'); toast('Aviso marcado como revisado.', 'ok'); }
      else if (a === 'bloquear') { if (!await confirmDialog('Bloquear cuenta', `${c.user_email || 'Esta cuenta'} ya no podrá entrar al simulador.`, 'Bloquear', 'danger')) return; await api.admin.setStatus(c.user_id, 'blocked'); await api.admin.deviceAction(c.id, 'ignorar'); toast('Cuenta bloqueada.', 'ok'); }
      else if (a === 'liberar') { if (!await confirmDialog('Liberar equipo', 'El equipo quedará sin dueño: la próxima cuenta que entre en él quedará registrada como su cuenta. Úsalo si la persona cambió de cuenta principal.', 'Liberar', 'danger')) return; await api.admin.deviceAction(c.id, 'liberar'); toast('Equipo liberado.', 'ok'); }
      adminView(box.parentElement, 'equipos');
    } catch (e) { toast(errMsg(e), 'bad'); }
  };
  box.innerHTML = `<div class="notice info small" style="margin-bottom:12px">Cada computadora queda registrada con la primera cuenta que entra en ella. Si alguien intenta usar otra cuenta en ese equipo, se le pide cambiar a su cuenta registrada y aparece un aviso aquí. Si es una computadora compartida por dos personas reales, usa <b>Permitir en ese equipo</b>.</div>
    <div class="tabs" id="dt"><button class="on" data-f="open">Pendientes (${list.filter(c => !c.resolved).length})</button><button data-f="all">Todos (${list.length})</button></div><div id="dl"></div>`;
  box.querySelectorAll('#dt button').forEach(b => b.onclick = () => { box.querySelectorAll('#dt button').forEach(x => x.classList.remove('on')); b.classList.add('on'); render(b.dataset.f); });
  render('open');
}

// ---------- Pagos (Mercado Pago) ----------
let lastCheck = null;
const DETAIL = { waiting_payment: 'Esperando pago en efectivo', waiting_transfer: 'Esperando transferencia', in_process: 'En revisión', pending_review_manual: 'En revisión de Mercado Pago', waiting_capture: 'Autorizado, sin capturar', rejected_by_issuer: 'Rechazado por el banco', high_risk: 'Rechazado por seguridad', card_insufficient_amount: 'Fondos insuficientes', bad_filled_card_data: 'Datos de tarjeta incorrectos', amount_limit_exceeded: 'Excede el límite de la tarjeta', required_call_for_authorize: 'Requiere autorizar con el banco', card_disabled: 'Tarjeta deshabilitada', max_attempts_exceeded: 'Demasiados intentos', processing_error: 'Error al procesar', refunded: 'Reembolsado', partially_refunded: 'Reembolso parcial', charged_back: 'Contracargo', expired: 'Vencido', canceled: 'Cancelado' };
async function payments(box) {
  const [cfg, list] = await Promise.all([api.admin.getSettings(), api.admin.payments()]);
  const on = !!cfg.payments_enabled;
  const real = list.filter(p => p.live !== false);
  const ok = real.filter(p => payLabel(p)[1] === 'ok');
  const tests = list.length - real.length;
  const checkHTML = (c) => {
    if (!c) return '<p class="small muted" style="margin:0">Pulsa <b>Probar conexión</b> para revisar que la llave de Mercado Pago funcione.</p>';
    if (c.error) return `<div class="notice bad small">${esc(c.error)}</div>`;
    return `<div class="row wrap" style="gap:6px;margin-bottom:8px">${c.ok ? `<span class="chip ok">Conectado</span>${c.test === true ? '<span class="chip warn">Modo de prueba</span>' : c.test === false ? '<span class="chip ok">Modo real</span>' : ''}` : '<span class="chip bad">Sin conexión</span>'}${c.site && c.site !== 'MLM' ? `<span class="chip bad">Cuenta de otro país (${esc(c.site)})</span>` : ''}${c.webhook_secret ? '<span class="chip ok">Firma del aviso configurada</span>' : '<span class="chip warn">Falta la firma del aviso</span>'}</div>
      <p class="small muted" style="margin:0">${c.ok ? (c.test === true ? 'Los pagos son simulados con tarjetas de prueba; no se cobra dinero real. Para cobrar de verdad, cambia en Supabase la llave por la de producción.' : c.test === false ? 'Los pagos son reales y el dinero llega a tu cuenta de Mercado Pago.' : 'La llave funciona. Haz un pago de prueba para confirmar todo el recorrido.') : 'La llave guardada en Supabase no funciona: ' + esc(c.detail || 'revisa que sea el Access Token correcto') + '.'}${c.webhook_secret ? '' : ' Sin la firma, los avisos se aceptan solo después de consultar el pago directamente en Mercado Pago.'}</p>`;
  };
  box.innerHTML = `<div class="grid g2">
    <div class="card pad-lg"><div class="row between" style="align-items:flex-start;gap:16px">
      <div><h3 style="margin-top:0">Cobro de acceso</h3>
      <p class="small muted" style="margin:4px 0 0">${on ? `<b>Activado.</b> Las cuentas nuevas ven la pantalla de pago y se aprueban solas al pagar ${money(cfg.price)}.` : '<b>Desactivado.</b> Nadie ve la pantalla de pago; el acceso funciona como en la pestaña Acceso.'}</p>
      <p class="small muted" style="margin:6px 0 0">Quienes ya tienen acceso no se ven afectados. Los correos autorizados entran sin pagar.</p></div>
      <label class="check" style="flex:none;margin:0"><input type="checkbox" id="pon" ${on ? 'checked' : ''}><div><b>${on ? 'Activado' : 'Desactivado'}</b></div></label></div>
      <div class="divider"></div>
      <label class="field" style="max-width:220px"><span>Precio del acceso (MXN)</span><input type="number" id="price" min="10" max="10000" step="1" value="${Number(cfg.price)}"></label>
      <button class="btn" id="psave">Guardar precio</button></div>
    <div class="card pad-lg"><h3 style="margin-top:0">Conexión con Mercado Pago</h3>
      <div id="chk">${checkHTML(lastCheck)}</div>
      <div class="row wrap" style="margin-top:12px"><button class="btn" id="ptest">Probar conexión</button><button class="btn" id="ppay">Hacer un pago de prueba</button></div>
      <div class="divider"></div>
      <p class="small" style="margin:0 0 6px"><b>Dirección para el aviso de pagos (webhook)</b></p>
      <div class="row" style="gap:6px"><input type="text" id="wh" readonly value="${esc(CONFIG.webhookUrl)}" style="font-size:.82rem"><button class="btn sm" id="whc">Copiar</button></div>
      <p class="small muted" style="margin:6px 0 0">Va en Mercado Pago → tu aplicación → Configuración de webhooks, con el evento <b>Order (Mercado Pago)</b>.</p></div></div>
    <div class="grid g4" style="margin-top:16px">
      <div class="card stat"><div class="label">Pagos aprobados</div><div class="value">${ok.length}</div><div class="sub">Pagos reales</div></div>
      <div class="card stat"><div class="label">Ingresos</div><div class="value">${money(ok.reduce((a, p) => a + Number(p.amount), 0))}</div><div class="sub">Antes de comisiones e impuestos</div></div>
      <div class="card stat"><div class="label">En proceso</div><div class="value">${real.filter(p => payLabel(p)[0] === 'En proceso').length}</div><div class="sub">Por ejemplo, efectivo sin pagar</div></div>
      <div class="card stat"><div class="label">Pagos de prueba</div><div class="value">${tests}</div><div class="sub">No son dinero real</div></div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h3>Historial de pagos</h3><span class="chip">${list.length}</span></div>
      <p class="small muted">Para hacer un reembolso, entra a tu cuenta de Mercado Pago, busca el pago en Actividad y elige Devolver dinero. Al registrarse el reembolso, la cuenta de esa persona vuelve a quedar pendiente.</p>
      ${list.length ? `<div class="table-wrap"><table class="t"><tr><th>Fecha</th><th>Usuario</th><th>Monto</th><th>Estado</th><th>Forma de pago</th><th>Tipo</th></tr>${list.map(p => { const [l, c] = payLabel(p); return `<tr><td class="small">${fmtDate(p.created_at, true)}${p.paid_at ? `<br><span class="faint">Pagado: ${fmtDate(p.paid_at, true)}</span>` : ''}</td>
        <td><b>${esc(p.full_name || '(sin nombre)')}</b><br><span class="small muted">${esc(p.email || '')}</span></td>
        <td>${money(p.amount)}</td><td><span class="chip ${c}">${l}</span>${p.status_detail && !['accredited', 'created'].includes(p.status_detail) ? `<br><span class="small faint">${esc(DETAIL[p.status_detail] || p.status_detail)}</span>` : ''}</td>
        <td class="small">${esc(payMethod(p.payment_method))}</td><td>${p.live === false ? '<span class="chip warn">Prueba</span>' : '<span class="chip">Real</span>'}<br><span class="small faint">${esc(p.order_id)}</span></td></tr>`; }).join('')}</table></div>` : '<div class="empty">Todavía no hay pagos.</div>'}</div>`;
  const reload = () => adminView(box.parentElement, 'pagos');
  box.querySelector('#whc').onclick = async () => { try { await navigator.clipboard.writeText(CONFIG.webhookUrl); toast('Dirección copiada.', 'ok'); } catch (e) { box.querySelector('#wh').select(); toast('Selecciona y copia la dirección.', 'warn'); } };
  box.querySelector('#psave').onclick = async () => {
    const v = Number(box.querySelector('#price').value);
    try { await api.admin.setPayments(on, v); toast('Precio guardado: ' + money(v) + '.', 'ok'); reload(); } catch (e) { toast(errMsg(e), 'bad'); }
  };
  box.querySelector('#pon').onchange = async (e) => {
    const want = e.target.checked;
    const v = Number(box.querySelector('#price').value) || Number(cfg.price);
    const msg = want
      ? `Las cuentas nuevas y las pendientes tendrán que pagar ${money(v)} para entrar. Quienes ya tienen acceso no se ven afectados.${lastCheck?.test ? ' Atención: la conexión está en modo de prueba, así que los pagos no serán reales.' : ''}`
      : 'Nadie verá la pantalla de pago. Las cuentas nuevas se aprobarán según la pestaña Acceso.';
    if (!await confirmDialog(want ? 'Activar cobro de acceso' : 'Desactivar cobro de acceso', msg, want ? 'Activar' : 'Desactivar', want ? 'primary' : 'danger')) { e.target.checked = !want; return; }
    try { await api.admin.setPayments(want, v); toast(want ? 'Cobro de acceso activado.' : 'Cobro de acceso desactivado.', 'ok'); reload(); }
    catch (err) { e.target.checked = !want; toast(errMsg(err), 'bad'); }
  };
  box.querySelector('#ptest').onclick = async (e) => {
    e.target.disabled = true; box.querySelector('#chk').innerHTML = loadingHTML('Revisando…');
    try { lastCheck = await api.admin.payCheck(); }
    catch (err) { lastCheck = { error: errCode(err) === 'MP_NOT_CONFIGURED' ? 'Falta guardar la llave MP_ACCESS_TOKEN en Supabase.' : errMsg(err) + (err.detail ? ' · ' + err.detail : '') }; }
    box.querySelector('#chk').innerHTML = checkHTML(lastCheck); e.target.disabled = false;
  };
  box.querySelector('#ppay').onclick = async (e) => {
    const test = lastCheck?.test;
    if (!await confirmDialog('Hacer un pago de prueba', `Se abrirá Mercado Pago con el precio actual (${money(cfg.price)}). ${test === false ? 'La conexión está en modo real: se te cobrará de verdad. Puedes devolverte el dinero desde Mercado Pago.' : 'En modo de prueba usa una tarjeta de prueba de Mercado Pago; no se cobra dinero real.'} Al terminar volverás a esta pestaña.`, 'Continuar')) return;
    e.target.disabled = true; e.target.textContent = 'Abriendo…';
    try { const r = await api.payCreate(); location.href = r.checkout_url; }
    catch (err) { e.target.disabled = false; e.target.textContent = 'Hacer un pago de prueba'; toast(errMsg(err) + (err.detail ? ' · ' + err.detail : ''), 'bad'); }
  };
}
