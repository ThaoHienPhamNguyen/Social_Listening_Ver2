export function MetricTooltip({ text, position = 'top' }: { text: string; position?: 'top' | 'bottom' }) {
  const tooltipClasses =
    position === 'top'
      ? 'absolute bottom-full left-1/2 -translate-x-1/2 mb-2'
      : 'absolute top-full left-1/2 -translate-x-1/2 mt-2';

  return (
    <span className="relative inline-flex group align-middle ml-1">
      <span
        className="w-3.5 h-3.5 rounded-full border border-line text-ink-3 text-[9px] font-bold flex items-center justify-center cursor-help leading-none"
        aria-label={text}
      >
        ?
      </span>
      <span
        className={`pointer-events-none ${tooltipClasses} w-[220px] rounded bg-ink text-white text-xs font-normal normal-case tracking-normal p-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-10`}
      >
        {text}
      </span>
    </span>
  );
}
