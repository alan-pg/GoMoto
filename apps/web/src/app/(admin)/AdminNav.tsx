'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

type AdminNavItem = {
  href: string
  label: string
  icon: React.ReactNode
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <nav className="flex flex-col gap-1 flex-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'flex items-center gap-2 px-3 h-10 rounded-lg text-[14px] transition',
            isActive(item.href)
              ? 'bg-[#BAFF1A] text-[#000000] font-medium'
              : 'text-[#c7c7c7] hover:bg-[#202020] hover:text-[#f5f5f5]',
          )}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
