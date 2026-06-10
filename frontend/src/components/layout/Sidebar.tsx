import {
  Brain,
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Home,
  Kanban,
  Layers,
  LayoutTemplate,
  MessageSquare,
  Plug,
  Settings,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

interface SidebarProps {
  expanded: boolean
  onToggle: () => void
}

interface NavItem {
  icon: LucideIcon
  label: string
  path: string
}

const primaryNavItems: NavItem[] = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: MessageSquare, label: 'AI Chat', path: '/chat' },
  { icon: Layers, label: 'Builder', path: '/builder' },
  { icon: FolderOpen, label: 'Projects', path: '/projects' },
  { icon: LayoutTemplate, label: 'Templates', path: '/templates' },
  { icon: Building2, label: 'Organization', path: '/organization' },
  { icon: Kanban, label: 'Boards', path: '/boards' },
  { icon: GitBranch, label: 'Workflows', path: '/workflows' },
  { icon: Shield, label: 'Security', path: '/security' },
  { icon: Brain, label: 'Memory', path: '/memory' },
  { icon: Plug, label: 'Integrations', path: '/integrations' },
]

const secondaryNavItems: NavItem[] = [
  { icon: Settings, label: 'Settings', path: '/settings' },
]

const baseNavClass =
  'sidebar-nav-item relative mx-2 flex items-center gap-3 rounded-lg px-3 py-2 text-avai-muted transition-colors hover:bg-white/5 hover:text-avai-text'

function NavigationItem({
  item,
  expanded,
}: {
  item: NavItem
  expanded: boolean
}) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      aria-label={item.label}
      className={({ isActive }) =>
        `${baseNavClass}${
          isActive
            ? ' border-l-2 border-avai-accent bg-avai-accent/10 text-avai-accent'
            : ''
        }`
      }
    >
      <Icon size={18} className="shrink-0" />
      {expanded ? (
        <span className="truncate text-sm">{item.label}</span>
      ) : (
        <span className="sidebar-tooltip">{item.label}</span>
      )}
    </NavLink>
  )
}

export function Sidebar({ expanded, onToggle }: SidebarProps) {
  return (
    <aside
      className={`flex h-screen shrink-0 flex-col border-r border-avai-border bg-avai-surface transition-all duration-200 ${
        expanded ? 'w-[220px]' : 'w-14'
      }`}
    >
      <div className="flex h-12 shrink-0 items-center px-3">
        {expanded ? (
          <>
            <span className="text-lg font-semibold text-avai-accent">AVAI</span>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              className="ml-auto rounded p-1 text-avai-muted transition-colors hover:bg-white/5 hover:text-avai-text"
            >
              <ChevronLeft size={18} />
            </button>
          </>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded bg-avai-accent text-xs font-bold text-avai-bg">
            A
          </span>
        )}
      </div>

      {!expanded && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          className="mx-auto mb-1 rounded p-1 text-avai-muted transition-colors hover:bg-white/5 hover:text-avai-text"
        >
          <ChevronRight size={18} />
        </button>
      )}

      <nav className="flex-1 overflow-y-auto py-2">
        {primaryNavItems.map((item) => (
          <NavigationItem key={item.path} item={item} expanded={expanded} />
        ))}
        <hr className="my-2 border-avai-border" />
        {secondaryNavItems.map((item) => (
          <NavigationItem key={item.path} item={item} expanded={expanded} />
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-3 border-t border-avai-border p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1DD68C22] text-sm font-medium text-avai-accent">
          RK
        </div>
        {expanded && (
          <div className="min-w-0">
            <p className="truncate text-xs text-avai-text">Rusty Khan</p>
            <p className="truncate text-xs text-avai-muted">Administrator</p>
          </div>
        )}
      </div>
    </aside>
  )
}
