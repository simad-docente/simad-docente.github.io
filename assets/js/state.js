// Estado compartido de la aplicación
export const state = {
  session: null,     // sesión de Supabase
  user: null,        // auth user
  profile: null,     // fila de profiles
  sid: null,         // identificador del dispositivo activo
  isAdmin: false,
  inExam: false,
  lastErrors: [],
  currentQuestion: null,
  stopSessionGuard: null
};
export function nav(path) {
  if (location.hash === path) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
}
