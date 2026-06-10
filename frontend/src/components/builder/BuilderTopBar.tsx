import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  RotateCcw, RotateCw, Monitor, Tablet, Smartphone,
  ChevronDown, MoreHorizontal, ChevronLeft
} from 'lucide-react'
import type { DeviceMode, BuilderTab } from './BuilderPage'

interface Props {
  projectName: string
  setProjectName: (name: string) => void
  activeTab: BuilderTab
  setActiveTab: (tab: BuilderTab) => void
  deviceMode: DeviceMode
  setDeviceMode: (mode: DeviceMode) => void
}

const TABS: { id: BuilderTab; label: string }[] = [
  { id: 'builder', label: 'Builder' },
  { id: 'settings', label: 'Settings' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'preview', label: 'Preview' },
]

const DEVICES: { id: DeviceMode; icon: typeof Monitor; title: string }[] = [
  { id: 'desktop', icon: Monitor, title: 'Desktop' },
  { id: 'tablet', icon: Tablet, title: 'Tablet' },
  { id: 'mobile', icon: Smartphone, title: 'Mobile' },
]

export default function BuilderTopBar({
  projectName, setProjectName, activeTab, setActiveTab, deviceMode, setDeviceMode
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(projectName)
  const [publishOpen, setPublishOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commitEdit = () => {
    setProjectName(draft.trim() || 'Untitled App')
    setEditing(false)
  }

  return (
    <div className="h-12 flex items-center bg-[#0F1419] border-b border-white/[0.07] px-4 gap-3 shrink-0 relative z-10">
      {/* Left */}
      <div className="flex items-center gap-3">
        <Link
          to="/projects"
          className="flex items-center gap-1 text-xs text-[#6B7785] hover:text-[#1DD68C] transition-colors"
        >
          <ChevronLeft size={14} />
          <span>Back</span>
        </Link>

        <div className="w-px h-4 bg-white/[0.07]" />

        <div className="flex items-center gap-2">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
              className="bg-[#141920] border border-[#1DD68C]/50 rounded px-2 py-0.5 text-sm font-medium text-[#E8EDF2] outline-none w-44"
            />
          ) : (
            <span
              onClick={() => { setDraft(projectName); setEditing(true) }}
              className="text-sm font-medium text-[#E8EDF2] cursor-pointer hover:text-white"
            >
              {projectName}
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/[0.07] text-[#6B7785]">
            Draft
          </span>
        </div>
      </div>

      {/* Center tabs */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`text-xs px-3 py-3 cursor-pointer transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'text-[#E8EDF2] border-[#1DD68C]'
                : 'text-[#6B7785] border-transparent hover:text-[#E8EDF2]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right */}
      <div className="ml-auto flex items-center gap-1">
        <button title="Undo" className="p-1.5 rounded text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors">
          <RotateCcw size={15} />
        </button>
        <button title="Redo" className="p-1.5 rounded text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors">
          <RotateCw size={15} />
        </button>

        <div className="w-px h-4 bg-white/[0.07] mx-1" />

        <div className="flex items-center gap-0.5 bg-[#141920] rounded-lg p-0.5">
          {DEVICES.map(({ id, icon: Icon, title }) => (
            <button
              key={id}
              title={title}
              onClick={() => setDeviceMode(id)}
              className={`p-1.5 rounded-md transition-colors ${
                deviceMode === id
                  ? 'bg-[#1DD68C]/15 text-[#1DD68C]'
                  : 'text-[#6B7785] hover:text-[#E8EDF2]'
              }`}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/[0.07] mx-1" />

        <button className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.07] text-[#6B7785] hover:text-[#E8EDF2] hover:border-white/[0.15] transition-colors">
          Test
        </button>

        <div className="relative">
          <div className="flex items-center">
            <button
              onClick={() => alert('Publishing...')}
              className="text-xs px-3 py-1.5 rounded-l-lg bg-[#1DD68C] text-[#0B0F14] font-medium hover:brightness-110 transition-all"
            >
              Publish
            </button>
            <button
              onClick={() => setPublishOpen(!publishOpen)}
              className="px-1.5 py-1.5 rounded-r-lg bg-[#1DD68C] text-[#0B0F14] hover:brightness-110 transition-all border-l border-[#0B0F14]/20"
            >
              <ChevronDown size={13} />
            </button>
          </div>
          {publishOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-[#141920] border border-white/[0.07] rounded-lg py-1 shadow-lg z-20">
              {['Publish to staging', 'Publish to production'].map(opt => (
                <button
                  key={opt}
                  onClick={() => { alert(opt); setPublishOpen(false) }}
                  className="w-full text-left text-xs px-3 py-2 text-[#E8EDF2] hover:bg-white/5 transition-colors"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>

        <button title="More options" className="p-1.5 rounded text-[#6B7785] hover:text-[#E8EDF2] hover:bg-white/5 transition-colors">
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  )
}
