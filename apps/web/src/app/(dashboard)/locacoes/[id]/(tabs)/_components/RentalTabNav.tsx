'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type RentalTabNavProps = {
  rentalId: string
  showVistorias: boolean
}

export function RentalTabNav({ rentalId, showVistorias }: RentalTabNavProps) {
  const pathname = usePathname()
  const base = `/locacoes/${rentalId}`

  const tabs = [
    { label: 'Principal',    href: base },
    { label: 'Contrato',     href: `${base}/contrato` },
    ...(showVistorias ? [{ label: 'Vistorias', href: `${base}/vistorias` }] : []),
    { label: 'Manutenções',  href: `${base}/manutencoes` },
    { label: 'Financeiro',   href: `${base}/financeiro` },
  ]

  return (
    <nav className="flex gap-1 border-b border-[#323232] px-6">
      {tabs.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-medium transition-colors ${
              active
                ? 'border-[#BAFF1A] text-[#f5f5f5]'
                : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
