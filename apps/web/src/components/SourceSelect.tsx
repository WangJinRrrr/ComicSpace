import type { SourceInfoDto } from "@comicspace/contracts";
import { Select } from "./ui";

export function SourceSelect({
  sources,
  value,
  onChange,
  includeEmpty = false,
}: {
  sources: SourceInfoDto[];
  value: string | undefined;
  onChange: (sourceId: string) => void;
  includeEmpty?: boolean;
}) {
  const available = sources.filter((source) => source.enabled);
  if (available.length === 0 && !includeEmpty) return null;

  return (
    <Select
      aria-label="选择内容源"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-56"
    >
      {available.length === 0 ? (
        <option value="">没有内容源</option>
      ) : null}
      {available.map((source) => (
        <option key={source.id} value={source.id}>
          {source.name}
          {source.status === "needs_config" ? "（需配置）" : ""}
          {source.status === "disabled" ? "（已停用）" : ""}
        </option>
      ))}
    </Select>
  );
}
