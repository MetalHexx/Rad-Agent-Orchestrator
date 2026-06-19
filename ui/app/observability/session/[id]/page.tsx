export default function SessionDetailPlaceholderPage({ params }: { params: { id: string } }) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-screen-2xl px-6 py-6">
      <h1 className="text-xl font-semibold text-foreground">Session {params.id}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The full session detail view ships in TELEMETRY-5. This is a placeholder.
      </p>
    </main>
  );
}
