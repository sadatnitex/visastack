# Switch AI Provider

For a platform admin with the security admin role. Everything happens in **Admin, AI Settings**
(`/app/admin/ai-settings`). No deploy, no code change, no Vercel or Neon change. Every step that
changes something asks you to sign in again and is written to the audit history.

Before you start: the provider's API key must be at hand (it is typed once into the form,
stored encrypted, and never shown again). Use made-up documents only for any check.

## 1. See what is running now

At the top of the page, **What AI Providers Do with What We Send** shows:

- **Data on This Platform**: Made-Up Data Only, or Real Applicant Data On.
- **Only Use Providers That Do Not Train on Inputs**: On or Off.
- A warning for the active provider and for its fallback if real applicant data is on and the
  provider may train on inputs, is not known, or has no terms recorded. With the setting off, AI
  keeps running; with it on, that provider is not used.

Each configuration card below shows its status (Draft, Active, Superseded, Disabled) and its
recorded data terms.

## 2. Record the provider's data terms

Read the provider's current terms yourself (links in the
[provider register](../../public-beta/PROVIDER-COST-REGISTER.md)). On the configuration's card,
open **Record Data Terms** and fill in: Plan (Free or Paid), May Train on What It Is Sent (Yes,
No, Not Known), Kept for How Many Days, Where It Is Processed, Terms Address, Date Checked, and a
short note of what the terms say. Select **Save Data Terms**. A "No" needs the terms address.
Repeat whenever the provider changes its terms, and at least every 180 days (the card says
"check again" when due).

## 3. Switch to a different provider or model

1. **Create Draft**: choose the provider, type the model name, paste the API key, set the
   monthly budget (and optional per-document budget and attempt limit), tick the data policy
   box, and fill in Provider Data Terms. Optionally tick fallback and pick the configuration to
   fall back to (a different provider). Select **Save Draft**. Nothing changes for users yet.
2. **Test Connection** on the new draft. Optional: **Run Evaluation (13 Cases)**, which uses
   made-up documents only.
3. **Activate**. It replaces the active configuration at once; the old one becomes Superseded.
4. Check: open a made-up applicant, select **Read Details from This Document**, and confirm a
   suggestion appears.

To go back: **Roll Back** restores the last eligible previous configuration. To stop all AI at
once: **Emergency Disable**. If a key leaks: **Revoke Key** on that card (cannot be undone), then
rotate the key at the provider.

## 4. Move to a paid tier when charging starts

1. At the provider, put the account on a paid plan (Gemini: turn on billing for the project;
   OpenAI and Anthropic API use is paid already, but check the organisation's data controls have
   no data-sharing or training opt-in). Sign the provider's data processing agreement.
2. If the key changed, create a new draft with the paid key (step 3). If the key is the same,
   still record fresh terms on the active configuration (step 2): Plan Paid, May Train No, the
   terms address and today's date.
3. Do the same for the fallback configuration, or turn fallback off.
4. Turn **Only Use Providers That Do Not Train on Inputs** on (step 5).
5. Confirm the warning at the top of the page has gone and a made-up document still gets
   suggestions.
6. Update the privacy notice AI section (`docs/legal/privacy-notice-ai-section-draft.md`) with the
   providers now in use, after legal review.

## 5. Turn the data setting on or off

In the top card, add an optional reason and select **Turn On** (or **Turn Off**), confirm, and
sign in again if asked. It takes effect on the next AI request. When on, any active or fallback
configuration not recorded as "does not train on inputs", with its terms address, is not used,
and travellers see AI as unavailable while every manual path keeps working. Turn it on before
real applicant documents can reach AI.

## If something is wrong

- "Cannot be saved until the latest database update has been applied": the data-terms update
  (migration 0088) has not been run on this database yet. Ask the owner to approve that specific
  migration run. Until then every provider reads as "not recorded" and the setting reads as Off.
- AI unavailable after switching the setting on: record terms for the active provider, or switch
  to one that does not train on inputs.
- Provider outage: see [AI provider incident](../incidents/ai-provider-issue.md).
