import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { Boards } from './pages/Boards'
import { Chat } from './pages/Chat'
import { Home } from './pages/Home'
import { Integrations } from './pages/Integrations'
import { Memory } from './pages/Memory'
import { Organization } from './pages/Organization'
import { Projects } from './pages/Projects'
import { Security } from './pages/Security'
import { Settings } from './pages/Settings'
import { Templates } from './pages/Templates'
import { Workflows } from './pages/Workflows'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="chat" element={<Chat />} />
        <Route
          path="builder"
          element={
            <div className="flex flex-1 items-center justify-center text-avai-text">
              Builder coming in Part 2
            </div>
          }
        />
        <Route path="projects" element={<Projects />} />
        <Route path="templates" element={<Templates />} />
        <Route path="organization" element={<Organization />} />
        <Route path="boards" element={<Boards />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="security" element={<Security />} />
        <Route path="memory" element={<Memory />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App
