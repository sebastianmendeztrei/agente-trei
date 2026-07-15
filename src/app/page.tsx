"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  question?: string; // solo en mensajes assistant: la pregunta que la origino
  executedQueries?: string[];
  feedback?: "up" | "down";
};

const SUGGESTED_QUESTIONS = [
  "¿Cuántas ventas tuvimos este mes?",
  "¿Cuántos leads nuevos entraron esta semana?",
  "Tasa de conversión de leads a promesas este mes",
  "Top 5 proyectos por ventas del mes",
];

// Detecta si la respuesta incluye una tabla en Markdown (formato GFM) y la
// convierte en filas de celdas, para poder exportarla a Excel.
function parseMarkdownTable(content: string): string[][] | null {
  const lines = content.split("\n").map((l) => l.trim());
  const tableStart = lines.findIndex((l) => /^\|.*\|$/.test(l));
  if (tableStart === -1) return null;

  const rows: string[][] = [];
  for (let i = tableStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !/^\|.*\|$/.test(line)) break;
    // Fila separadora tipo "| --- | --- |"
    if (/^\|[\s-:|]+\|$/.test(line)) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows.length > 1 ? rows : null;
}

async function exportTableToExcel(content: string, question: string) {
  const rows = parseMarkdownTable(content);
  if (!rows) return;
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Datos");
  const safeName = question.slice(0, 40).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") || "respuesta";
  XLSX.writeFile(workbook, `${safeName}.xlsx`);
}

// Componentes de Markdown con estilo Tailwind, usados solo para las
// respuestas del asistente (permite que el modelo devuelva tablas cuando
// corresponda, por ejemplo listados de ventas, personas o proyectos).
const markdownComponents = {
  table: (props: React.ComponentPropsWithoutRef<"table">) => (
    <div className="my-2 overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props: React.ComponentPropsWithoutRef<"thead">) => (
    <thead className="bg-trei-light text-trei-dark" {...props} />
  ),
  th: (props: React.ComponentPropsWithoutRef<"th">) => (
    <th className="border-b border-neutral-200 px-3 py-2 text-left font-medium" {...props} />
  ),
  td: (props: React.ComponentPropsWithoutRef<"td">) => (
    <td className="border-b border-neutral-100 px-3 py-2" {...props} />
  ),
  p: (props: React.ComponentPropsWithoutRef<"p">) => (
    <p className="mb-2 last:mb-0" {...props} />
  ),
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />
  ),
  strong: (props: React.ComponentPropsWithoutRef<"strong">) => (
    <strong className="font-semibold" {...props} />
  ),
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function sendMessage(e: React.FormEvent, textOverride?: string) {
    e.preventDefault();
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Ocurrio un error.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply || "(sin respuesta)",
          question: text,
          executedQueries: data.executedQueries || [],
        },
      ]);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(index: number, rating: "up" | "down") {
    const msg = messages[index];
    if (!msg || msg.role !== "assistant") return;

    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, feedback: rating } : m))
    );

    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: msg.question ?? "",
          answer: msg.content,
          rating,
          executedQueries: msg.executedQueries ?? [],
        }),
      });
    } catch {
      // silencioso: el feedback es best-effort, no debe interrumpir el chat
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Header estilo trei.cl: fondo blanco, borde inferior sutil, acento rojo corporativo */}
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Image
            src="/trei-logo.png"
            alt="Trei Inmobiliaria"
            width={112}
            height={57}
            className="h-9 w-auto"
            priority
          />
          <div className="flex-1 border-l border-neutral-200 pl-3">
            <h1 className="text-lg font-medium leading-tight text-neutral-900">
              AI Comercial <span className="text-trei">Trei</span>
            </h1>
            <p className="text-xs text-neutral-500">
              Inteligencia comercial de Trei Inmobiliaria
            </p>
          </div>
          {user && (
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <span className="text-xs text-neutral-500">{user.name}</span>
              <a
                href="/api/auth/logout"
                className="text-xs font-medium text-neutral-400 hover:text-trei hover:underline"
              >
                Cerrar sesión
              </a>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-expanded={showInfo}
            aria-label="Información sobre este asistente"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-xs font-semibold text-neutral-500 transition-colors hover:border-trei hover:text-trei"
          >
            i
          </button>
        </div>

        {showInfo && (
          <div className="border-t border-neutral-200 bg-neutral-50">
            <div className="mx-auto max-w-3xl space-y-2 px-6 py-4 text-xs leading-relaxed text-neutral-600">
              <p>
                <strong className="text-neutral-800">Qué información entrega:</strong>{" "}
                datos comerciales de Trei Inmobiliaria (leads, reservas, promesas,
                escrituras, cierres mensuales y proyectos).
              </p>
              <p>
                <strong className="text-neutral-800">De dónde se obtiene:</strong>{" "}
                de la base de datos interna que centraliza la información
                comercial de la empresa, la cual se carga a partir de lo
                generado en PlanOK a través de su API. El asistente solo puede
                leer datos, nunca modificarlos.
              </p>
              <p>
                <strong className="text-neutral-800">Cómo se procesa:</strong>{" "}
                cada pregunta se traduce automáticamente en una consulta a la base
                de datos y el resultado se resume con inteligencia artificial
                (OpenAI). Las cifras siempre provienen de la base, nunca son
                inventadas.
              </p>
              <p>
                <strong className="text-neutral-800">Acceso:</strong> el
                asistente solo esta disponible para cuentas corporativas de
                Trei (inicio de sesion con Microsoft Entra ID).
              </p>
              <p>
                <strong className="text-neutral-800">MVP:</strong> esta herramienta
                está en fase de prueba (MVP) y puede tener errores o límites de
                cobertura. Ante cualquier duda, resultado que no cuadre, o
                feedback de uso, escribir a{" "}
                <a href="mailto:smendez@trei.cl" className="font-medium text-trei hover:underline">
                  smendez@trei.cl
                </a>{" "}
                (Analista de Control de Gestión).
              </p>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-6">
        <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-neutral-400">
                Preguntame algo sobre los datos comerciales, por ejemplo:
                &quot;¿Cuántos clientes nuevos ingresaron este mes?&quot;
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={(e) => sendMessage(e, q)}
                    disabled={loading}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:border-trei hover:text-trei disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={i}
                className="ml-auto max-w-[80%] rounded-lg bg-trei px-3 py-2 text-sm text-white"
              >
                {m.content}
              </div>
            ) : (
              <div
                key={i}
                className="mr-auto max-w-[95%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-900"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {m.content}
                </ReactMarkdown>

                <div className="mt-2 flex items-center gap-3 border-t border-neutral-200 pt-2">
                  <button
                    type="button"
                    onClick={() => sendFeedback(i, "up")}
                    aria-label="Respuesta útil"
                    className={`text-xs transition-colors ${
                      m.feedback === "up" ? "text-trei" : "text-neutral-400 hover:text-trei"
                    }`}
                  >
                    👍
                  </button>
                  <button
                    type="button"
                    onClick={() => sendFeedback(i, "down")}
                    aria-label="Respuesta incorrecta"
                    className={`text-xs transition-colors ${
                      m.feedback === "down" ? "text-trei" : "text-neutral-400 hover:text-trei"
                    }`}
                  >
                    👎
                  </button>
                  {m.feedback === "down" && (
                    <span className="text-xs text-neutral-400">Gracias, lo vamos a revisar</span>
                  )}
                  {parseMarkdownTable(m.content) && (
                    <button
                      type="button"
                      onClick={() => exportTableToExcel(m.content, m.question ?? "respuesta")}
                      className="ml-auto text-xs font-medium text-neutral-500 hover:text-trei hover:underline"
                    >
                      Descargar Excel
                    </button>
                  )}
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="mr-auto max-w-[80%] rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-500">
              Pensando...
            </div>
          )}

          {error && (
            <div className="mr-auto max-w-[80%] rounded-lg bg-trei-light px-3 py-2 text-sm text-trei-dark">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <form onSubmit={sendMessage} className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu pregunta..."
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-trei"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-trei px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-trei-dark disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </main>
    </div>
  );
}
