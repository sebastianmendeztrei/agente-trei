"use client";

import { useEffect, useState } from "react";

type FeedbackItem = {
  id: number;
  created_at: string;
  user_email: string | null;
  question: string;
  answer: string;
  executed_queries: string[] | null;
  rating: "up" | "down";
  status: "new" | "auto_fixed" | "needs_review" | "reviewed";
  diagnosis: string | null;
  auto_fix_detail: string | null;
};

const statusLabel: Record<FeedbackItem["status"], string> = {
  new: "Procesando...",
  auto_fixed: "Auto-corregido",
  needs_review: "Necesita revisión",
  reviewed: "Revisado",
};

const statusColor: Record<FeedbackItem["status"], string> = {
  new: "bg-neutral-100 text-neutral-600",
  auto_fixed: "bg-green-100 text-green-700",
  needs_review: "bg-trei-light text-trei-dark",
  reviewed: "bg-neutral-100 text-neutral-500",
};

export default function AdminPage() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/feedback");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No autorizado.");
        return;
      }
      setItems(data.items);
    } catch {
      setError("No se pudo cargar el panel.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markReviewed(id: number) {
    await fetch("/api/admin/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "reviewed" }),
    });
    load();
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-600">
        {error}
      </div>
    );
  }

  if (!items) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-400">Cargando...</div>;
  }

  const needsReview = items.filter((i) => i.status === "needs_review");
  const rest = items.filter((i) => i.status !== "needs_review");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-medium text-neutral-900">Panel de feedback</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Respuestas marcadas por usuarios. Los casos con documentación de esquema mal
        clara se corrigen solos; el resto queda acá para revisión.
      </p>

      {needsReview.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-trei">
            Necesitan revisión ({needsReview.length})
          </h2>
          <div className="space-y-3">
            {needsReview.map((item) => (
              <FeedbackCard key={item.id} item={item} onResolve={markReviewed} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Historial</h2>
        <div className="space-y-3">
          {rest.map((item) => (
            <FeedbackCard key={item.id} item={item} />
          ))}
          {rest.length === 0 && (
            <p className="text-sm text-neutral-400">Sin más registros.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackCard({
  item,
  onResolve,
}: {
  item: FeedbackItem;
  onResolve?: (id: number) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[item.status]}`}>
          {statusLabel[item.status]}
        </span>
        <span className="text-xs text-neutral-400">
          {item.user_email ?? "anónimo"} · {new Date(item.created_at).toLocaleString("es-CL")}
        </span>
      </div>
      <p className="mb-1">
        <span className="font-medium text-neutral-700">Pregunta:</span> {item.question}
      </p>
      <p className="mb-2 text-neutral-600">
        <span className="font-medium text-neutral-700">Respuesta:</span> {item.answer}
      </p>
      {item.diagnosis && (
        <p className="mb-2 rounded bg-neutral-50 p-2 text-xs text-neutral-600">
          <span className="font-medium">Diagnóstico:</span> {item.diagnosis}
          {item.auto_fix_detail && (
            <>
              <br />
              <span className="font-medium">Corrección aplicada:</span> {item.auto_fix_detail}
            </>
          )}
        </p>
      )}
      {item.status === "needs_review" && onResolve && (
        <button
          onClick={() => onResolve(item.id)}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:border-trei hover:text-trei"
        >
          Marcar como revisado
        </button>
      )}
    </div>
  );
}
