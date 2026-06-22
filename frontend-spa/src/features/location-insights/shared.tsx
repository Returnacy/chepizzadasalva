// Small shared presentational helpers for the location-insights tabs.

export function PanelLoading() {
  return (
    <div className="h-64 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue" />
    </div>
  );
}

export function PanelError({ message }: { message?: string }) {
  return <div className="text-center text-red-600 py-8">Errore nel caricamento{message ? `: ${message}` : ''}</div>;
}

export function PanelEmpty({ text }: { text: string }) {
  return <div className="text-center text-gray-500 py-8">{text}</div>;
}

export function pct(numerator: number, denominator: number): string {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}
