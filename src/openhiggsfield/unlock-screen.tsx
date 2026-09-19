"use client";

import { useState, type FormEvent } from "react";

/* The door, and nothing else. No model names, no counts, no gallery — a locked
   instance should not describe what is behind it. */
export function UnlockScreen({ fontClassName = "" }: { fontClassName?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? "Could not unlock the studio.");
        setBusy(false);
        return;
      }
      /* A full load rather than a router refresh: the proxy decides what this
         URL serves, and only a fresh request asks it again. */
      window.location.replace("/");
    } catch {
      /* Only the transport gets here — a refused code came back as a value. */
      setError("Could not reach the studio. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className={`ohf ohf-lock ${fontClassName}`}>
      <div className="ohf-dialog-panel ohf-lock-panel">
        <div className="ohf-keys-head">
          <div>
            <div className="ohf-keys-title">Access code</div>
            <p className="ohf-keys-copy">
              This studio is private. Enter the code you were given to continue.
            </p>
          </div>
        </div>

        <form className="ohf-keys-form" onSubmit={(event) => void onSubmit(event)}>
          <label className="ohf-field">
            <div className="ohf-field-label">Code</div>
            <input
              className="ohf-input ohf-input--mono"
              name="access_code"
              type="password"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>

          {error && (
            <div className="ohf-alert" role="alert">
              <span className="ohf-alert-text">{error}</span>
            </div>
          )}

          <div className="ohf-keys-actions">
            <button type="submit" className="ohf-keys-save" disabled={busy || !code.trim()}>
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
