import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

async function getSession(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  return cookie && secret ? await verifySessionToken(cookie, secret) : null;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!isAdmin(session?.email)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("assistant_feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data, isAdmin: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  if (!isAdmin(session?.email)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  let body: { id?: number; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  if (!body.id || body.status !== "reviewed") {
    return NextResponse.json({ error: "Solicitud invalida." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("assistant_feedback")
    .update({ status: "reviewed" })
    .eq("id", body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
