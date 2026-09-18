import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  TOKEN_LIFETIME_MS,
  isSameOrigin,
  rateLimitKey,
  takeUploadSlot,
  uploadLimits,
} from "@/generation/access";
import { UNLOCK_COOKIE, isUnlocked } from "@/generation/access-code";
import { PLATFORM_KEY_COOKIE, decodeCredentials } from "@/generation/credentials";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_OPTIONS,
  blobPathname,
  resolveDeviceId,
} from "@/generation/device";

/* This route hands out a write token for the Blob store, so it is gated before
   it does. Only the token branch is: `blob.upload-completed` is a webhook from
   Vercel — no cookie, no Origin, and already authenticated by the signature
   handleUpload checks against the store's own token. Gating it would break the
   callback while protecting nothing. */

export async function POST(request: Request): Promise<NextResponse> {
  const incoming = (await request.json()) as HandleUploadBody;

  if (incoming.type !== "blob.generate-client-token") {
    return runUpload(incoming, request, null);
  }

  if (
    !isSameOrigin(
      request.headers.get("origin"),
      request.headers.get("host"),
      request.headers.get("x-forwarded-host"),
    )
  ) {
    console.warn("[blob] rejected cross-origin token request");
    return reject(403, "Upload requests must come from the studio.");
  }

  /* The studio's only notion of a visitor. Uploads exist to feed a generation,
     and a generation without a key is refused anyway, so the key is the line. */
  const jar = await cookies();

  if (!(await isUnlocked(jar.get(UNLOCK_COOKIE)?.value))) {
    console.warn("[blob] rejected locked token request");
    return reject(403, "This studio is locked. Enter the access code to continue.");
  }

  if (!decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value)) {
    console.warn("[blob] rejected token request with no platform key");
    return reject(401, "Add your platform key before attaching media.");
  }

  /* Decided here rather than inside onBeforeGenerateToken, where a throw comes
     back as an opaque 500 the studio cannot tell from a broken store. */
  if (!uploadLimits(incoming.payload.pathname)) {
    console.warn("[blob] rejected unsupported type", { pathname: incoming.payload.pathname });
    return reject(415, "That file type can't be attached — use JPEG, PNG, WebP, GIF, MP4 or WAV.");
  }

  const device = resolveDeviceId(jar.get(DEVICE_COOKIE)?.value);

  if (
    !takeUploadSlot(
      rateLimitKey(request.headers.get("x-forwarded-for"), device.deviceId, !device.minted),
    )
  ) {
    console.warn("[blob] rate limited", { device: device.deviceId });
    return withDeviceCookie(
      reject(429, "Upload limit reached. Wait a few minutes, then try again."),
      device,
    );
  }

  const body = withDevicePath(incoming, device.deviceId);
  return runUpload(body, request, device);
}

async function runUpload(
  body: HandleUploadBody,
  request: Request,
  device: { deviceId: string; minted: boolean } | null,
): Promise<NextResponse> {
  console.info("[blob] upload", summarizeBlobEvent(body));

  try {
    const token = process.env.OPEN_HIGGSFIELD_READ_WRITE_TOKEN;
    if (!token) throw new Error("Missing OPEN_HIGGSFIELD_READ_WRITE_TOKEN");
    const json = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        /* The ceiling and the allow-list ride on the token itself, so the
           browser cannot widen either after it is issued. */
        const limits = uploadLimits(pathname);
        /* Already refused above; re-read here because the token, not the
           handler, is what Blob enforces at the edge. */
        if (!limits) throw new Error("Unsupported file type");
        console.info("[blob] token", { pathname, max: limits.maximumSizeInBytes });
        return {
          ...limits,
          addRandomSuffix: true,
          validUntil: Date.now() + TOKEN_LIFETIME_MS,
        };
      },
    });
    return withDeviceCookie(
      json.type === "blob.generate-client-token" && body.type === "blob.generate-client-token"
        ? NextResponse.json({ ...json, pathname: body.payload.pathname })
        : NextResponse.json(json),
      device,
    );
  } catch (error) {
    console.error("[blob] upload failed", error instanceof Error ? error.message : error);
    if (device?.minted) return withDeviceCookie(new NextResponse(null, { status: 500 }), device);
    throw error;
  }
}

/** The shape the platform client already speaks, so the studio reads one field
    whichever side refused. */
function reject(status: number, detail: string): NextResponse {
  return NextResponse.json({ detail }, { status });
}

function withDeviceCookie(
  response: NextResponse,
  device: { deviceId: string; minted: boolean } | null,
) {
  if (device?.minted) response.cookies.set(DEVICE_COOKIE, device.deviceId, DEVICE_COOKIE_OPTIONS);
  return response;
}

function withDevicePath(body: HandleUploadBody, deviceId: string): HandleUploadBody {
  if (body.type !== "blob.generate-client-token") return body;
  return {
    ...body,
    payload: { ...body.payload, pathname: blobPathname(deviceId, body.payload.pathname) },
  };
}

function summarizeBlobEvent(body: HandleUploadBody) {
  if (body.type === "blob.generate-client-token") {
    return { type: body.type, pathname: body.payload.pathname };
  }
  return { type: body.type, url: body.payload.blob.url };
}
