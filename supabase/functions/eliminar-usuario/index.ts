// Edge Function: eliminar-usuario
//
// auth.admin.deleteUser() requiere service_role, igual que la creación —
// no puede viajar en el bundle del cliente. Borra al usuario de auth.users
// (la fila de perfiles cae sola por ON DELETE CASCADE vía perfiles_id_fkey).
//
// Las ventas y cierres del usuario NO se tocan: usuario_id queda con un
// valor que ya no resuelve a ningún perfil (se muestra como "—" en la UI),
// pero usuario_nombre es un snapshot tomado al momento de la venta/cierre,
// así que el histórico conserva el nombre aunque el usuario ya no exista.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'No autorizado' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'No autorizado' }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: perfilAdmin, error: perfilError } = await supabaseAdmin
      .from('perfiles')
      .select('negocio_id, rol, activo')
      .eq('id', user.id)
      .single();

    if (perfilError || !perfilAdmin) {
      return jsonResponse({ error: 'Perfil no encontrado' }, 403);
    }
    if (!perfilAdmin.activo) {
      return jsonResponse({ error: 'Tu usuario está desactivado' }, 403);
    }
    if (perfilAdmin.rol !== 'admin') {
      return jsonResponse({ error: 'Solo un administrador puede eliminar usuarios' }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return jsonResponse({ error: 'Cuerpo de la solicitud inválido' }, 400);
    }
    const { usuarioId } = body as { usuarioId?: string };
    if (typeof usuarioId !== 'string' || !usuarioId) {
      return jsonResponse({ error: 'usuarioId inválido' }, 400);
    }

    if (usuarioId === user.id) {
      return jsonResponse({ error: 'No puedes eliminar tu propia cuenta' }, 400);
    }

    const { data: perfilObjetivo, error: objetivoError } = await supabaseAdmin
      .from('perfiles')
      .select('negocio_id')
      .eq('id', usuarioId)
      .single();

    if (objetivoError || !perfilObjetivo) {
      return jsonResponse({ error: 'Usuario no encontrado' }, 404);
    }
    if (perfilObjetivo.negocio_id !== perfilAdmin.negocio_id) {
      return jsonResponse({ error: 'No puedes eliminar usuarios de otro negocio' }, 403);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(usuarioId);
    if (deleteError) {
      return jsonResponse({ error: 'No se pudo eliminar el usuario' }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch {
    return jsonResponse({ error: 'Error inesperado al eliminar el usuario' }, 500);
  }
});
