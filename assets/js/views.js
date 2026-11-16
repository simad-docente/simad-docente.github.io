// Vistas: inicio, estudio, guía del examen, calendario, historial y perfil
import { api } from './api.js?v=1.1.2';
import { state, nav } from './state.js?v=1.1.2';
import { CONFIG } from './config.js?v=1.1.2';
import { practiceDoc } from './exam.js?v=1.1.2';
import { esc, paras, fmtTime, fmtDur, fmtDate, toast, loadingHTML, errMsg, SUBAREAS, AREAS, FORMATS, MODES, STATUS, pct, levelClass, lineChart, localISO, monthName, MESES_CORTOS } from './ui.js?v=1.1.2';

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function streak(daysSet) {
  let s = 0; const d = new Date();
  if (!daysSet.has(localISO(d))) d.setDate(d.getDate() - 1);
  while (daysSet.has(localISO(d))) { s++; d.setDate(d.getDate() - 1); }
  return s;
}
function heatLevel(m) { return m <= 0 ? '' : m < 15 ? 'l1' : m < 40 ? 'l2' : m < 90 ? 'l3' : 'l4'; }

// ---------- Inicio ----------
export async function dashboard(root) {
  root.innerHTML = loadingHTML('Cargando tu progreso…');
  let stats = null, attempts = [];
  try { [stats, attempts] = await Promise.all([api.myStats(), api.listAttempts(state.user.id, 40)]); } catch (e) { toast(errMsg(e), 'bad'); stats = stats || {}; }
  stats = stats || {};
  const p = state.profile || {};
  const name = (p.full_name || '').split(' ')[0] || 'docente';
  const days = stats.days || [];
  const byDay = Object.fromEntries(days.map(d => [d.day, d]));
  const set = new Set(days.filter(d => +d.minutes > 0 || +d.questions > 0).map(d => d.day));
  const today = byDay[localISO()] || { minutes: 0, questions: 0, correct: 0 };
  const goal = p.daily_goal_min || 60;
  const done = attempts.filter(a => a.status === 'submitted' || a.status === 'annulled');
  const sims = done.filter(a => a.mode === 'simulacro' && a.status === 'submitted');
  const last = done[0];
  const totalAns = Object.values(stats.by_subarea || {}).reduce((s, x) => s + x.total, 0);
  const totalOk = Object.values(stats.by_subarea || {}).reduce((s, x) => s + x.correct, 0);
  let countdown = '';
  if (p.exam_date) {
    const dd = Math.ceil((new Date(p.exam_date + 'T08:00:00') - new Date()) / 86400000);
    countdown = `<div class="countdown"><div class="big">${Math.max(0, dd)}</div><div><b>días para tu examen</b><div class="muted small">${fmtDate(p.exam_date + 'T12:00:00')}</div></div></div>`;
  } else countdown = `<div class="card"><b>¿Cuándo es tu examen?</b><p class="small muted" style="margin:4px 0 8px">Registra la fecha para ver la cuenta regresiva y organizar tu plan.</p><a class="btn sm" href="#/calendario">Configurar mi plan</a></div>`;
  // mapa de calor de 18 semanas
  const start = new Date(); start.setDate(start.getDate() - (17 * 7 + start.getDay()));
  let heat = '';
  for (let i = 0; i < 18 * 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const k = localISO(d); const m = +(byDay[k]?.minutes || 0); heat += `<i class="${heatLevel(m)}" title="${fmtDate(k + 'T12:00')}: ${Math.round(m)} min"></i>`; }
  const subRows = Object.keys(SUBAREAS).map(k => { const s = stats.by_subarea?.[k]; const v = s ? pct(s.correct, s.total) : 0; return `<div class="subarea-row"><span class="code">${k}</span><div><div class="name">${esc(SUBAREAS[k].name)}</div><div class="bar ${s ? levelClass(v) : ''}"><i style="width:${v}%"></i></div></div><span class="pct">${s ? v + '%' : '—'}</span></div>`; }).join('');
  const chartPts = sims.slice(0, 12).reverse().map(a => ({ v: Math.round(a.score), t: fmtDate(a.started_at), s: `${new Date(a.started_at).getDate()} ${MESES_CORTOS[new Date(a.started_at).getMonth()]}` }));

  root.innerHTML = `
  <div class="page-head"><div><div class="crumb">Inicio</div><h1>Hola, ${esc(name)}</h1><p class="muted">Tu preparación para el instrumento de apreciación de conocimientos y aptitudes.</p></div></div>
  <div class="grid g4">
    <div class="span2">${countdown}</div>
    <div class="card stat"><div class="label">Racha</div><div class="value">${streak(set)} días</div><div class="sub">de estudio seguidos</div></div>
    <div class="card stat"><div class="label">Hoy</div><div class="value">${Math.round(today.minutes || 0)}/${goal} min</div><div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, pct(today.minutes || 0, goal))}%"></i></div></div>
  </div>
  <div class="grid g4" style="margin-top:16px">
    <a class="action-tile gold" href="#/examen"><span class="ic">90</span><b>Simulacro completo</b><span>90 reactivos · 4 horas · modo seguro</span></a>
    <a class="action-tile" href="#/practica"><span class="ic">✓</span><b>Práctica guiada</b><span>Retroalimentación inmediata por subárea</span></a>
    <a class="action-tile" href="#/estudio"><span class="ic">≡</span><b>Fichas de estudio</b><span>Los 29 documentos de la bibliografía</span></a>
    <a class="action-tile" href="#/guia"><span class="ic">?</span><b>Cómo es el examen</b><span>Estructura, formatos y reglas</span></a>
  </div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card stat"><div class="label">Último resultado</div><div class="value">${last ? Math.round(last.score) + '%' : '—'}</div><div class="sub">${last ? `${esc(MODES[last.mode])} · ${fmtTime(last.elapsed_sec)} · ${fmtDate(last.started_at)}` : 'Aún no presentas ningún intento'}</div></div>
    <div class="card stat"><div class="label">Mejor simulacro</div><div class="value">${sims.length ? Math.round(Math.max(...sims.map(a => +a.score))) + '%' : '—'}</div><div class="sub">${sims.length} simulacros completos</div></div>
    <div class="card stat"><div class="label">Aciertos acumulados</div><div class="value">${pct(totalOk, totalAns)}%</div><div class="sub">${totalOk} de ${totalAns} reactivos · ${stats.seen_total || 0} de ${stats.bank_total || 0} del banco vistos</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h3>Dominio por subárea</h3><a class="small" href="#/practica">Practicar</a></div>${subRows}</div>
    <div class="card"><div class="card-head"><h3>Evolución en simulacros</h3><a class="small" href="#/historial">Historial</a></div>${lineChart(chartPts)}</div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head"><h3>Constancia de estudio (últimas 18 semanas)</h3><a class="small" href="#/calendario">Ver calendario</a></div>
    <div style="overflow-x:auto"><div class="heat">${heat}</div></div>
    <div class="legend" style="margin-top:8px">Menos <i style="background:#e8edf3"></i><i style="background:#b9d3ec"></i><i style="background:#6fa1d1"></i><i style="background:#2a63a0"></i><i style="background:#163a5f"></i> Más</div></div>`;
}

// ---------- Estudio ----------
export async function studyList(root) {
  root.innerHTML = loadingHTML('Cargando fichas…');
  let docs = [], prog = [];
  try { [docs, prog] = await Promise.all([api.listDocs(), api.studyProgress(state.user.id)]); } catch (e) { root.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`; return; }
  const pm = Object.fromEntries(prog.map(p => [p.doc_id, p.status]));
  if (!docs.length) { root.innerHTML = `<div class="page-head"><div><h1>Fichas de estudio</h1></div></div><div class="card empty">Aún no se han cargado las fichas de estudio. El administrador debe importar el contenido.</div>`; return; }
  const groups = Object.keys(SUBAREAS).map(k => ({ k, docs: docs.filter(d => (d.subareas || []).includes(k)) }));
  const read = docs.filter(d => pm[d.id]).length;
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Estudio</div><h1>Fichas de estudio</h1><p class="muted">Ideas clave de cada documento de la bibliografía, cómo aparecen en los casos y las trampas más comunes.</p></div>
    <div class="row"><span class="chip ok">${read} de ${docs.length} estudiados</span><a class="btn" href="#/guia">Cómo es el examen</a></div></div>
    <div class="tabs" id="gt"><button class="on" data-g="all">Todos</button>${Object.keys(SUBAREAS).map(k => `<button data-g="${k}">${k}</button>`).join('')}</div>
    <div id="dl"></div>`;
  const show = (g) => {
    const list = g === 'all' ? docs : groups.find(x => x.k === g).docs;
    root.querySelector('#dl').innerHTML = (g !== 'all' ? `<p class="muted"><b>${g}</b> · ${esc(SUBAREAS[g].name)}</p>` : '') +
      `<div class="grid g3">${list.map(d => `<a class="doc-card" href="#/estudio/${esc(d.id)}"><span class="num">${d.num ? 'DOCUMENTO ' + d.num : 'GUÍA OFICIAL'} · ${(d.subareas || []).join(' · ')}</span><b>${esc(d.title)}</b><span class="small muted">${esc((d.summary || '').slice(0, 140))}${(d.summary || '').length > 140 ? '…' : ''}</span>${pm[d.id] ? `<span class="chip ${pm[d.id] === 'dominado' ? 'ok' : ''}" style="align-self:flex-start">${pm[d.id] === 'dominado' ? 'Dominado' : 'Leído'}</span>` : ''}</a>`).join('')}</div>`;
  };
  show('all');
  root.querySelectorAll('#gt button').forEach(b => b.onclick = () => { root.querySelectorAll('#gt button').forEach(x => x.classList.remove('on')); b.classList.add('on'); show(b.dataset.g); });
}

let studyTimer = null;
export function stopStudyTimer() {
  if (!studyTimer) return;
  const mins = (Date.now() - studyTimer.t0 - studyTimer.hidden) / 60000;
  const doc = studyTimer.doc; studyTimer = null;
  if (mins >= 0.5) api.logStudy(state.sid, doc, Math.round(mins * 10) / 10).catch(() => { });
}
export async function studyDoc(root, id) {
  root.innerHTML = loadingHTML('Cargando ficha…');
  let d, prog;
  try { [d, prog] = await Promise.all([api.getDoc(id), api.studyProgress(state.user.id)]); } catch (e) { root.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`; return; }
  if (!d) { root.innerHTML = `<div class="card empty">No se encontró la ficha.</div>`; return; }
  const st = (prog || []).find(p => p.doc_id === id)?.status || null;
  const list = (arr) => `<ul>${(arr || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  root.innerHTML = `<div class="page-head"><div><div class="crumb"><a href="#/estudio">Fichas de estudio</a> · ${esc(d.short)}</div><h1>${esc(d.title)}</h1>
    <div class="chips">${(d.subareas || []).map(s => `<span class="chip gold">${s} · ${esc(SUBAREAS[s]?.name || '')}</span>`).join('')}</div></div>
    <div class="row"><button class="btn" id="read">${st ? 'Leído ✓' : 'Marcar como leído'}</button><button class="btn" id="mast">${st === 'dominado' ? 'Dominado ✓' : 'Marcar como dominado'}</button>${d.num ? `<button class="btn primary" id="prac">Practicar reactivos de esta ficha</button>` : ''}</div></div>
    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
      <div class="card pad-lg doc-body"><p style="font-size:1.05rem">${esc(d.summary)}</p>
        <h3>Ideas clave</h3>${list(d.key_points)}
        <h3>Cómo aparece en los casos</h3>${list(d.in_cases)}
        <h3>Trampas comunes en las opciones</h3>${list(d.traps)}</div>
      <div class="stack"><div class="card keybox"><h3>Para recordar</h3>${list(d.remember)}</div>
        <div class="card"><h4>Páginas o artículos de estudio</h4><p class="small">${esc(d.pages || '—')}</p><h4>Referencia</h4><p class="small muted">${esc(d.reference || '')}</p></div></div></div>`;
  const setSt = async (s) => { try { await api.setStudyProgress(state.user.id, id, s); toast(s ? 'Progreso guardado.' : 'Marca eliminada.', 'ok'); studyDoc(root, id); } catch (e) { toast(errMsg(e), 'bad'); } };
  root.querySelector('#read').onclick = () => setSt(st ? null : 'leido');
  root.querySelector('#mast').onclick = () => setSt(st === 'dominado' ? 'leido' : 'dominado');
  const pr = root.querySelector('#prac'); if (pr) pr.onclick = () => { stopStudyTimer(); practiceDoc(root, id); };
  studyTimer = { doc: id, t0: Date.now(), hidden: 0 };
  let hiddenAt = 0;
  const vis = () => { if (!studyTimer) return document.removeEventListener('visibilitychange', vis); if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt) { studyTimer.hidden += Date.now() - hiddenAt; hiddenAt = 0; } };
  document.addEventListener('visibilitychange', vis);
}

// ---------- Guía del examen ----------
export function examGuide(root) {
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Estudio</div><h1>Cómo es el examen</h1><p class="muted">Basado en la Guía de apoyo de USICAMM para Educación Primaria, ciclo 2026-2027.</p></div><a class="btn primary" href="#/examen">Presentar un simulacro</a></div>
  <div class="grid g4">
    <div class="card stat"><div class="label">Reactivos</div><div class="value">90</div><div class="sub">opción múltiple</div></div>
    <div class="card stat"><div class="label">Opciones</div><div class="value">3</div><div class="sub">solo una correcta</div></div>
    <div class="card stat"><div class="label">Estructura</div><div class="value">3 · 6</div><div class="sub">áreas · subáreas</div></div>
    <div class="card stat"><div class="label">Valor</div><div class="value">30</div><div class="sub">de 100 puntos</div></div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Áreas y subáreas</h3>${Object.keys(AREAS).map(a => `<p style="margin-top:10px"><b>Área ${a}. ${esc(AREAS[a])}</b></p><ul class="small">${Object.entries(SUBAREAS).filter(([, v]) => v.area === +a).map(([k, v]) => `<li><b>${k}</b> ${esc(v.name)}</li>`).join('')}</ul>`).join('')}
      <div class="notice info small">La guía no publica cuántos reactivos hay por subárea. El simulador usa 15 por subárea (90 en total).</div></div>
    <div class="card"><h3>Formatos de reactivo</h3>
      <p><b>Cuestionamiento directo.</b> Una pregunta o afirmación que pide una tarea específica a partir de un caso.</p>
      <p><b>Completamiento.</b> Un enunciado al que le faltan uno o varios elementos.</p>
      <p><b>Ordenamiento.</b> Elementos que deben organizarse según un criterio, por ejemplo las fases de un proceso.</p>
      <p><b>Relación de elementos.</b> Dos columnas que se relacionan según un criterio.</p>
      <div class="notice warn small">Las opciones suelen ser muy parecidas y cambian en un detalle clave. Busca qué principio, momento o actor corresponde exactamente al caso.</div></div></div>
  <div class="grid g3" style="margin-top:16px">
    <div class="card"><h3>Antes</h3><ul class="small"><li>Estudia la bibliografía sugerida.</li><li>Verifica que tu cámara, tu micrófono y tu internet funcionen.</li><li>Ten a la mano tu folio, tu contraseña y tu INE.</li><li>Haz la autenticación con huella facial y la simulación previa en el mismo equipo.</li></ul></div>
    <div class="card"><h3>Durante</h3><ul class="small"><li>Inicia en la fecha y hora asignadas.</li><li>Permanece frente a la cámara, en un espacio privado y sin interrupciones.</li><li>No uses otros dispositivos.</li><li>El navegador seguro bloquea otras aplicaciones y detecta salidas de la plataforma.</li></ul></div>
    <div class="card"><h3>Después</h3><ul class="small"><li>Espera la confirmación de la sincronización final antes de cerrar.</li><li>Descarga tu constancia de participación.</li><li>Consulta tus resultados en el portal oficial.</li></ul></div></div>
  <div class="card" style="margin-top:16px"><h3>Condiciones que vigila la supervisión remota</h3><div class="grid g2 small">
    <div><b>Equipo:</b> sin aplicaciones abiertas en segundo plano, sin pantallas múltiples ni proyección, y con conexión estable (de preferencia por cable).</div>
    <div><b>Audio:</b> micrófono abierto todo el tiempo, sin audífonos y sin voces, música, televisión ni ruidos.</div>
    <div><b>Video:</b> rostro descubierto, orejas visibles e iluminación frontal, sin contraluz.</div>
    <div><b>Entorno:</b> a solas en una habitación cerrada, sin cuadros con rostros ni espejos detrás, y en el escritorio solo la computadora y la INE.</div></div>
    <p class="small muted" style="margin-top:10px">El simulador reproduce estas reglas con pantalla completa, detección de cambio de ventana, nivel de ruido, iluminación y conteo de incidencias.</p></div>`;
}

// ---------- Calendario y plan ----------
export async function calendarView(root) {
  root.innerHTML = loadingHTML('Cargando calendario…');
  let stats, attempts;
  try { [stats, attempts] = await Promise.all([api.myStats(), api.listAttempts(state.user.id, 300)]); } catch (e) { root.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`; return; }
  const p = state.profile;
  const byDay = Object.fromEntries((stats?.days || []).map(d => [d.day, d]));
  let cur = new Date(); cur.setDate(1);
  const draw = () => {
    const y = cur.getFullYear(), m = cur.getMonth();
    const first = new Date(y, m, 1), startDow = first.getDay(), dim = new Date(y, m + 1, 0).getDate();
    const todayK = localISO();
    let cells = DOW.map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < startDow; i++) cells += `<div class="day out"></div>`;
    let monthMin = 0, monthQ = 0, monthDays = 0;
    for (let d = 1; d <= dim; d++) {
      const dt = new Date(y, m, d), k = localISO(dt), info = byDay[k];
      const mins = +(info?.minutes || 0); monthMin += mins; monthQ += +(info?.questions || 0); if (mins > 0 || +(info?.questions || 0) > 0) monthDays++;
      const planned = (p.study_days || []).includes(dt.getDay());
      const exam = p.exam_date === k;
      cells += `<div class="day ${heatLevel(mins)} ${k === todayK ? 'today' : ''} ${planned ? 'planned' : ''} ${exam ? 'exam' : ''}" data-k="${k}"><span class="n">${d}</span>${exam ? '<span class="chip bad">Examen</span>' : ''}${mins ? `<span class="m">${Math.round(mins)} min</span>` : ''}${info?.questions ? `<span class="m">${info.questions} reactivos</span>` : ''}<span class="dot"></span></div>`;
    }
    root.querySelector('#cal').innerHTML = cells;
    root.querySelector('#mt').textContent = `${monthName(m)} ${y}`;
    root.querySelector('#msum').innerHTML = `<b>${monthDays}</b> días con estudio · <b>${Math.round(monthMin)}</b> minutos · <b>${monthQ}</b> reactivos respondidos`;
    root.querySelectorAll('#cal .day[data-k]').forEach(c => c.onclick = () => dayDetail(c.dataset.k));
  };
  const dayDetail = (k) => {
    const info = byDay[k];
    const list = (attempts || []).filter(a => localISO(a.started_at) === k);
    const box = root.querySelector('#dd');
    box.innerHTML = `<h3>${fmtDate(k + 'T12:00')}</h3>${info ? `<p>${Math.round(info.minutes)} minutos · ${info.questions} reactivos · ${pct(info.correct, info.questions)}% de aciertos</p>` : '<p class="muted">Sin actividad registrada.</p>'}
      ${list.length ? `<div class="table-wrap"><table class="t"><tr><th>Actividad</th><th>Aciertos</th><th>Tiempo</th></tr>${list.map(a => `<tr class="click" data-id="${a.id}"><td>${esc(MODES[a.mode])}</td><td>${a.score != null ? Math.round(a.score) + '%' : '—'}</td><td>${fmtTime(a.elapsed_sec)}</td></tr>`).join('')}</table></div>` : ''}`;
    box.querySelectorAll('tr[data-id]').forEach(r => r.onclick = () => nav('#/resultado/' + r.dataset.id));
  };
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Calendario</div><h1>Calendario y plan de estudio</h1><p class="muted">Registra tu fecha de examen, tus días de estudio y tu meta diaria; aquí verás tu constancia.</p></div></div>
  <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
    <div class="card"><div class="row between" style="margin-bottom:12px"><button class="btn sm" id="pm">←</button><h3 id="mt" style="margin:0;text-transform:capitalize"></h3><button class="btn sm" id="nm">→</button></div>
      <div class="cal" id="cal"></div><p class="small muted" style="margin-top:10px" id="msum"></p>
      <div class="legend">Días planeados <i style="background:#fbf8f1;border:1px solid #dfe5ec"></i> · Intensidad <i style="background:#b9d3ec"></i><i style="background:#6fa1d1"></i><i style="background:#2a63a0"></i><i style="background:#163a5f"></i></div></div>
    <div class="stack"><div class="card"><h3>Mi plan</h3>
      <label class="field"><span>Fecha de mi examen</span><input type="date" id="ed" value="${esc(p.exam_date || '')}"></label>
      <label class="field"><span>Meta diaria (minutos)</span><input type="number" id="gm" min="5" max="600" step="5" value="${p.daily_goal_min || 60}"></label>
      <div class="field"><span style="display:block;font-weight:600;margin-bottom:6px">Días de estudio</span><div class="toggle-days">${DOW.map((d, i) => `<label><input type="checkbox" value="${i}" ${(p.study_days || []).includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
      <button class="btn primary" id="save">Guardar plan</button></div>
      <div class="card" id="dd"><h3>Detalle del día</h3><p class="muted small">Selecciona un día del calendario.</p></div></div></div>`;
  root.querySelector('#pm').onclick = () => { cur.setMonth(cur.getMonth() - 1); draw(); };
  root.querySelector('#nm').onclick = () => { cur.setMonth(cur.getMonth() + 1); draw(); };
  root.querySelector('#save').onclick = async () => {
    const fields = { exam_date: root.querySelector('#ed').value || null, daily_goal_min: Math.max(5, Math.min(600, +root.querySelector('#gm').value || 60)), study_days: [...root.querySelectorAll('.toggle-days input:checked')].map(x => +x.value) };
    try { state.profile = await api.updateProfile(state.user.id, fields); toast('Plan guardado.', 'ok'); draw(); } catch (e) { toast(errMsg(e), 'bad'); }
  };
  draw(); dayDetail(localISO());
}

// ---------- Historial ----------
export async function historyView(root) {
  root.innerHTML = loadingHTML('Cargando historial…');
  let list = [];
  try { list = await api.listAttempts(state.user.id, 300); } catch (e) { root.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`; return; }
  const done = list.filter(a => a.status !== 'in_progress');
  const sims = done.filter(a => a.mode !== 'practica' && a.status === 'submitted');
  const pts = sims.slice(0, 20).reverse().map(a => ({ v: Math.round(a.score), t: `${MODES[a.mode]} ${fmtDate(a.started_at)}`, s: `${new Date(a.started_at).getDate()} ${MESES_CORTOS[new Date(a.started_at).getMonth()]}` }));
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Historial</div><h1>Historial de intentos</h1><p class="muted">Cada intento registra el porcentaje de aciertos y el tiempo en que lo contestaste.</p></div></div>
  <div class="card"><div class="card-head"><h3>Evolución en simulacros</h3></div>${lineChart(pts)}</div>
  <div class="tabs" style="margin-top:16px" id="ht"><button class="on" data-f="all">Todos</button><button data-f="simulacro">Simulacros completos</button><button data-f="corto">Simulacros cortos</button><button data-f="practica">Prácticas</button></div>
  <div id="hl"></div>`;
  const show = (f) => {
    const sel = done.filter(a => f === 'all' || a.mode === f);
    root.querySelector('#hl').innerHTML = sel.length ? `<div class="table-wrap"><table class="t"><tr><th>Fecha</th><th>Tipo</th><th>Aciertos</th><th>%</th><th>Tiempo</th><th>Estado</th><th>Incidencias</th></tr>
      ${sel.map(a => `<tr class="click" data-id="${a.id}"><td>${fmtDate(a.started_at, true)}</td><td>${esc(MODES[a.mode])}${a.filter_subarea ? ' · ' + esc(a.filter_subarea) : ''}${a.filter_doc ? ' · ficha ' + esc(a.filter_doc) : ''}${a.focus === 'errores' ? ' · errores' : ''}</td><td>${a.correct ?? '—'}/${a.total}</td><td><b>${a.score != null ? Math.round(a.score) + '%' : '—'}</b></td><td>${fmtTime(a.elapsed_sec)}</td><td><span class="chip ${a.status === 'submitted' ? 'ok' : a.status === 'annulled' ? 'bad' : 'gray'}">${esc(STATUS[a.status])}</span></td><td>${(a.incidents || []).length}</td></tr>`).join('')}</table></div>` : '<div class="card empty">Aún no hay intentos en esta categoría.</div>';
    root.querySelectorAll('#hl tr[data-id]').forEach(r => r.onclick = () => nav('#/resultado/' + r.dataset.id));
  };
  show('all');
  root.querySelectorAll('#ht button').forEach(b => b.onclick = () => { root.querySelectorAll('#ht button').forEach(x => x.classList.remove('on')); b.classList.add('on'); show(b.dataset.f); });
}

// ---------- Perfil ----------
export async function profileView(root) {
  const p = state.profile;
  let bugs = [];
  try { bugs = await api.myBugs(state.user.id); } catch (e) { }
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Mi cuenta</div><h1>Mi cuenta</h1></div></div>
  <div class="grid g2"><div class="card pad-lg"><h3>Datos</h3>
    <label class="field"><span>Nombre</span><input type="text" id="fn" value="${esc(p.full_name || '')}"></label>
    <p><b>Correo:</b> ${esc(p.email)}<br><b>Folio de práctica:</b> ${esc(p.folio || '')}<br><b>Cuenta creada:</b> ${fmtDate(p.created_at)}</p>
    <button class="btn primary" id="sv">Guardar</button></div>
    <div class="card pad-lg"><h3>Seguridad de la cuenta</h3>
      <p class="small">Tu cuenta solo puede estar abierta en <b>un dispositivo a la vez</b>. Si inicias sesión en otro equipo, la sesión de este se cerrará automáticamente. No compartas tu cuenta: el administrador puede ver los cambios de dispositivo.</p>
      <p class="small muted">Dispositivo actual: ${esc(navigator.userAgent.slice(0, 90))}…</p>
      <button class="btn danger" id="lo">Cerrar sesión</button></div></div>
  <div class="card" style="margin-top:16px"><h3>Mis reportes de fallas</h3>${bugs.length ? `<div class="table-wrap"><table class="t"><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Estado</th><th>Respuesta</th></tr>${bugs.map(b => `<tr><td>${fmtDate(b.created_at, true)}</td><td>${esc(b.category)}</td><td>${esc(b.description.slice(0, 120))}</td><td><span class="chip ${b.status === 'resuelto' ? 'ok' : b.status === 'descartado' ? 'gray' : 'warn'}">${esc(b.status)}</span></td><td class="small">${esc(b.admin_note || '')}</td></tr>`).join('')}</table></div>` : '<p class="muted">No has enviado reportes.</p>'}</div>`;
  root.querySelector('#sv').onclick = async () => { try { state.profile = await api.updateProfile(state.user.id, { full_name: root.querySelector('#fn').value.trim() || null }); toast('Datos guardados.', 'ok'); } catch (e) { toast(errMsg(e), 'bad'); } };
  root.querySelector('#lo').onclick = () => window.dispatchEvent(new CustomEvent('simad:logout'));
}
