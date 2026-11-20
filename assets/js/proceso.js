// Proceso de admisión 2027-2028: calendario oficial, requisitos, calculadora de puntaje y plan de estudio.
// Fuente: Acuerdo de admisión en educación básica, ciclo escolar 2027-2028 (USICAMM, 17 de noviembre de 2026).
import { api } from './api.js?v=1.4.1';
import { state } from './state.js?v=1.4.1';
import { esc, toast, loadingHTML, errMsg, confirmDialog, SUBAREAS, localISO, monthName } from './ui.js?v=1.4.1';

export const CICLO = '2027-2028';
export const EXAM_DATE = '2027-05-15';
export const EXAM_DAYS = ['2027-05-15', '2027-05-16'];
export const EXAM_LABEL = '15 y 16 de mayo de 2027';
const PLAN_ANCHOR = '2026-11-16';

// Anexo I del Acuerdo
export const OFFICIAL = [
  { k: 'acuerdo', from: '2026-11-17', short: 'Acuerdo', label: 'Publicación del Acuerdo de admisión 2027-2028' },
  { k: 'conv', from: '2027-01-29', short: 'Convocatoria', label: 'Publicación de la convocatoria de tu estado' },
  { k: 'citas', from: '2027-02-08', to: '2027-02-14', short: 'Citas', label: 'Generación de la cita para tu registro (Proyecto Venus)' },
  { k: 'registro', from: '2027-02-15', to: '2027-03-17', short: 'Registro', label: 'Registro y verificación documental' },
  { k: 'curso', from: '2027-04-05', to: '2027-05-04', short: 'Curso NEM', label: 'Curso de habilidades docentes y digitales para la Nueva Escuela Mexicana' },
  { k: 'examen', from: '2027-05-15', to: '2027-05-16', short: 'Examen', label: 'Apreciación de conocimientos y aptitudes (el examen)' },
  { k: 'resultados', from: '2027-06-04', short: 'Resultados', label: 'Consulta de resultados' },
  { k: 'listado', from: '2027-07-16', short: 'Listado', label: 'Publicación del listado nominal ordenado de resultados' },
  { k: 'asignacion', from: '2027-07-18', short: 'Asignación', label: 'Eventos públicos de asignación de plazas (a partir de esta fecha)' }
];

// ---------- Fechas ----------
const dt = (iso) => new Date(iso + 'T12:00:00');
const addDays = (iso, n) => { const d = dt(iso); d.setDate(d.getDate() + n); return localISO(d); };
export function daysUntil(iso) { return Math.round((dt(iso) - dt(localISO())) / 86400000); }
function monday(iso) { const d = dt(iso); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return localISO(d); }
export function fmtLong(iso, year = true) { const d = dt(iso); return `${d.getDate()} de ${monthName(d.getMonth())}${year ? ' de ' + d.getFullYear() : ''}`; }
export function fmtRange(from, to) {
  if (!to || to === from) return fmtLong(from);
  const a = dt(from), b = dt(to);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${b.getDate() - a.getDate() === 1 ? 'y' : 'al'} ${b.getDate()} de ${monthName(b.getMonth())} de ${b.getFullYear()}`;
  return `${fmtLong(from, a.getFullYear() !== b.getFullYear())} al ${fmtLong(to)}`;
}
function fmtShort(iso) { const d = dt(iso); return `${d.getDate()} ${monthName(d.getMonth()).slice(0, 3)}`; }
function inDays(n) { return n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`; }

// Fecha de examen que se usa en la app: la que registró la persona si es futura; si no, la oficial
export function examDateFor(p) {
  const today = localISO();
  if (p?.exam_date && p.exam_date >= today) return { date: p.exam_date, official: EXAM_DAYS.includes(p.exam_date), custom: !EXAM_DAYS.includes(p.exam_date) };
  return { date: EXAM_DATE, official: true, custom: false, auto: true };
}
export function eventStatus(ev, today = localISO()) {
  const end = ev.to || ev.from;
  if (end < today) return 'past';
  if (ev.from <= today) return 'now';
  return 'next';
}
export function nextEvent(today = localISO()) { return OFFICIAL.find(ev => ev.k !== 'acuerdo' && eventStatus(ev, today) !== 'past') || null; }
export function officialOn(k) { return OFFICIAL.filter(ev => ev.k !== 'acuerdo' && k >= ev.from && k <= (ev.to || ev.from)); }

export function timelineHTML(compact = false) {
  const today = localISO();
  return `<ol class="tl${compact ? ' compact' : ''}">${OFFICIAL.map(ev => {
    const st = ev.k === 'acuerdo' && ev.from <= today ? 'past' : eventStatus(ev, today);
    const n = daysUntil(ev.from);
    const tag = ev.k === 'acuerdo' && st === 'past' ? '<span class="chip gray">Publicado</span>' : st === 'past' ? '<span class="chip gray">Concluido</span>' : st === 'now' ? '<span class="chip ok">En curso</span>' : `<span class="chip ${ev.k === 'examen' ? 'bad' : ''}">${inDays(n)}</span>`;
    return `<li class="${st}${ev.k === 'examen' ? ' exam' : ''}"><div class="tl-date">${esc(fmtRange(ev.from, ev.to))}</div><div class="tl-body"><b>${esc(ev.label)}</b> ${tag}</div></li>`;
  }).join('')}</ol>`;
}

// ---------- Puntaje (Anexo III) ----------
const trunc2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
export const FDP_OPTS = [
  { v: 'a', t: 'Con la licenciatura con la que participo', d: 'De una Normal pública, CAM, UPN o Universidad para el Bienestar con formación docente', pts: 15 },
  { v: 'b', t: 'Con la licenciatura con la que participo', d: 'De una Normal particular u otra institución pública o particular', pts: 10 },
  { v: 'c', t: 'Con otra licenciatura o un posgrado', d: 'Afín al área docente pedagógica (Normal particular u otra institución)', pts: 5 },
  { v: 'n', t: 'No la acredito', d: 'Sin estudios afines al área docente pedagógica', pts: 0 }
];
export const PROM_TEXT = { suficiente: 17.21, satisfactorio: 19.56, sobresaliente: 21.71 };
export function ptsPromedio(tipo, valor) {
  if (tipo && tipo !== 'num') return PROM_TEXT[tipo] || 0;
  const p = Math.round(Number(valor) * 100) / 100;
  if (!isFinite(p) || p < 6) return 0;
  return Math.round((5 * Math.min(10, p) - 25) * 100) / 100;
}
export function ptsCursos(horas) {
  const h = Math.floor(Number(horas) || 0);
  if (h < 20) return 0;
  if (h >= 200) return 10;
  return trunc2((h + 40) / 24);
}
export function ptsMeses(meses) {
  const m = Math.floor(Number(meses) || 0);
  if (m < 1) return 0;
  return Math.min(20, 5 + 0.25 * m);
}
export function ptsExperiencia({ practica, meses, inea }) {
  const base = Math.max(practica ? 10 : 0, ptsMeses(meses));
  const extra = inea === 'rural' ? 3 : inea === 'si' ? 2 : 0;
  return Math.min(20, base + extra);
}
export function ptsExamen(pct) { const v = Math.max(0, Math.min(100, Number(pct) || 0)); return Math.round(v * 30) / 100; }
export function fmtPts(x) { return (Math.round(x * 100) / 100).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }

const CALC_KEY = 'simad_calc_v1';
function loadCalc() { try { return JSON.parse(localStorage.getItem(CALC_KEY) || 'null') || {}; } catch (e) { return {}; } }
function saveCalc(v) { try { localStorage.setItem(CALC_KEY, JSON.stringify(v)); } catch (e) { } }

// ---------- Plan de estudio ----------
const SUB_ORDER = Object.keys(SUBAREAS);
function planKey() { return 'simad_plan_start_' + (state.user?.id || ''); }
export function planStart(p) {
  try { const s = localStorage.getItem(planKey()); if (s) return monday(s); } catch (e) { }
  const created = p?.created_at ? localISO(p.created_at) : localISO();
  return monday(created > PLAN_ANCHOR ? created : PLAN_ANCHOR);
}
// Reparte cada ficha en una de sus subáreas, equilibrando las seis (primero las fichas de una sola subárea)
function assignSubareas(docs) {
  const load = Object.fromEntries(SUB_ORDER.map(k => [k, 0])), out = new Map();
  const subsOf = (d) => (d.subareas || []).filter(k => SUBAREAS[k]);
  [...docs].sort((a, b) => (subsOf(a).length || 9) - (subsOf(b).length || 9) || a.num - b.num).forEach(d => {
    const opts = subsOf(d).length ? subsOf(d) : ['1.1'];
    const k = opts.reduce((best, x) => load[x] < load[best] ? x : best, opts[0]);
    load[k]++; out.set(d.id, k);
  });
  return out;
}

export function buildPlan({ start, exam, docs, weakest }) {
  const s0 = monday(start), e0 = monday(exam);
  const N = Math.round((dt(e0) - dt(s0)) / (7 * 86400000)) + 1;
  if (N < 1) return null;
  const numbered = (docs || []).filter(d => d.num);
  const asg = assignSubareas(numbered);
  const primarySub = (d) => asg.get(d.id);
  const list = numbered.sort((a, b) => SUB_ORDER.indexOf(primarySub(a)) - SUB_ORDER.indexOf(primarySub(b)) || a.num - b.num);
  const guide = (docs || []).find(d => !d.num);
  let diag = 0, final = 0, rep = 0;
  if (N >= 10) { diag = 1; final = 2; rep = Math.max(2, Math.round(N * 0.12)); }
  else if (N >= 5) { diag = 1; final = 1; }
  const study = Math.max(0, N - 1 - diag - final - rep);
  const weeks = [];
  for (let i = 0; i < N; i++) {
    const from = addDays(s0, 7 * i), to = addDays(from, 6);
    let phase, title; const tasks = [];
    if (i === N - 1) {
      phase = 'examen'; title = 'Semana del examen';
      tasks.push({ t: 'Repaso ligero: lee solo el apartado «Para recordar» de las fichas; no empieces temas nuevos.', href: '#/estudio' });
      tasks.push({ t: 'Revisa tu computadora, cámara, micrófono e internet, y repasa las reglas de la aplicación en línea.', href: '#/guia' });
      tasks.push({ t: 'Ten a la mano tu folio, tu contraseña y tu INE. Descansa bien la noche anterior.' });
      if (study === 0 && list.length) tasks.unshift({ t: 'Repasa las fichas de estudio de las seis subáreas, empezando por tu subárea más débil.', href: '#/estudio' });
    } else if (i < diag) {
      phase = 'diagnostico'; title = 'Conoce tu punto de partida';
      tasks.push({ t: 'Presenta un simulacro completo para saber de dónde partes.', href: '#/examen' });
      if (guide) tasks.push({ t: `Lee la ficha «${guide.short || guide.title}» para conocer la estructura del examen.`, href: '#/estudio/' + guide.id, doc: guide.id });
      tasks.push({ t: 'Registra tus días de estudio y tu meta diaria en tu plan.', href: '#/calendario' });
      tasks.push({ t: 'Calcula tu puntaje final estimado con tus datos.', href: '#/proceso/puntaje' });
    } else if (i < diag + study) {
      const j = i - diag;
      const chunk = list.slice(Math.floor((j * list.length) / study), Math.floor(((j + 1) * list.length) / study));
      const subs = [...new Set(chunk.map(primarySub))];
      phase = 'estudio'; title = subs.length ? `Estudio · subárea ${subs.join(' y ')}` : 'Estudio';
      chunk.forEach(d => tasks.push({ t: `Estudia la ficha ${d.id} · ${d.short || d.title}`, href: '#/estudio/' + d.id, doc: d.id }));
      subs.slice(0, 2).forEach(k => tasks.push({ t: `Práctica guiada de la subárea ${k} (${SUBAREAS[k].name}): 20 reactivos.`, href: '#/practica/' + k }));
      tasks.push((j + 1) % 4 === 0 ? { t: 'Simulacro completo en condiciones reales: 90 reactivos en 4 horas.', href: '#/examen' } : { t: 'Simulacro corto de 30 reactivos para medir tu avance.', href: '#/examen' });
    } else if (i < diag + study + rep) {
      const r = i - diag - study;
      const subs = SUB_ORDER.filter((_, x) => Math.floor((x * rep) / SUB_ORDER.length) === r);
      phase = 'repaso'; title = `Repaso · ${subs.join(', ')}`;
      tasks.push({ t: 'Practica con «Repasar mis errores» hasta dejar en cero tus reactivos fallados.', href: '#/practica/errores' });
      subs.forEach(k => tasks.push({ t: `Vuelve al «Para recordar» de las fichas de la subárea ${k} y practica 20 reactivos.`, href: '#/practica/' + k }));
      if (weakest && r === 0) tasks.push({ t: `Refuerza tu subárea más débil: ${weakest} (${SUBAREAS[weakest]?.name || ''}).`, href: '#/practica/' + weakest });
      tasks.push({ t: 'Simulacro completo en condiciones reales.', href: '#/examen' });
    } else {
      phase = 'final'; title = 'Simulacros en condiciones reales';
      tasks.push({ t: 'Dos simulacros completos con cámara, micrófono y modo estricto, en el horario en que presentarás.', href: '#/examen' });
      tasks.push({ t: 'Revisa en cada resultado tus incidencias y tu tiempo promedio por reactivo.', href: '#/historial' });
      tasks.push({ t: 'Repasa los reactivos que marcaste o fallaste en los simulacros.', href: '#/practica/errores' });
    }
    // Trámites oficiales de esa semana
    const evs = OFFICIAL.filter(ev => ev.k !== 'acuerdo' && ev.k !== 'examen' && ev.from <= to && (ev.to || ev.from) >= from);
    const tramites = evs.map(ev => ({ t: TRAMITE[ev.k] ? TRAMITE[ev.k](ev) : `${ev.label}: ${fmtRange(ev.from, ev.to)}.`, href: '#/proceso', tramite: true }));
    weeks.push({ n: i + 1, from, to, phase, title, tasks, tramites });
  }
  return { N, weeks, start: s0 };
}
const TRAMITE = {
  conv: (ev) => `Lee la convocatoria de tu estado (${fmtLong(ev.from)}): plazas, perfiles profesionales y documentos que te pedirán.`,
  citas: (ev) => `Genera tu cita de registro en Proyecto Venus (${fmtRange(ev.from, ev.to)}).`,
  registro: (ev) => `Registro y verificación documental (${fmtRange(ev.from, ev.to)}): acude el día de tu cita con tus documentos originales.`,
  curso: (ev) => `Curso de habilidades docentes y digitales (${fmtRange(ev.from, ev.to)}): es requisito; resérvale tiempo esta semana.`,
  resultados: (ev) => `Consulta tus resultados (${fmtLong(ev.from)}).`
};

// ---------- Vista ----------
const TABS = [['', 'Fechas y requisitos'], ['puntaje', 'Calculadora de puntaje'], ['plan', 'Mi plan rumbo al examen']];
export async function processView(root, tab = '') {
  if (!TABS.some(t => t[0] === tab)) tab = '';
  const head = `<div class="page-head"><div><div class="crumb">Proceso ${CICLO}</div><h1>Proceso de admisión ${CICLO}</h1>
    <p class="muted">Educación Primaria · Con base en el Acuerdo que publicó la USICAMM el 17 de noviembre de 2026.</p></div></div>
    <div class="tabs">${TABS.map(([k, t]) => `<a href="#/proceso${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</div><div id="pv"></div>`;
  root.innerHTML = head;
  const box = root.querySelector('#pv');
  if (tab === 'puntaje') return calcView(box);
  if (tab === 'plan') return planView(box);
  return infoView(box);
}

function infoView(box) {
  const ed = examDateFor(state.profile);
  const d = daysUntil(EXAM_DATE);
  const nx = nextEvent();
  box.innerHTML = `
  <div class="grid g3">
    <div class="countdown"><div class="big">${Math.max(0, d)}</div><div><b>días para el examen</b><div class="muted small">${EXAM_LABEL}</div></div></div>
    <div class="card stat"><div class="label">Próxima fecha</div><div class="value" style="font-size:1.35rem">${nx ? esc(nx.short) : '—'}</div><div class="sub">${nx ? esc(fmtRange(nx.from, nx.to)) : ''}</div></div>
    <div class="card stat"><div class="label">Peso del examen</div><div class="value">30 <small style="font-size:1rem">de 100</small></div><div class="sub"><a href="#/proceso/puntaje">Calcula tu puntaje final</a></div></div>
  </div>
  ${ed.custom ? `<div class="notice warn small" style="margin-top:16px">En tu plan registraste el examen para el <b>${esc(fmtLong(ed.date))}</b>. La fecha oficial es el <b>${EXAM_LABEL}</b>. <a href="#/calendario">Cambiar mi fecha</a></div>` : ''}
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Fechas clave</h3>${timelineHTML()}
      <p class="small muted" style="margin:10px 0 0">La USICAMM te asigna uno de los dos días del examen. El año pasado modificó el calendario a mitad del proceso; si vuelve a pasar, aquí lo actualizamos.</p></div>
    <div class="stack">
      <div class="card"><h3>Qué cambió respecto al proceso 2026-2027</h3><ul class="small">
        <li><b>Todo se adelanta.</b> El examen pasa del 6 y 7 de junio al <b>15 y 16 de mayo</b>; el registro empieza una semana antes.</li>
        <li><b>Egresados sin título todavía:</b> ahora pueden registrarse las generaciones <b>2025-2026 y 2026-2027</b>.</li>
        <li><b>El puntaje se calcula igual:</b> 15 + 25 + 10 + 20 + 30 = 100.</li>
        <li><b>Los requisitos son los mismos</b>, incluido el curso de habilidades docentes y digitales.</li></ul></div>
      <div class="card"><h3>Curso de habilidades docentes y digitales</h3><p class="small">Es <b>requisito</b> para todas las personas participantes. Se toma en línea del <b>5 de abril al 4 de mayo de 2027</b>, desde cualquier dispositivo con internet, con las claves personales que te dé la USICAMM (no las compartas). Tiene videos, audios, lecturas y ejercicios. No suma puntos, pero <b>su calificación sirve para desempatar</b>.</p></div>
    </div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Requisitos para participar</h3><ul class="small">
      <li><b>Licenciatura</b> con título o cédula profesional en original. Si egresas en <b>2025-2026 o 2026-2027</b>, puedes registrarte con el <b>acta de examen profesional, certificado o constancia oficial de estudios</b> en original; si te asignan plaza, entregas el título o la cédula a más tardar 6 meses después de que inicie tu nombramiento.</li>
      <li><b>Perfil profesional:</b> tu licenciatura debe ser afín al nivel al que aspiras. Los perfiles vienen en la convocatoria de tu estado.</li>
      <li><b>Acreditar el curso</b> de habilidades docentes y digitales para la Nueva Escuela Mexicana.</li>
      <li><b>No tener plaza definitiva</b> (ni estar en proceso de obtenerla) en el mismo nivel, en ningún estado.</li>
      <li><b>Primaria indígena:</b> acreditar las habilidades lingüísticas de la lengua (comprensión auditiva, expresión oral, comprensión lectora y expresión escrita), de preferencia antes del examen.</li></ul>
      <p class="small muted" style="margin:6px 0 0">Los egresados de normales públicas, UPN y Centros de Actualización del Magisterio tienen prioridad para la admisión.</p></div>
    <div class="card"><h3>Documentos para tu registro</h3><ul class="small">
      <li>Tu cita de registro e identificación oficial vigente con fotografía.</li>
      <li>CURP y acta de nacimiento (o carta de naturalización).</li>
      <li>Título o cédula (o acta de examen, certificado o constancia si egresas en 2025-2026 o 2026-2027).</li>
      <li>Certificado de estudios o historial académico con tu <b>promedio general</b>.</li>
      <li>Constancias de <b>cursos extracurriculares</b> y hojas o constancias de <b>servicio docente</b>, si las tienes.</li>
      <li>Constancia de <b>alfabetización del INEA</b>, si participaste.</li>
      <li>Documento que acredite discapacidad, solo si la registraste en Proyecto Venus.</li></ul>
      <p class="small muted" style="margin:6px 0 0">El registro será preferentemente presencial. Al terminar recibes tu ficha de registro y carta de aceptación: fírmalas y entrégalas en máximo 7 días naturales. Tu estado puede pedir documentos adicionales.</p></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Cómo se integra tu puntaje</h3>
      <div class="table-wrap"><table class="t"><tr><th>Elemento</th><th style="text-align:right">Máximo</th></tr>
      <tr><td>Formación docente pedagógica</td><td style="text-align:right">15</td></tr>
      <tr><td>Promedio general de carrera</td><td style="text-align:right">25</td></tr>
      <tr><td>Cursos extracurriculares</td><td style="text-align:right">10</td></tr>
      <tr><td>Experiencia docente</td><td style="text-align:right">20</td></tr>
      <tr><td><b>Apreciación de conocimientos y aptitudes (examen)</b></td><td style="text-align:right"><b>30</b></td></tr>
      <tr><td><b>Total</b></td><td style="text-align:right"><b>100</b></td></tr></table></div>
      <a class="btn primary" href="#/proceso/puntaje" style="margin-top:12px">Calcular mi puntaje</a></div>
    <div class="card"><h3>Si hay empate</h3><ol class="small" style="padding-left:20px;line-height:1.7">
      <li>Egresados de normales públicas, UPN y CAM.</li>
      <li>Puntaje en el examen.</li>
      <li>Puntaje por área del examen: Área 1, luego Área 2 y luego Área 3.</li>
      <li>Puntaje del curso de habilidades docentes y digitales (total y por módulo).</li>
      <li>Puntaje en la subárea con más preguntas de cada área.</li></ol>
      <p class="small muted">Por eso conviene cuidar el Área 1 (aspectos normativos) y no dejar el curso al final.</p></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3>Después del examen</h3><ul class="small">
      <li><b>4 de junio de 2027:</b> consultas tu resultado en usicamm.sep.gob.mx.</li>
      <li>Tienes <b>15 días hábiles</b> para presentar un recurso de reconsideración (de preferencia a recurso.admision.basica@sep.gob.mx).</li>
      <li><b>16 de julio de 2027:</b> se publica el listado ordenado de mayor a menor puntaje; dos días después empiezan los eventos de asignación.</li>
      <li>Tu resultado vale hasta el <b>31 de mayo de 2028</b>. Si aceptas una plaza definitiva, recibes el nombramiento definitivo a los seis meses y un día, sin nota desfavorable.</li>
      <li>Si no te presentas al evento de asignación y no justificas tu falta en 3 días hábiles, pasas al final del listado.</li></ul></div>
    <div class="card"><h3>Avisos importantes</h3><ul class="small">
      <li>Todos los trámites del proceso son <b>gratuitos</b>.</li>
      <li>Presentar documentos falsos o alterados anula tu participación, incluso si ya tienes plaza.</li>
      <li>Difundir reactivos del examen real está sancionado. Los reactivos de este simulador son <b>originales</b>, elaborados a partir de la bibliografía oficial.</li>
      <li>La guía de estudio de Primaria 2027-2028 aún no se publica. Mientras tanto, el simulador mantiene la estructura vigente (3 áreas y 6 subáreas); cuando salga, revisaremos temas y bibliografía.</li></ul>
      <p class="small faint" style="margin:6px 0 0">Herramienta independiente; no está afiliada a la SEP ni a la USICAMM. Consulta siempre la convocatoria de tu estado.</p></div>
  </div>`;
}

async function calcView(box) {
  box.innerHTML = loadingHTML('Cargando tus resultados…');
  let attempts = [];
  try { attempts = await api.listAttempts(state.user.id, 60); } catch (e) { }
  const done = (attempts || []).filter(a => a.status === 'submitted' && a.score != null);
  const sims = done.filter(a => a.mode === 'simulacro');
  const pool = sims.length ? sims : done.filter(a => a.mode === 'corto');
  const last3 = pool.slice(0, 3);
  const avg = last3.length ? Math.round(last3.reduce((s, a) => s + Number(a.score), 0) / last3.length) : null;
  const src = sims.length ? `promedio de tus últimos ${last3.length} simulacro${last3.length > 1 ? 's' : ''} completo${last3.length > 1 ? 's' : ''}` : last3.length ? `promedio de tus últimos ${last3.length} simulacro${last3.length > 1 ? 's' : ''} corto${last3.length > 1 ? 's' : ''}` : '';
  const v = Object.assign({ fdp: 'a', promTipo: 'num', prom: '', horas: '', practica: false, meses: '', inea: 'no', examen: avg ?? 60 }, loadCalc());
  if (avg != null && !loadCalc().examenManual) v.examen = avg;

  box.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,3fr) minmax(0,2fr)">
    <div class="card pad-lg calc">
      <h3>1. Formación docente pedagógica <span class="muted small">(máx. 15)</span></h3>
      <p class="small muted" style="margin:0 0 8px">¿Cómo acreditas tu formación docente pedagógica? Los puntajes no se suman: elige una opción.</p>
      ${FDP_OPTS.map(o => `<label class="check"><input type="radio" name="fdp" value="${o.v}" ${v.fdp === o.v ? 'checked' : ''}><div><b>${esc(o.t)}</b> <span class="chip gold">${o.pts} pts</span><br><span class="small muted">${esc(o.d)}</span></div></label>`).join('')}
      <h3>2. Promedio general de carrera <span class="muted small">(máx. 25)</span></h3>
      <div class="grid g2"><label class="field"><span>Tipo de promedio</span><select id="pt"><option value="num">Numérico (6 a 10)</option><option value="suficiente">Suficiente</option><option value="satisfactorio">Satisfactorio o Acreditado</option><option value="sobresaliente">Sobresaliente</option></select></label>
        <label class="field" id="pnf"><span>Promedio de tu certificado</span><input type="number" id="pn" min="6" max="10" step="0.01" placeholder="Ej. 9.25" value="${esc(v.prom)}"></label></div>
      <h3>3. Cursos extracurriculares <span class="muted small">(máx. 10)</span></h3>
      <label class="field"><span>Total de horas acreditadas</span><input type="number" id="hc" min="0" max="1000" step="1" placeholder="Ej. 120" value="${esc(v.horas)}"></label>
      <p class="small muted" style="margin:-4px 0 12px">Solo cuentan cursos del catálogo de la USICAMM, con al menos 20 horas, expedidos en los últimos 3 años y registrados en el Repositorio Digital. Se toman de 20 a 200 horas.</p>
      <h3>4. Experiencia docente <span class="muted small">(máx. 20)</span></h3>
      <label class="check"><input type="checkbox" id="pr" ${v.practica ? 'checked' : ''}><div><b>Soy egresado de Normal pública, UPN, CAM o Universidad para el Bienestar con formación docente</b><br><span class="small muted">La práctica para la docencia vale 10 puntos.</span></div></label>
      <label class="field" style="margin-top:10px"><span>Meses frente a grupo en educación básica después de titularte (o en CONAFE)</span><input type="number" id="me" min="0" max="600" step="1" placeholder="Ej. 14" value="${esc(v.meses)}"></label>
      <p class="small muted" style="margin:-4px 0 10px">La práctica y los meses frente a grupo no se suman: se toma el mayor.</p>
      <label class="field"><span>Alfabetización con el INEA</span><select id="in"><option value="no">No participé</option><option value="si">Sí participé (+2)</option><option value="rural">Sí, en zona rural (+3)</option></select></label>
      <h3>5. Examen <span class="muted small">(máx. 30)</span></h3>
      <label class="field"><span>Porcentaje de aciertos que esperas obtener</span><input type="range" id="ex" min="0" max="100" step="1" value="${Number(v.examen) || 0}"><div class="row between small"><span>0 %</span><b id="exv"></b><span>100 %</span></div></label>
      ${src ? `<p class="small muted" style="margin:0">Se llenó con el ${src}. <button class="btn sm ghost" id="exr">Usar ${avg} %</button></p>` : '<p class="small muted" style="margin:0">Presenta un simulacro y aquí aparecerá tu resultado.</p>'}
    </div>
    <div class="stack calc-side">
      <div class="card pad-lg"><div class="label small muted" style="text-transform:uppercase;font-weight:700;letter-spacing:.04em">Puntaje final estimado</div>
        <div class="calc-total"><b id="tot">0</b><span>de 100</span></div>
        <div id="bars"></div>
        <div class="notice info small" id="tip" style="margin-top:12px"></div></div>
      <div class="card"><h4>Cómo se calcula</h4><ul class="small">
        <li>Promedio: de 6.00 a 10.00 equivale a 5 a 25 puntos (cada décima, 0.5). Suficiente 17.21, Satisfactorio 19.56, Sobresaliente 21.71.</li>
        <li>Cursos: de 20 a 200 horas equivalen a 2.5 a 10 puntos.</li>
        <li>Meses frente a grupo: de 1 a 60 o más equivalen a 5.25 a 20 puntos.</li>
        <li>Examen: la USICAMM convierte tu resultado según el comportamiento de todos los participantes; aquí se estima como tu porcentaje de aciertos por 0.3.</li></ul>
        <p class="small faint" style="margin:0">Es una estimación con las tablas del Anexo III del Acuerdo; tu resultado oficial lo da la USICAMM.</p></div>
    </div></div>`;
  const $ = (id) => box.querySelector('#' + id);
  $('pt').value = v.promTipo; $('in').value = v.inea;
  const read = () => ({ fdp: box.querySelector('input[name=fdp]:checked')?.value || 'n', promTipo: $('pt').value, prom: $('pn').value, horas: $('hc').value, practica: $('pr').checked, meses: $('me').value, inea: $('in').value, examen: +$('ex').value, examenManual: v.examenManual });
  const upd = () => {
    const x = read();
    $('pnf').style.display = x.promTipo === 'num' ? '' : 'none';
    $('exv').textContent = x.examen + ' %';
    const parts = [
      ['Formación docente pedagógica', FDP_OPTS.find(o => o.v === x.fdp)?.pts || 0, 15],
      ['Promedio general de carrera', ptsPromedio(x.promTipo, x.prom), 25],
      ['Cursos extracurriculares', ptsCursos(x.horas), 10],
      ['Experiencia docente', ptsExperiencia(x), 20],
      ['Examen (estimado)', ptsExamen(x.examen), 30]
    ];
    const tot = parts.reduce((s, p) => s + p[1], 0);
    $('tot').textContent = fmtPts(tot);
    $('bars').innerHTML = parts.map(([n, p, m]) => `<div class="calc-row"><div class="row between small"><span>${n}</span><b>${fmtPts(p)} / ${m}</b></div><div class="bar ${p >= m * 0.8 ? 'ok' : p >= m * 0.5 ? '' : 'warn'}"><i style="width:${Math.round(100 * p / m)}%"></i></div></div>`).join('');
    const sinEx = tot - parts[4][1];
    const at = (pc) => fmtPts(sinEx + ptsExamen(pc));
    $('tip').innerHTML = x.examen < 90
      ? `Con tus demás elementos, si subes a <b>${Math.min(100, x.examen + 10)} %</b> de aciertos llegarías a <b>${at(Math.min(100, x.examen + 10))}</b>, y con <b>90 %</b> a <b>${at(90)}</b>. Cada 10 % de aciertos vale alrededor de 3 puntos.`
      : `Vas muy bien: con <b>${x.examen} %</b> de aciertos el examen aporta cerca de <b>${fmtPts(parts[4][1])}</b> de los 30 puntos.`;
    saveCalc(x);
  };
  box.querySelectorAll('input,select').forEach(el => { el.oninput = el.onchange = () => { if (el.id === 'ex') v.examenManual = true; upd(); }; });
  const r = box.querySelector('#exr'); if (r) r.onclick = () => { v.examenManual = false; $('ex').value = avg; upd(); };
  upd();
}

async function planView(box) {
  box.innerHTML = loadingHTML('Armando tu plan…');
  let docs = [], prog = [], stats = null;
  try { [docs, prog, stats] = await Promise.all([api.listDocs(), api.studyProgress(state.user.id), api.myStats().catch(() => null)]); } catch (e) { box.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`; return; }
  const p = state.profile || {};
  const ed = examDateFor(p);
  const read = new Set((prog || []).map(x => x.doc_id));
  const bs = stats?.by_subarea || {};
  const weakest = Object.keys(SUBAREAS).filter(k => bs[k]?.total >= 5).sort((a, b) => bs[a].correct / bs[a].total - bs[b].correct / bs[b].total)[0] || null;
  const plan = buildPlan({ start: planStart(p), exam: ed.date, docs, weakest });
  if (!plan) { box.innerHTML = `<div class="card empty">La fecha de tu examen ya pasó. Actualízala en <a href="#/calendario">Calendario</a>.</div>`; return; }
  const today = localISO();
  const cur = plan.weeks.find(w => today >= w.from && today <= w.to) || plan.weeks[0];
  const goal = (p.daily_goal_min || 60) * ((p.study_days || []).length || 5);
  const fichas = plan.weeks.flatMap(w => w.tasks.filter(t => t.doc));
  const leidas = fichas.filter(t => read.has(t.doc)).length;
  const PH = { diagnostico: ['Diagnóstico', 'gold'], estudio: ['Estudio', ''], repaso: ['Repaso', 'warn'], final: ['Simulación final', 'bad'], examen: ['Examen', 'bad'] };
  const taskHTML = (t) => `<li class="${t.doc && read.has(t.doc) ? 'done' : ''}${t.tramite ? ' tram' : ''}">${t.href ? `<a href="${t.href}">${esc(t.t)}</a>` : esc(t.t)}${t.doc && read.has(t.doc) ? ' <span class="chip ok">Leída</span>' : ''}</li>`;
  const weekHTML = (w) => {
    const isCur = w === cur, past = w.to < today;
    const docsW = w.tasks.filter(t => t.doc), ok = docsW.filter(t => read.has(t.doc)).length;
    return `<details class="week${isCur ? ' cur' : ''}${past ? ' past' : ''}" ${isCur ? 'open' : ''}><summary><span class="wk">Semana ${w.n}</span><span class="wd">${esc(fmtShort(w.from))} – ${esc(fmtShort(w.to))}</span><span class="chip ${PH[w.phase][1]}">${PH[w.phase][0]}</span><b class="wt">${esc(w.title)}</b>${isCur ? '<span class="chip ok">Esta semana</span>' : ''}${docsW.length ? `<span class="small muted">${ok}/${docsW.length} fichas</span>` : ''}${w.tramites.length ? '<span class="chip gold">Trámite</span>' : ''}</summary>
      <ul class="tasks">${w.tramites.map(taskHTML).join('')}${w.tasks.map(taskHTML).join('')}</ul></details>`;
  };
  box.innerHTML = `<div class="grid g3">
      <div class="card stat"><div class="label">Tu plan</div><div class="value">${plan.N} semanas</div><div class="sub">hasta el ${esc(fmtLong(ed.date))}${ed.custom ? ' (fecha de tu plan)' : ''}</div></div>
      <div class="card stat"><div class="label">Vas en</div><div class="value">Semana ${cur.n}</div><div class="sub">${esc(cur.title)}</div></div>
      <div class="card stat"><div class="label">Fichas del plan leídas</div><div class="value">${leidas}/${fichas.length}</div><div class="bar" style="margin-top:8px"><i style="width:${fichas.length ? Math.round(100 * leidas / fichas.length) : 0}%"></i></div></div></div>
    <div class="notice info small" style="margin:16px 0">Cada semana combina fichas de estudio, práctica por subárea y un simulacro, y te recuerda los trámites oficiales. Tu meta actual es de <b>${goal} minutos a la semana</b> (<a href="#/calendario">ajustar</a>). Marca cada ficha como leída para ver tu avance.</div>
    <div class="weeks">${plan.weeks.map(weekHTML).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn" id="rs">Reiniciar el plan desde esta semana</button><span class="small muted">Útil si te atrasaste o empiezas tarde: reparte lo pendiente en las semanas que quedan.</span></div>`;
  box.querySelector('#rs').onclick = async () => {
    if (!await confirmDialog('Reiniciar plan', 'Tu plan empezará de nuevo esta semana y repartirá las fichas en las semanas que quedan hasta tu examen.', 'Reiniciar')) return;
    try { localStorage.setItem(planKey(), monday(today)); } catch (e) { }
    toast('Plan reiniciado desde esta semana.', 'ok'); planView(box);
  };
}

// Resumen para la página de inicio
export async function planThisWeek(p, docs) {
  const ed = examDateFor(p);
  const plan = buildPlan({ start: planStart(p), exam: ed.date, docs });
  if (!plan) return null;
  const today = localISO();
  const w = plan.weeks.find(x => today >= x.from && today <= x.to) || plan.weeks[0];
  return { plan, week: w };
}
