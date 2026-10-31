export interface ProcedureCodeInfo {
  code: string;
  codeSystem: 'CPT' | 'HCPCS';
  category: string;
  shortDescriptor: string;
  clinicalSummary: string;
  globalPeriod: '000' | '010' | '090' | 'XXX' | 'YYY' | 'ZZZ' | 'ADD-ON';
  commonModifiers: string[];
  typicalDxPrefixes: string[];
  codingTips: string[];
  requiresLaterality?: boolean;
  isAddOn?: boolean;
  primaryBaseCodes?: string[];
  isPreventive?: boolean;
  isEM?: boolean;
  isMinorProcedure?: boolean;
}

export interface ModifierInfo {
  code: string;
  title: string;
  category: 'E/M & Global' | 'NCCI Distinct Service' | 'Anatomical / Laterality' | 'Component / Lab' | 'Telehealth' | 'Drug / ABN / Policy' | 'Therapy';
  whenToUse: string;
  avoidWhen: string;
  commonDenialsFixed: string[];
}

export interface NcciPtpPair {
  column1: string;
  column2: string;
  modifierIndicator: 0 | 1;
  allowedModifiers?: string[];
  rationale: string;
}

export const MODIFIER_REFERENCE: ModifierInfo[] = [
  {
    code: '25',
    title: 'Significant, Separately Identifiable E/M Service on Same Day of Procedure',
    category: 'E/M & Global',
    whenToUse: 'Append to the E/M code (99202–99215, 99281–99285) when a distinct evaluation above and beyond the usual pre-/post-work of a same-day minor procedure (000/010-day global or injection) is documented.',
    avoidWhen: 'Never append -25 to surgical/procedure codes; do not use when visit was scheduled solely to perform the planned procedure without separate E/M decision-making.',
    commonDenialsFixed: ['CO-4', 'CO-97', 'B15'],
  },
  {
    code: '59',
    title: 'Distinct Procedural Service',
    category: 'NCCI Distinct Service',
    whenToUse: 'Append to the NCCI Column 2 procedure code when performed at a different session, different anatomical site/organ system, or separate incision/lesion—only when a more specific X-modifier (XE, XS, XP, XU) does not apply.',
    avoidWhen: 'Never use on E/M codes (use -25 or -24) and never use when NCCI Modifier Indicator is 0.',
    commonDenialsFixed: ['CO-97', 'CO-4', 'CO-236'],
  },
  {
    code: 'XE',
    title: 'Separate Encounter (CMS Specific Subset of -59)',
    category: 'NCCI Distinct Service',
    whenToUse: 'Distinct service performed during a separate patient encounter on the same date of service.',
    avoidWhen: 'Do not report simultaneously with -59 on the same claim line.',
    commonDenialsFixed: ['CO-97', 'CO-236'],
  },
  {
    code: 'XS',
    title: 'Separate Structure / Organ (CMS Specific Subset of -59)',
    category: 'NCCI Distinct Service',
    whenToUse: 'Distinct procedure performed on a separate organ, anatomical structure, or distinct body area during the same session.',
    avoidWhen: 'Do not use for contiguous incisions on the same anatomic lesion or alongside -59.',
    commonDenialsFixed: ['CO-97', 'CO-236'],
  },
  {
    code: 'XP',
    title: 'Separate Practitioner (CMS Specific Subset of -59)',
    category: 'NCCI Distinct Service',
    whenToUse: 'Distinct service performed by a different practitioner on the same date of service.',
    avoidWhen: 'Do not use when both services were rendered by the same NPI.',
    commonDenialsFixed: ['CO-97'],
  },
  {
    code: 'XU',
    title: 'Unusual Non-Overlapping Service (CMS Specific Subset of -59)',
    category: 'NCCI Distinct Service',
    whenToUse: 'Distinct service that does not overlap the usual components of the primary procedure.',
    avoidWhen: 'Do not use to bypass NCCI Indicator 0 edits.',
    commonDenialsFixed: ['CO-97'],
  },
  {
    code: '24',
    title: 'Unrelated E/M Service by Same Physician During Postoperative Global Period',
    category: 'E/M & Global',
    whenToUse: 'Append to an E/M visit during a 10- or 90-day postoperative global period when evaluating a condition unrelated to the original surgery.',
    avoidWhen: 'Do not use for routine postoperative wound checks or surgical complications handled in office.',
    commonDenialsFixed: ['CO-97', 'CO-4'],
  },
  {
    code: '57',
    title: 'Decision for Major Surgery (90-Day Global)',
    category: 'E/M & Global',
    whenToUse: 'Append to an E/M visit on the day before or day of a major surgical procedure (090 global days) when that visit resulted in the initial decision to perform surgery.',
    avoidWhen: 'Do not use with minor procedures (000 or 010 global days — use -25 instead).',
    commonDenialsFixed: ['CO-97', 'CO-4'],
  },
  {
    code: '26',
    title: 'Professional Component Only',
    category: 'Component / Lab',
    whenToUse: 'Physician interpretation and written report of a diagnostic/radiology test when facility/hospital owns the equipment.',
    avoidWhen: 'Never combine -26 and -TC on the same claim line; do not append to pure professional-only codes.',
    commonDenialsFixed: ['CO-4', 'CO-B9'],
  },
  {
    code: 'TC',
    title: 'Technical Component Only',
    category: 'Component / Lab',
    whenToUse: 'Equipment, technologist, and supplies portion of a split diagnostic service without physician interpretation.',
    avoidWhen: 'Never combine -TC and -26 on the same line; bill global code without modifiers if your practice performs both.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: '50',
    title: 'Bilateral Procedure',
    category: 'Anatomical / Laterality',
    whenToUse: 'Identical bilateral surgical/diagnostic procedure performed on both left and right paired organs/limbs in the same session (1 unit with -50 for Medicare unless code descriptor already states bilateral).',
    avoidWhen: 'Never append -50 to codes whose descriptor already includes "unilateral or bilateral" or alongside -LT/-RT on the same line.',
    commonDenialsFixed: ['CO-4', 'CO-151'],
  },
  {
    code: 'RT',
    title: 'Right Side of Body',
    category: 'Anatomical / Laterality',
    whenToUse: 'Procedure performed on right paired anatomical structure; ensure paired ICD-10-CM diagnosis reflects right or bilateral laterality.',
    avoidWhen: 'Do not pair with left-only ICD-10-CM code or combine with -LT on a single line (use -50 or two lines per payer policy).',
    commonDenialsFixed: ['CO-4', 'CO-16', 'M76'],
  },
  {
    code: 'LT',
    title: 'Left Side of Body',
    category: 'Anatomical / Laterality',
    whenToUse: 'Procedure performed on left paired anatomical structure; ensure paired ICD-10-CM diagnosis reflects left or bilateral laterality.',
    avoidWhen: 'Do not pair with right-only ICD-10-CM code or combine with -RT on a single line.',
    commonDenialsFixed: ['CO-4', 'CO-16', 'M76'],
  },
  {
    code: '51',
    title: 'Multiple Procedures',
    category: 'E/M & Global',
    whenToUse: 'Secondary surgical procedures performed at the same session (note: most Medicare/commercial payers auto-apply multiple procedure reductions; avoid on add-on codes).',
    avoidWhen: 'Never append to add-on (+ZZZ) codes or E/M codes.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: '52',
    title: 'Reduced Services',
    category: 'E/M & Global',
    whenToUse: 'Service partially reduced or eliminated at physician discretion (e.g., unilateral performance of an inherently bilateral code).',
    avoidWhen: 'Do not use when procedure was terminated due to patient risk after anesthesia/prep (use -53).',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: '53',
    title: 'Discontinued Procedure',
    category: 'E/M & Global',
    whenToUse: 'Surgical/diagnostic procedure stopped after start due to extenuating circumstances threatening patient well-being (e.g., incomplete colonoscopy).',
    avoidWhen: 'Do not use for elective cancellation prior to induction/prep.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: '58',
    title: 'Staged or Related Procedure by Same Physician During Post-Op Period',
    category: 'E/M & Global',
    whenToUse: 'Planned/staged or more extensive procedure during the postoperative period of an earlier surgery.',
    avoidWhen: 'Do not use for unplanned return to OR for complication (use -78).',
    commonDenialsFixed: ['CO-97'],
  },
  {
    code: '76',
    title: 'Repeat Procedure or Service by Same Physician',
    category: 'E/M & Global',
    whenToUse: 'Exact same procedure legitimately repeated on the same date of service by the same physician (e.g., serial ECGs 93000).',
    avoidWhen: 'Do not use for bilateral procedures (use -50 or -RT/-LT) or duplicate billing errors.',
    commonDenialsFixed: ['CO-18', 'OA-18'],
  },
  {
    code: '77',
    title: 'Repeat Procedure by Another Physician',
    category: 'E/M & Global',
    whenToUse: 'Same procedure legitimately repeated on the same day by a different physician.',
    avoidWhen: 'Do not use for split/shared visits.',
    commonDenialsFixed: ['CO-18'],
  },
  {
    code: '78',
    title: 'Unplanned Return to OR/Procedure Room for Related Procedure During Post-Op Period',
    category: 'E/M & Global',
    whenToUse: 'Surgical complication requiring return to the operating/procedure room during global period.',
    avoidWhen: 'Do not use for unrelated surgery on different body part (use -79).',
    commonDenialsFixed: ['CO-97'],
  },
  {
    code: '79',
    title: 'Unrelated Procedure or Service by Same Physician During Post-Op Period',
    category: 'E/M & Global',
    whenToUse: 'Unrelated surgical procedure performed during an active postoperative period.',
    avoidWhen: 'Do not use on E/M codes (use -24 on E/M).',
    commonDenialsFixed: ['CO-97'],
  },
  {
    code: '95',
    title: 'Synchronous Telemedicine Service via Real-Time Interactive Audio and Video',
    category: 'Telehealth',
    whenToUse: 'Commercial/applicable payer synchronous audio-video telehealth visits with appropriate POS (02 or 10).',
    avoidWhen: 'Do not append to audio-only visits (use -93 or -FQ) or asynchronous store-and-forward.',
    commonDenialsFixed: ['CO-4', 'CO-B9'],
  },
  {
    code: '93',
    title: 'Synchronous Telemedicine Service via Real-Time Interactive Audio-Only',
    category: 'Telehealth',
    whenToUse: 'Eligible real-time telephone/audio-only medical services when video is unavailable or patient cannot use video.',
    avoidWhen: 'Verify payer allowlist before appending to standard office E/M codes.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: 'GT',
    title: 'Via Interactive Audio and Video Telecommunications Systems',
    category: 'Telehealth',
    whenToUse: 'Institutional/CAH Method II or Medicaid/payer-specific synchronous telehealth modifier.',
    avoidWhen: 'Check payer preference between -95 vs -GT vs POS 02/10 alone.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: 'FQ',
    title: 'Telehealth Service Furnished Using Audio-Only Communication Technology',
    category: 'Telehealth',
    whenToUse: 'Medicare behavioral health / eligible telehealth furnished via audio-only.',
    avoidWhen: 'Do not use when full audio-video was used.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: 'JW',
    title: 'Drug Amount Discarded / Not Administered to Any Patient',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Report on a second J-code claim line for discarded units from a single-dose vial/package.',
    avoidWhen: 'Never use on multi-dose vials or alongside -JZ on the same drug administration.',
    commonDenialsFixed: ['CO-4', 'CO-16'],
  },
  {
    code: 'JZ',
    title: 'Zero Drug Amount Discarded / Not Administered to Any Patient',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Mandatory on single-dose container J-code claims when NO drug was discarded (CMS rule).',
    avoidWhen: 'Never use on multi-dose containers or when waste is billed on a -JW line.',
    commonDenialsFixed: ['CO-4', 'CO-16', 'MA130'],
  },
  {
    code: 'KX',
    title: 'Requirements Specified in the Medical Policy Have Been Met',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Attests medical necessity documentation is on file (e.g., therapy threshold exceptions, DME coverage criteria).',
    avoidWhen: 'Never append unless clinical chart objectively meets LCD/NCD policy criteria.',
    commonDenialsFixed: ['CO-50', 'CO-119', 'CO-151'],
  },
  {
    code: 'GA',
    title: 'Waiver of Liability Statement Issued as Required by Payer Policy (ABN on File)',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Signed valid Advance Beneficiary Notice (ABN) is on file for a service expected to be denied as not medically necessary; shifts liability to PR.',
    avoidWhen: 'Do not use without a signed, specific ABN dated prior to service.',
    commonDenialsFixed: ['CO-50'],
  },
  {
    code: 'GZ',
    title: 'Item or Service Expected to Be Denied as Not Reasonable and Necessary (No ABN)',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Service likely fails LCD/NCD medical necessity and NO signed ABN was obtained (CO write-off).',
    avoidWhen: 'Use -GA instead if a valid signed ABN exists.',
    commonDenialsFixed: ['CO-50'],
  },
  {
    code: 'GY',
    title: 'Item or Service Statutorily Excluded / Does Not Meet Definition of Any Medicare Benefit',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Triggers statutory denial so secondary commercial insurance can be billed.',
    avoidWhen: 'Do not use for medical-necessity LCD denials of otherwise covered benefits.',
    commonDenialsFixed: ['CO-96', 'PR-96'],
  },
  {
    code: 'QW',
    title: 'CLIA Waived Test',
    category: 'Component / Lab',
    whenToUse: 'Required on CLIA-waived point-of-care lab tests (e.g., 87880-QW strep, 87804-QW flu, 81002 non-QW exception, 83036-QW A1c) for offices holding a CLIA Certificate of Waiver.',
    avoidWhen: 'Do not append to 81002, 81025, 82270, 82962, 84830, 85013, or 85651 which CMS exempts from -QW.',
    commonDenialsFixed: ['CO-4', 'CO-B7', 'MA120'],
  },
  {
    code: '91',
    title: 'Repeat Clinical Diagnostic Laboratory Test',
    category: 'Component / Lab',
    whenToUse: 'Same clinical lab test repeated multiple times on same day to obtain sequential test values (e.g., serial troponin or potassium).',
    avoidWhen: 'Never use for rerun due to specimen/equipment error or to unbundle lab panels (e.g., 80048 + 80053).',
    commonDenialsFixed: ['CO-18', 'CO-151'],
  },
  {
    code: '33',
    title: 'Preventive Service (ACA Zero Cost-Sharing)',
    category: 'Drug / ABN / Policy',
    whenToUse: 'Commercial claims for USPSTF Grade A/B preventive service (e.g., screening colonoscopy converted to polypectomy where applicable).',
    avoidWhen: 'Do not use when service was diagnostic for active symptoms from the outset.',
    commonDenialsFixed: ['PR-1', 'PR-2'],
  },
  {
    code: '22',
    title: 'Increased Procedural Services',
    category: 'E/M & Global',
    whenToUse: 'Substantially greater surgical work than typically required (attach operative report + concise % complexity statement).',
    avoidWhen: 'Never append to E/M codes.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: 'GP',
    title: 'Services Delivered Under an Outpatient Physical Therapy Plan of Care',
    category: 'Therapy',
    whenToUse: 'Required on outpatient PT codes (97110, 97140, 97530, 97161–97164) for Medicare and aligned commercial payers.',
    avoidWhen: 'Do not combine GP, GO, and GN on the same claim line.',
    commonDenialsFixed: ['CO-4', 'CO-16'],
  },
  {
    code: 'GO',
    title: 'Services Delivered Under an Outpatient Occupational Therapy Plan of Care',
    category: 'Therapy',
    whenToUse: 'Required on outpatient OT therapy codes.',
    avoidWhen: 'Do not combine with GP or GN on the same line.',
    commonDenialsFixed: ['CO-4', 'CO-16'],
  },
  {
    code: 'GN',
    title: 'Services Delivered Under an Outpatient Speech-Language Pathology Plan of Care',
    category: 'Therapy',
    whenToUse: 'Required on outpatient SLP therapy codes (92507, 92526).',
    avoidWhen: 'Do not combine with GP or GO on the same line.',
    commonDenialsFixed: ['CO-4', 'CO-16'],
  },
  {
    code: 'FA',
    title: 'Left Hand, Thumb',
    category: 'Anatomical / Laterality',
    whenToUse: 'Digit-specific procedure on left thumb (F1–F4 for left digits 2–5; F5–F9 for right thumb/digits).',
    avoidWhen: 'Use specific digit modifier rather than generic -LT/-RT when digit modifiers apply.',
    commonDenialsFixed: ['CO-4'],
  },
  {
    code: 'TA',
    title: 'Left Foot, Great Toe',
    category: 'Anatomical / Laterality',
    whenToUse: 'Podiatry/orthopedic digit-specific procedure on left great toe (T1–T4 left toes 2–5; T5–T9 right great toe/toes).',
    avoidWhen: 'Ensure toe/laterality matches ICD-10-CM diagnosis.',
    commonDenialsFixed: ['CO-4'],
  },
];

export const PROCEDURE_REFERENCE: ProcedureCodeInfo[] = [
  // === E/M OFFICE & OUTPATIENT ===
  {
    code: '99202',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient New Patient',
    shortDescriptor: 'Office/outpatient visit, new patient, straightforward MDM (15–29 min)',
    clinicalSummary: 'New patient outpatient evaluation with straightforward medical decision making or 15–29 minutes total clinician time.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '95', '93'],
    typicalDxPrefixes: ['A', 'B', 'E', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'R', 'S', 'Z'],
    codingTips: ['Verify patient has not received face-to-face professional services from same specialty/group within past 3 years.', 'Append -25 if a separate same-day minor procedure is also billed.'],
    isEM: true,
  },
  {
    code: '99203',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient New Patient',
    shortDescriptor: 'Office/outpatient visit, new patient, low MDM (30–44 min)',
    clinicalSummary: 'New patient outpatient evaluation with low complexity MDM or 30–44 minutes total clinician time.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '95', '93'],
    typicalDxPrefixes: ['A', 'B', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'R', 'S'],
    codingTips: ['Document 2 of 3 MDM elements at Low level (e.g., 1 acute uncomplicated illness, limited data review, low risk Rx/OTC) or total time.', 'Append -25 when performed alongside same-day minor procedure.'],
    isEM: true,
  },
  {
    code: '99204',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient New Patient',
    shortDescriptor: 'Office/outpatient visit, new patient, moderate MDM (45–59 min)',
    clinicalSummary: 'New patient outpatient evaluation with moderate complexity MDM (prescription drug management, 1 chronic illness w/ exacerbation, or undiagnosed new problem) or 45–59 min.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '57', '95'],
    typicalDxPrefixes: ['C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'M', 'N', 'R', 'S'],
    codingTips: ['Ensure ICD-10-CM specificity supports moderate MDM (avoid unspecified codes when clinical notes establish laterality/acuity).', 'Use -25 for minor procedures or -57 for decision for major 90-day surgery.'],
    isEM: true,
  },
  {
    code: '99205',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient New Patient',
    shortDescriptor: 'Office/outpatient visit, new patient, high MDM (60–74 min)',
    clinicalSummary: 'New patient outpatient evaluation with high complexity MDM (severe exacerbation, threat to life/bodily function, parenteral controlled substances, decision for emergency hospitalization) or 60–74 min.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '57', '95'],
    typicalDxPrefixes: ['C', 'E', 'G', 'I', 'J', 'K', 'N', 'R', 'S', 'T'],
    codingTips: ['High-audit E/M level: ensure acute severity/complication is captured in specific ICD-10-CM codes.'],
    isEM: true,
  },
  {
    code: '99212',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient Established Patient',
    shortDescriptor: 'Office/outpatient visit, established patient, straightforward MDM (10–19 min)',
    clinicalSummary: 'Established patient evaluation with straightforward MDM or 10–19 minutes total time.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '24', '95', '93'],
    typicalDxPrefixes: ['A', 'B', 'E', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'R', 'S', 'Z'],
    codingTips: ['Do not bill if patient is inside a 10/90-day surgical global period for a related postoperative check (bundled).'],
    isEM: true,
  },
  {
    code: '99213',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient Established Patient',
    shortDescriptor: 'Office/outpatient visit, established patient, low MDM (20–29 min)',
    clinicalSummary: 'Established patient evaluation with low complexity MDM (2+ stable chronic illnesses or 1 acute uncomplicated illness/injury) or 20–29 min.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '24', '95', '93'],
    typicalDxPrefixes: ['A', 'B', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'R', 'S', 'Z'],
    codingTips: ['Append -25 if billed on same day as injection (20610, 96372), lesion biopsy/destruction (11102, 17000), or cerumen removal (69210).', 'Consider G2211 add-on for longitudinal complex care relationship when applicable (Note: CMS prohibits G2211 when -25 is appended to the E/M!).'],
    isEM: true,
  },
  {
    code: '99214',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient Established Patient',
    shortDescriptor: 'Office/outpatient visit, established patient, moderate MDM (30–39 min)',
    clinicalSummary: 'Established patient evaluation with moderate MDM (prescription drug management, chronic illness w/ exacerbation/progression, or 2+ stable chronic illnesses + data) or 30–39 min.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '24', '57', '95', '93'],
    typicalDxPrefixes: ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'R', 'S'],
    codingTips: ['#1 denied code with CO-4/CO-97 when billed alongside a same-day procedure without modifier -25!', 'Do NOT bill G2211 on the same claim if 99214 carries modifier -25.'],
    isEM: true,
  },
  {
    code: '99215',
    codeSystem: 'CPT',
    category: 'E/M — Office/Outpatient Established Patient',
    shortDescriptor: 'Office/outpatient visit, established patient, high MDM (40–54 min)',
    clinicalSummary: 'Established patient evaluation with high complexity MDM or 40–54 minutes total clinician time on the date of encounter.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '24', '57', '95'],
    typicalDxPrefixes: ['C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'M', 'N', 'R', 'S', 'T'],
    codingTips: ['Ensure clinical note documents severe exacerbation/threat to life or explicit start/stop or total physician time >= 40 min.'],
    isEM: true,
  },
  // === PREVENTIVE & CARE MANAGEMENT ===
  {
    code: '99385',
    codeSystem: 'CPT',
    category: 'Preventive Medicine — New Patient',
    shortDescriptor: 'Initial comprehensive preventive medicine exam (18–39 years)',
    clinicalSummary: 'Age/gender-appropriate history, comprehensive wellness examination, and risk-factor reduction counseling (18–39 yr new patient).',
    globalPeriod: 'XXX',
    commonModifiers: ['33'],
    typicalDxPrefixes: ['Z00'],
    codingTips: ['Primary diagnosis should be Z00.00 (without abnormal findings) or Z00.01 (with abnormal findings).', 'If a separate problem-oriented E/M (99212–99215) is addressed on the same date, append -25 to the problem E/M and link problem ICD-10 to the sick visit.'],
    isPreventive: true,
  },
  {
    code: '99395',
    codeSystem: 'CPT',
    category: 'Preventive Medicine — Established Patient',
    shortDescriptor: 'Periodic comprehensive preventive medicine exam (18–39 years)',
    clinicalSummary: 'Established adult periodic preventive wellness exam (18–39 yr).',
    globalPeriod: 'XXX',
    commonModifiers: ['33'],
    typicalDxPrefixes: ['Z00'],
    codingTips: ['Link Z00.00 or Z00.01 as primary diagnosis; Medicare does not cover 99381–99397 (use G0438/G0439 AWV for Medicare).'],
    isPreventive: true,
  },
  {
    code: '99396',
    codeSystem: 'CPT',
    category: 'Preventive Medicine — Established Patient',
    shortDescriptor: 'Periodic comprehensive preventive medicine exam (40–64 years)',
    clinicalSummary: 'Established adult periodic preventive wellness exam (40–64 yr).',
    globalPeriod: 'XXX',
    commonModifiers: ['33'],
    typicalDxPrefixes: ['Z00'],
    codingTips: ['Require Z00.00 / Z00.01 primary diagnosis; append -25 to any separate problem E/M on same date.'],
    isPreventive: true,
  },
  {
    code: 'G0438',
    codeSystem: 'HCPCS',
    category: 'Medicare Wellness (HCPCS)',
    shortDescriptor: 'Annual wellness visit; includes personalized prevention plan of service (initial AWV)',
    clinicalSummary: 'Once-per-lifetime initial Medicare Annual Wellness Visit after first 12 months of Part B enrollment.',
    globalPeriod: 'XXX',
    commonModifiers: [],
    typicalDxPrefixes: ['Z00'],
    codingTips: ['Once per beneficiary lifetime! Subsequent years must be billed with G0439 (otherwise denied CO-151 / CO-18).'],
    isPreventive: true,
  },
  {
    code: 'G0439',
    codeSystem: 'HCPCS',
    category: 'Medicare Wellness (HCPCS)',
    shortDescriptor: 'Annual wellness visit, includes personalized prevention plan of service (subsequent AWV)',
    clinicalSummary: 'Subsequent Medicare Annual Wellness Visit (at least 11 full calendar months after prior AWV).',
    globalPeriod: 'XXX',
    commonModifiers: [],
    typicalDxPrefixes: ['Z00'],
    codingTips: ['Verify >=11 full months elapsed since prior G0438/G0439.', 'Append -25 to problem E/M (99213/99214) if medically necessary acute/chronic evaluation also performed.'],
    isPreventive: true,
  },
  {
    code: 'G2211',
    codeSystem: 'HCPCS',
    category: 'E/M Complexity Add-On (HCPCS)',
    shortDescriptor: 'Visit complexity inherent to evaluation and management associated with longitudinal/serious/complex care (add-on)',
    clinicalSummary: 'Outpatient E/M add-on code (list in addition to 99202–99215) for ongoing focal point or longitudinal serious/complex condition care.',
    globalPeriod: 'ADD-ON',
    commonModifiers: [],
    typicalDxPrefixes: ['C', 'D', 'E', 'F', 'G', 'I', 'J', 'K', 'M', 'N'],
    codingTips: ['CRITICAL NCCI/CMS EDIT: G2211 is DENIED when the companion E/M code (99202–99215) is reported with modifier -25 (except limited CMS preventive exceptions)!', 'Must always be billed alongside a base code 99202–99215.'],
    isAddOn: true,
    primaryBaseCodes: ['99202', '99203', '99204', '99205', '99212', '99213', '99214', '99215'],
  },
  {
    code: '99490',
    codeSystem: 'CPT',
    category: 'Chronic Care Management',
    shortDescriptor: 'Chronic care management services, first 20 minutes of clinical staff time per calendar month',
    clinicalSummary: 'Non-face-to-face CCM for patients with 2+ chronic conditions expected to last >=12 months.',
    globalPeriod: 'XXX',
    commonModifiers: [],
    typicalDxPrefixes: ['E', 'I', 'J', 'M', 'N', 'F', 'G'],
    codingTips: ['Requires at least TWO chronic condition ICD-10-CM diagnoses on the claim!'],
  },
  // === HOSPITAL / EMERGENCY / CRITICAL CARE ===
  {
    code: '99284',
    codeSystem: 'CPT',
    category: 'Emergency Department E/M',
    shortDescriptor: 'Emergency department visit, moderate MDM',
    clinicalSummary: 'ED evaluation and management requiring moderate level medical decision making.',
    globalPeriod: 'XXX',
    commonModifiers: ['25'],
    typicalDxPrefixes: ['A', 'E', 'I', 'J', 'K', 'N', 'R', 'S', 'T'],
    codingTips: ['Append -25 when ED physician also performs distinct minor procedure (e.g., laceration repair, fracture reduction, joint aspiration).'],
    isEM: true,
  },
  {
    code: '99285',
    codeSystem: 'CPT',
    category: 'Emergency Department E/M',
    shortDescriptor: 'Emergency department visit, high MDM',
    clinicalSummary: 'ED evaluation and management requiring high complexity medical decision making.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '57'],
    typicalDxPrefixes: ['A', 'C', 'E', 'G', 'I', 'J', 'K', 'N', 'R', 'S', 'T'],
    codingTips: ['Use specific acute ICD-10-CM diagnosis codes (avoid unspecified symptoms if definitive diagnosis established at discharge).'],
    isEM: true,
  },
  {
    code: '99291',
    codeSystem: 'CPT',
    category: 'Critical Care E/M',
    shortDescriptor: 'Critical care, evaluation and management of the critically ill/injured patient; first 30–74 minutes',
    clinicalSummary: 'Direct delivery of medical care for acute impairment of vital organ system with high probability of imminent life-threatening deterioration (30–74 min).',
    globalPeriod: 'XXX',
    commonModifiers: ['25'],
    typicalDxPrefixes: ['A41', 'I', 'J96', 'R57', 'S', 'T'],
    codingTips: ['Pulse oximetry (94760), chest X-ray interpretation (71045/71046), vascular access (36000/36415), and gastric intubation are BUNDLED into 99291!'],
    isEM: true,
  },
  // === ORTHOPEDICS / INJECTIONS / MINOR SURGERY ===
  {
    code: '20610',
    codeSystem: 'CPT',
    category: 'Musculoskeletal — Joint Aspiration/Injection',
    shortDescriptor: 'Arthrocentesis, aspiration and/or injection, major joint or bursa (shoulder, hip, knee, subacromial) without ultrasound',
    clinicalSummary: 'Major joint/bursa aspiration or corticosteroid/visco-supplementation injection without ultrasound guidance.',
    globalPeriod: '000',
    commonModifiers: ['RT', 'LT', '50', '59', 'XS'],
    typicalDxPrefixes: ['M15', 'M16', 'M17', 'M19', 'M25', 'M75', 'M70', 'S83', 'S43'],
    codingTips: ['Requires anatomical laterality modifier (-RT, -LT, or -50) matching the ICD-10-CM joint laterality!', 'Do NOT bill 76942 ultrasound guidance separately with 20610 — use 20611 when ultrasound guidance with permanent image recording is performed!', 'Remember to bill drug J-code (e.g., J3301, J1030) + -JZ/-JW modifier!'],
    requiresLaterality: true,
    isMinorProcedure: true,
  },
  {
    code: '20611',
    codeSystem: 'CPT',
    category: 'Musculoskeletal — Joint Aspiration/Injection',
    shortDescriptor: 'Arthrocentesis, aspiration and/or injection, major joint or bursa WITH ultrasound guidance and permanent recording',
    clinicalSummary: 'Major joint/bursa aspiration or injection including ultrasound guidance and image documentation.',
    globalPeriod: '000',
    commonModifiers: ['RT', 'LT', '50', 'XS'],
    typicalDxPrefixes: ['M16', 'M17', 'M19', 'M25', 'M75'],
    codingTips: ['76942 is bundled into 20611 (NCCI Indicator 0 for same joint)!', 'Requires permanent ultrasound image in chart + laterality modifier (-RT/-LT/-50).'],
    requiresLaterality: true,
    isMinorProcedure: true,
  },
  {
    code: '20605',
    codeSystem: 'CPT',
    category: 'Musculoskeletal — Joint Aspiration/Injection',
    shortDescriptor: 'Arthrocentesis, aspiration and/or injection, intermediate joint or bursa (ankle, elbow, wrist, TMJ, acromioclavicular) without ultrasound',
    clinicalSummary: 'Intermediate joint/bursa injection or aspiration without ultrasound.',
    globalPeriod: '000',
    commonModifiers: ['RT', 'LT', '50', 'XS'],
    typicalDxPrefixes: ['M19', 'M25', 'M77', 'S53', 'S63', 'S93'],
    codingTips: ['Pair with laterality modifier (-RT/-LT/-50) and specific joint ICD-10-CM code (avoid M25.5x9 unspecified side).'],
    requiresLaterality: true,
    isMinorProcedure: true,
  },
  {
    code: '96372',
    codeSystem: 'CPT',
    category: 'Therapeutic/Prophylactic Injections',
    shortDescriptor: 'Therapeutic, prophylactic, or diagnostic injection; subcutaneous or intramuscular',
    clinicalSummary: 'IM or SC administration of non-chemotherapy medication/biological (e.g., B12, ketorolac, ceftriaxone, biologics).',
    globalPeriod: 'XXX',
    commonModifiers: ['59', 'XE', 'XS'],
    typicalDxPrefixes: ['A', 'D', 'E', 'G', 'J', 'M', 'N', 'R'],
    codingTips: ['Must also bill the corresponding HCPCS J-code (or document patient-supplied medication)!', 'If billed with an office E/M (99212–99215), Medicare bundles 96372 unless the E/M is separately identifiable (-25 on E/M).'],
    isMinorProcedure: true,
  },
  {
    code: '11102',
    codeSystem: 'CPT',
    category: 'Integumentary — Biopsy',
    shortDescriptor: 'Tangential biopsy of skin (shave, scoop, saucerize, curette); single lesion',
    clinicalSummary: 'Tangential skin biopsy of first/single lesion.',
    globalPeriod: '000',
    commonModifiers: ['59', 'XS'],
    typicalDxPrefixes: ['C43', 'C44', 'D04', 'D22', 'D23', 'D48', 'L57', 'L82', 'L98'],
    codingTips: ['For each additional tangential biopsy lesion on same day, use add-on +11103 (do NOT bill 2 units of 11102!).', 'Append -25 to same-day E/M only if evaluation was separate from biopsy decision on known lesion.'],
    isMinorProcedure: true,
  },
  {
    code: '11104',
    codeSystem: 'CPT',
    category: 'Integumentary — Biopsy',
    shortDescriptor: 'Punch biopsy of skin (including simple closure, when performed); single lesion',
    clinicalSummary: 'Full-thickness punch skin biopsy including simple suture closure.',
    globalPeriod: '000',
    commonModifiers: ['59', 'XS'],
    typicalDxPrefixes: ['C43', 'C44', 'D22', 'D23', 'D48', 'L40', 'L82', 'L98'],
    codingTips: ['Simple closure (12001–12018) is BUNDLED into 11104!', 'If both tangential and punch biopsy performed on separate lesions, bill 11104 + add-on 11103 (NOT 11102 + 11104!).'],
    isMinorProcedure: true,
  },
  {
    code: '17000',
    codeSystem: 'CPT',
    category: 'Integumentary — Destruction Premalignant Lesions',
    shortDescriptor: 'Destruction (cryosurgery, laser, electrosurgery) of premalignant lesions (e.g., actinic keratoses); first lesion',
    clinicalSummary: 'Destruction of first premalignant lesion (typically L57.0 actinic keratosis).',
    globalPeriod: '010',
    commonModifiers: ['59', 'XS'],
    typicalDxPrefixes: ['L57', 'D48'],
    codingTips: ['Use +17003 for lesions 2–14; if 15 or more premalignant lesions are destroyed, bill 17004 ALONE (never bill 17000/17003 together with 17004!).'],
    isMinorProcedure: true,
  },
  {
    code: '17004',
    codeSystem: 'CPT',
    category: 'Integumentary — Destruction Premalignant Lesions',
    shortDescriptor: 'Destruction of premalignant lesions (actinic keratoses), 15 or more lesions',
    clinicalSummary: 'Standalone code for destruction of >=15 premalignant skin lesions.',
    globalPeriod: '010',
    commonModifiers: [],
    typicalDxPrefixes: ['L57'],
    codingTips: ['NCCI Indicator 0 with 17000 and 17003 — NEVER report 17004 with 17000 or 17003 on the same date!'],
    isMinorProcedure: true,
  },
  {
    code: '11042',
    codeSystem: 'CPT',
    category: 'Integumentary — Wound Debridement',
    shortDescriptor: 'Debridement, subcutaneous tissue (includes epidermis and dermis); first 20 sq cm or less',
    clinicalSummary: 'Surgical excisional wound debridement into subcutaneous tissue up to 20 sq cm.',
    globalPeriod: '000',
    commonModifiers: ['59', 'XS'],
    typicalDxPrefixes: ['E11', 'I70', 'I87', 'L89', 'L97', 'L98', 'S', 'T'],
    codingTips: ['Document pre- and post-debridement wound dimensions (length x width x depth) and tissue layer removed!', 'For diabetic/chronic ulcers (E11.621 + L97.*), follow Use Additional Code rules for ulcer site & severity!'],
    isMinorProcedure: true,
  },
  {
    code: '69210',
    codeSystem: 'CPT',
    category: 'ENT — Cerumen Removal',
    shortDescriptor: 'Removal impacted cerumen requiring instrumentation, unilateral',
    clinicalSummary: 'Physician/QHP instrumented removal of impacted cerumen (H61.21, H61.22, H61.23).',
    globalPeriod: '000',
    commonModifiers: ['50', 'RT', 'LT'],
    typicalDxPrefixes: ['H61'],
    codingTips: ['Requires impacted cerumen diagnosis (H61.21 right, H61.22 left, H61.23 bilateral — avoid H61.20 unspecified!).', 'Simple ear irrigation/lavage without instrumentation does NOT qualify for 69210.'],
    requiresLaterality: true,
    isMinorProcedure: true,
  },
  {
    code: '29881',
    codeSystem: 'CPT',
    category: 'Orthopedic Surgery — Knee Arthroscopy',
    shortDescriptor: 'Arthroscopy, knee, surgical; with meniscectomy (medial OR lateral), including meniscal shaving/debridement',
    clinicalSummary: 'Arthroscopic medial OR lateral knee meniscectomy (includes chondroplasty 29877 in any compartment).',
    globalPeriod: '090',
    commonModifiers: ['RT', 'LT', '50'],
    typicalDxPrefixes: ['M23', 'S83'],
    codingTips: ['29877 (chondroplasty) is BUNDLED into 29881!', 'If BOTH medial AND lateral meniscectomy performed on same knee, bill 29880 instead of 29881!'],
    requiresLaterality: true,
  },
  {
    code: '29877',
    codeSystem: 'CPT',
    category: 'Orthopedic Surgery — Knee Arthroscopy',
    shortDescriptor: 'Arthroscopy, knee, surgical; debridement/shaving of articular cartilage (chondroplasty)',
    clinicalSummary: 'Arthroscopic knee chondroplasty when no other major arthroscopic knee surgery is performed.',
    globalPeriod: '090',
    commonModifiers: ['RT', 'LT', 'XS'],
    typicalDxPrefixes: ['M17', 'M22', 'M23', 'M94'],
    codingTips: ['Bundled into 29880/29881 on the same knee! Only unbundle with -XS/-59 if performed on the CONTRALATERAL knee.'],
    requiresLaterality: true,
  },
  // === GI ENDOSCOPY ===
  {
    code: '45378',
    codeSystem: 'CPT',
    category: 'GI — Colonoscopy',
    shortDescriptor: 'Colonoscopy, flexible; diagnostic, including collection of specimen(s) by brushing or washing',
    clinicalSummary: 'Diagnostic or screening flexible colonoscopy without biopsy or polypectomy.',
    globalPeriod: '000',
    commonModifiers: ['33', '53', 'PT'],
    typicalDxPrefixes: ['Z12', 'K50', 'K51', 'K57', 'K62', 'K63', 'R19', 'D12'],
    codingTips: ['Bundled into therapeutic colonoscopy codes (45380 biopsy, 45385 snare polypectomy) — never bill 45378 alongside 45380 or 45385!'],
    isMinorProcedure: true,
  },
  {
    code: '45380',
    codeSystem: 'CPT',
    category: 'GI — Colonoscopy',
    shortDescriptor: 'Colonoscopy, flexible; with biopsy, single or multiple',
    clinicalSummary: 'Colonoscopy with cold/forceps mucosal biopsy.',
    globalPeriod: '000',
    commonModifiers: ['33', '59', 'XS', 'PT'],
    typicalDxPrefixes: ['D12', 'K50', 'K51', 'K52', 'K57', 'K63', 'Z12'],
    codingTips: ['If snare polypectomy (45385) is ALSO performed on a DIFFERENT lesion/polyp, append -XS or -59 to 45380; if same lesion, bill 45385 only.'],
    isMinorProcedure: true,
  },
  {
    code: '45385',
    codeSystem: 'CPT',
    category: 'GI — Colonoscopy',
    shortDescriptor: 'Colonoscopy, flexible; with removal of tumor(s), polyp(s), or other lesion(s) by snare technique',
    clinicalSummary: 'Colonoscopy with snare polypectomy.',
    globalPeriod: '000',
    commonModifiers: ['33', 'PT'],
    typicalDxPrefixes: ['D12', 'K63', 'Z12', 'Z86'],
    codingTips: ['For screening colonoscopy converted to snare polypectomy: sequence Z12.11 primary + D12.* polyp secondary and append -PT (Medicare) or -33 (Commercial).'],
    isMinorProcedure: true,
  },
  {
    code: '43235',
    codeSystem: 'CPT',
    category: 'GI — Upper Endoscopy (EGD)',
    shortDescriptor: 'Esophagogastroduodenoscopy (EGD), flexible, transoral; diagnostic',
    clinicalSummary: 'Diagnostic upper GI endoscopy without biopsy.',
    globalPeriod: '000',
    commonModifiers: ['52', '53'],
    typicalDxPrefixes: ['K20', 'K21', 'K22', 'K25', 'K29', 'R10', 'R13'],
    codingTips: ['Bundled into 43239 (EGD with biopsy) — never report 43235 and 43239 together for the same session!'],
    isMinorProcedure: true,
  },
  {
    code: '43239',
    codeSystem: 'CPT',
    category: 'GI — Upper Endoscopy (EGD)',
    shortDescriptor: 'Esophagogastroduodenoscopy (EGD), flexible, transoral; with biopsy, single or multiple',
    clinicalSummary: 'Upper GI endoscopy with single or multiple biopsies.',
    globalPeriod: '000',
    commonModifiers: ['59'],
    typicalDxPrefixes: ['K20', 'K21', 'K22', 'K25', 'K29', 'K90', 'R10', 'R13'],
    codingTips: ['Report 1 unit regardless of how many biopsies are taken during the EGD.'],
    isMinorProcedure: true,
  },
  // === CARDIOLOGY & RADIOLOGY ===
  {
    code: '93000',
    codeSystem: 'CPT',
    category: 'Cardiology — Electrocardiogram',
    shortDescriptor: 'Electrocardiogram, routine ECG with at least 12 leads; with interpretation and report (global)',
    clinicalSummary: 'Global 12-lead ECG (both tracing and physician interpretation/report).',
    globalPeriod: 'XXX',
    commonModifiers: ['76', '77', '59'],
    typicalDxPrefixes: ['I10', 'I20', 'I25', 'I47', 'I48', 'I49', 'I50', 'R00', 'R06', 'R07', 'R55'],
    codingTips: ['Do NOT append -26 or -TC to 93000! For tracing only use 93005; for interpretation/report only (e.g., ED/hospital read) use 93010.', 'Never bill 93000 alongside 93005 or 93010 for the same ECG!'],
  },
  {
    code: '93010',
    codeSystem: 'CPT',
    category: 'Cardiology — Electrocardiogram',
    shortDescriptor: 'Electrocardiogram, routine ECG with at least 12 leads; interpretation and report only',
    clinicalSummary: 'Professional interpretation and written report of 12-lead ECG.',
    globalPeriod: 'XXX',
    commonModifiers: ['76', '77'],
    typicalDxPrefixes: ['I', 'R00', 'R07', 'R55'],
    codingTips: ['Inherently professional-only — do NOT append -26 to 93010!'],
  },
  {
    code: '93306',
    codeSystem: 'CPT',
    category: 'Cardiology — Echocardiography',
    shortDescriptor: 'Echocardiography, transthoracic, real-time 2D with M-mode, complete, WITH spectral and color flow Doppler',
    clinicalSummary: 'Complete transthoracic echocardiogram (TTE) including spectral and color flow Doppler.',
    globalPeriod: 'XXX',
    commonModifiers: ['26', 'TC'],
    typicalDxPrefixes: ['I10', 'I11', 'I25', 'I34', 'I35', 'I42', 'I48', 'I50', 'R01', 'R06', 'R07'],
    codingTips: ['Append -26 when interpreting hospital-owned echo; never bill 93320 or 93325 add-ons separately since spectral/color Doppler are already included in 93306!'],
  },
  {
    code: '71045',
    codeSystem: 'CPT',
    category: 'Radiology — Chest Imaging',
    shortDescriptor: 'Radiologic examination, chest; single view',
    clinicalSummary: '1-view chest X-ray (AP or PA).',
    globalPeriod: 'XXX',
    commonModifiers: ['26', 'TC', '76', '77'],
    typicalDxPrefixes: ['I50', 'J06', 'J18', 'J20', 'J44', 'J45', 'J96', 'R05', 'R06', 'R07', 'R91'],
    codingTips: ['Bundled into 71046 (2-view chest X-ray) unless performed at a separate clinical encounter on the same day (-XE/-76).'],
  },
  {
    code: '71046',
    codeSystem: 'CPT',
    category: 'Radiology — Chest Imaging',
    shortDescriptor: 'Radiologic examination, chest; 2 views',
    clinicalSummary: '2-view chest X-ray (typically PA and lateral).',
    globalPeriod: 'XXX',
    commonModifiers: ['26', 'TC', '76'],
    typicalDxPrefixes: ['C34', 'I50', 'J18', 'J44', 'J45', 'R05', 'R06', 'R07', 'R91'],
    codingTips: ['Do not report both -26 and -TC on the same claim line; report global 71046 if clinic owns X-ray and performs read.'],
  },
  {
    code: '72148',
    codeSystem: 'CPT',
    category: 'Radiology — Spine MRI',
    shortDescriptor: 'Magnetic resonance (MRI), spinal canal and contents, lumbar; without contrast material',
    clinicalSummary: 'Lumbar spine MRI without IV contrast.',
    globalPeriod: 'XXX',
    commonModifiers: ['26', 'TC'],
    typicalDxPrefixes: ['M47', 'M48', 'M51', 'M54', 'G83', 'S32', 'S34'],
    codingTips: ['High prior-authorization scrutiny: ensure conservative therapy duration or red-flag radiculopathy/neurologic deficit ICD-10-CM (e.g., M54.16, M51.16) is documented rather than M54.50 alone when applicable.'],
  },
  {
    code: '74177',
    codeSystem: 'CPT',
    category: 'Radiology — CT Abdomen & Pelvis',
    shortDescriptor: 'Computed tomography (CT), abdomen and pelvis; with contrast material(s)',
    clinicalSummary: 'Combined CT abdomen and pelvis with IV contrast.',
    globalPeriod: 'XXX',
    commonModifiers: ['26', 'TC'],
    typicalDxPrefixes: ['C', 'K35', 'K56', 'K57', 'K80', 'N13', 'N20', 'R10', 'R31', 'S36'],
    codingTips: ['Never unbundle into separate CT abdomen (74160) + CT pelvis (72193) — combined 74177 is mandatory!'],
  },
  {
    code: '76942',
    codeSystem: 'CPT',
    category: 'Radiology — Ultrasound Guidance',
    shortDescriptor: 'Ultrasonic guidance for needle placement (biopsy, aspiration, injection), imaging supervision and interpretation',
    clinicalSummary: 'Ultrasound needle guidance when NOT already bundled into the primary injection/biopsy code.',
    globalPeriod: 'XXX',
    commonModifiers: ['26', 'TC', '59', 'XS'],
    typicalDxPrefixes: ['C', 'D', 'E04', 'M', 'N'],
    codingTips: ['CRITICAL BUNDLING TRAP: NEVER bill 76942 with 20604, 20606, or 20611 (ultrasound is already built in) or with 20600, 20605, 20610 (switch to 20604/20606/20611 instead)!'],
  },
  // === LABORATORY & VENIPUNCTURE ===
  {
    code: '36415',
    codeSystem: 'CPT',
    category: 'Pathology/Lab — Venipuncture',
    shortDescriptor: 'Collection of venous blood by venipuncture',
    clinicalSummary: 'Routine peripheral blood draw.',
    globalPeriod: 'XXX',
    commonModifiers: [],
    typicalDxPrefixes: ['D', 'E', 'I', 'K', 'N', 'R', 'Z'],
    codingTips: ['Report 1 unit per encounter regardless of number of tubes drawn.', 'Check commercial payer bundling policies when billed without an in-house lab or during critical care (99291).'],
  },
  {
    code: '80048',
    codeSystem: 'CPT',
    category: 'Pathology/Lab — Organ/Disease Panels',
    shortDescriptor: 'Basic metabolic panel (BMP — Calcium total)',
    clinicalSummary: '8-component chemistry panel (BUN, Ca, CO2, Cl, Cr, Glucose, K, Na).',
    globalPeriod: 'XXX',
    commonModifiers: ['90', '91'],
    typicalDxPrefixes: ['E11', 'E86', 'E87', 'I10', 'I50', 'N17', 'N18', 'R'],
    codingTips: ['NCCI Indicator 0 with 80053 (CMP): NEVER bill 80048 and 80053 on the same date — all 8 BMP analytes are included inside 80053!'],
  },
  {
    code: '80053',
    codeSystem: 'CPT',
    category: 'Pathology/Lab — Organ/Disease Panels',
    shortDescriptor: 'Comprehensive metabolic panel (CMP — 14 analytes)',
    clinicalSummary: '14-component chemistry + hepatic panel (includes entire BMP 80048 + Albumin, Total Protein, ALP, ALT, AST, Total Bilirubin).',
    globalPeriod: 'XXX',
    commonModifiers: ['90', '91'],
    typicalDxPrefixes: ['E11', 'E78', 'I10', 'K70', 'K76', 'N18', 'R', 'Z79'],
    codingTips: ['Bundled with 80048 (BMP) and 80076 (Hepatic function panel) — report 80053 alone!'],
  },
  {
    code: '80061',
    codeSystem: 'CPT',
    category: 'Pathology/Lab — Organ/Disease Panels',
    shortDescriptor: 'Lipid panel (Total cholesterol, HDL, Triglycerides)',
    clinicalSummary: 'Standard fasting/non-fasting lipid panel.',
    globalPeriod: 'XXX',
    commonModifiers: ['QW', '90'],
    typicalDxPrefixes: ['E11', 'E66', 'E78', 'I10', 'I25', 'Z13'],
    codingTips: ['Check Medicare NCD 190.23 frequency limits (once every 5 years for asymptomatic Z13.220 screening vs medically necessary E78.* dyslipidemia monitoring).'],
  },
  {
    code: '83036',
    codeSystem: 'CPT',
    category: 'Pathology/Lab — Chemistry',
    shortDescriptor: 'Hemoglobin; glycosylated (A1C)',
    clinicalSummary: 'Glycated hemoglobin HbA1c test for diabetes diagnosis or glycemic control monitoring.',
    globalPeriod: 'XXX',
    commonModifiers: ['QW', '90'],
    typicalDxPrefixes: ['E08', 'E09', 'E10', 'E11', 'E13', 'R73', 'O24', 'Z13'],
    codingTips: ['Append -QW if performed on a point-of-care CLIA-waived analyzer!', 'Verify Medicare NCD 190.21 frequency (every 3 months for uncontrolled/insulin-treated E11.65; twice yearly for stable E11.9).'],
  },
  {
    code: '85025',
    codeSystem: 'CPT',
    category: 'Pathology/Lab — Hematology',
    shortDescriptor: 'Blood count; complete (CBC), automated and automated differential WBC count',
    clinicalSummary: 'Complete blood count with automated 5-part WBC differential.',
    globalPeriod: 'XXX',
    commonModifiers: ['90', '91'],
    typicalDxPrefixes: ['A', 'B', 'C', 'D50', 'D64', 'D69', 'D72', 'J', 'N', 'R50', 'R53', 'Z79'],
    codingTips: ['Never bill 85025 together with 85027 (CBC without diff) on the same specimen!'],
  },
  {
    code: '94760',
    codeSystem: 'CPT',
    category: 'Pulmonary — Pulse Oximetry',
    shortDescriptor: 'Noninvasive ear or pulse oximetry for oxygen saturation; single determination',
    clinicalSummary: 'Spot pulse oximetry reading.',
    globalPeriod: 'XXX',
    commonModifiers: [],
    typicalDxPrefixes: ['J', 'I50', 'R06', 'R09'],
    codingTips: ['BUNDLED into ALL E/M services (99202–99215, 99281–99285, 99291) by Medicare & most commercial payers (Status T / NCCI bundled)! Do not bill separately with an office E/M.'],
  },
  // === PHYSICAL / OCCUPATIONAL THERAPY & BEHAVIORAL HEALTH ===
  {
    code: '97110',
    codeSystem: 'CPT',
    category: 'Physical Medicine & Rehabilitation',
    shortDescriptor: 'Therapeutic procedure, 1 or more areas, each 15 minutes; therapeutic exercises to develop strength/endurance/ROM/flexibility',
    clinicalSummary: 'Timed 15-minute constant-attendance therapeutic exercise (8-minute rule applies for Medicare).',
    globalPeriod: 'XXX',
    commonModifiers: ['GP', 'GO', 'KX', '59', 'XE'],
    typicalDxPrefixes: ['M', 'S', 'G81', 'G82', 'I69', 'Z96'],
    codingTips: ['Requires therapy plan-of-care modifier (-GP for PT or -GO for OT) and total timed treatment minutes documented in note!', 'Append -KX when exceeding annual Medicare therapy threshold with documented medical necessity.'],
  },
  {
    code: '97140',
    codeSystem: 'CPT',
    category: 'Physical Medicine & Rehabilitation',
    shortDescriptor: 'Manual therapy techniques (mobilization/manipulation, manual lymphatic drainage, manual traction), 1 or more regions, each 15 minutes',
    clinicalSummary: 'Timed 15-minute skilled manual therapy.',
    globalPeriod: 'XXX',
    commonModifiers: ['GP', 'GO', 'KX', '59', 'XS'],
    typicalDxPrefixes: ['M25', 'M47', 'M51', 'M54', 'M75', 'S'],
    codingTips: ['Bundled with chiropractic manipulation (98940–98942) in the same anatomic region unless performed on a separate body region (-59/-XS)!', 'Requires -GP or -GO modifier.'],
  },
  {
    code: '90837',
    codeSystem: 'CPT',
    category: 'Behavioral Health — Psychotherapy',
    shortDescriptor: 'Psychotherapy, 60 minutes with patient (53+ minutes)',
    clinicalSummary: 'Individual outpatient psychotherapy session lasting >=53 minutes.',
    globalPeriod: 'XXX',
    commonModifiers: ['95', '93', 'FQ'],
    typicalDxPrefixes: ['F20', 'F31', 'F32', 'F33', 'F41', 'F43', 'F90'],
    codingTips: ['Cannot be billed by a prescribing MD/NP alongside an E/M visit (99213/99214) — prescribers must use psychotherapy add-on +90838 (+90833/+90836) instead of standalone 90837!'],
  },
  // === OPHTHALMOLOGY ===
  {
    code: '92014',
    codeSystem: 'CPT',
    category: 'Ophthalmology — Comprehensive Eye Services',
    shortDescriptor: 'Ophthalmological services: medical examination and evaluation, with initiation/continuation of diagnostic and treatment program; comprehensive, established patient',
    clinicalSummary: 'Comprehensive medical eye exam for established patient.',
    globalPeriod: 'XXX',
    commonModifiers: ['25', '24'],
    typicalDxPrefixes: ['H00', 'H04', 'H10', 'H25', 'H26', 'H35', 'H40', 'H52', 'E11'],
    codingTips: ['Cannot be billed on the same date as a standard E/M visit (99212–99215) by the same provider!', 'Ensure eye laterality is specified on H-chapter diagnoses (e.g., H40.1111 right, H40.1121 left, H40.1131 bilateral).'],
  },
  {
    code: '66984',
    codeSystem: 'CPT',
    category: 'Ophthalmology — Cataract Surgery',
    shortDescriptor: 'Extracapsular cataract removal with insertion of intraocular lens prosthesis (1 stage procedure), manual or mechanical technique',
    clinicalSummary: 'Standard cataract extraction with IOL implantation.',
    globalPeriod: '090',
    commonModifiers: ['RT', 'LT', '55', '54', '79'],
    typicalDxPrefixes: ['H25', 'H26'],
    codingTips: ['Requires eye laterality modifier (-RT or -LT) matching cataract ICD-10-CM eye laterality (e.g., H25.11 right eye, H25.12 left eye)!'],
    requiresLaterality: true,
  },
  // === HCPCS J-CODES & DME ===
  {
    code: 'J3301',
    codeSystem: 'HCPCS',
    category: 'HCPCS Drugs — Corticosteroids',
    shortDescriptor: 'Injection, triamcinolone acetonide, not otherwise specified, 10 mg',
    clinicalSummary: 'Injectable corticosteroid (Kenalog), billed per 10 mg unit (e.g., 40 mg = 4 units).',
    globalPeriod: 'XXX',
    commonModifiers: ['JZ', 'JW'],
    typicalDxPrefixes: ['M', 'L', 'J45'],
    codingTips: ['Check units carefully: 1 unit = 10 mg (40 mg joint injection = 4 units)!', 'Single-dose container requires -JZ (no waste) or second line with -JW (discarded waste) for Medicare & aligned payers.'],
  },
  {
    code: 'J1100',
    codeSystem: 'HCPCS',
    category: 'HCPCS Drugs — Corticosteroids',
    shortDescriptor: 'Injection, dexamethasone sodium phosphate, 1 mg',
    clinicalSummary: 'Injectable dexamethasone billed per 1 mg unit (e.g., 4 mg = 4 units).',
    globalPeriod: 'XXX',
    commonModifiers: ['JZ', 'JW'],
    typicalDxPrefixes: ['C', 'G', 'J', 'L', 'M', 'R'],
    codingTips: ['Verify NDC 11-digit format (5-4-2) and single-dose vs multi-dose vial modifier (-JZ/-JW).'],
  },
  {
    code: 'J1885',
    codeSystem: 'HCPCS',
    category: 'HCPCS Drugs — Analgesics',
    shortDescriptor: 'Injection, ketorolac tromethamine, per 15 mg',
    clinicalSummary: 'Injectable NSAID (Toradol), billed per 15 mg unit (30 mg = 2 units; 60 mg = 4 units).',
    globalPeriod: 'XXX',
    commonModifiers: ['JZ', 'JW'],
    typicalDxPrefixes: ['G43', 'M54', 'N20', 'R10', 'S'],
    codingTips: ['Billed per 15 mg increment (60 mg IM = 4 units) + pair with administration code 96372 and -JZ/-JW when single-dose vial used!'],
  },
  {
    code: 'E0601',
    codeSystem: 'HCPCS',
    category: 'HCPCS DME — Respiratory',
    shortDescriptor: 'Continuous positive airway pressure (CPAP) device',
    clinicalSummary: 'Capped-rental DME CPAP machine for obstructive sleep apnea (G47.33).',
    globalPeriod: 'XXX',
    commonModifiers: ['RR', 'NU', 'KX'],
    typicalDxPrefixes: ['G47'],
    codingTips: ['Requires G47.33 (Obstructive sleep apnea) + documented sleep study AHI/RDI criteria and -KX + -RR/-NU DME modifiers.'],
  },
];

export const NCCI_PTP_PAIRS: NcciPtpPair[] = [
  {
    column1: '80053',
    column2: '80048',
    modifierIndicator: 0,
    rationale: 'Comprehensive Metabolic Panel (80053) already includes all 8 analytes of Basic Metabolic Panel (80048). Never unbundle.',
  },
  {
    column1: '85025',
    column2: '85027',
    modifierIndicator: 0,
    rationale: 'CBC with differential (85025) includes CBC without differential (85027). Never bill both on same specimen.',
  },
  {
    column1: '17004',
    column2: '17000',
    modifierIndicator: 0,
    rationale: '17004 covers destruction of 15+ premalignant lesions in full; never report alongside 17000 or 17003.',
  },
  {
    column1: '17004',
    column2: '17003',
    modifierIndicator: 0,
    rationale: '17004 replaces 17000 + 17003 when 15 or more premalignant lesions are destroyed.',
  },
  {
    column1: '20610',
    column2: '76942',
    modifierIndicator: 0,
    rationale: 'Do not bill ultrasound guidance (76942) separately with 20610 (without ultrasound); replace 20610 + 76942 with single code 20611!',
  },
  {
    column1: '20611',
    column2: '76942',
    modifierIndicator: 0,
    rationale: 'Ultrasound guidance (76942) is already built into 20611 unless performed on a completely separate non-joint lesion (-XS/-59).',
  },
  {
    column1: '93000',
    column2: '93010',
    modifierIndicator: 0,
    rationale: 'Global ECG (93000) already includes interpretation and report (93010).',
  },
  {
    column1: '93000',
    column2: '93005',
    modifierIndicator: 0,
    rationale: 'Global ECG (93000) already includes the technical tracing (93005).',
  },
  {
    column1: '45385',
    column2: '45378',
    modifierIndicator: 0,
    rationale: 'Diagnostic colonoscopy (45378) is always bundled into surgical colonoscopy with snare polypectomy (45385).',
  },
  {
    column1: '45380',
    column2: '45378',
    modifierIndicator: 0,
    rationale: 'Diagnostic colonoscopy (45378) is bundled into colonoscopy with biopsy (45380).',
  },
  {
    column1: '45385',
    column2: '45380',
    modifierIndicator: 1,
    allowedModifiers: ['59', 'XS', 'XU'],
    rationale: 'Colonoscopy biopsy (45380) is bundled into snare polypectomy (45385) unless performed on a separate lesion/polyp (append -XS or -59 to 45380).',
  },
  {
    column1: '43239',
    column2: '43235',
    modifierIndicator: 0,
    rationale: 'Diagnostic EGD (43235) is always bundled into EGD with biopsy (43239).',
  },
  {
    column1: '71046',
    column2: '71045',
    modifierIndicator: 1,
    allowedModifiers: ['59', 'XE', '76', '77'],
    rationale: '1-view chest X-ray (71045) is bundled into 2-view chest X-ray (71046) unless performed at a separate clinical encounter on the same date (-XE/-76).',
  },
  {
    column1: '29881',
    column2: '29877',
    modifierIndicator: 1,
    allowedModifiers: ['59', 'XS'],
    rationale: 'Arthroscopic knee chondroplasty (29877) is bundled into meniscectomy (29881) in any compartment of the same knee; only unbundle (-XS) if contralateral knee.',
  },
  {
    column1: '11104',
    column2: '11102',
    modifierIndicator: 0,
    rationale: 'When both punch (11104) and tangential biopsy are performed on separate lesions, CPT instructs billing 11104 + add-on 11103 — never two primary biopsy codes (11104 + 11102)!',
  },
  {
    column1: '99214',
    column2: '94760',
    modifierIndicator: 0,
    rationale: 'Spot pulse oximetry (94760) is bundled as routine vital sign assessment into outpatient E/M visits.',
  },
  {
    column1: '99213',
    column2: '94760',
    modifierIndicator: 0,
    rationale: 'Spot pulse oximetry (94760) is bundled as routine vital sign assessment into outpatient E/M visits.',
  },
  {
    column1: '99291',
    column2: '94760',
    modifierIndicator: 0,
    rationale: 'Pulse oximetry (94760) is explicitly bundled by CPT into Critical Care (99291).',
  },
  {
    column1: '99291',
    column2: '36415',
    modifierIndicator: 0,
    rationale: 'Venipuncture / vascular access is bundled by CPT into Critical Care time (99291).',
  },
  {
    column1: '92014',
    column2: '99214',
    modifierIndicator: 0,
    rationale: 'Ophthalmological exam (92014) and general E/M visit (99214) are mutually exclusive on the same date by the same provider.',
  },
  {
    column1: '92014',
    column2: '99213',
    modifierIndicator: 0,
    rationale: 'Ophthalmological exam (92014) and general E/M visit (99213) are mutually exclusive on the same date by the same provider.',
  },
];

const procedureMap = new Map<string, ProcedureCodeInfo>(
  PROCEDURE_REFERENCE.map((p) => [p.code.toUpperCase(), p])
);
const modifierMap = new Map<string, ModifierInfo>(
  MODIFIER_REFERENCE.map((m) => [m.code.toUpperCase(), m])
);

export function classifyProcedureRange(rawCode: string): {
  validSyntax: boolean;
  codeSystem: 'CPT' | 'HCPCS' | 'UNKNOWN';
  sectionLabel: string;
  isEM: boolean;
  isProcedureRange: boolean;
  isJCode: boolean;
} {
  const code = rawCode.trim().toUpperCase();
  if (/^[0-9]{5}$/.test(code)) {
    const num = parseInt(code, 10);
    if (num >= 99202 && num <= 99499) {
      const isPreventive = num >= 99381 && num <= 99397;
      return {
        validSyntax: true,
        codeSystem: 'CPT',
        sectionLabel: isPreventive ? 'Evaluation & Management — Preventive' : 'Evaluation & Management (E/M)',
        isEM: !isPreventive,
        isProcedureRange: false,
        isJCode: false,
      };
    }
    if (num >= 100 && num <= 1999) {
      return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'Anesthesia (00100–01999)', isEM: false, isProcedureRange: true, isJCode: false };
    }
    if (num >= 10004 && num <= 69990) {
      return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'Surgery / Invasive Procedure (10004–69990)', isEM: false, isProcedureRange: true, isJCode: false };
    }
    if (num >= 70010 && num <= 79999) {
      return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'Radiology & Diagnostic Imaging (70010–79999)', isEM: false, isProcedureRange: false, isJCode: false };
    }
    if (num >= 80047 && num <= 89398) {
      return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'Pathology & Laboratory (80047–89398)', isEM: false, isProcedureRange: false, isJCode: false };
    }
    if (num >= 90281 && num <= 99199) {
      const isInjection = num >= 96360 && num <= 96549;
      return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'Medicine Services (90281–99199)', isEM: false, isProcedureRange: isInjection, isJCode: false };
    }
    return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'CPT Numeric Code', isEM: false, isProcedureRange: false, isJCode: false };
  }
  if (/^[0-9]{4}[FTU]$/.test(code)) {
    return { validSyntax: true, codeSystem: 'CPT', sectionLabel: 'CPT Category II / III Tracking or Emerging Tech', isEM: false, isProcedureRange: false, isJCode: false };
  }
  if (/^[A-V][0-9]{4}$/.test(code)) {
    const ch = code[0];
    const labels: Record<string, string> = {
      A: 'HCPCS A-Code — Medical/Surgical Supplies & Ambulance',
      B: 'HCPCS B-Code — Enteral & Parenteral Therapy',
      C: 'HCPCS C-Code — Outpatient PPS Transitional Pass-Through',
      D: 'HCPCS D-Code — Dental Procedures (CDT)',
      E: 'HCPCS E-Code — Durable Medical Equipment (DME)',
      G: 'HCPCS G-Code — CMS Procedures & Professional Services',
      H: 'HCPCS H-Code — Behavioral Health / Substance Use',
      J: 'HCPCS J-Code — Injectable Drugs & Biologicals',
      K: 'HCPCS K-Code — DME MAC Temporary Codes',
      L: 'HCPCS L-Code — Orthotics & Prosthetics',
      M: 'HCPCS M-Code — Quality Measures / Medical Services',
      P: 'HCPCS P-Code — Pathology & Blood Products',
      Q: 'HCPCS Q-Code — CMS Temporary Codes / Skin Substitutes / Drugs',
      R: 'HCPCS R-Code — Diagnostic Radiology Services',
      S: 'HCPCS S-Code — Commercial Payer Temporary National Codes',
      T: 'HCPCS T-Code — Medicaid State Agency Codes',
      V: 'HCPCS V-Code — Vision & Hearing Services',
    };
    return {
      validSyntax: true,
      codeSystem: 'HCPCS',
      sectionLabel: labels[ch] || 'HCPCS Level II Code',
      isEM: false,
      isProcedureRange: false,
      isJCode: ch === 'J',
    };
  }
  return {
    validSyntax: false,
    codeSystem: 'UNKNOWN',
    sectionLabel: 'Unrecognized Procedure Format',
    isEM: false,
    isProcedureRange: false,
    isJCode: false,
  };
}

export interface ParsedProcedureToken {
  raw: string;
  baseCode: string;
  modifiers: string[];
  validSyntax: boolean;
  codeSystem: 'CPT' | 'HCPCS' | 'UNKNOWN';
  sectionLabel: string;
  reference: ProcedureCodeInfo | null;
  modifierDetails: Array<{ code: string; info: ModifierInfo | null }>;
}

export function parseProcedureTokens(input: string | string[] | null | undefined): ParsedProcedureToken[] {
  const rawStr = Array.isArray(input) ? input.join(', ') : String(input || '');
  if (!rawStr.trim()) return [];

  const chunks = rawStr
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const cleaned = chunk.replace(/^\+/, '').trim().toUpperCase();
    const parts = cleaned.split(/[-:\s]+/).filter(Boolean);
    const baseCode = parts[0] || '';
    const modifiers = parts.slice(1);
    const cls = classifyProcedureRange(baseCode);
    const ref = procedureMap.get(baseCode) || null;
    return {
      raw: chunk,
      baseCode,
      modifiers,
      validSyntax: cls.validSyntax,
      codeSystem: ref?.codeSystem || cls.codeSystem,
      sectionLabel: ref?.category || cls.sectionLabel,
      reference: ref,
      modifierDetails: modifiers.map((m) => ({
        code: m,
        info: modifierMap.get(m) || null,
      })),
    };
  });
}

export function getProcedureInfo(code: string): ProcedureCodeInfo | null {
  return procedureMap.get(code.trim().replace(/^\+/, '').toUpperCase()) || null;
}

export function getModifierInfo(mod: string): ModifierInfo | null {
  return modifierMap.get(mod.trim().replace(/^-/, '').toUpperCase()) || null;
}

export function searchProceduresAndModifiers(
  query: string,
  filter: 'all' | 'cpt' | 'hcpcs' | 'modifiers' = 'all'
) {
  const q = String(query || '').trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const procedures =
    filter === 'modifiers'
      ? []
      : PROCEDURE_REFERENCE.filter((p) => {
          if (filter === 'cpt' && p.codeSystem !== 'CPT') return false;
          if (filter === 'hcpcs' && p.codeSystem !== 'HCPCS') return false;
          if (!q) return true;
          const hay = `${p.code} ${p.category} ${p.shortDescriptor} ${p.clinicalSummary} ${p.commonModifiers.join(' ')}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        });

  const modifiers =
    filter === 'cpt' || filter === 'hcpcs'
      ? []
      : MODIFIER_REFERENCE.filter((m) => {
          if (!q) return true;
          const cleanMod = q.replace(/^-/, '');
          const hay = `${m.code} -${m.code} modifier ${m.code} ${m.title} ${m.category} ${m.whenToUse} ${m.commonDenialsFixed.join(' ')}`.toLowerCase();
          return m.code.toLowerCase() === cleanMod || tokens.every((t) => hay.includes(t.replace(/^-/, '')));
        });

  return { procedures, modifiers };
}
