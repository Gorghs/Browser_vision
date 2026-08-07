interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ label, description, checked, disabled = false, onChange }: ToggleProps) {
  return (
    <label
      className={`flex items-start justify-between gap-3 py-2 ${
        disabled ? 'opacity-40' : 'cursor-pointer'
      }`}
    >
      <span className="flex flex-col">
        <span className="text-sm text-slate-100">{label}</span>
        {description ? <span className="text-xs text-slate-400">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[var(--color-accent)]' : 'bg-slate-600'
        }`}
      >
        <span
          className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </label>
  );
}
