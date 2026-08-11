export type AgentVariableView = {
  id?: string;
  key: string;
  label: string;
  description?: string | null;
  type: 'TEXT' | 'URL' | 'NUMBER' | 'BOOLEAN' | 'SECRET';
  required: boolean;
  defaultValue?: string | null;
  constraints?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  } | null;
  displayOrder: number;
};

export type VariableValues = Record<string, string | number | boolean>;
