import Sidebar from '@/features/dashboard/components/Sidebar'
import Topbar from '@/features/dashboard/components/Topbar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-screen overflow-hidden bg-white text-moon-abyss">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
                <Topbar />
                <main className="flex-1 overflow-y-auto p-6">{children}</main>
            </div>
        </div>
    )
}
