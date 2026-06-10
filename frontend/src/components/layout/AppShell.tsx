import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

const SIDEBAR_STORAGE_KEY = 'avai_sidebar_expanded'

function getInitialSidebarState(): boolean {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
}

export function AppShell() {
  const [expanded, setExpanded] = useState<boolean>(getInitialSidebarState)

  const toggle = () => {
    setExpanded((current) => {
      const next = !current
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
      return next
    })
  }

  return (
    <div className="flex h-screen bg-avai-bg">
      <Sidebar expanded={expanded} onToggle={toggle} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
