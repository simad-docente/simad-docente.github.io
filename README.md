# Simulador de Admisión Docente · Primaria (SIMAD)

Aplicación web para preparar el instrumento de apreciación de conocimientos y aptitudes del proceso de admisión en Educación Primaria (USICAMM). Es una herramienta de estudio independiente: los reactivos son originales y no provienen del examen oficial.

## Qué incluye

- **Simulacro completo**: 90 reactivos de tres opciones, 15 por subárea, 4 horas.
- **Simulacro corto**: 30 reactivos, 80 minutos.
- **Navegador seguro simulado**: pantalla completa, cámara y micrófono (solo en el equipo, nada se graba), detección de cambio de ventana, copiar y pegar, atajos, pantallas adicionales, ruido e iluminación; anulación al tercer incidente en modo estricto.
- **Práctica guiada** por subárea, por ficha o con los reactivos que se fallaron, con argumentación y referencia inmediatas.
- **Fichas de estudio** de los documentos de la bibliografía.
- **Calendario**, metas diarias, racha, historial con porcentaje de aciertos y tiempo de cada intento.
- **Cuentas con Google**, acceso solo por invitación, **una sesión activa por cuenta**.
- **Reportes de fallas** y registro automático de errores, con panel de administración.

## Arquitectura

- Sitio estático (HTML, CSS y JavaScript sin compilación) publicado en GitHub Pages.
- Supabase: autenticación con Google, base de datos Postgres con RLS y funciones `security definer` que califican en el servidor. El banco de reactivos no es legible desde el navegador; las respuestas correctas solo se devuelven al concluir un intento o en práctica.
- `assets/js/config.js` contiene la URL del proyecto y la llave publicable (es pública por diseño).

## Actualizar el banco de reactivos

Desde **Administración → Contenido**, importar el archivo `contenido_simulador.json` (no se incluye en este repositorio para no publicar las respuestas). La importación agrega o actualiza reactivos y fichas sin borrar el historial.

## Estructura

```
index.html
assets/css/app.css
assets/js/  app.js · api.js · exam.js · views.js · admin.js · secure.js · ui.js · state.js · config.js
assets/vendor/supabase.js   (supabase-js 2.119.0)
sql/        funciones y tablas de referencia
```
