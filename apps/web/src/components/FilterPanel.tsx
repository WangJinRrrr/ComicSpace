import type { FilterDefDto, FilterValuesDto } from "@comicspace/contracts";
import { Button, Field, Input, Select } from "./ui";

export function FilterPanel({
  filters,
  values,
  onChange,
  onReset,
}: {
  filters: FilterDefDto[];
  values: FilterValuesDto;
  onChange: (next: FilterValuesDto) => void;
  onReset: () => void;
}) {
  if (filters.length === 0) return null;

  const setValue = (key: string, value: FilterValuesDto[string]) => {
    onChange({ ...values, [key]: value });
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">筛选</h2>
        <Button variant="ghost" size="sm" onClick={onReset}>
          重置
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filters.map((filter) => {
          const value = values[filter.key] ?? filter.default;
          if (filter.type === "text") {
            return (
              <Field key={filter.key} label={filter.label}>
                <Input
                  value={typeof value === "string" ? value : ""}
                  placeholder={filter.placeholder}
                  onChange={(event) =>
                    setValue(filter.key, event.target.value)
                  }
                />
              </Field>
            );
          }
          if (filter.type === "number") {
            return (
              <Field key={filter.key} label={filter.label}>
                <Input
                  type="number"
                  min={filter.min}
                  max={filter.max}
                  step={filter.step}
                  value={typeof value === "number" ? value : ""}
                  onChange={(event) =>
                    setValue(
                      filter.key,
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                    )
                  }
                />
              </Field>
            );
          }
          if (filter.type === "boolean") {
            return (
              <label
                key={filter.key}
                className="flex items-center gap-2 self-end pb-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--cs-accent)]"
                  checked={Boolean(value)}
                  onChange={(event) =>
                    setValue(filter.key, event.target.checked)
                  }
                />
                {filter.label}
              </label>
            );
          }
          if (filter.type === "multi-select") {
            const selected = Array.isArray(value) ? value : [];
            return (
              <Field key={filter.key} label={filter.label}>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-2 scrollbar-thin">
                  {filter.options.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-xs text-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[var(--cs-accent)]"
                        checked={selected.includes(option.value)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...selected, option.value]
                            : selected.filter((item) => item !== option.value);
                          setValue(filter.key, next);
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </Field>
            );
          }
          return (
            <Field key={filter.key} label={filter.label}>
              <Select
                value={typeof value === "string" ? value : ""}
                onChange={(event) =>
                  setValue(filter.key, event.target.value || undefined)
                }
              >
                <option value="">全部</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
    </div>
  );
}
