// Simulación de navegador seguro y supervisión remota (proctoring).
// Todo ocurre en el equipo del usuario: no se graba ni se envía audio, video ni fotografías.

export class Proctor {
  constructor() {
    this.stream = null; this.audioCtx = null; this.analyser = null; this.video = null;
    this.handlers = []; this.timers = []; this.armed = false; this.onIncident = null;
    this.noiseSince = 0; this.darkSince = 0; this.lastIncidentAt = {}; this.photo = null;
  }

  static support() {
    return {
      media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      fullscreen: !!(document.documentElement.requestFullscreen),
      secure: window.isSecureContext,
      extended: 'isExtended' in screen
    };
  }

  async startMedia(videoEl) {
    if (!Proctor.support().media) throw new Error('Tu navegador no permite usar cámara y micrófono.');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: true });
    if (videoEl) this.attach(videoEl);
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch (e) { this.analyser = null; }
    return this.stream;
  }
  attach(videoEl) {
    this.video = videoEl;
    if (this.stream && videoEl) { videoEl.srcObject = this.stream; videoEl.muted = true; videoEl.playsInline = true; videoEl.play().catch(() => { }); }
  }
  hasMedia() { return !!this.stream; }

  // Nivel de audio 0..1
  level() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  // Brillo promedio de la imagen 0..255 y contraste del centro contra el fondo (detecta contraluz)
  lighting() {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    let all = 0, center = 0, cn = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      all += l;
      if (x > 20 && x < 44 && y > 10 && y < 38) { center += l; cn++; }
    }
    const avg = all / (64 * 48), cen = center / cn;
    return { avg, center: cen, backlit: (avg - cen) > 35 };
  }

  capturePhoto() {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas'); c.width = 240; c.height = 180;
    const ctx = c.getContext('2d');
    ctx.translate(240, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, 240, 180);
    this.photo = c.toDataURL('image/jpeg', 0.8);
    return this.photo;
  }

  async faceCount() {
    if (!('FaceDetector' in window) || !this.video) return null;
    try { const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }); const f = await fd.detect(this.video); return f.length; } catch (e) { return null; }
  }

  async requestFullscreen() {
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); return true; } catch (e) { return false; }
  }
  isFullscreen() { return !!document.fullscreenElement; }

  _on(target, ev, fn, opts) { target.addEventListener(ev, fn, opts); this.handlers.push([target, ev, fn, opts]); }

  _incident(type, detail) {
    const now = Date.now();
    if (this.lastIncidentAt[type] && now - this.lastIncidentAt[type] < 4000) return; // evita duplicados inmediatos
    this.lastIncidentAt[type] = now;
    this.onIncident && this.onIncident(type, detail);
  }

  // Activa la vigilancia durante el examen
  arm({ onIncident, onFullscreenLost, onFullscreenBack, strictKeys = true, monitorMedia = true } = {}) {
    if (this.armed) return;
    this.armed = true; this.onIncident = onIncident;
    this._on(document, 'visibilitychange', () => { if (document.hidden) this._incident('cambio_ventana', 'La pestaña o la aplicación dejó de estar visible'); });
    this._on(window, 'blur', () => { setTimeout(() => { if (!document.hasFocus() && this.armed) this._incident('cambio_ventana', 'Se cambió a otra ventana o aplicación'); }, 300); });
    this._on(document, 'fullscreenchange', () => {
      if (!document.fullscreenElement) { this._incident('salida_pantalla_completa', 'Se salió de pantalla completa'); onFullscreenLost && onFullscreenLost(); }
      else onFullscreenBack && onFullscreenBack();
    });
    this._on(document, 'contextmenu', e => e.preventDefault());
    ['copy', 'cut', 'paste'].forEach(ev => this._on(document, ev, e => { e.preventDefault(); this._incident('portapapeles', 'Intento de copiar o pegar'); }));
    this._on(document, 'selectstart', e => { if (!(e.target.closest && e.target.closest('textarea,input'))) e.preventDefault(); });
    this._on(window, 'beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
    this._on(window, 'keydown', e => {
      const k = (e.key || '').toLowerCase();
      const combo = (e.ctrlKey || e.metaKey);
      if (k === 'printscreen') { this._incident('captura_pantalla', 'Se presionó Impr Pant'); }
      if (strictKeys && (k === 'f12' || (combo && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (combo && ['u', 'p', 's'].includes(k)))) {
        e.preventDefault(); this._incident('atajo_bloqueado', 'Atajo de teclado no permitido: ' + (e.key || ''));
      }
      if (e.altKey && k === 'tab') this._incident('cambio_ventana', 'Alt+Tab');
    }, true);
    this._on(window, 'keyup', e => { if ((e.key || '').toLowerCase() === 'printscreen') this._incident('captura_pantalla', 'Se presionó Impr Pant'); });
    if ('isExtended' in screen && screen.addEventListener) {
      this._on(screen, 'change', () => { if (screen.isExtended) this._incident('pantalla_adicional', 'Se detectó una pantalla adicional'); });
    }
    if (monitorMedia && this.stream) {
      const t = setInterval(async () => {
        if (!this.armed) return;
        const lv = this.level();
        if (lv > 0.32) { if (!this.noiseSince) this.noiseSince = Date.now(); if (Date.now() - this.noiseSince > 3500) { this._incident('ruido_ambiente', 'Se detectaron voces o ruido sostenido'); this.noiseSince = 0; } }
        else this.noiseSince = 0;
        const li = this.lighting();
        if (li && li.avg < 35) { if (!this.darkSince) this.darkSince = Date.now(); if (Date.now() - this.darkSince > 8000) { this._incident('rostro_no_visible', 'Imagen oscura: rostro no visible'); this.darkSince = 0; } }
        else this.darkSince = 0;
        const track = this.stream.getVideoTracks()[0];
        if (track && track.readyState === 'ended') this._incident('camara_desconectada', 'La cámara se desconectó');
      }, 1000);
      this.timers.push(t);
      const tf = setInterval(async () => {
        if (!this.armed) return;
        const n = await this.faceCount();
        if (n === 0) this._incident('rostro_no_visible', 'No se detectó un rostro frente a la cámara');
        if (n > 1) this._incident('otra_persona', 'Se detectó más de una persona');
      }, 15000);
      this.timers.push(tf);
    }
  }

  disarm() {
    this.armed = false;
    this.handlers.forEach(([t, ev, fn, o]) => t.removeEventListener(ev, fn, o));
    this.handlers = []; this.timers.forEach(clearInterval); this.timers = [];
  }

  async stop() {
    this.disarm();
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { } }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch (e) { } this.audioCtx = null; }
  }
}

export const INCIDENT_LABELS = {
  cambio_ventana: 'Cambio de pestaña o aplicación',
  perdida_foco: 'Cambio a otra ventana',
  salida_pantalla_completa: 'Salida de pantalla completa',
  portapapeles: 'Intento de copiar o pegar',
  captura_pantalla: 'Captura de pantalla',
  atajo_bloqueado: 'Atajo de teclado no permitido',
  pantalla_adicional: 'Pantalla adicional conectada',
  ruido_ambiente: 'Voces o ruido en el ambiente',
  rostro_no_visible: 'Rostro no visible',
  otra_persona: 'Otra persona en cámara',
  camara_desconectada: 'Cámara desconectada'
};

export const ENVIRONMENT_RULES = [
  { id: 'apps', t: 'Cerré todas las aplicaciones y pestañas (WhatsApp Web, Spotify, Word, otros navegadores y programas en segundo plano).' },
  { id: 'pantalla', t: 'Uso una sola pantalla: no tengo monitores adicionales, pantallas espejo ni proyección a otra televisión.' },
  { id: 'red', t: 'Mi conexión es estable (de preferencia por cable) y nadie en casa está saturando la red con descargas o streaming.' },
  { id: 'solo', t: 'Estoy en una habitación cerrada, a solas, y nadie entrará ni pasará detrás de mí.' },
  { id: 'paredes', t: 'Detrás de mí no hay cuadros, fotografías, pósteres con rostros ni espejos.' },
  { id: 'escritorio', t: 'En mi escritorio solo están la computadora y mi identificación oficial (sin cuadernos, libros, notas, calculadora ni celular).' },
  { id: 'audio', t: 'No uso audífonos ni diadema; el micrófono del equipo queda abierto y no hay música, televisión ni voces.' },
  { id: 'rostro', t: 'Mi rostro está descubierto (sin gorra, lentes oscuros ni cubrebocas) y mis orejas son visibles en cámara.' },
  { id: 'luz', t: 'Tengo luz de frente; no estoy de espaldas a una ventana (contraluz).' }
];
