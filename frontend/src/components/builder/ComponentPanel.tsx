import { useState } from 'react'
import {
  Search, ChevronDown, ChevronRight, GripVertical,
  LayoutTemplate, Grid2X2, Layers2, Square, Minus, AlignJustify,
  Type, Heading1, RectangleHorizontal, TextCursor, AlignLeft, Tag, Smile,
  Table2, List, BarChart2, Activity, FileText,
  Bot, MessageSquareDashed, Brain, Wrench, X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface ComponentItem {
  icon: LucideIcon
  label: string
}

interface Section {
  id: string
  title: string
  items: ComponentItem[]
}

const SECTIONS: Section[] = [
  {
    id: 'layout',
    title: 'Layout',
    items: [
      { icon: LayoutTemplate, label: 'Container' },
      { icon: Grid2X2, label: 'Grid' },
      { icon: Layers2, label: 'Stack' },
      { icon: Square, label: 'Card' },
      { icon: Minus, label: 'Divider' },
      { icon: AlignJustify, label: 'Spacer' },
    ],
  },
  {
    id: 'basic',
    title: 'Basic',
    items: [
      { icon: Type, label: 'Text' },
      { icon: Heading1, label: 'Heading' },
      { icon: RectangleHorizontal, label: 'Button' },
      { icon: TextCursor, label: 'Input' },
      { icon: AlignLeft, label: 'Text Area' },
      { icon: Tag, label: 'Label' },
      { icon: Smile, label: 'Icon' },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    items: [
      { icon: Table2, label: 'Table' },
      { icon: List, label: 'List' },
      { icon: BarChart2, label: 'Chart' },
      { icon: Activity, label: 'KPI' },
      { icon: FileText, label: 'Form' },
    ],
  },
  {
    id: 'ai',
    title: 'AI',
    items: [
      { icon: Bot, label: 'Agent' },
      { icon: MessageSquareDashed, label: 'Prompt Box' },
      { icon: Brain, label: 'Memory' },
      { icon: Wrench, label: 'Tool Call' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export default function ComponentPanel({ open, onClose }: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleSection = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  const filtered = search.trim()
    ? SECTIONS.map(s => ({
        ...s,
        items: s.items.filter(i => i.label.toLowerCase().includes(search.toLowerCase())),
      })).filter(s => s.items.length > 0)
    : SECTIONS

  return (
    <div
      className={`flex flex-col bg-[#0F1419] border-r border-white/[0.07] transition-all duration-200 overflow-hidden shrink-0 ${
        open ? 'w-[240px]' : 'w-0'
      }`}
    >
      {/* Header */}
      <div className="h-10 px-3 flex items-center justify-between border-b border-white/[0.07] shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-[#6B7785] font-medium">
          Components
        </span>
        <button
          onClick={onClose}
          title="Close panel"
          className="p-1 rounded text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7785]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search components..."
            className="w-full h-8 bg-[#141920] border border-white/[0.07] rounded-md pl-7 pr-3 text-xs text-[#E8EDF2] placeholder-[#6B7785] outline-none focus:border-[#1DD68C]/40 transition-colors"
          />
        </div>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto pb-4">
        {filtered.map(section => {
          const isCollapsed = collapsed[section.id]
          return (
            <div key={section.id}>
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-widest text-[#6B7785] font-medium hover:text-[#E8EDF2] transition-colors"
              >
                {isCollapsed
                  ? <ChevronRight size={11} />
                  : <ChevronDown size={11} />
                }
                {section.title}
              </button>

              {!isCollapsed && (
                <div className="px-2 pb-1">
                  {section.items.map(item => (
                    <ComponentItem key={item.label} item={item} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ComponentItem({ item }: { item: ComponentItem }) {
  const [hovered, setHovered] = useState(false)
  const Icon = item.icon

  return (
    <div
      draggable
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-grab hover:bg-white/5 transition-colors group"
    >
      <Icon size={13} className="text-[#6B7785] group-hover:text-[#E8EDF2] transition-colors shrink-0" />
      <span className="text-xs text-[#6B7785] group-hover:text-[#E8EDF2] transition-colors flex-1">
        {item.label}
      </span>
      {hovered && (
        <GripVertical size={12} className="text-[#6B7785]/50 shrink-0" />
      )}
    </div>
  )
}
