/* Why an action declined, as a value rather than a message.

   A server action's throw does not survive the call: the error is serialized,
   so the class is gone, and a production build replaces the message with a
   generic line besides. Anything the studio needs to *branch* on therefore has
   to come back as data and be turned into an error on this side, where an
   instanceof still means something. */

/* "platform" is the platform's own refusal — out of credits, a rejected key,
   a model that will not take this input. It reads differently from the other
   two: they are answerable here, this one is answerable only over there, and
   it arrives with words worth repeating verbatim. */
export type ActionRefusal = "missing-key" | "locked" | "platform";

export class ActionRefusedError extends Error {
  readonly refusal: ActionRefusal;

  constructor(refusal: ActionRefusal, detail?: string) {
    super(detail?.trim() ? detail.trim() : refusalText(refusal));
    this.name = "ActionRefusedError";
    this.refusal = refusal;
  }
}

export function refusalText(refusal: ActionRefusal): string {
  if (refusal === "locked") return "This studio is locked. Reload the page and enter the access code.";
  if (refusal === "platform") return "The platform refused this run.";
  return "Add your platform key to generate.";
}

/** The refusal behind a caught value, or null when it was a real failure. */
export function refusalOf(caught: unknown): ActionRefusal | null {
  return caught instanceof ActionRefusedError ? caught.refusal : null;
}
