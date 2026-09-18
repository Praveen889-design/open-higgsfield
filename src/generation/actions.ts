"use server";

import { cookies, headers } from "next/headers";

import { rateLimitKey, takeUnlockSlot } from "./access";
import {
  UNLOCK_COOKIE,
  UNLOCK_COOKIE_OPTIONS,
  accessCodeRequired,
  isUnlocked,
  matchesAccessCode,
  unlockToken,
} from "./access-code";
import { getModel, parseSettings } from "./catalog";
import type { GenerationPlane } from "./catalog/types";
import {
  MissingCredentialsError,
  PLATFORM_KEY_COOKIE,
  PLATFORM_KEY_COOKIE_OPTIONS,
  decodeCredentials,
  encodeCredentials,
  parseCredentialInput,
} from "./credentials";
import { DEVICE_COOKIE, resolveDeviceId } from "./device";
import { createPlatformClient } from "./platform";
import type { QueuedGeneration, StatusResult } from "./platform";
import { refusalText, type ActionRefusal } from "./refusal";
import { toPlatform } from "./to-platform";

/** Whether this deployment asks for a code at all — read by the unlock screen
    so it can say so rather than offering a field that governs nothing. */
export async function isAccessCodeRequired() {
  return accessCodeRequired();
}

/** A wrong code is an ordinary outcome of asking, not a fault, so it comes back
    as a value. It also has to: a production build redacts anything a server
    action throws, and the visitor would be told only that something went
    wrong — on the one screen whose whole job is to say what went wrong. */
export type UnlockResult = { ok: true } | { ok: false; error: string };

/** Exchange the code for the cookie the proxy reads.

    Guessing is rationed before the comparison runs, so a wrong answer costs an
    attempt whether or not it was close. */
export async function unlockStudio(data: unknown): Promise<UnlockResult> {
  if (!accessCodeRequired()) return { ok: true };

  const code = readAccessCode(data);
  if (!code) return { ok: false, error: "Enter the access code." };

  const jar = await cookies();
  const head = await headers();
  const device = resolveDeviceId(jar.get(DEVICE_COOKIE)?.value);
  const key = `unlock:${rateLimitKey(head.get("x-forwarded-for"), device.deviceId, !device.minted)}`;
  if (!takeUnlockSlot(key)) {
    return { ok: false, error: "Too many attempts. Wait a few minutes, then try again." };
  }

  if (!(await matchesAccessCode(code))) return { ok: false, error: "That access code is not right." };
  jar.set(UNLOCK_COOKIE, await unlockToken(code), UNLOCK_COOKIE_OPTIONS);
  return { ok: true };
}

export async function lockStudio() {
  const jar = await cookies();
  jar.set(UNLOCK_COOKIE, "", { ...UNLOCK_COOKIE_OPTIONS, maxAge: 0 });
}

/* The proxy turns a locked visitor away at the page, but a server action is
   reachable without ever loading one. Each action that spends something —
   the platform's quota, the visitor's key — asks again here. */
/** The same two gates the throwing guard applies, reported rather than raised.
    Lock first: a locked studio is not a missing key, and saying so sends the
    visitor to the door instead of to the key modal. */
async function refuse(): Promise<ActionRefusal | null> {
  const jar = await cookies();
  if (!(await isUnlocked(jar.get(UNLOCK_COOKIE)?.value))) return "locked";
  if (!decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value)) return "missing-key";
  return null;
}

function readAccessCode(data: unknown): string | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

/* "That key is malformed" is an answer to the question asked, not a fault, and
   it has to come back as one: thrown, it reaches the modal as "An unexpected
   response was received from the server" and the visitor is never told what
   about their key was wrong. */
export type SaveKeyOutcome = { ok: true } | { ok: false; error: string };

export async function savePlatformCredentials(data: unknown): Promise<SaveKeyOutcome> {
  /* The lock alone. refuse() also demands a key, and this is the action that
     sets one — a visitor would need a key to be allowed to save their key. */
  const jar = await cookies();
  if (!(await isUnlocked(jar.get(UNLOCK_COOKIE)?.value))) {
    return { ok: false, error: refusalText("locked") };
  }

  let apiKey: string;
  try {
    apiKey = parseCredentialInput(data).apiKey;
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : "Enter an API key" };
  }

  jar.set(PLATFORM_KEY_COOKIE, encodeCredentials(apiKey), PLATFORM_KEY_COOKIE_OPTIONS);
  return { ok: true };
}

export async function clearPlatformCredentials() {
  const jar = await cookies();
  jar.set(PLATFORM_KEY_COOKIE, "", { ...PLATFORM_KEY_COOKIE_OPTIONS, maxAge: 0 });
}

export async function hasPlatformCredentials() {
  return (await readStoredCredentials()) !== null;
}

/* Outcomes, not exceptions, for the two refusals the studio has an answer to.
   A throw reaches the browser stripped of both its class and its message, so
   neither could be told from a platform failure — and the studio would offer
   "try again" to someone who has no key. Anything genuinely unexpected still
   throws and still reads as a failure. */
export type SubmitOutcome =
  | { ok: true; queued: QueuedGeneration }
  | { ok: false; refusal: ActionRefusal };

export async function submitGeneration(plane: GenerationPlane): Promise<SubmitOutcome> {
  const refusal = await refuse();
  if (refusal) return { ok: false, refusal };

  const model = getModel(plane.model);
  const parsed: GenerationPlane = {
    ...plane,
    settings: parseSettings(model, plane.settings),
  };
  const { path, body } = toPlatform(parsed);
  return { ok: true, queued: await createPlatformClient(await readCredentials()).submit(path, body) };
}

/** Every request in flight, answered in one round trip. Next dispatches server
    actions one at a time per client, so a poll per run would queue ahead of the
    next submit — the fan-out belongs on this side of the call, where it is
    genuinely parallel. */
export type StatusOutcome =
  | { ok: true; results: StatusResult[] }
  | { ok: false; refusal: ActionRefusal };

export async function getGenerationStatuses(data: unknown): Promise<StatusOutcome> {
  const refusal = await refuse();
  if (refusal) return { ok: false, refusal };

  const requestIds = parseRequestIds(data);
  const client = createPlatformClient(await readCredentials());
  const results = await Promise.all(
    requestIds.map(async (requestId): Promise<StatusResult> => {
      try {
        return { requestId, status: await client.status(requestId) };
      } catch (caught) {
        return { requestId, error: caught instanceof Error ? caught.message : String(caught) };
      }
    }),
  );
  return { ok: true, results };
}

async function readStoredCredentials() {
  const jar = await cookies();
  return decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value);
}

async function readCredentials() {
  const stored = await readStoredCredentials();
  if (!stored) throw new MissingCredentialsError();
  const baseUrl = process.env.HF_API_BASE_URL;
  if (!baseUrl) throw new Error("Missing HF_API_BASE_URL");
  return { ...stored, baseUrl };
}

function parseRequestIds(data: unknown): string[] {
  const payload = asObject(data, "Invalid status payload");
  const requestIds = payload.requestIds;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new Error("Invalid request ids");
  }
  return requestIds.map((requestId) => {
    if (typeof requestId !== "string" || !requestId) throw new Error("Invalid request id");
    return requestId;
  });
}

function asObject(data: unknown, message: string): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error(message);
  return data as Record<string, unknown>;
}
