import { Send } from 'lucide-react'

export function Chat() {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-avai-border px-6 py-4">
        <h2 className="text-xl font-medium text-avai-text">AI Chat</h2>
        <p className="mt-2 text-sm text-avai-muted">
          Conversational AI workspace
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="ml-auto max-w-xl rounded-2xl rounded-br-sm bg-avai-accent px-4 py-3 text-sm text-avai-bg">
          Summarize the current OpenOrg project priorities.
        </div>
        <div className="max-w-xl rounded-2xl rounded-bl-sm border border-avai-border bg-avai-card px-4 py-3 text-sm text-avai-text">
          The current priorities are the application shell, organization
          workflows, project visibility, and secure AI collaboration.
        </div>
        <div className="ml-auto max-w-xl rounded-2xl rounded-br-sm bg-avai-accent px-4 py-3 text-sm text-avai-bg">
          Turn those into a focused delivery plan.
        </div>
      </div>

      <form
        className="flex gap-3 border-t border-avai-border bg-avai-surface p-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          type="text"
          aria-label="Chat message"
          placeholder="Message AVAI..."
          className="min-w-0 flex-1 rounded-lg border border-avai-border bg-avai-card px-4 py-2 text-sm text-avai-text outline-none placeholder:text-avai-muted focus:border-avai-accent"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-avai-accent px-4 py-2 text-sm font-medium text-avai-bg transition-opacity hover:opacity-90"
        >
          <Send size={16} />
          Send
        </button>
      </form>
    </section>
  )
}
