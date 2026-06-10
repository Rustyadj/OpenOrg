import { useState } from 'react'
import type { ReactNode } from 'react'
import { LayoutTemplate, ChevronDown, ChevronRight, Lock, X } from 'lucide-react'

type InspectorTab = 'properties' | 'events'

interface Props {
  open: boolean
  onClose: () => void
  selectedElement: string | null
  projectName: string
}

export default function InspectorPanel({ open, onClose, selectedElement, projectName }: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('properties')
  const [seoOpen, setSeoOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Page-level state
  const [pageName, setPageName] = useState('Home')
  const [route] = useState('/')
  const [layout, setLayout] = useState('Default')
  const [width, setWidth] = useState('Full Width')
  const [bgHex, setBgHex] = useState('#0B0F14')
  const [bgOpacity, setBgOpacity] = useState('100')
  const [seoTitle, setSeoTitle] = useState(projectName)
  const [seoDesc, setSeoDesc] = useState('AI-powered app built with AVAI.')

  return (
    <div
      className={`flex flex-col bg-[#0F1419] border-l border-white/[0.07] transition-all duration-200 overflow-hidden shrink-0 ${
        open ? 'w-[260px]' : 'w-0'
      }`}
    >
      {/* Tabs */}
      <div className="h-10 flex items-center border-b border-white/[0.07] shrink-0 px-1 justify-between">
        <div className="flex items-center">
          {(['properties', 'events'] as InspectorTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-xs px-3 py-2.5 capitalize cursor-pointer transition-colors border-b-2 ${
                activeTab === tab
                  ? 'text-[#E8EDF2] border-[#1DD68C]'
                  : 'text-[#6B7785] border-transparent hover:text-[#E8EDF2]'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          title="Close inspector"
          className="p-1 mr-1 rounded text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'properties' && (
          <>
            {/* Empty state / element state */}
            {!selectedElement ? (
              <>
                <div className="p-5 flex flex-col items-center text-center gap-2 border-b border-white/[0.07]">
                  <div className="w-11 h-11 bg-[#141920] rounded-lg flex items-center justify-center">
                    <LayoutTemplate size={18} className="text-[#6B7785]" />
                  </div>
                  <p className="text-sm font-medium text-[#E8EDF2]">Select an element</p>
                  <p className="text-[11px] text-[#6B7785] leading-relaxed">
                    Select a component or page element to view and edit its properties.
                  </p>
                </div>

                {/* Page section */}
                <div className="p-4 flex flex-col gap-3 border-b border-white/[0.07]">
                  <p className="text-[10px] uppercase tracking-widest text-[#6B7785] font-medium">
                    Page
                  </p>

                  <Field label="Page Name">
                    <input
                      value={pageName}
                      onChange={e => setPageName(e.target.value)}
                      className="inspector-input"
                    />
                  </Field>

                  <Field label="Route">
                    <div className="relative flex-1">
                      <input
                        value={route}
                        readOnly
                        className="inspector-input pr-6 w-full"
                      />
                      <Lock size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7785]" />
                    </div>
                  </Field>

                  <Field label="Layout">
                    <select
                      value={layout}
                      onChange={e => setLayout(e.target.value)}
                      className="inspector-input"
                    >
                      {['Default', 'Centered', 'Full'].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Field>

                  <Field label="Width">
                    <select
                      value={width}
                      onChange={e => setWidth(e.target.value)}
                      className="inspector-input"
                    >
                      {['Full Width', 'Fixed', 'Custom'].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Field>

                  <Field label="Background">
                    <div className="flex items-center gap-1.5 flex-1">
                      <div
                        className="w-5 h-5 rounded-sm border border-white/[0.12] shrink-0"
                        style={{ background: bgHex }}
                      />
                      <input
                        value={bgHex}
                        onChange={e => setBgHex(e.target.value)}
                        className="inspector-input w-20"
                      />
                      <input
                        value={bgOpacity}
                        onChange={e => setBgOpacity(e.target.value)}
                        className="inspector-input w-12 text-center"
                      />
                      <span className="text-[10px] text-[#6B7785]">%</span>
                    </div>
                  </Field>
                </div>

                {/* SEO Settings */}
                <CollapsibleSection
                  title="SEO Settings"
                  open={seoOpen}
                  onToggle={() => setSeoOpen(!seoOpen)}
                >
                  <div className="flex flex-col gap-3 pt-2">
                    <Field label="Title">
                      <input
                        value={seoTitle}
                        onChange={e => setSeoTitle(e.target.value)}
                        className="inspector-input"
                      />
                    </Field>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-[#6B7785]">Description</label>
                      <textarea
                        value={seoDesc}
                        onChange={e => setSeoDesc(e.target.value)}
                        rows={2}
                        className="w-full bg-[#141920] border border-white/[0.07] rounded-md px-2.5 py-1.5 text-xs text-[#E8EDF2] outline-none focus:border-[#1DD68C]/40 transition-colors resize-none"
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Advanced */}
                <CollapsibleSection
                  title="Advanced"
                  open={advancedOpen}
                  onToggle={() => setAdvancedOpen(!advancedOpen)}
                >
                  <p className="text-xs text-[#6B7785] pt-2">Advanced options coming soon.</p>
                </CollapsibleSection>
              </>
            ) : (
              <ElementProperties elementId={selectedElement} />
            )}
          </>
        )}

        {activeTab === 'events' && (
          <div className="p-5 flex flex-col items-center text-center gap-2">
            <p className="text-xs text-[#6B7785]">No events configured.</p>
          </div>
        )}
      </div>

      <style>{`
        .inspector-input {
          flex: 1;
          background: #141920;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 11px;
          color: #E8EDF2;
          outline: none;
          transition: border-color 120ms;
          min-width: 0;
        }
        .inspector-input:focus { border-color: rgba(29,214,140,0.4); }
        select.inspector-input { cursor: pointer; }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-[#6B7785] w-[76px] shrink-0">{label}</label>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">{children}</div>
    </div>
  )
}

function CollapsibleSection({
  title, open, onToggle, children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="border-t border-white/[0.07]">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium text-[#6B7785] hover:text-[#E8EDF2] transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function ElementProperties({ elementId }: { elementId: string }) {
  const label = elementId.charAt(0).toUpperCase() + elementId.slice(1)
  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-[10px] uppercase tracking-widest text-[#6B7785] font-medium mb-1">Element</p>
      {[
        { label: 'Name', value: label },
        { label: 'Type', value: 'Section' },
        { label: 'Width', value: '100%' },
        { label: 'Height', value: 'auto' },
      ].map(f => (
        <div key={f.label} className="flex items-center gap-2">
          <label className="text-[10px] text-[#6B7785] w-[76px] shrink-0">{f.label}</label>
          <input
            defaultValue={f.value}
            className="flex-1 bg-[#141920] border border-white/[0.07] rounded-md px-2.5 py-1 text-xs text-[#E8EDF2] outline-none focus:border-[#1DD68C]/40 transition-colors"
          />
        </div>
      ))}
    </div>
  )
}
