export interface FilterOption {
  label: string;
  value: string;
}

export type FilterValue = string | string[] | boolean | number | undefined;
export type FilterValues = Record<string, FilterValue>;

export type FilterDef =
  | {
      key: string;
      label: string;
      type: "text";
      placeholder?: string;
      default?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: FilterOption[];
      default?: string;
    }
  | {
      key: string;
      label: string;
      type: "multi-select";
      options: FilterOption[];
      default?: string[];
    }
  | { key: string; label: string; type: "boolean"; default?: boolean }
  | {
      key: string;
      label: string;
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      default?: number;
    }
  | {
      key: string;
      label: string;
      type: "sort";
      options: FilterOption[];
      default?: string;
    };
