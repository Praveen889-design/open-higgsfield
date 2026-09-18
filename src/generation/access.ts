/* The gate on the one route that hands out write credentials.

   /api/blob mints a Vercel Blob client token, so whoever reaches it can write
   to the store behind it. The studio has no accounts, so the gate is what a
   request can prove about itself: it came from this origin, it carries a
   platform key, and it has not already spent its allowance. Each check narrows
   a different abuse — a cross-site page driving the route, a bare script with
   no session, and volume from either.

   Kept free of next/headers so the policy can be exercised on its own. */

const MEGABYTE = 1024 * 1024;

/** Per kind, because the ceilings differ by an order of magnitude: a reference
    image that needs 200MB is not a reference image. */
const KINDS = {
  image: {
    extensions: ["jpg", "jpeg", "png", "webp", "gif"],
    contentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    maxBytes: 20 * MEGABYTE,
  },
  video: {
    extensions: ["mp4"],
    contentTypes: ["video/mp4"],
    maxBytes: 200 * MEGABYTE,
  },
  audio: {
    extensions: ["wav"],
    contentTypes: ["audio/wav", "audio/x-wav"],
    maxBytes: 50 * MEGABYTE,
  },
} as const;

export const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
export const UPLOAD_MAX_PER_WINDOW = 20;

/* Tighter than uploads, and deliberately so: an upload allowance is a budget,
   an unlock allowance is a guess count. Ten wrong guesses per window makes a
   code worth brute forcing only if it was never worth setting. */
export const UNLOCK_MAX_PER_WINDOW = 10;

/** The token is spent within seconds of being issued; an hour of validity (the
    library's default) is an hour in which a leaked one still writes. */
export const TOKEN_LIFETIME_MS = 5 * 60 * 1000;

export type UploadLimits = {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
};

/** The allow-list and the ceiling the token will carry, or null when the
    extension is not one the studio can feed a model anyway. */
export function uploadLimits(pathname: string): UploadLimits | null {
  const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
  for (const kind of Object.values(KINDS)) {
    if ((kind.extensions as readonly string[]).includes(extension)) {
      return { allowedContentTypes: [...kind.contentTypes], maximumSizeInBytes: kind.maxBytes };
    }
  }
  return null;
}

/** A browser always sends Origin on a cross-origin-capable POST, so a missing
    one is a script rather than the studio. Compared against the host the
    request arrived on, not a configured origin: preview deployments each
    answer on their own domain and are no less legitimate. */
export function isSameOrigin(
  origin: string | null,
  host: string | null,
  forwardedHost: string | null,
): boolean {
  if (!origin) return false;
  const hosts = [forwardedHost, host].filter((value): value is string => Boolean(value));
  if (hosts.length === 0) return false;
  try {
    const originHost = new URL(origin).host;
    return hosts.includes(originHost);
  } catch {
    return false;
  }
}

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** A sliding allowance per caller.

    In-memory, so it is a speed bump rather than a guarantee: serverless spreads
    a burst across instances and each keeps its own map. It costs nothing and
    stops the dumb case. A hard limit wants Redis or Vercel KV behind the same
    function. */
export function takeUploadSlot(key: string, now = Date.now()): boolean {
  return take(key, UPLOAD_MAX_PER_WINDOW, now);
}

/** The same allowance, spent on unlock attempts. Keys are prefixed by the
    caller, so a visitor's guesses and their uploads never share a budget. */
export function takeUnlockSlot(key: string, now = Date.now()): boolean {
  return take(key, UNLOCK_MAX_PER_WINDOW, now);
}

function take(key: string, max: number, now: number): boolean {
  if (windows.size > 5000) prune(now);
  const open = windows.get(key);
  if (!open || open.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + UPLOAD_WINDOW_MS });
    return true;
  }
  if (open.count >= max) return false;
  open.count += 1;
  return true;
}

/** The caller a limit counts against: the address first, since a cookie is
    dropped and re-minted for free, and the device only when there is none.

    A caller with neither — no forwarded address and no device cookie it was
    already carrying — would otherwise mint a fresh identity per request and
    never meet the limit at all. Those share one bucket. It cannot catch a real
    visitor: the middleware sets the device cookie on the page load that has to
    precede any upload, and the key this route already demanded was entered on
    that same page. Arriving here clean means a script. */
export function rateLimitKey(
  forwardedFor: string | null,
  deviceId: string,
  deviceWasCarried: boolean,
): string {
  const address = forwardedFor?.split(",")[0]?.trim();
  if (address) return `ip:${address}`;
  return deviceWasCarried ? `device:${deviceId}` : "anonymous";
}

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/** Test seam. */
export function resetUploadWindows(): void {
  windows.clear();
}
