import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase";
import { guardSelectQuery, UnsafeQueryError } from "@/lib/sql-guard";
import { chatTools } from "@/lib/tools";

const SYSTEM_PROMPT = `Eres "AI Comercial Trei", el asistente de inteligencia de negocios de
Trei Inmobiliaria. Respondes preguntas en lenguaje natural sobre datos
comerciales (ventas, clientes, leads, proyectos, etc.) usando EXCLUSIVAMENTE
la informacion disponible en la base de datos, a traves de las tools que
tienes disponibles.

Reglas generales:
- Nunca inventes datos ni cifras. Si no puedes obtener la informacion con las
  tools disponibles, dilo claramente.
- Antes de escribir una consulta, si no conoces la estructura de las tablas,
  usa la tool get_schema.
- Usa siempre COUNT/SUM/AVG/GROUP BY y LIMIT en tus consultas para traer solo
  lo necesario, nunca miles de filas crudas.
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
  con fecha_corte = MAX(fecha_corte), nunca todas las fechas de corte juntas.`;

const MAX_TOOL_ITERATIONS = 6;
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
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: chatTools,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
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
