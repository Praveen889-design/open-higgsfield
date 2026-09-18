import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { PLATFORM_KEY_COOKIE, decodeCredentials } from "@/generation/credentials";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_OPTIONS,
  blobPathname,
  resolveDeviceId,
} from "@/generation/device";

/* An upload is only useful to a caller who can also generate, and generating
   already needs the visitor's own platform key. That key is the gate this
   route was waiting for: without it, the endpoint hands a scoped write token
   for this project's Blob store to anyone who can reach the URL. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await hasPlatformKey())) {
    return NextResponse.json({ error: "Add your platform key first" }, { status: 401 });
  }
  const incoming = (await request.json()) as HandleUploadBody;
  const device =
    incoming.type === "blob.generate-client-token" ? await readDeviceId() : null;
  const body = device ? withDevicePath(incoming, device.deviceId) : incoming;
  console.info("[blob] upload", summarizeBlobEvent(body));

  try {
    const token = process.env.OPEN_HIGGSFIELD_READ_WRITE_TOKEN;
    if (!token) throw new Error("Missing OPEN_HIGGSFIELD_READ_WRITE_TOKEN");
    const json = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        console.info("[blob] token", { pathname });
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "video/mp4",
            "audio/wav",
            "audio/x-wav",
          ],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
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

/* The same cookie the generate action reads, checked the same way: a value
   that is not a well-formed id:secret is no key at all. */
async function hasPlatformKey() {
  const jar = await cookies();
  return decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value) !== null;
}

async function readDeviceId() {
  const jar = await cookies();
  return resolveDeviceId(jar.get(DEVICE_COOKIE)?.value);
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
