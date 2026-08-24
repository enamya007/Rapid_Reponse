'use client'

import { useId } from 'react'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { TextFieldProps } from '@mui/material/TextField'
import { moonFieldGroupSx, moonFieldSx, moonLabelSx, moonRequiredMarkSx } from '../constants/moonTheme'

type Props = Omit<TextFieldProps, 'label' | 'id'> & {
    label: string
    rounded?: 'pill' | 'soft'
    fieldId?: string
}

const MoonField = ({ label, rounded = 'soft', fieldId, sx, slotProps, required, ...props }: Props) => {
    const generatedId = useId()
    const inputId = fieldId ?? generatedId

    return (
        <Box className="moon-field" sx={moonFieldGroupSx}>
            <Typography component="label" htmlFor={inputId} className="moon-field-label" sx={moonLabelSx}>
                {label}
                {required && <Box component="span" sx={moonRequiredMarkSx}>*</Box>}
            </Typography>
            <TextField
                {...props}
                required={required}
                id={inputId}
                hiddenLabel
                fullWidth
                className="moon-field-input"
                sx={{ ...moonFieldSx(rounded), ...sx }}
                slotProps={{
                    ...slotProps,
                    input: {
                        ...slotProps?.input,
                        className: 'moon-field-native-input',
                    },
                }}
            />
        </Box>
    )
}

export default MoonField
