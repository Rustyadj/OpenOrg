import { useState } from 'react'
import {
  Monitor, Tablet, Smartphone,
  ZoomOut, ZoomIn, Layers, Grid3x3, History
} from 'lucide-react'
import type { DeviceMode } from './BuilderPage'

interface Props {
  zoom: number
  setZoom: (z: number) => void
  deviceMode: DeviceMode
  setDeviceMode: (m: DeviceMode) => void
}

const DEVICES: { id: DeviceMode; icon: typeof Monitor; title: string }[] = [
  { id: 'desktop', icon: Monitor,    title: 'Desktop' },
  { id: 'tablet',  icon: Tablet,     title: 'Tablet'  },
  { id: 'mobile',  icon: Smartphone, title: 'Mobile'  },
]

export default function CanvasToolbar({ zoom, setZoom, deviceMode, setDeviceMode }: Props) {
  const [gridOn, setGridOn] = useState(false)

  return (
    <div className="h-10 flex items-center bg-[#0F1419] border-t border-white/[0.07] px-4 shrink-0 relative">
      {/* Left — device */}
      <div className="flex items-center gap-0.5">
        {DEVICES.map(({ id, icon: Icon, title }) => (
          <button
            key={id}
            title={title}
            onClick={() => setDeviceMode(id)}
            className={`p-1.5 rounded-md transition-colors ${
              deviceMode === id
                ? 'text-[#1DD68C]'
                : 'text-[#6B7785] hover:text-[#E8EDF2]'
            }`}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>

      {/* Center — zoom */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
        <button
          title="Zoom out"
          onClick={() => setZoom(Math.max(25, zoom - 10))}
          className="p-1 rounded text-[#6B7785] hover:text-[#E8EDF2] transition-colors"
        >
          <ZoomOut size={14} />
        </button>
        <button
          title="Reset zoom"
          onClick={() => setZoom(100)}
          className="text-xs text-[#6B7785] hover:text-[#E8EDF2] transition-colors w-10 text-center tabular-nums"
        >
          {zoom}%
        </button>
        <button
          title="Zoom in"
          onClick={() => setZoom(Math.min(200, zoom + 10))}
          className="p-1 rounded text-[#6B7785] hover:text-[#E8EDF2] transition-colors"
        >
          <ZoomIn size={14} />
        </button>
        <div className="w-px h-3 bg-white/[0.07] mx-1" />
        <button
          onClick={() => setZoom(100)}
          className="text-xs text-[#6B7785] hover:text-[#E8EDF2] transition-colors"
        >
          Fit
        </button>
      </div>

      {/* Right — tools */}
      <div className="ml-auto flex items-center gap-0.5">
        <button
          title="Layers"
          className="p-1.5 rounded-md text-[#6B7785] hover:text-[#E8EDF2] transition-colors"
        >
          <Layers size={14} />
        </button>
        <button
          title="Toggle grid"
          onClick={() => setGridOn(!gridOn)}
          className={`p-1.5 rounded-md transition-colors ${
            gridOn ? 'text-[#1DD68C]' : 'text-[#6B7785] hover:text-[#E8EDF2]'
          }`}
        >
          <Grid3x3 size={14} />
        </button>
        <button
          title="Version history"
          className="p-1.5 rounded-md text-[#6B7785] hover:text-[#E8EDF2] transition-colors"
        >
          <History size={14} />
        </button>
      </div>
    </div>
  )
}
