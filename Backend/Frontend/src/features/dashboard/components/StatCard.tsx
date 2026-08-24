type Tone = 'rose' | 'violet' | 'green' | 'plum' | 'lavande' | 'neutral'

const tones: Record<Tone, { bg: string; border: string; value: string; label: string }> = {
    rose: {
        bg: 'bg-moon-rose/55',
        border: 'border-moon-rose',
        value: 'text-moon-violet-dark',
        label: 'text-moon-abyss/80',
    },
    violet: {
        bg: 'bg-moon-lavande/15',
        border: 'border-moon-lavande/35',
        value: 'text-moon-lavande',
        label: 'text-moon-abyss/80',
    },
    green: {
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        value: 'text-emerald-800',
        label: 'text-moon-abyss/80',
    },
    plum: {
        bg: 'bg-moon-violet/12',
        border: 'border-moon-violet/30',
        value: 'text-moon-violet-dark',
        label: 'text-moon-abyss/80',
    },
    lavande: {
        bg: 'bg-moon-lavande/12',
        border: 'border-moon-lavande/30',
        value: 'text-moon-lavande',
        label: 'text-moon-abyss/80',
    },
    neutral: {
        bg: 'bg-white',
        border: 'border-moon-abyss/12',
        value: 'text-moon-abyss',
        label: 'text-moon-abyss/80',
    },
}

export default function StatCard({
    value,
    label,
    sublabel,
    tone = 'neutral',
}: {
    value: string | number
    label: string
    sublabel?: string
    tone?: Tone
}) {
    const t = tones[tone]

    return (
        <div className={`rounded-2xl border p-5 shadow-sm ${t.bg} ${t.border}`}>
            <p className={`text-3xl font-bold ${t.value}`}>{value}</p>
            <p className={`mt-1 text-sm font-medium ${t.label}`}>{label}</p>
            {sublabel && <p className="mt-0.5 text-xs text-moon-abyss/65">{sublabel}</p>}
        </div>
    )
}
