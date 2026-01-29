'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  FormDefinition, 
  FlattenedField, 
  flattenDefinition, 
  getVisibleFields, 
  validateField, 
  getDefaultFormData,
  formatOptionLabel 
} from '@/lib/formDefinition';

interface FlashModeIntakeProps {
  formId: string;
  token: string;
  definition: FormDefinition;
  brandColor: string;
  agencyName?: string;
  agencyLogo?: string | null;
  formName?: string;
  onSubmit: (data: Record<string, string | boolean>) => Promise<void>;
  isSubmitting: boolean;
  submitError: string | null;
  onModeSwitch?: () => void;
  allowModeToggle?: boolean;
}

const STORAGE_KEY_PREFIX = 'insurigence_intake_';

export default function FlashModeIntake({
  formId,
  token,
  definition,
  brandColor,
  agencyName,
  agencyLogo,
  formName,
  onSubmit,
  isSubmitting,
  submitError,
  onModeSwitch,
  allowModeToggle,
}: FlashModeIntakeProps) {
  const storageKey = `${STORAGE_KEY_PREFIX}${formId}_${token.slice(0, 8)}`;
  
  const [formData, setFormData] = useState<Record<string, string | boolean>>(() => 
    getDefaultFormData(definition)
  );

  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const allFields = flattenDefinition(definition);
  
  const getVisibleFieldsList = useCallback(() => {
    return getVisibleFields(allFields, formData);
  }, [allFields, formData]);

  const visibleFields = getVisibleFieldsList();
  const totalSteps = visibleFields.length;
  const currentField = visibleFields[currentStep];
  const progress = totalSteps > 0 ? ((currentStep + 1) / totalSteps) * 100 : 0;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.formData) {
          setFormData(prev => ({ ...prev, ...parsed.formData }));
        }
        if (typeof parsed.currentStep === 'number') {
          setCurrentStep(Math.min(parsed.currentStep, Math.max(0, totalSteps - 1)));
        }
      }
    } catch {
      console.log('No saved progress found');
    }
  }, [storageKey, totalSteps]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ formData, currentStep }));
    } catch {
      console.log('Could not save progress');
    }
  }, [formData, currentStep, storageKey]);

  const handleNext = () => {
    if (!currentField) return;

    const value = formData[currentField.id];
    const error = validateField(currentField, value);

    if (error) {
      setErrors(prev => ({ ...prev, [currentField.id]: error }));
      setTouched(prev => ({ ...prev, [currentField.id]: true }));
      return;
    }

    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[currentField.id];
      return newErrors;
    });

    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};
    visibleFields.forEach(field => {
      const error = validateField(field, formData[field.id]);
      if (error) {
        newErrors[field.id] = error;
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstErrorIndex = visibleFields.findIndex(f => newErrors[f.id]);
      if (firstErrorIndex !== -1) {
        setCurrentStep(firstErrorIndex);
      }
      return;
    }

    try {
      await onSubmit(formData);
      localStorage.removeItem(storageKey);
    } catch {
      console.log('Submit error');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    setTouched(prev => ({ ...prev, [name]: true }));

    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && currentField?.type !== 'textarea') {
      e.preventDefault();
      handleNext();
    }
  };

  if (!currentField) {
    return null;
  }

  const renderInput = (field: FlattenedField) => {
    const value = formData[field.id];
    const hasError = touched[field.id] && errors[field.id];

    const inputClasses = `w-full px-4 py-4 text-lg rounded-xl border-2 transition-all duration-200 focus:outline-none focus:ring-0 ${
      hasError 
        ? 'border-red-400 bg-red-50' 
        : 'border-slate-200 focus:border-current'
    }`;

    switch (field.type) {
      case 'select':
        return (
          <select
            name={field.id}
            value={value as string}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className={inputClasses}
            style={{ borderColor: hasError ? undefined : brandColor }}
            autoFocus
            data-testid={`flash-select-${field.id}`}
          >
            <option value="">Select an option</option>
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{formatOptionLabel(opt)}</option>
            ))}
          </select>
        );

      case 'boolean':
        return (
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => {
                setFormData(prev => ({ ...prev, [field.id]: true }));
                setTimeout(() => handleNext(), 100);
              }}
              className="px-8 py-4 text-lg font-medium rounded-xl border-2 transition-all duration-200 hover:scale-105"
              style={{ borderColor: brandColor, color: brandColor }}
              data-testid={`flash-boolean-${field.id}-yes`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => {
                setFormData(prev => ({ ...prev, [field.id]: false }));
                setTimeout(() => handleNext(), 100);
              }}
              className="px-8 py-4 text-lg font-medium rounded-xl border-2 transition-all duration-200 hover:scale-105"
              style={{ borderColor: brandColor, color: brandColor }}
              data-testid={`flash-boolean-${field.id}-no`}
            >
              No
            </button>
          </div>
        );

      case 'textarea':
        return (
          <textarea
            name={field.id}
            value={value as string}
            onChange={handleChange}
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            className={inputClasses}
            rows={4}
            style={{ borderColor: hasError ? undefined : brandColor }}
            autoFocus
            data-testid={`flash-textarea-${field.id}`}
          />
        );

      default:
        const inputType = field.type === 'currency' ? 'text' : 
                          field.type === 'phone' ? 'tel' : field.type;
        return (
          <input
            type={inputType}
            name={field.id}
            value={value as string}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            className={inputClasses}
            style={{ borderColor: hasError ? undefined : brandColor }}
            autoFocus
            data-testid={`flash-input-${field.id}`}
          />
        );
    }
  };

  return (
    <div 
      className="min-h-screen flex flex-col" 
      style={{ backgroundColor: '#F5F7FA' }}
    >
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {agencyLogo && (
              <img src={agencyLogo} alt={agencyName} className="h-8 w-auto" />
            )}
            <span className="text-sm font-medium" style={{ color: brandColor }}>
              {formName || 'Insurance Intake'}
            </span>
          </div>
          {allowModeToggle && onModeSwitch && (
            <button
              onClick={onModeSwitch}
              className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-slate-50"
              style={{ borderColor: brandColor, color: brandColor }}
              data-testid="button-switch-to-standard"
            >
              Full Form
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-2 bg-white">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">
              Question {currentStep + 1} of {totalSteps}
            </span>
            <span className="text-xs font-medium" style={{ color: brandColor }}>
              {currentField.sectionTitle}
            </span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-500 ease-out rounded-full"
              style={{ width: `${progress}%`, backgroundColor: brandColor }}
              data-testid="progress-bar"
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col justify-center px-4 py-8">
        <div className="max-w-lg mx-auto w-full">
          {submitError && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm text-red-700">{submitError}</p>
            </div>
          )}

          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold mb-2" style={{ color: brandColor }}>
              {currentField.label}
              {currentField.required && <span className="text-red-500 ml-1">*</span>}
            </h2>
          </div>

          <div className="mb-6">
            {renderInput(currentField)}
            {touched[currentField.id] && errors[currentField.id] && (
              <p className="mt-2 text-sm text-red-600 text-center" data-testid="flash-error">
                {errors[currentField.id]}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="px-4 py-4 bg-white border-t border-slate-200">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {currentStep > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 px-6 rounded-xl font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              data-testid="button-back"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isSubmitting}
            className="flex-1 py-3 px-6 rounded-xl font-semibold text-white transition-all duration-200 disabled:opacity-50"
            style={{ backgroundColor: brandColor }}
            data-testid={currentStep === totalSteps - 1 ? 'button-submit' : 'button-next'}
          >
            {isSubmitting 
              ? 'Submitting...' 
              : currentStep === totalSteps - 1 
                ? 'Submit' 
                : 'Next'
            }
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-3 bg-white">
        <p className="text-xs text-slate-400">
          Powered by <span className="font-medium">Insurigence</span>
        </p>
      </div>
    </div>
  );
}
