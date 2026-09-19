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

/* What a platform refusal means, keyed on the status rather than the words.

   The API's own guidance is not to read the human message for decisions — the
   envelope is `{ detail }` free text that can be reworded whenever they like,
   while the status is documented and stable. So the status picks the sentence
   and the detail is repeated only where it carries the specifics: which
   parameter, which field. Anything unmapped falls back to the platform's own
   words rather than a shrug. */
export function platformFailureText(status: number, detail?: string): string {
  const said = detail?.trim();
  const withDetail = (text: string) => (said ? `${text} The platform said: ${said}.` : text);

  switch (status) {
    case 400:
      return withDetail("The platform rejected these settings, or too many runs are in flight.");
    case 401:
      return "The platform rejected your key. Check it in the sidebar — a new one may be needed.";
    case 403:
      return "Your platform account is out of credits. Add credits, then run it again.";
    case 404:
      return "This model is not available on your account.";
    case 422:
      return withDetail("The request was not valid for this model.");
    case 423:
      return "This model is temporarily blocked. Try it again later, or pick another.";
    case 500:
      return "The platform hit a server error. Give it a moment and try again.";
    case 503:
      return "This model is disabled or not ready yet. Pick another for now.";
    default:
      return said ? `The platform refused this run — ${said}.` : "The platform refused this run.";
  }
}
