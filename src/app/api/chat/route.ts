import { NextRequest, NextResponse } from "next/server";

// TODO (Paso 2): implementar el loop de tool calling con OpenAI
// y el llamado seguro a Supabase (solo SELECT, con LIMIT).
//
// Esta ruta es el UNICO lugar del sistema que tendra acceso a
// OPENAI_API_KEY y SUPABASE_SERVICE_ROLE_KEY. Nunca se exponen al cliente.

export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: "Endpoint aun no implementado. Ver Paso 2." },
    { status: 501 }
  );
}
