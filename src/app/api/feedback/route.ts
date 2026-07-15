import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY.");
  return new OpenAI({
    apiKey,
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    maxRetries: 1,
  });
}

// Herramienta que el modelo de diagnostico puede usar para autocorregir un
// gap de documentacion de esquema. Es la UNICA escritura permitida en todo
// el sistema, y esta acotada a nivel de base de datos (set_column_comment
// solo puede tocar comentarios de columnas existentes, ver migracion).
const diagnosisTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_schema",
      description: "Devuelve el esquema actual (tablas, columnas, comentarios) de la base de datos.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "fix_column_comment",
      description:
        "Corrige o agrega el comentario (documentacion) de una columna existente en la base de datos, para que futuras respuestas del asistente no repitan el mismo error. Usar SOLO si el problema fue causado por falta de documentacion o documentacion enganosa sobre una columna/tabla (por ejemplo, el asistente uso la columna equivocada por no saber para que sirve cada una).",
      parameters: {
        type: "object",
        properties: {
          table: { type: "string", description: "Nombre de la tabla (schema public)." },
          column: { type: "string", description: "Nombre de la columna a documentar." },
          comment: {
            type: "string",
            description: "Nuevo comentario completo para la columna, explicando claramente para que sirve y como usarla correctamente.",
          },
        },
        required: ["table", "column", "comment"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_needs_human_review",
      description:
        "Usar cuando el problema NO se puede resolver documentando una columna: datos incorrectos, ambiguedad de negocio real, error de calculo que requiere cambiar la logica del asistente, etc. Marca el caso para que un humano lo revise.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Explicacion breve y clara de por que esto necesita revision humana." },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];

async function runDiagnosis(
  question: string,
  answer: string,
  executedQueries: string[]
): Promise<{ status: "auto_fixed" | "needs_review"; diagnosis: string; autoFixDetail?: string }> {
  const openai = getOpenAIClient();
  const supabase = getSupabaseAdmin();
  const model = process.env.OPENAI_MODEL || "gpt-5-nano";

  const systemPrompt = `Sos un diagnosticador tecnico para "AI Comercial Trei", un asistente de
datos que a veces comete errores. Un usuario marco una respuesta como
INCORRECTA (pulgar abajo). Tu trabajo es investigar la causa raiz y actuar:

1. Mira la pregunta del usuario, la respuesta que dio el asistente, y las
   consultas SQL que se ejecutaron para generarla.
2. Si necesitas ver el esquema y los comentarios actuales de las tablas
   involucradas, usa get_schema.
3. Si el error se debio a que una columna no estaba documentada o su
   comentario era enganoso/incompleto (por ejemplo, el asistente confundio
   fecha_extraccion con fecha_ingreso porque no sabia la diferencia), llama a
   fix_column_comment con un comentario corregido y claro que evite que se
   repita el error.
4. Si el error fue por otra razon (dato mal cargado en la base, ambiguedad de
   negocio genuina, error de calculo que no se explica por falta de
   documentacion, etc.), llama a mark_needs_human_review explicando por que.
5. Siempre terminá llamando a UNA de las dos tools (fix_column_comment o
   mark_needs_human_review). Nunca respondas solo con texto.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Pregunta del usuario: ${question}\n\nRespuesta del asistente: ${answer}\n\nConsultas SQL ejecutadas:\n${
        executedQueries.length ? executedQueries.map((q) => `- ${q}`).join("\n") : "(ninguna)"
      }`,
    },
  ];

  let schemaCache: string | null = null;

  for (let i = 0; i < 4; i++) {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools: diagnosisTools,
      max_completion_tokens: 1500,
      reasoning_effort: "low",
    });

    const choice = completion.choices[0];
    if (!choice) break;
    const responseMessage = choice.message;
    messages.push(responseMessage);

    const toolCalls = responseMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) break;

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        // ignore
      }

      if (toolCall.function.name === "get_schema") {
        if (!schemaCache) {
          const { data, error } = await supabase.rpc("get_public_schema");
          schemaCache = error ? JSON.stringify({ error: error.message }) : JSON.stringify(data);
        }
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: schemaCache });
        continue;
      }

      if (toolCall.function.name === "fix_column_comment") {
        const table = String(args.table ?? "");
        const column = String(args.column ?? "");
        const comment = String(args.comment ?? "");
        const { error } = await supabase.rpc("set_column_comment", {
          p_table: table,
          p_column: column,
          p_comment: comment,
        });
        if (error) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: error.message }),
          });
          continue;
        }
        return {
          status: "auto_fixed",
          diagnosis: `Se corrigio la documentacion de ${table}.${column}.`,
          autoFixDetail: `${table}.${column}: ${comment}`,
        };
      }

      if (toolCall.function.name === "mark_needs_human_review") {
        return {
          status: "needs_review",
          diagnosis: String(args.reason ?? "Necesita revision humana."),
        };
      }
    }
  }

  return { status: "needs_review", diagnosis: "No se pudo completar el auto-diagnostico." };
}

export async function POST(req: NextRequest) {
  let body: {
    question?: string;
    answer?: string;
    rating?: "up" | "down";
    executedQueries?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  const answer = (body.answer ?? "").trim();
  const rating = body.rating;
  const executedQueries = Array.isArray(body.executedQueries) ? body.executedQueries : [];

  if (!question || !answer || (rating !== "up" && rating !== "down")) {
    return NextResponse.json({ error: "Faltan campos requeridos." }, { status: 400 });
  }

  const secret = process.env.SESSION_SECRET;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie && secret ? await verifySessionToken(cookie, secret) : null;

  const supabase = getSupabaseAdmin();

  if (rating === "up") {
    await supabase.from("assistant_feedback").insert({
      user_email: session?.email ?? null,
      question,
      answer,
      executed_queries: executedQueries,
      rating: "up",
      status: "reviewed",
    });
    return NextResponse.json({ ok: true });
  }

  // rating === "down": guardamos primero, despues intentamos el auto-diagnostico.
  const { data: inserted, error: insertError } = await supabase
    .from("assistant_feedback")
    .insert({
      user_email: session?.email ?? null,
      question,
      answer,
      executed_queries: executedQueries,
      rating: "down",
      status: "new",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("Error guardando feedback:", insertError);
    return NextResponse.json({ error: "No se pudo guardar el feedback." }, { status: 500 });
  }

  try {
    const result = await runDiagnosis(question, answer, executedQueries);
    await supabase
      .from("assistant_feedback")
      .update({
        status: result.status,
        diagnosis: result.diagnosis,
        auto_fix_detail: result.autoFixDetail ?? null,
      })
      .eq("id", inserted.id);

    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    console.error("Error en auto-diagnostico de feedback:", err);
    await supabase
      .from("assistant_feedback")
      .update({ status: "needs_review", diagnosis: "Error tecnico durante el auto-diagnostico." })
      .eq("id", inserted.id);
    return NextResponse.json({ ok: true, status: "needs_review" });
  }
}
