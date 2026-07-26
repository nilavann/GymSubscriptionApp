/** Stand-in for a route whose real screen hasn't been built yet — keeps the nav/router fully wired. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>This screen hasn't been built yet.</p>
    </div>
  );
}
