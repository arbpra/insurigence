'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import FlashModeIntake from '@/components/FlashModeIntake';
import { 
  FormDefinition, 
  flattenDefinition, 
  getVisibleFields, 
  validateField, 
  getDefaultFormData,
  formatOptionLabel 
} from '@/lib/formDefinition';

interface IntakeFormData {
  id: string;
  name: string;
  agencyId: string;
  agencyName: string;
  agencyLogo: string | null;
  brandColor: string | null;
  presentationMode: 'STANDARD' | 'FLASH' | 'BOTH';
  allowModeToggle: boolean;
  definition: FormDefinition;
}

export default function PublicIntakePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const formId = params.formId as string;
  const token = searchParams.get('token');
  const modeOverride = searchParams.get('mode') as 'standard' | 'flash' | null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intakeForm, setIntakeForm] = useState<IntakeFormData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentMode, setCurrentMode] = useState<'standard' | 'flash'>('standard');
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});

  useEffect(() => {
    const validateAndFetch = async () => {
      if (!token) {
        setError('Invalid link. Missing access token.');
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/intake/public/validate?formId=${formId}&token=${token}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Invalid or expired link');
        }
        const data = await res.json();
        setIntakeForm(data.form);

        if (data.form.definition) {
          setFormData(getDefaultFormData(data.form.definition));
        }

        if (modeOverride) {
          setCurrentMode(modeOverride);
        } else {
          const defaultMode = data.form.presentationMode === 'FLASH' ? 'flash' : 
                              data.form.presentationMode === 'BOTH' ? 'standard' : 'standard';
          setCurrentMode(defaultMode);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load form');
      } finally {
        setLoading(false);
      }
    };

    validateAndFetch();
  }, [formId, token, modeOverride]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));

    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validateForm = (): boolean => {
    if (!intakeForm?.definition) return false;

    const newErrors: Record<string, string> = {};
    const allFields = flattenDefinition(intakeForm.definition);
    const visibleFields = getVisibleFields(allFields, formData);

    for (const field of visibleFields) {
      const error = validateField(field, formData[field.id]);
      if (error) {
        newErrors[field.id] = error;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/intake/public/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formId,
          token,
          ...formData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit form');
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFlashSubmit = async (data: Record<string, string | boolean>) => {
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/intake/public/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formId,
          token,
          ...data,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit form');
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSwitchMode = intakeForm?.allowModeToggle || intakeForm?.presentationMode === 'BOTH';

  const handleModeSwitch = () => {
    setCurrentMode(currentMode === 'standard' ? 'flash' : 'standard');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4" style={{ borderColor: '#0D2137', borderTopColor: 'transparent' }}></div>
          <p style={{ color: '#64748B' }}>Loading form...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#FEE2E2' }}>
            <svg className="w-8 h-8" style={{ color: '#DC2626' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#0D2137' }}>Access Denied</h1>
          <p style={{ color: '#64748B' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#DCFCE7' }}>
            <svg className="w-8 h-8" style={{ color: '#16A34A' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: '#0D2137' }}>Thank You!</h1>
          <p className="text-lg mb-2" style={{ color: '#64748B' }}>Your information has been received.</p>
          <p style={{ color: '#94A3B8' }}>An agent will follow up with you shortly.</p>
          {intakeForm?.agencyName && (
            <p className="mt-4 text-sm" style={{ color: '#94A3B8' }}>
              Submitted to {intakeForm.agencyName}
            </p>
          )}
        </div>
      </div>
    );
  }

  const brandColor = intakeForm?.brandColor || '#0D2137';

  if (currentMode === 'flash' && intakeForm?.definition) {
    return (
      <FlashModeIntake
        formId={formId}
        token={token || ''}
        definition={intakeForm.definition}
        brandColor={brandColor}
        agencyName={intakeForm.agencyName}
        agencyLogo={intakeForm.agencyLogo}
        formName={intakeForm.name}
        onSubmit={handleFlashSubmit}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onModeSwitch={canSwitchMode ? handleModeSwitch : undefined}
        allowModeToggle={canSwitchMode}
      />
    );
  }

  if (!intakeForm?.definition) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="text-center">
          <p style={{ color: '#64748B' }}>Form definition not available</p>
        </div>
      </div>
    );
  }

  const renderField = (field: { id: string; type: string; label: string; required: boolean; options?: string[]; showIf?: { field: string; value: boolean | string } }) => {
    if (field.showIf) {
      const conditionValue = formData[field.showIf.field];
      if (conditionValue !== field.showIf.value) {
        return null;
      }
    }

    const value = formData[field.id];
    const hasError = errors[field.id];

    const inputClasses = `w-full px-4 py-2.5 rounded-lg border ${hasError ? 'border-red-500' : 'border-slate-300'} focus:outline-none focus:ring-2 focus:ring-opacity-50`;

    switch (field.type) {
      case 'select':
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
              {field.label} {field.required && <span style={{ color: '#DC2626' }}>*</span>}
            </label>
            <select
              name={field.id}
              value={value as string}
              onChange={handleChange}
              className={inputClasses}
              data-testid={`select-${field.id}`}
            >
              <option value="">Select an option</option>
              {field.options?.map(opt => (
                <option key={opt} value={opt}>{formatOptionLabel(opt)}</option>
              ))}
            </select>
            {hasError && <p className="text-sm mt-1" style={{ color: '#DC2626' }}>{hasError}</p>}
          </div>
        );

      case 'boolean':
        return (
          <div key={field.id}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name={field.id}
                checked={value as boolean}
                onChange={handleChange}
                className="w-4 h-4 rounded border-slate-300"
                data-testid={`checkbox-${field.id}`}
              />
              <span className="text-sm" style={{ color: '#374151' }}>{field.label}</span>
            </label>
          </div>
        );

      case 'textarea':
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
              {field.label} {field.required && <span style={{ color: '#DC2626' }}>*</span>}
            </label>
            <textarea
              name={field.id}
              value={value as string}
              onChange={handleChange}
              rows={3}
              className={inputClasses}
              data-testid={`textarea-${field.id}`}
            />
            {hasError && <p className="text-sm mt-1" style={{ color: '#DC2626' }}>{hasError}</p>}
          </div>
        );

      default:
        const inputType = field.type === 'currency' ? 'text' : 
                          field.type === 'phone' ? 'tel' : field.type;
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
              {field.label} {field.required && <span style={{ color: '#DC2626' }}>*</span>}
            </label>
            <input
              type={inputType}
              name={field.id}
              value={value as string}
              onChange={handleChange}
              className={inputClasses}
              data-testid={`input-${field.id}`}
            />
            {hasError && <p className="text-sm mt-1" style={{ color: '#DC2626' }}>{hasError}</p>}
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F7FA' }}>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {intakeForm?.agencyLogo && (
            <img src={intakeForm.agencyLogo} alt={intakeForm.agencyName} className="h-12 mx-auto mb-4" />
          )}
          <h1 className="text-2xl font-bold mb-2" style={{ color: brandColor }}>
            {intakeForm?.name || 'Insurance Intake Form'}
          </h1>
          {intakeForm?.agencyName && (
            <p style={{ color: '#64748B' }}>Powered by {intakeForm.agencyName}</p>
          )}
          {canSwitchMode && (
            <button
              onClick={handleModeSwitch}
              className="mt-4 text-sm font-medium px-4 py-2 rounded-full border transition-colors hover:bg-slate-50"
              style={{ borderColor: brandColor, color: brandColor }}
              data-testid="button-switch-to-flash"
            >
              Switch to Quick Mode
            </button>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
          {submitError && (
            <div className="mb-6 p-4 rounded-lg border" style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
              <p className="text-sm" style={{ color: '#DC2626' }}>{submitError}</p>
            </div>
          )}

          {/* Render sections from definition */}
          {intakeForm.definition.sections.map((section) => (
            <div key={section.id} className="mb-8">
              <h2 className="text-lg font-semibold mb-4 pb-2 border-b" style={{ color: brandColor }}>
                {section.title}
              </h2>
              <div className="space-y-4">
                {section.fields.map(field => renderField(field))}
              </div>
            </div>
          ))}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-6 rounded-xl text-white font-semibold transition-all duration-200 disabled:opacity-50"
            style={{ backgroundColor: brandColor }}
            data-testid="button-submit"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Request'}
          </button>

          <p className="text-center text-xs mt-4" style={{ color: '#94A3B8' }}>
            Your information is secure and will only be used to provide you with an insurance quote.
          </p>
        </form>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs" style={{ color: '#94A3B8' }}>
            Powered by <span className="font-medium">Insurigence</span>
          </p>
        </div>
      </div>
    </div>
  );
}
