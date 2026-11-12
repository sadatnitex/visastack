# Bengali release classification, 2026-11-12

Owner decisions of 2026-11-12, recorded in `drafts/OWNER_DECISIONS.json` (key `release_blanket_approval_2026-11-12`):

- Sign-off on the held-back legal, consent and payment wording: "okay". Recorded as a blanket approval by the owner (editor and legal reviewer), given without a line-by-line reading of the Bengali. Nothing here was reviewed line by line by a human or a lawyer. The register state is `OWNER_BLANKET_APPROVED_2026-11-12`; `reviewed` stays NO.
- The Bengali word for box: "same, box", read as বক্স (never বাক্স). See glossary term T133.
- Earlier decisions kept: official visa rules stay English with a Bengali note; invoice and receipt record content stays English with a Bengali note. Review queue 04 stays refused.

Counts: released with a PASS draft 541, released with no PASS draft yet (English stays) 22, kept in English 105.

The machine-readable list is `RELEASE_CLASSIFICATION_2026-11-12.json`. The register and queue approval state is derived from it by `tools/release-state.mjs` (used by `tools/build-register.mjs` and, for the committed files, `tools/apply-release-state.mjs`); `scripts/i18n/release-state.test.mjs` checks that the derivation and the CSVs agree.

## KEPT: guardrail checker flag (1)

- SG-db11732d: PLACEHOLDER_MISMATCH: {choice}: en 1 (needs 1), bn 0  English: <strong>Deletion is blocked.</strong> The following traveller record {choice} an active le

## KEPT: invoice or receipt record content (9)

- SG-04e98a42: receipt reference (receipt record content)  English: Reference
- SG-0a629d98: receipt statement (receipt record content)  English: VisaStack recorded this payment against your invoice.
- SG-11f4fd8f: receipt amount line (receipt record content)  English: Amount Received
- SG-2625eb6a: receipt statement (receipt record content)  English: This receipt shows that a payment was recorded against the invoice named above. It is not 
- SG-3a35db0e: receipt title (receipt record content)  English: Receipt {number}
- SG-aeff30b3: receipt line with an amount and a billing date (receipt record content)  English: {formatMoney} on {formatBillingDate}
- SG-b3edb4f6: credit note on an invoice (invoice record content)  English: Credit from an earlier payment: {plainAmount} of an online payment VisaStack held for a ch
- SG-ccadbccd: receipt issued line (receipt record content)  English: Receipt Issued
- SG-d10ae531: receipt number (receipt record content)  English: Receipt Number

## KEPT: meaning change found on reading (2)

- SG-a5fa0621: found on reading: official authority is rendered as government authority, which says more than the English  English: Checked is when VisaStack last read the page. Always confirm the final requirements with t
- SG-d0d5e75c: found on reading: the English word sign-off is rendered as final consent, which says more than the English  English: Start a new case from this one. Your current records are reused by reference. Nothing from

## KEPT: official visa rule, fee, requirement or time (25)

- SG-01e34e77: document requirement for minors  English: Birth certificate, parental signatures and consent plus parent ID/passport copies if relev
- SG-0e9f785b: official visa fee wording  English: We do not show a fee amount here unless it is currently verified. Confirm the exact, curre
- SG-1549c176: what most visa forms ask for first  English: Start with the details most visa forms ask for first. Everything else can wait.
- SG-16600835: embassy original-paper rule  English: Usually handed in as the original when you apply. Upload a clear scan or photo here so it 
- SG-21e2947f: document requirement for minors  English: Child birth certificate, school ID and parental consent as appropriate.
- SG-2e2357fd: official fees and application channels  English: Source-backed official fees, application channels, and scam-warning guidance for maintaine
- SG-32f5aefc: passport validity requirement for a route  English: Original passport and photocopy of pages containing passport and personal data; validity a
- SG-37c14fc0: route rule: evidence must be dated within a set window  English: Some requirements demand evidence dated within a set window, separate from the document's 
- SG-3d6b855e: heading over route date rules  English: Route Date Rules
- SG-58cc6dc1: document requirement for a country route (how recent a document must be)  English: Must be dated within {maxAgeDays} days.
- SG-5d43545f: document requirement for minors  English: Parental permission/custodian consent and child’s birth certificate.
- SG-76e5623e: pay the official fee where the authority says  English: Pay the official fee where the authority says.
- SG-7ba0413d: document requirement for minors  English: Parental consent letter for applicants under 18.
- SG-95b07104: official government fee wording  English: The official government fee only. Any agency you choose to work with charges its own servi
- SG-a818802f: Official Fee label  English: Official Fee
- SG-ad36e94f: embassy original-paper rule  English: Embassies usually want these handed in as the original paper. The scan on file keeps your 
- SG-b41c58b1: route rule: documents dated within a set window  English: Some visa routes need a document dated within a set window, such as a bank statement from 
- SG-b6c2f783: embassy original-paper rule  English: Once a case lists its documents, or you add one usually handed in as the original, it appe
- SG-ccbd8ad0: label for the embassy original-paper rule  English: Usually Original
- SG-e3fdc097: heading over route rules  English: Route Rules
- SG-e70b69ad: visa Fee label  English: Fee
- SG-ecd96750: document requirement for minors  English: Birth certificate, parent or guardian consent and financial evidence as applicable.
- SG-f6430216: embassy original-paper rule  English: Embassies usually want this handed in as the original when you apply. Upload a clear scan 
- SG-f974eb5d: document requirement for minors  English: Parental travel consent for applicants under 18.
- SG-ff7d2a1c: what most visa forms ask for first  English: The details most visa forms ask for first.

## KEPT: technical (68)

- SG-01aeac1c: English-only size label (mbLabel) filled into the sentence  English: Each person you keep a record for can hold up to {mbLabel}. When you share a record with a
- SG-02122e22: English-only consent label filled into the sentence (label in name)  English: Turn On: {label}
- SG-02a56416: Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.  English: (Not Accepted Yet)
- SG-066180d4: english word inside bengali sentence  English: {quietHidden} more {agree} had no reply
- SG-0a12f492: Accessible name must match the visible button, which is still English here (Remove); stays English until the button is converted.  English: Remove: {label}
- SG-0b6663fd: English-only upload notice filled into the sentence  English: {uploadCheckNotice} iPhone photos (HEIC) are saved as JPG copies so they open anywhere.
- SG-0c3da2e7: A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.  English: Needed by {formatDateOnly}
- SG-103526c4: english word inside bengali sentence  English: Backs {plural}.
- SG-153f9777: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: {removedInLine}. Restore it to bring it back to your documents. Cases that moved to the id
- SG-19b168cd: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Keep As It Is: {title}
- SG-1f2c844a: Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.  English: Due {due}
- SG-260ff35f: Button name read by screen readers while the visible text is still English (label in name).  English: Selected - Remove {name}
- SG-338d92d1: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Confirm: {title}
- SG-4bd5843b: Remove: {name} (accessible name of the Remove button): the visible button text stays English, so the name waits with it.  English: Remove: {name}
- SG-4e812a3e: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Keep a Copy for {name}
- SG-4fbf3546: Optional marker with a leading separator: the Bengali drops the space that joins it to the label.  English: · optional
- SG-575944d9: no screen shows it today: the large export panel only draws a job that is still active, so this failed-job badge cannot be rendered  English: Could not be made
- SG-59d94eb1: Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.  English: When {toLowerCase} became true. Leave blank if you are not sure.
- SG-5a6c4e41: Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.  English: I have no {toLowerCase}
- SG-61e87632: English-only state word filled into the sentence  English: Automatic Reading: {STATE_WORD}
- SG-658e1cac: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: {uploadLimitsText} Up to {MAX_IMPORT_FILES} files in one import.
- SG-6840bbdb: A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.  English: Preview: {label}
- SG-68e8afb4: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: File It: {label}
- SG-6cdf21a6: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: File Under {displayName}: {label}
- SG-75b245d1: Opening words of the show-all toggle must match its English closing words; stays English until the toggle is converted.  English: Show Fewer Cases
- SG-79505021: Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.  English: Manage
- SG-7fed393b: A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.  English: You sent this on {formatMoment}.
- SG-826d2c99: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Keep a Copy of {documentName} for Whom?
- SG-8546093a: Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.  English: Expired {plural} ago
- SG-86f84a55: Button name read by screen readers while the visible text is still English (label in name).  English: Back to Original Wording for {itemName}
- SG-8881fc69: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: Full profile: {completeness}% of the details in your {plural}.
- SG-8d14d065: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: See the {plural} inside
- SG-8fd6641e: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: We Found {plural} to Check
- SG-9d878677: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: This folder holds more than {toLocaleString} files. Only the first {MAX_IMPORT_FILES} can 
- SG-9e771a8e: Joiner word between names (" or "): its spaces carry the layout and the sentence around it is still English.  English: or
- SG-a7694752: Applicant screens: Joiner text whose trailing space carries the layout, so its Bengali would run into the next sentence.  English: Not confirmed.
- SG-a8684ed6: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: No Longer Current: {label}
- SG-aa9771db: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Change: {title}
- SG-ac40a214: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Skip: {label}
- SG-afed0db1: date from the non-locale helper formatTimestampDate at the call site  English: {missionTitle}: what differs today from snapshot {version}, taken on {formatTimestampDate}
- SG-b1994b75: English-only agency note filled into the sentence  English: {agencyAiTravellerNote} If your sign-in is not recent, you will confirm it is you, then ti
- SG-b4a4f931: Accessible name of the show-all toggle must match its visible words, which are still English here; stays English until the toggle is converted.  English: Show All {min} Cases
- SG-b59bc29b: English-only description filled into the sentence  English: {description} Sensitive: include it only if the reader needs it.
- SG-b8f9ef37: date from the non-locale helper formatTimestampDate at the call site  English: Accepted {formatTimestampDate}
- SG-ba0fbeb7: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: {recordGroup} on your Record
- SG-bd7b343f: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: {plural} One Answer
- SG-c0b36ea9: Done or cancelled task count: the number word comes from an English helper, so the sentence would mix scripts; waits for a proper plural message.  English: {plural} Done or Cancelled
- SG-c1fb8969: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: Added {formatTimestampDate} {STATUS_WORDS}
- SG-c55cd000: A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.  English: And {plural}, not shown here. Delete ones you no longer need to see the rest.
- SG-c60ff807: Already sent note that follows other text: the Bengali drops the leading space.  English: Already sent.
- SG-c87bb1a1: date from the non-locale helper formatBillingDate (English month names)  English: Paid until {formatBillingDate}. Fair-use safeguards and your privacy permissions still app
- SG-c87e54e8: Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.  English: Sent {formatMoment}
- SG-c9a7f414: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Keep Separate: {title}
- SG-cb6538b8: Button name read by screen readers while the visible text is still English (label in name).  English: Select {name}
- SG-d2c91826: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: Looks like {withArticle}
- SG-d5319908: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: {plural} {agree} a look.
- SG-d6e09908: Accessible name must match the visible button, which is still English here; stays English until the button is converted.  English: Remove {memberEmail}
- SG-d9561170: date from the non-locale helper formatTimestampDate at the call site  English: Expired {formatTimestampDate} &middot; invite again
- SG-d9696fe7: English-only saved label filled into the sentence  English: {savedLabel}, read from the document.
- SG-dc1af39a: Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.  English: Delete Draft: {title}
- SG-de969496: Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.  English: This field is marked {toLowerCase} in the canonical registry.
- SG-dedaa54b: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Mark as Ended: {name}
- SG-e004a268: Button name read by screen readers while the visible text is still English (label in name).  English: Remove {fileName}
- SG-e4498255: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: {description} {openCount} of {length} sections open.
- SG-e8727ba5: Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.  English: Full profile: {answered} of {total} details in your {plural} have values ({percent}%). Ope
- SG-eb382184: Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.  English: Expires in {plural}
- SG-f22cca12: A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.  English: {kindLabel} · Added {addedLabel} · {scanLabel}
- SG-fe5feab6: Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).  English: Remove This File: {label}

## RELEASED: content (legal, privacy, consent, sharing, access, AI, payment) (225)

Why it was held before, or the queue it sits in: A suggestion stays separate until you approve it: a promise about AI and confirm; AI App Access heading (variant): AI and authorization wording waits for the owne; AI App Access heading: AI and authorization wording waits for the owner sign-off; AI Features in the plan list: AI processing allowance wording waits for the owne; AI Tools consent toggle: AI processing wording waits for the owner sign-off.; AI features and tools (AI processing): waits for the owner sign-off. ...

Groups: SG-0006fab9, SG-0016aa98, SG-00706ded, SG-0092181b, SG-03518c54, SG-03b8a6b0, SG-03d5ab6c, SG-04033af1, SG-04cc7a8e, SG-056ff2bb, SG-07369aca, SG-079d1f0e, SG-07e1fab2, SG-094bebc7, SG-0b90abd7, SG-0cb96f1d, SG-0d5c8615, SG-0eec3e1b, SG-0f35e0ea, SG-0f9d5b37, SG-1065be84, SG-1167490a, SG-1206824f, SG-12ffe6ee, SG-1436ceee, SG-1741082c, SG-192889ed, SG-197fdeca, SG-1a432089, SG-1c102ea8, SG-1fbade6c, SG-1fbf4fdc, SG-1fec77cc, SG-21824069, SG-226bab50, SG-22bda9c8, SG-237c256a, SG-24776023, SG-24e6815a, SG-2604b090, SG-289e563b, SG-2b1514c9, SG-2b43768d, SG-2bf9eb27, SG-2e6db3da, SG-2ebd55a3, SG-3141220f, SG-319b7d1b, SG-330cb2d9, SG-361e0c20, SG-363e13bd, SG-37468a51, SG-37f0599e, SG-39303114, SG-3a144529, SG-3a222fbf, SG-3a3fd00f, SG-3fb2aa39, SG-41ac0866, SG-4249425b, SG-426b883f, SG-436b1b32, SG-45ad6a0b, SG-461caf20, SG-48a3b6e0, SG-4ac01dc9, SG-4bfc56d4, SG-4c01c938, SG-4d48fa01, SG-5018af46, SG-50c83703, SG-515d1469, SG-529d695c, SG-5431e93a, SG-5463c56c, SG-554ff162, SG-57024979, SG-576d295d, SG-57b3157f, SG-57e8fee4, SG-583aa6b5, SG-58fc0338, SG-5ca1af5a, SG-5dfd4948, SG-5e68244c, SG-5efa8d43, SG-5f0ee722, SG-5f2daee2, SG-5f596105, SG-60e310fc, SG-634bfe2f, SG-63dab094, SG-65a98d6a, SG-66f87a10, SG-67266d24, SG-674ee0dc, SG-6775fd3b, SG-678c621d, SG-697612cb, SG-69e97063, SG-6bfef43e, SG-6c449ccc, SG-6dc10a9f, SG-718c2cbe, SG-72d9142d, SG-7393361c, SG-742d2250, SG-750b0e73, SG-751ac880, SG-76d5a28d, SG-7739b95f, SG-7a475bd6, SG-7b432da4, SG-7cebc450, SG-7d8d7a57, SG-7e0dba4b, SG-7f54db09, SG-7f6342c7, SG-81bf750c, SG-8205ffbd, SG-84514c27, SG-84755ca2, SG-85a723da, SG-8600dbb5, SG-8829c695, SG-882d2ab6, SG-88aeced1, SG-8939253f, SG-8987f99a, SG-899d13d1, SG-89e5a96d, SG-8b062101, SG-8b21f490, SG-8be28114, SG-8d730501, SG-8dca9740, SG-8e79eb73, SG-8e9d31bd, SG-8ee1a9d7, SG-8fe742c5, SG-93434b03, SG-938c310f, SG-94189b82, SG-9574696f, SG-96726f73, SG-98b5d44d, SG-98c55098, SG-990cfc21, SG-991b05ef, SG-9b86192c, SG-9c7d6ee0, SG-9d556125, SG-9da51aed, SG-9f18aa86, SG-a104e7e5, SG-a178f7cf, SG-a17de272, SG-a23537b2, SG-a59d20ba, SG-a5b2278c, SG-ae0400c3, SG-af6e7d3f, SG-afc89023, SG-b08c4520, SG-b0b7a8b8, SG-b0cc740f, SG-b21f69f6, SG-b4d0d729, SG-b5644201, SG-b6f48122, SG-b80f590e, SG-b9d38c86, SG-bdbe4cd8, SG-bf823720, SG-c26f3e5b, SG-c2caee76, SG-c60f522e, SG-c68a7790, SG-c7267817, SG-c94b606c, SG-c983b88e, SG-cc574f29, SG-cda9a1ac, SG-cdca8c7b, SG-d028e6a4, SG-d3914f71, SG-d39a9da3, SG-d5eb6533, SG-d62d6a52, SG-d6f8451e, SG-d7a62e22, SG-d7aece0b, SG-d7bcf439, SG-d9bcf36d, SG-dc081055, SG-dcadd581, SG-df4ae9fc, SG-e00eb31b, SG-e2005eec, SG-e3b1eece, SG-e432687f, SG-e4a97e33, SG-e4aa566a, SG-e53a446b, SG-e5a8b9e8, SG-e6123c0d, SG-e78bd437, SG-ea7f1da4, SG-eac05478, SG-ec12eea0, SG-ed74236c, SG-f0429b7a, SG-f07aea90, SG-f0bd6092, SG-f1f5bccb, SG-f5a73aec, SG-f8a50812, SG-f92f9f0f, SG-f9667433, SG-fb46562d, SG-fbccaafa, SG-fd5a5483, SG-fd86bb23, SG-fe6d2f71, SG-fe795501

## RELEASED: queue released (COMMERCIAL) (56)

Why it was held before, or the queue it sits in: automated checks PASS

Groups: SG-04e75ab2, SG-0f0ee55f, SG-1a8155da, SG-1fa10c7a, SG-27946a1f, SG-29931b95, SG-2c5af3e3, SG-3b0aa555, SG-3b7e172b, SG-3f18615f, SG-40fb2126, SG-48b62e6e, SG-49b97cdb, SG-4c3879ca, SG-4dd738c9, SG-4ff2abf8, SG-509eb856, SG-54c50e63, SG-6134507b, SG-637b491f, SG-649ef685, SG-654d87ae, SG-6b3788c1, SG-73f7ada8, SG-7926c5a7, SG-799d23a9, SG-7f0e5288, SG-7f42f3a1, SG-8347865f, SG-871651c9, SG-95027f41, SG-968fcdff, SG-99848411, SG-9adbe2d0, SG-9e6ca75c, SG-ae055552, SG-af8979bb, SG-afcc2767, SG-c32d301b, SG-c4883177, SG-c63d2de2, SG-c9fa1fdd, SG-cf34cb90, SG-d6d9d6fc, SG-d88d7ff9, SG-da932d22, SG-dd589b55, SG-ded37f70, SG-e2939ed9, SG-ebccf8fd, SG-ed43675e, SG-ee73dd42, SG-f7012c57, SG-f78d636b, SG-f7b567be, SG-fdc12380

## RELEASED: queue released (PRIVACY_CONSENT_LEGAL) (260)

Why it was held before, or the queue it sits in: automated checks PASS

Groups: SG-00c793d5, SG-06f8fd1e, SG-08f0ee22, SG-0926bf14, SG-0a178114, SG-0a1efaac, SG-0bd1077e, SG-0ca5460f, SG-0d0027cc, SG-0dbe9cb8, SG-0dd3aef5, SG-0f271b50, SG-0fa6c912, SG-0fd8f216, SG-0fdec215, SG-12335425, SG-1267b7e2, SG-14e00305, SG-150cef4b, SG-1594e40c, SG-15b11244, SG-173ca489, SG-175bd1b6, SG-175e0c07, SG-176c4fc1, SG-1833e880, SG-18f35b62, SG-1abfaa0c, SG-1bd94eaa, SG-1c15133b, SG-1dbdbe0f, SG-1de7419b, SG-1eb5a04c, SG-206b98c3, SG-21398676, SG-23d6bf6c, SG-23fb9644, SG-245bc9ba, SG-24b30457, SG-25de1b33, SG-26149f4d, SG-27612c28, SG-29931c8d, SG-2a073212, SG-2b888ade, SG-2c29d6ae, SG-2ca835a3, SG-2e193dd2, SG-2e43f107, SG-2fc3e71c, SG-313c0a49, SG-31bc4338, SG-32099ee2, SG-320edc52, SG-32685596, SG-326bb71b, SG-328af66c, SG-32f95e47, SG-35833103, SG-36d107b3, SG-370d106b, SG-381440dc, SG-384138fe, SG-38a6a98a, SG-3a0802f1, SG-3b2f1526, SG-3b5872c4, SG-3cce3300, SG-3d2a95ab, SG-3d87edad, SG-3def150b, SG-3e3c99f6, SG-3f2c5577, SG-3fd32cc9, SG-400859d5, SG-458548c5, SG-45dfd82e, SG-467f32a9, SG-499541f7, SG-4b142b86, SG-4baf5be8, SG-4c712b71, SG-4d46294d, SG-4f4528e1, SG-4fa1082f, SG-4fbca601, SG-51753f4c, SG-51785b82, SG-5269d120, SG-54884fb5, SG-554aa6a7, SG-566a8591, SG-576fe5a5, SG-58c298b7, SG-5a84f019, SG-5b13921f, SG-5c041cc3, SG-5cd4a77d, SG-5d200bba, SG-5ea17c19, SG-5f48080c, SG-5fef521c, SG-6136cbfc, SG-621fc37f, SG-623185df, SG-6263c0a0, SG-630b77f1, SG-6344adc3, SG-64083da5, SG-66303617, SG-68370f7c, SG-68450ced, SG-68ef0500, SG-694a923b, SG-6a6955fa, SG-6ae28fe2, SG-6af435cd, SG-6b166e6a, SG-6e328b4a, SG-6eb3578a, SG-71ea5c4c, SG-72cc1f61, SG-75ad9966, SG-75f71b03, SG-7749ec18, SG-782dd356, SG-7a70216e, SG-7a88f715, SG-7c49c467, SG-7cdea515, SG-7d20f7d1, SG-7ee619ce, SG-7f2b9962, SG-7f69a3f5, SG-7ff19ad0, SG-801eeb66, SG-812c2808, SG-81339891, SG-81494c50, SG-82270d99, SG-8311d1f1, SG-8353718a, SG-842d0db1, SG-8510dfb6, SG-87a8d4d5, SG-87e7b2f4, SG-881da04d, SG-890690f6, SG-89e05319, SG-8b5d1ded, SG-8ba1df80, SG-8c4aa9ee, SG-8cc9ef74, SG-8d5be455, SG-8f27e9ec, SG-921890d8, SG-937ef42c, SG-94155715, SG-94ed246d, SG-9794512d, SG-993ccbc5, SG-99e565fd, SG-9a799cf5, SG-9ac5ee1f, SG-9b1e7df8, SG-9e20cc6f, SG-a1fe652c, SG-a5969851, SG-a80baa0b, SG-a9386af5, SG-ab1a7a9b, SG-ab296de7, SG-ab2d4c94, SG-ac337b88, SG-ac643c77, SG-acf01c97, SG-aec9d67c, SG-af11879a, SG-b10c4f28, SG-b1b40624, SG-b1e2bc1a, SG-b4494703, SG-b59f4053, SG-b74bd8e8, SG-b812d87f, SG-b9b7b098, SG-ba9fc0d8, SG-badccd42, SG-bb26b48c, SG-bd2f6493, SG-be1f817d, SG-be531cca, SG-beb70611, SG-bef1ff49, SG-c0304a62, SG-c0641c84, SG-c1fd1aad, SG-c4e14550, SG-c6bde3c0, SG-ca2dfc29, SG-ca2ed1e2, SG-cd9b2402, SG-cefa1109, SG-cf0aeeba, SG-cf70452b, SG-d2042b8d, SG-d313473c, SG-d4e5d938, SG-d5d19ba4, SG-d617070e, SG-d70ff269, SG-d8372380, SG-d8b4b363, SG-d8e3ac0e, SG-d964ea7e, SG-da11df36, SG-da40c9e7, SG-daaf47e0, SG-daf842c9, SG-db48b6e7, SG-dbc60d2c, SG-dcb82ad2, SG-dcbc13ec, SG-dcd858fe, SG-dda4ecb4, SG-ddba2530, SG-e0e720e4, SG-e38ca3f4, SG-e4165b88, SG-e4b92aa5, SG-e664b45f, SG-e7e2efa2, SG-ea300f15, SG-eb83b33d, SG-eb919849, SG-ec2d9a5d, SG-ece02514, SG-ed18770f, SG-ede39d2a, SG-ee2dd871, SG-f18084ab, SG-f1fbea6a, SG-f229b451, SG-f23c5e1a, SG-f3184404, SG-f337eb92, SG-f3c18793, SG-f49c0f3e, SG-f620e9cd, SG-f63408c5, SG-f6deaf53, SG-f86300fe, SG-fa428b87, SG-fab92ddd, SG-fbd3c08b, SG-fd3b8956, SG-fdb5e141, SG-fe5bbae6, SG-ff268a2a, SG-ff28746a

## RELEASED, NO PASS DRAFT: content (legal, privacy, consent, sharing, access, AI, payment) (14)

- SG-0c3f69ec: Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.  English: Let VisaStack Process My Details
- SG-3bf94aa3: Connect an app for an agency: authorization wording waits for the owner sign-off.  English: Connect for an Agency
- SG-48c8ec6a: Connect an app: authorization wording waits for the owner sign-off.  English: Connect {appName}
- SG-6e5e6fff: Connect an app for an agency you run: authorization wording waits for the owner sign-off.  English: Or connect it for an agency you run:
- SG-711744f6: Choose a record to connect to an AI app: authorization wording waits for the owner sign-off.  English: Choose a Record
- SG-a4126292: Answer an AI app: authorization wording waits for the owner sign-off.  English: Answer {appName}
- SG-a70820b8: App connection duration (How Long): authorization wording waits for the owner sign-off.  English: How Long
- SG-afe937a3: Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).  English: AI thinks this is a {toLowerCase} ( {confidence}% sure). Please check it.
- SG-cdb5fd11: No records to connect: authorization screen wording waits for the owner sign-off.  English: You have no records to connect yet. Add one in VisaStack first.
- SG-ce511844: Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).  English: Possible inconsistency ({confidence}% confidence)
- SG-e7158ae3: Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).  English: Sensitive details, anything you changed, and anything that differs from your profile stay 
- SG-e956303b: Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.  English: Let VisaStack Process My Details
- SG-ee296cf8: Warning that an app runs on this computer: authorization wording waits for the owner sign-off.  English: This app runs on this computer, not on a website. Allow it only if you started it yourself
- SG-fab4e436: Choose the record an app may read: authorization wording waits for the owner sign-off.  English: Choose the record this app may read:

## RELEASED, NO PASS DRAFT: queue released (COMMERCIAL) (7)

- SG-03a6d811: automated checks not PASS: GLOSSARY_TERM_MISSING  English: Of the purchases started in these days, the share that was paid.
- SG-04047ac8: automated checks not PASS: GLOSSARY_TERM_MISSING  English: Of the renewals made in these days, the share that was paid.
- SG-12692a59: automated checks not PASS: GLOSSARY_TERM_MISSING  English: Of the traveller checkouts started in the last day and finished, the share where the money
- SG-20f3aa34: automated checks not PASS: GLOSSARY_TERM_MISSING  English: Of the payments made in these days, the share refunded since.
- SG-31614ae0: automated checks not PASS: VERSION_CONCEPT_REVIEW  English: Every saved version of every document counts. Each file can be up to {uploadLimitLabel}.
- SG-5e451d92: automated checks not PASS: GLOSSARY_TERM_MISSING  English: Enter the amount received above zero, for example 2,500.00.
- SG-e6c4bf76: automated checks not PASS: LATIN_LEFTOVER  English: Calendar on a Mac: choose File, then New Calendar Subscription, and paste the link.

## RELEASED, NO PASS DRAFT: queue released (PRIVACY_CONSENT_LEGAL) (1)

- SG-d4cc824c: automated checks not PASS: LATIN_LEFTOVER  English: Vercel hosts the application. {fileStorage} stores private files. Cloudflare R2 stores enc

## How the release was checked

- Every released Bengali value was run through `tools/guardrail-check.mjs` (hard rules, not the length warnings); one was held by it. (`--self-test` of the checker already reports 5 misses on main before this change; not touched here.)
- The released values that are live in a catalogue were read for consent, sharing, virus-check and deletion meaning. Two were held for it: SG-d0d5e75c (sign-off rendered as final consent) and SG-a5fa0621 (official authority rendered as government authority).
- Released groups that are in no catalogue yet were not read; whoever converts them reads them first.
- A released row with no PASS draft stays English until one exists.
- A message whose English starts or ends with a space and whose Bengali does not is never filled (the space joins it to the text beside it).
