// Deterministic policy guard for role intake. The Recruiter model is never the
// only thing standing between a sponsor and a discriminatory filter: this code
// runs on the intake extraction output BEFORE a job can be confirmed, rejects
// protected-class proxy filters, and (in the pipeline) files a policy_refusal
// exception. The standing line the sponsor sees is fixed by the design.
//
// Product-specific carve-outs (ARCHITECTURE section 6, design intake screen):
//  • Graduation year / seniority ("new grad", "senior", "5+ years") is a
//    seniority signal and is ALLOWED — it is not treated as an age proxy here.
//  • Work authorization as a FACT is allowed: "authorized to work",
//    "requires sponsorship", "no sponsorship available", "security clearance".
//    What is refused is national-origin/citizenship discrimination beyond that
//    fact ("US citizens only", "native English speaker").
//  • "culture fit" with no defined criteria is flagged: it is the classic
//    undefined proxy. "culture add" is treated the same.

import type { JobRequirements } from '@tartan/types';

// The exact standing line from the design (sponsor intake summary panel).
export const INTAKE_REFUSAL_COPY = 'Refused: filters that proxy protected classes';

export type ProtectedCategory =
  | 'age'
  | 'gender'
  | 'race_ethnicity'
  | 'religion'
  | 'national_origin'
  | 'disability'
  | 'marital_family'
  | 'undefined_culture_fit';

export interface IntakeViolation {
  category: ProtectedCategory;
  field: string;
  matched: string;
  note: string;
}

export interface IntakeOk {
  ok: true;
}
export interface IntakeRefusal {
  ok: false;
  violations: IntakeViolation[];
  refusalCopy: string;
}
export type IntakeValidation = IntakeOk | IntakeRefusal;

interface Rule {
  category: ProtectedCategory;
  pattern: RegExp;
  note: string;
}

// Word-boundary patterns, case-insensitive. Kept intentionally narrow to avoid
// false positives on legitimate technical or logistics language.
const RULES: readonly Rule[] = [
  // age proxies (grad year / seniority deliberately excluded) ---------------
  {
    category: 'age',
    pattern: /\b(young|youthful|energetic young|digital native|recent college grad(?:uate)?s? preferred|under \d{2}|age \d{2})\b/i,
    note: 'age proxy — screen on skills and evidence, not age',
  },
  // gender ------------------------------------------------------------------
  {
    category: 'gender',
    pattern: /\b(male only|female only|males?\s+preferred|females?\s+preferred|men only|women only|salesman|manpower|he\/she preferred|preferably male|preferably female)\b/i,
    note: 'gender filter — roles are gender-neutral',
  },
  // race / ethnicity --------------------------------------------------------
  {
    category: 'race_ethnicity',
    pattern: /\b(white|black|asian|hispanic|latino|caucasian)\s+(candidate|applicant|only|preferred)\b|\b(race|ethnicity)\b/i,
    note: 'race or ethnicity filter',
  },
  // religion ----------------------------------------------------------------
  {
    category: 'religion',
    pattern: /\b(christian|muslim|jewish|hindu|catholic|religious)\s+(candidate|applicant|only|preferred|background)\b|\breligion\b/i,
    note: 'religion filter',
  },
  // national origin / citizenship beyond the work-auth fact -----------------
  {
    category: 'national_origin',
    pattern: /\b(u\.?s\.?\s+citizens?\s+(only|required)|citizens?\s+only|american citizens?\s+(only|preferred)|native (english )?speakers?\s+(only|required|preferred)|green card holders? only|no foreigners?)\b/i,
    note: 'national-origin/citizenship filter beyond a work-authorization fact',
  },
  // disability --------------------------------------------------------------
  {
    category: 'disability',
    pattern: /\b(able[- ]bodied|no disabilit(y|ies)|must not be disabled|physically fit)\b/i,
    note: 'disability filter',
  },
  // marital / family status -------------------------------------------------
  {
    category: 'marital_family',
    pattern: /\b(single|unmarried|married|no (kids|children)|no family commitments|childless|family status|no dependents)\b/i,
    note: 'marital or family-status filter',
  },
  // undefined culture fit ---------------------------------------------------
  {
    category: 'undefined_culture_fit',
    pattern: /\bculture (fit|add)\b/i,
    note: 'define the specific, job-related behaviors you mean; "culture fit" alone is an undefined proxy',
  },
];

function scanField(field: string, text: string, out: IntakeViolation[]): void {
  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      out.push({
        category: rule.category,
        field,
        matched: m[0],
        note: rule.note,
      });
    }
  }
}

/**
 * Validate intake requirements for protected-class proxy filters. Deterministic
 * and side-effect-free. On failure, returns the fixed refusal copy plus the
 * specific violations (the pipeline turns these into a policy_refusal
 * exception; the UI shows the standing "Refused: filters that proxy protected
 * classes" row).
 */
export function validateIntakeRequirements(
  requirements: JobRequirements,
): IntakeValidation {
  const violations: IntakeViolation[] = [];

  const listFields: [string, readonly string[] | undefined][] = [
    ['mustHaves', requirements.mustHaves],
    ['niceToHaves', requirements.niceToHaves],
    ['skills', requirements.skills],
    ['locations', requirements.locations],
  ];
  for (const [field, list] of listFields) {
    if (!list) continue;
    for (const item of list) scanField(field, item, violations);
  }

  const scalarFields: [string, string | undefined][] = [
    ['team', requirements.team],
    ['timeline', requirements.timeline],
    ['other', requirements.other],
  ];
  for (const [field, value] of scalarFields) {
    if (value) scanField(field, value, violations);
  }

  if (violations.length === 0) return { ok: true };
  return { ok: false, violations, refusalCopy: INTAKE_REFUSAL_COPY };
}
