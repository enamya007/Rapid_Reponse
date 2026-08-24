/** Palette Moon — cf. maquette MOON COLOR PALETTE */
export const moon = {
    light: '#F5D5E0',
    periwinkle: '#6667AB',
    magenta: '#7B337E',
    plum: '#420D4B',
    midnight: '#2c2c54',
    subtitle: 'rgba(44, 44, 84, 0.55)',
    border: 'rgba(44, 44, 84, 0.14)',
    icon: '#6667AB',
    iconAccent: '#7B337E',
    inputBg: '#ffffff',
} as const

const autofillSelectors = [
    '&:-webkit-autofill',
    '&:-webkit-autofill:hover',
    '&:-webkit-autofill:focus',
    '&:-webkit-autofill:active',
] as const

const autofillRules = {
    WebkitBoxShadow: `0 0 0 1000px ${moon.inputBg} inset`,
    boxShadow: `0 0 0 1000px ${moon.inputBg} inset`,
    WebkitTextFillColor: `${moon.midnight} !important`,
    caretColor: moon.midnight,
    borderRadius: 'inherit',
    transition: 'background-color 99999s ease-in-out 0s',
}

export const moonLabelSx = {
    color: moon.midnight,
    fontWeight: 500,
    fontSize: 13,
    mb: 0.4,
    display: 'block',
    cursor: 'pointer',
    transition: 'color 200ms ease, font-weight 200ms ease',
    '&:hover': { color: moon.magenta },
} as const

export const moonRequiredMarkSx = {
    color: '#d32f2f',
    marginLeft: 2,
} as const

export const moonFieldGroupSx = {
    '&:focus-within .moon-field-label': {
        color: moon.magenta,
        fontWeight: 600,
    },
} as const

export const moonFieldSx = (rounded: 'pill' | 'soft' = 'soft') => {
    const radius = rounded === 'pill' ? '999px' : '12px'

    return {
        '@keyframes moonFocusPulse': {
            '0%': { boxShadow: '0 0 0 0 rgba(123, 51, 126, 0.45)' },
            '50%': { boxShadow: '0 0 0 5px rgba(123, 51, 126, 0.2)' },
            '100%': { boxShadow: '0 0 0 0 rgba(123, 51, 126, 0)' },
        },
        '& .MuiOutlinedInput-root': {
            borderRadius: radius,
            bgcolor: moon.inputBg,
            overflow: 'hidden',
            transition: 'box-shadow 200ms ease',
            '& fieldset': { borderColor: moon.border },
            '&:hover fieldset': { borderColor: moon.periwinkle },
            '&.Mui-focused': {
                animation: 'moonFocusPulse 650ms ease-out',
                '& fieldset': { borderColor: moon.magenta, borderWidth: 2 },
            },
            '&:has(.MuiOutlinedInput-input:-webkit-autofill)': {
                bgcolor: `${moon.inputBg} !important`,
                '& .MuiInputAdornment-root': { bgcolor: moon.inputBg },
            },
            '&:has(input:-webkit-autofill)': {
                bgcolor: `${moon.inputBg} !important`,
                '& .MuiInputAdornment-root': { bgcolor: moon.inputBg },
            },
        },
        '& .MuiOutlinedInput-input': {
            py: 0.95,
            fontSize: 14,
            bgcolor: 'transparent',
            color: moon.midnight,
            borderRadius: radius,
            '&::placeholder': { color: 'rgba(44, 44, 84, 0.38)', opacity: 1 },
            ...Object.fromEntries(autofillSelectors.map((sel) => [sel, autofillRules])),
        },
        '& .MuiInputBase-input': {
            ...Object.fromEntries(autofillSelectors.map((sel) => [sel, autofillRules])),
        },
        '& .MuiFormHelperText-root': {
            mx: rounded === 'pill' ? 2 : 0,
            mt: 0.35,
            lineHeight: 1.2,
        },
    }
}

export const moonButtonSx = {
    bgcolor: moon.plum,
    color: '#fff',
    borderRadius: '999px',
    py: 1,
    minHeight: 42,
    textTransform: 'none',
    fontWeight: 600,
    fontSize: 15,
    boxShadow: 'none',
    transition: 'background-color 150ms ease, opacity 150ms ease',
    '&:hover': { bgcolor: moon.magenta, boxShadow: 'none' },
    '&.Mui-disabled': { bgcolor: moon.midnight, color: '#fff', opacity: 0.88 },
} as const

export const moonButtonPendingSx = {
    bgcolor: `${moon.midnight} !important`,
    opacity: 0.92,
} as const

export const moonCheckboxSx = {
    color: moon.magenta,
    '&.Mui-checked': { color: moon.plum },
} as const

export const moonCheckboxLabelSx = {
    '& .MuiFormControlLabel-label': { color: moon.midnight, fontSize: 14 },
} as const

export const moonLinkSx = {
    fontSize: 14,
    color: moon.magenta,
    textDecoration: 'none',
    fontWeight: 500,
    '&:hover': { color: moon.plum },
} as const

export const moonFormHeaderSx = {
    title: { fontWeight: 700, color: moon.midnight, mb: 0.25, fontSize: 22, lineHeight: 1.2 },
    subtitle: { color: moon.subtitle, fontSize: 13, lineHeight: 1.35 },
} as const
