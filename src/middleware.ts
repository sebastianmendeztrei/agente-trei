import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// Protege toda la app (paginas y API) excepto las rutas de login/callback/
// logout y los assets estaticos. Si no hay sesion valida:
// - Para /api/*: devuelve 401 JSON (el fetch del chat lo puede mostrar como error).
// - Para paginas: redirige a /api/auth/login, que a su vez redirige a Microsoft.
export const config = {
  matcher: [
    "/((?!api/auth|_next|favicon.ico|trei-logo.png).*)",
  ],
};

export async function middleware(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  const session = cookie && secret ? await verifySessionToken(cookie, secret) : null;

  if (session) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "No autorizado. Inicia sesion con tu cuenta de Trei para usar el asistente." },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/api/auth/login", req.url);
  loginUrl.searchParams.set("redirect", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}
