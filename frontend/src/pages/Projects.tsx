interface Project {
  name: string
  status: 'Active' | 'Planning' | 'Paused'
  lastEdited: string
}

const projects: Project[] = [
  { name: 'OpenOrg Core', status: 'Active', lastEdited: '10 minutes ago' },
  { name: 'AI Operations', status: 'Active', lastEdited: 'Yesterday' },
  { name: 'Security Review', status: 'Planning', lastEdited: '3 days ago' },
  { name: 'Knowledge Base', status: 'Paused', lastEdited: '1 week ago' },
]

const statusStyles: Record<Project['status'], string> = {
  Active: 'bg-avai-accent/10 text-avai-accent',
  Planning: 'bg-blue-400/10 text-blue-300',
  Paused: 'bg-white/5 text-avai-muted',
}

export function Projects() {
  return (
    <section className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-6 text-center">
        <h2 className="text-xl font-medium text-avai-text">Projects</h2>
        <p className="mt-2 text-sm text-avai-muted">Your active projects</p>
      </div>
      <div className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-2">
        {projects.map((project) => (
          <article
            key={project.name}
            className="rounded-xl border border-avai-border bg-avai-card p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-medium text-avai-text">{project.name}</h3>
              <span
                className={`rounded-full px-2 py-1 text-xs ${statusStyles[project.status]}`}
              >
                {project.status}
              </span>
            </div>
            <p className="mt-6 text-xs text-avai-muted">
              Last edited {project.lastEdited}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}
