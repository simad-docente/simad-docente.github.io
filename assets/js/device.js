// Identificación del equipo: una clave guardada en el navegador y dos "huellas" técnicas.
// No se guardan fotos, ubicación ni datos personales; solo resúmenes (hash) de características del navegador.
const KEY = 'simad_device';

function randomKey() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return 'dv-' + [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function deviceKey() {
  let k = null;
  try { k = localStorage.getItem(KEY); } catch (e) { }
  if (!k || k.length < 16) {
    k = randomKey();
    try { localStorage.setItem(KEY, k); } catch (e) { }
  }
  return k;
}

async function sha(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch (e) { return null; }
}

function webglSig() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return `${vendor}|${renderer}|${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`;
  } catch (e) { return ''; }
}

// fp: este navegador en este equipo. Es igual en modo incógnito y no cambia cuando el navegador se actualiza
//     (se quitan los números de versión), pero sí distingue Chrome, Edge, Firefox, Safari, etc.
// fpHw: el equipo sin importar el navegador (solo se usa para avisar al administrador)
export async function fingerprints() {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const hw = [platform, navigator.hardwareConcurrency || '', navigator.deviceMemory || '', `${screen.width}x${screen.height}x${screen.colorDepth}`, tz, webglSig()].join('§');
  const uaFamily = (navigator.userAgent || '').replace(/\d+/g, '#');
  const browser = [uaFamily, (navigator.languages || [navigator.language]).join(',')].join('§');
  const [fpHw, fp] = await Promise.all([sha('hw§' + hw), sha('br§' + hw + '§' + browser)]);
  return { fp, fpHw };
}
