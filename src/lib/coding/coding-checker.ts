import {
  formatICD10Code,
  getICD10Detail,
  normalizeICD10,
  suggestSimilarICD10,
  type ICD10Detail,
} from './icd10-service.ts';
import {
  classifyProcedureRange,
  NCCI_PTP_PAIRS,
  parseProcedureTokens,
  type ParsedProcedureToken,
} from './cpt-hcpcs-reference.ts';

export interface CodingQuickFix {
  label: string;
  action: 'replace_icd' | 'add_icd' | 'remove_icd' | 'promote_icd_primary' | 'replace_cpt' | 'remove_cpt';
  targetCode?: string;
  newCode?: string;
}

export interface CodingAuditIssue {
  id: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  category:
    | 'ICD-10-CM Specificity'
    | 'ICD-10-CM Excludes1 / Sequencing'
    | 'CPT / HCPCS & Modifiers'
    | 'NCCI Bundling Edits'
    | 'Laterality & Medical Necessity'
    | 'Denial Remediation';
  title: string;
  message: string;
  affectedCode?: string;
  quickFixes: CodingQuickFix[];
}

export interface CodingAuditInput {
  diagnosisCodes?: string | string[] | null;
  cptCodes?: string | string[] | null;
  denialReason?: string | null;
  billedAmount?: string | number | null;
  dateOfService?: string | null;
}

export interface CodingAuditReport {
  score: number;
  canSubmitClean: boolean;
  counts: {
    errors: number;
    warnings: number;
    info: number;
  };
  diagnoses: Array<{
    position: number;
    raw: string;
    code: string;
    normalizedCode: string;
    exists: boolean;
    billable: boolean;
    description: string;
    chapter: string | null;
    laterality: string;
    isUnspecified: boolean;
    isManifestation: boolean;
  }>;
  procedures: ParsedProcedureToken[];
  issues: CodingAuditIssue[];
}

export function splitDiagnosisInput(input: string | string[] | null | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map((s) => String(s || '').trim()).filter(Boolean);
  }
  const raw = String(input || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\n|]+|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesExcludes1Target(noteText: string, selfNorm: string, otherNorm: string): boolean {
  const selfCat = selfNorm.slice(0, 3);
  const otherCat = otherNorm.slice(0, 3);

  // Check category ranges like (O10-O11) or (J09-J18)
  const rangeRegex = /\b([A-TV-Z][0-9][0-9A-Z])\s*-\s*([A-TV-Z][0-9][0-9A-Z])\b/g;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRegex.exec(noteText)) !== null) {
    const start = rm[1].toUpperCase();
    const end = rm[2].toUpperCase();
    if (otherCat >= start && otherCat <= end && !(selfCat >= start && selfCat <= end)) {
      return true;
    }
  }

  // Check explicit codes/prefixes like (E10.-), (S39.012), (I10)
  const codeRegex = /\b([A-TV-Z][0-9][0-9A-Z](?:\.[0-9A-Z]{1,4})?)/g;
  let cm: RegExpExecArray | null;
  while ((cm = codeRegex.exec(noteText)) !== null) {
    const refNorm = normalizeICD10(cm[1]);
    if (refNorm.length < 3) continue;
    // Avoid self-prefix false match when CDC note says "except ..."
    if (selfNorm.startsWith(refNorm) || refNorm.startsWith(selfNorm)) continue;
    if (otherNorm.startsWith(refNorm)) {
      return true;
    }
  }
  return false;
}

const VALID_ALPHA_NUMERIC_MODIFIERS = new Set([
  '22', '23', '24', '25', '26', '27', '32', '33', '47', '50', '51', '52', '53',
  '54', '55', '56', '57', '58', '59', '62', '63', '66', '73', '74', '76', '77',
  '78', '79', '80', '81', '82', '90', '91', '92', '93', '95', '96', '97', '99',
  'TC', 'LT', 'RT', 'XE', 'XS', 'XP', 'XU', 'JW', 'JZ', 'KX', 'GA', 'GY', 'GZ',
  'QW', 'GT', 'GQ', 'FQ', 'GP', 'GO', 'GN', 'PT', 'GW', 'GV', 'NU', 'RR', 'UE',
  'FA', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9',
  'TA', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9',
  'E1', 'E2', 'E3', 'E4', 'LC', 'LD', 'LM', 'RC', 'RI', 'AA', 'AD', 'QK', 'QX', 'QY', 'QZ', 'QS',
]);

export function analyzeClaimCoding(input: CodingAuditInput): CodingAuditReport {
  const issues: CodingAuditIssue[] = [];
  let seq = 1;
  const pushIssue = (issue: Omit<CodingAuditIssue, 'id'>) => {
    issues.push({ id: `ISS-${seq++}`, ...issue });
  };

  const dxTokens = splitDiagnosisInput(input.diagnosisCodes);
  const dxDetails: Array<{ raw: string; detail: ICD10Detail }> = dxTokens.map((raw) => ({
    raw,
    detail: getICD10Detail(raw),
  }));

  const procTokens = parseProcedureTokens(input.cptCodes);

  // 1. Missing ICD-10-CM check
  if (dxDetails.length === 0) {
    pushIssue({
      ruleId: 'ICD-001',
      severity: 'error',
      category: 'ICD-10-CM Specificity',
      title: 'Missing ICD-10-CM Diagnosis Code',
      message:
        'At least one valid, billable FY2027 ICD-10-CM diagnosis code is required on CMS-1500 Item 21 / 837P HI segment.',
      quickFixes: [],
    });
  }

  const seenDxNorm = new Set<string>();

  dxDetails.forEach(({ raw, detail }, idx) => {
    const posLabel = idx === 0 ? 'Primary Dx (#1)' : `Dx #${idx + 1}`;

    // Duplicate check
    if (detail.normalizedCode && seenDxNorm.has(detail.normalizedCode)) {
      pushIssue({
        ruleId: 'ICD-004',
        severity: 'error',
        category: 'ICD-10-CM Specificity',
        title: `Duplicate Diagnosis Code (${detail.code})`,
        message: `${detail.code} is listed more than once on this claim. Duplicate ICD-10-CM pointers cause front-end 837P rejections.`,
        affectedCode: detail.code,
        quickFixes: [
          {
            label: `Remove duplicate ${detail.code}`,
            action: 'remove_icd',
            targetCode: raw,
          },
        ],
      });
    }
    if (detail.normalizedCode) seenDxNorm.add(detail.normalizedCode);

    // Invalid / Non-existent code
    if (!detail.exists) {
      const suggestions = suggestSimilarICD10(raw, 4);
      pushIssue({
        ruleId: 'ICD-002',
        severity: 'error',
        category: 'ICD-10-CM Specificity',
        title: `Unrecognized / Invalid ICD-10-CM Code: "${raw}"`,
        message: `"${raw}" does not exist in the official CDC/NCHS FY2027 ICD-10-CM release (effective Oct 1, 2026).${
          suggestions.length > 0
            ? ` Closest valid FY2027 billable codes: ${suggestions.map((s) => `${s.code} (${s.description})`).join('; ')}.`
            : ' Search the ICD-10-CM Reference Studio to select an active billable code.'
        }`,
        affectedCode: raw,
        quickFixes: suggestions.map((s) => ({
          label: `Use ${s.code} — ${s.description.slice(0, 48)}`,
          action: 'replace_icd',
          targetCode: raw,
          newCode: s.code,
        })),
      });
      return;
    }

    // Non-Billable Parent Header / Missing 4th-7th Character
    if (!detail.billable) {
      const candidates = detail.billableDescendants.slice(0, 5);
      const sevenHint = detail.clinicalAttributes.requires7thChar
        ? ' This category requires a 7th-character encounter/healing extension (e.g., A = initial encounter, D = subsequent encounter, S = sequela).'
        : ' Additional character specificity (4th–7th digit) is mandatory.';
      pushIssue({
        ruleId: 'ICD-003',
        severity: 'error',
        category: 'ICD-10-CM Specificity',
        title: `Non-Billable Header Code (${detail.code}) on ${posLabel}`,
        message: `${detail.code} ("${detail.description}") is a non-billable ICD-10-CM parent header and WILL REJECT under HIPAA 837 / CO-16 / MA130.${sevenHint}`,
        affectedCode: detail.code,
        quickFixes: candidates.map((c) => ({
          label: `Replace w/ ${c.code} — ${c.description.slice(0, 52)}`,
          action: 'replace_icd',
          targetCode: raw,
          newCode: c.code,
        })),
      });
      return;
    }

    // Primary diagnosis sequencing check (Code First / Manifestation)
    if (idx === 0 && detail.clinicalAttributes.isManifestation) {
      const cfText =
        detail.notes.codeFirst.map((n) => n.text).join('; ') ||
        'Underlying etiology must be sequenced before manifestation code.';
      pushIssue({
        ruleId: 'ICD-006',
        severity: 'error',
        category: 'ICD-10-CM Excludes1 / Sequencing',
        title: `Manifestation / "Code First" Violation on Primary Dx (${detail.code})`,
        message: `${detail.code} ("${detail.description}") carries an official CDC "Code First" / manifestation rule and cannot be billed as the Principal/First-Listed diagnosis: ${cfText}`,
        affectedCode: detail.code,
        quickFixes:
          dxDetails.length > 1 && dxDetails[1].detail.billable && !dxDetails[1].detail.clinicalAttributes.isManifestation
            ? [
                {
                  label: `Promote ${dxDetails[1].detail.code} to Primary Dx #1`,
                  action: 'promote_icd_primary',
                  targetCode: dxDetails[1].raw,
                },
              ]
            : [],
      });
    }

    // Unspecified diagnosis warning when specific alternatives exist
    if (detail.clinicalAttributes.isUnspecified && detail.clinicalAttributes.specificAlternatives.length > 0) {
      const alts = detail.clinicalAttributes.specificAlternatives.slice(0, 4);
      pushIssue({
        ruleId: 'ICD-007',
        severity: 'warning',
        category: 'ICD-10-CM Specificity',
        title: `Unspecified Diagnosis (${detail.code}) — More Specific FY2027 Siblings Available`,
        message: `${detail.code} ("${detail.description}") is unspecified. Many payers deny unspecified anatomical/laterality codes (CO-16 / M76) when clinical documentation supports ${alts
          .map((a) => `${a.code} (${a.description})`)
          .join(' or ')}.`,
        affectedCode: detail.code,
        quickFixes: alts.map((a) => ({
          label: `Specify ${a.code} — ${a.description.slice(0, 48)}`,
          action: 'replace_icd',
          targetCode: raw,
          newCode: a.code,
        })),
      });
    }

    // Use Additional Code advisory
    if (detail.notes.useAdditionalCode.length > 0) {
      const uaSample = detail.notes.useAdditionalCode.slice(0, 2).map((u) => u.text).join(' | ');
      // Check if any referenced code in Use Additional is already on claim
      const allRef = detail.notes.useAdditionalCode.flatMap((u) => u.referencedCodes);
      const alreadyHasRef =
        allRef.length > 0 &&
        allRef.some((rc) => {
          const rn = normalizeICD10(rc);
          return dxDetails.some((other) => other.detail.normalizedCode.startsWith(rn));
        });
      if (!alreadyHasRef) {
        pushIssue({
          ruleId: 'ICD-008',
          severity: 'info',
          category: 'ICD-10-CM Excludes1 / Sequencing',
          title: `CDC "Use Additional Code" Reminder for ${detail.code}`,
          message: `Official tabular note for ${detail.code}: ${uaSample}`,
          affectedCode: detail.code,
          quickFixes: allRef
            .map((rc) => getICD10Detail(rc))
            .filter((d) => d.billable)
            .slice(0, 2)
            .map((d) => ({
              label: `+ Add ${d.code} (${d.description.slice(0, 42)})`,
              action: 'add_icd' as const,
              newCode: d.code,
            })),
        });
      }
    }
  });

  // 2. Pairwise Excludes1 conflict check across all valid diagnoses on claim
  const reportedExcludesPairs = new Set<string>();
  for (let i = 0; i < dxDetails.length; i++) {
    const a = dxDetails[i].detail;
    if (!a.exists) continue;
    for (let j = i + 1; j < dxDetails.length; j++) {
      const b = dxDetails[j].detail;
      if (!b.exists) continue;
      const pairKey = [a.normalizedCode, b.normalizedCode].sort().join(':');
      if (reportedExcludesPairs.has(pairKey)) continue;

      const hitFromA = a.notes.excludes1.find((n) =>
        matchesExcludes1Target(n.text, a.normalizedCode, b.normalizedCode)
      );
      const hitFromB = !hitFromA
        ? b.notes.excludes1.find((n) =>
            matchesExcludes1Target(n.text, b.normalizedCode, a.normalizedCode)
          )
        : undefined;
      const hit = hitFromA || hitFromB;
      if (hit) {
        reportedExcludesPairs.add(pairKey);
        pushIssue({
          ruleId: 'ICD-005',
          severity: 'error',
          category: 'ICD-10-CM Excludes1 / Sequencing',
          title: `Excludes1 Mutually Exclusive Conflict: ${a.code} + ${b.code}`,
          message: `Official CDC Excludes1 rule (${hit.sourceCode}: "${hit.text}") prohibits reporting ${a.code} and ${b.code} together because the two conditions are mutually exclusive.`,
          affectedCode: `${a.code}, ${b.code}`,
          quickFixes: [
            { label: `Remove ${b.code}`, action: 'remove_icd', targetCode: dxDetails[j].raw },
            { label: `Remove ${a.code}`, action: 'remove_icd', targetCode: dxDetails[i].raw },
          ],
        });
      }
    }
  }

  // 3. CPT / HCPCS & Modifiers Checks
  if (procTokens.length === 0) {
    pushIssue({
      ruleId: 'CPT-001',
      severity: 'error',
      category: 'CPT / HCPCS & Modifiers',
      title: 'Missing CPT / HCPCS Procedure Code',
      message: 'At least one valid 5-character CPT or HCPCS Level II procedure code is required.',
      quickFixes: [],
    });
  }

  const dxLateralities = dxDetails
    .filter((d) => d.detail.exists)
    .map((d) => d.detail.clinicalAttributes.laterality);
  const hasRightDx = dxLateralities.includes('right') || dxLateralities.includes('bilateral');
  const hasLeftDx = dxLateralities.includes('left') || dxLateralities.includes('bilateral');

  procTokens.forEach((pt) => {
    if (!pt.validSyntax) {
      pushIssue({
        ruleId: 'CPT-002',
        severity: 'error',
        category: 'CPT / HCPCS & Modifiers',
        title: `Invalid CPT/HCPCS Code Format: "${pt.baseCode}"`,
        message: `"${pt.baseCode}" is not a valid 5-character CPT (00100–99499) or Level II HCPCS (A0000–V9999) code.`,
        affectedCode: pt.raw,
        quickFixes: [{ label: `Remove invalid "${pt.raw}"`, action: 'remove_cpt', targetCode: pt.raw }],
      });
      return;
    }

    // Modifier validation
    for (const mod of pt.modifiers) {
      if (!/^[A-Z0-9]{2}$/.test(mod) || !VALID_ALPHA_NUMERIC_MODIFIERS.has(mod)) {
        pushIssue({
          ruleId: 'MOD-001',
          severity: 'error',
          category: 'CPT / HCPCS & Modifiers',
          title: `Unrecognized Modifier "-${mod}" on ${pt.baseCode}`,
          message: `Modifier "-${mod}" is not a standard 2-character HIPAA CPT/HCPCS billing modifier and will trigger CO-4 rejection.`,
          affectedCode: pt.raw,
          quickFixes: [
            {
              label: `Strip -${mod} from ${pt.baseCode}`,
              action: 'replace_cpt',
              targetCode: pt.raw,
              newCode: [pt.baseCode, ...pt.modifiers.filter((m) => m !== mod)].join('-'),
            },
          ],
        });
      }
    }

    if (pt.modifiers.includes('26') && pt.modifiers.includes('TC')) {
      const withoutBoth = [pt.baseCode, ...pt.modifiers.filter((m) => m !== '26' && m !== 'TC')].join('-');
      pushIssue({
        ruleId: 'MOD-002',
        severity: 'error',
        category: 'CPT / HCPCS & Modifiers',
        title: `Conflicting Modifiers -26 and -TC on Same Line (${pt.raw})`,
        message: `Never report Professional (-26) and Technical (-TC) modifiers together on a single line. Bill global ${pt.baseCode} without -26/-TC when performing both components.`,
        affectedCode: pt.raw,
        quickFixes: [
          { label: `Bill global ${withoutBoth}`, action: 'replace_cpt', targetCode: pt.raw, newCode: withoutBoth },
        ],
      });
    }

    if (pt.modifiers.includes('LT') && pt.modifiers.includes('RT')) {
      const bilateralToken = [pt.baseCode, '50', ...pt.modifiers.filter((m) => m !== 'LT' && m !== 'RT')].join('-');
      pushIssue({
        ruleId: 'MOD-003',
        severity: 'warning',
        category: 'CPT / HCPCS & Modifiers',
        title: `Both -LT and -RT on Single Code Token (${pt.raw})`,
        message: `Combining -LT and -RT on a single claim line is rejected by Medicare and most commercial payers. Use bilateral modifier -50 (1 unit) or report two separate lines if payer policy requires.`,
        affectedCode: pt.raw,
        quickFixes: [
          { label: `Convert to bilateral ${bilateralToken}`, action: 'replace_cpt', targetCode: pt.raw, newCode: bilateralToken },
        ],
      });
    }

    // Add-on code missing primary base code check
    if (pt.reference?.isAddOn && pt.reference.primaryBaseCodes?.length) {
      const hasBase = procTokens.some((other) => pt.reference!.primaryBaseCodes!.includes(other.baseCode));
      if (!hasBase) {
        pushIssue({
          ruleId: 'CPT-003',
          severity: 'error',
          category: 'CPT / HCPCS & Modifiers',
          title: `Add-On Code ${pt.baseCode} Missing Required Primary Code`,
          message: `${pt.baseCode} (${pt.reference.shortDescriptor}) is an add-on code and cannot be billed standalone without one of: ${pt.reference.primaryBaseCodes.join(', ')}.`,
          affectedCode: pt.raw,
          quickFixes: [{ label: `Remove standalone ${pt.raw}`, action: 'remove_cpt', targetCode: pt.raw }],
        });
      }
    }

    // G2211 + Modifier 25 CMS prohibition!
    if (pt.baseCode === 'G2211') {
      const emWith25 = procTokens.find(
        (other) => (other.reference?.isEM || classifyProcedureRange(other.baseCode).isEM) && other.modifiers.includes('25')
      );
      if (emWith25) {
        pushIssue({
          ruleId: 'NCCI-003',
          severity: 'error',
          category: 'NCCI Bundling Edits',
          title: `G2211 Prohibited When Companion E/M (${emWith25.raw}) Has Modifier -25`,
          message: `CMS edits deny G2211 when the associated office/outpatient E/M code (${emWith25.baseCode}) is billed with modifier -25 on the same date of service.`,
          affectedCode: 'G2211',
          quickFixes: [{ label: 'Remove G2211 from claim', action: 'remove_cpt', targetCode: pt.raw }],
        });
      }
    }

    // Laterality checks
    if (pt.reference?.requiresLaterality && !pt.modifiers.some((m) => ['RT', 'LT', '50'].includes(m))) {
      const inferredMod = hasRightDx && !hasLeftDx ? 'RT' : hasLeftDx && !hasRightDx ? 'LT' : 'RT';
      pushIssue({
        ruleId: 'LAT-002',
        severity: 'warning',
        category: 'Laterality & Medical Necessity',
        title: `Missing Anatomical Laterality Modifier (-RT / -LT / -50) on ${pt.baseCode}`,
        message: `${pt.baseCode} (${pt.reference.shortDescriptor}) is a paired-structure procedure that routinely requires -RT, -LT, or -50 to avoid CO-4 modifier denials.`,
        affectedCode: pt.raw,
        quickFixes: [
          {
            label: `Append -${inferredMod} (${pt.baseCode}-${inferredMod})`,
            action: 'replace_cpt',
            targetCode: pt.raw,
            newCode: `${pt.baseCode}-${[...pt.modifiers, inferredMod].join('-')}`,
          },
          {
            label: `Append -50 Bilateral (${pt.baseCode}-50)`,
            action: 'replace_cpt',
            targetCode: pt.raw,
            newCode: `${pt.baseCode}-${[...pt.modifiers, '50'].join('-')}`,
          },
        ],
      });
    }

    if (pt.modifiers.includes('LT') && hasRightDx && !hasLeftDx) {
      pushIssue({
        ruleId: 'LAT-001',
        severity: 'error',
        category: 'Laterality & Medical Necessity',
        title: `Laterality Conflict: Left Modifier (-LT) on ${pt.baseCode} vs Right-Sided ICD-10-CM`,
        message: `${pt.raw} specifies Left side (-LT), but the claim's diagnosis code(s) specify Right side only. This mismatch triggers automatic CO-4 / CO-16 clearinghouse & payer denials.`,
        affectedCode: pt.raw,
        quickFixes: [
          {
            label: `Switch modifier to -RT (${[pt.baseCode, ...pt.modifiers.map((m) => (m === 'LT' ? 'RT' : m))].join('-')})`,
            action: 'replace_cpt',
            targetCode: pt.raw,
            newCode: [pt.baseCode, ...pt.modifiers.map((m) => (m === 'LT' ? 'RT' : m))].join('-'),
          },
        ],
      });
    }

    if (pt.modifiers.includes('RT') && hasLeftDx && !hasRightDx) {
      pushIssue({
        ruleId: 'LAT-001',
        severity: 'error',
        category: 'Laterality & Medical Necessity',
        title: `Laterality Conflict: Right Modifier (-RT) on ${pt.baseCode} vs Left-Sided ICD-10-CM`,
        message: `${pt.raw} specifies Right side (-RT), but the claim's diagnosis code(s) specify Left side only. Align either the ICD-10-CM laterality or procedure modifier.`,
        affectedCode: pt.raw,
        quickFixes: [
          {
            label: `Switch modifier to -LT (${[pt.baseCode, ...pt.modifiers.map((m) => (m === 'RT' ? 'LT' : m))].join('-')})`,
            action: 'replace_cpt',
            targetCode: pt.raw,
            newCode: [pt.baseCode, ...pt.modifiers.map((m) => (m === 'RT' ? 'LT' : m))].join('-'),
          },
        ],
      });
    }

    // J-Code JW / JZ waste modifier check
    const cls = classifyProcedureRange(pt.baseCode);
    if (cls.isJCode && !pt.modifiers.includes('JW') && !pt.modifiers.includes('JZ')) {
      pushIssue({
        ruleId: 'MOD-004',
        severity: 'warning',
        category: 'CPT / HCPCS & Modifiers',
        title: `Injectable Drug ${pt.baseCode} Missing -JZ / -JW Waste Modifier Check`,
        message: `CMS requires -JZ (zero drug discarded) or a second line with -JW (discarded amount) for all single-dose container HCPCS J-codes. Verify single-dose vs multi-dose vial.`,
        affectedCode: pt.raw,
        quickFixes: [
          {
            label: `Append -JZ (Zero waste: ${pt.baseCode}-JZ)`,
            action: 'replace_cpt',
            targetCode: pt.raw,
            newCode: [pt.baseCode, ...pt.modifiers, 'JZ'].join('-'),
          },
        ],
      });
    }

    // Preventive E/M without Z00.* preventive ICD-10
    if (pt.reference?.isPreventive && dxDetails.length > 0 && dxDetails.every((d) => d.detail.exists)) {
      const hasWellnessDx = dxDetails.some((d) => /^Z0[01]/.test(d.detail.normalizedCode));
      if (!hasWellnessDx) {
        pushIssue({
          ruleId: 'MED-001',
          severity: 'warning',
          category: 'Laterality & Medical Necessity',
          title: `Preventive Code ${pt.baseCode} Billed Without Wellness Diagnosis (Z00.*)`,
          message: `${pt.baseCode} (${pt.reference.shortDescriptor}) typically requires a preventive encounter ICD-10-CM diagnosis such as Z00.00 or Z00.01 to avoid CO-50 / PR benefit misrouting.`,
          affectedCode: pt.raw,
          quickFixes: [
            { label: '+ Add Z00.00 (General adult medical exam w/o abnormal findings)', action: 'add_icd', newCode: 'Z00.00' },
          ],
        });
      }
    }
  });

  // 4. E/M + Same-Day Minor Procedure without Modifier -25
  const emTokens = procTokens.filter(
    (p) => p.validSyntax && (p.reference?.isEM || classifyProcedureRange(p.baseCode).isEM)
  );
  const surgicalOrInjectionTokens = procTokens.filter(
    (p) =>
      p.validSyntax &&
      (p.reference?.isMinorProcedure || classifyProcedureRange(p.baseCode).isProcedureRange)
  );

  if (emTokens.length > 0 && surgicalOrInjectionTokens.length > 0) {
    for (const em of emTokens) {
      if (!em.modifiers.includes('25') && !em.modifiers.includes('57')) {
        const fixedEm = [em.baseCode, '25', ...em.modifiers].join('-');
        pushIssue({
          ruleId: 'NCCI-001',
          severity: 'error',
          category: 'NCCI Bundling Edits',
          title: `E/M (${em.baseCode}) + Procedure (${surgicalOrInjectionTokens.map((s) => s.baseCode).join(', ')}) Missing Modifier -25`,
          message: `Outpatient/ED E/M ${em.baseCode} billed on the same claim as procedure(s) ${surgicalOrInjectionTokens
            .map((s) => s.baseCode)
            .join(', ')} will bundle/deny under CO-97 / CO-4 unless a separately identifiable E/M is documented and modifier -25 (or -57 for 90-day major surgery) is appended to ${em.baseCode}.`,
          affectedCode: em.raw,
          quickFixes: [
            {
              label: `Append -25 to ${em.baseCode} (${fixedEm})`,
              action: 'replace_cpt',
              targetCode: em.raw,
              newCode: fixedEm,
            },
          ],
        });
      }
    }
  }

  // 5. NCCI Procedure-to-Procedure (PTP) Column 1 / Column 2 Edits
  for (const pair of NCCI_PTP_PAIRS) {
    const col1 = procTokens.find((p) => p.baseCode === pair.column1);
    const col2 = procTokens.find((p) => p.baseCode === pair.column2);
    if (!col1 || !col2) continue;

    if (pair.modifierIndicator === 0) {
      const fixes: CodingQuickFix[] = [
        { label: `Remove bundled ${col2.raw}`, action: 'remove_cpt', targetCode: col2.raw },
      ];
      if (pair.column1 === '20610' && pair.column2 === '76942') {
        const upgraded = ['20611', ...col1.modifiers].join('-');
        fixes.unshift({
          label: `Replace 20610 w/ ${upgraded} (includes US guidance) & remove 76942`,
          action: 'replace_cpt',
          targetCode: col1.raw,
          newCode: upgraded,
        });
      }
      pushIssue({
        ruleId: 'NCCI-002',
        severity: 'error',
        category: 'NCCI Bundling Edits',
        title: `NCCI Indicator 0 Hard Bundle: ${pair.column1} + ${pair.column2} (Never Unbundle)`,
        message: `${pair.rationale} Modifier -59 / X-modifiers CANNOT override an NCCI Indicator 0 edit.`,
        affectedCode: `${col1.raw}, ${col2.raw}`,
        quickFixes: fixes,
      });
    } else {
      const allowed = pair.allowedModifiers || ['59', 'XE', 'XS', 'XP', 'XU'];
      const hasBypass =
        col2.modifiers.some((m) => allowed.includes(m)) ||
        col1.modifiers.some((m) => allowed.includes(m));
      if (!hasBypass) {
        const prefMod = allowed.includes('XS') ? 'XS' : allowed[0];
        const fixedCol2 = [col2.baseCode, prefMod, ...col2.modifiers].join('-');
        pushIssue({
          ruleId: 'NCCI-002',
          severity: 'error',
          category: 'NCCI Bundling Edits',
          title: `NCCI Bundling Conflict: ${pair.column1} (Col 1) Bundles ${pair.column2} (Col 2)`,
          message: `${pair.rationale}`,
          affectedCode: `${col1.raw}, ${col2.raw}`,
          quickFixes: [
            {
              label: `Append -${prefMod} to ${col2.baseCode} (${fixedCol2}) if distinct site/session`,
              action: 'replace_cpt',
              targetCode: col2.raw,
              newCode: fixedCol2,
            },
            {
              label: `Remove bundled ${col2.raw}`,
              action: 'remove_cpt',
              targetCode: col2.raw,
            },
          ],
        });
      }
    }
  }

  // 6. Denial Reason Contextual Playbook
  const denialText = String(input.denialReason || '').trim();
  if (denialText) {
    const upper = denialText.toUpperCase();
    if (/CO-?4\b|MODIFIER/.test(upper)) {
      pushIssue({
        ruleId: 'DEN-001',
        severity: 'info',
        category: 'Denial Remediation',
        title: 'Denial Playbook — CO-4 (Procedure Code Inconsistent w/ Modifier or Missing Required Modifier)',
        message:
          'Verify: (1) E/M + same-day procedure has -25 on the E/M; (2) paired anatomical CPTs carry -RT/-LT/-50 matching ICD-10-CM laterality; (3) split radiology/cardiology codes do not combine -26 and -TC; (4) CLIA-waived labs include -QW.',
        quickFixes: [],
      });
    } else if (/CO-?11\b|DIAGNOSIS.*INCONSISTENT/.test(upper)) {
      pushIssue({
        ruleId: 'DEN-001',
        severity: 'info',
        category: 'Denial Remediation',
        title: 'Denial Playbook — CO-11 (Diagnosis Inconsistent With Procedure)',
        message:
          'Verify: (1) Primary diagnosis pointer links the condition actually treated by each CPT line; (2) ICD-10-CM laterality and gender/age match the procedure; (3) Manifestation ("Code First") codes are not sequenced in Position #1.',
        quickFixes: [],
      });
    } else if (/CO-?16\b|M76\b|MA130\b|LACKS INFORMATION|TRUNCATED|SPECIFICITY/.test(upper)) {
      pushIssue({
        ruleId: 'DEN-001',
        severity: 'info',
        category: 'Denial Remediation',
        title: 'Denial Playbook — CO-16 / M76 / MA130 (Incomplete / Non-Specific / Truncated Code)',
        message:
          'Verify every ICD-10-CM code is a valid FY2027 billable leaf code (including mandatory 7th-character A/D/S extensions for S/T injury codes and right/left laterality digits) and J-codes carry -JZ/-JW where required.',
        quickFixes: [],
      });
    } else if (/CO-?50\b|MEDICAL NECESSITY|LCD|NCD/.test(upper)) {
      pushIssue({
        ruleId: 'DEN-001',
        severity: 'info',
        category: 'Denial Remediation',
        title: 'Denial Playbook — CO-50 (Medical Necessity / LCD / NCD Coverage)',
        message:
          'Review chart documentation to ensure all documented comorbid/acuity/radiculopathy/complication ICD-10-CM codes from the provider note are captured rather than generic unspecified symptom codes.',
        quickFixes: [],
      });
    } else if (/CO-?97\b|BUNDL|INCLUSIVE/.test(upper)) {
      pushIssue({
        ruleId: 'DEN-001',
        severity: 'info',
        category: 'Denial Remediation',
        title: 'Denial Playbook — CO-97 (Payment Included in Allowance for Another Service / NCCI Bundle)',
        message:
          'Check NCCI PTP Indicator (0 vs 1). If Indicator 0, write off or replace with combination CPT; if Indicator 1 and operative/visit note proves separate session (-XE), separate structure (-XS), or distinct E/M (-25), submit corrected claim with supporting clinical notes.',
        quickFixes: [],
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const info = issues.filter((i) => i.severity === 'info').length;
  const score = Math.max(0, Math.min(100, 100 - errors * 25 - warnings * 8));

  return {
    score,
    canSubmitClean: errors === 0,
    counts: { errors, warnings, info },
    diagnoses: dxDetails.map(({ raw, detail }, idx) => ({
      position: idx + 1,
      raw,
      code: detail.exists ? detail.code : formatICD10Code(raw) || raw,
      normalizedCode: detail.normalizedCode,
      exists: detail.exists,
      billable: detail.billable,
      description: detail.description,
      chapter: detail.chapter ? `Ch. ${detail.chapter.num}: ${detail.chapter.desc}` : null,
      laterality: detail.clinicalAttributes.laterality,
      isUnspecified: detail.clinicalAttributes.isUnspecified,
      isManifestation: detail.clinicalAttributes.isManifestation,
    })),
    procedures: procTokens,
    issues,
  };
}
