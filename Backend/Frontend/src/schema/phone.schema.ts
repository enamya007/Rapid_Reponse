import * as v from 'valibot'

// Counts actual digits only — spaces, "+" and other formatting characters must not count
// toward the minimum, otherwise "+228        " (no real digits) would pass an 8-character check.
function digitCount(value: string) {
  return (value.match(/\d/g) ?? []).length
}

export const phoneSchema = v.pipe(
  v.string('Le numéro de téléphone est requis'),
  v.nonEmpty('Le numéro de téléphone est requis'),
  v.maxLength(30, 'Le numéro de téléphone ne doit pas dépasser 30 caractères'),
  v.check((value) => digitCount(value) >= 8, 'Le numéro doit contenir au moins 8 chiffres'),
)

export function isValidPhone(phone: string) {
  const trimmed = phone.trim()
  return trimmed.length > 0 && trimmed.length <= 30 && digitCount(trimmed) >= 8
}

// Treat the bare "+228" country-code prefix (no digits typed yet) as empty
export function isPhoneEmpty(phone: string) {
  const trimmed = phone.trim()
  return trimmed.length === 0 || trimmed === '+228'
}
