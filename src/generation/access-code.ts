/* One shared code for the whole deployment.

   The studio has no accounts, and a platform key is only checked for shape, so
   a public URL is usable by anyone who finds it. Setting
   OPEN_HIGGSFIELD_ACCESS_CODE turns the instance into something you hand out
   rather than something that is simply found. Leave it unset and nothing here
   engages — the open, bring-your-own-key studio is still the default.

   Web Crypto rather than node:crypto so one implementation serves the proxy,
   the route and the server actions alike, whichever runtime each is given. */

export const UNLOCK_COOKIE = "ohf_unlock";

export const UNLOCK_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

/* Namespaced so the stored value is this app's unlock proof and nothing else —
   never a hash someone could carry in from another system that hashed the same
   secret. Bumping the version invalidates every cookie in the field. */
const LABEL = "ohf.unlock.v1:";

export function accessCode(): string | null {
  const code = process.env.OPEN_HIGGSFIELD_ACCESS_CODE?.trim();
  return code ? code : null;
}

export function accessCodeRequired(): boolean {
  return accessCode() !== null;
}

/** What the cookie holds: never the code itself, so a cookie read anywhere
    downstream cannot be replayed as the code to a human. Rotating the env var
    changes the token and signs everyone out, which is the point of rotating. */
export async function unlockToken(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(LABEL + code));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isUnlocked(cookieValue: string | undefined): Promise<boolean> {
  const code = accessCode();
  if (!code) return true;
  if (!cookieValue) return false;
  return constantTimeEquals(cookieValue, await unlockToken(code));
}

export async function matchesAccessCode(input: string): Promise<boolean> {
  const code = accessCode();
  if (!code) return true;
  /* Both sides hashed before comparing: the digests are always 64 characters,
     so neither the comparison's duration nor its early exit says anything about
     the real code's length. */
  const [offered, expected] = await Promise.all([unlockToken(input), unlockToken(code)]);
  return constantTimeEquals(offered, expected);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
