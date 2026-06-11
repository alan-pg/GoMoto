import { Sidebar } from '@/components/layout/Sidebar'
import { Providers } from '@/providers/Providers'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <Providers>
      <div className="flex min-h-screen bg-[#121212]">
        <Sidebar />
        <main className="flex-1 pl-[85px] min-h-screen overflow-auto">
          {children}
        </main>
      </div>
    </Providers>
  )
}
