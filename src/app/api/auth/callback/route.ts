import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// Duracion de la sesion: 8 horas (una jornada laboral).
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  const rawPayload = parts[1];
  if (parts.length < 2 || !rawPayload) throw new Error("id_token invalido.");
  const base64 = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirectAfterLogin = req.nextUrl.searchParams.get("state") || "/";
  const errorParam = req.nextUrl.searchParams.get("error_description");

  if (errorParam) {
    return NextResponse.json({ error: `Microsoft rechazo el login: ${errorParam}` }, { status: 401 });
  }
  if (!code) {
    return NextResponse.redirect(new URL("/api/auth/login", req.url));
  }

  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  const tenantId = process.env.AZURE_AD_TENANT_ID;
  const sessionSecret = process.env.SESSION_SECRET;
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;

  if (!clientId || !clientSecret || !tenantId || !sessionSecret) {
    return NextResponse.json(
      { error: "El login con Microsoft Entra no esta configurado correctamente en el servidor." },
      { status: 500 }
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;

  let tokenRes: Response;
  try {
    tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          scope: "openid profile email",
        }),
      }
    );
  } catch (err) {
    console.error("Error contactando a Microsoft para el intercambio de token:", err);
    return NextResponse.json({ error: "No se pudo contactar a Microsoft Entra." }, { status: 502 });
  }

  if (!tokenRes.ok) {
    const details = await tokenRes.text();
    console.error("Token exchange fallido:", tokenRes.status, details);
    return NextResponse.json({ error: "No se pudo validar el inicio de sesion con Microsoft." }, { status: 401 });
  }

  const tokenData = (await tokenRes.json()) as { id_token?: string };
  if (!tokenData.id_token) {
    return NextResponse.json({ error: "Microsoft no devolvio un id_token." }, { status: 401 });
  }

  // NOTA (MVP): el id_token se decodifica sin verificar su firma contra el
  // JWKS de Microsoft. Es aceptable porque el intercambio de codigo por
  // token se hizo servidor-a-servidor, autenticado con client_secret, sobre
  // TLS directo a login.microsoftonline.com (no paso por el navegador del
  // usuario). Para un endurecimiento futuro, verificar la firma RS256 contra
  // https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys.
  let claims: Record<string, unknown>;
  try {
    claims = decodeIdTokenPayload(tokenData.id_token);
  } catch (err) {
    console.error("No se pudo decodificar el id_token:", err);
    return NextResponse.json({ error: "Respuesta de Microsoft invalida." }, { status: 401 });
  }

  const email = String(claims.preferred_username ?? claims.email ?? "").toLowerCase();
  const name = String(claims.name ?? email);

  if (!email) {
    return NextResponse.json({ error: "La cuenta de Microsoft no tiene un email asociado." }, { status: 401 });
  }

  if (allowedDomain && !email.endsWith(`@${allowedDomain.toLowerCase()}`)) {
    return NextResponse.json(
      { error: `Solo cuentas @${allowedDomain} pueden usar este asistente.` },
      { status: 403 }
    );
  }

  const sessionToken = await createSessionToken(
    { email, name, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS },
    sessionSecret
  );

  const safeRedirect = redirectAfterLogin.startsWith("/") ? redirectAfterLogin : "/";
  const res = NextResponse.redirect(new URL(safeRedirect, req.url));
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
