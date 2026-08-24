export const NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/
export const NAME_MAX_LENGTH = 80

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 50

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 72

export const SKILL_NAME_MIN_LENGTH = 2
export const SKILL_NAME_MAX_LENGTH = 80

export const TICKET_TITLE_MIN_LENGTH = 3
export const TICKET_TITLE_MAX_LENGTH = 150

export const SITE_LABEL_MIN_LENGTH = 2
export const SITE_LABEL_MAX_LENGTH = 150

export const DESCRIPTION_MAX_LENGTH = 5000
export const RESOLUTION_NOTE_MAX_LENGTH = 2000
export const REASON_MAX_LENGTH = 1000
export const COMMENT_BODY_MAX_LENGTH = 5000

export function isValidName(value: string) {
    const trimmed = value.trim()
    return trimmed.length > 0 && trimmed.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(trimmed)
}

export function isValidOptionalName(value: string) {
    const trimmed = value.trim()
    return trimmed.length === 0 || isValidName(trimmed)
}

export function isValidUsername(value: string) {
    const trimmed = value.trim()
    return trimmed.length >= USERNAME_MIN_LENGTH && trimmed.length <= USERNAME_MAX_LENGTH
}

export function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function requiredFieldMessage(value: string, requiredMessage: string, invalidMessage: string) {
    return value.trim().length === 0 ? requiredMessage : invalidMessage
}

export function isStrongPassword(value: string) {
    return (
        value.length >= PASSWORD_MIN_LENGTH &&
        value.length <= PASSWORD_MAX_LENGTH &&
        /[a-z]/.test(value) &&
        /[A-Z]/.test(value) &&
        /\d/.test(value)
    )
}
