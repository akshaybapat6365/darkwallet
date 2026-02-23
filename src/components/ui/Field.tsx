type FieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
};

export const Field = ({ label, hint, value, onChange, placeholder, mono = false }: FieldProps) => (
  <label className="block">
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-sm font-medium">{label}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
    <input
      className={`mt-1 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mono ? 'font-mono' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </label>
);

type SelectOption = { value: string; label: string };

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
};

export const SelectField = ({ label, value, onChange, options }: SelectFieldProps) => (
  <label className="block">
    <div className="text-sm font-medium">{label}</div>
    <select
      className="mt-1 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>
        Select…
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);
