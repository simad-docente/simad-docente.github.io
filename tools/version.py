"""Pone la misma versión en config.js, index.html y en todas las importaciones internas,
para que el navegador nunca mezcle archivos viejos y nuevos. Uso: python3 tools/version.py 1.1.1"""
import re, sys, pathlib
v = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent
for js in (root / 'assets/js').glob('*.js'):
    s = js.read_text(encoding='utf-8')
    s = re.sub(r"(from\s+'\./[a-z]+\.js)(\?v=[0-9.]+)?'", lambda m: f"{m.group(1)}?v={v}'", s)
    s = re.sub(r"(import\('\./[a-z]+\.js)(\?v=[0-9.]+)?'", lambda m: f"{m.group(1)}?v={v}'", s)
    if js.name == 'config.js':
        s = re.sub(r"version: '[^']+'", f"version: '{v}'", s)
    js.write_text(s, encoding='utf-8')
idx = root / 'index.html'
s = idx.read_text(encoding='utf-8')
s = re.sub(r"\?v=[0-9.]+(\"></script>|\">)", lambda m: f"?v={v}{m.group(1)}", s)
s = s.replace('assets/vendor/supabase.js?v=' + v, 'assets/vendor/supabase.js?v=2.119.0')
idx.write_text(s, encoding='utf-8')
print('versión', v)
