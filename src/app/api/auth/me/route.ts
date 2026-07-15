import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  const session = cookie && secret ? await verifySessionToken(cookie, secret) : null;
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: { email: session.email, name: session.name, jobTitle: session.jobTitle ?? null },
  });
}
