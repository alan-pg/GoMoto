'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'gomoto:sidebar:expanded'

interface SidebarContextType {
  expanded: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextType>({
  expanded: true,
  toggle: () => {},
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) setExpanded(stored === 'true')
  }, [])

  const toggle = () =>
    setExpanded(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })

  return (
    <SidebarContext.Provider value={{ expanded, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
