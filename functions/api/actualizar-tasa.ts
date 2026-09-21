// Cloudflare Pages Function — GET/HEAD /api/actualizar-tasa
//
// Pensado para un disparador externo (UptimeRobot en plan gratuito, que
// solo hace GET/HEAD periódicos, sin headers personalizados) que actualiza
// la "tasa oficial" de todos los negocios a la vez, tomándola de una API
// externa (dolar-al-dia-api). Nunca corre lógica de negocio pesada: solo
// consulta la fuente y llama a una de dos RPCs de Supabase, ya resueltas
// del lado de la base (fn_actualizar_tasa_automatica_todos nunca baja la
// tasa de nadie — hace tasa = greatest(tasa, oficial) — y el piso mínimo
// se impone con un trigger en `configuracion`, no acá).
//
// No usa @supabase/supabase-js a propósito: es una llamada HTTP puntual a
// dos RPCs, y evitar la dependencia mantiene esta función mínima y sin
// nada que romper si el SDK cambia de versión en el resto de la app.

interface Env {
  TASA_UPDATE_TOKEN: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface Contexto {
  request: Request;
  env: Env;
}

// Proyecto de Supabase de Caja — no es secreto (es la URL pública del
// proyecto), así que se hardcodea acá en vez de sumar una env var más.
const SUPABASE_URL = 'https://mzbicxpiyfjfamstplqm.supabase.co';
const FUENTE_TASA_URL = 'https://dolar-al-dia-api.xionlabstech.workers.dev/';

interface RespuestaFuente {
  bcv?: { usd?: number };
  meta?: { bcv_ok?: boolean; bcv_error?: string | null };
}

// Acepta el token tanto por header Authorization: Bearer como por query
// ?token= — UptimeRobot gratis no manda headers personalizados, así que el
// query param es obligatorio, no un extra. Si TASA_UPDATE_TOKEN no está
// configurado, nunca autoriza nada (nunca "cualquier token vale").
function extraerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  const enHeader = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (enHeader) return enHeader;
  const url = new URL(request.url);
  return url.searchParams.get('token');
}

function tokenValido(request: Request, env: Env): boolean {
  if (!env.TASA_UPDATE_TOKEN) return false;
  const recibido = extraerToken(request);
  return recibido !== null && recibido === env.TASA_UPDATE_TOKEN;
}

// Nunca lanza: cualquier falla de red o de formato de la fuente externa se
// trata igual que "la fuente dijo que falló" — el caller decide qué RPC
// llamar a partir de esto, nunca de una excepción.
async function consultarFuente(): Promise<{ ok: boolean; usd: number | null }> {
  try {
    const res = await fetch(FUENTE_TASA_URL);
    if (!res.ok) return { ok: false, usd: null };
    const data = (await res.json()) as RespuestaFuente;
    const usd = data?.bcv?.usd;
    const ok = data?.meta?.bcv_ok === true && typeof usd === 'number' && usd > 0;
    return { ok, usd: ok && typeof usd === 'number' ? usd : null };
  } catch {
    return { ok: false, usd: null };
  }
}

interface ResultadoRpc {
  ok: boolean;
  // Solo se llenan cuando ok es false — con éxito no hace falta capturar
  // nada de la respuesta.
  status?: number;
  cuerpo?: string;
}

// Por si Supabase alguna vez devolviera algo que incluya el secreto (no
// debería — PostgREST no eco-envía headers de request en el cuerpo de
// error — pero esto va directo a una respuesta HTTP externa, así que se
// redacta igual, sin excepciones).
function redactar(texto: string | undefined, secreto: string): string | undefined {
  if (!texto || !secreto) return texto;
  return texto.split(secreto).join('[REDACTED]');
}

// Ambas RPC son SECURITY DEFINER y ejecutables solo por service_role — de
// ahí que esta función exista: el cliente (con la llave anon) nunca podría
// llamarlas. Nunca lanza: una falla acá se refleja en `rpc_ok` en la
// respuesta y hace que el endpoint responda 502 (ver `manejar` más abajo)
// — a diferencia de un fallo de la fuente externa, esto sí es una falla
// real que UptimeRobot debe detectar. Cuando falla, se captura el status y
// el cuerpo que respondió Supabase para poder diagnosticar sin tener que
// ir a mirar logs aparte (401 por key vencida no es lo mismo que 500 por
// un error en la RPC).
async function llamarRpc(
  nombre: string,
  env: Env,
  args: Record<string, unknown>
): Promise<ResultadoRpc> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(args),
    });
    if (res.ok) return { ok: true };
    const cuerpo = await res.text().catch(() => undefined);
    return { ok: false, status: res.status, cuerpo: redactar(cuerpo, env.SUPABASE_SERVICE_ROLE_KEY) };
  } catch (err) {
    return { ok: false, cuerpo: redactar((err as { message?: string }).message, env.SUPABASE_SERVICE_ROLE_KEY) };
  }
}

function jsonResponse(status: number, body: Record<string, unknown>, conCuerpo: boolean): Response {
  return new Response(conCuerpo ? JSON.stringify(body) : null, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function manejar({ request, env }: Contexto, conCuerpo: boolean): Promise<Response> {
  if (!tokenValido(request, env)) {
    return jsonResponse(401, { error: 'No autorizado' }, conCuerpo);
  }

  // Distinto de "la fuente externa falló": esto es un deploy mal
  // configurado, no un caso que el trigger/RPC ya sepan manejar.
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, conCuerpo);
  }

  const fuente = await consultarFuente();

  const resultadoRpc = fuente.ok && fuente.usd !== null
    ? await llamarRpc('fn_actualizar_tasa_automatica_todos', env, { p_tasa_oficial: fuente.usd })
    : await llamarRpc('fn_marcar_actualizacion_tasa_fallida_todos', env, {});

  const rpcLlamada = fuente.ok ? 'actualizar' : 'marcar_fallida';

  // Distinción clave: que la fuente externa (BCV) falle es un caso ya
  // manejado — pasa de vez en cuando, no es una emergencia, y por eso
  // sigue devolviendo 200 mientras la llamada a Supabase (la que
  // corresponda, actualizar o marcar_fallida) haya funcionado. Un 502 es
  // solo cuando esa llamada a Supabase en sí no respondió bien, sea cual
  // sea la RPC — eso sí es una falla real que UptimeRobot debe detectar.
  if (!resultadoRpc.ok) {
    return jsonResponse(
      502,
      {
        ok: false,
        tasa_oficial: fuente.usd,
        rpc: rpcLlamada,
        rpc_ok: false,
        error: `La llamada a ${rpcLlamada} en Supabase falló`,
        rpc_status: resultadoRpc.status,
        rpc_error: resultadoRpc.cuerpo,
      },
      conCuerpo
    );
  }

  return jsonResponse(
    200,
    { ok: fuente.ok, tasa_oficial: fuente.usd, rpc: rpcLlamada, rpc_ok: true },
    conCuerpo
  );
}

export async function onRequestGet(context: Contexto): Promise<Response> {
  return manejar(context, true);
}

export async function onRequestHead(context: Contexto): Promise<Response> {
  return manejar(context, false);
}
