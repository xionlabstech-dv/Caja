// Edge Function: crear-usuario
//
// auth.admin.createUser() requiere service_role, que nunca puede viajar en
// el bundle del cliente — por eso esto vive como función server-side.
//
// Flujo: valida que quien llama es un admin activo del negocio destino,
// valida los datos del nuevo usuario, verifica el límite de usuarios
// activos, crea el usuario en auth y su fila en perfiles. Si el insert en
// perfiles falla, borra el usuario de auth recién creado (nunca dejar un
// usuario huérfano sin perfil).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Debe coincidir con LIMITE_USUARIOS_POR_NEGOCIO en src/lib/roles.ts —
// viven en runtimes/despliegues distintos (esta función y el cliente Next.js
// no comparten build), así que el valor se mantiene sincronizado a mano.
const LIMITE_USUARIOS_POR_NEGOCIO = 3;

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

    // Cliente con el JWT de quien llama — solo para confirmar su identidad.
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseCaller.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'No autorizado' }, 401);
    }

    // Cliente con service_role — para las operaciones privilegiadas.
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
      return jsonResponse({ error: 'Solo un administrador puede crear usuarios' }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return jsonResponse({ error: 'Cuerpo de la solicitud inválido' }, 400);
    }
    const { usuario, password, nombre, rol, negocioId } = body as {
      usuario?: string; password?: string; nombre?: string; rol?: string; negocioId?: string;
    };

    // Un admin NUNCA puede crear usuarios en otro negocio, ni siquiera
    // manipulando el payload del cliente.
    if (negocioId !== perfilAdmin.negocio_id) {
      return jsonResponse({ error: 'No puedes crear usuarios en otro negocio' }, 403);
    }

    if (typeof usuario !== 'string' || !/^[a-zA-Z0-9-]+$/.test(usuario)) {
      return jsonResponse({ error: 'Usuario inválido: solo letras, números y guiones, sin espacios' }, 400);
    }
    if (typeof password !== 'string' || password.length < 6) {
      return jsonResponse({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400);
    }
    if (typeof nombre !== 'string' || !nombre.trim()) {
      return jsonResponse({ error: 'El nombre es obligatorio' }, 400);
    }
    if (rol !== 'admin' && rol !== 'cajero') {
      return jsonResponse({ error: 'Rol inválido' }, 400);
    }

    const { count, error: countError } = await supabaseAdmin
      .from('perfiles')
      .select('id', { count: 'exact', head: true })
      .eq('negocio_id', perfilAdmin.negocio_id)
      .eq('activo', true);

    if (countError) {
      return jsonResponse({ error: 'No se pudo verificar el límite de usuarios' }, 500);
    }
    if ((count ?? 0) >= LIMITE_USUARIOS_POR_NEGOCIO) {
      return jsonResponse(
        { error: `Ya alcanzaste el máximo de ${LIMITE_USUARIOS_POR_NEGOCIO} usuarios activos para este negocio` },
        400
      );
    }

    const email = `${usuario.trim().toLowerCase()}@caja.app`;

    const { data: nuevoUsuario, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !nuevoUsuario?.user) {
      const yaExiste = /already|registered|existe/i.test(createError?.message ?? '');
      return jsonResponse(
        { error: yaExiste ? 'Ese usuario ya existe' : (createError?.message || 'No se pudo crear el usuario') },
        400
      );
    }

    const { error: insertError } = await supabaseAdmin.from('perfiles').insert({
      id: nuevoUsuario.user.id,
      negocio_id: perfilAdmin.negocio_id,
      rol,
      nombre: nombre.trim(),
      activo: true,
      creado_por: user.id,
    });

    if (insertError) {
      // Rollback: nunca dejar un usuario de auth sin su perfil.
      await supabaseAdmin.auth.admin.deleteUser(nuevoUsuario.user.id);
      return jsonResponse({ error: 'No se pudo crear el perfil del usuario' }, 500);
    }

    return jsonResponse({ ok: true, id: nuevoUsuario.user.id }, 200);
  } catch {
    return jsonResponse({ error: 'Error inesperado al crear el usuario' }, 500);
  }
});
