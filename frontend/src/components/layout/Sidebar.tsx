import {
  Brain,
  Building2,
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
  onMouseEnter: () => void
  onMouseLeave: () => void
}

interface NavItem {
  icon: LucideIcon
  label: string
  path: string
}

const primaryNavItems: NavItem[] = [
  { icon: Home,           label: 'Home',         path: '/' },
  { icon: MessageSquare,  label: 'AI Chat',       path: '/chat' },
  { icon: Layers,         label: 'Builder',       path: '/builder' },
  { icon: FolderOpen,     label: 'Projects',      path: '/projects' },
  { icon: LayoutTemplate, label: 'Templates',     path: '/templates' },
  { icon: Building2,      label: 'Organization',  path: '/organization' },
  { icon: Kanban,         label: 'Boards',        path: '/boards' },
  { icon: GitBranch,      label: 'Workflows',     path: '/workflows' },
  { icon: Shield,         label: 'Security',      path: '/security' },
  { icon: Brain,          label: 'Memory',        path: '/memory' },
  { icon: Plug,           label: 'Integrations',  path: '/integrations' },
]

const secondaryNavItems: NavItem[] = [
  { icon: Settings, label: 'Settings', path: '/settings' },
]

function NavigationItem({ item, expanded }: { item: NavItem; expanded: boolean }) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      aria-label={item.label}
      className={({ isActive }) =>
        [
          'sidebar-nav-item relative mx-2 flex items-center gap-3 rounded-lg px-3 py-2',
          'text-avai-muted transition-colors hover:bg-white/5 hover:text-avai-text',
          isActive ? 'border-l-2 border-avai-accent bg-white/[0.045] text-avai-text' : '',
        ].join(' ')
      }
    >
      <Icon size={18} className="shrink-0" />

      {/* Label — fades in as sidebar expands */}
      <span
        className="overflow-hidden whitespace-nowrap text-sm transition-all duration-150"
        style={{ maxWidth: expanded ? '160px' : '0px', opacity: expanded ? 1 : 0 }}
      >
        {item.label}
      </span>

      {/* Tooltip — only shown when collapsed */}
      {!expanded && <span className="sidebar-tooltip">{item.label}</span>}
    </NavLink>
  )
}

export function Sidebar({ expanded, onMouseEnter, onMouseLeave }: SidebarProps) {
  return (
    <aside
      className={[
        'relative z-30 flex h-screen shrink-0 flex-col',
        'border-r border-avai-border bg-avai-surface',
        'transition-[width] duration-200 ease-in-out',
        expanded ? 'w-[220px]' : 'w-14',
        // On touch / narrow screens keep it always-collapsed; hover won't fire on touch
      ].join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Logo / wordmark */}
      <div className="flex h-12 shrink-0 items-center overflow-hidden px-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white text-xs font-bold text-black">
          A
        </span>
        <span
          className="overflow-hidden whitespace-nowrap text-base font-semibold text-avai-text transition-all duration-150"
          style={{ maxWidth: expanded ? '160px' : '0px', opacity: expanded ? 1 : 0, marginLeft: expanded ? '10px' : '0px' }}
        >
          AVAI
        </span>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {primaryNavItems.map((item) => (
          <NavigationItem key={item.path} item={item} expanded={expanded} />
        ))}
        <hr className="my-2 border-avai-border" />
        {secondaryNavItems.map((item) => (
          <NavigationItem key={item.path} item={item} expanded={expanded} />
        ))}
      </nav>

      {/* User footer */}
      <div className="flex items-center gap-3 overflow-hidden border-t border-avai-border p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-medium text-avai-text">
          RK
        </div>
        <div
          className="overflow-hidden transition-all duration-150"
          style={{ maxWidth: expanded ? '160px' : '0px', opacity: expanded ? 1 : 0 }}
        >
          <p className="whitespace-nowrap text-xs text-avai-text">Rusty Khan</p>
          <p className="whitespace-nowrap text-xs text-avai-muted">Administrator</p>
        </div>
      </div>
    </aside>
  )
}
