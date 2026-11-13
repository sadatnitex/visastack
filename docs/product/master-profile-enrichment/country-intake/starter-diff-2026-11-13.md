# Starter list differences for eight countries (2026-11-13)

The owner asked for no change to the starter lists of Australia, Canada, Denmark, Malaysia, New Zealand, Singapore, Sweden and United States. This page lists, for each of them, the official items in `visastack_update_existing_countries_with_evidence.csv` (owner research, 13 Nov 2026) and how they compare with the current starter lines in `packages/core/src/starter-checklists/seed-rows.ts`. Nothing here is loaded anywhere; the owner decides what to apply.

How the comparison was made, so it can be checked:

- Each official item and each current line was given a document type by the same rules the starter build uses (`mapDocType` in `doc-type-rules.ts`).
- **Missing**: no current line of that country has the same document type, or the item names no document (type Other), so a person has to read it against the list.
- **Similar line exists**: a current line has the same document type. The wording, period or amount can still differ, so both are shown.
- Grades: A = read directly on an official page; B = official but partial, a different mission, or inferred. The reference column is kept exactly as supplied (layer, link, grade, Checked on date).

In all: 38 items missing and 41 with a similar line, across eight countries.

## Australia

Current starter lines: 16. Official items in the research: 15. Missing: 9. Similar line exists: 6.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

Correction C13 (grade A, https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas, checked 2026-11-13): Home Affairs lists 3 months of itemised personal bank statements, pay slips, audited accounts, tax records, term deposits, credit card statements, employer return letter and ties evidence; no fixed balance is stated; stay up to 12 months; cost from AUD 250. The current starter line "Six months of personal bank statement and a bank solvency letter; credit-card statements if applicable (source also suggests BDT 700,000)." carries a fixed balance the official page does not state. It was not changed, because the owner asked for no change to this list; deciding on it is part of this review.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | All applicants | Change of name documents, and documents showing other names you have been known by | OTHER | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Genuine visitor evidence | Pay slips, audited accounts, tax records, term deposits and credit card statements | SALARY_CERTIFICATE | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Genuine visitor evidence | Proof of immediate family members in your home country, ability to return home, and ownership of a house or other major assets | OTHER | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Visiting family or friends | Details of the person you will visit: relationship, purpose and length of visit, with a supporting letter | RELATIONSHIP_PROOF | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Where applicable | Military service record or discharge papers | OTHER | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Where requested | Police certificate | POLICE_CLEARANCE | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | All applicants | English translations of all documents not in English | OTHER | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Using help | Form 956 or 956A when a registered migration agent or authorised recipient helps | OTHER | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |
| Tourist (base) | Requesting a longer visa | Longer visa request: explain why, with proof such as the child Australian citizenship for parents | OTHER | A | Australian Home Affairs Visitor 600 tourist stream, outside Australia (read in a browser 2026-11-13) \| https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600/tourist-stream-overseas \| grade A \| checked 2026-11-13 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Valid passport or other travel document: the pages showing photo, personal details and issue and expiry dates | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| National identity card, if you have one | A | National ID card or Birth Certificate Photocopy with (Notarized Copy). | NID |
| Marriage or divorce certificate | A | Marriage certificate/Nikah Nama for newly married (Notarized Copy). | MARRIAGE_CERTIFICATE |
| Itemised personal bank statements for a 3 month period | A | Six months of personal bank statement and a bank solvency letter; credit-card statements if applicable (source also suggests BDT 700,000). | BANK_STATEMENT |
| Letter from your employer stating you plan to return to your job | A | For Employee: NOC letter, Salary Certificate/Pay Slip (6M), Office ID Card & Visiting Card | NOC_EMPLOYER |
| Proof of study at a school, college or university in your home country | A | For Student: Evidence of enrollment in a Bangladeshi school, college, or university. | ENROLLMENT_LETTER |

## Canada

Current starter lines: 22. Official items in the research: 9. Missing: 3. Similar line exists: 6.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | Minor child | Letter authorising a minor child to travel to Canada | OTHER | A | IRCC How to apply for a visitor visa (opened in a browser 2026-11-13; page dated 2026-11-05) \| https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html \| grade A \| checked 2026-11-13 |
| Tourist (base) | Family visit | Proof of relationship with the inviter: marriage certificate, Statutory Declaration of Common-Law Union (IMM 5409), birth certificate, or official document naming you as a parent | RELATIONSHIP_PROOF | A | IRCC How to apply for a visitor visa (opened in a browser 2026-11-13; page dated 2026-11-05) \| https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html \| grade A \| checked 2026-11-13 |
| Tourist (base) | If on the checklist | Family Information form IMM 5645 | OTHER | A | IRCC How to apply for a visitor visa (opened in a browser 2026-11-13; page dated 2026-11-05) \| https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html \| grade A \| checked 2026-11-13 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Passport valid for at least 6 months from planned travel date | A | Original Passport 12 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| At least 6 months of bank account details including balances | A | Minimum Balance BDT 7 -10 Lakh for Each Application only original Bank Statement and Bank Solvency Letter are acceptable. | BANK_STATEMENT |
| Letter of invitation from a person or business in Canada | A | Invitation letter from host, including host name, phone, email and address where available. | INVITATION_LETTER |
| Digital copy of a valid passport or travel document, valid for at least 6 months from the travel date | A | Original Passport 12 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| Letter of invitation from a person or business in Canada confirming the purpose | A | Invitation letter from host, including host name, phone, email and address where available. | INVITATION_LETTER |
| Seaman Book, signed invitation from a ship or port agent in Canada, introduction letter from the recruiter or vessel owner, and the employment contract | A | Invitation letter from host, including host name, phone, email and address where available. | INVITATION_LETTER |

## Denmark

Current starter lines: 11. Official items in the research: 10. Missing: 3. Similar line exists: 7.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | When visiting family or friends | Completed VU2 online form or a personal explanatory invitation letter from the host | INVITATION_LETTER | A | Danish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/denmark/bangladesh/english/pdf/visiting_family_or_friends_tourism.pdf \| grade A \| checked 2026-11-02 |
| Tourist (base) | All applicants | Employer letter if employed | NOC_EMPLOYER | A | Danish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/denmark/bangladesh/english/pdf/visiting_family_or_friends_tourism.pdf \| grade A \| checked 2026-11-02 |
| Tourist (base) | All applicants | Documents showing establishment in Bangladesh: financial documents, partnerships, property, marriage certificate, children birth certificates | PROPERTY_DEED | A | Danish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/denmark/bangladesh/english/pdf/visiting_family_or_friends_tourism.pdf \| grade A \| checked 2026-11-02 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Printed and signed Schengen application cover letter from ApplyVisa, and printed receipt for the online fee payment | A | A cover letter. | COVER_LETTER |
| Passport with 2 blank pages valid 3 months after leaving Schengen; all previous passports with copies of earlier Schengen, UK, Australian or US visas | A | passport. | PASSPORT |
| Applicant cover letter to the embassy explaining the purpose of the visit in detail | A | A cover letter. | COVER_LETTER |
| Original personal bank statement for the last 6 months, and of the company if self-employed, original plus photocopy | A | Company bank statement of the latest 6 months | BANK_STATEMENT |
| Health and travel insurance for Schengen, original and photocopy | A | Denmark Travel Health Insurance. | TRAVEL_INSURANCE |
| Accommodation proof and travel reservations for the whole trip, plus draft programme if touring | A | hotel reservation. | HOTEL_BOOKING |
| Proof of ties with the host and ID copy of the host (passport, ID card or residence card) | A | passport. | PASSPORT |

## Malaysia

Current starter lines: 16. Official items in the research: 9. Missing: 5. Similar line exists: 4.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | All applicants | Proof of paid accommodation | HOTEL_BOOKING | A | Official data pack (repo) \| https://malaysiavisa.imi.gov.my/terms-and-conditions/ \| grade A \| checked 2026-10-14 |
| Tourist (base) | All applicants | Proof of paid accommodation and a confirmed return ticket where applicable | HOTEL_BOOKING | A | Malaysia MYVISA terms and conditions (read 2026-11-13) \| https://malaysiavisa.imi.gov.my/terms-and-conditions/ \| grade A \| checked 2026-11-13 |
| Tourist (base) | All applicants | Travel ticket evidence | FLIGHT_BOOKING | B | Second-AI pack, official gov (not independently verified) \| https://malaysiavisa.imi.gov.my/terms-and-conditions/ \| grade B \| checked 2026-11-04 |
| Tourist (base) | All applicants | Evidence of paid accommodation | HOTEL_BOOKING | B | Second-AI pack, official gov (not independently verified) \| https://malaysiavisa.imi.gov.my/terms-and-conditions/ \| grade B \| checked 2026-11-04 |
| Tourist (base) | Applicant under 18 | Birth certificate | BIRTH_CERTIFICATE | B | Second-AI pack, official gov (not independently verified) \| https://malaysiavisa.imi.gov.my/terms-and-conditions/ \| grade B \| checked 2026-11-04 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Valid passport with minimum validity of 6 months | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| Passport or travel document valid at least 6 months | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| Passport biographical page scan | B | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| Passport photo upload | B | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |

## New Zealand

Current starter lines: 17. Official items in the research: 5. Missing: 2. Similar line exists: 3.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | All applicants | Evidence of plans to leave New Zealand after visit | OTHER | B | Second-AI pack, official gov (not independently verified) \| https://www.immigration.govt.nz/visas/visitor-visa/ \| grade B \| checked 2026-11-04 |
| Tourist (base) | All applicants | Travel medical insurance | MEDICAL_REPORT | B | Second-AI pack, official gov (not independently verified) \| https://www.immigration.govt.nz/visas/visitor-visa/ \| grade B \| checked 2026-11-04 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Evidence of means of support or qualifying sponsor | B | Host invitation and support evidence, if staying with/sponsored by host. | INVITATION_LETTER |
| Passport valid for at least 3 months after intended departure from New Zealand | A | Valid passport and copies of prior passports/travel visas, where applicable. | PASSPORT |
| Letter from employer or New Zealand host company confirming business reason | A | Employer NOC/forwarding letter, office ID and employment information. | NOC_EMPLOYER |

## Singapore

Current starter lines: 17. Official items in the research: 9. Missing: 5. Similar line exists: 4.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | All applicants | Duly completed and signed Form 14A | OTHER | A | Official data pack (repo) \| https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/bangladesh \| grade A \| checked 2026-10-14 |
| Tourist (base) | All applicants | Completed Form V39A (Letter of Introduction for Visa Application) issued by a local contact in Singapore | VISA_APPLICATION_FORM | A | Official data pack (repo) \| https://www.ica.gov.sg/enter-transit-depart/entering-singapore/visa_requirements/visa-detail-page/bangladesh \| grade A \| checked 2026-10-14 |
| Tourist (base) | All applicants | One set of application Form 14A, completed | VISA_APPLICATION_FORM | A | Singapore High Commission Dhaka visa page (read 2026-11-13) \| https://dhaka.mfa.gov.sg/consular-services/visa-information/visa-application/ \| grade A \| checked 2026-11-13 |
| Tourist (base) | Social visit | Letter of Introduction from a local contact: any Singapore citizen or permanent resident aged 21 or over for a social visit | OTHER | A | Singapore High Commission Dhaka visa page (read 2026-11-13) \| https://dhaka.mfa.gov.sg/consular-services/visa-information/visa-application/ \| grade A \| checked 2026-11-13 |
| Tourist (base) | Business visit | Letter of Introduction from a Singapore registered company or organisation, signed by a citizen or permanent resident aged 21 or over | OTHER | A | Singapore High Commission Dhaka visa page (read 2026-11-13) \| https://dhaka.mfa.gov.sg/consular-services/visa-information/visa-application/ \| grade A \| checked 2026-11-13 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Recent passport-sized colour photograph taken within the last 3 months | A | Two Recent photo white background (Size: 3.5 x 4.5 mm) | PHOTO |
| Passport valid at least 6 months from the date of arrival in Singapore | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| Recent colour photo taken within the past 3 months, white background, matt or semi-matt, full face, facial image 25 to 35 mm from chin to crown. Headgear only for religious or racial custom without hiding features | A | Two Recent photo white background (Size: 3.5 x 4.5 mm) | PHOTO |
| Photocopy of the passport bio-data page | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |

## Sweden

Current starter lines: 19. Official items in the research: 12. Missing: 4. Similar line exists: 8.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | All applicants | Completed and signed Schengen application form no. 119031; all documents on A4 paper | VISA_APPLICATION_FORM | A | Swedish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/sweden/bangladesh/english/pdf/Tourist-Visa-Checklist-1.pdf \| grade A \| checked 2026-11-02 |
| Tourist (base) | All applicants | Health and travel insurance for Schengen, original and photocopy | TRAVEL_INSURANCE | A | Swedish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/sweden/bangladesh/english/pdf/Tourist-Visa-Checklist-1.pdf \| grade A \| checked 2026-11-02 |
| Tourist (base) | All applicants | Round-trip reservation with itinerary; entry permits for next destinations | FLIGHT_BOOKING | A | Swedish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/sweden/bangladesh/english/pdf/Tourist-Visa-Checklist-1.pdf \| grade A \| checked 2026-11-02 |
| Tourist (base) | All applicants | Hotel confirmation or voucher for the whole stay | HOTEL_BOOKING | A | Swedish Embassy checklist via VFS Global Dhaka (read 2026-11-02) \| https://www.vfsglobal.com/one-pager/sweden/bangladesh/english/pdf/Tourist-Visa-Checklist-1.pdf \| grade A \| checked 2026-11-02 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Passport with 2 blank pages valid 3 months after leaving Schengen; colour copy of the bio page and all Schengen visas; all previous passports | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| One 35 x 45 mm colour photo, light background, not older than 6 months | A | Two Recent photo white background (Size: 3.5 x 4.5 mm) | PHOTO |
| Cover letter to the Embassy of Sweden explaining the purpose in detail | A | Cover letter: From the applicant explaining in details the purpose of the visit. | COVER_LETTER |
| Letter from employer or owner stating the purpose of the visit | A | For Employee: NOC letter, Salary Certificate/Pay Slip (6M), Office ID Card & Visiting Card | NOC_EMPLOYER |
| Personal bank statement, credit card statements or balance for the last 6 months plus other proof of solvency | A | (Minimum Balance 700,000 /-bdt for Each Application only original Bank Statement and Bank Solvency Letter are acceptable.) | BANK_STATEMENT |
| Marriage certificate, divorce certificate (Talak Namah), death certificate, children birth certificates | A | Marriage certificate/Nikah Nama for married Person (Notarized Copy). | MARRIAGE_CERTIFICATE |
| Parent consent if both parents are not travelling, parent passport copies, proof of parents economic means, original birth certificate | A | Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It] | PASSPORT |
| Proof of sponsorship including family ties, and invitation letter | A | In case the applicant is sponsored by his/her company then company's bank statement and bank solvency letter and trade license should be attached. | INVITATION_LETTER |

## United States

Current starter lines: 11. Official items in the research: 10. Missing: 7. Similar line exists: 3.

Supplied recommendation: KEEP repo list; attach the official source and add the missing items.

### Missing from the current list

| Purpose | Applies when | Official item | Type read | Grade | Reference |
| --- | --- | --- | --- | --- | --- |
| Tourist (base) | All applicants | Machine Readable Visa (MRV) fee payment receipt | FEE_PAYMENT_RECEIPT | A | Official data pack (repo) \| https://bd.usembassy.gov/supporting-documents/ \| grade A \| checked 2026-10-14 |
| Tourist (base) | All applicants | DS-160 application confirmation page | OTHER | A | Official data pack (repo) \| https://bd.usembassy.gov/supporting-documents/ \| grade A \| checked 2026-10-14 |
| Tourist (base) | All applicants | Visa interview appointment confirmation letter | VFS_APPOINTMENT | A | Official data pack (repo) \| https://bd.usembassy.gov/supporting-documents/ \| grade A \| checked 2026-10-14 |
| Tourist (base) | All applicants | Complete DS-160 form and retain confirmation page | OTHER | B | Second-AI pack, official gov (not independently verified) \| https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html \| grade B \| checked 2026-11-04 |
| Tourist (base) | As requested / to establish eligibility | Proof of trip purpose | OTHER | B | Second-AI pack, official gov (not independently verified) \| https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html \| grade B \| checked 2026-11-04 |
| Tourist (base) | As requested / to establish eligibility | Proof of funds for trip | OTHER | B | Second-AI pack, official gov (not independently verified) \| https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html \| grade B \| checked 2026-11-04 |
| Tourist (base) | As requested / to establish eligibility | Proof of ties and intention to depart | OTHER | B | Second-AI pack, official gov (not independently verified) \| https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html \| grade B \| checked 2026-11-04 |

### A similar line exists (compare the wording)

| Official item | Grade | Current starter line | Type |
| --- | --- | --- | --- |
| Passport valid for at least 6 months beyond intended stay in the United States | A | Passport with validity not less than 6 months from the time of application | PASSPORT |
| Provide qualifying passport for travel | B | Passport with validity not less than 6 months from the time of application | PASSPORT |
| Upload DS-160 photo in prescribed format | B | Two 2 × 2 inch colour photographs on white background. | PHOTO |

Generated from the CSV with a script, not typed by hand. The current lists were not changed.
