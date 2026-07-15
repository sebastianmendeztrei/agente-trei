import { createClient } from "@supabase/supabase-js";

// Cliente de Supabase para uso EXCLUSIVO en el servidor (API Routes).
// Usa la Service Role Key, que tiene acceso total a la base saltandose RLS.
// NUNCA se debe importar este archivo desde un Client Component.
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan variables de entorno de Supabase (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
