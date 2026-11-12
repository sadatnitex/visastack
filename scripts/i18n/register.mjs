/**
 * Bengali lookup from docs/localization/VISASTACK_TRANSLATION_REGISTER.csv.
 *
 * A message's register row is found first through the census (same file, line and English,
 * which keeps homographs apart), then by exact English when exactly one register row has it.
 * Bengali is used only when the row's automated_checks starts with PASS, its placeholders are
 * the message's placeholders, and it holds no em dash or unresolved marker. Anything else is
 * left to English fallback with a reason.
 *
 * Owner rule (the language switch goes live): Bengali comes only from register rows in the
 * ordinary-screen review queue. Rows in the commercial, privacy/consent/legal and official visa
 * requirement queues (and any row with no queue) keep English until the owner signs them off,
 * whatever their automated checks say. Add a queue to RELEASED_QUEUES only on that sign-off.
 */

/** Review queues whose Bengali must not ship yet. Anything not ORDINARY_UI is held back. */
export const RELEASED_QUEUES = new Set(['ORDINARY_UI']);
import { readIfExists } from './catalog.mjs';

/**
 * Register rows that stay English even though their review queue is released, each with the
 * reason. Add a row here when the owner or the review decides a specific string waits; remove it
 * only on that sign-off.
 */
export const HOLDBACK = new Map([
  [
    'SG-dc1af39a',
    'Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.',
  ],
  [
    'SG-02a56416',
    'Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.',
  ],
  [
    'SG-79505021',
    'Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.',
  ],
  [
    'SG-c55cd000',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-0c3da2e7',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-7fed393b',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-f22cca12',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-6840bbdb',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-8fe742c5',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-e432687f',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-96726f73',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-b80f590e',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-60e310fc',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-6c449ccc',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-c2caee76',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-4ac01dc9',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-c7267817',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-8b21f490',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-04cc7a8e',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-426b883f',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-8600dbb5',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-1fbf4fdc',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-634bfe2f',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-7f54db09',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-5ca1af5a',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-94189b82',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-b4d0d729',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-0cb96f1d',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-b8f9ef37',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-2e6db3da',
    'Applicant sharing: who can see what, grants, expiry, revocation, access summary or AI tools wording; waits for the owner sign-off.',
  ],
  [
    'SG-7393361c',
    'Applicant calendar link: private link sharing, revoking and what it reveals; access-control wording waits for the owner sign-off.',
  ],
  [
    'SG-c94b606c',
    'Applicant calendar link: private link sharing, revoking and what it reveals; access-control wording waits for the owner sign-off.',
  ],
  [
    'SG-0d5c8615',
    'Applicant calendar link: private link sharing, revoking and what it reveals; access-control wording waits for the owner sign-off.',
  ],
  [
    'SG-330cb2d9',
    'Applicant calendar link: private link sharing, revoking and what it reveals; access-control wording waits for the owner sign-off.',
  ],
  [
    'SG-ea7f1da4',
    'Applicant calendar link: private link sharing, revoking and what it reveals; access-control wording waits for the owner sign-off.',
  ],
  [
    'SG-1741082c',
    'Applicant evidence: says an agency request is not a government rule; official-rule wording waits for the owner sign-off.',
  ],
  [
    'SG-f07aea90',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-0eec3e1b',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-554ff162',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-ad36e94f',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-4c01c938',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-b6c2f783',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-ccbd8ad0',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-d7aece0b',
    'Applicant insights: claims about what VisaStack reads or infers, and embassy original-paper rules; waits for the owner sign-off.',
  ],
  [
    'SG-f9667433',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-fd86bb23',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-76d5a28d',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-afed0db1',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-afc89023',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-9d556125',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-1fbade6c',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-2bf9eb27',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-990cfc21',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-12ffe6ee',
    'Applicant memory: claims about what VisaStack remembers and keeps, and who records were shared with; waits for the owner sign-off.',
  ],
  [
    'SG-d0d5e75c',
    'Applicant cases: promise about how existing records are reused for a new case; waits for the owner sign-off.',
  ],
  [
    'SG-fb46562d',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-2ebd55a3',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-5f596105',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-b59bc29b',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-6bfef43e',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-d6f8451e',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-ec12eea0',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-37f0599e',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-fd5a5483',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-3a3fd00f',
    'Applicant outputs: privacy promises about what a generated summary holds, and confirmed-details wording; waits for the owner sign-off.',
  ],
  [
    'SG-22bda9c8',
    'Public beta risk notice (real details, virus scanning): wording waits for the owner sign-off.',
  ],
  [
    'SG-0f9d5b37',
    'Consent acknowledgement (marketing, AI processing, sharing): wording waits for the owner sign-off.',
  ],
  [
    'SG-361e0c20',
    'Terms: a legal document name, held English like Privacy until the owner signs off.',
  ],
  [
    'SG-57e8fee4',
    'Free-at-your-own-risk notice (virus scanning not yet on): a risk notice, waits for the owner sign-off.',
  ],
  [
    'SG-8939253f',
    'Privacy heading (how information is treated): privacy wording waits for the owner sign-off.',
  ],
  [
    'SG-fe6d2f71',
    'Sharing flow description that mentions agreeing to share: consent wording waits for the owner sign-off.',
  ],
  [
    'SG-cda9a1ac',
    'Sharing starts with permission: a consent promise, waits for the owner sign-off.',
  ],
  [
    'SG-461caf20',
    'Trust page disclaimer (no approval guarantees): legal-style disclaimer, waits for the owner sign-off.',
  ],
  ['SG-b6f48122', 'Private by Design: a privacy claim, waits for the owner sign-off.'],
  [
    'SG-f92f9f0f',
    'Not Currently Verified: status of official visa information, waits for the owner sign-off.',
  ],
  [
    'SG-8e79eb73',
    'Official Channel: points to official visa sources, waits for the owner sign-off.',
  ],
  [
    'SG-7d8d7a57',
    'Invitation terms of sharing (what happens if you accept): consent wording, owner sign-off.',
  ],
  [
    'SG-c26f3e5b',
    'Invitation consent statement (nothing shared until you accept): owner sign-off.',
  ],
  [
    'SG-1fec77cc',
    'Invitation acceptance statement (opening the link accepts nothing): owner sign-off.',
  ],
  [
    'SG-f5a73aec',
    'Invitation consent withdrawal statement (stop sharing at any time): owner sign-off.',
  ],
  ['SG-f8a50812', 'Invitation expiry rule (7 days) and revocation: a stated rule, owner sign-off.'],
  [
    'SG-57b3157f',
    'Agency invitation promise on the home page (you approve it, you can stop it): consent wording, owner sign-off.',
  ],
  [
    'SG-58fc0338',
    'Your records belong to you, choose the recipient: a sharing and ownership promise, owner sign-off.',
  ],
  [
    'SG-4bfc56d4',
    'Review, pause or end future access: a statement about stopping sharing, owner sign-off.',
  ],
  [
    'SG-a5b2278c',
    'A suggestion stays separate until you approve it: a promise about AI and confirmed facts, owner sign-off.',
  ],
  [
    'SG-2604b090',
    'AI never changes your profile on its own: a promise about AI behaviour, owner sign-off.',
  ],
  [
    'SG-e956303b',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-0c3f69ec',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-192889ed',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-fbccaafa',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-b5644201',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-c68a7790',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-58cc6dc1',
    'Document requirement for a country route (how recent a document must be): official visa-rule content stays English.',
  ],
  [
    'SG-50c83703',
    'Sharing permission statement: wording waits for the owner sign-off with the other sharing and consent text.',
  ],
  [
    'SG-00706ded',
    'Invitation and sharing choice statement: wording waits for the owner sign-off with the other sharing and consent text.',
  ],
  [
    'SG-9e771a8e',
    'Joiner word between names (" or "): its spaces carry the layout and the sentence around it is still English.',
  ],
  [
    'SG-e6123c0d',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-0016aa98',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-5018af46',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-e7158ae3',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-afe937a3',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-ce511844',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-81bf750c',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-67266d24',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-61e87632',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-8829c695',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-72d9142d',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-a59d20ba',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-882d2ab6',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-6dc10a9f',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-24776023',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-1436ceee',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-1065be84',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-5463c56c',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-b9d38c86',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-0b6663fd',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-226bab50',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-f6430216',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-03b8a6b0',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-4d48fa01',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-197fdeca',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-eac05478',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-3a222fbf',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-e78bd437',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-f1f5bccb',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-7b432da4',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-fe795501',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-a17de272',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-66f87a10',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-583aa6b5',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-3141220f',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-16600835',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-37c14fc0',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-b41c58b1',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-3d6b855e',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-e3fdc097',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-eb382184',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-8546093a',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-de969496',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-59d94eb1',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-5a6c4e41',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-b08c4520',
    'Applicant screens: Process promise about checking saved documents against a checklist: waits for the owner sign-off.',
  ],
  [
    'SG-d7a62e22',
    'Applicant screens: Status of automatic reading (AI processing): waits for the owner sign-off.',
  ],
  [
    'SG-1549c176',
    'Applicant screens: Statement about what visa forms require: waits for the owner sign-off.',
  ],
  [
    'SG-ff7d2a1c',
    'Applicant screens: Statement about what visa forms require: waits for the owner sign-off.',
  ],
  [
    'SG-d9696fe7',
    'Applicant screens: Says a value was read from the document by automatic reading (AI processing): waits for the owner sign-off.',
  ],
  [
    'SG-ac40a214',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-338d92d1',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-c9a7f414',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-aa9771db',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-19b168cd',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-68e8afb4',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-fe5feab6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-6cdf21a6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-a8684ed6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-dedaa54b',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-4e812a3e',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-826d2c99',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-153f9777',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-c1fb8969',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-658e1cac',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-d2c91826',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-ba0fbeb7',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-e4498255',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-d5319908',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8d14d065',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-e8727ba5',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8881fc69',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8fd6641e',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-bd7b343f',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-9d878677',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-a7694752',
    'Applicant screens: Joiner text whose trailing space carries the layout, so its Bengali would run into the next sentence.',
  ],
  [
    'SG-6775fd3b',
    'Applicant screens: Heading over what automatic reading found (AI processing): waits for the owner sign-off.',
  ],
  // Wave E: case screens and the document collection flow.
  ['SG-094bebc7', 'Case answer status "Submitted to Agency": a sharing outcome, owner sign-off.'],
  [
    'SG-45ad6a0b',
    'What the agency can open of a submitted answer: access control wording, owner sign-off.',
  ],
  ['SG-2b1514c9', 'Agency not yet reviewed: a trust status about an agency, owner sign-off.'],
  [
    'SG-d39a9da3',
    'Nothing can be shared until the agency is reviewed: sharing and access wording, owner sign-off.',
  ],
  ['SG-dc081055', 'Private link opened has shared nothing: a sharing promise, owner sign-off.'],
  ['SG-d7bcf439', 'Confirm it is you, no account is made: a privacy promise, owner sign-off.'],
  [
    'SG-a5fa0621',
    'Checked date and confirm final requirements with the authority: official visa requirement wording, owner sign-off.',
  ],
  [
    'SG-9574696f',
    'Case removed for good with its contents: a data deletion promise, owner sign-off.',
  ],
  [
    'SG-8987f99a',
    'What a sponsor or family member sees of your record: sharing wording, owner sign-off.',
  ],
  [
    'SG-991b05ef',
    'Which agency notes are shared and which never are: sharing and access wording, owner sign-off.',
  ],
  ['SG-079d1f0e', 'What the contributor will see: sharing wording, owner sign-off.'],
  ['SG-e4a97e33', 'Who sees a complaint: access control and privacy promise, owner sign-off.'],
  ['SG-98c55098', 'Who reviews a complaint: access control and privacy promise, owner sign-off.'],
  [
    'SG-f0bd6092',
    'Nothing is sent until you share it yourself: a sharing promise, owner sign-off.',
  ],
  [
    'SG-63dab094',
    'Generated from confirmed evidence, not AI-written: a claim about AI behaviour, owner sign-off.',
  ],
  [
    'SG-d3914f71',
    'Reason to reject or request a correction of an agency snapshot: approval action wording, owner sign-off.',
  ],
  [
    'SG-5efa8d43',
    'Access and permissions stay separate per case: access control wording, owner sign-off.',
  ],
  [
    'SG-84514c27',
    'Trip date checks are not country rules: official visa rule wording, owner sign-off.',
  ],
  [
    'SG-c0b36ea9',
    'Done or cancelled task count: the number word comes from an English helper, so the sentence would mix scripts; waits for a proper plural message.',
  ],
  [
    'SG-4fbf3546',
    'Optional marker with a leading separator: the Bengali drops the space that joins it to the label.',
  ],
  [
    'SG-c60ff807',
    'Already sent note that follows other text: the Bengali drops the leading space.',
  ],
  [
    'SG-cb6538b8',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-260ff35f',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-e004a268',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-86f84a55',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  // Wave F part 1: account, privacy, trip invitations, notifications, shared.
  [
    'SG-3a144529',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-39303114',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-d5eb6533',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-df4ae9fc',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-8d730501',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-529d695c',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-9c7d6ee0',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-7739b95f',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-8be28114',
    'Privacy page and account deletion or export wording (PR #518): owner-approved legal text, stays English.',
  ],
  [
    'SG-9b86192c',
    'Data Rights heading on the account page: privacy wording waits for the owner sign-off.',
  ],
  [
    'SG-aeff30b3',
    'Billing line with an amount and date: payment wording waits for the owner sign-off.',
  ],
  [
    'SG-0006fab9',
    'AI Features in the plan list: AI processing allowance wording waits for the owner sign-off.',
  ],
  [
    'SG-88aeced1',
    'Trip invitation sharing choices (what you share with the organiser): consent wording, owner sign-off.',
  ],
  [
    'SG-436b1b32',
    'Trip invitation sharing choices (what you share with the organiser): consent wording, owner sign-off.',
  ],
  [
    'SG-89e5a96d',
    'Trip invitation expiry and unavailable states: invitation terms, owner sign-off.',
  ],
  [
    'SG-1c102ea8',
    'Trip invitation expiry and unavailable states: invitation terms, owner sign-off.',
  ],
  [
    'SG-750b0e73',
    'Trip invitation expiry and unavailable states: invitation terms, owner sign-off.',
  ],
  [
    'SG-c983b88e',
    'Safe copy (redacted document) explanation or status: privacy promise, owner sign-off.',
  ],
  [
    'SG-0b90abd7',
    'Safe copy (redacted document) explanation or status: privacy promise, owner sign-off.',
  ],
  [
    'SG-e2005eec',
    'Safe copy (redacted document) explanation or status: privacy promise, owner sign-off.',
  ],
  [
    'SG-93434b03',
    'Shared workspace access rules (what a grant covers): access control wording, owner sign-off.',
  ],
  [
    'SG-5f0ee722',
    'Shared workspace access rules (what a grant covers): access control wording, owner sign-off.',
  ],
  [
    'SG-a23537b2',
    'Shared workspace access rules (what a grant covers): access control wording, owner sign-off.',
  ],
  [
    'SG-7f6342c7',
    'Statement that nothing was shared with you: sharing permission wording, owner sign-off.',
  ],
  [
    'SG-9da51aed',
    'Statement that nothing was shared with you: sharing permission wording, owner sign-off.',
  ],
  [
    'SG-1167490a',
    'Statement that nothing was shared with you: sharing permission wording, owner sign-off.',
  ],
  [
    'SG-938c310f',
    'Statement that nothing was shared with you: sharing permission wording, owner sign-off.',
  ],
  [
    'SG-04e98a42',
    'Invoice reference on the plan page: invoice and payment wording waits for the owner sign-off.',
  ],
  [
    'SG-a104e7e5',
    'Now (state of an AI feature in the plan list): AI allowance wording waits for the owner sign-off.',
  ],
  [
    'SG-4bd5843b',
    'Remove: {name} (accessible name of the Remove button): the visible button text stays English, so the name waits with it.',
  ],
  [
    'SG-674ee0dc',
    'Shared-access end date label: access and expiry wording waits for the owner sign-off.',
  ],
  [
    'SG-8205ffbd',
    'Invitation recovery help (new link or invited email): invitation access wording waits for the owner sign-off.',
  ],
  [
    'SG-515d1469',
    'Invitation expiry label: invitation expiry wording waits for the owner sign-off.',
  ],
  [
    'SG-03d5ab6c',
    'Opening an invitation grants no access: a consent statement, waits for the owner sign-off.',
  ],
  [
    'SG-8600dbb5',
    'Permissions heading on a sharing invitation: access control wording waits for the owner sign-off.',
  ],
  [
    'SG-b1994b75',
    'Agency AI note on the client invitation: AI and consent wording waits for the owner sign-off.',
  ],
  ['SG-e432687f', 'AI Tools consent toggle: AI processing wording waits for the owner sign-off.'],
  ['SG-02122e22', 'Turn On consent toggle label: consent wording waits for the owner sign-off.'],
  [
    'SG-69e97063',
    'What an agency can do if you accept: access wording waits for the owner sign-off.',
  ],
  ['SG-cdca8c7b', 'Turn these on before accepting: consent wording waits for the owner sign-off.'],
  [
    'SG-1206824f',
    'Contributor request sent to a different email: access control wording waits for the owner sign-off.',
  ],
  [
    'SG-056ff2bb',
    'Error page promise that saved work is safe: a data safety promise, waits for the owner sign-off.',
  ],
  [
    'SG-a70820b8',
    'App connection duration (How Long): authorization wording waits for the owner sign-off.',
  ],
  ['SG-a4126292', 'Answer an AI app: authorization wording waits for the owner sign-off.'],
  [
    'SG-3fb2aa39',
    'AI App Access heading: AI and authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-cc574f29',
    'AI App Access heading (variant): AI and authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-711744f6',
    'Choose a record to connect to an AI app: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-fab4e436',
    'Choose the record an app may read: authorization wording waits for the owner sign-off.',
  ],
  ['SG-48c8ec6a', 'Connect an app: authorization wording waits for the owner sign-off.'],
  [
    'SG-3bf94aa3',
    'Connect an app for an agency: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-6e5e6fff',
    'Connect an app for an agency you run: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-ee296cf8',
    'Warning that an app runs on this computer: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-cdb5fd11',
    'No records to connect: authorization screen wording waits for the owner sign-off.',
  ],
  [
    'SG-07369aca',
    'Client invitation cannot be shown, ask the agency to send it again: invitation recovery wording waits for the owner sign-off.',
  ],
  [
    'SG-8e9d31bd',
    'Completeness is not an approval probability: a no-guarantee disclaimer, waits for the owner sign-off.',
  ],
  [
    'SG-af6e7d3f',
    'Readiness is completeness, never an approval likelihood: a no-guarantee disclaimer, waits for the owner sign-off.',
  ],
  [
    'SG-5431e93a',
    'How the evidence bar is counted (readiness explanation tied to the no-guarantee disclaimer): waits for the owner sign-off.',
  ],
  [
    'SG-bf823720',
    'Privacy instruction on what not to enter in a correction: privacy wording waits for the owner sign-off.',
  ],
  [
    'SG-237c256a',
    'Review sharing permissions: sharing permission wording waits for the owner sign-off.',
  ],
  [
    'SG-e4aa566a',
    'Secure preview and permission re-check: access control wording waits for the owner sign-off.',
  ],
  [
    'SG-5f2daee2',
    'File format verification statement: a safety claim, waits for the owner sign-off.',
  ],
  [
    'SG-24e6815a',
    'What a safe copy is and who sees it: redaction and sharing promise, waits for the owner sign-off.',
  ],
  [
    'SG-41ac0866',
    'Visa photo checks cannot confirm acceptance: official-requirements disclaimer, waits for the owner sign-off.',
  ],
  [
    'SG-742d2250',
    'Access end date and extension by the traveller: access control wording waits for the owner sign-off.',
  ],
  [
    'SG-718c2cbe',
    'Profile photo visibility and never used as a visa photo: a privacy promise, waits for the owner sign-off.',
  ],
  [
    'SG-0f35e0ea',
    'Offline notice that promises secure handling and unsaved data: a security promise, waits for the owner sign-off.',
  ],
  [
    'SG-0092181b',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-1a432089',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-319b7d1b',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-4249425b',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-57024979',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-5dfd4948',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-5e68244c',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-751ac880',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-7cebc450',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-85a723da',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-8b062101',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-9f18aa86',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-a178f7cf',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-ae0400c3',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-b0cc740f',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-d028e6a4',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-d62d6a52',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-f0429b7a',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  ['SG-697612cb', 'AI features and tools (AI processing): waits for the owner sign-off.'],
  ['SG-84755ca2', 'AI features and tools (AI processing): waits for the owner sign-off.'],
  [
    'SG-03518c54',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-21824069',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-2b43768d',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-363e13bd',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-37468a51',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-7e0dba4b',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-899d13d1',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-8dca9740',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-8ee1a9d7',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-b0b7a8b8',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-b21f69f6',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-bdbe4cd8',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-e00eb31b',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-ed74236c',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  ['SG-07e1fab2', 'Invitation expiry and acceptance terms: waits for the owner sign-off.'],
  ['SG-48a3b6e0', 'Invitation expiry and acceptance terms: waits for the owner sign-off.'],
  ['SG-d9561170', 'Invitation expiry and acceptance terms: waits for the owner sign-off.'],
  ['SG-65a98d6a', 'Virus scanning notices: a risk statement, waits for the owner sign-off.'],
  ['SG-e5a8b9e8', 'Virus scanning notices: a risk statement, waits for the owner sign-off.'],
  ['SG-04033af1', 'Billing and invoices (payment): waits for the owner sign-off.'],
  ['SG-11f4fd8f', 'Billing and invoices (payment): waits for the owner sign-off.'],
  [
    'SG-1f2c844a',
    'Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.',
  ],
  [
    'SG-c87e54e8',
    'Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.',
  ],
  [
    'SG-7a475bd6',
    'Access: says whether a traveller has granted an organization access; waits for the owner sign-off.',
  ],
  [
    'SG-98b5d44d',
    'Access: says what the organization can still act on; waits for the owner sign-off.',
  ],
  [
    'SG-576d295d',
    'Privacy promise: says what a person chose to send; waits for the owner sign-off.',
  ],
  [
    'SG-c60f522e',
    'Privacy promise: says what is needed and when anything is sent; waits for the owner sign-off.',
  ],
  [
    'SG-e3b1eece',
    'Issuer confirmation and readiness: states what is confirmed; waits for the owner sign-off.',
  ],
  [
    'SG-0a12f492',
    'Accessible name must match the visible button, which is still English here (Remove); stays English until the button is converted.',
  ],
  [
    'SG-b4a4f931',
    'Accessible name of the show-all toggle must match its visible words, which are still English here; stays English until the toggle is converted.',
  ],
  [
    'SG-75b245d1',
    'Opening words of the show-all toggle must match its English closing words; stays English until the toggle is converted.',
  ],
  [
    'SG-d6e09908',
    'Accessible name must match the visible button, which is still English here; stays English until the button is converted.',
  ],
  [
    'SG-678c621d',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-d9bcf36d',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-e53a446b',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-289e563b',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-dcadd581',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
]);

export const REGISTER_REL = 'docs/localization/VISASTACK_TRANSLATION_REGISTER.csv';
export const CENSUS_REL = 'docs/localization/VISASTACK_UI_SOURCE_CENSUS.csv';

/** RFC 4180 CSV -> array of objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** The census/register spelling of a text: whitespace collapsed, em dash as a marker. */
export const registerForm = (s) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\u2014/g, '[U+2014]');

export const placeholdersOf = (msg) => {
  const names = new Set();
  for (const m of msg.matchAll(/\{(\w+)(?:\}|,\s*plural\s*,)/g)) names.add(m[1]);
  return [...names].sort();
};

export class Register {
  constructor({ registerCsv = '', censusCsv = '' } = {}) {
    this.byGroup = new Map();
    this.byEnglish = new Map();
    for (const r of registerCsv ? parseCsv(registerCsv) : []) {
      this.byGroup.set(r.semantic_group, r);
      const list = this.byEnglish.get(r.english) ?? [];
      list.push(r);
      this.byEnglish.set(r.english, list);
    }
    this.census = new Map();
    for (const c of censusCsv ? parseCsv(censusCsv) : []) {
      if (!c.semantic_group) continue;
      this.census.set(`${c.file}|${c.line_start}|${c.english}`, c.semantic_group);
    }
  }

  static load(root) {
    const read = (rel) => {
      const p = `${root}/${rel}`;
      return readIfExists(p) ?? '';
    };
    return new Register({ registerCsv: read(REGISTER_REL), censusCsv: read(CENSUS_REL) });
  }

  /**
   * @param {{ file: string, line: number, censusText: string, english: string }} unit
   * @returns {{ group: string|null, bn: string|null, reason: string|null }}
   */
  lookup(unit) {
    const forms = [...new Set([registerForm(unit.censusText), registerForm(unit.english)])];
    let row = null;
    for (const f of forms) {
      const g = this.census.get(`${unit.file}|${unit.line}|${f}`);
      if (g && this.byGroup.has(g)) {
        row = this.byGroup.get(g);
        break;
      }
    }
    if (!row) {
      const groups = new Map();
      for (const f of forms)
        for (const r of this.byEnglish.get(f) ?? []) groups.set(r.semantic_group, r);
      if (groups.size > 1)
        return {
          group: [...groups.keys()].sort().join('|'),
          bn: null,
          reason: 'register_ambiguous',
        };
      row = groups.values().next().value ?? null;
    }
    if (!row) return { group: null, bn: null, reason: 'no_register_match' };
    const group = row.semantic_group;
    if (HOLDBACK.has(group)) return { group, bn: null, reason: `held_back:${HOLDBACK.get(group)}` };
    const queue = row.review_queue ?? '';
    if (!RELEASED_QUEUES.has(queue))
      return { group, bn: null, reason: `review_queue_not_signed_off:${queue || 'none'}` };
    const checks = row.automated_checks ?? '';
    if (!checks.startsWith('PASS'))
      return { group, bn: null, reason: `checks_not_pass:${checks.split(/[;|:]/)[0] || 'empty'}` };
    const draft = (row.bn_BD_draft ?? '').normalize('NFC');
    if (!draft.trim()) return { group, bn: null, reason: 'no_bn_draft' };
    if (/\u2014|\[U\+[0-9A-F]+\]/.test(draft))
      return { group, bn: null, reason: 'bn_has_marker_or_em_dash' };
    if (/[{}]/.test(unit.english.replace(/\{\w+\}/g, '')))
      return { group, bn: null, reason: 'english_is_plural_message' };
    const a = placeholdersOf(unit.english).join(',');
    const b = placeholdersOf(draft).join(',');
    if (a !== b) return { group, bn: null, reason: 'bn_placeholders_differ' };
    if (/[{}]/.test(draft.replace(/\{\w+\}/g, '')))
      return { group, bn: null, reason: 'bn_stray_brace' };
    return { group, bn: draft, reason: null };
  }
}
