import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const tenantId = process.env.AZURE_AD_TENANT_ID;

  // Si solo borramos NUESTRA cookie y redirigimos a "/", el middleware manda
  // al usuario de vuelta a /api/auth/login, y como Microsoft mantiene su
  // propia sesion activa en el navegador (SSO), te vuelve a loguear solo sin
  // preguntar nada: parece que "no se puede cerrar sesion". Por eso hay que
  // cerrar tambien la sesion de Microsoft, no solo la de la app.
  const postLogoutUrl = new URL("/", req.url).toString();
  const redirectUrl = tenantId
    ? `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(
        postLogoutUrl
      )}`
    : postLogoutUrl;

  const res = NextResponse.redirect(redirectUrl);
  res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
