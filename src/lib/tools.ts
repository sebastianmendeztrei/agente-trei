import type OpenAI from "openai";

// Definicion de las tools (function calling) que el modelo puede invocar.
// El modelo NUNCA ejecuta nada por si mismo: solo pide que se llame a una
// de estas funciones, y el backend (api/chat/route.ts) decide si es segura
// antes de correrla contra Supabase.
export const chatTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_schema",
      description:
        "Devuelve el esquema de la base de datos (tablas y columnas disponibles en el schema public). Usar esto primero si no se conoce la estructura de las tablas.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_select_query",
      description:
        "Ejecuta una consulta SQL de solo lectura (SELECT) contra la base de datos y devuelve las filas resultantes en JSON. Usa COUNT/SUM/AVG/GROUP BY y LIMIT cuando sea posible para minimizar el tamano de la respuesta. Nunca uses INSERT, UPDATE, DELETE ni ninguna sentencia de escritura: sera rechazada.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "La consulta SQL SELECT a ejecutar.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];
