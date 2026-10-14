# Master Profile gap analysis: bidesh365 against VisaStack

Date: 2026-10-14. Read-only comparison. Method: both field registries and document lists were extracted from code with the TypeScript compiler and compared by script; judgements per row were made by reading the fields. Numbers below are from that extraction.

## Headline

Of 54 bidesh365 sections: 0 fully covered by VisaStack, 23 partly covered, 31 with no equivalent.

## Scale

| Measure | bidesh365 | VisaStack |
|---|---|---|
| Profile sections / packs | 54 sections in 12 groups (38 repeating lists, 16 single records) | 5 packs (Universal, Professional, Business, Medical, Medical attendant) |
| Fields a person can actually enter | 486 in 52 sections (437 from the field registry, 49 hand-written). 2 sections show only 4 generic boxes. | 81 fields (45 single, 36 in 9 repeating groups) |
| Fields in the data types behind it | 189 type definitions with 2,000 property names (counted with repeats between two files) | Same as the 81: one registry |
| Protection levels | A Low, Medium or High label on 35 fields, used for checklists; I did not trace whether it drives encryption | Every field is Standard (67), Sensitive (13) or Restricted (1); Sensitive and Restricted are encrypted |
| Which fields each route needs | 35 fields tagged with the routes that need them (Schengen short stay, US visitor, US student, UK visit, UK work, Canada visitor, Canada study, Gulf visit, Australia visit, generic). Two visibility rules hide finance and business for official and diplomatic passports. | Route requirements are stored in the database as field or document requirements per route. I did not count what is in there. |
| Stored document types | 114 (database list) | 3 named (Passport, Bank Statement, Employment Certificate); any other type is allowed as free text |
| Other document lists | 137 in the scanner list (110 readable by the scanner), 141 in the validation list. Only 58 types appear in all four lists. | Automatic recognition covers 3 types |
| Document to profile mapping | 100 document types mapped to the section and field they fill | AI suggestions can only fill fields already registered; no per-document mapping table |
| Case purposes | 10 fixed values: Tourism, Business, Study, Work, Medical, Family, three corporate types, Other | Free text on the case; no fixed list |

## Claims in bidesh365 documents that do not match its code

| Claim or issue | What the code shows |
|---|---|
| The registry file says "469 fields across 45 sections" | It holds 437 fields in 44 sections |
| The January plan says "54 sections, 600+ fields" | 54 sections is right. 486 enterable fields (437 + 49 hand-written) is the real figure; 600+ is not found anywhere in code |
| The plan says 45 of 54 sections fall back to 4 generic fields | Now only 2 do (passport_contexts and passport_repository) |
| Two document lists, both described as the source of truth | They share only 58 of 193 unique names. The database list has 114; 79 scanner types are not in it and are folded onto stored types (83 folds, for example Green Card and Permanent Residence both become "Residence Permit"; Refugee, Stateless and Emergency Travel documents all become "Passport"; 11 become "Other") |
| Two sections for the same facts | education_extended and education_history; police_clearance_certificates, good_conduct_certificates and legal_clearances; passport_contexts, current_passport and passport_repository |
| Mixed naming inside one registry | Some sections use snake_case (date_of_birth), others camelCase (institutionName, speakingLevel) |
| Types exist but have no section or editor | Employment history (27 properties), business details (30), medical attendant (4) |

## Section by section (54 rows)

| Group | bidesh365 section | Fields users can enter | Verdict | VisaStack equivalent | Notes |
|---|---|---|---|---|---|
| Identity | Personal Identity (identity_data) | 11 (hand-written) | Partial | given_name, family_name, name_alternate, date_of_birth, place_of_birth, nationality, sex, country_of_residence | Editor list also has: Bangla full name, blood group, NID number, birth registration number, father and mother names. None of these exist in VisaStack. The data type behind it has 38 properties (religion, height, eye colour, tax ID and more). |
| Identity | Previous Names (previous_names) | 7 (registry) | Partial | name_alternate (one value) | VisaStack keeps one alternate name. No name type, date, reason or document. |
| Identity | Nationality History (nationality_history) | 8 (registry) | Partial | nationality (current only) | No history, no acquired or renounced dates, no certificate. |
| Identity | National ID Records (national_id_records) | 7 (registry) | Missing | none | No national ID record of any kind. |
| Identity | Biometrics Records (biometrics_records) | 8 (registry) | Missing | none | No fingerprint or biometric appointment record. |
| Identity | Official Purpose Data (official_purpose_data) | 8 (registry) | Missing | none | Government order number, note verbale, ministry, delegation. Needed for official travel. |
| Passport | Passport Repository (passport_contexts) | 4 (generic fallback (name, description, date, notes)) | Partial | historical passport group (4 fields) | In bidesh365 the editor shows only 4 generic boxes for this section. |
| Passport | Current Passport (current_passport) | 6 (hand-written) | Partial | passport_number, passport_issuing_country, passport_issue_date, passport_expiry | Missing: passport type, issuing authority, place of issue. |
| Passport | Passport History (passport_repository) | 4 (generic fallback (name, description, date, notes)) | Partial | historical passport group (4 fields) | In bidesh365 the editor shows only 4 generic boxes for this section. |
| Contact history | Email History (historical_emails) | 6 (registry) | Partial | email (current only) | No history of past addresses. |
| Contact history | Phone History (historical_phones) | 6 (registry) | Partial | phone (current only) | No history of past numbers. |
| Contact history | Address History (historical_addresses) | 11 (registry) | Partial | address group: line, city, country, from, to (5 of 11) | Missing: second line, state, postal code, country code, current flag, residence type. |
| Travel | Travel History (travel_history) | 5 (hand-written) | Partial | travel group: country, purpose, date (3 of 5) | One date instead of entry and exit dates. No visa type. |
| Travel | Previous Visas (previous_visa_records) | 13 (registry) | Partial | prior visa group: country, type, number, validity (4 of 13) | Missing: category, application and issue dates, entries allowed, length of stay, issuing post, status, sticker. |
| Travel | Immigration Incidents (immigration_incidents_detailed) | 10 (registry) | Partial | refusal group: country, date, reason (3 of 10) | Refusals only. No deportation, overstay, appeal, ban. |
| Travel | Travel Bans (travel_bans) | 7 (registry) | Missing | none | Entry, exit and transit bans. |
| Travel | Travel Plans (travel_plans) | 10 (registry) | Partial | held on the Case, not the profile (destination, purpose, dates) | Different place, same idea. No itinerary or booking fields. |
| Travel | Immigration Status (immigration_status) | 6 (registry) | Missing | none | Status abroad (residence permit, green card, work permit, citizenship). Needed for residency cases. |
| Financial | Financial Profile (financial_deep_dive) | 6 (hand-written) | Partial | annual_income, annual_income_currency, funding_source (3 of 6) | Missing: monthly income, tax ID (TIN), tax circle. The data type behind it has 17 properties (bank accounts, assets, property, loans). |
| Financial | Bankruptcy Records (bankruptcy_records) | 9 (registry) | Missing | none |  |
| Financial | Tax Delinquencies (tax_delinquencies) | 8 (registry) | Missing | none |  |
| Financial | Sponsorship (sponsorship_records) | 16 (registry) | Partial | sponsor group: name, relationship, address, contact (4 of 16) | Missing: sponsor income, occupation, amount, period, supporting documents. |
| Professional | Professional Profile (professional_profile) | 5 (hand-written) | Partial | current_employer, job_title, monthly_salary, self-employment (5 fields) | Missing: profession type, employer address, start date. VisaStack has more self-employment detail than the editor here. |
| Professional | Employment Gaps (employment_gaps) | 5 (registry) | Missing | none |  |
| Professional | Organization Memberships (organization_memberships) | 8 (registry) | Missing | none |  |
| Professional | Professional Achievements (professional_achievements) | 6 (registry) | Missing | none |  |
| Education | Education History (education_extended) | 15 (registry) | Partial | education group: institution, degree, field, graduation date (4 of 15) | Missing: institution type, country, city, grades, start date, certificate, transcript. |
| Education | Language Skills (languageSkills) | 8 (registry) | Missing | none | Language levels and test scores. |
| Education | Education History (education_history) | 13 (registry) | Partial | education group (4 of 13) | Duplicate of the section above in bidesh365 (two sections for the same thing). |
| Family | Social Ties (social_ties) | 4 (hand-written) | Partial | marital_status (1 of 4) | Missing: spouse name, spouse nationality, number of children. |
| Family | Extended Family (family_members_extended) | 15 (registry) | Partial | dependant group (4 of 15) | Only dependants. No parents, siblings or spouse record. |
| Family | Dependants (dependants) | 8 (registry) | Partial | dependant group: name, relationship, date of birth, nationality (4 of 8) | Missing: custody, financially dependent, accompanying. |
| Family | Invitation Letters (invitation_letters) | 16 (registry) | Missing | none | Inviter details and letter record. |
| Legal and security | Criminal Records (criminal_records) | 10 (registry) | Missing | none |  |
| Legal and security | Driving Violations (driving_violations) | 9 (registry) | Missing | none |  |
| Legal and security | Military Service (military_service) | 11 (registry) | Missing | none |  |
| Legal and security | Security Declarations (security_declarations_extended) | 7 (registry) | Missing | none |  |
| Legal and security | Police Clearance (police_clearance_certificates) | 11 (registry) | Missing | none | Often a required document. |
| Legal and security | Good Conduct Certificates (good_conduct_certificates) | 8 (registry) | Missing | none | Overlaps with the police clearance section in bidesh365. |
| Legal and security | Legal Clearances (legal_clearances) | 8 (registry) | Missing | none | Overlaps with the two sections above in bidesh365. |
| Medical and health | Health Profile (health_profile) | 6 (hand-written) | Partial | health_insurance_provider, health_insurance_policy_number, medical_condition_summary | Missing: blood group, allergies, medications. |
| Medical and health | Medical Examinations (medical_examinations) | 12 (registry) | Missing | none | Panel physician exams. |
| Medical and health | Vaccination Records (vaccination_records) | 14 (registry) | Missing | none |  |
| Medical and health | Health Declarations (health_declarations) | 8 (registry) | Missing | none |  |
| Regional (by country group) | Regional Data (Bangladesh) (regional_data) | 6 (hand-written) | Partial | address group | Bangladesh-specific: district, upazila, post office. VisaStack has no such fields. |
| Regional (by country group) | GCC Data (gcc_data) | 12 (registry) | Missing | none | Iqama, kafeel, labour card in the editor. Hajj and Umrah history exists only in the data type. |
| Regional (by country group) | Asia Pacific Data (asia_pacific_data) | 11 (registry) | Missing | none |  |
| Regional (by country group) | Australia/NZ Data (australia_nz_data) | 11 (registry) | Missing | none | Tax file number, Medicare number, skills assessment. |
| Regional (by country group) | European Data (european_data) | 7 (registry) | Missing | none |  |
| Regional (by country group) | Americas Data (americas_data) | 13 (registry) | Missing | none | Includes US social security number and alien number: these would need the strongest protection. |
| Regional (by country group) | Africa/Middle East Data (africa_middle_east_data) | 8 (registry) | Missing | none |  |
| Student visa records | SEVIS Records (sevis_records) | 14 (registry) | Missing | none | US student record. |
| Student visa records | CAS Records (cas_records) | 14 (registry) | Missing | none | UK student record. |
| Student visa records | COE Records (coe_records) | 15 (registry) | Missing | none | Australian student record. |

## Where VisaStack is ahead

| Area | VisaStack | bidesh365 |
|---|---|---|
| Employment history | 5 fields per job in a repeating group | No section or editor in bidesh365 (type exists, 27 properties) |
| Business pack | 6 fields | No section in bidesh365 (type has 30 properties) |
| Medical attendant pack | 6 fields incl. passport and return plan | No section in bidesh365 |
| Self-employment detail | 5 fields | Not in the editor list |
| Protection and sharing | Encryption of Sensitive and Restricted fields; packs double as sharing categories | A 3-level label on 35 fields; encryption not found in what I read |
| Currency and marital choices | 34 currency codes; 7 marital statuses as pick lists | Currency list has 4 options in the editor |

## Purposes

| Purpose | bidesh365 | VisaStack | Gap |
|---|---|---|---|
| Tourism, business, study, work, medical, family | In the fixed purpose list | Free-text purpose on the case; Professional, Business, Medical packs exist | Packs cover work, business and medical only. No study or family pack. |
| Corporate transfer, skilled worker, blue card | In the fixed purpose list (3 values) | None | Neither has a job-offer or employer-sponsor section |
| Permanent residency | Status type "Permanent Residence" and "Green Card" exist; Gulf residency history exists | Only country of residence | Neither tracks continuous residence or days outside the country (0 matches in bidesh365 code) |
| Citizenship or naturalisation | Status type "Citizenship" and an acquisition-method list exist | Only current nationality | No application-specific fields in either product |
| Job sponsorship by an employer | Pieces inside country sections: sponsor licence number (UK, Australia), LMIA (Americas), occupation codes (Australia, Canada) | None | No general job-offer or employer-sponsor section in either product |
| Being sponsored by family or a person | Sponsorship record with 16 fields; invitation letter record with 16 fields | Sponsor group with 4 fields | VisaStack lacks sponsor income, amount, period, documents and the whole invitation record |
| Investor or golden visa | Only a permit type "Investor" in Gulf data | Business pack: company, registration, type, investment amount, ownership share | Neither has an investor-visa section |
| Student (US, UK, Australia) | Student records for all three, plus study purpose data | None | Missing in VisaStack |
| Medical treatment | Medical purpose data, medical exams, vaccinations | Medical and Medical attendant packs (6 + 6 fields) | VisaStack is ahead on the attendant; bidesh365 on exams and vaccinations |
| Religious travel (Hajj, Umrah) | 4 fields in the Gulf data type, not in the editor list | None | Missing in VisaStack |
| Official or diplomatic travel | Government order number, note verbale, ministry, delegation | None | Missing in VisaStack |
| Refugee, asylum, humanitarian | Only document types (refugee, stateless travel documents), folded to "Passport" on storage | None | Neither has a profile section |
| Minors travelling | Parental consent and custody document types | Dependants only | Neither has minor-specific profile logic |
| Journalist, seafarer, working holiday, digital nomad | 0 matches | 0 matches | Nobody covers these |

## Port risks and constraints

| Topic | Detail |
|---|---|
| Strongest protection needed | US social security number, alien number, Medicare number, tax file number, biometrics, national ID: all would need to be Restricted. VisaStack has exactly one Restricted field today. |
| Packs are also sharing categories | Adding or renaming a pack changes what a traveller can share with an agency. New fields inside existing packs do not. |
| Fields register themselves on first edit | Adding a field to the list makes it editable at once. AI suggestions can only fill a field after someone has edited it once, or after a one-time registration step. This needs a deliberate decision. |
| No database change for documents | VisaStack stores the document type as free text, so a bigger list needs no migration. Labels and recognition rules need work. |
| Do not copy the duplicates | Merge the two document lists, the two education sections and the three clearance sections before porting. |
| Bangladesh-specific fields | NID, birth registration, TIN circle, upazila belong in a Bangladesh pack, not in Universal. |
| Legal review | Declarations (criminal, security, health) and national identifiers need the adviser before they go in front of travellers. |

## Proposed phases (not started; owner decides)

- **Phase 1: purposes and packs**: Decide the real purpose list (residency, citizenship, job sponsorship, investor, student, family, official, religious, humanitarian) and which packs they use. No code.
- **Phase 2: one document list**: Merge 114 + 137 + 141 into one curated list with plain labels and categories. Documents can then be stored without a migration.
- **Phase 3: universal fields**: Add the missing universal fields first: national ID, previous names, past emails and phones, travel entry and exit dates, immigration status, language skills.
- **Phase 4: purpose packs**: Residency and citizenship (days in and out of the country), job offer and employer, student records, family and sponsor detail, legal clearances.
- **Phase 5: country packs**: Gulf, Asia-Pacific, Australia and New Zealand, Europe, Americas, Africa and Middle East, each opt-in.

## Not verified

- Whether bidesh365 runs, whether all 52 sections work on screen, and what its database holds. I read code only.
- Whether VisaStack country rule packs (stored in the database) already name more document types. I read the code, not the database.
- The meaning of two bidesh365 document-mapping details I did not trace: how the 37 unmapped scanner types behave when scanned.
- Legal correctness of any declaration wording.
