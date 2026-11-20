# Chequeo automático de SIMAD

`run_checks.py` revisa el sitio completo sobre una copia local con una API simulada y datos ficticios
(`mock.js` y `mock-data.js`). No usa la base de datos real ni toca a los usuarios.

Qué revisa:

- **Código:** que todos los archivos usen la misma versión y que no falten módulos. También lista las funciones
  del servidor que llama la página, para compararlas con las que existen en Supabase.
- **Pantallas:** que cada pantalla cargue sin errores, en computadora y en celular.
- **Botones:** que cada botón y enlace haga algo al pulsarlo (cambiar la pantalla, abrir una ventana, mostrar un aviso
  o llamar al servidor). Si abre una confirmación, también acepta y revisa que se haga la acción.
- **Flujos completos:** práctica, simulacro corto, calculadora de puntaje y reporte de fallas.
- **Pantallas especiales:** la de pago y la de cuenta abierta en otro dispositivo.

Uso:

```
pip install playwright --break-system-packages   # solo si no está instalado
python3 tests/run_checks.py --out /tmp/simad_chequeo
```

El resultado queda en `reporte.md` y `reporte.json`, y hay una captura de cada falla en `fallas/`.
Si hay fallas, el programa termina con código 1. Con `--rapido` hace una revisión más corta, solo en computadora.
