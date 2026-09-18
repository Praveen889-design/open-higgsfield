/* Why an action declined, as a value rather than a message.

   A server action's throw does not survive the call: the error is serialized,
   so the class is gone, and a production build replaces the message with a
   generic line besides. Anything the studio needs to *branch* on therefore has
   to come back as data and be turned into an error on this side, where an
   instanceof still means something. */

export type ActionRefusal = "missing-key" | "locked";

export class ActionRefusedError extends Error {
  readonly refusal: ActionRefusal;

  constructor(refusal: ActionRefusal) {
    super(refusalText(refusal));
    this.name = "ActionRefusedError";
    this.refusal = refusal;
  }
}

export function refusalText(refusal: ActionRefusal): string {
  return refusal === "locked"
    ? "This studio is locked. Reload the page and enter the access code."
    : "Add your platform key to generate.";
}

/** The refusal behind a caught value, or null when it was a real failure. */
export function refusalOf(caught: unknown): ActionRefusal | null {
  return caught instanceof ActionRefusedError ? caught.refusal : null;
}
