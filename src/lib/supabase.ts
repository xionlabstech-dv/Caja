import { createClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_ vars are embedded in the client bundle — safe as fallbacks
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://mzbicxpiyfjfamstplqm.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_VcTkKDtvLzibrPlbfeg63A_vahbZb_d';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // La sesión debe sobrevivir cortes de conexión y reaperturas de la PWA:
    // persistSession guarda el JWT en localStorage (lectura sin red al
    // reabrir); autoRefreshToken reintenta renovarlo en segundo plano sin
    // desloguear al usuario si el refresh falla solo por falta de red.
    persistSession: true,
    autoRefreshToken: true,
  },
});
