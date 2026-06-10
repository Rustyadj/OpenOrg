import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  Paperclip, Sparkles, Plus, ArrowUp,
  MessageSquare, LayoutDashboard, GitBranch, FileText, Wrench,
  PanelLeft
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DeviceMode } from './BuilderPage'

interface TemplateCard {
  icon: LucideIcon
  title: string
  sub: string
}

const TEMPLATES: TemplateCard[] = [
  { icon: MessageSquare, title: 'AI Chat App',         sub: 'Conversational AI assistant' },
  { icon: LayoutDashboard, title: 'Internal Dashboard', sub: 'Admin and analytics' },
  { icon: GitBranch, title: 'Workflow Automation',     sub: 'Process and task automation' },
  { icon: FileText, title: 'Document Assistant',       sub: 'AI for document analysis' },
  { icon: Wrench, title: 'Custom App',                  sub: 'Start from scratch' },
]

interface Props {
  canvasHasContent: boolean
  setCanvasHasContent: (v: boolean) => void
  deviceMode: DeviceMode
  zoom: number
  selectedElement: string | null
  setSelectedElement: (el: string | null) => void
  componentPanelOpen: boolean
  setComponentPanelOpen: (v: boolean) => void
}

export default function Canvas({
  canvasHasContent, setCanvasHasContent,
  deviceMode, zoom,
  setSelectedElement,
  componentPanelOpen, setComponentPanelOpen,
}: Props) {
  const [prompt, setPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleGenerate = () => {
    if (prompt.trim()) setCanvasHasContent(true)
  }

  const deviceWidth = deviceMode === 'mobile' ? 390 : deviceMode === 'tablet' ? 768 : null

  return (
    <div
      className="flex-1 overflow-auto relative"
      style={{ background: '#090A0B' }}
      onClick={() => setSelectedElement(null)}
    >
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Show panel open button when ComponentPanel is closed */}
      {!componentPanelOpen && (
        <button
          onClick={e => { e.stopPropagation(); setComponentPanelOpen(true) }}
          title="Open component panel"
          className="absolute left-3 top-3 z-10 rounded-lg border border-white/[0.07] bg-[#111214] p-1.5 text-[#71767E] transition-colors hover:border-white/20 hover:text-[#F2F3F5]"
        >
          <PanelLeft size={15} />
        </button>
      )}

      {/* Device frame */}
      <div
        className="relative h-full flex flex-col"
        style={deviceWidth ? {
          maxWidth: deviceWidth,
          margin: '0 auto',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        } : {}}
      >
        <div
          className="flex-1 flex flex-col"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          {canvasHasContent ? (
            <ActiveCanvas setSelectedElement={setSelectedElement} />
          ) : (
            <EmptyState
              prompt={prompt}
              setPrompt={setPrompt}
              onGenerate={handleGenerate}
              onSelectTemplate={() => setCanvasHasContent(true)}
              textareaRef={textareaRef}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Empty state ─────────────────────────────────────────────────── */
function EmptyState({
  prompt, setPrompt, onGenerate, onSelectTemplate, textareaRef,
}: {
  prompt: string
  setPrompt: (v: string) => void
  onGenerate: () => void
  onSelectTemplate: () => void
  textareaRef: RefObject<HTMLTextAreaElement>
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 min-h-0">
      <h1 className="text-2xl font-medium text-[#E8EDF2] text-center mb-2">
        What would you like to build?
      </h1>
      <p className="text-sm text-[#6B7785] text-center mb-8 max-w-md">
        Describe your app or select a template to get started.
      </p>

      {/* Prompt card */}
      <div className="mb-10 w-full max-w-[620px] rounded-2xl border border-white/[0.09] bg-[#111214]/95 p-4 shadow-[0_16px_50px_rgba(0,0,0,0.22)]">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onGenerate() }}
          placeholder="Describe the app or website you want to build…"
          rows={3}
          className="w-full resize-none bg-transparent text-sm leading-relaxed text-[#F2F3F5] outline-none placeholder-[#71767E]"
        />
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/[0.07]">
          <button title="Attach file" className="p-1.5 rounded-md text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors">
            <Paperclip size={15} />
          </button>
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#6B7785] hover:text-[#1DD68C] hover:bg-[#1DD68C]/5 transition-colors text-xs">
            <Sparkles size={13} />
            Enhance
          </button>
          <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors text-xs">
            <Plus size={13} />
            Add context
          </button>
          <button
            onClick={onGenerate}
            title="Generate (⌘Enter)"
            className="ml-auto w-8 h-8 rounded-full bg-[#1DD68C] flex items-center justify-center hover:brightness-110 transition-all shrink-0"
          >
            <ArrowUp size={15} className="text-[#0B0F14]" />
          </button>
        </div>
      </div>

      {/* Template cards */}
      <p className="text-xs text-[#6B7785] mb-5">Or choose a template</p>

      <div className="flex gap-3 flex-wrap justify-center max-w-[740px] mb-6">
        {TEMPLATES.map(tpl => (
          <TemplateCardUI key={tpl.title} card={tpl} onClick={onSelectTemplate} />
        ))}
      </div>

      <p className="text-xs text-[#6B7785]">
        Need inspiration?{' '}
        <button className="text-[#1DD68C] hover:underline">View all templates →</button>
      </p>
    </div>
  )
}

function TemplateCardUI({ card, onClick }: { card: TemplateCard; onClick: () => void }) {
  const Icon = card.icon
  return (
    <button
      onClick={onClick}
      className="w-[136px] rounded-xl border border-white/[0.07] bg-[#111214] p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.14)] transition-all hover:border-white/[0.13] hover:bg-[#17181b] cursor-pointer group"
    >
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.035]">
        <Icon size={17} className="text-[#A1A5AB] transition-colors group-hover:text-[#F2F3F5]" />
      </div>
      <p className="text-sm font-medium text-[#E8EDF2] leading-tight">{card.title}</p>
      <p className="text-[11px] text-[#6B7785] mt-1 leading-snug">{card.sub}</p>
    </button>
  )
}

/* ─── Active canvas (after content generated) ─────────────────────── */
function ActiveCanvas({ setSelectedElement }: { setSelectedElement: (el: string | null) => void }) {
  const blocks = [
    { id: 'header', label: 'Header', h: 64 },
    { id: 'hero', label: 'Hero Section', h: 160 },
    { id: 'features', label: 'Features Grid', h: 120 },
    { id: 'cta', label: 'CTA Block', h: 80 },
  ]

  return (
    <div className="p-8 flex flex-col gap-3 min-h-full">
      {blocks.map(block => (
        <div
          key={block.id}
          onClick={e => { e.stopPropagation(); setSelectedElement(block.id) }}
          className="border border-dashed border-white/[0.12] rounded-lg flex items-center justify-center cursor-pointer hover:border-[#1DD68C]/50 hover:bg-[#1DD68C]/[0.02] transition-colors group"
          style={{ height: block.h }}
        >
          <span className="text-xs text-[#6B7785] group-hover:text-[#1DD68C]/70 transition-colors">
            {block.label}
          </span>
        </div>
      ))}
    </div>
  )
}
