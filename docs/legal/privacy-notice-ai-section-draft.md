# Privacy Notice: AI Section (Draft)

Draft, 25 October 2026. **Not yet reviewed by a lawyer and not live.** For the privacy notice
after version 2026-10-11.1. Background: [AI processing review](ai-processing-review-2026-10-25.md).
Words in [square brackets] must be filled in or confirmed before publishing.

---

## How We Use AI

AI is optional. You can fill in every detail yourself, and nothing changes if you never switch AI
on.

**What AI does.** When you ask it to, an AI service reads a document and suggests details, such
as the passport number or expiry date, or suggests what kind of document it is, or points out
details that do not match. It only suggests. Nothing is added to your profile until you, or an
agency you work with, accept it. AI never decides anything about your visa.

**Your two choices.** You turn these on or off at any time in Privacy:

- **Let AI Read Details from My Documents.** We send the text of the document to the AI
  service.
- **Let AI Read Text from My Scans.** We send a picture of the scanned page. A picture can
  include your photo, so it shares more than text alone.

Turning a choice off stops future sending. It does not recall what was already sent.

**Who reads it.** We use [one of] these AI services: [OpenAI, Anthropic, Google (Gemini)]. If
the main one is busy or slow, we may send the same request to [the next one in our list]. They
may process it in [the United States] and other countries where they operate. We send the
request under agreements that say they may use it only to answer us, and that they do not use it
to train their AI. [Confirm for each provider before publishing.]

**How long it is kept.** The AI service may keep a request for up to [30] days to check for
misuse, then deletes it, unless the law requires longer. We keep the AI's suggestions for up to
[30] days so we do not have to ask again, and we keep a record of what was suggested and what you
decided as part of your case history.

**Sensitive documents.** Some documents, such as medical reports, police certificates or
religious travel papers, can reveal sensitive facts. [Either: We do not send these to AI. Or:
We send these only if you choose to use AI on that document.]

**Children.** A parent or guardian who manages a child's profile makes these choices for the
child.

**Your rights.** You can ask what we sent, ask us to correct or delete your details, and object
to AI use, using Privacy in your account or by writing to [contact address].

---

Notes for the reviewer (not for publishing):

- Keep the consent names exactly as they appear in the product (Title Case, from
  `apps/web/src/lib/labels.ts`).
- Publish only once the active and fallback providers are on a plan recorded in AI Settings as
  "does not train on inputs", or remove the sentence saying so.
- Name the fallback provider if one is configured; the notice must not promise one provider when
  two may answer.
