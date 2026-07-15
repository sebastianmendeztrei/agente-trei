import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase";
import { guardSelectQuery, UnsafeQueryError } from "@/lib/sql-guard";
import { chatTools } from "@/lib/tools";

const SYSTEM_PROMPT = `Eres un asistente de inteligencia de negocios para una empresa.
Respondes preguntas en lenguaje natural sobre datos comerciales (ventas, clientes,
leads, proyectos, etc.) usando EXCLUSIVAMENTE la informacion disponible en la
base de datos, a traves de las tools que tienes disponibles.

Reglas:
- Nunca inventes datos ni cifras. Si no puedes obtener la informacion con las
  tools disponibles, dilo claramente.
- Antes de escribir una consulta, si no conoces la estructura de las tablas,
  usa la tool get_schema.
- Usa siempre COUNT/SUM/AVG/GROUP BY y LIMIT en tus consultas para traer solo
  lo necesario, nunca miles de filas crudas.
- Solo puedes ejecutar consultas SELECT. Cualquier otra operacion sera
  rechazada automaticamente.
- Responde en espanol, de forma clara y concisa, citando las cifras relevantes.`;

const MAX_TOOL_ITERATIONS = 6;

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
    const { data, error } = await supabase.rpc("get_public_schema");
    if (error) {
      return JSON.stringify({ error: error.message });
    }
    return JSON.stringify(data);
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
