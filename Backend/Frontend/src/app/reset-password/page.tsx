import { Suspense } from 'react'
import ResetPasswordCard from '@/features/auth/components/ResetPasswordCard'

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordCard />
        </Suspense>
    )
}
