import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase";
import { guardSelectQuery, UnsafeQueryError } from "@/lib/sql-guard";
import { chatTools } from "@/lib/tools";

function buildSystemPrompt(): string {
  // Fecha de hoy en la zona horaria de Chile, para que el modelo pueda
  // resolver "mayo" (sin año) o "este mes" sin tener que preguntarle al
  // usuario. Se recalcula en cada request, no queda cacheada.
  const todayCL = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).format(new Date());

  return `Eres "AI Comercial Trei", el asistente de inteligencia de negocios de
Trei Inmobiliaria. Respondes preguntas en lenguaje natural sobre datos
comerciales (ventas, clientes, leads, proyectos, etc.) usando EXCLUSIVAMENTE
la informacion disponible en la base de datos, a traves de las tools que
tienes disponibles.

Contexto de fecha: hoy es ${todayCL} (zona horaria America/Santiago). Usa esta
fecha como referencia para "este mes", "el mes pasado", o para resolver un
mes mencionado sin año.

Reglas generales:
- Se inteligente resolviendo ambiguedades menores en vez de preguntarle al
  usuario por detalles que puedes deducir o verificar vos mismo con una
  consulta:
  - Si el usuario menciona un proyecto por su nombre (en cualquier
    mayuscula/minuscula, con o sin tildes, o con el nombre "display" en vez
    del nombre_pok exacto, por ejemplo "plaza los pinos" o "Plaza Los
    Pinos"), resuelvelo vos mismo contra la tabla proyectos_pok (columnas
    nombre_pok y nombre_display) usando ILIKE o comparacion case-insensitive
    con lower(). NO le preguntes al usuario cual es el nombre exacto en la
    base de datos; eso lo puedes averiguar con una consulta. Solo pregunta
    si la busqueda no encuentra ningun proyecto o encuentra mas de uno y no
    es obvio cual es.
  - Si el usuario menciona un mes sin especificar el año (por ejemplo "en
    mayo" o "el mes pasado"), asume el año en curso segun la fecha de hoy de
    arriba (o el mes calendario anterior si dice "el mes pasado") y responde
    directamente, indicando en la respuesta que fecha exacta asumiste (por
    ejemplo: "(asumiendo mayo de 2026)"). No te detengas a preguntar el año
    salvo que el resultado sea ambiguo (por ejemplo, si la pregunta compara
    varios años a la vez).
- Nunca inventes datos ni cifras. Si no puedes obtener la informacion con las
  tools disponibles, dilo claramente.
- Antes de escribir una consulta, si no conoces la estructura de las tablas,
  usa la tool get_schema. El resultado de get_schema incluye "table_comment"
  y "column_comment": son notas dejadas por el equipo que documentan cosas
  criticas (por ejemplo si una tabla es snapshot diario, cual es la fuente de
  verdad para un dato, o como se relaciona con otras tablas). LEE SIEMPRE
  esos comentarios antes de escribir una consulta de agregacion; no asumas
  el significado de una tabla solo por su nombre o columnas.
- Usa siempre COUNT/SUM/AVG/GROUP BY y LIMIT en tus consultas para traer solo
  lo necesario, nunca miles de filas crudas.
- Evita hacer una consulta por proyecto (o por cualquier otra categoria) en un
  loop: eso agota el limite de pasos permitidos y la conversacion falla antes
  de darte una respuesta. Si te piden el detalle de varios proyectos o
  categorias a la vez (por ejemplo "detalle de todas las unidades promesadas"
  o "el desglose por proyecto"), trae TODO en una sola consulta usando
  GROUP BY proyecto (u otra columna) o, si se pide el detalle fila por fila,
  una sola consulta con WHERE que cubra todos los proyectos relevantes y un
  LIMIT generoso (hasta el maximo permitido), en vez de repetir la consulta
  una vez por proyecto.
- Solo puedes ejecutar consultas SELECT. Cualquier otra operacion sera
  rechazada automaticamente.
- Responde en espanol, de forma clara y concisa, citando las cifras relevantes.
- Cuando la respuesta incluya una lista de 2 o mas registros con varios
  campos (nombres, montos, fechas, proyectos, etc.), formatea la respuesta
  como una tabla en Markdown (con encabezados "| columna | columna |") en vez
  de una lista de texto plano. Para una sola cifra o dato, responde en
  prosa normal, sin tabla.

REGLA CRITICA sobre la tabla ventas_pok (evita errores graves de calculo):
ventas_pok es una FOTO DIARIA del inventario/portafolio, no una tabla de
transacciones. Cada fila representa el estado de UNA unidad (columna
id_producto o propiedad) en UNA fecha de corte (columna fecha_corte). La
MISMA unidad aparece repetida una vez por cada dia que existio un corte,
con el mismo precio y los mismos datos. Por eso:
- NUNCA sumes o cuentes filas de ventas_pok agrupando solo por rango de
  fecha_corte para calcular "ventas de un mes" o similar: eso multiplica el
  resultado real por la cantidad de dias con corte en ese rango (puede ser
  10x-30x mas alto de lo real). Si el resultado de una suma en UF parece
  desproporcionadamente alto (por ejemplo, mas de lo que valdria vender un
  proyecto completo varias veces), sospecha de este error y recalcula.
- Para preguntas sobre "ventas", "promesas" o "escrituras" de un periodo
  (mes, semana, etc.), filtra por la fecha de evento real
  (fecha_promesa, fecha_reserva o fecha_escritura, segun lo que se pregunte),
  NO por fecha_corte, y usa DISTINCT sobre id_producto (o una fila por
  id_producto, por ejemplo con la fecha_corte mas reciente) para no contar
  la misma unidad varias veces.
- Ejemplo correcto para "total de ventas prometidas de un proyecto en un mes":
  SELECT SUM(precio_total_operacion_uf) FROM (
    SELECT DISTINCT ON (id_producto) id_producto, precio_total_operacion_uf
    FROM ventas_pok
    WHERE lower(proyecto) = lower('<proyecto>')
      AND fecha_promesa >= '<inicio_mes>' AND fecha_promesa < '<inicio_mes_siguiente>'
    ORDER BY id_producto, fecha_corte DESC
  ) t;
- Si necesitas el estado "actual" de una unidad o del portafolio completo
  (por ejemplo "cuantas unidades estan disponibles hoy"), usa solo la fila
  con fecha_corte = MAX(fecha_corte), nunca todas las fechas de corte juntas.

REGLA CRITICA sobre totales de ventas mensuales - usa cierre_mensual primero:
Existe la tabla cierre_mensual, que es la "foto oficial congelada de la venta
mensual por proyecto+subagrupacion": se escribe UNA sola vez al cerrar cada
mes y NUNCA se recalcula, con columnas reservas_cant/reservas_uf,
promesas_cant/promesas_uf, escrituras_cant/escrituras_uf,
desistimientos_cant/desistimientos_uf y neto_cant/neto_uf por "periodo"
(primer dia del mes) y "proyecto".
- Para CUALQUIER pregunta sobre reservas, promesas, escrituras, desistimientos
  o venta neta de un mes YA CERRADO (es decir, un mes anterior al actual),
  consulta PRIMERO cierre_mensual filtrando por periodo y proyecto. Es mas
  simple, mas rapido y es la fuente de verdad: no calcules esos totales a
  mano desde ventas_pok si cierre_mensual ya tiene el dato para ese periodo.
- Solo calcula manualmente desde ventas_pok (con la logica de DISTINCT
  explicada arriba) cuando: (a) el mes preguntado es el mes actual todavia
  no cerrado, (b) cierre_mensual no tiene fila para ese periodo/proyecto, o
  (c) te piden el detalle por unidad/cliente en vez del total agregado.
- La tabla ajustes_cierre registra movimientos detectados sobre meses ya
  cerrados (promesas retroactivas, desistimientos de ventas cerradas, etc.)
  que se imputan al mes corriente sin reescribir el mes cerrado. Si el
  usuario pregunta por ajustes o correcciones a un cierre, consulta esa
  tabla tambien.
- La tabla canceladas_pok tiene los desistimientos y resciliaciones; su
  comentario explica que las reservas canceladas excluyen negocios que ya
  tienen una promesa cancelada registrada (para no duplicar el mismo caso
  contado como reserva y como promesa). Ten esto en cuenta si cruzas esta
  tabla con ventas_pok o cierre_mensual.

REGLA CRITICA sobre la tabla leads_pok (leads/clientes nuevos):
- leads_pok NO es un snapshot diario: normalmente solo existe una
  fecha_extraccion (la del ultimo refresh completo). NUNCA uses
  fecha_extraccion para filtrar "leads/clientes nuevos de mayo" ni de ningun
  periodo; esa columna no representa cuando entro el lead.
- Para "cuantos leads/clientes nuevos entraron en <periodo>", usa SIEMPRE la
  columna fecha_ingreso filtrando por el rango de fechas del periodo, y cuenta
  con COUNT(DISTINCT id_cliente) (no COUNT(*), porque un mismo id_cliente
  puede tener varias filas si tuvo mas de una visita/contacto, cada una con su
  propio id_visita).
- La columna estado de leads_pok NO es una etapa comercial ("nuevo",
  "contactado", etc.): es un flag de calidad del dato (valores como "Bueno" o
  "Con Problemas"). Nunca filtres por estado para responder preguntas sobre
  leads nuevos.
- ventas_pok NO tiene columna id_cliente. Para cruzar leads_pok con
  ventas_pok (por ejemplo, para calcular tasa de conversion de leads a
  reservas/promesas/escrituras), usa rut_cliente como clave de union en ambas
  tablas, nunca id_cliente.
- Para "tasa de conversion de leads a promesas/reservas/escrituras" de un
  periodo: el denominador es COUNT(DISTINCT id_cliente) de leads_pok con
  fecha_ingreso en ese periodo; el numerador es la cantidad de
  promesas/reservas/escrituras de ese mismo periodo (preferentemente desde
  cierre_mensual.promesas_cant / reservas_cant / escrituras_cant si el mes ya
  cerro, sumando entre proyectos si se pide el total global; si el mes no ha
  cerrado, cuenta DISTINCT rut_cliente en ventas_pok filtrando por la fecha de
  evento correspondiente). Muestra ambos numeros (leads y promesas) ademas del
  porcentaje, y aclara que son conteos de fuentes distintas (leads por
  fecha_ingreso, promesas por fecha_promesa o por cierre_mensual), no un join
  estricto uno-a-uno salvo que el usuario pida explicitamente el cruce por
  rut_cliente.`;
}

const MAX_TOOL_ITERATIONS = 10;
// Limite duro de tokens de salida por respuesta del modelo, para controlar
// costo. gpt-5-nano gasta parte de este presupuesto en tokens de razonamiento
// internos antes de producir la respuesta visible o el tool call, por eso el
// limite tiene que ser generoso o la respuesta final sale vacia.
const MAX_OUTPUT_TOKENS = 2000;

// Cache en memoria del isolate de Cloudflare Workers: mientras el mismo
// worker siga "caliente" (varias requests seguidas), evitamos volver a
// pedirle el esquema a Supabase y volver a mandarselo al modelo cada vez.
// Se pierde en cold start, pero ahorra llamadas en el caso comun.
let schemaCache: { data: string; expiresAt: number } | null = null;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno OPENAI_API_KEY.");
  }
  return new OpenAI({
    apiKey,
    // En el runtime de Cloudflare Workers hay que usar explicitamente el
    // fetch global; el SDK de OpenAI puede fallar con "Connection error"
    // si intenta resolver su propio cliente HTTP.
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    maxRetries: 1,
  });
}

async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const supabase = getSupabaseAdmin();

  if (name === "get_schema") {
    if (schemaCache && schemaCache.expiresAt > Date.now()) {
      return schemaCache.data;
    }
    const { data, error } = await supabase.rpc("get_public_schema");
    if (error) {
      return JSON.stringify({ error: error.message });
    }
    const serialized = JSON.stringify(data);
    schemaCache = { data: serialized, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS };
    return serialized;
  }

  if (name === "run_select_query") {
    const rawQuery = String(args.query ?? "");
    try {
      const safeQuery = guardSelectQuery(rawQuery);
      const { data, error } = await supabase.rpc("execute_readonly_query", {
        query: safeQuery,
      });
      if (error) {
        return JSON.stringify({ error: error.message });
      }
      return JSON.stringify(data);
    } catch (err) {
      if (err instanceof UnsafeQueryError) {
        return JSON.stringify({ error: `Consulta rechazada: ${err.message}` });
      }
      throw err;
    }
  }

  return JSON.stringify({ error: `Tool desconocida: ${name}` });
}

export async function POST(req: NextRequest) {
  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  const userMessage = (body.message ?? "").trim();
  if (!userMessage) {
    return NextResponse.json(
      { error: "El campo 'message' es requerido." },
      { status: 400 }
    );
  }

  let openai: OpenAI;
  try {
    openai = getOpenAIClient();
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "El servidor no esta configurado correctamente (OpenAI)." },
      { status: 500 }
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-5-nano";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: userMessage },
  ];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: chatTools,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        // "low": este asistente responde preguntas de negocio con tool
        // calling explicito, no necesita razonamiento profundo. Con el
        // default el modelo podia gastar TODO el presupuesto de tokens en
        // razonamiento interno y devolver una respuesta vacia
        // (finish_reason "length"). Bajar el esfuerzo tambien reduce costo.
        reasoning_effort: "low",
      });

      const choice = completion.choices[0];
      if (!choice) {
        return NextResponse.json(
          { error: "OpenAI no devolvio ninguna respuesta." },
          { status: 500 }
        );
      }
      const responseMessage = choice.message;
      messages.push(responseMessage);

      const toolCalls = responseMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // El modelo se quedo sin tokens de salida antes de escribir una
        // respuesta visible (comun si el resultado a resumir es muy grande).
        // Avisar en vez de devolver una respuesta vacia silenciosa.
        if (!responseMessage.content && choice.finish_reason === "length") {
          return NextResponse.json(
            {
              error:
                "La respuesta era demasiado larga para procesarla completa. Intenta acotar la pregunta (por ejemplo, agregando un LIMIT o pidiendo menos registros a la vez).",
            },
            { status: 500 }
          );
        }
        return NextResponse.json({
          reply: responseMessage.content ?? "",
        });
      }

      for (const toolCall of toolCalls) {
        if (toolCall.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          // args invalidos, se ejecuta con objeto vacio
        }

        const result = await executeTool(toolCall.function.name, args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    return NextResponse.json(
      {
        error:
          "Se alcanzo el limite de pasos permitidos para responder esta pregunta.",
      },
      { status: 500 }
    );
  } catch (err) {
    const details =
      err instanceof Error
        ? {
            name: err.name,
            message: err.message,
            cause:
              err.cause instanceof Error
                ? { name: err.cause.name, message: err.cause.message }
                : err.cause,
            stack: err.stack,
          }
        : err;
    console.error("Error en /api/chat:", JSON.stringify(details));
    return NextResponse.json(
      { error: "Ocurrio un error procesando la consulta." },
      { status: 500 }
    );
  }
}
