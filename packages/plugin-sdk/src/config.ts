export type ConfigValue = string | number | boolean;
export type ConfigValues = Record<string, ConfigValue>;

export interface ConfigOption {
  label: string;
  value: string;
}

export type ConfigField =
  | {
      key: string;
      label: string;
      type: "string" | "password" | "url";
      required?: boolean;
      default?: string;
      placeholder?: string;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: "number";
      required?: boolean;
      default?: number;
      min?: number;
      max?: number;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: "boolean";
      default?: boolean;
      description?: string;
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: ConfigOption[];
      required?: boolean;
      default?: string;
      description?: string;
    };
