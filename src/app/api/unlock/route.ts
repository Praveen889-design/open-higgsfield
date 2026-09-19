import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { isSameOrigin, rateLimitKey, takeUnlockSlot } from "@/generation/access";
import {
  UNLOCK_COOKIE,
  UNLOCK_COOKIE_OPTIONS,
  accessCodeRequired,
  matchesAccessCode,
  unlockToken,
} from "@/generation/access-code";
import { DEVICE_COOKIE, resolveDeviceId } from "@/generation/device";

/* A route handler rather than a server action, because this endpoint exists to
   set one cookie and a server action could not.

   The unlock screen is reached by a rewrite, so the action posted against
   /unlock — a prerendered route. An action resolved there cannot attach
   Set-Cookie: the response sits on the static path, where a per-visitor cookie
   would poison an artifact meant to be shared. The action ran, matched the
   code and reported success while emitting no header at all, which is the
   worst shape a failure can take. Here the response is an object this code
   builds, and the cookie is written onto it explicitly. */

export async function POST(request: Request): Promise<NextResponse> {
  if (!accessCodeRequired()) return NextResponse.json({ ok: true });

  if (
    !isSameOrigin(
      request.headers.get("origin"),
      request.headers.get("host"),
      request.headers.get("x-forwarded-host"),
    )
  ) {
    return NextResponse.json({ ok: false, error: "Unlock must come from the studio." }, { status: 403 });
  }

  const code = await readCode(request);
  if (!code) {
    return NextResponse.json({ ok: false, error: "Enter the access code." }, { status: 400 });
  }

  const jar = await cookies();
  const head = await headers();
  const device = resolveDeviceId(jar.get(DEVICE_COOKIE)?.value);
  const key = `unlock:${rateLimitKey(head.get("x-forwarded-for"), device.deviceId, !device.minted)}`;
  if (!takeUnlockSlot(key)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Wait a few minutes, then try again." },
      { status: 429 },
    );
  }

  if (!(await matchesAccessCode(code))) {
    return NextResponse.json({ ok: false, error: "That access code is not right." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(UNLOCK_COOKIE, await unlockToken(code), UNLOCK_COOKIE_OPTIONS);
  return response;
}

async function readCode(request: Request): Promise<string | null> {
  try {
    const body = (await request.json()) as { code?: unknown };
    return typeof body.code === "string" && body.code.trim() ? body.code.trim() : null;
  } catch {
    return null;
  }
}
