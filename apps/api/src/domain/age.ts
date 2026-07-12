/** Calendar-correct age math for consent gates and child profiles. */

/** Whole years old on `date` (both date-only, UTC semantics). */
export function ageOn(birthdate: Date, date: Date): number {
  let age = date.getUTCFullYear() - birthdate.getUTCFullYear();
  const hadBirthday =
    date.getUTCMonth() > birthdate.getUTCMonth() ||
    (date.getUTCMonth() === birthdate.getUTCMonth() &&
      date.getUTCDate() >= birthdate.getUTCDate());
  if (!hadBirthday) age--;
  return age;
}

/**
 * The COPPA line: video uploads for under-13s require guardian consent.
 * No birthdate = self-signup (adults and self-managed teens) = not gated.
 */
export function isUnder13(birthdate: Date | null, now: Date = new Date()): boolean {
  if (!birthdate) return false;
  return ageOn(birthdate, now) < 13;
}
