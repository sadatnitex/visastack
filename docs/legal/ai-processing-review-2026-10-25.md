# AI Processing Review: Sending Traveller Documents to AI Providers

Engineering compliance review, 25 October 2026. **Not legal advice.** Written by the engineering
side to help a licensed lawyer review quickly. Every legal point below needs that lawyer's
confirmation before VisaStack handles real applicant documents with AI. Points marked
**(unverified)** could not be checked against the primary source on the day of writing (the
official pages could not be fetched from the build environment); they rest on search summaries of
those pages or on general knowledge, and must be read in the original.

Related: [privacy notice draft section](privacy-notice-ai-section-draft.md),
[Switch AI Provider runbook](../operations/runbooks/switch-ai-provider.md),
[provider register](../public-beta/PROVIDER-COST-REGISTER.md).

## 1. What actually happens

| AI task | What is sent to the provider | Consent that must be on first |
| --- | --- | --- |
| Read details from a document (extraction) | The text already taken from the document | Let AI Read Details from My Documents (`AI_EXTRACTION`) |
| Suggest a document type (classification) | The same document text | `AI_EXTRACTION` |
| Spot possible inconsistencies | Document text plus the matching profile values | `AI_EXTRACTION` |
| Read text from a scan (OCR) | A picture of the scanned page | Let AI Read Text from My Scans (`AI_OCR`) |
| Explain a readiness gap | The requirement name, state and citation; no document content | None beyond sign-in |

Facts about the system that matter legally:

- **A person always decides.** AI only proposes. Nothing reaches the Master Profile until the
  traveller (or their agency) approves it; "Accept Clear Details" is also a person's click.
  Visa decisions are made by the destination authority, never by VisaStack.
- **Consent is separate and optional.** Both AI consents are separate from the registration
  notice and from core processing; the manual path always works without AI.
- **Who answers.** One active provider configuration (OpenAI, Anthropic or Google Gemini), plus
  at most one fallback that is tried only after a timeout or a rate limit. Each attempt records
  which provider answered. Cached answers are kept apart by provider and model (fixed 25 October
  2026) and reused for at most 30 days by default.
- **Keys** sit encrypted in the database (envelope encryption) and are never shown again after
  saving.
- **Documents that can be sent** include passports, birth certificates, marriage certificates,
  parental consent letters, police clearance, medical reports, mental health certificates,
  photos and bank statements (see `packages/core/src/catalogue/documents.ts`).
- **Data terms are now recorded per configuration** (plan, whether the provider may train on
  inputs, retention, region, terms address, date checked). A platform setting, "Only Use AI
  Providers That Do Not Train on Inputs", off by default by owner decision, blocks any
  configuration not recorded as "does not train". With the setting off, admins see a warning
  whenever real applicant data is on and the active or fallback provider may train or is
  unknown.

### Current risk in one paragraph

The team uses **free API tiers** today. At least one of them (the Gemini API unpaid tier) is
described in Google's terms as using inputs to improve Google's products, with human review
(unverified, section 4). Production runs in controlled pilot ("made-up data only"), but the live
privacy notice (version 2026-10-11.1) tells public-beta users they "may add your own information
and documents at your own risk". **If a beta user uploads a real passport and has switched on an
AI consent while a free tier that trains is active, that passport text or image goes to a
provider that may reuse it.** The new data-terms setting can stop this, but it is off by
default. Public beta directive 11.3 says not to send real passport scans to such an API. This is
the main decision for the owner (section 9).

## 2. Provider terms as understood on 25 October 2026

Record these in AI Settings (Record Data Terms) after reading each page yourself.

| Provider and plan | Trains on inputs? | Retention | Processor terms | Source |
| --- | --- | --- | --- | --- |
| Gemini API, unpaid (free quota, AI Studio) | **Yes**: Google may use content to improve its products; human reviewers may read inputs after disconnecting them from the account (unverified) | Not stated for this tier (unverified) | Not a processor relationship for that use: Google uses the data for its own purposes | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) |
| Gemini API, paid | No: prompts and responses not used to improve products (unverified) | Logged "for a limited period" for abuse detection and legal disclosure; may be stored or cached in any country where Google has facilities (unverified) | Check which Google data processing terms apply to paid Gemini API use | same page |
| Gemini API, EEA, Switzerland, UK users | One version of the terms applies the paid-service data rules to all use from these places, including free quota (unverified; conflicting copies seen) | | | same page |
| OpenAI API | No, by default, for data sent since 1 March 2023, unless the organisation opts in (for example a data-sharing programme for free tokens; check the organisation's data controls) | Abuse-monitoring logs up to 30 days by default; Zero Data Retention or Modified Abuse Monitoring only with OpenAI's approval | OpenAI Data Processing Addendum (check it is signed for the account) | [OpenAI: your data](https://developers.openai.com/api/docs/guides/your-data) |
| Anthropic API (commercial) | No: the Commercial Terms say Anthropic may not train models on Customer Content (inputs and outputs) | Set by the Data Processing Addendum; secondary sources say 30 days (unverified) | Anthropic DPA incorporated into the Commercial Terms | [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms), [DPA](https://www.anthropic.com/legal/commercial-terms/dpa) |

Engineering note: the OpenAI adapter sends `store: false`; nothing in VisaStack asks any
provider to keep data.

## 3. EU GDPR (Regulation (EU) 2016/679)

Source: [Regulation (EU) 2016/679 on EUR-Lex](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

**Does it apply?** Article 3. It applies if VisaStack (or an agency customer acting as
controller) is established in the EU, or offers its service to people who are in the EU. A
Bangladeshi traveller applying from Dhaka for a Schengen visa is not, for that reason alone, "in
the Union". Private file storage is in an EU Cloudflare R2 bucket, but storage location alone does
not make GDPR apply. Lawyer to confirm, per entity and per market.

**Lawful basis.** Article 6. Because AI is optional and has its own switches, consent (6(1)(a))
fits best, with Article 7 conditions: freely given (the manual path keeps working, which helps),
specific, informed and as easy to withdraw as to give (the privacy controls do this).
Contract (6(1)(b)) is weaker because AI is not necessary to deliver the service.

**Special categories.** Article 9. A passport photo is biometric data only when processed by
specific technical means that allow unique identification (Recital 51). Reading text off the
page is not face matching, so OCR of a passport is probably not Article 9 biometric processing.
But document **content** can be special category data: medical reports and mental health
certificates (health), pilgrimage package confirmations (religion), and police clearance certificates
(criminal records, Article 10). Sending those to AI likely needs **explicit** consent under
9(2)(a). The current consent text does not say this. Lawyer to confirm whether the AI consents
must exclude those document types or carry explicit wording.

**Processor terms.** Article 28. A provider that processes only on VisaStack's instructions is a
processor and needs a contract with the Article 28(3) terms (instructions, confidentiality,
security, sub-processors, deletion, audits). OpenAI and Anthropic publish DPAs; Google's paid
terms need checking. **A free tier that uses inputs for the provider's own product improvement
is not acting as a processor for that use**: the provider becomes a separate controller, which
needs its own lawful basis, its own transparency and usually a new consent. In practice: do not
send real personal data to a provider that trains on inputs.

**Sub-processors.** Article 28(2) and (4). Each provider's DPA lists sub-processors and how
changes are announced. VisaStack's own notice must name the AI providers it may use (including
the fallback) and point to their sub-processor lists.

**International transfers.** Chapter V (Articles 44 to 49). All three providers process in the
United States by default. Options: the EU-US Data Privacy Framework adequacy decision of 10 July
2023 if the provider entity is certified (check the DPF list for each), otherwise Standard
Contractual Clauses (Commission Decision 2021/914) with a transfer assessment. The General Court
dismissed a challenge to the Data Privacy Framework in *Latombe v Commission* (T-553/23,
3 September 2025) (unverified; check for any appeal).

**Automated decisions.** Article 22 does not apply: no decision with legal or similarly
significant effects is taken by AI alone. A person approves every suggestion and the visa
authority decides. Keep it that way: never let AI write to the profile, submit an application or
reject a document on its own.

**Impact assessment.** Article 35. Likely required before real data: AI is a new technology,
documents may hold special category data, children's documents are included, and data leaves the
country. Two or more of the EDPB criteria usually means a DPIA is needed.

**Children.** Article 8 (age of consent for online services, 16 by default, member states may
set 13 to 16). Parents create and manage children's profiles; the parent's consent must cover
the child's documents. The Gemini API terms reportedly require users to be 18 or over
(unverified); VisaStack is the API user, not the child, but the lawyer should confirm nothing in
any provider's terms forbids processing children's data.

**Transparency and retention.** Articles 5(1)(e), 13 and 14. The notice must name the AI
providers, the countries, what is sent, how long the provider keeps it, and that VisaStack keeps
AI answers for up to 30 days for reuse.

## 4. Singapore Personal Data Protection Act 2012 (PDPA)

Sources: [PDPA on Singapore Statutes Online](https://sso.agc.gov.sg/Act/PDPA2012),
[PDPC data protection obligations](https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act/data-protection-obligations),
[PDPC Advisory Guidelines on AI Recommendation and Decision Systems (1 March 2024)](https://www.pdpc.gov.sg/-/media/files/pdpc/pdf-files/advisory-guidelines/advisory-guidelines-on-the-use-of-personal-data-in-ai-recommendation-and-decision-systems.pdf).

**Does it apply?** To organisations collecting, using or disclosing personal data in Singapore.
Lawyer to confirm whether any VisaStack entity, agency customer or traveller brings this in.

- **Consent and purpose.** Collection, use and disclosure need consent for purposes a reasonable
  person would consider appropriate, notified beforehand. The AI consents and the notice must
  state the AI purpose.
- **Data intermediaries.** A provider processing on VisaStack's behalf under contract is a data
  intermediary with protection and retention obligations; VisaStack stays responsible as if it
  processed the data itself. A provider that reuses inputs for itself is not a data
  intermediary for that use, so the disclosure needs its own consent.
- **Transfer Limitation Obligation (section 26 and the Personal Data Protection Regulations
  2021).** Before transferring data out of Singapore, VisaStack must make sure the recipient is
  bound by legally enforceable obligations giving a comparable standard of protection, for
  example a contract or a recognised certification. The provider DPAs are the natural
  instrument; the lawyer should confirm they are sufficient.
- **AI guidance.** The 2024 advisory guidelines treat third-party AI service providers as data
  intermediaries and expect transparency about AI use; they are advisory and do not cover
  generative AI specifically.
- **Children.** The PDPC's guidance on children's data expects parental consent for younger
  children (unverified on the exact age line; check the current advisory guidelines).

## 5. Bangladesh personal data protection law

**Which instrument is in force on 25 October 2026: uncertain.** What could be established:

1. The **Personal Data Protection Ordinance, 2025** (Ordinance No. 61 of 2025) was approved by
   the interim government on 9 October 2025 and published in the gazette on 6 November 2025
   ([BSS](https://www.bssnews.net/news-flash/330104)). An unofficial English translation is
   hosted by a third party.
2. A **Personal Data Protection (Amendment) Ordinance, 2026** (Ordinance No. 23 of 2026) was
   reportedly issued on 5 February 2026 ([Digital Policy Alert](https://digitalpolicyalert.org/change/18757-personal-data-protection-amendment-ordinance-2026-ordinance-no-23-of-2026),
   [Daily Sun](https://www.daily-sun.com/bangladesh/856282/personal-data-protection-ordinance-reissued-after-amendment)).
3. Under Article 93(2) of the Constitution, an ordinance laid before Parliament stops having
   effect 30 days after it is laid unless Parliament acts. The new Parliament first sat in March
   2026 and sent the interim government's ordinances to a special committee
   ([Financial Express](https://thefinancialexpress.com.bd/national/133-interim-govt-ordinances-sent-for-review)).
4. Secondary sources say Parliament then passed a **Personal Data Protection Act, 2026** in or
   around April 2026, repealing the ordinance. This could not be checked against the official
   text on [bdlaws.minlaw.gov.bd](http://bdlaws.minlaw.gov.bd/) or the gazette, and one April 2026
   industry submission described the text as still before Parliament.

So the lawyer must confirm which text is law today, its commencement dates (reports on the
ordinance said some duties start 18 months after publication) and whether the Act changed them.
No section numbers are given here on purpose.

Themes reported for the ordinance (all to be checked in the enacted text): explicit consent for
collection, stricter rules for sensitive and cross-border data, rights of access, correction,
deletion and over automated decisions, parental consent for children's data, data localisation
(narrowed by the February 2026 amendment), and fines tied to turnover.

## 6. Topic checks

- **Consent wording in the product today.** `AI_EXTRACTION`: "The text of a document is sent to
  an AI service to suggest values. You approve each one." `AI_OCR`: "The picture of a scan is sent
  to an AI service to read it. This shares more than text alone." Good: plain, separate,
  optional, honest about images. Missing: which providers, that they may be outside the
  traveller's country, how long they keep data, whether they may train on it, that a fallback
  provider may answer, and explicit wording for health, religion or criminal-record documents.
- **Free tier versus paid tier.** The legal difference is not price but who controls the data
  afterwards. A tier that trains on inputs turns the provider into a separate controller; a tier
  that does not, under a DPA, keeps it a processor. Moving to paid is what makes the processor
  model work for real documents. The "Only Use AI Providers That Do Not Train on Inputs" setting
  enforces this once switched on.
- **Retention.** Providers: up to about 30 days for abuse monitoring (OpenAI), "a limited
  period" (Gemini paid), DPA-defined (Anthropic). VisaStack: AI answers reused from cache for 30
  days by default (`AI_CACHE_MAX_AGE_DAYS`), run records kept with the case. State both in the
  notice.
- **Sub-processors.** Each provider uses its own cloud infrastructure; link their lists.
- **Children and guardians.** Children's passports and birth certificates are core documents.
  Consent comes from the parent or guardian managing the profile; the notice should say so.
- **Biometric photos.** Passport photo pages go to OCR as images. Not face recognition, but the
  face is in the image. Treat as high sensitivity: paid, no-training provider only, and consider
  cropping the photo area before OCR in a later change.

## 7. What engineering already does

Separate optional AI consents; person approves every suggestion; manual path always available;
per-document and monthly budgets and attempt caps; kill switch and rollback; keys encrypted;
`store: false` for OpenAI; per-configuration data terms with audit history; the switch to block
providers that may train (off by default); admin warning when real data is on; cache kept apart by
provider and model.

## 8. Checklist for the licensed lawyer

1. Which laws apply to which VisaStack entity and customer (GDPR Article 3, PDPA, Bangladesh).
2. Which Bangladesh instrument is in force today and when its duties start.
3. Lawful basis for AI processing, and whether the current consent text is enough, including
   explicit consent for health, religion and criminal-record documents.
4. That each provider's paid terms and DPA meet GDPR Article 28(3) and PDPA section 26.
5. Transfer mechanism for each provider (Data Privacy Framework certification or SCCs).
6. Whether a DPIA is required before real data, and sign-off of it.
7. Parental consent wording for children's documents.
8. The privacy notice AI section (draft linked above).

## 9. Owner decisions needed

1. **Switch "Only Use AI Providers That Do Not Train on Inputs" on now**, or at least before any
   real applicant document can reach AI. The beta notice invites people to add their own
   documents, so "made-up data only" is a rule users can break.
2. Move the active provider to a paid tier that does not train on inputs before charging starts
   (runbook step 4).
3. Commission the lawyer review and the DPIA.
