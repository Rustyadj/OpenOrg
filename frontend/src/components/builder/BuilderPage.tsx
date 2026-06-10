import { useState } from 'react'
import BuilderTopBar from './BuilderTopBar'
import ComponentPanel from './ComponentPanel'
import Canvas from './Canvas'
import InspectorPanel from './InspectorPanel'
import CanvasToolbar from './CanvasToolbar'

export type DeviceMode = 'desktop' | 'tablet' | 'mobile'
export type BuilderTab = 'builder' | 'settings' | 'integrations' | 'analytics' | 'preview'

export default function BuilderPage() {
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const [componentPanelOpen, setComponentPanelOpen] = useState(true)
  const [inspectorPanelOpen, setInspectorPanelOpen] = useState(true)
  const [zoom, setZoom] = useState(100)
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop')
  const [projectName, setProjectName] = useState('Untitled App')
  const [canvasHasContent, setCanvasHasContent] = useState(false)
  const [activeTab, setActiveTab] = useState<BuilderTab>('builder')

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#090A0B]">
      <BuilderTopBar
        projectName={projectName}
        setProjectName={setProjectName}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        deviceMode={deviceMode}
        setDeviceMode={setDeviceMode}
      />
      <div className="flex flex-1 overflow-hidden">
        <ComponentPanel
          open={componentPanelOpen}
          onClose={() => setComponentPanelOpen(false)}
        />
        <div className="flex flex-col flex-1 overflow-hidden relative">
          <Canvas
            canvasHasContent={canvasHasContent}
            setCanvasHasContent={setCanvasHasContent}
            deviceMode={deviceMode}
            zoom={zoom}
            selectedElement={selectedElement}
            setSelectedElement={setSelectedElement}
            componentPanelOpen={componentPanelOpen}
            setComponentPanelOpen={setComponentPanelOpen}
          />
          <CanvasToolbar
            zoom={zoom}
            setZoom={setZoom}
            deviceMode={deviceMode}
            setDeviceMode={setDeviceMode}
          />
        </div>
        <InspectorPanel
          open={inspectorPanelOpen}
          onClose={() => setInspectorPanelOpen(false)}
          selectedElement={selectedElement}
          projectName={projectName}
        />
      </div>
    </div>
  )
}
