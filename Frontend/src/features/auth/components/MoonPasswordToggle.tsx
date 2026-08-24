'use client'

import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import { Eye, EyeOff } from 'lucide-react'
import { moon } from '../constants/moonTheme'

type Props = {
    visible: boolean
    onToggle: () => void
    label?: string
}

const MoonPasswordToggle = ({ visible, onToggle, label = 'afficher le mot de passe' }: Props) => (
    <InputAdornment position="end">
        <IconButton
            onClick={onToggle}
            onMouseDown={(e) => e.preventDefault()}
            edge="end"
            size="small"
            aria-label={visible ? 'masquer le mot de passe' : label}
            sx={{ color: moon.icon, width: 28, height: 28 }}
        >
            {visible ? <EyeOff size={18} strokeWidth={1.9} /> : <Eye size={18} strokeWidth={1.9} />}
        </IconButton>
    </InputAdornment>
)

export default MoonPasswordToggle
