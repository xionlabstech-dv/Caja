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

export async function crearUsuario(input: CrearUsuarioInput): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('crear-usuario', {
      body: input,
    });
    if (error) {
      // Con un status no-2xx, supabase-js devuelve data:null y el body de
      // nuestra respuesta (con el mensaje real) viaja en error.context, que
      // es la Response cruda — hay que leerla aparte.
      let mensaje = 'No se pudo crear el usuario';
      const context = (error as { context?: Response }).context;
      if (context) {
        try {
          const body = await context.clone().json();
          if (body?.error) mensaje = body.error;
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
