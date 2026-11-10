/**
 * Plain names people already use for things an agency can ask for (the "Ask for a Document or
 * Detail" picker), kept in one place beside the catalogue.
 *
 * Rules (a test walks the whole file):
 * - A term says what a thing is commonly CALLED. It never says that anyone requires it: no
 *   "required", "mandatory", "must", "needed", and no country or visa names.
 * - Every key is a real catalogue key (a document type, or a detail an agency can ask for).
 * - A term is a noun phrase; it is lower-cased only for matching.
 * - A term never repeats the label of a different item.
 *
 * `REQUEST_CONTEXT` is the plain second line shown only where two items share one label (for
 * example Date of Birth for the traveller and for a dependant). It is never an internal key.
 */

export interface RequestSynonym {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly terms: readonly string[];
}

const d = (key: string, ...terms: string[]): RequestSynonym => ({ kind: 'DOCUMENT', key, terms });
const f = (key: string, ...terms: string[]): RequestSynonym => ({ kind: 'FIELD', key, terms });

export const REQUEST_SYNONYMS: readonly RequestSynonym[] = [
  // Identity and civil records
  d('NID', 'NID', 'NID Card', 'Smart Card', 'Voter ID', 'Voter ID Card', 'National Identity Card'),
  d('PASSPORT', 'Passport Copy', 'Bio Page', 'Passport Bio Page', 'Data Page'),
  d('BIRTH_CERTIFICATE', 'BRC', 'Birth Registration', 'Birth Registration Certificate'),
  d('MARRIAGE_CERTIFICATE', 'Kabin Nama', 'Nikah Nama', 'Marriage Registration'),
  d('DIVORCE_CERTIFICATE', 'Talaq Nama', 'Divorce Decree'),
  d('DEATH_CERTIFICATE', 'Death Registration'),
  d('NAME_CHANGE_CERTIFICATE', 'Deed Poll', 'Name Change Affidavit'),
  d('CITIZENSHIP_CERTIFICATE', 'Nationality Certificate', 'Citizen Certificate'),
  d('DRIVING_LICENCE', 'Driving License', 'DL', 'BRTA Licence'),
  d('FAMILY_REGISTER', 'Family Tree', 'Family Card'),
  // Money
  d('BANK_STATEMENT', 'Account Statement', 'Passbook', 'Bank Book'),
  d('SOLVENCY_CERTIFICATE', 'Solvency', 'Solvency Certificate', 'Bank Solvency'),
  d('BANK_REFERENCE_LETTER', 'Bank Letter', 'Bank Reference'),
  d('TAX_RETURN', 'Income Tax Return', 'IT Return', 'ITR', 'Tax Return Copy'),
  d('TAX_ACKNOWLEDGEMENT_SLIP', 'Tax Acknowledgement', 'Return Receipt', 'Acknowledgement Slip'),
  d('TIN_CERTIFICATE', 'TIN', 'TIN Certificate', 'Tax ID'),
  d('SALARY_SLIP', 'Payslip', 'Pay Slip', 'Pay Stub'),
  d('SALARY_CERTIFICATE', 'Salary Letter', 'Salary Statement'),
  d('INCOME_CERTIFICATE', 'Income Proof', 'Income Statement'),
  d('FDR_CERTIFICATE', 'FDR', 'Fixed Deposit'),
  d('SANCHAYPATRA', 'Sanchay Patra', 'Savings Certificate', 'National Savings Certificate'),
  d('RENTAL_INCOME_PROOF', 'House Rent Income', 'Rent Income'),
  d('PROPERTY_DEED', 'Land Deed', 'Property Papers', 'Dolil', 'Land Documents', 'Mutation'),
  d('REMITTANCE_RECORD', 'Remittance', 'Money Transfer Record', 'Wage Earner Remittance'),
  d('FINANCIAL_GUARANTEE', 'Financial Support Letter'),
  d('SPONSORSHIP_LETTER', 'Sponsor Letter', 'Sponsorship'),
  d('AFFIDAVIT_OF_SUPPORT', 'Support Affidavit'),
  // Work and business
  d('EMPLOYMENT_CERTIFICATE', 'Job Certificate', 'Service Certificate', 'Employment Letter'),
  d(
    'NOC_EMPLOYER',
    'NOC',
    'No Objection Certificate',
    'No Objection Letter',
    'Leave Letter',
    'Employer NOC',
  ),
  d('NOC_GOVERNMENT', 'NOC', 'No Objection Certificate', 'Government NOC', 'Government Permission'),
  d('LEAVE_APPROVAL', 'Leave Letter', 'Approved Leave', 'Leave Permission'),
  d('APPOINTMENT_LETTER', 'Joining Letter', 'Job Appointment'),
  d('EXPERIENCE_CERTIFICATE', 'Work Experience Certificate', 'Experience Letter'),
  d('EMPLOYMENT_CONTRACT', 'Job Contract', 'Employment Agreement'),
  d(
    'BUSINESS_REGISTRATION',
    'Company Registration',
    'RJSC',
    'RJSC Certificate',
    'Certificate of Incorporation',
  ),
  d(
    'TRADE_LICENSE',
    'Trade Licence',
    'Business Licence',
    'Business License',
    'City Corporation Licence',
  ),
  d('COMPANY_MEMORANDUM', 'Memorandum of Association', 'MOA', 'Articles of Association'),
  d('BUSINESS_BANK_STATEMENT', 'Company Bank Statement', 'Business Account Statement'),
  d('COMPANY_ACCOUNTS', 'Company Financials', 'Balance Sheet', 'Profit and Loss'),
  d('JOB_OFFER_LETTER', 'Offer Letter', 'Job Offer'),
  d('LABOUR_CONTRACT', 'Work Contract Abroad', 'Overseas Contract'),
  d('EMIGRATION_CLEARANCE', 'BMET Clearance', 'BMET Card'),
  d('CURRICULUM_VITAE', 'CV', 'Resume', 'Biodata'),
  // Study
  d('EDUCATION_CERTIFICATE', 'SSC Certificate', 'HSC Certificate', 'Academic Certificate'),
  d('DEGREE_CERTIFICATE', 'Graduation Certificate', 'Bachelor Certificate', 'Masters Certificate'),
  d('TRANSCRIPT', 'Academic Transcript', 'Mark Sheet', 'Marksheet', 'Result Sheet'),
  d('ADMISSION_LETTER', 'Offer of Admission', 'Admission Offer', 'University Offer'),
  d('ENROLLMENT_LETTER', 'Enrolment Letter', 'Student Certificate'),
  d('STUDENT_ID', 'Student Card', 'University ID'),
  d('IELTS_CERTIFICATE', 'IELTS', 'IELTS Result', 'TRF'),
  d('TOEFL_CERTIFICATE', 'TOEFL', 'TOEFL Result'),
  d('STATEMENT_OF_PURPOSE', 'SOP', 'Personal Statement', 'Motivation Letter'),
  d('RECOMMENDATION_LETTER', 'LOR', 'Letter of Recommendation'),
  // Health
  d('MEDICAL_REPORT', 'Medical Test', 'Health Report'),
  d('VACCINATION_CERTIFICATE', 'Vaccine Card', 'Vaccine Certificate', 'Vaccination Card'),
  d('COVID_CERTIFICATE', 'Covid Vaccine Card', 'Covid Certificate'),
  d('YELLOW_FEVER_CERTIFICATE', 'Yellow Card', 'Yellow Fever Card'),
  d('TB_TEST_CERTIFICATE', 'TB Test', 'Tuberculosis Test', 'Chest X-ray Report'),
  d('TRAVEL_INSURANCE', 'Travel Insurance Policy', 'Insurance Policy'),
  // Legal
  d(
    'POLICE_CLEARANCE',
    'PCC',
    'Police Certificate',
    'Police Verification',
    'Police Clearance Certificate',
  ),
  d('CHARACTER_CERTIFICATE', 'Good Conduct Certificate'),
  d('POWER_OF_ATTORNEY', 'POA', 'Attorney Letter'),
  d('AFFIDAVIT', 'Sworn Statement', 'Stamp Paper Statement'),
  d('PARENTAL_CONSENT', 'Parents Consent', 'Parents Permission', 'Guardian Consent'),
  d('MINOR_TRAVEL_CONSENT', 'Child Travel Consent', 'Consent for Child'),
  // Travel and stay
  d(
    'PHOTO',
    'Passport Photo',
    'Passport Size Photo',
    'Passport-Size Picture',
    'Picture',
    'Photo',
    'Visa Photo',
  ),
  d('FLIGHT_BOOKING', 'Flight Reservation', 'Air Ticket Booking'),
  d('FLIGHT_TICKET', 'Air Ticket', 'Plane Ticket'),
  d('HOTEL_BOOKING', 'Hotel Reservation', 'Stay Booking', 'Hotel Voucher'),
  d('TRAVEL_ITINERARY', 'Travel Plan', 'Trip Plan', 'Tour Plan'),
  d('INVITATION_LETTER', 'Invite Letter', 'Invitation'),
  d('ADDRESS_PROOF', 'Utility Proof', 'Residence Proof'),
  d('UTILITY_BILL', 'Electricity Bill', 'Gas Bill', 'Water Bill'),
  d('RENTAL_AGREEMENT', 'House Rent Agreement', 'Tenancy Agreement', 'Lease'),
  d('COVER_LETTER', 'Cover Note'),
  d('CERTIFIED_TRANSLATION', 'Translation', 'Attested Translation'),
  d('ATTESTATION_CERTIFICATE', 'Attestation', 'Foreign Ministry Attestation', 'MOFA Attestation'),
  d('LEGALISATION_CERTIFICATE', 'Apostille', 'Legalisation'),
  d('NOTARIZED_DOCUMENT', 'Notary', 'Notarised Copy'),
  d('APPLICATION_RECEIPT', 'Application Submission Receipt', 'Submission Receipt'),
  d('FEE_PAYMENT_RECEIPT', 'Fee Receipt', 'Payment Slip', 'Challan'),
  d('SIGNATURE_SPECIMEN', 'Signature', 'Specimen Signature'),
  // Anything not named: the real "Other" types, found by the words people try
  d('OTHER', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_IDENTITY_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_TRAVEL_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_FINANCIAL_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_EMPLOYMENT_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_EDUCATION_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_MEDICAL_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_LEGAL_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_FAMILY_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_ACCOMMODATION_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_APPLICATION_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_PHOTO_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_LETTER', 'Other', 'Something Else', 'Not in the List'),
  d('OTHER_LEGALISATION_DOCUMENT', 'Other', 'Something Else', 'Not in the List'),
  // Details
  f('passport_number', 'Passport No'),
  f('passport_expiry', 'Passport Validity', 'Passport Expiry Date'),
  f('date_of_birth', 'DOB', 'Birth Date'),
  f('phone', 'Mobile Number', 'Mobile', 'Contact Number'),
  f('email', 'Email Address', 'Mail'),
  f('marital_status', 'Married or Single'),
  f('monthly_salary', 'Salary', 'Monthly Income'),
  f('tin_number', 'TIN', 'Tax ID'),
  f('annual_income', 'Yearly Income'),
  f('father_name', "Father's Name"),
  f('mother_name', "Mother's Name"),
  f('spouse_name', 'Husband Name', 'Wife Name', 'Partner Name'),
  f('name_on_national_id', 'NID Name', 'Name on NID'),
  f('name_on_birth_certificate', 'BRC Name', 'Name on BRC'),
];

/**
 * The plain second line for an item whose label is shared with another item. Items not listed
 * fall back to the name of the record or section they sit in (for example Family Member), which
 * is already plain; only the earliest details have none, so they are named here.
 */
export const REQUEST_CONTEXT: Readonly<Record<string, string>> = {
  date_of_birth: 'Traveller',
  dependant_date_of_birth: 'Dependant',
  nationality: 'Traveller',
  dependant_nationality: 'Dependant',
  passport_number: 'Current Passport',
  passport_expiry: 'Current Passport',
  historical_passport_number: 'Earlier Passport',
  historical_passport_country: 'Earlier Passport',
  historical_passport_expiry: 'Earlier Passport',
  dependant_passport_number: 'Dependant',
  attendant_passport_number: 'Medical Attendant',
  attendant_passport_expiry: 'Medical Attendant',
  prior_visa_country: 'Earlier Visa',
  address_line: 'Home Address',
  address_country: 'Home Address',
  employer_country: 'Employer',
  sponsor_name: 'Sponsor',
  sponsor_address: 'Sponsor',
  sponsor_country: 'Sponsor',
  sponsor_relationship: 'Sponsor',
  dependant_name: 'Dependant',
  dependant_relationship: 'Dependant',
  historical_passport_issue_date: 'Earlier Passport',
  address_city: 'Home Address',
  address_from: 'Home Address',
  prior_visa_type: 'Earlier Visa',
  travel_purpose: 'This Trip',
  refusal_date: 'Visa Refusal',
  employment_start: 'Job History',
  institution_name: 'Education History',
  job_title: 'Current Job',
  employer_job_title: 'Employer',
};
