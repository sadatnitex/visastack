# Master Profile catalogue: review report

Generated from the catalogue in `packages/core/src/catalogue`. Do not edit by hand: a test fails when this file and the catalogue disagree. Regenerate with `pnpm --filter @visastack/core test -- -u`.

Nothing in this report is live yet. The catalogue is data only. No screen, rule, sharing grant or AI prompt reads it until Phase 2, and the 81 fields that work today are unchanged.

## Totals

| Item | Count |
|---|---|
| Fields live today (frozen) | 81 |
| Fields added by the catalogue | 801 |
| Of these, Other text boxes and Other Items (never counted) | 141 |
| Sections (opt-in) | 82 |
| Sections open from the start | 10 |
| Fields counted when only the default sections are open | 54 |
| Repeating records added | 66 |
| Live repeating records extended | 8 |
| Document types | 215 |
| Document types recognised by the scanner today | 3 |
| Purposes | 109 |
| Fields marked "proposed" (need sign-off) | 0 |
| Document types marked "proposed" (need sign-off) | 39 |

## Layers

| Layer | Live fields | New fields | What it holds |
|---|---|---|---|
| Identity and Civil Status | 11 | 129 | Names, birth, civil records, national identifiers and personal details. |
| Travel Documents | 12 | 37 | Passports, identity cards, permits and visas held. |
| Timelines | 22 | 61 | Where you lived, worked, studied and travelled, with dates. |
| Money | 3 | 76 | Income, assets, tax, funding and sponsors. |
| People | 14 | 109 | Family, hosts, inviters, referees and guardians. |
| Declarations and History | 3 | 106 | Refusals, bans, legal and security history. Wording needs adviser review. |
| Health | 6 | 36 | Vaccinations, examinations, insurance and declared conditions. |
| Qualifications | 4 | 51 | Education, language tests, skills, memberships and achievements. |
| Purpose Packs | 6 | 123 | Details that only some purposes need: study, work, business, family, official. |
| Country Packs | 0 | 73 | Identifiers and records that belong to one country or region. |

## Sections

Every section is visible. Only the ones marked Open are open from the start; the rest are locked until the person ticks them. Opening a section adds its counted fields to the completion figure at once. A section that already holds a saved value is always open.

| Section | Layer | Category | Starts | Counted fields | Suggested for |
|---|---|---|---|---|---|
| Identity Basics | identity | universal | Open | 11 |  |
| Passport | travel_documents | universal | Open | 8 |  |
| Visas You Have Held | travel_documents | universal | Open | 4 |  |
| Visa Refusals | declarations | universal | Open | 3 |  |
| Addresses | timelines | universal | Open | 5 |  |
| Travel History | timelines | universal | Open | 3 |  |
| Employment | timelines | professional | Open | 9 |  |
| Education | qualifications | professional | Open | 4 |  |
| Income and Funding | money | universal | Open | 3 |  |
| Sponsor or Host | people | universal | Open | 4 |  |
| Self-Employment | timelines | professional | Locked | 5 |  |
| Dependants | people | universal | Locked | 4 | settle, visit |
| Business and Investment | purpose_packs | business | Locked | 6 | work, settle |
| Medical Treatment | health | medical | Locked | 6 | visit |
| Medical Attendant | people | medical_attendant | Locked | 6 | visit |
| Passport Details and Incidents | travel_documents | universal | Locked (extra detail for passport) | 9 |  |
| Visa Details | travel_documents | universal | Locked (extra detail for prior_visas) | 8 |  |
| Refusal Details | declarations | universal | Locked (extra detail for refusals) | 3 |  |
| Address Details | timelines | universal | Locked (extra detail for addresses) | 11 |  |
| Trip Details | timelines | universal | Locked (extra detail for travel_history) | 7 |  |
| Job Details | timelines | professional | Locked (extra detail for employment) | 14 |  |
| Education Details | qualifications | professional | Locked (extra detail for education) | 13 |  |
| Sponsor Details | people | universal | Locked (extra detail for sponsor_host) | 11 |  |
| Dependant Details | people | universal | Locked (extra detail for dependants) | 5 |  |
| Names and Birth Details | identity | universal | Locked | 7 |  |
| Previous Names | identity | universal | Locked | 6 |  |
| Nationality History | identity | universal | Locked | 6 | settle |
| Bangladesh Identifiers | identity | bangladesh | Locked | 3 |  |
| Identity Numbers From Other Countries | identity | country_ids | Locked | 6 |  |
| Email and Phone History | identity | universal | Locked | 10 |  |
| Online Accounts | identity | universal | Locked | 5 |  |
| Biometric Appointments | identity | universal | Locked | 8 |  |
| Physical Description | identity | universal | Locked | 5 |  |
| Needs and Preferences | identity | universal | Locked | 4 |  |
| Accessibility Needs | identity | medical | Locked | 1 |  |
| Sensitive Personal Details | identity | declarations | Locked | 1 |  |
| Immigration Status Abroad | travel_documents | universal | Locked | 6 | settle, after_decision |
| Travel Insurance | travel_documents | universal | Locked | 8 | visit |
| Gaps in Work | timelines | professional | Locked | 4 | work, settle |
| Applications and Decisions | timelines | universal | Locked | 17 | after_decision |
| Bangladesh Tax | money | bangladesh | Locked | 8 |  |
| Tax Returns | money | universal | Locked | 5 |  |
| Income Sources | money | universal | Locked | 6 |  |
| Accounts, Assets and Loans | money | universal | Locked | 28 |  |
| Funding and Costs | money | universal | Locked | 13 |  |
| Spouse and Parents | people | universal | Locked | 23 |  |
| Other Family Members | people | universal | Locked | 16 |  |
| Hosts and Inviters | people | universal | Locked | 19 | visit |
| Referees and Guardians | people | universal | Locked | 15 |  |
| Travel Companions | people | universal | Locked | 4 |  |
| Ties to Home | people | universal | Locked | 5 | visit, study |
| Emergency Contact | people | universal | Locked | 4 |  |
| Immigration Incidents and Bans | declarations | declarations | Locked | 19 |  |
| Legal History | declarations | declarations | Locked | 23 |  |
| Police and Good Conduct Certificates | declarations | declarations | Locked | 11 |  |
| Military Service and Memberships | declarations | declarations | Locked | 18 |  |
| Bankruptcy and Tax Defaults | declarations | declarations | Locked | 16 |  |
| Vaccinations | health | medical | Locked | 13 |  |
| Medical Examinations | health | medical | Locked | 11 |  |
| Health Declarations | health | medical | Locked | 8 |  |
| Languages and Tests | qualifications | professional | Locked | 14 | study, work, settle |
| Registrations and Skills Assessments | qualifications | professional | Locked | 13 | work, settle |
| Awards, Publications and Press | qualifications | professional | Locked | 6 | work, settle |
| Study Plan | purpose_packs | study | Locked | 22 | study |
| Job Offer and Occupation | purpose_packs | professional | Locked | 14 | work |
| Overseas Labour Contract | purpose_packs | labour_migration | Locked | 20 | work |
| Companies You Run or Own | purpose_packs | business | Locked | 18 | work, settle, visit |
| Treatment Plan | purpose_packs | medical | Locked | 8 | visit |
| Family and Settlement Evidence | purpose_packs | settle | Locked | 9 | settle |
| After Arrival | purpose_packs | settle | Locked | 10 | settle, after_decision, study, work |
| Official Travel Order | purpose_packs | official_travel | Locked | 6 | protection |
| Pilgrimage Trip | purpose_packs | official_travel | Locked | 5 | visit |
| Bangladesh Address Details | country_packs | bangladesh | Locked | 5 |  |
| Gulf Countries | country_packs | country_ids | Locked | 11 |  |
| Asia Pacific | country_packs | country_ids | Locked | 12 |  |
| Australia and New Zealand | country_packs | country_ids | Locked | 11 |  |
| European Union and Switzerland | country_packs | country_ids | Locked | 4 |  |
| United Kingdom and Ireland | country_packs | country_ids | Locked | 7 |  |
| United States | country_packs | country_ids | Locked | 11 |  |
| Canada | country_packs | country_ids | Locked | 3 |  |
| Brazil and Mexico | country_packs | country_ids | Locked | 2 |  |
| Africa and the Middle East | country_packs | country_ids | Locked | 6 |  |

### How the completion figure moves

| Situation | Fields counted | Answered | Percent |
|---|---|---|---|
| Nothing opened, nothing answered | 54 | 0 | 0% |
| Nothing opened, every default field answered | 54 | 54 | 100% |
| Default answered, then "Bangladesh Tax" opened | 62 | 54 | 87% |
| Default answered, then "Self-Employment" opened | 59 | 54 | 92% |
| Default answered, then "Spouse and Parents" opened | 77 | 54 | 70% |

## Sharing categories (packs)

A sharing category decides what a grant can include. The five live categories already exist. The proposed ones do not exist yet, which is the safe default: data placed in one cannot be reached by any grant until the category is added on purpose in Phase 2.

| Category | Status | Live fields | New fields | Document types | Why it is separate |
|---|---|---|---|---|---|
| universal | Live | 45 | 318 | 102 | Existing category |
| professional | Live | 18 | 93 | 30 | Existing category |
| business | Live | 6 | 26 | 8 | Existing category |
| medical | Live | 6 | 51 | 14 | Existing category |
| medical_attendant | Live | 6 | 5 | 0 | Existing category |
| declarations | Proposed | 0 | 108 | 7 | Legal and security history must never ride along with a general profile grant. Its own category means nobody receives it unless the person grants it by name. |
| study | Proposed | 0 | 29 | 14 | A university or education agent needs this without seeing work or money detail. |
| settle | Proposed | 0 | 25 | 8 | Relationship and residence evidence is personal and used only for family and settlement routes. |
| labour_migration | Proposed | 0 | 28 | 8 | Contract-work records are shared with a recruiting agency and the government, not with every visa adviser. |
| official_travel | Proposed | 0 | 16 | 5 | Official and pilgrimage details apply to few people and go to specific recipients. |
| bangladesh | Proposed | 0 | 22 | 4 | Owner decision 2026-10-14: a Bangladesh pack with the strongest protection on identifiers. |
| country_ids | Proposed | 0 | 80 | 0 | Foreign identifiers are high value to fraudsters and are needed only for that country. |
| (none) | No category | 0 | 0 | 15 | Behaves as unmapped types do today |

## Protection

| Level | Live fields | New fields |
|---|---|---|
| STANDARD | 67 | 540 |
| SENSITIVE | 13 | 130 |
| RESTRICTED | 1 | 131 |

Protection follows what a field holds: national identifiers, legal history, health detail, special categories and biometrics are RESTRICTED; other identifiers, personal dates and money amounts are SENSITIVE. A test refuses any field below the level its kind requires.

## Purposes

From general knowledge of how immigration systems work and the owner decisions of 2026-10-14. These are not verified rules: a purpose gets a readiness score only once a cited, approved rule pack exists for it.

### Visit (16)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Tourism | standard | Itinerary, funding, ties to home |  |
| Family or Friends Visit | standard | Host details, invitation, relationship proof |  |
| Business Visit | standard | Company, invitation, trade licence |  |
| Conference, Trade Fair or Exhibition | standard | Event invitation, registration receipt |  |
| Culture, Sport or Performance | standard | Event contract, team or troupe records |  |
| Medical Treatment | standard | Hospital, treatment plan, cost, attendant |  |
| Accompanying a Patient | standard | Patient records, relationship, return plan |  |
| Religious Travel (Hajj, Umrah, Pilgrimage) | adviser_review | Operator, group, vaccination records | Licensed process. An adviser reviews before it is offered. |
| Transit or Airside Transit | standard | Onward ticket, destination visa |  |
| Wedding, Funeral or Urgent Family Event | standard | Event proof, relationship, urgency evidence |  |
| Short Volunteering or Charity Work | standard | Host organisation letter |  |
| Journalism, Media or Filming | standard | Accreditation, assignment letter |  |
| Short Academic or Research Visit | standard | Host institution invitation |  |
| Electronic Travel Authorisation, E-Visa or Visa on Arrival | standard | Passport, prior travel, funds | Rules vary a lot between countries. |
| Visit as a Resident of a Third Country | standard | Residence permit held elsewhere |  |
| Other Visit Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### Study (12)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Bachelor's or Master's Degree | standard | Offer, funds, language, qualifications |  |
| Doctorate or Research Degree | standard | Supervisor, proposal, funding, publications |  |
| Foundation, Pathway or Language Course | standard | Course offer, funds, language level |  |
| School-Age Education and Guardian | standard | School offer, guardian details, custody |  |
| Vocational Training or Apprenticeship | standard | Provider offer, employer link |  |
| Short Course or Exchange | standard | Programme letter, funds |  |
| Scholarship-Funded Study | standard | Award terms, bond obligations, sponsor letter |  |
| Internship or Placement | standard | Host letter, supervision, stipend |  |
| Postdoctoral or Visiting Scholar | standard | Host, funding, research record |  |
| Post-Study Work or Graduate Route | standard | Completion proof, status history |  |
| Switching Course or Institution | standard | Old and new offers, status history |  |
| Other Study Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### Work (22)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Employer-Sponsored Skilled Job | standard | Job offer, employer, occupation code, contract |  |
| Points-Based Skilled Migration | standard | Points evidence, skills assessment, language |  |
| Highly Skilled or Blue Card Type | standard | Salary, qualifications, contract |  |
| Exceptional Talent | standard | Endorsements, awards, publications, press |  |
| Company Transfer | standard | Group letter, role, tenure |  |
| Overseas Labour Contract Through a Recruiting Agency | adviser_review | Agency licence, emigration clearance, medical results, skill test, training, welfare fee, contract wage | A major route for Bangladeshis. Exact names of the clearances are held for adviser review. |
| Health and Care Worker | standard | Registration, licence, experience, placement |  |
| Teacher or Lecturer | standard | Credentials, registration, contract |  |
| Seasonal or Agricultural Work | standard | Scheme eligibility, contract, housing |  |
| Domestic Worker or Au Pair | standard | Placement, family host, contract |  |
| Seafarer or Crew | standard | Seaman records, certificates, sea service |  |
| Working Holiday or Youth Mobility | standard | Scheme eligibility, funds, age |  |
| Remote Worker or Digital Nomad | standard | Income proof, employer or clients, insurance |  |
| Job-Seeker Visa | standard | Qualifications, funds, points where used |  |
| Self-Employed or Freelancer | standard | Clients, contracts, income proof |  |
| Start-Up Founder or Entrepreneur | standard | Business plan, endorsement, funds |  |
| Investor or Business Purchase | adviser_only | Source of funds, investment, due diligence |  |
| Religious or Charity Worker | standard | Organisation letter, role, support |  |
| Researcher or Scientist | standard | Host, funding, publications |  |
| Project Contractor or Posted Worker | standard | Contract, client, project dates |  |
| Athlete, Coach or Performer on Contract | standard | Contract, club or agent, achievements |  |
| Other Work Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### Settle (20)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Spouse or Partner | standard | Relationship evidence, sponsor finances |  |
| Fiancé(e) or Marriage Visa | standard | Relationship evidence, wedding plan |  |
| Child or Dependent Child | standard | Birth proof, custody, parent status |  |
| Parent or Grandparent | standard | Dependency proof, sponsor finances, health |  |
| Dependants Joining a Worker or Student | standard | Main applicant status, relationship proof |  |
| Adoption | adviser_review | Adoption order, home study, consent |  |
| Permanent Residency by Points | standard | Points evidence, days in and out, status history |  |
| Permanent Residency Through an Employer | standard | Employer, tenure, contract, days in and out |  |
| Permanent Residency Through Family | standard | Relationship, sponsor status, finances |  |
| Permanent Residency by Long Residence | standard | Continuous residence days, absences, tests |  |
| Permanent Residency by Investment | adviser_only | Source of funds, investment |  |
| Citizenship by Naturalisation | standard | Residence days, tests, good character |  |
| Citizenship by Descent or Registration | standard | Ancestor records, civil documents |  |
| Returning Resident or Re-Entry Permit | standard | Absence record, ties, status |  |
| Retirement or Long-Stay Residence | standard | Pension, savings, insurance, property |  |
| Extension of Stay | standard | Current status, reason, funds |  |
| Change of Status | standard | Current and target status, evidence |  |
| Dual Nationality or Renunciation | adviser_review | Both nationalities, legal basis |  |
| Citizenship by Investment | adviser_only | Source of funds, due diligence | Not offered in version one. An adviser decides. |
| Other Settle Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### Protection and Special (10)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Asylum or Refugee Protection | adviser_only | Account, evidence, identity |  |
| Resettlement Programme | adviser_only | Referral, identity, family |  |
| Humanitarian or Compassionate Grounds | adviser_only | Circumstances, evidence |  |
| Victim of Trafficking or Abuse | adviser_only | Circumstances, support records |  |
| Stateless Person | adviser_only | Identity records, history |  |
| Official or Diplomatic Travel | adviser_review | Order number, ministry, delegation |  |
| International Organisation Staff | adviser_review | Appointment letter, organisation card |  |
| Military or Defence Exchange | adviser_review | Orders, programme, clearance |  |
| Embassy or Consular Staff and Dependants | adviser_review | Posting letter, family |  |
| Other Protection Purpose | adviser_only | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### After a Decision (9)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Reapplication After a Refusal | standard | Past answers, refusal reasons, new evidence |  |
| Appeal or Administrative Review | adviser_review | Decision notice, grounds, deadlines |  |
| Complaint About a Decision or Service | standard | Case record, timeline |  |
| Response to a Visa Cancellation | adviser_review | Notice, grounds, evidence |  |
| Extension or Renewal | standard | Current permit, reason, funds |  |
| Conditions Tracking After Arrival | standard | Work limits, check-in dates, reporting |  |
| Arrival and Local Registration | standard | Address, registration steps, local numbers |  |
| Departure Planning and Overstay Avoidance | standard | Expiry dates, exit rules |  |
| Other Post-Decision Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### Supporting Applications (11)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| Passport Application or Renewal | standard | Civil records, photos, fees |  |
| National ID or Birth Registration Correction | standard | Civil records, name evidence |  |
| Police Clearance | standard | Identity, address history, purpose |  |
| Certificate Attestation and Legalisation | standard | Originals, issuing office, destination rule |  |
| Credential Evaluation and Degree Equivalence | standard | Transcripts, awarding body, assessor |  |
| Professional Registration Abroad | standard | Qualifications, experience, exams |  |
| Driving Licence Exchange | standard | Licence, residency, tests |  |
| Tax Residency Certificate | standard | Tax numbers, residence days, returns |  |
| Name Correction Across Documents | standard | All name variants, evidence |  |
| Translation and Certified Copies | standard | Source documents, translator, certification |  |
| Other Supporting Application Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

### Beyond Immigration (9)

| Purpose | Handling | Evidence themes | Note |
|---|---|---|---|
| University or School Application | standard | Transcripts, references, statements |  |
| Scholarship Application | standard | Achievements, finances, references |  |
| Job Application Abroad | standard | CV built from timelines and qualifications |  |
| Foreign Bank Account or Remittance Checks | standard | Identity, address, source of funds |  |
| Travel or Health Insurance | standard | Identity, trip, health declarations |  |
| Renting a Home Abroad | standard | Income, employer letter, references |  |
| Company Director or Shareholder Registration Abroad | standard | Identity, address, ownership |  |
| Property Purchase Abroad | standard | Source of funds, identity, tax numbers |  |
| Other Beyond Immigration Purpose | adviser_review | Describe what you need and what you can show | Not on the list. Describe it, and an adviser decides how it is handled. |

## Document types

Distinct documents stay distinct. Exact duplicates are merged and kept as aliases. Pack is the intended sharing category and is not live: today only Passport, Bank Statement and Employment Certificate have one.

### Identity and Civil (18)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| PASSPORT | Passport | universal | 120 | original | PASSPORT_BIO_PAGE | visastack |
| NID | National ID Card | bangladesh |  |  | NATIONAL_ID, NID_CARD, SMART_CARD | bidesh365 |
| BIRTH_CERTIFICATE | Birth Certificate | bangladesh |  | translation | BIRTH_REGISTRATION, BIRTH_RECORD | bidesh365 |
| MARRIAGE_CERTIFICATE | Marriage Certificate | universal |  | translation | NIKAH_NAMA, MARRIAGE_REGISTRATION, WEDDING_CERTIFICATE | bidesh365 |
| DIVORCE_CERTIFICATE | Divorce Certificate | universal |  | translation | DIVORCE_DECREE, DISSOLUTION_OF_MARRIAGE | bidesh365 |
| DEATH_CERTIFICATE | Death Certificate | universal |  | translation | DEATH_REGISTRATION | bidesh365 |
| ADOPTION_CERTIFICATE | Adoption Certificate | settle |  | notarisation | ADOPTION_PAPER, ADOPTION_PAPERS, LEGAL_GUARDIANSHIP | bidesh365 |
| NAME_CHANGE_CERTIFICATE | Name Change Certificate | universal |  |  | NAME_CHANGE, DEED_POLL, NAME_CHANGE_AFFIDAVIT | bidesh365 |
| GENDER_CERTIFICATE | Gender Certificate | universal |  |  |  | bidesh365 |
| CITIZENSHIP_CERTIFICATE | Citizenship Certificate | universal |  |  | NATURALIZATION_CERTIFICATE | bidesh365 |
| RESIDENCE_PERMIT | Residence Permit | universal |  |  | RESIDENCE_CARD, PR_CARD | bidesh365 |
| DRIVING_LICENCE | Driving Licence | universal |  |  | DRIVERS_LICENSE, DRIVING_LICENSE | bidesh365 |
| TRAVEL_DOCUMENT | Travel Document | universal |  |  |  | bidesh365 |
| REFUGEE_DOCUMENT | Refugee Document | universal |  |  |  | bidesh365 |
| STATELESS_DOCUMENT | Stateless Document | universal |  |  |  | bidesh365 |
| EMERGENCY_TRAVEL | Emergency Travel | universal |  |  | EMERGENCY_TRAVEL_DOCUMENT | bidesh365 |
| LAISSEZ_PASSER | Laissez Passer | universal |  |  |  | bidesh365 |
| OTHER_IDENTITY_DOCUMENT | Other Identity or Civil Document | (none) |  |  |  | owner_vision |

### Travel and Immigration (17)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| VISA | Visa | universal |  |  | E_VISA, VISA_STICKER, ENTRY_PERMIT, VISA_PREVIOUS | bidesh365 |
| VISA_STAMP | Visa Stamp | universal |  |  | ENTRY_STAMP, EXIT_STAMP, IMMIGRATION_STAMP | bidesh365 |
| TRAVEL_HISTORY_DECLARATION | Travel History Declaration | universal |  |  | TRAVEL_HISTORY | bidesh365 |
| FLIGHT_TICKET | Flight Ticket | universal |  |  | AIR_TICKET, BOARDING_PASS, E_TICKET | bidesh365 |
| FLIGHT_BOOKING | Flight Booking | universal |  |  | FLIGHT_ITINERARY, PNR, BOOKING_CONFIRMATION | bidesh365 |
| RETURN_TICKET | Return or Onward Ticket | universal |  |  | ONWARD_TICKET, ROUND_TRIP | bidesh365 |
| HOTEL_BOOKING | Hotel or Stay Booking | universal |  |  | HOTEL_RESERVATION, ACCOMMODATION_BOOKING, AIRBNB_BOOKING | bidesh365 |
| TRAVEL_ITINERARY | Travel Itinerary | universal |  |  | TRIP_PLAN, TRAVEL_PLAN | bidesh365 |
| TRAVEL_INSURANCE | Travel Insurance | universal |  |  | TRIP_INSURANCE | bidesh365 |
| CRUISE_BOOKING | Cruise Booking | universal |  |  | CRUISE_RESERVATION, CRUISE_TICKET | bidesh365 |
| CAR_RENTAL | Car Rental Booking | universal |  |  | VEHICLE_RENTAL | bidesh365 |
| WORK_PERMIT | Work Permit | professional |  |  | WORK_AUTHORIZATION, EMPLOYMENT_PERMIT | bidesh365 |
| STUDENT_PERMIT | Student Permit | study |  |  | STUDY_PERMIT | bidesh365 |
| TEMPORARY_RESIDENCE_PERMIT | Temporary Residence Permit | universal |  |  | TRP | bidesh365 |
| PERMANENT_RESIDENCE | Permanent Residence | universal |  |  |  | bidesh365 |
| GREEN_CARD | Green Card | universal |  |  | US_PERMANENT_RESIDENT_CARD | bidesh365 |
| OTHER_TRAVEL_DOCUMENT | Other Travel or Immigration Document | (none) |  |  |  | owner_vision |

### Financial (35)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| BANK_STATEMENT | Bank Statement | universal | 1 |  | ACCOUNT_STATEMENT, TRANSACTION_HISTORY | visastack |
| SOLVENCY_CERTIFICATE | Bank Solvency Certificate | universal | 1 |  | BALANCE_CERTIFICATE, FUNDS_CONFIRMATION | bidesh365 |
| TAX_RETURN | Tax Return | universal |  |  | ITR, TAX_FILING | bidesh365 |
| TIN_CERTIFICATE | Tax Identification Number Certificate | bangladesh |  |  | TAX_IDENTIFICATION_NUMBER | bidesh365 |
| SALARY_SLIP | Salary Slip | universal | 3 |  | PAYSLIP, PAY_SLIP, WAGE_SLIP, PAY_STUB | bidesh365 |
| SALARY_CERTIFICATE | Salary Certificate | universal |  |  |  | bidesh365 |
| INCOME_CERTIFICATE | Income Certificate | universal |  |  | INCOME_PROOF | bidesh365 |
| PENSION_STATEMENT | Pension Statement | universal |  |  | RETIREMENT_FUND, PROVIDENT_FUND | bidesh365 |
| INVESTMENT_PROOF | Investment Proof | universal |  |  | FDR, FIXED_DEPOSIT, SHARES | bidesh365 |
| FDR_CERTIFICATE | Fixed Deposit Receipt | universal |  |  | FIXED_DEPOSIT_RECEIPT | bidesh365 |
| SANCHAYPATRA | Sanchaypatra (National Savings Certificate) | universal |  |  | NATIONAL_SAVINGS_CERTIFICATE | bidesh365 |
| STOCK_CERTIFICATE | Stock Certificate | universal |  |  | SHARE_CERTIFICATE | bidesh365 |
| CRYPTOCURRENCY_PROOF | Cryptocurrency Proof | universal |  |  | CRYPTO_HOLDINGS_PROOF | bidesh365 |
| LOAN_STATEMENT | Loan Statement | universal |  |  |  | bidesh365 |
| CREDIT_CARD_STATEMENT | Credit Card Statement | universal |  |  | CREDIT_STATEMENT | bidesh365 |
| CREDIT_REPORT | Credit Report | universal |  |  | CREDIT_BUREAU_REPORT | bidesh365 |
| PROPERTY_DEED | Property Deed | universal |  | translation | LAND_DEED, HOUSE_DEED, TITLE_DEED, LAND_TITLE, PROPERTY_OWNERSHIP | bidesh365 |
| SPONSORSHIP_LETTER | Sponsorship Letter | universal |  |  | SPONSOR_LETTER | bidesh365 |
| FINANCIAL_GUARANTEE | Financial Guarantee | universal |  |  | BANK_GUARANTEE | bidesh365 |
| AFFIDAVIT_OF_SUPPORT | Affidavit of Support | universal |  | notarisation | I_134, FINANCIAL_AFFIDAVIT | bidesh365 |
| GRANT_LETTER | Grant Letter | study |  |  | GRANT_AWARD_LETTER | bidesh365 |
| GIFT_DEED | Gift Deed | universal |  |  |  | proposed |
| SALE_DEED | Sale Deed | universal |  |  |  | proposed |
| INHERITANCE_DOCUMENT | Inheritance Document | universal |  |  |  | proposed |
| REMITTANCE_RECORD | Remittance Record | universal |  |  | REMITTANCE_HISTORY | proposed |
| LARGE_DEPOSIT_EXPLANATION | Large Deposit Explanation | universal |  |  |  | proposed |
| RENTAL_INCOME_PROOF | Rental Income Proof | universal |  |  |  | proposed |
| AGRICULTURAL_INCOME_PROOF | Agricultural Income Proof | universal |  |  | FARM_INCOME_PROOF | proposed |
| DIVIDEND_STATEMENT | Dividend Statement | universal |  |  |  | proposed |
| TAX_RESIDENCY_CERTIFICATE | Tax Residency Certificate | universal |  |  |  | proposed |
| JOINT_ACCOUNT_STATEMENT | Joint Account Statement | settle |  |  |  | proposed |
| BANK_REFERENCE_LETTER | Bank Reference Letter | universal |  |  |  | proposed |
| TAX_ACKNOWLEDGEMENT_SLIP | Tax Return Acknowledgement Slip | bangladesh |  |  | TAX_ACK_SLIP, TAX_RETURN_ACKNOWLEDGEMENT, TAX_ACKNOWLEDGEMENT_RECEIPT | bidesh365 |
| ASSET_VALUATION_REPORT | Asset Valuation Report | universal |  |  | ASSET_VALUATION | bidesh365 |
| OTHER_FINANCIAL_DOCUMENT | Other Financial Document | (none) |  |  |  | owner_vision |

### Employment and Business (31)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| EMPLOYMENT_CERTIFICATE | Employment Certificate | professional | 3 |  | EMPLOYMENT_LETTER, JOB_LETTER | visastack |
| NOC_EMPLOYER | Employer No Objection Letter | professional | 3 |  | EMPLOYER_NOC, LEAVE_NOC | bidesh365 |
| LEAVE_APPROVAL | Leave Approval | professional |  |  | LEAVE_SANCTION, VACATION_APPROVAL | bidesh365 |
| APPOINTMENT_LETTER | Appointment Letter | professional |  |  | OFFER_LETTER, JOINING_LETTER | bidesh365 |
| EXPERIENCE_CERTIFICATE | Experience Certificate | professional |  |  | WORK_EXPERIENCE, SERVICE_CERTIFICATE | bidesh365 |
| EMPLOYMENT_CONTRACT | Employment Contract | professional |  |  | CONTRACT, JOB_CONTRACT, SERVICE_AGREEMENT | bidesh365 |
| PROMOTION_LETTER | Promotion Letter | professional |  |  |  | bidesh365 |
| RESIGNATION_LETTER | Resignation Letter | professional |  |  |  | bidesh365 |
| TERMINATION_LETTER | Termination Letter | professional |  |  |  | bidesh365 |
| RETIREMENT_LETTER | Retirement Letter | professional |  |  | PENSION_LETTER | bidesh365 |
| REFERENCE_LETTER | Reference Letter | professional |  |  | PROFESSIONAL_REFERENCE | bidesh365 |
| FREELANCE_PROOF | Freelance Proof | professional |  |  | SELF_EMPLOYMENT_PROOF, CONTRACTOR_PROOF | bidesh365 |
| FREELANCE_CONTRACT | Freelance Contract | professional |  |  | FREELANCE_AGREEMENT | bidesh365 |
| BUSINESS_REGISTRATION | Business Registration | business |  |  | COMPANY_REGISTRATION, INCORPORATION_CERTIFICATE | bidesh365 |
| TRADE_LICENSE | Trade License | business |  |  | BUSINESS_LICENSE, TRADE_LICENCE | bidesh365 |
| COMPANY_MEMORANDUM | Company Memorandum | business |  |  | MOA, AOA, ARTICLES_OF_ASSOCIATION | bidesh365 |
| BOARD_RESOLUTION | Board Resolution | business |  |  | CORPORATE_RESOLUTION | bidesh365 |
| COMPANY_ACCOUNTS | Company Accounts | business |  |  | COMPANY_FINANCIAL_STATEMENTS | bidesh365 |
| AUDIT_REPORT | Audit Report | business |  |  | AUDITED_FINANCIAL_STATEMENTS | bidesh365 |
| SHARE_REGISTER | Share Register | business |  |  | SHAREHOLDING_RECORD | proposed |
| BUSINESS_BANK_STATEMENT | Business Bank Statement | business |  |  |  | proposed |
| BUSINESS_CARD | Business Card | professional |  |  |  | bidesh365 |
| JOB_OFFER_LETTER | Job Offer Letter | professional |  |  | EMPLOYMENT_OFFER | bidesh365 |
| LABOUR_CONTRACT | Overseas Labour Contract | labour_migration |  |  | WORK_CONTRACT, EMPLOYMENT_AGREEMENT | bidesh365 |
| RECRUITING_AGENCY_LICENCE | Recruiting Agency Licence | labour_migration |  |  |  | proposed |
| EMIGRATION_CLEARANCE | Emigration Clearance | labour_migration |  |  | GOVERNMENT_EMIGRATION_CLEARANCE | proposed |
| WELFARE_FEE_RECEIPT | Welfare Fee Receipt | labour_migration |  |  |  | proposed |
| RECRUITMENT_FEE_RECEIPT | Recruitment Fee Receipt | labour_migration |  |  |  | proposed |
| PRE_DEPARTURE_TRAINING_CERTIFICATE | Pre-Departure Training Certificate | labour_migration |  |  |  | proposed |
| SKILL_TEST_CERTIFICATE | Skill Test Certificate | labour_migration |  |  |  | proposed |
| OTHER_EMPLOYMENT_DOCUMENT | Other Employment or Business Document | (none) |  |  |  | owner_vision |

### Education and Qualifications (27)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| EDUCATION_CERTIFICATE | Education Certificate | professional |  |  | DEGREE, DIPLOMA | bidesh365 |
| DEGREE_CERTIFICATE | Degree Certificate | professional |  | translation | BACHELOR, MASTER, PHD | bidesh365 |
| TRANSCRIPT | Transcript | professional |  | translation | MARK_SHEET, GRADE_SHEET, ACADEMIC_RECORD, ACADEMIC_TRANSCRIPT | bidesh365 |
| ENROLLMENT_LETTER | Enrollment Letter | study | 6 |  | ENROLLMENT_CERTIFICATE, STUDENT_STATUS_LETTER | bidesh365 |
| STUDENT_ID | Student ID Card | study |  |  | STUDENT_CARD | bidesh365 |
| ADMISSION_LETTER | Admission Letter | study |  |  | ACCEPTANCE_LETTER, OFFER_OF_ADMISSION | bidesh365 |
| SCHOLARSHIP_LETTER | Scholarship Letter | study |  |  | FINANCIAL_AID_LETTER | bidesh365 |
| FORM_I20 | Form I-20 | study |  |  | I_20 | bidesh365 |
| FORM_DS2019 | Form DS-2019 | study |  |  | DS_2019 | bidesh365 |
| CAS_STATEMENT | CAS Statement | study |  |  | CONFIRMATION_OF_ACCEPTANCE_FOR_STUDIES | bidesh365 |
| CONFIRMATION_OF_ENROLMENT | Confirmation of Enrolment | study |  |  | COE, COE_LETTER | bidesh365 |
| LANGUAGE_PROFICIENCY | Language Proficiency Certificate | professional | 24 |  | LANGUAGE_CERTIFICATE | bidesh365 |
| IELTS_CERTIFICATE | IELTS Certificate | professional | 24 |  | IELTS_TRF | bidesh365 |
| TOEFL_CERTIFICATE | TOEFL Certificate | professional | 24 |  | TOEFL_SCORE | bidesh365 |
| GMAT_GRE_SCORE | GMAT or GRE Score Report | professional | 60 |  | GMAT, GRE | bidesh365 |
| COURSE_COMPLETION | Course Completion | professional |  |  | COURSE_CERTIFICATE | bidesh365 |
| TRAINING_CERTIFICATE | Training Certificate | professional |  |  | TRAINING_COMPLETION | bidesh365 |
| THESIS | Thesis | professional |  |  |  | bidesh365 |
| RESEARCH_PUBLICATION | Research Publication | professional |  |  | PUBLISHED_RESEARCH | bidesh365 |
| RESEARCH_PROPOSAL | Research Proposal | study |  |  |  | bidesh365 |
| RECOMMENDATION_LETTER | Recommendation Letter | study |  |  | ACADEMIC_RECOMMENDATION | bidesh365 |
| SKILL_ASSESSMENT | Skill Assessment | professional |  |  | TRADE_ASSESSMENT | bidesh365 |
| QUALIFICATION_RECOGNITION | Qualification Recognition | professional |  |  | CREDENTIAL_EVALUATION, DEGREE_EQUIVALENCY | bidesh365 |
| PROFESSIONAL_LICENSE | Professional Licence | professional |  |  | PRACTICING_CERTIFICATE, PROFESSIONAL_LICENCE | bidesh365 |
| STUDY_GAP_EXPLANATION | Study Gap Explanation | study |  |  |  | proposed |
| SERVICE_BOND_AGREEMENT | Service Bond Agreement | study |  |  |  | proposed |
| OTHER_EDUCATION_DOCUMENT | Other Education or Qualification Document | (none) |  |  |  | owner_vision |

### Medical (16)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| APPROVED_MEDICAL_CENTRE_RESULT | Approved Medical Centre Result | labour_migration |  |  |  | proposed |
| MEDICAL_REPORT | Medical Report | medical | 6 |  | HEALTH_REPORT, MEDICAL_EXAM | bidesh365 |
| MEDICAL_CERTIFICATE | Medical Certificate | medical | 3 |  | HEALTH_CERTIFICATE | bidesh365 |
| VACCINATION_CERTIFICATE | Vaccination Certificate | medical |  |  | IMMUNIZATION_RECORD, VACCINE_CARD | bidesh365 |
| TB_TEST_CERTIFICATE | TB Test Certificate | medical | 6 |  | TUBERCULOSIS_TEST, CHEST_XRAY | bidesh365 |
| YELLOW_FEVER_CERTIFICATE | Yellow Fever Certificate | medical |  |  | ICV, YELLOW_CARD, YELLOW_FEVER_CARD | bidesh365 |
| COVID_CERTIFICATE | COVID-19 Certificate | medical |  |  | VACCINE_PASSPORT, COVID_TEST | bidesh365 |
| FIT_TO_TRAVEL | Fit to Travel Certificate | medical | 1 |  | TRAVEL_FITNESS, FITNESS_CERTIFICATE | bidesh365 |
| MEDICAL_INSURANCE | Medical Insurance | medical |  |  | HEALTH_INSURANCE | bidesh365 |
| DISABILITY_CERTIFICATE | Disability Certificate | medical |  |  | PWD_CERTIFICATE | bidesh365 |
| HOSPITAL_APPOINTMENT | Hospital Appointment | medical |  |  | MEDICAL_APPOINTMENT, TREATMENT_LETTER | bidesh365 |
| PRESCRIPTION | Prescription | medical |  |  |  | bidesh365 |
| MENTAL_HEALTH_CERTIFICATE | Mental Health Certificate | medical |  |  | MENTAL_HEALTH_CERT | bidesh365 |
| BLOOD_GROUP_CARD | Blood Group Card | medical |  |  |  | bidesh365 |
| ALLERGY_CARD | Allergy Card | medical |  |  |  | bidesh365 |
| OTHER_MEDICAL_DOCUMENT | Other Medical Document | (none) |  |  |  | owner_vision |

### Legal and Clearances (12)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| POLICE_CLEARANCE | Police Clearance | declarations | 6 | legalisation | PCC, GOOD_CONDUCT, CRIMINAL_RECORD_CHECK | bidesh365 |
| CHARACTER_CERTIFICATE | Character Certificate | declarations |  |  |  | bidesh365 |
| COURT_ORDER | Court Order | declarations |  | translation | COURT_JUDGMENT, LEGAL_ORDER | bidesh365 |
| LEGAL_DOCUMENT | Legal Document | declarations |  |  | LEGAL_PAPER | bidesh365 |
| POWER_OF_ATTORNEY | Power of Attorney | universal |  | notarisation | POA, ATTORNEY_LETTER | bidesh365 |
| AFFIDAVIT | Affidavit | universal |  | notarisation | SWORN_STATEMENT | bidesh365 |
| STATUTORY_DECLARATION | Statutory Declaration | universal |  | notarisation | STAT_DEC, LEGAL_DECLARATION | bidesh365 |
| NOC_GOVERNMENT | Government No Objection Letter | official_travel |  |  | GOVERNMENT_NOC, MINISTRY_NOC | bidesh365 |
| GO_LETTER | Government Order | official_travel |  |  | GO, OFFICIAL_ORDER, GOVERNMENT_ORDER | bidesh365 |
| DEPUTATION_ORDER | Deputation Order | official_travel |  |  | POSTING_ORDER | bidesh365 |
| MINISTRY_APPROVAL | Ministry Approval | official_travel |  |  | MINISTRY_CLEARANCE, MINISTRY_LETTER | bidesh365 |
| OTHER_LEGAL_DOCUMENT | Other Legal or Clearance Document | (none) |  |  |  | owner_vision |

### Family and Relationship (14)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| PARENTAL_CONSENT | Parental Consent | universal |  | notarisation | PARENT_PERMISSION, GUARDIAN_CONSENT, CONSENT_FORM | bidesh365 |
| MINOR_TRAVEL_CONSENT | Minor Travel Consent | universal |  |  |  | bidesh365 |
| FAMILY_REGISTER | Family Register | universal |  | translation | HOUSEHOLD_REGISTER, HUKOU, FAMILY_REGISTRATION | bidesh365 |
| CUSTODY_ORDER | Custody Order | universal |  |  | CUSTODY_AGREEMENT, CUSTODY_DOCUMENT | bidesh365 |
| RELATIONSHIP_PROOF | Relationship Proof | settle |  |  | RELATIONSHIP_EVIDENCE | bidesh365 |
| DEPENDENT_PROOF | Dependent Proof | universal |  |  | DEPENDENCY_PROOF, DEPENDENT_DOCUMENT | bidesh365 |
| SPOUSE_PASSPORT | Spouse Passport | universal |  |  | PARTNER_PASSPORT | bidesh365 |
| CHILD_BIRTH_CERTIFICATE | Child Birth Certificate | universal |  | translation |  | bidesh365 |
| PHOTO_FAMILY | Photo Family | settle |  |  | FAMILY_PHOTOGRAPH | bidesh365 |
| COMMUNICATION_RECORD | Communication Record | settle |  |  | CALL_HISTORY, MESSAGE_HISTORY | proposed |
| HOME_STUDY_REPORT | Home Study Report | settle |  |  |  | proposed |
| ANCESTOR_RECORD | Ancestor Civil Record | settle |  |  |  | proposed |
| CITIZENSHIP_TEST_RESULT | Citizenship Test Result | settle |  |  |  | proposed |
| OTHER_FAMILY_DOCUMENT | Other Family or Relationship Document | (none) |  |  |  | owner_vision |

### Accommodation and Host (11)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| INVITATION_LETTER | Invitation Letter | universal |  |  | HOST_LETTER | bidesh365 |
| HOST_ID | Host ID Card | universal |  |  | SPONSOR_ID | bidesh365 |
| HOST_PASSPORT | Host Passport | universal |  |  | SPONSOR_PASSPORT | bidesh365 |
| HOST_RESIDENCE_PROOF | Host Residence Proof | universal |  |  | HOST_ADDRESS_PROOF | bidesh365 |
| HOST_BANK_STATEMENT | Host Bank Statement | universal |  |  | SPONSOR_BANK_STATEMENT | bidesh365 |
| HOST_IMMIGRATION_STATUS_PROOF | Host Immigration Status Proof | universal |  |  |  | proposed |
| ACCOMMODATION_PROOF | Proof of Accommodation | universal |  |  | LODGING_PROOF | bidesh365 |
| ADDRESS_PROOF | Proof of Address | universal |  |  |  | bidesh365 |
| UTILITY_BILL | Utility Bill | universal |  |  |  | bidesh365 |
| RENTAL_AGREEMENT | Rental Agreement | universal |  |  | LEASE_AGREEMENT, TENANCY_AGREEMENT | bidesh365 |
| OTHER_ACCOMMODATION_DOCUMENT | Other Accommodation or Host Document | (none) |  |  |  | owner_vision |

### Application Forms and Receipts (15)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| VISA_APPLICATION_FORM | Visa Application Form | universal |  |  | VISA_APPLICATION, APPLICATION_FORM | bidesh365 |
| DS160_CONFIRMATION | DS-160 Confirmation | universal |  |  | DS160, DS_160, US_VISA_FORM | bidesh365 |
| FORM_14A | Form 14A | universal |  |  | SCHENGEN_FORM_14A | bidesh365 |
| SCHENGEN_APPLICATION | Schengen Visa Application | universal |  |  | SCHENGEN_FORM, EU_VISA_APPLICATION | bidesh365 |
| UK_VISA_APPLICATION | UK Visa Application | universal |  |  | UK_FORM | bidesh365 |
| CANADA_IMM_FORM | Canada IMM Application Form | universal |  |  | IMM_5257, CANADA_FORM | bidesh365 |
| AUSTRALIA_FORM_80 | Australia Form 80 | universal |  |  | FORM_80 | bidesh365 |
| APPLICATION_RECEIPT | Application Receipt | universal |  |  | ACKNOWLEDGEMENT_SLIP, TRACKING_SLIP | proposed |
| FEE_PAYMENT_RECEIPT | Fee Payment Receipt | universal |  |  |  | proposed |
| COURIER_TRACKING_SLIP | Courier Tracking Slip | universal |  |  |  | proposed |
| VISA_GRANT_NOTICE | Visa Grant Notice | universal |  |  | DECISION_NOTICE_GRANT | proposed |
| REFUSAL_LETTER | Refusal Letter | declarations |  |  | VISA_REFUSAL_NOTICE, DECISION_NOTICE_REFUSAL | proposed |
| VISA_CANCELLATION_NOTICE | Visa Cancellation Notice | declarations |  |  |  | proposed |
| APPEAL_DECISION | Appeal Decision | declarations |  |  |  | proposed |
| OTHER_APPLICATION_DOCUMENT | Other Application Form or Receipt | (none) |  |  |  | owner_vision |

### Photos and Biometrics (6)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| PHOTO | Photograph | universal | 6 |  | PASSPORT_PHOTO, VISA_PHOTO, PHOTOGRAPH, PHOTO_PASSPORT, PHOTO_VISA, PHOTO_ID | bidesh365 |
| SIGNATURE_SPECIMEN | Signature Specimen | universal |  |  |  | bidesh365 |
| BIOMETRIC_RECEIPT | Biometric Appointment Receipt | universal |  |  | BIOMETRIC_CONFIRMATION, FINGERPRINT_RECEIPT | bidesh365 |
| VFS_APPOINTMENT | Visa Centre Appointment | universal |  |  | VISA_APPOINTMENT, VFS_BOOKING | bidesh365 |
| EMBASSY_APPOINTMENT | Embassy Appointment | universal |  |  | CONSULATE_APPOINTMENT, INTERVIEW_APPOINTMENT | bidesh365 |
| OTHER_PHOTO_DOCUMENT | Other Photo or Biometric Document | (none) |  |  |  | owner_vision |

### Letters and Statements (6)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| COVER_LETTER | Cover Letter | universal |  |  | PERSONAL_STATEMENT, PURPOSE_LETTER | bidesh365 |
| STATEMENT_OF_PURPOSE | Statement of Purpose | universal |  |  | SOP | bidesh365 |
| EXPLANATION_LETTER | Explanation Letter | universal |  |  | CLARIFICATION_LETTER | bidesh365 |
| CURRICULUM_VITAE | Curriculum Vitae | universal |  |  | CV, RESUME | proposed |
| PILGRIMAGE_PACKAGE_CONFIRMATION | Pilgrimage Package Confirmation | official_travel |  |  |  | proposed |
| OTHER_LETTER | Other Letter or Statement | (none) |  |  |  | owner_vision |

### Translations and Legalisations (5)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| CERTIFIED_TRANSLATION | Certified Translation | universal |  |  | TRANSLATED_COPY | proposed |
| ATTESTATION_CERTIFICATE | Attestation Certificate | universal |  |  | ATTESTED_DOCUMENT | proposed |
| LEGALISATION_CERTIFICATE | Legalisation or Apostille Certificate | universal |  |  | APOSTILLE, LEGALIZATION_CERTIFICATE | proposed |
| NOTARIZED_DOCUMENT | Notarized Document | universal |  |  | NOTARISED_DOCUMENT | bidesh365 |
| OTHER_LEGALISATION_DOCUMENT | Other Translation or Legalisation Document | (none) |  |  |  | owner_vision |

### Other Documents (2)

| Key | Name | Pack | Valid for (months) | Needs | Aliases | Origin |
|---|---|---|---|---|---|---|
| INSURANCE | Insurance | (none) |  |  | INSURANCE_POLICY | bidesh365 |
| OTHER | Other Document | (none) |  |  | MISCELLANEOUS, SUPPORTING_DOCUMENT, MISC, SUPPLEMENTARY | bidesh365 |

## Fields added

Type is text or date. Records marked "extends" add fields to a record that is live today and keep its label and category. Every choice ends with Other and has a text box (named like the field plus _other) that opens beside it. Other Items are one optional free-entry record per category.

### Identity and Civil Status (129)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| middle_name | Middle Name | text | STANDARD | universal | names_and_birth | Section: Names | All purposes | bidesh365 |
| name_native_script | Full Name in Native Script | text | STANDARD | universal | names_and_birth | Section: Names | All purposes | bidesh365 |
| name_on_national_id | Name as on National ID | text | STANDARD | universal | names_and_birth | Section: Names | All purposes | bidesh365 |
| name_on_birth_certificate | Name as on Birth Certificate | text | STANDARD | universal | names_and_birth | Section: Names | All purposes | bidesh365 |
| birth_city | City or Town of Birth | text | STANDARD | universal | names_and_birth | Section: Birth | All purposes | bidesh365 |
| birth_district | District of Birth | text | STANDARD | universal | names_and_birth | Section: Birth | All purposes | bidesh365 |
| birth_country | Country of Birth | text | STANDARD | universal | names_and_birth | Section: Birth | All purposes | bidesh365 |
| nid_number | National ID Number | text | RESTRICTED | bangladesh | bangladesh_identifiers | Section: Bangladesh Identifiers | All purposes; BD | bidesh365 |
| birth_registration_number | Birth Registration Number | text | RESTRICTED | bangladesh | bangladesh_identifiers | Section: Bangladesh Identifiers | All purposes; BD | bidesh365 |
| tin_number | Tax Identification Number | text | RESTRICTED | bangladesh | bangladesh_identifiers | Section: Bangladesh Identifiers | All purposes; BD | bidesh365 |
| height_cm | Height in Centimetres | text | STANDARD | universal | physical_description | Section: Personal Details | All purposes | owner_vision |
| eye_colour | Eye Colour | text | STANDARD | universal | physical_description | Section: Personal Details | All purposes | owner_vision |
| hair_colour | Hair Colour | text | STANDARD | universal | physical_description | Section: Personal Details | All purposes | owner_vision |
| identifying_marks | Identifying Marks | text | STANDARD | universal | physical_description | Section: Personal Details | All purposes | owner_vision |
| alternate_phone | Alternate Phone | text | STANDARD | universal | physical_description | Section: Personal Details | All purposes | owner_vision |
| religion | Religion | text | RESTRICTED | declarations | sensitive_personal | Section: Special Category Details | All purposes | bidesh365 |
| interview_language | Interview Language | text | STANDARD | universal | needs_and_preferences | Section: Needs and Preferences | All purposes | owner_vision |
| interpreter_needed | Interpreter Needed | text | STANDARD | universal | needs_and_preferences | Section: Needs and Preferences | All purposes | owner_vision |
| preferred_countries | Preferred Countries | text | STANDARD | universal | needs_and_preferences | Section: Needs and Preferences | All purposes | owner_vision |
| preferred_timing | Preferred Travel Timing | text | STANDARD | universal | needs_and_preferences | Section: Needs and Preferences | All purposes | owner_vision |
| accessibility_needs | Accessibility and Special Assistance Needs | text | RESTRICTED | medical | accessibility_needs | Section: Accessibility | All purposes | owner_vision |
| previous_name_given | Given Name | text | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| previous_name_family | Family Name | text | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| previous_name_type | Name Type | text | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| previous_name_type_other | Other Name Type | text | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| previous_name_date_changed | Date Changed | date | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| previous_name_reason | Reason for Change | text | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| previous_name_country | Country of Change | text | STANDARD | universal | previous_names | Record: Previous Name | All purposes | bidesh365 |
| nationality_record_country | Country | text | STANDARD | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| nationality_record_how_acquired | How Acquired | text | STANDARD | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| nationality_record_how_acquired_other | Other How Acquired | text | STANDARD | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| nationality_record_acquired_date | Date Acquired | date | STANDARD | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| nationality_record_renounced_date | Date Renounced | date | STANDARD | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| nationality_record_is_current | Currently Held | text | STANDARD | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| nationality_record_certificate_number | Certificate Number | text | SENSITIVE | universal | nationality_history | Record: Nationality Record | All purposes | bidesh365 |
| national_id_type | Identity Type | text | STANDARD | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| national_id_type_other | Other Identity Type | text | STANDARD | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| national_id_number | Identity Number | text | RESTRICTED | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| national_id_country | Country | text | STANDARD | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| national_id_issue_date | Issue Date | date | STANDARD | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| national_id_expiry_date | Expiry Date | date | STANDARD | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| national_id_issuing_authority | Issuing Authority | text | STANDARD | country_ids | foreign_identity_records | Record: National Identity Record | All purposes | bidesh365 |
| biometric_appointment_type | Biometric Type | text | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_type_other | Other Biometric Type | text | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_date | Collection Date | date | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_location | Collection Location | text | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_country | Country | text | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_centre | Application Centre | text | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_reference_number | Reference Number | text | SENSITIVE | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_expiry_date | Expiry Date | date | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| biometric_appointment_purpose | Purpose | text | STANDARD | universal | biometric_appointments | Record: Biometric Appointment | All purposes | bidesh365 |
| email_history_email | Email | text | STANDARD | universal | contact_history | Record: Email History | All purposes | bidesh365 |
| email_history_provider | Provider | text | STANDARD | universal | contact_history | Record: Email History | All purposes | bidesh365 |
| email_history_used_from | Used From | date | STANDARD | universal | contact_history | Record: Email History | All purposes | bidesh365 |
| email_history_used_until | Used Until | date | STANDARD | universal | contact_history | Record: Email History | All purposes | bidesh365 |
| email_history_purpose | Used For | text | STANDARD | universal | contact_history | Record: Email History | All purposes | bidesh365 |
| email_history_purpose_other | Other Used For | text | STANDARD | universal | contact_history | Record: Email History | All purposes | bidesh365 |
| phone_history_number | Phone Number | text | STANDARD | universal | contact_history | Record: Phone History | All purposes | bidesh365 |
| phone_history_country_code | Country Code | text | STANDARD | universal | contact_history | Record: Phone History | All purposes | bidesh365 |
| phone_history_type | Phone Type | text | STANDARD | universal | contact_history | Record: Phone History | All purposes | bidesh365 |
| phone_history_type_other | Other Phone Type | text | STANDARD | universal | contact_history | Record: Phone History | All purposes | bidesh365 |
| phone_history_used_from | Used From | date | STANDARD | universal | contact_history | Record: Phone History | All purposes | bidesh365 |
| phone_history_used_until | Used Until | date | STANDARD | universal | contact_history | Record: Phone History | All purposes | bidesh365 |
| online_account_platform | Platform | text | STANDARD | universal | online_accounts | Record: Online Account | All purposes | bidesh365 |
| online_account_handle | Username or Handle | text | STANDARD | universal | online_accounts | Record: Online Account | All purposes | bidesh365 |
| online_account_profile_url | Profile Link | text | STANDARD | universal | online_accounts | Record: Online Account | All purposes | bidesh365 |
| online_account_since_year | Used Since (Year) | text | STANDARD | universal | online_accounts | Record: Online Account | All purposes | bidesh365 |
| online_account_used_last_five_years | Used in the Last Five Years | text | STANDARD | universal | online_accounts | Record: Online Account | All purposes | bidesh365 |
| marital_status_other | Other Marital Status | text | STANDARD | universal | identity_basics | Section: Other Marital Status | All purposes | visastack |
| other_item_universal_section | Section | text | STANDARD | universal | other_items | Record: Other Item (Universal) | All purposes | owner_vision |
| other_item_universal_title | What It Is | text | STANDARD | universal | other_items | Record: Other Item (Universal) | All purposes | owner_vision |
| other_item_universal_details | Details or Value | text | STANDARD | universal | other_items | Record: Other Item (Universal) | All purposes | owner_vision |
| other_item_universal_date | Date | date | STANDARD | universal | other_items | Record: Other Item (Universal) | All purposes | owner_vision |
| other_item_universal_note | Note | text | STANDARD | universal | other_items | Record: Other Item (Universal) | All purposes | owner_vision |
| other_item_professional_section | Section | text | STANDARD | professional | other_items | Record: Other Item (Professional) | All purposes | owner_vision |
| other_item_professional_title | What It Is | text | STANDARD | professional | other_items | Record: Other Item (Professional) | All purposes | owner_vision |
| other_item_professional_details | Details or Value | text | STANDARD | professional | other_items | Record: Other Item (Professional) | All purposes | owner_vision |
| other_item_professional_date | Date | date | STANDARD | professional | other_items | Record: Other Item (Professional) | All purposes | owner_vision |
| other_item_professional_note | Note | text | STANDARD | professional | other_items | Record: Other Item (Professional) | All purposes | owner_vision |
| other_item_business_section | Section | text | STANDARD | business | other_items | Record: Other Item (Business) | All purposes | owner_vision |
| other_item_business_title | What It Is | text | STANDARD | business | other_items | Record: Other Item (Business) | All purposes | owner_vision |
| other_item_business_details | Details or Value | text | STANDARD | business | other_items | Record: Other Item (Business) | All purposes | owner_vision |
| other_item_business_date | Date | date | STANDARD | business | other_items | Record: Other Item (Business) | All purposes | owner_vision |
| other_item_business_note | Note | text | STANDARD | business | other_items | Record: Other Item (Business) | All purposes | owner_vision |
| other_item_medical_section | Section | text | STANDARD | medical | other_items | Record: Other Item (Medical) | All purposes | owner_vision |
| other_item_medical_title | What It Is | text | STANDARD | medical | other_items | Record: Other Item (Medical) | All purposes | owner_vision |
| other_item_medical_details | Details or Value | text | RESTRICTED | medical | other_items | Record: Other Item (Medical) | All purposes | owner_vision |
| other_item_medical_date | Date | date | STANDARD | medical | other_items | Record: Other Item (Medical) | All purposes | owner_vision |
| other_item_medical_note | Note | text | RESTRICTED | medical | other_items | Record: Other Item (Medical) | All purposes | owner_vision |
| other_item_medical_attendant_section | Section | text | STANDARD | medical_attendant | other_items | Record: Other Item (Medical Attendant) | All purposes | owner_vision |
| other_item_medical_attendant_title | What It Is | text | STANDARD | medical_attendant | other_items | Record: Other Item (Medical Attendant) | All purposes | owner_vision |
| other_item_medical_attendant_details | Details or Value | text | STANDARD | medical_attendant | other_items | Record: Other Item (Medical Attendant) | All purposes | owner_vision |
| other_item_medical_attendant_date | Date | date | STANDARD | medical_attendant | other_items | Record: Other Item (Medical Attendant) | All purposes | owner_vision |
| other_item_medical_attendant_note | Note | text | STANDARD | medical_attendant | other_items | Record: Other Item (Medical Attendant) | All purposes | owner_vision |
| other_item_declarations_section | Section | text | STANDARD | declarations | other_items | Record: Other Item (Declarations) | All purposes | owner_vision |
| other_item_declarations_title | What It Is | text | STANDARD | declarations | other_items | Record: Other Item (Declarations) | All purposes | owner_vision |
| other_item_declarations_details | Details or Value | text | RESTRICTED | declarations | other_items | Record: Other Item (Declarations) | All purposes | owner_vision |
| other_item_declarations_date | Date | date | STANDARD | declarations | other_items | Record: Other Item (Declarations) | All purposes | owner_vision |
| other_item_declarations_note | Note | text | RESTRICTED | declarations | other_items | Record: Other Item (Declarations) | All purposes | owner_vision |
| other_item_study_section | Section | text | STANDARD | study | other_items | Record: Other Item (Study) | All purposes | owner_vision |
| other_item_study_title | What It Is | text | STANDARD | study | other_items | Record: Other Item (Study) | All purposes | owner_vision |
| other_item_study_details | Details or Value | text | STANDARD | study | other_items | Record: Other Item (Study) | All purposes | owner_vision |
| other_item_study_date | Date | date | STANDARD | study | other_items | Record: Other Item (Study) | All purposes | owner_vision |
| other_item_study_note | Note | text | STANDARD | study | other_items | Record: Other Item (Study) | All purposes | owner_vision |
| other_item_settle_section | Section | text | STANDARD | settle | other_items | Record: Other Item (Settle) | All purposes | owner_vision |
| other_item_settle_title | What It Is | text | STANDARD | settle | other_items | Record: Other Item (Settle) | All purposes | owner_vision |
| other_item_settle_details | Details or Value | text | STANDARD | settle | other_items | Record: Other Item (Settle) | All purposes | owner_vision |
| other_item_settle_date | Date | date | STANDARD | settle | other_items | Record: Other Item (Settle) | All purposes | owner_vision |
| other_item_settle_note | Note | text | STANDARD | settle | other_items | Record: Other Item (Settle) | All purposes | owner_vision |
| other_item_labour_migration_section | Section | text | STANDARD | labour_migration | other_items | Record: Other Item (Labour Migration) | All purposes | owner_vision |
| other_item_labour_migration_title | What It Is | text | STANDARD | labour_migration | other_items | Record: Other Item (Labour Migration) | All purposes | owner_vision |
| other_item_labour_migration_details | Details or Value | text | SENSITIVE | labour_migration | other_items | Record: Other Item (Labour Migration) | All purposes | owner_vision |
| other_item_labour_migration_date | Date | date | STANDARD | labour_migration | other_items | Record: Other Item (Labour Migration) | All purposes | owner_vision |
| other_item_labour_migration_note | Note | text | SENSITIVE | labour_migration | other_items | Record: Other Item (Labour Migration) | All purposes | owner_vision |
| other_item_official_travel_section | Section | text | STANDARD | official_travel | other_items | Record: Other Item (Official Travel) | All purposes | owner_vision |
| other_item_official_travel_title | What It Is | text | STANDARD | official_travel | other_items | Record: Other Item (Official Travel) | All purposes | owner_vision |
| other_item_official_travel_details | Details or Value | text | STANDARD | official_travel | other_items | Record: Other Item (Official Travel) | All purposes | owner_vision |
| other_item_official_travel_date | Date | date | STANDARD | official_travel | other_items | Record: Other Item (Official Travel) | All purposes | owner_vision |
| other_item_official_travel_note | Note | text | STANDARD | official_travel | other_items | Record: Other Item (Official Travel) | All purposes | owner_vision |
| other_item_bangladesh_section | Section | text | STANDARD | bangladesh | other_items | Record: Other Item (Bangladesh) | All purposes | owner_vision |
| other_item_bangladesh_title | What It Is | text | STANDARD | bangladesh | other_items | Record: Other Item (Bangladesh) | All purposes | owner_vision |
| other_item_bangladesh_details | Details or Value | text | RESTRICTED | bangladesh | other_items | Record: Other Item (Bangladesh) | All purposes | owner_vision |
| other_item_bangladesh_date | Date | date | STANDARD | bangladesh | other_items | Record: Other Item (Bangladesh) | All purposes | owner_vision |
| other_item_bangladesh_note | Note | text | RESTRICTED | bangladesh | other_items | Record: Other Item (Bangladesh) | All purposes | owner_vision |
| other_item_country_ids_section | Section | text | STANDARD | country_ids | other_items | Record: Other Item (Country Identifiers) | All purposes | owner_vision |
| other_item_country_ids_title | What It Is | text | STANDARD | country_ids | other_items | Record: Other Item (Country Identifiers) | All purposes | owner_vision |
| other_item_country_ids_details | Details or Value | text | RESTRICTED | country_ids | other_items | Record: Other Item (Country Identifiers) | All purposes | owner_vision |
| other_item_country_ids_date | Date | date | STANDARD | country_ids | other_items | Record: Other Item (Country Identifiers) | All purposes | owner_vision |
| other_item_country_ids_note | Note | text | RESTRICTED | country_ids | other_items | Record: Other Item (Country Identifiers) | All purposes | owner_vision |

### Travel Documents (37)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| passport_type | Passport Type | text | STANDARD | universal | passport_extras | Section: Current Passport Details | All purposes | bidesh365 |
| passport_type_other | Other Passport Type | text | STANDARD | universal | passport_extras | Section: Current Passport Details | All purposes | bidesh365 |
| passport_place_of_issue | Passport Place of Issue | text | STANDARD | universal | passport_extras | Section: Current Passport Details | All purposes | bidesh365 |
| passport_issuing_authority | Passport Issuing Authority | text | STANDARD | universal | passport_extras | Section: Current Passport Details | All purposes | bidesh365 |
| passport_chip_present | Passport Has Electronic Chip | text | STANDARD | universal | passport_extras | Section: Current Passport Details | All purposes | bidesh365 |
| passport_incident_type | Incident Type | text | STANDARD | universal | passport_extras | Record: Passport Incident | All purposes | bidesh365 |
| passport_incident_type_other | Other Incident Type | text | STANDARD | universal | passport_extras | Record: Passport Incident | All purposes | bidesh365 |
| passport_incident_date | Incident Date | date | STANDARD | universal | passport_extras | Record: Passport Incident | All purposes | bidesh365 |
| passport_incident_police_report_number | Police Report Number | text | SENSITIVE | universal | passport_extras | Record: Passport Incident | All purposes | bidesh365 |
| passport_incident_replacement_passport_number | Replacement Passport Number | text | SENSITIVE | universal | passport_extras | Record: Passport Incident | All purposes | bidesh365 |
| passport_incident_notes | Notes | text | STANDARD | universal | passport_extras | Record: Passport Incident | All purposes | bidesh365 |
| prior_visa_category | Visa Category | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_application_date | Application Date | date | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_issue_date | Issue Date | date | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_expiry_date | Expiry Date | date | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_entries_allowed | Entries Allowed | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_entries_allowed_other | Other Entries Allowed | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_duration_of_stay | Duration of Stay | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_issuing_post | Issuing Post | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_status | Visa Status | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| prior_visa_status_other | Other Visa Status | text | STANDARD | universal | prior_visa_details | Extends record: prior_visa | All purposes | bidesh365 |
| immigration_status_country | Country | text | STANDARD | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| immigration_status_status | Status | text | STANDARD | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| immigration_status_status_other | Other Status | text | STANDARD | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| immigration_status_permit_number | Permit Number | text | SENSITIVE | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| immigration_status_permit_type | Permit Type | text | STANDARD | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| immigration_status_valid_from | Valid From | date | STANDARD | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| immigration_status_expiry_date | Expiry Date | date | STANDARD | universal | immigration_status | Record: Immigration Status | All purposes | bidesh365 |
| travel_insurance_provider | Provider | text | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_policy_number | Policy Number | text | SENSITIVE | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_coverage_amount | Coverage Amount | text | SENSITIVE | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_coverage_currency | Coverage Currency | text | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_coverage_currency_other | Other Coverage Currency | text | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_valid_from | Valid From | date | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_valid_until | Valid Until | date | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_coverage_countries | Countries Covered | text | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |
| travel_insurance_repatriation_covered | Repatriation Covered | text | STANDARD | universal | travel_insurance | Record: Travel Insurance | All purposes | bidesh365 |

### Timelines (61)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| address_line_two | Address Line Two | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_state_province | State or Province | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_postal_code | Postal Code | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_thana | Thana or Upazila | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_district | District | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_division | Division | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_residence_type | Residence Type | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_residence_type_other | Other Residence Type | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_landlord_name | Landlord Name | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_landlord_phone | Landlord Phone | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_rent_amount | Rent Amount | text | SENSITIVE | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_rent_currency | Rent Currency | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| address_rent_currency_other | Other Rent Currency | text | STANDARD | universal | address_details | Extends record: address | All purposes | bidesh365 |
| employer_business_type | Employer Business Type | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_address | Employer Address | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_city | Employer City | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_phone | Employer Phone | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_website | Employer Website | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_department | Department | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_employment_type | Employment Type | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_duties | Duties | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_supervisor_name | Supervisor Name | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_supervisor_phone | Supervisor Phone | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_supervisor_email | Supervisor Email | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_salary | Gross Monthly Salary | text | SENSITIVE | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_salary_currency | Salary Currency | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_salary_currency_other | Other Salary Currency | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employer_benefits_summary | Other Benefits | text | STANDARD | professional | employment_details | Extends record: employment_history | All purposes | bidesh365 |
| employment_gap_start | Start Date | date | STANDARD | professional | employment_gaps | Record: Employment Gap | All purposes | bidesh365 |
| employment_gap_end | End Date | date | STANDARD | professional | employment_gaps | Record: Employment Gap | All purposes | bidesh365 |
| employment_gap_reason | Reason | text | STANDARD | professional | employment_gaps | Record: Employment Gap | All purposes | bidesh365 |
| employment_gap_reason_other | Other Reason | text | STANDARD | professional | employment_gaps | Record: Employment Gap | All purposes | bidesh365 |
| employment_gap_explanation | Explanation | text | STANDARD | professional | employment_gaps | Record: Employment Gap | All purposes | bidesh365 |
| travel_entry_date | Entry Date | date | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| travel_exit_date | Exit Date | date | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| travel_port_of_entry | Port of Entry | text | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| travel_port_of_exit | Port of Exit | text | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| travel_duration_days | Duration in Days | text | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| travel_visa_used | Visa Used | text | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| travel_trip_notes | Trip Notes | text | STANDARD | universal | travel_details | Extends record: travel_history | All purposes | bidesh365 |
| application_record_destination_country | Destination Country | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_type | Application Type | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_number | Application Number | text | SENSITIVE | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_tracking_number | Tracking Number | text | SENSITIVE | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_submitted_date | Submitted Date | date | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_fee_paid | Fee Paid | text | SENSITIVE | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_fee_currency | Fee Currency | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_fee_currency_other | Other Fee Currency | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_appointment_date | Appointment Date | date | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_biometrics_done | Biometrics Done | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_courier_tracking_number | Courier Tracking Number | text | SENSITIVE | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_decision | Decision | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_decision_other | Other Decision | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_decision_date | Decision Date | date | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_valid_from | Valid From | date | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_valid_until | Valid Until | date | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_conditions | Conditions | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_originals_location | Where Originals Are Kept | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| application_record_certified_copies_count | Certified Copies Held | text | STANDARD | universal | applications_and_decisions | Record: Application Record | All purposes | owner_vision |
| monthly_salary_currency_other | Other Monthly Salary Currency | text | STANDARD | professional | employment | Section: Other Salary Currency | All purposes | visastack |
| self_employment_income_currency_other | Other Self-Employment Income Currency | text | STANDARD | professional | self_employment | Section: Other Self-Employment Currency | All purposes | visastack |

### Money (76)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| tax_zone | Tax Zone | text | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_circle | Tax Circle | text | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| last_tax_year | Last Tax Year Filed | text | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_assessment_year | Assessment Year | text | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_ack_slip_number | Tax Acknowledgement Slip Number | text | SENSITIVE | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_ack_slip_date | Tax Acknowledgement Slip Date | date | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_paid_amount | Tax Paid | text | SENSITIVE | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_paid_currency | Tax Paid Currency | text | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_paid_currency_other | Other Tax Paid Currency | text | STANDARD | bangladesh | bangladesh_tax | Section: Bangladesh Tax Details | All purposes; BD | bidesh365 |
| tax_return_year | Tax Year | text | STANDARD | universal | tax_returns | Record: Tax Return | All purposes | owner_vision |
| tax_return_country | Country | text | STANDARD | universal | tax_returns | Record: Tax Return | All purposes | owner_vision |
| tax_return_income_declared | Income Declared | text | SENSITIVE | universal | tax_returns | Record: Tax Return | All purposes | owner_vision |
| tax_return_income_currency | Income Currency | text | STANDARD | universal | tax_returns | Record: Tax Return | All purposes | owner_vision |
| tax_return_income_currency_other | Other Income Currency | text | STANDARD | universal | tax_returns | Record: Tax Return | All purposes | owner_vision |
| tax_return_acknowledgement_number | Acknowledgement Number | text | SENSITIVE | universal | tax_returns | Record: Tax Return | All purposes | owner_vision |
| income_source_type | Source Type | text | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_type_other | Other Source Type | text | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_description | Description | text | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_annual_amount | Annual Amount | text | SENSITIVE | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_currency | Currency | text | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_currency_other | Other Currency | text | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_is_regular | Regular Income | text | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| income_source_since | Since | date | STANDARD | universal | income_sources | Record: Income Source | All purposes | bidesh365 |
| bank_account_bank_name | Bank Name | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_branch | Branch | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_type | Account Type | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_type_other | Other Account Type | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_holder_name | Account Holder | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_number_last_four | Account Number (Last Four Digits) | text | SENSITIVE | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_opened_on | Opened On | date | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_balance | Current Balance | text | SENSITIVE | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_currency | Currency | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_currency_other | Other Currency | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_average_balance | Average Balance (Six Months) | text | SENSITIVE | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_average_currency | Average Balance Currency | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_average_currency_other | Other Average Balance Currency | text | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| bank_account_balance_date | Balance Date | date | STANDARD | universal | accounts_assets_loans | Record: Bank Account | All purposes | bidesh365 |
| asset_type | Asset Type | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_type_other | Other Asset Type | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_description | Description | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_country | Country | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_location | Location | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_ownership_share | Ownership Share | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_value | Estimated Value | text | SENSITIVE | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_currency | Currency | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_currency_other | Other Currency | text | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_maturity_date | Maturity Date | date | STANDARD | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| asset_reference_number | Reference Number | text | SENSITIVE | universal | accounts_assets_loans | Record: Asset | All purposes | bidesh365 |
| liability_type | Liability Type | text | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_type_other | Other Liability Type | text | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_lender | Lender | text | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_principal | Original Amount | text | SENSITIVE | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_currency | Currency | text | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_currency_other | Other Currency | text | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_outstanding_balance | Outstanding Balance | text | SENSITIVE | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_monthly_payment | Monthly Payment | text | SENSITIVE | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_start_date | Start Date | date | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| liability_end_date | End Date | date | STANDARD | universal | accounts_assets_loans | Record: Loan or Liability | All purposes | bidesh365 |
| funding_plan_payer_name | Payer Name | text | STANDARD | universal | funding_and_costs | Record: Funding Plan | All purposes | owner_vision |
| funding_plan_payer_relationship | Payer Relationship | text | STANDARD | universal | funding_and_costs | Record: Funding Plan | All purposes | owner_vision |
| funding_plan_amount | Amount | text | SENSITIVE | universal | funding_and_costs | Record: Funding Plan | All purposes | owner_vision |
| funding_plan_currency | Currency | text | STANDARD | universal | funding_and_costs | Record: Funding Plan | All purposes | owner_vision |
| funding_plan_currency_other | Other Currency | text | STANDARD | universal | funding_and_costs | Record: Funding Plan | All purposes | owner_vision |
| funding_plan_source | Source of Funds | text | STANDARD | universal | funding_and_costs | Record: Funding Plan | All purposes | owner_vision |
| large_deposit_date | Deposit Date | date | STANDARD | universal | funding_and_costs | Record: Large Deposit Explanation | All purposes | owner_vision |
| large_deposit_amount | Deposit Amount | text | SENSITIVE | universal | funding_and_costs | Record: Large Deposit Explanation | All purposes | owner_vision |
| large_deposit_currency | Currency | text | STANDARD | universal | funding_and_costs | Record: Large Deposit Explanation | All purposes | owner_vision |
| large_deposit_currency_other | Other Currency | text | STANDARD | universal | funding_and_costs | Record: Large Deposit Explanation | All purposes | owner_vision |
| large_deposit_explanation | Explanation | text | STANDARD | universal | funding_and_costs | Record: Large Deposit Explanation | All purposes | owner_vision |
| plan_cost_item | Cost Item | text | STANDARD | universal | funding_and_costs | Record: Plan Cost | All purposes | owner_vision |
| plan_cost_item_other | Other Cost Item | text | STANDARD | universal | funding_and_costs | Record: Plan Cost | All purposes | owner_vision |
| plan_cost_amount | Amount | text | SENSITIVE | universal | funding_and_costs | Record: Plan Cost | All purposes | owner_vision |
| plan_cost_currency | Currency | text | STANDARD | universal | funding_and_costs | Record: Plan Cost | All purposes | owner_vision |
| plan_cost_currency_other | Other Currency | text | STANDARD | universal | funding_and_costs | Record: Plan Cost | All purposes | owner_vision |
| plan_cost_paid | Paid | text | STANDARD | universal | funding_and_costs | Record: Plan Cost | All purposes | owner_vision |
| annual_income_currency_other | Other Annual Income Currency | text | STANDARD | universal | income_and_funding | Section: Other Income Currency | All purposes | visastack |

### People (109)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| spouse_name | Spouse or Partner Name | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_date_of_birth | Spouse or Partner Date of Birth | date | SENSITIVE | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_birth_place | Spouse or Partner Place of Birth | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_birth_country | Spouse or Partner Country of Birth | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_nationality | Spouse or Partner Nationality | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_passport_number | Spouse or Partner Passport Number | text | SENSITIVE | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_employment_status | Spouse or Partner Employment Status | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_employer_name | Spouse or Partner Employer | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| spouse_address_if_different | Spouse or Partner Address if Different | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| marriage_date | Marriage Date | date | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| marriage_place | Marriage Place | text | STANDARD | universal | spouse_and_parents | Section: Spouse or Partner | All purposes | bidesh365 |
| father_name | Father Name | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| mother_name | Mother Name | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| father_date_of_birth | Father Date of Birth | date | SENSITIVE | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| mother_date_of_birth | Mother Date of Birth | date | SENSITIVE | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| father_birth_country | Father Country of Birth | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| mother_birth_country | Mother Country of Birth | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| father_nationality | Father Nationality | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| mother_nationality | Mother Nationality | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| father_occupation | Father Occupation | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| mother_occupation | Mother Occupation | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| father_deceased | Father Deceased | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| mother_deceased | Mother Deceased | text | STANDARD | universal | spouse_and_parents | Section: Parents | All purposes | bidesh365 |
| family_member_relationship | Relationship | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_relationship_other | Other Relationship | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_full_name | Full Name | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_date_of_birth | Date of Birth | date | SENSITIVE | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_place_of_birth | Place of Birth | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_country_of_birth | Country of Birth | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_nationality | Nationality | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_current_country | Country of Residence | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_current_city | City of Residence | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_address | Address | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_occupation | Occupation | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_employer_name | Employer | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_is_deceased | Deceased | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_death_date | Date of Death | date | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_is_accompanying | Travelling With You | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_passport_number | Passport Number | text | SENSITIVE | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| family_member_legal_status_abroad | Legal Status if Abroad | text | STANDARD | universal | family_members | Record: Family Member | All purposes | bidesh365 |
| dependant_birth_country | Country of Birth | text | STANDARD | universal | dependant_details | Extends record: dependant | All purposes | bidesh365 |
| dependant_custody_arrangements | Custody Arrangements | text | STANDARD | universal | dependant_details | Extends record: dependant | All purposes | bidesh365 |
| dependant_is_financially_dependent | Financially Dependent | text | STANDARD | universal | dependant_details | Extends record: dependant | All purposes | bidesh365 |
| dependant_is_accompanying | Travelling With You | text | STANDARD | universal | dependant_details | Extends record: dependant | All purposes | bidesh365 |
| dependant_passport_number | Passport Number | text | SENSITIVE | universal | dependant_details | Extends record: dependant | All purposes | bidesh365 |
| sponsor_type | Sponsor Type | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_type_other | Other Sponsor Type | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_organisation | Organisation | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_country | Country | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_occupation | Occupation | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_identity_number | Identity Number | text | RESTRICTED | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_annual_income | Annual Income | text | SENSITIVE | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_annual_income_currency | Annual Income Currency | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_annual_income_currency_other | Other Annual Income Currency | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_support_amount | Support Amount | text | SENSITIVE | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_support_currency | Support Currency | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_support_currency_other | Other Support Currency | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_support_period | Support Period | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| sponsor_undertaking_signed | Undertaking Signed | text | STANDARD | universal | sponsor_details | Extends record: sponsor | All purposes | bidesh365 |
| inviter_letter_type | Invitation Type | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_letter_type_other | Other Invitation Type | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_name | Name | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_organisation | Organisation | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_address | Address | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_country | Country | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_phone | Phone | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_email | Email | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_relationship | Relationship to You | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_occupation | Occupation | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_immigration_status | Immigration Status There | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_annual_income | Annual Income | text | SENSITIVE | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_annual_income_currency | Annual Income Currency | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_annual_income_currency_other | Other Annual Income Currency | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_visit_purpose | Visit Purpose | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_arrival_date | Intended Arrival Date | date | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_departure_date | Intended Departure Date | date | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_accommodation_provided | Accommodation Provided | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_accommodation_address | Accommodation Address | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_financial_support_provided | Financial Support Provided | text | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| inviter_letter_date | Letter Date | date | STANDARD | universal | hosts_and_inviters | Record: Host or Inviter | All purposes | bidesh365 |
| referee_name | Name | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_relationship | Relationship | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_occupation | Occupation | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_organisation | Organisation | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_address | Address | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_phone | Phone | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_email | Email | text | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| referee_letter_date | Letter Date | date | STANDARD | universal | referees_and_guardians | Record: Referee or Guarantor | All purposes | bidesh365 |
| guardian_name | Name | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| guardian_relationship | Relationship | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| guardian_address | Address | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| guardian_phone | Phone | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| guardian_email | Email | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| guardian_custody_arrangement | Custody Arrangement | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| guardian_consent_given | Travel Consent Given | text | STANDARD | universal | referees_and_guardians | Record: Guardian | All purposes | owner_vision |
| travel_companion_name | Name | text | STANDARD | universal | travel_companions | Record: Travel Companion | All purposes | bidesh365 |
| travel_companion_relationship | Relationship | text | STANDARD | universal | travel_companions | Record: Travel Companion | All purposes | bidesh365 |
| travel_companion_date_of_birth | Date of Birth | date | SENSITIVE | universal | travel_companions | Record: Travel Companion | All purposes | bidesh365 |
| travel_companion_travelling_with_you | Travelling With You | text | STANDARD | universal | travel_companions | Record: Travel Companion | All purposes | bidesh365 |
| home_tie_type | Tie Type | text | STANDARD | universal | ties_to_home | Record: Tie to Home Country | All purposes | owner_vision |
| home_tie_type_other | Other Tie Type | text | STANDARD | universal | ties_to_home | Record: Tie to Home Country | All purposes | owner_vision |
| home_tie_description | Description | text | STANDARD | universal | ties_to_home | Record: Tie to Home Country | All purposes | owner_vision |
| home_tie_country | Country | text | STANDARD | universal | ties_to_home | Record: Tie to Home Country | All purposes | owner_vision |
| home_tie_since | Since | date | STANDARD | universal | ties_to_home | Record: Tie to Home Country | All purposes | owner_vision |
| home_tie_leave_approved_until | Leave Approved Until | date | STANDARD | universal | ties_to_home | Record: Tie to Home Country | All purposes | owner_vision |
| emergency_contact_name | Emergency Contact Name | text | STANDARD | universal | emergency_contact | Section: Emergency Contact | All purposes | bidesh365 |
| emergency_contact_relationship | Emergency Contact Relationship | text | STANDARD | universal | emergency_contact | Section: Emergency Contact | All purposes | bidesh365 |
| emergency_contact_phone | Emergency Contact Phone | text | STANDARD | universal | emergency_contact | Section: Emergency Contact | All purposes | bidesh365 |
| emergency_contact_address | Emergency Contact Address | text | STANDARD | universal | emergency_contact | Section: Emergency Contact | All purposes | bidesh365 |

### Declarations and History (106)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| refusal_visa_type | Visa Type Applied For | text | STANDARD | universal | refusal_details | Extends record: visa_refusal | All purposes | bidesh365 |
| refusal_appeal_filed | Appeal Filed | text | STANDARD | universal | refusal_details | Extends record: visa_refusal | All purposes | bidesh365 |
| refusal_appeal_outcome | Appeal Outcome | text | STANDARD | universal | refusal_details | Extends record: visa_refusal | All purposes | bidesh365 |
| refusal_appeal_outcome_other | Other Appeal Outcome | text | STANDARD | universal | refusal_details | Extends record: visa_refusal | All purposes | bidesh365 |
| immigration_incident_type | Incident Type | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_type_other | Other Incident Type | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_country | Country | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_date | Incident Date | date | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_visa_type | Visa Type | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_reason | Reason Given | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_port_of_entry | Port of Entry | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_days_overstayed | Days Overstayed | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_voluntary_departure | Voluntary Departure | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_appeal_filed | Appeal Filed | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_appeal_outcome | Appeal Outcome | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_appeal_outcome_other | Other Appeal Outcome | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_ban_imposed | Ban Imposed | text | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| immigration_incident_ban_end_date | Ban End Date | date | RESTRICTED | declarations | immigration_history | Record: Immigration Incident | All purposes | bidesh365 |
| travel_ban_country | Banning Country | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_type | Ban Type | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_type_other | Other Ban Type | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_start_date | Ban Start Date | date | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_end_date | Ban End Date | date | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_is_permanent | Permanent Ban | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_reason | Ban Reason | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_appeal_status | Appeal Status | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| travel_ban_appeal_status_other | Other Appeal Status | text | RESTRICTED | declarations | immigration_history | Record: Travel Ban | All purposes | bidesh365 |
| criminal_record_offence_type | Offence Type | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_offence_date | Offence Date | date | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_country | Country | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_city | City | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_court_name | Court | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_case_number | Case Number | text | SENSITIVE | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_outcome | Outcome | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_outcome_other | Other Outcome | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_sentence | Sentence | text | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| criminal_record_sentence_completed_date | Sentence Completed Date | date | RESTRICTED | declarations | legal_history | Record: Criminal Record | All purposes | bidesh365 |
| driving_violation_type | Violation Type | text | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_date | Violation Date | date | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_country | Country | text | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_state_province | State or Province | text | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_licence_suspended | Licence Suspended | text | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_suspension_period | Suspension Period | text | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_fine_amount | Fine Amount | text | SENSITIVE | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_fine_currency | Fine Currency | text | STANDARD | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_fine_currency_other | Other Fine Currency | text | STANDARD | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| driving_violation_points_deducted | Points Deducted | text | RESTRICTED | declarations | legal_history | Record: Driving Violation | All purposes | bidesh365 |
| military_service_country | Country | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_branch | Branch | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_rank | Rank Achieved | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_service_number | Service Number | text | SENSITIVE | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_start_date | Start Date | date | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_end_date | End Date | date | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_discharge_type | Discharge Type | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_discharge_type_other | Other Discharge Type | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_specialisation | Specialisation | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_combat_service | Combat Service | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| military_service_combat_locations | Combat Locations | text | RESTRICTED | declarations | military_and_memberships | Record: Military Service | All purposes | bidesh365 |
| security_declaration_topic | Declaration Topic | text | RESTRICTED | declarations | legal_history | Record: Security Declaration | All purposes | bidesh365 |
| security_declaration_answer | Answer | text | RESTRICTED | declarations | legal_history | Record: Security Declaration | All purposes | bidesh365 |
| security_declaration_explanation | Explanation | text | RESTRICTED | declarations | legal_history | Record: Security Declaration | All purposes | bidesh365 |
| security_declaration_relevant_dates | Relevant Dates | text | RESTRICTED | declarations | legal_history | Record: Security Declaration | All purposes | bidesh365 |
| security_declaration_countries_involved | Countries Involved | text | RESTRICTED | declarations | legal_history | Record: Security Declaration | All purposes | bidesh365 |
| clearance_type | Clearance Type | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_type_other | Other Clearance Type | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_country | Country | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_state_province | State or Province | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_certificate_number | Certificate Number | text | SENSITIVE | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_issue_date | Issue Date | date | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_expiry_date | Expiry Date | date | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_issuing_authority | Issuing Authority | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_purpose | Purpose | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_result | Result | text | RESTRICTED | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_result_other | Other Result | text | RESTRICTED | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_records_details | Records Details | text | RESTRICTED | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| clearance_apostille_attached | Apostille Attached | text | STANDARD | declarations | clearance_certificates | Record: Clearance Certificate | All purposes | bidesh365 |
| organisation_membership_name | Organisation Name | text | RESTRICTED | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_type | Organisation Type | text | RESTRICTED | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_type_other | Other Organisation Type | text | RESTRICTED | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_role | Role | text | RESTRICTED | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_country | Country | text | STANDARD | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_start_date | Start Date | date | STANDARD | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_end_date | End Date | date | STANDARD | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_is_current | Currently a Member | text | STANDARD | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| organisation_membership_description | Description | text | RESTRICTED | declarations | military_and_memberships | Record: Organisation Membership | All purposes | bidesh365 |
| bankruptcy_filing_date | Filing Date | date | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_discharge_date | Discharge Date | date | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_country | Country | text | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_court_name | Court | text | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_case_number | Case Number | text | SENSITIVE | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_type | Bankruptcy Type | text | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_type_other | Other Bankruptcy Type | text | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_amount_discharged | Amount Discharged | text | SENSITIVE | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_currency | Currency | text | STANDARD | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_currency_other | Other Currency | text | STANDARD | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_status | Status | text | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| bankruptcy_status_other | Other Status | text | RESTRICTED | declarations | financial_history | Record: Bankruptcy | All purposes | bidesh365 |
| tax_default_country | Country | text | RESTRICTED | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_tax_year | Tax Year | text | RESTRICTED | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_tax_type | Tax Type | text | RESTRICTED | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_tax_type_other | Other Tax Type | text | RESTRICTED | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_amount_owed | Amount Owed | text | SENSITIVE | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_currency | Currency | text | STANDARD | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_currency_other | Other Currency | text | STANDARD | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_payment_plan | Payment Plan | text | RESTRICTED | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |
| tax_default_resolved_date | Resolved Date | date | RESTRICTED | declarations | financial_history | Record: Tax Default | All purposes | bidesh365 |

### Health (36)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| blood_group | Blood Group | text | SENSITIVE | medical | vaccinations_and_basics | Section: Health Basics | All purposes | bidesh365 |
| vaccination_vaccine | Vaccine | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_vaccine_other | Other Vaccine | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_manufacturer | Manufacturer | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_batch_number | Batch Number | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_dose_number | Dose Number | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_total_doses | Total Doses | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_date | Vaccination Date | date | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_location | Vaccination Location | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_country | Country | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_administered_by | Administered By | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_certificate_number | Certificate Number | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_expiry_date | Expiry Date | date | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| vaccination_international_certificate | International Certificate Issued | text | SENSITIVE | medical | vaccinations_and_basics | Record: Vaccination | All purposes | bidesh365 |
| medical_exam_type | Examination Type | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_type_other | Other Examination Type | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_date | Examination Date | date | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_location | Examination Location | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_country | Country | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_physician_name | Panel Physician | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_physician_code | Panel Physician Code | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_result | Result | text | RESTRICTED | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_result_other | Other Result | text | RESTRICTED | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_conditions_noted | Conditions Noted | text | RESTRICTED | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_follow_up_required | Follow-Up Required | text | RESTRICTED | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_certificate_number | Certificate Number | text | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| medical_exam_certificate_expiry | Certificate Expiry | date | SENSITIVE | medical | medical_exams | Record: Medical Examination | All purposes | bidesh365 |
| health_declaration_topic | Declaration Topic | text | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_answer | Answer | text | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_condition_name | Condition | text | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_diagnosis_date | Diagnosis Date | date | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_treatment_status | Treatment Status | text | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_treatment_status_other | Other Treatment Status | text | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_medications | Medications | text | RESTRICTED | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_physician_name | Physician | text | SENSITIVE | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |
| health_declaration_last_checkup_date | Last Check-Up Date | date | SENSITIVE | medical | health_declarations | Record: Health Declaration | All purposes | bidesh365 |

### Qualifications (51)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| education_level | Level | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_level_other | Other Level | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_country | Country | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_city | City | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_board_or_body | Board or Awarding Body | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_start_date | Start Date | date | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_end_date | End Date | date | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_is_current | Currently Studying | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_graduated | Graduated | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_grade | Grade or CGPA | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_grading_scale | Grading Scale | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_certificate_number | Certificate Number | text | SENSITIVE | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_thesis_title | Thesis Title | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| education_supervisor_name | Supervisor | text | STANDARD | professional | education_details | Extends record: education_history | All purposes | bidesh365 |
| language_name | Language | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_speaking | Speaking Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_speaking_other | Other Speaking Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_reading | Reading Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_reading_other | Other Reading Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_writing | Writing Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_writing_other | Other Writing Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_name | Test Taken | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_overall_score | Overall Score | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_listening_score | Listening Score | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_reading_score | Reading Score | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_writing_score | Writing Score | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_speaking_score | Speaking Score | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_date | Test Date | date | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_valid_until | Test Valid Until | date | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| language_test_report_number | Test Report Number | text | SENSITIVE | professional | languages | Record: Language | All purposes | bidesh365 |
| language_cefr_level | CEFR Level | text | STANDARD | professional | languages | Record: Language | All purposes | bidesh365 |
| professional_registration_body | Registering Body | text | STANDARD | professional | professional_credentials | Record: Professional Registration | All purposes | bidesh365 |
| professional_registration_type | Membership or Registration Type | text | STANDARD | professional | professional_credentials | Record: Professional Registration | All purposes | bidesh365 |
| professional_registration_number | Registration Number | text | SENSITIVE | professional | professional_credentials | Record: Professional Registration | All purposes | bidesh365 |
| professional_registration_country | Country | text | STANDARD | professional | professional_credentials | Record: Professional Registration | All purposes | bidesh365 |
| professional_registration_issue_date | Issue Date | date | STANDARD | professional | professional_credentials | Record: Professional Registration | All purposes | bidesh365 |
| professional_registration_valid_until | Valid Until | date | STANDARD | professional | professional_credentials | Record: Professional Registration | All purposes | bidesh365 |
| achievement_type | Achievement Type | text | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| achievement_type_other | Other Achievement Type | text | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| achievement_title | Title | text | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| achievement_description | Description | text | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| achievement_organisation | Organisation or Publisher | text | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| achievement_date | Date | date | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| achievement_reference | Reference or DOI | text | STANDARD | professional | achievements | Record: Achievement | All purposes | bidesh365 |
| skills_assessment_authority | Assessing Authority | text | STANDARD | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |
| skills_assessment_occupation_code | Occupation Code | text | STANDARD | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |
| skills_assessment_occupation_name | Occupation Name | text | STANDARD | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |
| skills_assessment_date | Assessment Date | date | STANDARD | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |
| skills_assessment_outcome | Outcome | text | STANDARD | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |
| skills_assessment_reference_number | Reference Number | text | SENSITIVE | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |
| skills_assessment_valid_until | Valid Until | date | STANDARD | professional | professional_credentials | Record: Skills Assessment | All purposes | bidesh365 |

### Purpose Packs (123)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| study_offer_institution | Institution | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_institution_country | Institution Country | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_programme | Programme or Course | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_level | Level of Study | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_duration_years | Course Duration in Years | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_start_date | Start Date | date | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_end_date | End Date | date | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_offer_reference | Offer Reference | text | SENSITIVE | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_tuition_fee | Tuition Fee | text | SENSITIVE | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_tuition_currency | Tuition Currency | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_tuition_currency_other | Other Tuition Currency | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_accommodation_arranged | Accommodation Arranged | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| study_offer_supervisor_name | Supervisor | text | STANDARD | study | study_plan | Record: Study Offer | study, beyond | bidesh365 |
| scholarship_name | Scholarship Name | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_provider | Provider | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_amount | Award Amount | text | SENSITIVE | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_currency | Currency | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_currency_other | Other Currency | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_terms_summary | Terms Summary | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_has_service_bond | Service Bond | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| scholarship_bond_details | Bond Details | text | STANDARD | study | study_plan | Record: Scholarship | study, beyond | owner_vision |
| study_gap_start | Start Date | date | STANDARD | study | study_plan | Record: Study Gap | study | owner_vision |
| study_gap_end | End Date | date | STANDARD | study | study_plan | Record: Study Gap | study | owner_vision |
| study_gap_explanation | Explanation | text | STANDARD | study | study_plan | Record: Study Gap | study | owner_vision |
| occupation_code | Occupation Code | text | STANDARD | professional | job_offer_details | Section: Occupation | work | owner_vision |
| occupation_title | Occupation Title | text | STANDARD | professional | job_offer_details | Section: Occupation | work | owner_vision |
| skills_claimed | Skills Claimed | text | STANDARD | professional | job_offer_details | Section: Occupation | work | owner_vision |
| job_search_history | Job Search History | text | STANDARD | professional | job_offer_details | Section: Occupation | work | owner_vision |
| job_offer_employer | Employer | text | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_country | Country | text | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_job_title | Job Title | text | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_occupation_code | Occupation Code | text | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_salary | Offered Salary | text | SENSITIVE | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_currency | Currency | text | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_currency_other | Other Currency | text | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_contract_start | Contract Start | date | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_contract_end | Contract End | date | STANDARD | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_sponsor_licence_number | Employer Sponsor Licence Number | text | SENSITIVE | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| job_offer_offer_reference | Offer Reference | text | SENSITIVE | professional | job_offer_details | Record: Job Offer | work | bidesh365 |
| labour_migration_agency_name | Recruiting Agency | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_agency_licence_number | Agency Licence Number | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_employer_abroad | Employer Abroad | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_country | Destination Country | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_job_title | Job Title | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_wage | Contract Wage | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_wage_currency | Wage Currency | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_wage_currency_other | Other Wage Currency | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_working_hours | Working Hours | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_housing_terms | Housing Terms | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_return_ticket_terms | Return Ticket Terms | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_emigration_clearance_number | Emigration Clearance Number | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_emigration_clearance_date | Emigration Clearance Date | date | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_welfare_fee_receipt_number | Welfare Fee Receipt Number | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_recruitment_fee_paid | Recruitment Fee Paid | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_fee_currency | Fee Currency | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_fee_currency_other | Other Fee Currency | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_medical_centre | Approved Medical Centre | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_medical_result | Medical Result | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_medical_result_other | Other Medical Result | text | SENSITIVE | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_skill_test_result | Skill Test Result | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_training_completed_date | Pre-Departure Training Completed | date | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| labour_migration_complaint_notes | Complaint Notes | text | STANDARD | labour_migration | labour_migration | Record: Labour Migration Record | work | owner_vision |
| business_entity_name | Business Name | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_legal_form | Legal Form | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_sector | Sector | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_country | Country | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_role | Your Role | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_share_percentage | Your Shareholding | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_trade_licence_number | Trade Licence Number | text | SENSITIVE | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_trade_licence_renewal_date | Trade Licence Renewal Date | date | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_registration_number | Company Registration Number | text | SENSITIVE | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_tax_number | Business Tax Number | text | SENSITIVE | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_address | Business Address | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_start_date | Business Start Date | date | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_employee_count | Number of Employees | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_annual_turnover | Annual Turnover | text | SENSITIVE | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_turnover_currency | Turnover Currency | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_turnover_currency_other | Other Turnover Currency | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_net_profit | Net Profit Last Year | text | SENSITIVE | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_profit_currency | Profit Currency | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_profit_currency_other | Other Profit Currency | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| business_entity_is_foreign | Foreign Entity | text | STANDARD | business | business_entities | Record: Business Entity | work, settle, visit | bidesh365 |
| treatment_hospital_country | Hospital Country | text | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_hospital_address | Hospital Address | text | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_appointment_date | Appointment Date | date | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_start_date | Treatment Start Date | date | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_end_date | Treatment End Date | date | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_estimated_cost | Estimated Treatment Cost | text | SENSITIVE | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_cost_currency | Treatment Cost Currency | text | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_cost_currency_other | Other Treatment Cost Currency | text | STANDARD | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| treatment_diagnosis_details | Diagnosis Details | text | RESTRICTED | medical | treatment_plan | Section: Treatment Plan | visit | bidesh365 |
| relationship_evidence_type | Evidence Type | text | STANDARD | settle | family_settlement | Record: Relationship Evidence | settle | bidesh365 |
| relationship_evidence_type_other | Other Evidence Type | text | STANDARD | settle | family_settlement | Record: Relationship Evidence | settle | bidesh365 |
| relationship_evidence_description | Description | text | STANDARD | settle | family_settlement | Record: Relationship Evidence | settle | bidesh365 |
| relationship_evidence_from | From | date | STANDARD | settle | family_settlement | Record: Relationship Evidence | settle | bidesh365 |
| relationship_evidence_to | To | date | STANDARD | settle | family_settlement | Record: Relationship Evidence | settle | bidesh365 |
| relationship_evidence_children_count | Number of Children Together | text | STANDARD | settle | family_settlement | Record: Relationship Evidence | settle | bidesh365 |
| settlement_test_name | Test Name | text | STANDARD | settle | family_settlement | Record: Settlement Test | settle | owner_vision |
| settlement_test_date | Test Date | date | STANDARD | settle | family_settlement | Record: Settlement Test | settle | owner_vision |
| settlement_test_result | Result | text | STANDARD | settle | family_settlement | Record: Settlement Test | settle | owner_vision |
| settlement_test_reference_number | Reference Number | text | SENSITIVE | settle | family_settlement | Record: Settlement Test | settle | owner_vision |
| local_registration_type | Registration Type | text | STANDARD | settle | after_arrival | Record: Local Registration | settle, after_decision | owner_vision |
| local_registration_date | Registration Date | date | STANDARD | settle | after_arrival | Record: Local Registration | settle, after_decision | owner_vision |
| local_registration_reference_number | Reference Number | text | SENSITIVE | settle | after_arrival | Record: Local Registration | settle, after_decision | owner_vision |
| local_registration_local_tax_number | Local Tax Number | text | RESTRICTED | settle | after_arrival | Record: Local Registration | settle, after_decision | owner_vision |
| local_registration_local_bank_name | Local Bank | text | STANDARD | settle | after_arrival | Record: Local Registration | settle, after_decision | owner_vision |
| permit_condition_type | Condition Type | text | STANDARD | settle | after_arrival | Record: Permit Condition | settle, after_decision, study, work | owner_vision |
| permit_condition_limit | Limit or Rule | text | STANDARD | settle | after_arrival | Record: Permit Condition | settle, after_decision, study, work | owner_vision |
| permit_condition_check_in_date | Next Check-In Date | date | STANDARD | settle | after_arrival | Record: Permit Condition | settle, after_decision, study, work | owner_vision |
| permit_condition_reporting_authority | Reporting Authority | text | STANDARD | settle | after_arrival | Record: Permit Condition | settle, after_decision, study, work | owner_vision |
| permit_condition_renewal_due | Renewal Due | date | STANDARD | settle | after_arrival | Record: Permit Condition | settle, after_decision, study, work | owner_vision |
| go_number | Government Order Number | text | SENSITIVE | official_travel | official_order | Section: Official Order | protection, visit | bidesh365 |
| note_verbale_number | Note Verbale Number | text | SENSITIVE | official_travel | official_order | Section: Official Order | protection, visit | bidesh365 |
| ministry_name | Ministry | text | STANDARD | official_travel | official_order | Section: Official Order | protection, visit | bidesh365 |
| department_name | Department | text | STANDARD | official_travel | official_order | Section: Official Order | protection, visit | bidesh365 |
| delegation_members | Delegation Members | text | STANDARD | official_travel | official_order | Section: Official Order | protection, visit | bidesh365 |
| official_purpose_details | Purpose Details | text | STANDARD | official_travel | official_order | Section: Official Order | protection, visit | bidesh365 |
| pilgrimage_operator_name | Operator | text | STANDARD | official_travel | pilgrimage | Record: Pilgrimage Trip | visit | owner_vision |
| pilgrimage_operator_licence_number | Operator Licence Number | text | SENSITIVE | official_travel | pilgrimage | Record: Pilgrimage Trip | visit | owner_vision |
| pilgrimage_group_reference | Group Reference | text | STANDARD | official_travel | pilgrimage | Record: Pilgrimage Trip | visit | owner_vision |
| pilgrimage_departure_date | Departure Date | date | STANDARD | official_travel | pilgrimage | Record: Pilgrimage Trip | visit | owner_vision |
| pilgrimage_return_date | Return Date | date | STANDARD | official_travel | pilgrimage | Record: Pilgrimage Trip | visit | owner_vision |
| investment_amount_currency_other | Other Investment Amount Currency | text | STANDARD | business | business_investor | Section: Other Investment Currency | All purposes | visastack |

### Country Packs (73)

| Key | Label | Type | Protection | Category | Section | Block | Applies to | Origin |
|---|---|---|---|---|---|---|---|---|
| union_parishad | Union Parishad | text | STANDARD | bangladesh | bangladesh_address | Section: Bangladesh Address Details | All purposes; BD | bidesh365 |
| permanent_address_upazila | Permanent Address Upazila | text | STANDARD | bangladesh | bangladesh_address | Section: Bangladesh Address Details | All purposes; BD | bidesh365 |
| permanent_address_district | Permanent Address District | text | STANDARD | bangladesh | bangladesh_address | Section: Bangladesh Address Details | All purposes; BD | bidesh365 |
| permanent_address_division | Permanent Address Division | text | STANDARD | bangladesh | bangladesh_address | Section: Bangladesh Address Details | All purposes; BD | bidesh365 |
| permanent_address_line | Permanent Address | text | STANDARD | bangladesh | bangladesh_address | Section: Bangladesh Address Details | All purposes; BD | bidesh365 |
| gcc_iqama_number | Iqama Number | text | RESTRICTED | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_iqama_expiry | Iqama Expiry | date | STANDARD | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_kafeel_name | Kafeel (Sponsor) Name | text | STANDARD | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_kafeel_id | Kafeel (Sponsor) ID | text | RESTRICTED | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_profession | Profession in the Gulf | text | STANDARD | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_work_permit_number | Gulf Work Permit Number | text | SENSITIVE | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_labour_card_number | Labour Card Number | text | SENSITIVE | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_medical_test_date | Gulf Medical Test Date | date | SENSITIVE | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_medical_test_result | Gulf Medical Test Result | text | RESTRICTED | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_medical_test_result_other | Other Gulf Medical Test Result | text | RESTRICTED | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_previous_countries | Previous Gulf Countries | text | STANDARD | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| gcc_absconding_record | Absconding Record | text | RESTRICTED | country_ids | gcc | Section: Gulf Cooperation Council | All purposes; GCC | bidesh365 |
| jp_residence_card_number | Residence Card Number | text | RESTRICTED | country_ids | asia_pacific | Section: Japan | All purposes; JP | bidesh365 |
| jp_jlpt_level | JLPT Level | text | STANDARD | country_ids | asia_pacific | Section: Japan | All purposes; JP | bidesh365 |
| kr_arc_number | Alien Registration Card Number | text | RESTRICTED | country_ids | asia_pacific | Section: South Korea | All purposes; KR | bidesh365 |
| kr_topik_level | TOPIK Level | text | STANDARD | country_ids | asia_pacific | Section: South Korea | All purposes; KR | bidesh365 |
| cn_residence_permit_number | Residence Permit Number | text | RESTRICTED | country_ids | asia_pacific | Section: China | All purposes; CN | bidesh365 |
| cn_hsk_level | HSK Level | text | STANDARD | country_ids | asia_pacific | Section: China | All purposes; CN | bidesh365 |
| cn_telecode_name | Name in Chinese Telecode | text | STANDARD | country_ids | asia_pacific | Section: China | All purposes; CN | bidesh365 |
| sg_fin_number | Foreign Identification Number | text | RESTRICTED | country_ids | asia_pacific | Section: Singapore | All purposes; SG | bidesh365 |
| my_mypr_number | MyPR Number | text | RESTRICTED | country_ids | asia_pacific | Section: Malaysia | All purposes; MY | bidesh365 |
| th_work_permit_number | Work Permit Number | text | SENSITIVE | country_ids | asia_pacific | Section: Thailand | All purposes; TH | bidesh365 |
| apec_card_number | APEC Card Number | text | SENSITIVE | country_ids | asia_pacific | Section: APEC Business Travel Card | All purposes | bidesh365 |
| apec_card_expiry | APEC Card Expiry | date | STANDARD | country_ids | asia_pacific | Section: APEC Business Travel Card | All purposes | bidesh365 |
| au_visa_grant_number | Visa Grant Number | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_immiaccount_number | ImmiAccount Number | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_medicare_number | Medicare Number | text | RESTRICTED | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_tax_file_number | Tax File Number | text | RESTRICTED | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_business_number | Australian Business Number | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_skills_assessment_reference | Skills Assessment Reference | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_coe_number | Confirmation of Enrolment Number | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_cricos_code | CRICOS Code | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| au_oshc_policy_number | Overseas Student Health Cover Policy Number | text | SENSITIVE | country_ids | australia_new_zealand | Section: Australia | All purposes; AU | bidesh365 |
| nz_ird_number | Inland Revenue Number | text | RESTRICTED | country_ids | australia_new_zealand | Section: New Zealand | All purposes; NZ | bidesh365 |
| nz_nhi_number | National Health Index Number | text | RESTRICTED | country_ids | australia_new_zealand | Section: New Zealand | All purposes; NZ | bidesh365 |
| eu_residence_permit_number | Residence Permit Number | text | RESTRICTED | country_ids | europe | Section: European Union | All purposes; EU | bidesh365 |
| eu_blue_card_number | Blue Card Number | text | SENSITIVE | country_ids | europe | Section: European Union | All purposes; EU | bidesh365 |
| eu_etias_authorisation_number | Travel Authorisation Number | text | SENSITIVE | country_ids | europe | Section: European Union | All purposes; EU | bidesh365 |
| gb_brp_number | Biometric Residence Permit Number | text | RESTRICTED | country_ids | uk_ireland | Section: United Kingdom | All purposes; GB | bidesh365 |
| gb_share_code | Share Code | text | SENSITIVE | country_ids | uk_ireland | Section: United Kingdom | All purposes; GB | bidesh365 |
| gb_cas_number | Confirmation of Acceptance for Studies Number | text | SENSITIVE | country_ids | uk_ireland | Section: United Kingdom | All purposes; GB | bidesh365 |
| gb_sponsor_licence_number | Sponsor Licence Number | text | SENSITIVE | country_ids | uk_ireland | Section: United Kingdom | All purposes; GB | bidesh365 |
| gb_atas_required | Academic Technology Approval Required | text | STANDARD | country_ids | uk_ireland | Section: United Kingdom | All purposes; GB | bidesh365 |
| gb_atas_certificate_number | Academic Technology Approval Certificate Number | text | SENSITIVE | country_ids | uk_ireland | Section: United Kingdom | All purposes; GB | bidesh365 |
| ie_residence_permit_number | Residence Permit Number | text | RESTRICTED | country_ids | uk_ireland | Section: Ireland | All purposes; IE | bidesh365 |
| ch_permit_type | Permit Type | text | STANDARD | country_ids | europe | Section: Switzerland | All purposes; CH | bidesh365 |
| us_social_security_number | Social Security Number | text | RESTRICTED | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_alien_number | Alien Registration Number | text | RESTRICTED | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_i94_number | I-94 Number | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_petition_number | Petition Receipt Number | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_case_number | Case Number | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_esta_authorisation_number | ESTA Authorisation Number | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_sevis_id | SEVIS ID | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_school_code | School Code | text | STANDARD | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_dso_name | Designated School Official | text | STANDARD | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_global_entry_number | Global Entry Number | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| us_nexus_number | NEXUS Number | text | SENSITIVE | country_ids | united_states | Section: United States | All purposes; US | bidesh365 |
| ca_uci_number | Unique Client Identifier | text | RESTRICTED | country_ids | canada | Section: Canada | All purposes; CA | bidesh365 |
| ca_client_id | Client ID | text | SENSITIVE | country_ids | canada | Section: Canada | All purposes; CA | bidesh365 |
| ca_ecopr_number | Electronic Confirmation of Permanent Residence Number | text | SENSITIVE | country_ids | canada | Section: Canada | All purposes; CA | bidesh365 |
| br_cpf_number | CPF Number | text | RESTRICTED | country_ids | latin_america | Section: Brazil | All purposes; BR | bidesh365 |
| mx_curp_number | CURP Number | text | RESTRICTED | country_ids | latin_america | Section: Mexico | All purposes; MX | bidesh365 |
| ae_emirates_id_number | Emirates ID Number | text | RESTRICTED | country_ids | africa_middle_east | Section: United Arab Emirates | All purposes; AE | bidesh365 |
| il_entry_permit_number | Entry Permit Number | text | SENSITIVE | country_ids | africa_middle_east | Section: Israel | All purposes; IL | bidesh365 |
| za_id_number | South African ID Number | text | RESTRICTED | country_ids | africa_middle_east | Section: South Africa | All purposes; ZA | bidesh365 |
| eg_national_id_number | Egyptian National ID Number | text | RESTRICTED | country_ids | africa_middle_east | Section: Egypt | All purposes; EG | bidesh365 |
| ke_alien_id_number | Alien ID Number | text | RESTRICTED | country_ids | africa_middle_east | Section: Kenya | All purposes; KE | bidesh365 |
| ng_nin_number | National Identification Number | text | RESTRICTED | country_ids | africa_middle_east | Section: Nigeria | All purposes; NG | bidesh365 |

## Left out on purpose

- Raw biometric data (fingerprints, iris scans, face data): only the receipt of an appointment is stored.
- Full bank account numbers: only the last four digits.
- Web links to uploaded files (the other product keeps dozens): VisaStack links documents to facts through proof links instead.
- Yellow fever certificate number and date as separate fields: the Vaccination record already holds them.
- Gender identity: no clear travel use, and it is a special category. Add only if a route needs it.
- Wording of any legal, security or health question: held for adviser review.

## Needs a decision before Phase 2

- Which proposed sharing categories to create, and what each may contain.
- Whether the live refusal record (in the universal category today) moves to the declarations category.
- Review of every document type pack before it becomes visible to grants.
- Adviser sign-off for every item marked "proposed", every adviser-handled purpose, and the exact official names in the labour migration record.

