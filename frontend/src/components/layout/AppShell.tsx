import { useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = () => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
    setExpanded(true)
  }

  const handleLeave = () => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 120)
  }

  return (
    <div className="flex h-screen bg-avai-bg">
      {/* Invisible far-left trigger zone — captures fast mouse entries before the sidebar icon is hovered */}
      <div
        aria-hidden="true"
        className="fixed left-0 top-0 z-40 h-full w-4"
        onMouseEnter={handleEnter}
      />
      <Sidebar
        expanded={expanded}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
