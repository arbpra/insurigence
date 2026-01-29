export interface FormField {
  id: string;
  type: 'text' | 'number' | 'email' | 'phone' | 'date' | 'select' | 'boolean' | 'textarea' | 'currency';
  label: string;
  required: boolean;
  options?: string[];
  showIf?: { field: string; value: boolean | string };
  placeholder?: string;
}

export interface FormSection {
  id: string;
  title: string;
  fields: FormField[];
}

export interface FormDefinition {
  version: string;
  sections: FormSection[];
}

export interface FlattenedField extends FormField {
  sectionId: string;
  sectionTitle: string;
}

export function flattenDefinition(definition: FormDefinition): FlattenedField[] {
  const flattened: FlattenedField[] = [];
  
  for (const section of definition.sections) {
    for (const field of section.fields) {
      flattened.push({
        ...field,
        sectionId: section.id,
        sectionTitle: section.title,
      });
    }
  }
  
  return flattened;
}

export function getVisibleFields(
  fields: FlattenedField[],
  formData: Record<string, unknown>
): FlattenedField[] {
  return fields.filter(field => {
    if (field.showIf) {
      const conditionValue = formData[field.showIf.field];
      return conditionValue === field.showIf.value;
    }
    return true;
  });
}

export function validateField(
  field: FormField,
  value: unknown
): string | null {
  if (field.required) {
    if (field.type === 'boolean') {
      return null;
    }
    if (!value || (typeof value === 'string' && !value.trim())) {
      return `${field.label} is required`;
    }
  }

  if (field.type === 'email' && value && typeof value === 'string') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'Please enter a valid email address';
    }
  }

  return null;
}

export function getDefaultFormData(definition: FormDefinition): Record<string, string | boolean> {
  const data: Record<string, string | boolean> = {};
  
  for (const section of definition.sections) {
    for (const field of section.fields) {
      if (field.type === 'boolean') {
        data[field.id] = false;
      } else if (field.type === 'select' && field.options && field.options.length > 0) {
        data[field.id] = '';
      } else {
        data[field.id] = '';
      }
    }
  }
  
  return data;
}

export function formatOptionLabel(value: string): string {
  const labels: Record<string, string> = {
    construction: 'Construction',
    manufacturing: 'Manufacturing',
    retail: 'Retail',
    professional_services: 'Professional Services',
    hospitality: 'Hospitality',
    healthcare: 'Healthcare',
    technology: 'Technology',
    other: 'Other',
    '500000': '$500,000 / $1,000,000',
    '1000000': '$1,000,000 / $2,000,000',
    '2000000': '$2,000,000 / $4,000,000',
    '5000000': '$5,000,000 / $10,000,000',
  };
  
  return labels[value] || value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
