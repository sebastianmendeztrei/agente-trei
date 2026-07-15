// Validador de consultas SQL. Unica linea de defensa a nivel de aplicacion
// antes de que una query llegue a la base de datos. La defensa real (la que
// no se puede saltar) vive en la funcion de Postgres `execute_readonly_query`
// (ver supabase/migrations/0001_readonly_query_function.sql), que corre
// SIEMPRE en una transaccion de solo lectura. Este validador es una capa
// adicional para rechazar queries obviamente peligrosas antes de gastar una
// llamada a la base, y para inyectar un LIMIT si el modelo lo olvido.

const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "grant",
  "revoke",
  "create",
  "replace",
  "merge",
  "call",
  "do",
  "copy",
  "vacuum",
  "reindex",
  "listen",
  "notify",
  "set ",
  "reset",
  "begin",
  "commit",
  "rollback",
  "--",
  "/*",
  ";",
];

export const MAX_ROWS_PER_QUERY = Number(process.env.MAX_ROWS_PER_QUERY ?? 200);

export class UnsafeQueryError extends Error {}

/**
 * Valida que una query sea un SELECT de solo lectura, sin sentencias
 * multiples ni palabras clave de escritura. Devuelve la query lista para
 * ejecutar (con LIMIT agregado si hacia falta).
 */
export function guardSelectQuery(rawQuery: string): string {
  const query = rawQuery.trim();

  if (!query) {
    throw new UnsafeQueryError("La consulta esta vacia.");
  }

  const normalized = query.toLowerCase();

  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    throw new UnsafeQueryError(
      "Solo se permiten consultas SELECT (o WITH ... SELECT)."
    );
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (normalized.includes(keyword)) {
      throw new UnsafeQueryError(
        `La consulta contiene una operacion no permitida: "${keyword.trim()}".`
      );
    }
  }

  // Evita múltiples sentencias (ya bloqueamos ";" arriba, esto es una
  // segunda verificación explícita por claridad).
  if (query.split(";").filter((s) => s.trim().length > 0).length > 1) {
    throw new UnsafeQueryError("No se permite mas de una sentencia por consulta.");
  }

  const hasLimit = /\blimit\s+\d+/i.test(normalized);
  const finalQuery = hasLimit
    ? query
    : `${query} LIMIT ${MAX_ROWS_PER_QUERY}`;

  // Si el LIMIT declarado es mayor al maximo permitido, lo recortamos.
  const limitMatch = finalQuery.match(/\blimit\s+(\d+)/i);
  if (limitMatch && Number(limitMatch[1]) > MAX_ROWS_PER_QUERY) {
    return finalQuery.replace(
      /\blimit\s+\d+/i,
      `LIMIT ${MAX_ROWS_PER_QUERY}`
    );
  }

  return finalQuery;
}
