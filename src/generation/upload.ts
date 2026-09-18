import { put } from "@vercel/blob/client";

/** A refusal the route decided, rather than a fault in the Blob store: the
    message is already addressed to the visitor and names what to do, so the
    tray shows it as it stands instead of wrapping it in storage advice. */
export class UploadRejectedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadRejectedError";
    this.status = status;
  }
}

export async function uploadMedia(file: File): Promise<{ url: string }> {
  const res = await fetch("/api/blob", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname: file.name, clientPayload: null, multipart: false },
    }),
  });
  if (!res.ok) {
    const detail = await rejectionDetail(res);
    if (detail) throw new UploadRejectedError(res.status, detail);
    throw new Error("Failed to retrieve the client token");
  }
  const { clientToken, pathname } = (await res.json()) as {
    clientToken?: unknown;
    pathname?: unknown;
  };
  if (typeof clientToken !== "string" || typeof pathname !== "string") {
    throw new Error("Failed to retrieve the client token");
  }
  const blob = await put(pathname, file, { access: "public", token: clientToken });
  return { url: blob.url };
}

async function rejectionDetail(res: Response): Promise<string | null> {
  if (![401, 403, 415, 429].includes(res.status)) return null;
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === "string" && body.detail ? body.detail : null;
  } catch {
    return null;
  }
}
