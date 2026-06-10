interface StubPageProps {
  title: string
  subtitle: string
}

export function StubPage({ title, subtitle }: StubPageProps) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center">
      <h2 className="text-xl font-medium text-avai-text">{title}</h2>
      <p className="mt-2 text-sm text-avai-muted">{subtitle}</p>
    </section>
  )
}
