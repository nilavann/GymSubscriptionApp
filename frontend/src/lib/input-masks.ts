/** Strips everything but digits and caps the length — e.g. phone number entry. */
export function sanitizeDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

/** Strips to a valid decimal (digits + at most one `.`) and caps the fractional part to maxDecimals. */
export function sanitizeDecimal(value: string, maxDecimals: number): string {
  let cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  const [whole, fraction] = cleaned.split('.');
  return fraction !== undefined ? `${whole}.${fraction.slice(0, maxDecimals)}` : cleaned;
}
