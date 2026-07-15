import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// DESACTIVADO TEMPORALMENTE: el login con Microsoft Entra ID todavia no esta
// configurado (faltan AZURE_AD_CLIENT_ID / AZURE_AD_TENANT_ID reales en
// wrangler.jsonc y los secrets AZURE_AD_CLIENT_SECRET / SESSION_SECRET en
// Cloudflare). Con el matcher vacio este middleware nunca se ejecuta, para
// no romper el acceso al sitio mientras se termina esa configuracion. Una
// vez completados esos datos, restaurar el matcher de abajo (comentado) y
// hacer commit.
//
// matcher real a restaurar cuando este todo configurado:
// matcher: ["/((?!api/auth|_next|favicon.ico|trei-logo.png).*)"],
export const config = {
  matcher: [],
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
