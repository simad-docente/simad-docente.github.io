// Motor de examen (simulacro), práctica y resultados
import { api } from './api.js?v=1.2.1';
import { state, nav } from './state.js?v=1.2.1';
import { CONFIG } from './config.js?v=1.2.1';
import { Proctor, INCIDENT_LABELS, ENVIRONMENT_RULES } from './secure.js?v=1.2.1';
import { esc, paras, fmtTime, fmtDur, fmtDate, toast, modal, confirmDialog, loadingHTML, errMsg, errCode, SUBAREAS, AREAS, FORMATS, MODES, STATUS, pct, levelClass, ring, deviceLabel } from './ui.js?v=1.2.1';

// ---------- Render de un reactivo ----------
export function questionHTML(it, { chosen = null, result = null, disabled = false } = {}) {
  let extra = '';
  if (it.format === 'ordenamiento' && it.items?.list) {
    extra = `<div class="q-items"><ol>${it.items.list.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
  } else if (it.format === 'relacion' && it.items?.left) {
    extra = `<div class="q-items q-rel">
      <div><h5>${esc(it.items.leftTitle || 'Columna A')}</h5><ul>${it.items.left.map((x, i) => `<li><b>${i + 1}.</b> ${esc(x)}</li>`).join('')}</ul></div>
      <div><h5>${esc(it.items.rightTitle || 'Columna B')}</h5><ul>${it.items.right.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  }
  const opts = it.options.map(o => {
    let cls = '';
    if (result) {
      if (o.k === result.correct) cls = 'right';
      else if (o.k === chosen) cls = 'wrong';
    } else if (o.k === chosen) cls = 'sel';
    return `<button type="button" class="opt ${cls}" data-k="${o.k}" ${disabled ? 'disabled' : ''} aria-pressed="${o.k === chosen}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></button>`;
  }).join('');
  return `<div class="q-stem">${paras(it.stem)}</div>${extra}<div class="opts" role="radiogroup">${opts}</div>`;
}

function feedbackHTML(res) {
  const ok = res.is_correct;
  const docs = (res.docs || []).map(d => `<a href="#/estudio/${esc(d)}">Ficha ${esc(d)}</a>`).join(' · ');
  return `<div class="feedback ${ok ? 'ok' : 'bad'}">
    <h4>${ok ? 'Respuesta correcta' : 'Respuesta incorrecta'} · la opción correcta es ${esc(res.correct)}</h4>
    <div><b>Argumentación.</b> ${esc(res.rationale)}</div>
    <div class="ref"><b>Referencia:</b> ${esc(res.reference || '—')}${docs ? ' · Estudiar: ' + docs : ''}</div></div>`;
}

// ---------- Pantalla previa al examen ----------
export async function examLobby(root) {
  root.innerHTML = loadingHTML('Verificando si tienes un examen en curso…');
  let active = null;
  try { active = await api.activeAttempt(state.sid, null); } catch (e) { toast(errMsg(e), 'bad'); }
  if (active && active.expired) { toast('Tu examen anterior terminó por tiempo y se calificó automáticamente.', 'warn'); active = null; }
  if (active && active.mode === 'practica') active = null;
  const remaining = active && active.time_limit_sec ? (new Date(active.started_at).getTime() + active.time_limit_sec * 1000 - new Date(active.server_now).getTime()) / 1000 : 0;

  root.innerHTML = `
  <div class="page-head"><div><div class="crumb">Examen</div><h1>Simulacro del examen de admisión</h1>
  <p class="muted">Reproduce las condiciones de la aplicación en línea: 90 reactivos, tres opciones, 4 horas y supervisión con navegador seguro.</p></div></div>
  ${active ? `<div class="notice warn" style="margin-bottom:16px"><b>Tienes un ${esc(MODES[active.mode].toLowerCase())} en curso.</b> El tiempo sigue corriendo: quedan aproximadamente <b>${fmtTime(remaining)}</b>.
    <div class="row" style="margin-top:10px"><button class="btn primary" id="resume">Continuar examen</button><button class="btn danger sm" id="abandon">Abandonar y calificar</button></div></div>` : ''}
  <div class="grid g2">
    <div class="card pad-lg">
      <h2>Configura tu simulacro</h2>
      <div class="stack" style="margin-top:12px">
        <label class="check"><input type="radio" name="mode" value="simulacro" checked><div><b>Simulacro completo</b><br><span class="muted small">${CONFIG.examTotal} reactivos (15 por subárea) · 4 horas · igual que el examen real.</span></div></label>
        <label class="check"><input type="radio" name="mode" value="corto"><div><b>Simulacro corto</b><br><span class="muted small">${CONFIG.shortTotal} reactivos (5 por subárea) · 80 minutos · para practicar a diario.</span></div></label>
      </div>
      <div class="divider"></div>
      <label class="check"><input type="checkbox" id="proctor" checked><div><b>Simular supervisión con cámara y micrófono</b><br><span class="muted small">Se activan como en la aplicación real. Nada se graba ni se envía: todo ocurre en tu equipo.</span></div></label>
      <label class="check"><input type="checkbox" id="strict" checked><div><b>Modo estricto</b><br><span class="muted small">Al acumular ${CONFIG.maxIncidents} incidencias (cambiar de ventana, salir de pantalla completa, ruido, etc.) el simulacro se anula, como ocurre en la evaluación real.</span></div></label>
      <div class="row" style="margin-top:18px"><button class="btn primary lg" id="go">Preparar simulacro</button></div>
    </div>
    <div class="card pad-lg">
      <h2>Antes de comenzar</h2>
      <ul class="small" style="padding-left:18px;line-height:1.7">
        <li>Usa una computadora con cámara y micrófono, de preferencia con Google Chrome actualizado.</li>
        <li>El examen se presenta en <b>pantalla completa</b>. Salir de ella, cambiar de ventana o de pestaña se registra como incidencia.</li>
        <li>Tus respuestas se guardan automáticamente. Si se corta la conexión, puedes continuar; el tiempo sigue corriendo.</li>
        <li>Puedes marcar reactivos para revisarlos antes de enviar.</li>
        <li>Al terminar verás tu <b>porcentaje de aciertos</b>, el <b>tiempo empleado</b> y la argumentación de cada reactivo.</li>
      </ul>
      <div class="notice info small">Este simulador es una herramienta independiente de estudio. Sus reactivos son originales, elaborados a partir de la bibliografía de la Guía de apoyo 2026-2027; no son reactivos del examen oficial.</div>
    </div>
  </div>`;
  if (active) {
    root.querySelector('#resume').onclick = () => startFlow(root, { resume: active, mode: active.mode, proctor: active.secure_mode, strict: active.secure_mode });
    root.querySelector('#abandon').onclick = async () => {
      if (!await confirmDialog('Abandonar examen', 'Se calificará con las respuestas guardadas hasta ahora. ¿Deseas continuar?', 'Abandonar y calificar', 'danger')) return;
      try { const r = await api.submitAttempt(state.sid, active.attempt_id, false); nav('#/resultado/' + r.attempt_id); } catch (e) { toast(errMsg(e), 'bad'); }
    };
  }
  root.querySelector('#go').onclick = () => {
    const mode = root.querySelector('input[name=mode]:checked').value;
    startFlow(root, { mode, proctor: root.querySelector('#proctor').checked, strict: root.querySelector('#strict').checked });
  };
}

// Flujo de preparación: acceso, verificación, autenticación, entorno, instrucciones
async function startFlow(root, opts) {
  const proctor = new Proctor();
  const useProctor = !!opts.proctor;
  const steps = useProctor ? ['Acceso', 'Verificación del equipo', 'Autenticación', 'Entorno', 'Instrucciones'] : ['Acceso', 'Entorno', 'Instrucciones'];
  let step = 0;
  const folio = state.profile?.folio || 'ADM-0000-000000';
  const stepsBar = () => `<div class="steps">${steps.map((s, i) => `<div class="s ${i < step ? 'done' : i === step ? 'on' : ''}"><b>${i < step ? '✓' : i + 1}</b>${esc(s)}</div>`).join('')}</div>`;
  const cleanup = async () => { await proctor.stop(); };
  const cancelBtn = `<button class="btn ghost" data-cancel>Cancelar</button>`;
  const bindCancel = () => root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => { await cleanup(); nav('#/examen'); });

  const render = () => {
    const name = steps[step];
    if (name === 'Acceso') {
      root.innerHTML = `${stepsBar()}<div class="card pad-lg" style="max-width:640px">
        <h2>Acceso a la aplicación</h2>
        <p class="muted">En la aplicación real se ingresa con folio, contraseña e identificación oficial. Para familiarizarte, escribe tu folio de práctica.</p>
        <div class="keybox" style="margin:12px 0"><span class="small muted">Tu folio de práctica</span><div style="font-family:ui-monospace,monospace;font-size:1.3rem;font-weight:700;letter-spacing:.06em">${esc(folio)}</div></div>
        <label class="field"><span>Folio</span><input type="text" id="f" autocomplete="off" placeholder="Escribe el folio tal como aparece" style="text-transform:uppercase"></label>
        <label class="check"><input type="checkbox" id="ine"><div>Tengo a la mano mi identificación oficial (INE).</div></label>
        <div class="row between" style="margin-top:16px">${cancelBtn}<button class="btn primary" id="next">Continuar</button></div></div>`;
      bindCancel();
      root.querySelector('#next').onclick = () => {
        const v = root.querySelector('#f').value.trim().toUpperCase();
        if (v !== folio.toUpperCase()) { toast('El folio no coincide. Revísalo con cuidado.', 'warn'); return; }
        if (!root.querySelector('#ine').checked) { toast('Confirma que tienes tu identificación a la mano.', 'warn'); return; }
        step++; render();
      };
    } else if (name === 'Verificación del equipo') {
      const sup = Proctor.support();
      root.innerHTML = `${stepsBar()}<div class="grid g2">
        <div class="card pad-lg"><h2>Verificación del equipo</h2>
          <p class="muted">Permite el acceso a la cámara y al micrófono cuando el navegador lo solicite.</p>
          <div class="cam" style="margin:12px 0"><video id="v" autoplay muted playsinline></video><span class="tag">Vista previa</span></div>
          <div class="small muted">Nivel del micrófono</div><div class="meter"><i id="m"></i></div>
          <div class="row" style="margin-top:14px"><button class="btn" id="cam">Activar cámara y micrófono</button></div>
        </div>
        <div class="card pad-lg"><h3>Resultado de la verificación</h3><div id="checks" class="stack small"></div>
          <div class="row between" style="margin-top:18px">${cancelBtn}<button class="btn primary" id="next" disabled>Continuar</button></div></div></div>`;
      bindCancel();
      const checks = root.querySelector('#checks');
      const line = (ok, t, d = '') => `<div class="notice ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}"><b>${ok === true ? '✓' : ok === false ? '✕' : '!'} ${esc(t)}</b>${d ? `<br>${esc(d)}` : ''}</div>`;
      let meterT = null;
      const evaluate = () => {
        const li = proctor.lighting();
        const isChrome = /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
        const multi = 'isExtended' in screen ? screen.isExtended : null;
        const html = [
          line(sup.secure, 'Conexión segura (HTTPS)'),
          line(navigator.onLine, 'Conexión a internet', navigator.onLine ? '' : 'Sin conexión detectada'),
          line(isChrome ? true : null, 'Navegador', isChrome ? deviceLabel() : `${deviceLabel()}. Se recomienda Google Chrome.`),
          line(sup.fullscreen, 'Pantalla completa disponible'),
          line(multi === null ? null : !multi, 'Una sola pantalla', multi === null ? 'Tu navegador no permite verificarlo; confirma que no tienes monitores adicionales.' : multi ? 'Se detectó una pantalla adicional: desconéctala.' : ''),
          line(proctor.hasMedia(), 'Cámara y micrófono', proctor.hasMedia() ? '' : 'Aún no se activan.'),
          li ? line(li.avg > 60 && !li.backlit ? true : li.avg > 35 ? null : false, 'Iluminación', li.backlit ? 'Parece que hay contraluz: colócate frente a la fuente de luz.' : li.avg < 35 ? 'La imagen está muy oscura.' : li.avg < 60 ? 'La imagen está algo oscura; mejora la luz frontal.' : 'Buena iluminación frontal.') : ''
        ].join('');
        checks.innerHTML = html;
        root.querySelector('#next').disabled = !proctor.hasMedia();
      };
      evaluate();
      root.querySelector('#cam').onclick = async () => {
        try {
          await proctor.startMedia(root.querySelector('#v'));
          meterT = setInterval(() => { const m = root.querySelector('#m'); if (!m) return clearInterval(meterT); m.style.width = Math.round(proctor.level() * 100) + '%'; }, 120);
          setTimeout(evaluate, 1200); setTimeout(evaluate, 3000);
        } catch (e) { toast('No se pudo activar la cámara o el micrófono: ' + (e.message || e), 'bad'); evaluate(); }
      };
      root.querySelector('#next').onclick = () => { clearInterval(meterT); step++; render(); };
    } else if (name === 'Autenticación') {
      root.innerHTML = `${stepsBar()}<div class="card pad-lg" style="max-width:760px"><h2>Autenticación facial</h2>
        <p class="muted">En la aplicación real se toma una “huella facial”. Aquí se captura una fotografía de referencia que solo se muestra durante el simulacro y se descarta al terminar.</p>
        <div class="grid g2" style="margin-top:10px"><div class="cam"><video id="v" autoplay muted playsinline></video><span class="tag">Cámara</span></div>
        <div class="cam" id="ph" style="display:grid;place-items:center;color:#9fb3c8;font-size:.9rem">Sin fotografía</div></div>
        <div class="notice info small" style="margin-top:12px">Rostro descubierto, sin gorra ni lentes oscuros, orejas visibles y luz de frente.</div>
        <div class="row between" style="margin-top:16px">${cancelBtn}<div class="row"><button class="btn" id="snap">Tomar fotografía</button><button class="btn primary" id="next" disabled>Continuar</button></div></div></div>`;
      bindCancel();
      proctor.attach(root.querySelector('#v'));
      root.querySelector('#snap').onclick = async () => {
        const li = proctor.lighting();
        if (li && li.avg < 35) { toast('La imagen está muy oscura. Mejora la iluminación e inténtalo de nuevo.', 'warn'); return; }
        const n = await proctor.faceCount();
        if (n === 0) { toast('No se detectó un rostro. Colócate de frente a la cámara.', 'warn'); return; }
        if (n > 1) { toast('Se detectó más de una persona. Debes estar a solas.', 'warn'); return; }
        const p = proctor.capturePhoto();
        if (!p) { toast('No se pudo tomar la fotografía.', 'bad'); return; }
        root.querySelector('#ph').innerHTML = `<img src="${p}" alt="Fotografía de referencia" style="width:100%;height:100%;object-fit:cover">`;
        root.querySelector('#next').disabled = false;
        toast('Autenticación registrada.', 'ok');
      };
      root.querySelector('#next').onclick = () => { step++; render(); };
    } else if (name === 'Entorno') {
      root.innerHTML = `${stepsBar()}<div class="card pad-lg" style="max-width:860px"><h2>Condiciones del entorno</h2>
        <p class="muted">Confirma cada punto. En la evaluación real, incumplirlos puede generar incidencias que bloqueen o anulen tu aplicación.</p>
        <div id="rules">${ENVIRONMENT_RULES.map(r => `<label class="check"><input type="checkbox" data-r="${r.id}"><div>${esc(r.t)}</div></label>`).join('')}</div>
        <div class="row between" style="margin-top:16px">${cancelBtn}<button class="btn primary" id="next" disabled>Continuar</button></div></div>`;
      bindCancel();
      const boxes = [...root.querySelectorAll('[data-r]')];
      boxes.forEach(b => b.onchange = () => { b.closest('.check').classList.toggle('ok', b.checked); root.querySelector('#next').disabled = !boxes.every(x => x.checked); });
      root.querySelector('#next').onclick = () => { step++; render(); };
    } else if (name === 'Instrucciones') {
      const isSim = opts.mode === 'simulacro';
      const total = opts.resume ? opts.resume.total : (isSim ? CONFIG.examTotal : CONFIG.shortTotal);
      const minutes = opts.resume ? Math.round((opts.resume.time_limit_sec || 0) / 60) : (isSim ? CONFIG.examMinutes : Math.ceil(CONFIG.shortTotal * 160 / 60));
      root.innerHTML = `${stepsBar()}<div class="card pad-lg" style="max-width:860px"><h2>Instrucciones</h2>
        <ol style="line-height:1.8;padding-left:20px">
          <li>El instrumento consta de <b>${total} reactivos</b> de opción múltiple con <b>tres opciones</b>; solo una es correcta.</li>
          <li>Tienes <b>${minutes} minutos</b>. El tiempo corre desde que inicias y no se detiene aunque salgas.</li>
          <li>Los reactivos pueden ser de cuestionamiento directo, completamiento, ordenamiento o relación de elementos. Lee con atención la base de cada uno.</li>
          <li>Puedes avanzar, regresar y <b>marcar para revisión</b>. Tus respuestas se guardan automáticamente.</li>
          <li>${useProctor ? 'La cámara y el micrófono permanecerán activos. ' : ''}Mantente en pantalla completa; ${opts.strict ? `con <b>${CONFIG.maxIncidents} incidencias</b> el simulacro se anula.` : 'las incidencias se registrarán en tu reporte.'}</li>
          <li>Al terminar, selecciona <b>Finalizar examen</b> y confirma el envío. Espera el mensaje de que tus respuestas se enviaron con éxito.</li>
        </ol>
        <label class="check"><input type="checkbox" id="ok"><div>He leído las instrucciones y acepto presentar el simulacro en estas condiciones.</div></label>
        <div class="row between" style="margin-top:16px">${cancelBtn}<button class="btn accent lg" id="start" disabled>${opts.resume ? 'Continuar examen' : 'Iniciar examen'}</button></div></div>`;
      bindCancel();
      root.querySelector('#ok').onchange = e => root.querySelector('#start').disabled = !e.target.checked;
      root.querySelector('#start').onclick = async (e) => {
        e.target.disabled = true;
        await proctor.requestFullscreen();
        let payload = opts.resume;
        try {
          if (!payload) payload = await api.startAttempt(state.sid, { mode: opts.mode, secure: !!(useProctor || opts.strict) });
          else payload = await api.activeAttempt(state.sid, opts.mode) || payload;
        } catch (err) { e.target.disabled = false; toast(errMsg(err), 'bad'); return; }
        if (payload && payload.expired) { await cleanup(); toast('El examen ya había concluido por tiempo.', 'warn'); nav('#/resultado/' + payload.attempt_id); return; }
        runExam(payload, { proctor: useProctor ? proctor : null, strict: opts.strict });
      };
    }
  };
  render();
}

// ---------- Ejecución del examen ----------
function runExam(payload, { proctor, strict }) {
  state.inExam = true;
  document.body.classList.add('exam-mode');
  const root = document.getElementById('app');
  const items = payload.items;
  const total = items.length;
  const ans = {}; items.forEach(it => ans[it.pos] = { chosen: it.chosen || null, marked: !!it.marked });
  let idx = Math.max(0, items.findIndex(it => !it.chosen)); if (idx < 0) idx = 0;
  let incidents = payload.incidents || 0;
  const offset = Date.now() - new Date(payload.server_now).getTime();
  const deadline = new Date(payload.started_at).getTime() + (payload.time_limit_sec || 0) * 1000;
  const remaining = () => (deadline - (Date.now() - offset)) / 1000;
  let finished = false, timerT = null, warned = {};
  const pending = new Map(); let saving = false;
  const name = state.profile?.full_name || state.user?.email || 'Sustentante';

  root.innerHTML = `<div class="exam-shell">
    <div class="exam-top">
      <div class="who"><div class="photo">${proctor?.photo ? `<img src="${proctor.photo}" alt="">` : 'FOTO'}</div><div><b>${esc(name)}</b><span>Folio ${esc(state.profile?.folio || '')} · ${esc(MODES[payload.mode])}</span></div></div>
      <div class="mid"><div id="qpos"></div><div id="savestate" class="small">Respuestas guardadas</div></div>
      ${proctor ? '<span class="rec">Supervisión activa</span>' : ''}
      <div class="timer" id="timer">--:--:--</div>
    </div>
    <div class="exam-body">
      <div class="exam-q" id="q"></div>
      <div class="exam-side">
        ${proctor ? `<div class="panel"><div class="cam"><video id="pv" autoplay muted playsinline></video><span class="tag">Cámara</span></div><div class="meter" style="margin-top:8px"><i id="pm"></i></div></div>` : ''}
        <div class="panel"><div class="row between" style="margin-bottom:8px"><b>Reactivos</b><span class="small muted" id="cnt"></span></div><div class="navgrid" id="grid"></div>
          <div class="navlegend"><span><i style="background:#dbe8f5;border-color:#a9c3de"></i>Respondido</span><span><i style="background:#fdf0d7;border-color:#e3bf78"></i>Marcado</span><span><i></i>Sin responder</span><span><i style="outline:2px solid #163a5f"></i>Actual</span></div></div>
        <div class="panel small"><b>Incidencias:</b> <span id="inc">${incidents}</span>${strict ? ` de ${CONFIG.maxIncidents}` : ''}<div class="muted" style="margin-top:4px">Cambiar de ventana, salir de pantalla completa o hacer ruido se registra.</div></div>
        <button class="btn sm ghost" id="pause">Salir y continuar después</button>
        <button class="btn sm ghost" id="exbug">⚑ Reportar una falla</button>
      </div>
    </div>
    <div class="exam-foot"><button class="btn" id="prev">← Anterior</button>
      <div class="row"><button class="btn" id="mark">Marcar para revisión</button><button class="btn danger" id="finish">Finalizar examen</button></div>
      <button class="btn primary" id="next">Siguiente →</button></div>
  </div>`;
  if (proctor) proctor.attach(root.querySelector('#pv'));
  const $ = s => root.querySelector(s);

  const renderGrid = () => {
    $('#grid').innerHTML = items.map((it, i) => `<button class="${ans[it.pos].chosen ? 'ans' : ''} ${ans[it.pos].marked ? 'mark' : ''} ${i === idx ? 'cur' : ''}" data-i="${i}" title="Reactivo ${i + 1}">${i + 1}</button>`).join('');
    const n = Object.values(ans).filter(a => a.chosen).length;
    $('#cnt').textContent = `${n}/${total}`;
    $('#grid').querySelectorAll('button').forEach(b => b.onclick = () => { idx = +b.dataset.i; renderQ(); });
  };
  const renderQ = () => {
    const it = items[idx];
    state.currentQuestion = it.id;
    $('#qpos').textContent = `Reactivo ${idx + 1} de ${total}`;
    $('#q').innerHTML = `<div class="qhead"><b>Reactivo ${idx + 1}</b>${ans[it.pos].marked ? '<span class="chip warn">Marcado para revisión</span>' : ''}</div>${questionHTML(it, { chosen: ans[it.pos].chosen })}`;
    $('#q').querySelectorAll('.opt').forEach(b => b.onclick = () => choose(b.dataset.k));
    $('#prev').disabled = idx === 0;
    $('#next').textContent = idx === total - 1 ? 'Ir al resumen →' : 'Siguiente →';
    $('#mark').textContent = ans[it.pos].marked ? 'Quitar marca' : 'Marcar para revisión';
    renderGrid();
    $('#q').scrollTop = 0; window.scrollTo(0, 0);
  };
  const setSave = (t, cls = '') => { const s = $('#savestate'); if (s) { s.textContent = t; s.style.color = cls === 'bad' ? '#ffb3b3' : cls === 'warn' ? '#ffd28a' : '#c5d3e2'; } };
  const flush = async () => {
    if (saving || !pending.size) return;
    saving = true; setSave('Guardando…', 'warn');
    for (const [pos, a] of [...pending]) {
      try { await api.saveAnswer(state.sid, payload.attempt_id, pos, a.chosen, a.marked); pending.delete(pos); }
      catch (e) {
        const c = errCode(e);
        if (c === 'SESSION_REPLACED' || c === 'NOT_APPROVED') { saving = false; return; }
        if (c === 'TIME_OVER' || c === 'ATTEMPT_CLOSED') { pending.clear(); saving = false; finish(true); return; }
        setSave('Sin conexión: se reintentará', 'bad'); saving = false; setTimeout(flush, 4000); return;
      }
    }
    saving = false; setSave('Respuestas guardadas');
  };
  const choose = (k) => {
    if (finished) return;
    const it = items[idx];
    ans[it.pos].chosen = k;
    pending.set(it.pos, { ...ans[it.pos] });
    renderQ(); flush();
  };
  $('#prev').onclick = () => { if (idx > 0) { idx--; renderQ(); } };
  $('#next').onclick = () => { if (idx < total - 1) { idx++; renderQ(); } else summary(); };
  $('#mark').onclick = () => { const it = items[idx]; ans[it.pos].marked = !ans[it.pos].marked; pending.set(it.pos, { ...ans[it.pos] }); renderQ(); flush(); };
  $('#finish').onclick = () => summary();
  $('#exbug').onclick = () => window.dispatchEvent(new CustomEvent('simad:bug'));
  $('#pause').onclick = async () => {
    if (!await confirmDialog('Salir del examen', 'Tus respuestas están guardadas, pero el tiempo seguirá corriendo. Podrás continuar desde la sección Examen.', 'Salir', 'danger')) return;
    await flush(); teardown(); nav('#/examen');
  };
  const keyNav = (e) => {
    if (document.querySelector('.modal-bg,.overlay')) return;
    if (e.key === 'ArrowRight') $('#next').click();
    else if (e.key === 'ArrowLeft') $('#prev').click();
    else if (['a', 'b', 'c'].includes((e.key || '').toLowerCase()) && !e.ctrlKey && !e.metaKey && !e.altKey) choose(e.key.toUpperCase());
  };
  window.addEventListener('keydown', keyNav);
  window.addEventListener('online', flush);

  const summary = () => {
    const unanswered = items.map((it, i) => !ans[it.pos].chosen ? i + 1 : null).filter(Boolean);
    const marked = items.map((it, i) => ans[it.pos].marked ? i + 1 : null).filter(Boolean);
    const m = modal({ title: 'Resumen antes de enviar', wide: true, body: `
      <div class="grid g3"><div class="card stat"><div class="label">Respondidos</div><div class="value">${total - unanswered.length}</div></div>
      <div class="card stat"><div class="label">Sin responder</div><div class="value">${unanswered.length}</div></div>
      <div class="card stat"><div class="label">Marcados</div><div class="value">${marked.length}</div></div></div>
      ${unanswered.length ? `<p style="margin-top:14px"><b>Sin responder:</b> ${unanswered.map(n => `<a href="#" data-go="${n}">${n}</a>`).join(', ')}</p>` : ''}
      ${marked.length ? `<p><b>Marcados:</b> ${marked.map(n => `<a href="#" data-go="${n}">${n}</a>`).join(', ')}</p>` : ''}
      <p class="muted">Tiempo restante: <b>${fmtTime(remaining())}</b>. Una vez enviado no podrás modificar tus respuestas.</p>`,
      actions: [{ label: 'Volver al examen', value: false }, { label: 'Enviar respuestas', cls: 'primary', onClick: () => { finish(false); } }] });
    m.el.querySelectorAll('[data-go]').forEach(a => a.onclick = (e) => { e.preventDefault(); idx = +a.dataset.go - 1; m.close(); renderQ(); });
  };

  const overlay = (html) => { let o = document.getElementById('ex-ov'); if (!o) { o = document.createElement('div'); o.id = 'ex-ov'; o.className = 'overlay'; document.body.appendChild(o); } o.innerHTML = `<div class="box">${html}</div>`; return o; };
  const closeOverlay = () => document.getElementById('ex-ov')?.remove();

  const teardown = () => {
    finished = true; state.inExam = false; clearInterval(timerT);
    window.removeEventListener('keydown', keyNav); window.removeEventListener('online', flush);
    closeOverlay(); document.body.classList.remove('exam-mode');
    if (proctor) proctor.stop();
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  };

  const finish = async (byTime, annul = false) => {
    if (finished) return;
    finished = true; clearInterval(timerT);
    if (proctor) proctor.disarm();
    overlay(`<h2>${annul ? 'Evaluación anulada' : byTime ? 'El tiempo ha concluido' : 'Sincronización final'}</h2><div class="spinner" style="margin:16px 0"></div><p class="muted" id="syncmsg">Enviando tus respuestas. No cierres el navegador.</p>`);
    for (let i = 0; i < 3 && pending.size; i++) { saving = false; await flush(); }
    let res = null;
    for (let i = 0; i < 4 && !res; i++) {
      try { res = await api.submitAttempt(state.sid, payload.attempt_id, annul); }
      catch (e) { if (['ATTEMPT_CLOSED', 'NOT_FOUND'].includes(errCode(e))) break; await new Promise(r => setTimeout(r, 2500)); }
    }
    overlay(`<h2>${annul ? 'Evaluación anulada' : 'Tus respuestas se enviaron con éxito'}</h2>
      <p>${annul ? `Se acumularon ${incidents} incidencias. En la evaluación real esto podría anular tu aplicación. Revisa tu reporte para saber qué las provocó.` : 'La sincronización final concluyó correctamente. Ya puedes cerrar la aplicación o consultar tus resultados.'}</p>
      ${res ? `<p class="muted">Aciertos: <b>${res.correct}/${res.total}</b> (${res.score}%) · Tiempo: <b>${fmtTime(res.elapsed_sec)}</b></p>` : '<p class="muted">Si no ves tus resultados, revisa tu historial en unos minutos.</p>'}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="seeres">Ver resultados</button></div>`);
    document.getElementById('seeres').onclick = () => { teardown(); nav('#/resultado/' + payload.attempt_id); };
  };

  const tick = () => {
    const r = remaining();
    const el = $('#timer');
    if (!el) return;
    el.textContent = fmtTime(r);
    el.className = 'timer' + (r < 300 ? ' crit' : r < 1800 ? ' warn' : '');
    for (const w of [1800, 600, 300]) if (r <= w && r > w - 2 && !warned[w]) { warned[w] = 1; toast(`Quedan ${w / 60} minutos.`, 'warn'); }
    if (r <= 0 && !finished) finish(true);
    if (proctor) { const pm = $('#pm'); if (pm) pm.style.width = Math.round(proctor.level() * 100) + '%'; }
  };

  const incident = async (type, detail) => {
    if (finished) return;
    incidents++;
    $('#inc').textContent = incidents;
    const f = document.createElement('div'); f.className = 'incident-flash'; f.textContent = `Incidencia registrada: ${INCIDENT_LABELS[type] || type}`;
    document.body.appendChild(f); setTimeout(() => f.remove(), 3800);
    try { await api.logIncident(state.sid, payload.attempt_id, type, detail); } catch (e) { }
    if (strict && incidents >= CONFIG.maxIncidents) finish(false, true);
  };

  if (proctor || strict) {
    const p = proctor || new Proctor();
    if (!proctor) proctor = p;
    p.arm({
      onIncident: incident,
      onFullscreenLost: () => {
        if (finished) return;
        overlay(`<h2>Regresa a pantalla completa</h2><p>Saliste de la pantalla completa. Esto se registró como incidencia. Para continuar, vuelve a pantalla completa.</p><button class="btn primary" id="fsback">Volver a pantalla completa</button>`);
        document.getElementById('fsback').onclick = async () => { await p.requestFullscreen(); };
      },
      onFullscreenBack: () => closeOverlay(),
      monitorMedia: !!p.stream
    });
  }
  if (!document.fullscreenElement && (proctor)) {
    overlay(`<h2>Pantalla completa</h2><p>El examen se presenta en pantalla completa.</p><button class="btn primary" id="fsback">Entrar a pantalla completa</button>`);
    document.getElementById('fsback').onclick = async () => { await proctor.requestFullscreen(); closeOverlay(); };
  }
  renderQ(); tick(); timerT = setInterval(tick, 1000);
}

// ---------- Práctica con retroalimentación inmediata ----------
export async function practiceSetup(root) {
  root.innerHTML = `<div class="page-head"><div><div class="crumb">Práctica</div><h1>Práctica guiada</h1>
    <p class="muted">Responde y recibe de inmediato la respuesta correcta, la argumentación y la referencia para estudiar.</p></div></div>
    <div class="grid g2"><div class="card pad-lg"><h2>Elige qué practicar</h2>
      <label class="field"><span>Subárea</span><select id="sub"><option value="">Todas las subáreas (mezcla)</option>${Object.entries(SUBAREAS).map(([k, v]) => `<option value="${k}">${k} · ${esc(v.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Número de reactivos</span><select id="n"><option>5</option><option selected>10</option><option>15</option><option>20</option><option>30</option></select></label>
      <label class="check" id="errbox"><input type="checkbox" id="err"><div><b>Repasar mis errores</b><br><span class="small muted" id="errhint">Solo reactivos que respondiste mal en intentos anteriores.</span></div></label>
      <div class="row" style="margin-top:16px"><button class="btn primary lg" id="go">Comenzar práctica</button></div></div>
      <div class="card pad-lg"><h2>Cómo funciona</h2><ul class="small" style="padding-left:18px;line-height:1.75">
        <li>Los reactivos se eligen priorizando los que aún no has visto y los que fallaste.</li>
        <li>Las opciones se presentan en orden distinto cada vez.</li>
        <li>Cada respuesta muestra por qué es correcta y por qué las otras no, como en las argumentaciones de la Guía oficial.</li>
        <li>Tu tiempo y porcentaje de aciertos quedan registrados en tu historial y calendario.</li></ul>
        <a class="btn" href="#/estudio">Ir a las fichas de estudio</a></div></div>`;
  // "Repasar mis errores" solo se activa si hay respuestas incorrectas en la subárea elegida
  let wrong = null;
  const sub = root.querySelector('#sub'), err = root.querySelector('#err'), hint = root.querySelector('#errhint'), box = root.querySelector('#errbox');
  const refresh = () => {
    if (!wrong) return;
    const k = sub.value;
    const n = k ? (wrong[k] || 0) : Object.values(wrong).reduce((a, b) => a + b, 0);
    err.disabled = n === 0;
    if (n === 0) err.checked = false;
    box.style.opacity = n === 0 ? '.6' : '';
    box.style.cursor = n === 0 ? 'default' : '';
    hint.textContent = n === 0
      ? (k ? `Aún no tienes reactivos fallados en la subárea ${k}. Esta opción se activa cuando respondas alguno mal.` : 'Aún no tienes reactivos fallados. Esta opción se activa cuando respondas alguno mal.')
      : `Tienes reactivos fallados por repasar${k ? ' en esta subárea' : ''}. Solo se usarán esos.`;
  };
  sub.onchange = refresh;
  api.myStats().then(st => {
    wrong = {};
    for (const [k, v] of Object.entries(st?.by_subarea || {})) wrong[k] = Math.max(0, (v.total || 0) - (v.correct || 0));
    refresh();
  }).catch(() => { });
  root.querySelector('#go').onclick = async (e) => {
    e.target.disabled = true;
    const focus = err.checked ? 'errores' : null;
    try {
      const p = await api.startAttempt(state.sid, { mode: 'practica', subarea: sub.value || null, count: +root.querySelector('#n').value, focus, secure: false });
      runPractice(root, p);
    } catch (ex) {
      e.target.disabled = false;
      if (focus && errCode(ex) === 'NO_QUESTIONS') toast('No tienes reactivos fallados con ese filtro. Desmarca «Repasar mis errores» para practicar con reactivos nuevos.', 'warn');
      else toast(errMsg(ex), 'bad');
    }
  };
}

export async function practiceDoc(root, docId) {
  root.innerHTML = loadingHTML('Preparando reactivos de este documento…');
  try { const p = await api.startAttempt(state.sid, { mode: 'practica', doc: docId, count: 10, secure: false }); runPractice(root, p, docId); }
  catch (e) { root.innerHTML = `<div class="card"><p>${esc(errMsg(e))}</p><a class="btn" href="#/estudio/${esc(docId)}">Volver a la ficha</a></div>`; }
}

export function runPractice(root, payload, docId = null) {
  const items = payload.items; const total = items.length;
  let idx = 0; const results = {}; const t0 = Date.now();
  const render = () => {
    const it = items[idx]; const res = results[it.pos];
    state.currentQuestion = it.id;
    const done = Object.keys(results).length, okN = Object.values(results).filter(r => r.is_correct).length;
    root.innerHTML = `<div class="page-head"><div><div class="crumb">Práctica${docId ? ' · ficha ' + esc(docId) : payload.filter_subarea ? ' · subárea ' + esc(payload.filter_subarea) : ''}</div><h1>Reactivo ${idx + 1} de ${total}</h1></div>
      <div class="row"><span class="chip">${done} ${done === 1 ? 'respondido' : 'respondidos'}</span><span class="chip ok">${okN} ${okN === 1 ? 'correcto' : 'correctos'}</span><button class="btn sm" id="end">Terminar práctica</button></div></div>
      <div class="bar" style="margin-bottom:16px"><i style="width:${pct(done, total)}%"></i></div>
      <div class="card pad-lg"><div class="row" style="margin-bottom:12px"><span class="chip gold">Subárea ${esc(it.subarea)}</span><span class="chip gray">${esc(FORMATS[it.format])}</span></div>
      ${questionHTML(it, { chosen: res?.chosen, result: res, disabled: !!res })}
      <div id="fb">${res ? feedbackHTML(res) : ''}</div>
      <div class="row between" style="margin-top:18px"><button class="btn" id="prev" ${idx === 0 ? 'disabled' : ''}>← Anterior</button>
      <button class="btn primary" id="next" ${res ? '' : 'disabled'}>${idx === total - 1 ? 'Ver resultados' : 'Siguiente →'}</button></div></div>`;
    root.querySelectorAll('.opt').forEach(b => b.onclick = async () => {
      if (results[it.pos]) return;
      root.querySelectorAll('.opt').forEach(x => x.disabled = true);
      try {
        const r = await api.answerPractice(state.sid, payload.attempt_id, it.pos, b.dataset.k);
        results[it.pos] = r; render();
      } catch (e) { toast(errMsg(e), 'bad'); root.querySelectorAll('.opt').forEach(x => x.disabled = false); }
    });
    root.querySelector('#prev').onclick = () => { idx--; render(); };
    root.querySelector('#next').onclick = () => { if (idx < total - 1) { idx++; render(); } else end(); };
    root.querySelector('#end').onclick = async () => { if (await confirmDialog('Terminar práctica', 'Se calificarán solo los reactivos que respondiste.', 'Terminar')) end(); };
    window.scrollTo(0, 0);
  };
  const end = async () => {
    try {
      const r = await api.submitAttempt(state.sid, payload.attempt_id, false);
      if (!Object.keys(results).length || r?.status === 'abandoned') { toast('No respondiste ningún reactivo, así que la práctica no se registró.', 'warn'); nav('#/practica'); return; }
      nav('#/resultado/' + payload.attempt_id);
    }
    catch (e) { toast(errMsg(e), 'bad'); }
  };
  render();
}

// ---------- Resultados y revisión ----------
export async function resultsView(root, id) {
  root.innerHTML = loadingHTML('Calculando resultados…');
  let data;
  try { data = await api.review(id); } catch (e) { root.innerHTML = `<div class="card"><p>${esc(errMsg(e))}</p><a class="btn" href="#/historial">Ir al historial</a></div>`; return; }
  const a = data.attempt, items = data.items;
  const answered = items.filter(i => i.chosen).length;
  const p = Math.round(a.score || 0);
  const bd = a.breakdown || {};
  const subRows = Object.keys(SUBAREAS).filter(k => bd.subarea?.[k]).map(k => { const s = bd.subarea[k]; const v = pct(s.correct, s.total); return `<div class="subarea-row"><span class="code">${k}</span><div><div class="name">${esc(SUBAREAS[k].name)}</div><div class="bar ${levelClass(v)}"><i style="width:${v}%"></i></div></div><span class="pct">${s.correct}/${s.total}</span></div>`; }).join('');
  const areaRows = Object.keys(AREAS).filter(k => bd.area?.[k]).map(k => { const s = bd.area[k]; const v = pct(s.correct, s.total); return `<div class="subarea-row"><span class="code">Área ${k}</span><div><div class="name">${esc(AREAS[k])}</div><div class="bar ${levelClass(v)}"><i style="width:${v}%"></i></div></div><span class="pct">${v}%</span></div>`; }).join('');
  const fmtRows = Object.keys(FORMATS).filter(k => bd.format?.[k]).map(k => { const s = bd.format[k]; const v = pct(s.correct, s.total); return `<div class="subarea-row" style="grid-template-columns:1fr 1fr 64px"><span>${esc(FORMATS[k])}</span><div class="bar ${levelClass(v)}"><i style="width:${v}%"></i></div><span class="pct">${s.correct}/${s.total}</span></div>`; }).join('');
  const incs = Array.isArray(a.incidents) ? a.incidents : [];
  const weakest = Object.keys(SUBAREAS).filter(k => bd.subarea?.[k]).sort((x, y) => pct(bd.subarea[x].correct, bd.subarea[x].total) - pct(bd.subarea[y].correct, bd.subarea[y].total))[0];
  const perItem = answered ? (a.elapsed_sec || 0) / answered : 0;

  root.innerHTML = `
  <div class="page-head"><div><div class="crumb"><a href="#/historial">Historial</a> · Resultado</div><h1>${esc(MODES[a.mode])}${a.filter_subarea ? ' · subárea ' + esc(a.filter_subarea) : ''}</h1>
  <p class="muted">${fmtDate(a.started_at, true)} · ${esc(STATUS[a.status] || a.status)}</p></div>
  <div class="row"><button class="btn" id="print">Descargar constancia</button>${weakest ? `<button class="btn primary" id="weak">Practicar mi subárea más débil (${weakest})</button>` : ''}</div></div>
  ${a.status === 'annulled' ? `<div class="notice bad" style="margin-bottom:16px"><b>Simulacro anulado por incidencias.</b> En la evaluación real, estas conductas pueden bloquear o anular tu aplicación. Revisa la lista de incidencias abajo.</div>` : ''}
  <div class="grid g3">
    <div class="card pad-lg row" style="gap:22px;flex-wrap:nowrap;align-items:center">${ring(p, 124)}<div><div class="stat" style="padding:0"><div class="label">Aciertos</div><div class="value">${a.correct ?? 0} / ${a.total}</div><div class="sub">${answered} respondidos · ${a.total - answered} sin responder</div></div></div></div>
    <div class="card stat"><div class="label">Tiempo empleado</div><div class="value">${fmtTime(a.elapsed_sec)}</div><div class="sub">${[a.time_limit_sec ? 'de ' + fmtTime(a.time_limit_sec) + ' disponibles' : '', perItem ? 'promedio ' + fmtDur(perItem) + ' por reactivo' : ''].filter(Boolean).join(' · ')}</div></div>
    <div class="card stat"><div class="label">Incidencias</div><div class="value">${incs.length}</div><div class="sub">${a.mode === 'practica' ? 'No aplica en práctica' : incs.length ? 'Revisa el detalle abajo' : 'Sin incidencias registradas'}</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h3>Resultados por subárea</h3></div>${subRows || '<div class="empty">Sin datos</div>'}</div>
    <div class="card"><div class="card-head"><h3>Por área y formato</h3></div>${areaRows}<div class="divider"></div>${fmtRows}</div>
  </div>
  ${incs.length ? `<div class="card" style="margin-top:16px"><h3>Incidencias registradas</h3><div class="table-wrap"><table class="t"><tr><th>Hora</th><th>Tipo</th><th>Detalle</th></tr>${incs.map(i => `<tr><td>${fmtDate(i.at, true)}</td><td>${esc(INCIDENT_LABELS[i.type] || i.type)}</td><td>${esc(i.detail || '')}</td></tr>`).join('')}</table></div></div>` : ''}
  <div class="card" style="margin-top:16px"><div class="card-head"><h3>Revisión de reactivos</h3></div>
    <div class="tabs" id="rtabs"><button data-f="all">Todos (${items.length})</button><button data-f="bad" class="on">Incorrectos (${items.filter(i => i.chosen && !i.is_correct).length})</button><button data-f="none">Sin responder (${items.filter(i => !i.chosen).length})</button><button data-f="mark">Marcados (${items.filter(i => i.marked).length})</button><button data-f="ok">Correctos (${items.filter(i => i.is_correct).length})</button></div>
    <div id="rlist"></div></div>
  <div class="print-area print-only" id="constancia"></div>`;

  const list = root.querySelector('#rlist');
  const showList = (f) => {
    const sel = items.filter(i => f === 'all' || (f === 'bad' && i.chosen && !i.is_correct) || (f === 'none' && !i.chosen) || (f === 'mark' && i.marked) || (f === 'ok' && i.is_correct));
    list.innerHTML = sel.length ? sel.map(it => `<div class="review-item"><div class="qhead"><b>Reactivo ${it.pos}</b><span class="chip gold">${esc(it.subarea)}</span><span class="chip gray">${esc(FORMATS[it.format])}</span>${it.is_correct ? '<span class="chip ok">Correcto</span>' : it.chosen ? '<span class="chip bad">Incorrecto</span>' : '<span class="chip warn">Sin responder</span>'}<span class="small faint">${esc(it.id)}</span></div>
      ${questionHTML(it, { chosen: it.chosen, result: { correct: it.correct }, disabled: true })}
      <div class="feedback ${it.is_correct ? 'ok' : 'bad'}"><b>Respuesta correcta: ${esc(it.correct)}.</b> ${esc(it.rationale)}<div class="ref"><b>Referencia:</b> ${esc(it.reference || '—')} ${(it.docs || []).map(d => `· <a href="#/estudio/${esc(d)}">Ficha ${esc(d)}</a>`).join(' ')}</div></div></div>`).join('') : '<div class="empty">No hay reactivos en este filtro.</div>';
  };
  const firstF = items.some(i => i.chosen && !i.is_correct) ? 'bad' : 'all';
  root.querySelectorAll('#rtabs button').forEach(x => x.classList.toggle('on', x.dataset.f === firstF));
  showList(firstF);
  root.querySelectorAll('#rtabs button').forEach(b => b.onclick = () => { root.querySelectorAll('#rtabs button').forEach(x => x.classList.remove('on')); b.classList.add('on'); showList(b.dataset.f); });
  if (weakest) root.querySelector('#weak').onclick = async () => { try { const pp = await api.startAttempt(state.sid, { mode: 'practica', subarea: weakest, count: 10, secure: false }); runPractice(root, pp); } catch (e) { toast(errMsg(e), 'bad'); } };
  root.querySelector('#print').onclick = () => {
    const c = root.querySelector('#constancia');
    c.innerHTML = `<div style="font-family:Georgia,serif;padding:40px;max-width:720px;margin:auto;border:2px solid #163a5f">
      <div style="text-align:center;border-bottom:2px solid #9a7432;padding-bottom:12px;margin-bottom:20px"><div style="font-size:22px;font-weight:700;color:#163a5f">Constancia de participación en simulacro</div><div style="font-size:13px;color:#555">${esc(CONFIG.appName)} · Documento de práctica sin validez oficial</div></div>
      <p>Se hace constar que <b>${esc(state.profile?.full_name || state.user?.email || '')}</b>, con folio de práctica <b>${esc(state.profile?.folio || '')}</b>, presentó un <b>${esc(MODES[a.mode].toLowerCase())}</b> el ${fmtDate(a.started_at, true)}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${[['Reactivos', a.total], ['Aciertos', `${a.correct ?? 0} (${p}%)`], ['Tiempo empleado', fmtTime(a.elapsed_sec)], ['Estado', STATUS[a.status] || a.status], ['Incidencias', incs.length]].map(r => `<tr><td style="border:1px solid #ccc;padding:8px;width:40%"><b>${r[0]}</b></td><td style="border:1px solid #ccc;padding:8px">${esc(String(r[1]))}</td></tr>`).join('')}</table>
      <p style="font-size:12px;color:#666">Folio del intento: ${esc(a.id)}</p></div>`;
    window.print();
  };
}
