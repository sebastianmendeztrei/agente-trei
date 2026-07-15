"use client";

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
    <main className="mx-auto flex h-screen max-w-2xl flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold">Asistente BI</h1>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">
            Preguntame algo sobre los datos comerciales, por ejemplo:
            &quot;¿Cuántos clientes nuevos ingresaron este mes?&quot;
          </p>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto max-w-[80%] bg-blue-600 text-white"
                : "mr-auto max-w-[80%] bg-gray-100 text-gray-900"
            }`}
          >
            {m.content}
          </div>
        ))}

        {loading && (
          <div className="mr-auto max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500">
            Pensando...
          </div>
        )}

        {error && (
          <div className="mr-auto max-w-[80%] rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
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
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </main>
  );
}
