import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const tenantId = process.env.AZURE_AD_TENANT_ID;

  if (!clientId || !tenantId) {
    return NextResponse.json(
      { error: "El login con Microsoft Entra no esta configurado (faltan AZURE_AD_CLIENT_ID / AZURE_AD_TENANT_ID)." },
      { status: 500 }
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;
  const redirectAfterLogin = req.nextUrl.searchParams.get("redirect") || "/";

  const authUrl = new URL(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
  );
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", "openid profile email");
  // Reutilizamos "state" solo para recordar a donde volver despues del
  // login; no se usa como token anti-CSRF critico porque el intercambio de
  // codigo por token requiere el client_secret (server-to-server).
  authUrl.searchParams.set("state", redirectAfterLogin);

  return NextResponse.redirect(authUrl.toString());
}
