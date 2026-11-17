/** Indian mobile-number helpers. Storage/transport format is E.164 digits without "+": 91XXXXXXXXXX. */

export function digitsOnly(input: string): string {
  return (input ?? '').replace(/\D/g, '');
}

/** Returns the 10-digit national number, or null when the input is not a valid Indian mobile. */
export function nationalNumber(input: string): string | null {
  let d = digitsOnly(input);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  else if (d.length === 13 && d.startsWith('091')) d = d.slice(3);
  if (d.length !== 10) return null;
  if (!/^[6-9]/.test(d)) return null;
  return d;
}

export function isValidIndianPhone(input: string): boolean {
  return nationalNumber(input) !== null;
}

/** 91XXXXXXXXXX or null. */
export function toE164Digits(input: string): string | null {
  const n = nationalNumber(input);
  return n ? `91${n}` : null;
}

/** "+91 98765 43210" for display; falls back to the raw input. */
export function formatPhone(input: string | null | undefined): string {
  if (!input) return '';
  const n = nationalNumber(input);
  return n ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : input;
}
