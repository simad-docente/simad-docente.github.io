#!/usr/bin/env python3
"""Chequeo riguroso de SIMAD: pantallas, botones y flujos principales.

Arma una copia local del sitio con una API simulada y datos ficticios (tests/mock.js y
tests/mock-data.js), así que nunca toca la base de datos real ni a los usuarios reales.

Uso:  python3 tests/run_checks.py [--out DIRECTORIO] [--rapido]
Sale con código 1 si encontró fallas. El resumen queda en DIRECTORIO/reporte.md y reporte.json,
y las capturas de cada falla en DIRECTORIO/fallas/.
"""
import argparse, asyncio, hashlib, http.server, json, os, re, shutil, socket, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKGROUND = re.compile(r'heartbeat|alive|checkSession|logActivity|touch|ping|reportError|clientError|subscribe', re.I)


# ---------- Revisiones estáticas ----------
def static_checks():
    issues, info = [], {}
    api = (ROOT / 'assets/js/api.js').read_text(encoding='utf-8')
    rpcs = {}
    for m in re.finditer(r"rpc\('([a-z0-9_]+)'(?:\s*,\s*\{([^}]*)\})?", api):
        params = sorted(set(re.findall(r'(p_[a-z0-9_]+)\s*:', m.group(2) or '')))
        rpcs.setdefault(m.group(1), set()).update(params)
    info['rpcs'] = {k: sorted(v) for k, v in sorted(rpcs.items())}
    info['edge_functions'] = sorted(set(re.findall(r"fn\('([a-z0-9-]+)'", api)))
    info['tables'] = sorted(set(re.findall(r"\.from\('([a-z0-9_]+)'\)", api)))
    cfg = (ROOT / 'assets/js/config.js').read_text(encoding='utf-8')
    ver = re.search(r"version:\s*'([0-9.]+)'", cfg)
    info['version'] = ver.group(1) if ver else None
    files = list((ROOT / 'assets/js').glob('*.js')) + [ROOT / 'index.html', ROOT / 'privacidad.html']
    for f in files:
        txt = f.read_text(encoding='utf-8')
        for v in set(re.findall(r"(?<!supabase\.js)\?v=([0-9.]+)", txt)):
            if info['version'] and v != info['version']:
                issues.append(f"{f.name}: importa archivos con la versión {v}, pero config.js dice {info['version']}")
        for imp in re.findall(r"from '\./([a-z0-9_-]+\.js)", txt):
            if not (ROOT / 'assets/js' / imp).exists():
                issues.append(f"{f.name}: importa {imp}, que no existe")
    return issues, info


# ---------- Sitio de prueba ----------
def build_site():
    tmp = Path(tempfile.mkdtemp(prefix='simad_check_'))
    for name in ('index.html', 'privacidad.html'):
        shutil.copy(ROOT / name, tmp / name)
    shutil.copytree(ROOT / 'assets', tmp / 'assets')
    shutil.copy(ROOT / 'tests/mock.js', tmp / 'mock.js')
    shutil.copy(ROOT / 'tests/mock-data.js', tmp / 'mock-data.js')
    idx = (tmp / 'index.html').read_text(encoding='utf-8')
    idx2 = re.sub(r'<script src="assets/vendor/supabase\.js\?v=[0-9.]+"></script>', '<script src="mock-data.js"></script><script src="mock.js"></script>', idx)
    if idx2 == idx:
        raise SystemExit('No encontré la etiqueta de supabase.js en index.html para cambiarla por la API simulada.')
    (tmp / 'index.html').write_text(idx2, encoding='utf-8')
    (tmp / 'favicon.ico').write_bytes(b'')
    return tmp


def serve(directory):
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(directory), **k)
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{port}/'


INIT = r"""
(() => {
  let real; window.__mockLog = []; window.__printed = 0; window.__opened = 0;
  const wrap = (o, path) => { for (const k of Object.keys(o)) { const v = o[k];
    if (typeof v === 'function') o[k] = function (...a) { window.__mockLog.push(path + k); return v.apply(this, a); };
    else if (v && typeof v === 'object' && !Array.isArray(v)) wrap(v, path + k + '.'); } return o; };
  Object.defineProperty(window, 'SimadMockApi', { configurable: true, get() { return real; }, set(v) { real = wrap(v, ''); } });
  window.print = () => { window.__printed++; };
  window.open = () => { window.__opened++; return null; };
})();
"""

CANDIDATES = r"""
() => {
  const sel = '#view button, #view a[href^="#"], #view summary, #view [data-a], #view [data-b], #view [data-k], #view [role=button], .topbar #bug';
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
    return el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) && !el.closest('details:not([open]) > :not(summary)') : true; };
  const out = [], seen = new Set();
  const all = [...document.querySelectorAll(sel)];
  all.forEach((el, i) => {
    if (el.disabled || el.closest('[disabled]') || !vis(el)) return;
    if (el.closest('.nav')) return;
    // La pestaña ya activa o un enlace a la misma pantalla no tienen que cambiar nada
    if (el.classList.contains('on') || (el.tagName === 'A' && el.getAttribute('href') === location.hash)) return;
    const data = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name).sort();
    const keyVals = ['data-a', 'data-b', 'data-f', 'data-g', 'data-s'].map(n => el.getAttribute(n) || '').join('|');
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    // Enlaces a fichas, resultados, etc.: basta con probar uno de cada tipo
    const href = el.tagName === 'A' ? (el.getAttribute('href') || '').replace(/^(#\/[^/]+\/)[^/]+$/, '$1*') : '';
    const key = el.tagName + '|' + data.join(',') + '|' + keyVals + '|' + (el.hasAttribute('data-k') || el.tagName === 'SUMMARY' || href.endsWith('*') ? '' : text) + '|' + href;
    if (seen.has(key)) return; seen.add(key);
    out.push({ i, key, text: text || el.tagName.toLowerCase(), tag: el.tagName });
  });
  return { sel, list: out };
}
"""

STATE = r"""
() => {
  const v = document.querySelector('#view');
  const h = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };
  return { href: location.href, view: v ? h(v.innerHTML) : 0, modals: document.querySelectorAll('.modal').length,
    modalHtml: h([...document.querySelectorAll('.modal')].map(m => m.innerHTML).join('')),
    toasts: [...document.querySelectorAll('.toast')].map(t => t.innerText + '|' + t.className),
    calls: window.__mockLog.length, printed: window.__printed, opened: window.__opened, body: h(document.body.innerHTML) };
}
"""


class Checker:
    def __init__(self, base, out, rapido):
        self.base, self.out, self.rapido = base, Path(out), rapido
        (self.out / 'fallas').mkdir(parents=True, exist_ok=True)
        self.fails, self.warns, self.pages, self.buttons, self.flows = [], [], [], 0, []
        self.jserr = []

    def fail(self, where, what):
        self.fails.append({'donde': where, 'que': what})

    async def shot(self, page, name):
        path = self.out / 'fallas' / (re.sub(r'[^a-z0-9]+', '_', name.lower())[:80] + '.png')
        try: await page.screenshot(path=str(path), full_page=False)
        except Exception: pass
        return str(path)

    async def session(self, role='admin', status='approved', bound=False, payments=False, signed=True):
        await self.page.goto(self.base + 'privacidad.html')
        await self.page.evaluate('localStorage.clear()')
        await self.page.goto(self.base + '?inicio')
        await self.page.wait_for_selector('#g', timeout=10000)
        await self.page.evaluate('window.SimadMockApi.admin.setPayments(false, 270)')  # guarda la base simulada inicial
        await self.page.evaluate("""([role, status, bound, payments, signed]) => {
          const db = JSON.parse(localStorage.getItem('mockdb'));
          const p = db.profiles['u-admin']; p.role = role; p.status = status;
          db.payOn = payments; db.price = 270;
          const now = Date.now();
          db.extraUsers = [{ id: 'u-7', email: 'karla.prueba@example.com', full_name: 'Karla Prueba', role: 'user', status: 'approved', folio: 'ADM-1A2B-3C4D5E', created_at: new Date(now - 9 * 864e5).toISOString(), bound_label: 'Chrome en Android', bound_at: new Date(now - 6 * 864e5).toISOString(), bind_alerts: 2, device_label: 'Chrome en Android' }];
          db.bugs = db.bugs.length ? db.bugs : [{ id: 1, user_id: 'u-admin', category: 'Reactivo', description: 'Reporte de prueba', page: '#/practica', status: 'nuevo', created_at: new Date(now - 36e5).toISOString(), context: {} }];
          localStorage.setItem('mockdb', JSON.stringify(db));
          if (signed) localStorage.setItem('mock_signed', '1'); else localStorage.removeItem('mock_signed');
          if (bound) localStorage.setItem('mock_bound', '1'); else localStorage.removeItem('mock_bound');
        }""", [role, status, bound, payments, signed])

    async def goto(self, route, ready='#view .page-head'):
        self.nav = getattr(self, 'nav', 0) + 1  # la consulta distinta obliga a recargar la página completa
        await self.page.goto(f'{self.base}?t={self.nav}{route}')
        try:
            await self.page.wait_for_selector(ready, timeout=9000)
        except Exception:
            self.fail(route, 'La pantalla no terminó de cargar')
            await self.shot(self.page, 'carga ' + route)
            return False
        await self.page.wait_for_timeout(450)
        return True

    async def save_base(self):
        self.base_snap = await self.page.evaluate('() => JSON.stringify(Object.assign({}, localStorage))')

    async def restore(self, snap):
        await self.page.evaluate("(s) => { localStorage.clear(); const o = JSON.parse(s); for (const k in o) localStorage.setItem(k, o[k]); }", snap)

    async def check_route(self, route, label):
        before = len(self.jserr)
        if getattr(self, 'base_snap', None): await self.restore(self.base_snap)  # cada pantalla parte del mismo estado
        ok = await self.goto(route)
        self.pages.append(label)
        if not ok: return
        bad = await self.page.evaluate("() => [...document.querySelectorAll('#view .notice.bad, .toast.bad')].map(x => x.innerText.trim()).filter(Boolean)")
        if bad: self.fail(label, 'Muestra un error al abrir: ' + ' / '.join(bad)[:200])
        if len(self.jserr) > before: self.fail(label, 'Error de JavaScript al abrir: ' + ' | '.join(self.jserr[before:])[:300])
        await self.crawl(route, label)

    async def crawl(self, route, label):
        snap = await self.page.evaluate('() => JSON.stringify(Object.assign({}, localStorage))')
        info = await self.page.evaluate(CANDIDATES)
        items = info['list'][: (12 if self.rapido else 45)]
        bg = await self.background_names()
        for it in items:
            await self.restore(snap)
            if not await self.goto(route): return
            els = await self.page.query_selector_all(info['sel'])
            if it['i'] >= len(els): continue
            el = els[it['i']]
            name = f"{label} → «{it['text']}»"
            before_err = len(self.jserr)
            s0 = await self.page.evaluate(STATE)
            try:
                await el.scroll_into_view_if_needed(timeout=2000)
                await el.click(timeout=3000)
            except Exception as e:
                self.warns.append(f'{name}: no se pudo pulsar ({str(e).splitlines()[0][:90]})'); continue
            self.buttons += 1
            await self.page.wait_for_timeout(750)
            s1 = await self.page.evaluate(STATE)
            calls = [c for c in (await self.page.evaluate('() => window.__mockLog'))[s0['calls']:] if not BACKGROUND.search(c)]
            changed = (s1['href'] != s0['href'] or s1['view'] != s0['view'] or s1['modals'] != s0['modals'] or s1['toasts'] != s0['toasts']
                       or calls or s1['printed'] != s0['printed'] or s1['opened'] != s0['opened'] or s1['body'] != s0['body'])
            if len(self.jserr) > before_err:
                self.fail(name, 'Error de JavaScript: ' + ' | '.join(self.jserr[before_err:])[:300]); await self.shot(self.page, name); continue
            if not changed:
                self.fail(name, 'El botón no hace nada al pulsarlo'); await self.shot(self.page, name); continue
            # Ventana de confirmación: su botón principal debe hacer algo
            if s1['modals'] > s0['modals']:
                prims = await self.page.query_selector_all('.modal .btn.primary, .modal .btn.danger, .modal .btn.ok')
                prim = prims[-1] if prims else None
                if prim:
                    m0 = await self.page.evaluate(STATE)
                    try: await prim.click(timeout=3000)
                    except Exception: continue
                    await self.page.wait_for_timeout(900)
                    m1 = await self.page.evaluate(STATE)
                    calls2 = [c for c in (await self.page.evaluate('() => window.__mockLog'))[m0['calls']:] if not BACKGROUND.search(c)]
                    if len(self.jserr) > before_err:
                        self.fail(name + ' → confirmar', 'Error de JavaScript: ' + ' | '.join(self.jserr[before_err:])[:300]); await self.shot(self.page, name + ' confirmar')
                    elif not (calls2 or m1['href'] != m0['href'] or m1['modals'] != m0['modals'] or m1['modalHtml'] != m0['modalHtml'] or m1['toasts'] != m0['toasts'] or m1['view'] != m0['view']):
                        self.fail(name + ' → confirmar', 'La ventana de confirmación no hace nada al aceptar'); await self.shot(self.page, name + ' confirmar')
            bad = [t for t in s1['toasts'] if re.search(r'\bbad\b', t.rsplit('|', 1)[-1]) and t not in s0['toasts']]
            if bad: self.warns.append(f"{name}: mostró el aviso «{bad[0].split('|')[0][:120]}»")

    async def background_names(self):
        n0 = await self.page.evaluate('() => window.__mockLog.length')
        await self.page.wait_for_timeout(300)
        return (await self.page.evaluate('() => window.__mockLog'))[n0:]

    # ---------- Flujos completos ----------
    async def flow(self, name, coro):
        before = len(self.jserr)
        try:
            await coro()
            if len(self.jserr) > before:
                self.fail('Flujo: ' + name, 'Error de JavaScript: ' + ' | '.join(self.jserr[before:])[:300])
            else:
                self.flows.append(name)
        except Exception as e:
            self.fail('Flujo: ' + name, 'No se pudo completar: ' + str(e).splitlines()[0][:200])
            await self.shot(self.page, 'flujo ' + name)

    async def practice_flow(self):
        p = self.page
        await self.goto('#/practica')
        await p.select_option('#n', '5'); await p.click('#go')
        for _ in range(5):
            await p.wait_for_selector('.opt:not([disabled])', timeout=8000)
            await p.click('.opt >> nth=1'); await p.wait_for_selector('.feedback', timeout=5000); await p.click('#next')
        await p.wait_for_selector('.score-ring', timeout=8000)

    async def exam_flow(self):
        p = self.page
        await self.goto('#/examen')
        await p.check('input[name=mode][value=corto]'); await p.uncheck('#proctor'); await p.click('#go')
        folio = await p.evaluate("document.querySelector('.keybox div').textContent")
        await p.fill('#f', folio.lower()); await p.check('#ine'); await p.click('#next')
        for bx in await p.query_selector_all('[data-r]'): await bx.check()
        await p.click('#next'); await p.check('#ok'); await p.click('#start')
        await p.wait_for_selector('.exam-shell', timeout=8000)
        ov = await p.query_selector('#fsback')
        if ov: await ov.click()
        for i in range(30):
            await p.keyboard.press('abc'[i % 3]); await p.wait_for_timeout(40)
            if i == 3: await p.click('#mark')
            if i < 29: await p.keyboard.press('ArrowRight')
        await p.click('#finish'); await p.wait_for_selector('.modal'); await p.locator('.modal .btn.primary').last.click()
        await p.wait_for_selector('#seeres', timeout=10000); await p.click('#seeres')
        await p.wait_for_selector('.score-ring', timeout=8000)
        txt = await p.inner_text('#view')
        if 'de 30 puntos' not in txt: raise Exception('El resultado no muestra la equivalencia sobre 30 puntos')
        self.result_route = '#' + p.url.split('#', 1)[1]

    async def bug_flow(self):
        p = self.page
        await self.goto('#/')
        await p.click('#bug'); await p.wait_for_selector('.modal')
        await p.fill('#bd', 'Reporte automático del chequeo nocturno.'); await p.click('.modal .btn.primary')
        await p.wait_for_selector('.toast', timeout=4000)

    async def calc_flow(self):
        p = self.page
        await self.goto('#/proceso/puntaje')
        await p.check('input[name=fdp][value=a]'); await p.fill('#pn', '9.2'); await p.fill('#hc', '120')
        await p.check('#pr'); await p.fill('#me', '14'); await p.select_option('#in', 'rural')
        await p.evaluate("document.querySelector('#ex').value = 65; document.querySelector('#ex').dispatchEvent(new Event('input'))")
        await p.wait_for_timeout(300)
        tot = (await p.inner_text('#tot')).strip()
        if tot != '75.16': raise Exception(f'La calculadora dio {tot} y debía dar 75.16')

    async def run(self, chromium):
        exe = '/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None
        b = await chromium.launch(executable_path=exe, args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
        for vw, tag in [((1366, 860), 'escritorio'), ((390, 844), 'celular')]:
            if tag == 'celular' and self.rapido: break
            ctx = await b.new_context(viewport={'width': vw[0], 'height': vw[1]}, is_mobile=tag == 'celular', has_touch=tag == 'celular', permissions=['camera', 'microphone'])
            await ctx.add_init_script(INIT)
            self.page = await ctx.new_page()
            self.page.on('pageerror', lambda e: self.jserr.append(str(e)[:200]))
            self.page.on('console', lambda m: self.jserr.append(m.text[:200]) if m.type == 'error' and 'favicon' not in m.text else None)
            # Pantalla de entrada
            await self.session(signed=False)
            await self.page.goto(self.base + '?entrada')
            await self.page.wait_for_selector('#g', timeout=10000)
            self.pages.append(f'Entrada ({tag})')
            # Usuario normal
            self.base_snap = None
            await self.session(role='user')
            self.result_route = None
            await self.flow(f'Práctica de 5 reactivos ({tag})', self.practice_flow)
            await self.flow(f'Simulacro corto completo ({tag})', self.exam_flow)
            await self.flow(f'Calculadora de puntaje ({tag})', self.calc_flow)
            await self.flow(f'Reportar una falla ({tag})', self.bug_flow)
            routes = [('#/', 'Inicio'), ('#/examen', 'Examen'), ('#/practica', 'Práctica'), ('#/estudio', 'Estudio'), ('#/estudio/D01', 'Ficha de estudio'),
                      ('#/guia', 'Cómo es el examen'), ('#/proceso', 'Proceso: fechas y requisitos'), ('#/proceso/puntaje', 'Proceso: calculadora'),
                      ('#/proceso/plan', 'Proceso: plan'), ('#/calendario', 'Calendario'), ('#/historial', 'Historial'), ('#/perfil', 'Perfil')]
            if self.result_route: routes.append((self.result_route, 'Resultado de simulacro'))
            await self.save_base()
            if tag == 'celular': routes = routes[:3] + routes[6:10]
            for r, n in routes:
                await self.check_route(r, f'{n} ({tag})')
            if tag == 'escritorio':
                # Administrador
                await self.session(role='admin'); await self.save_base()
                for k, n in [('resumen', 'Resumen'), ('usuarios', 'Usuarios'), ('correos', 'Correos'), ('pagos', 'Pagos'), ('equipos', 'Equipos'), ('reportes', 'Reportes'), ('errores', 'Errores'), ('contenido', 'Contenido')]:
                    await self.check_route(f'#/admin/{k}', f'Administración → {n}')
                # Cuenta pendiente con cobro activo (pantalla de pago)
                self.base_snap = None
                await self.session(role='user', status='pending', payments=True)
                if await self.goto('', ready='.pay-card, #view .page-head, .card'):
                    self.pages.append('Pantalla de pago')
                    btn = await self.page.query_selector('#pay, .pay-card .btn.primary')
                    if not btn: self.fail('Pantalla de pago', 'No aparece el botón para pagar')
                # Cuenta vinculada a otro dispositivo
                await self.session(role='user', bound=True)
                await self.page.goto(self.base + '?bloqueo')
                try:
                    await self.page.wait_for_selector('text=Esta cuenta ya está abierta en otro dispositivo', timeout=9000)
                    self.pages.append('Bloqueo por otro dispositivo')
                    if not await self.page.query_selector('a.btn[href^="mailto:"]'): self.fail('Bloqueo por otro dispositivo', 'Falta el botón para escribir por correo')
                except Exception:
                    self.fail('Bloqueo por otro dispositivo', 'No aparece la pantalla de bloqueo')
            await ctx.close()
        await b.close()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(Path(tempfile.gettempdir()) / 'simad_chequeo'))
    ap.add_argument('--rapido', action='store_true')
    a = ap.parse_args()
    t0 = time.time()
    issues, info = static_checks()
    site = build_site()
    httpd, base = serve(site)
    from playwright.async_api import async_playwright
    ch = Checker(base, a.out, a.rapido)
    for msg in issues: ch.fail('Revisión del código', msg)
    async with async_playwright() as p:
        await ch.run(p.chromium)
    httpd.shutdown(); shutil.rmtree(site, ignore_errors=True)
    rep = {'version': info['version'], 'duracion_seg': round(time.time() - t0), 'pantallas': len(ch.pages), 'botones_probados': ch.buttons,
           'flujos_ok': ch.flows, 'fallas': ch.fails, 'avisos': ch.warns, 'contrato_api': info}
    Path(a.out).mkdir(parents=True, exist_ok=True)
    (Path(a.out) / 'reporte.json').write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
    lines = [f"# Chequeo de SIMAD {info['version']}", '',
             f"Pantallas revisadas: {len(ch.pages)} · Botones probados: {ch.buttons} · Flujos completos: {len(ch.flows)} · Fallas: {len(ch.fails)} · Avisos: {len(ch.warns)}", '']
    if ch.fails: lines += ['## Fallas'] + [f"- **{f['donde']}**: {f['que']}" for f in ch.fails] + ['']
    if ch.warns: lines += ['## Avisos (revisar, pueden ser normales)'] + [f'- {w}' for w in ch.warns] + ['']
    lines += ['## Flujos que funcionaron'] + [f'- {f}' for f in ch.flows]
    (Path(a.out) / 'reporte.md').write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))
    print(f"\nReporte: {Path(a.out) / 'reporte.md'}")
    sys.exit(1 if ch.fails else 0)


if __name__ == '__main__':
    asyncio.run(main())
