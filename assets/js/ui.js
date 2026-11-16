// Utilidades de interfaz
export const SUBAREAS = {
  '1.1': { area: 1, name: 'Principios legales para la educación integral' },
  '1.2': { area: 1, name: 'Bases normativas de la Nueva Escuela Mexicana' },
  '2.1': { area: 2, name: 'Bases para el trabajo con las alumnas y los alumnos' },
  '2.2': { area: 2, name: 'Marco curricular de la Nueva Escuela Mexicana' },
  '3.1': { area: 3, name: 'Trabajo colegiado para la mejora continua' },
  '3.2': { area: 3, name: 'Trabajo colaborativo entre la escuela y la comunidad' }
};
export const AREAS = {
  '1': 'Aspectos normativos',
  '2': 'Intervención docente',
  '3': 'Participación en el trabajo de la escuela y la comunidad'
};
export const FORMATS = {
  directo: 'Cuestionamiento directo',
  completamiento: 'Completamiento',
  ordenamiento: 'Ordenamiento',
  relacion: 'Relación de elementos'
};
export const MODES = { simulacro: 'Simulacro completo', corto: 'Simulacro corto', practica: 'Práctica' };
export const STATUS = { submitted: 'Concluido', annulled: 'Anulado', abandoned: 'Sin concluir', in_progress: 'En curso' };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Texto con saltos de párrafo
export function paras(s) {
  return String(s ?? '').split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
// Las argumentaciones del banco pueden traer {A} sin reasignar (vista de administración)
export function plainLetters(s) { return String(s ?? '').replace(/\{([ABC])\}/g, '$1'); }

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s} s`;
  return `${s} s`;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function monthName(i) { return MESES[i]; }
export function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const x = new Date(d);
  if (isNaN(x)) return '—';
  let s = `${x.getDate()} ${MESES_CORTOS[x.getMonth()]} ${x.getFullYear()}`;
  if (withTime) s += `, ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  return s;
}
export function localISO(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function pct(c, t) { return t ? Math.round((100 * c) / t) : 0; }
export function levelClass(p) { return p >= 80 ? 'ok' : p >= 60 ? '' : p >= 40 ? 'warn' : 'bad'; }
export function initials(name, email) {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 4200);
  setTimeout(() => t.remove(), 4600);
}

export function modal({ title, body = '', actions = [], wide = false, onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="${wide ? 'max-width:820px' : ''}">
    <div class="mh"><h3>${esc(title || '')}</h3><button class="x" aria-label="Cerrar">×</button></div>
    <div class="mb"></div>
    <div class="mf"></div></div>`;
  const mb = bg.querySelector('.mb');
  if (typeof body === 'string') mb.innerHTML = body; else mb.appendChild(body);
  const mf = bg.querySelector('.mf');
  if (!actions.length) mf.remove();
  const close = (v) => { bg.remove(); onClose && onClose(v); };
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || '');
    b.textContent = a.label;
    b.onclick = async () => {
      if (a.onClick) {
        b.disabled = true;
        try { const r = await a.onClick(bg); if (r === false) { b.disabled = false; return; } } catch (e) { b.disabled = false; toast(errMsg(e), 'bad'); return; }
      }
      close(a.value);
    };
    mf.appendChild(b);
  });
  bg.querySelector('.x').onclick = () => close(null);
  bg.addEventListener('click', e => { if (e.target === bg) close(null); });
  document.body.appendChild(bg);
  return { el: bg, close };
}

export function confirmDialog(title, text, okLabel = 'Aceptar', cls = 'primary') {
  return new Promise(resolve => {
    modal({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancelar', value: false }, { label: okLabel, cls, value: true }], onClose: v => resolve(!!v) });
  });
}

export function loadingHTML(msg = 'Cargando…') {
  return `<div class="loading"><div><div class="spinner"></div>${esc(msg)}</div></div>`;
}

const ERRORS = {
  SESSION_REPLACED: 'Tu cuenta se abrió en otro dispositivo.',
  NOT_APPROVED: 'Tu cuenta aún no está aprobada por el administrador.',
  NO_QUESTIONS: 'No hay reactivos disponibles con ese filtro. Prueba con otra subárea o pide al administrador que cargue el banco.',
  TIME_OVER: 'El tiempo del examen terminó.',
  ATTEMPT_CLOSED: 'Este examen ya fue concluido.',
  FORBIDDEN: 'No tienes permiso para realizar esta acción.',
  RATE_LIMIT: 'Has enviado muchos reportes en poco tiempo. Intenta más tarde.',
  CANNOT_CHANGE_SELF: 'No puedes cambiar tu propio estado o rol.',
  NO_AUTH: 'Tu sesión expiró. Vuelve a iniciar sesión.'
};
export function errCode(e) {
  const m = String(e?.message || e || '');
  for (const k of Object.keys(ERRORS)) if (m.includes(k)) return k;
  return null;
}
export function errMsg(e) {
  const c = errCode(e);
  if (c) return ERRORS[c];
  const m = String(e?.message || e || 'Ocurrió un error inesperado.');
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
  return m.length > 180 ? m.slice(0, 180) + '…' : m;
}

// Gráfica de línea sencilla en SVG
export function lineChart(points, { height = 220, max = 100, label = '%' } = {}) {
  const W = 640, H = height, P = 34;
  if (!points.length) return `<div class="empty">Aún no hay datos para graficar.</div>`;
  const n = points.length;
  const x = i => P + (n === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (n - 1));
  const y = v => H - P - (Math.max(0, Math.min(max, v)) / max) * (H - 2 * P);
  const grid = [0, 25, 50, 75, 100].map(g => `<line x1="${P}" x2="${W - P / 2}" y1="${y(g)}" y2="${y(g)}" stroke="#e3e8ee"/><text x="${P - 6}" y="${y(g) + 4}" font-size="11" text-anchor="end" fill="#8794a3">${g}</text>`).join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="4.5" fill="#fff" stroke="#163a5f" stroke-width="2"><title>${esc(p.t)}: ${p.v}${label}</title></circle>`).join('');
  const labels = points.map((p, i) => (n <= 12 || i % Math.ceil(n / 12) === 0) ? `<text x="${x(i)}" y="${H - 10}" font-size="10.5" text-anchor="middle" fill="#8794a3">${esc(p.s || '')}</text>` : '').join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución de resultados">${grid}<path d="${path}" fill="none" stroke="#163a5f" stroke-width="2.5"/>${dots}${labels}</svg>`;
}

export function ring(p, size = 150) {
  const r = (size - 16) / 2, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, p)) / 100);
  const col = p >= 80 ? '#1c7a4c' : p >= 60 ? '#1f4f80' : p >= 40 ? '#a86a12' : '#b13a3a';
  return `<div class="score-ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#e6ebf1" stroke-width="12" fill="none"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${col}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><div class="v"><div><b>${p}%</b><div class="small muted">aciertos</div></div></div></div>`;
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  let os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  let br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} en ${os}`;
}
