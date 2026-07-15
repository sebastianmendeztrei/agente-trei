"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
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
        { role: "assistant", content: data.reply || "(sin respuesta)" },
      ]);
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
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
          <div className="border-l border-neutral-200 pl-3">
            <h1 className="text-lg font-medium leading-tight text-neutral-900">
              AI Comercial <span className="text-trei">Trei</span>
            </h1>
            <p className="text-xs text-neutral-500">
              Inteligencia comercial de Trei Inmobiliaria
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-6">
        <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
          {messages.length === 0 && (
            <p className="text-sm text-neutral-400">
              Preguntame algo sobre los datos comerciales, por ejemplo:
              &quot;¿Cuántos clientes nuevos ingresaron este mes?&quot;
            </p>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ml-auto max-w-[80%] bg-trei text-white"
                  : "mr-auto max-w-[80%] bg-neutral-100 text-neutral-900"
              }`}
            >
              {m.content}
            </div>
          ))}

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
