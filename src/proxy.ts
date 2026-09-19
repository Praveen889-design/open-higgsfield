import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { UNLOCK_COOKIE, isUnlocked } from "./generation/access-code";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, resolveDeviceId } from "./generation/device";

const UNLOCK_PATH = "/unlock";

/* The lock is applied to page loads only. A server action posts to the page it
   came from and would be caught here too, but rewriting a POST to another
   route answers the wrong thing — the actions enforce the lock themselves, in
   the place that can refuse in the caller's own language. */
export async function proxy(request: NextRequest) {
  /* A mutating request is passed through without answering it from here.
     Returning any response object — NextResponse.next() included — makes this
     the layer that owns the response's Set-Cookie, and the headers a server
     action wrote downstream are dropped. That silently cost the unlock cookie:
     the action ran, matched the code, set the cookie, returned ok, and the
     browser received nothing. The platform key is written the same way and
     would have gone the same way. */
  if (request.method !== "GET") return;

  const { deviceId, minted } = resolveDeviceId(request.cookies.get(DEVICE_COOKIE)?.value);
  const response = await route(request);
  if (minted) response.cookies.set(DEVICE_COOKIE, deviceId, DEVICE_COOKIE_OPTIONS);
  return response;
}

async function route(request: NextRequest): Promise<NextResponse> {
  const onUnlockPage = request.nextUrl.pathname === UNLOCK_PATH;

  const unlocked = await isUnlocked(request.cookies.get(UNLOCK_COOKIE)?.value);
  if (unlocked) {
    /* Nothing to ask for. Redirect rather than rewrite so the address bar stops
       showing a door that is already open. */
    return onUnlockPage
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  /* A rewrite, not a redirect: the URL the visitor was sent is the one they
     land on once they unlock, and a locked instance gives away no route map. */
  return onUnlockPage ? NextResponse.next() : NextResponse.rewrite(new URL(UNLOCK_PATH, request.url));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
