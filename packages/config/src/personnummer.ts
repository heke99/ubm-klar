/**
 * Detection of Swedish personal identity numbers (personnummer / samordningsnummer).
 *
 * A candidate is only treated as a personnummer when it has a plausible birth date
 * (including samordningsnummer day offset +60) AND a valid Luhn check digit. This keeps
 * the no-PII guard precise: technical identifiers such as migration versions
 * (e.g. 202607070001) are not rejected, while real identity numbers always are.
 */

const CANDIDATE_PATTERN = /\b(\d{6}|\d{8})[-+]?(\d{4})\b/g;

function luhnValid(tenDigits: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(tenDigits[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function plausibleDate(yymmdd: string): boolean {
  const month = Number(yymmdd.slice(2, 4));
  let day = Number(yymmdd.slice(4, 6));
  if (day > 60) day -= 60; // samordningsnummer
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function isLikelyPersonnummer(candidate: string): boolean {
  const normalized = candidate.replace(/[-+]/g, '');
  let birthPart: string;
  let suffix: string;
  if (normalized.length === 12) {
    const century = normalized.slice(0, 2);
    if (century !== '19' && century !== '20') return false;
    birthPart = normalized.slice(2, 8);
    suffix = normalized.slice(8);
  } else if (normalized.length === 10) {
    birthPart = normalized.slice(0, 6);
    suffix = normalized.slice(6);
  } else {
    return false;
  }
  return plausibleDate(birthPart) && luhnValid(birthPart + suffix);
}

/** Finds substrings of `text` that validate as Swedish personal identity numbers. */
export function findPersonnummer(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CANDIDATE_PATTERN)) {
    if (isLikelyPersonnummer(match[0])) {
      found.push(match[0]);
    }
  }
  return found;
}
