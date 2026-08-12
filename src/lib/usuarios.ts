import { supabase } from './supabase';
import { Rol } from '@/types';

export interface UsuarioNegocio {
  id: string;
  nombre: string | null;
  email: string;
  rol: Rol;
  activo: boolean;
}

export async function listarUsuarios(): Promise<UsuarioNegocio[] | null> {
  try {
    const { data, error } = await supabase.rpc('listar_usuarios_negocio');
    if (error) throw error;
    return (data ?? []) as UsuarioNegocio[];
  } catch {
    return null;
  }
}

export interface CrearUsuarioInput {
  usuario: string;
  password: string;
  nombre: string;
  rol: Rol;
  negocioId: string;
}

type ResultadoFuncion = { ok: true } | { ok: false; error: string };

// Con un status no-2xx, supabase-js devuelve data:null y el body de nuestra
// respuesta (con el mensaje real) viaja en error.context, que es la Response
// cruda — hay que leerla aparte. Compartido por toda función que invoque un
// Edge Function de este módulo.
async function invocarFuncion<T extends object>(nombre: string, body: T, mensajeDefecto: string): Promise<ResultadoFuncion> {
  try {
    const { data, error } = await supabase.functions.invoke(nombre, { body: body as unknown as Record<string, unknown> });
    if (error) {
      let mensaje = mensajeDefecto;
      const context = (error as { context?: Response }).context;
      if (context) {
        try {
          const respBody = await context.clone().json();
          if (respBody?.error) mensaje = respBody.error;
        } catch {
          // el body no era JSON parseable — se queda el mensaje genérico
        }
      }
      return { ok: false, error: mensaje };
    }
    if (data?.error) {
      return { ok: false, error: data.error as string };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo conectar. Verifica tu conexión.' };
  }
}

export async function crearUsuario(input: CrearUsuarioInput): Promise<ResultadoFuncion> {
  return invocarFuncion('crear-usuario', input, 'No se pudo crear el usuario');
}

export async function eliminarUsuario(usuarioId: string): Promise<ResultadoFuncion> {
  return invocarFuncion('eliminar-usuario', { usuarioId }, 'No se pudo eliminar el usuario');
}

export async function cambiarRol(id: string, rol: Rol): Promise<boolean> {
  try {
    const { error } = await supabase.from('perfiles').update({ rol }).eq('id', id);
    if (error) throw error;
    return true;
  } catch {
    return false;
  }
}

export async function cambiarActivo(id: string, activo: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.from('perfiles').update({ activo }).eq('id', id);
    if (error) throw error;
    return true;
  } catch {
    return false;
  }
}
