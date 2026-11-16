// Configuración pública del simulador (la llave publicable es segura en el navegador; la seguridad está en las reglas de la base de datos)
export const CONFIG = {
  appName: 'Simulador de Admisión Docente',
  appShort: 'SIMAD',
  level: 'Educación Primaria · Ciclo de preparación 2027-2028',
  supabaseUrl: 'https://qoctovzzguzrdwcwuofm.supabase.co',
  supabaseKey: 'sb_publishable_p9gBHPp8ErzWq5v0TBPXcw_CDxM6zVe',
  examTotal: 90,
  examMinutes: 240,
  shortTotal: 30,
  maxIncidents: 3,
  heartbeatMs: 45000,
  contactEmail: 'joseloploe27@gmail.com',
  webhookUrl: 'https://qoctovzzguzrdwcwuofm.supabase.co/functions/v1/mp-webhook',
  version: '1.3.0'
};
