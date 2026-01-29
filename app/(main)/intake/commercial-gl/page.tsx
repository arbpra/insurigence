'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/AppLayout';
import { PageHeader, Button } from '@/components/ui';

interface FormData {
  companyName: string;
  yearsInBusiness: string;
  industry: string;
  annualRevenue: string;
  numberOfEmployees: string;
  requestedLimits: string;
  effectiveDate: string;
  priorClaims: boolean;
  priorClaimsDetails: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  additionalNotes: string;
}

interface FormErrors {
  [key: string]: string;
}

const sections = [
  { id: 'business', label: 'Business Info' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'contact', label: 'Contact' },
  { id: 'additional', label: 'Additional' },
];

export default function CommercialGLIntakePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [activeSection, setActiveSection] = useState('business');
  
  const [formData, setFormData] = useState<FormData>({
    companyName: '',
    yearsInBusiness: '',
    industry: '',
    annualRevenue: '',
    numberOfEmployees: '',
    requestedLimits: '1000000',
    effectiveDate: '',
    priorClaims: false,
    priorClaimsDetails: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    additionalNotes: '',
  });

  const industries = [
    { value: '', label: 'Select an industry' },
    { value: 'construction', label: 'Construction' },
    { value: 'manufacturing', label: 'Manufacturing' },
    { value: 'retail', label: 'Retail' },
    { value: 'healthcare', label: 'Healthcare' },
    { value: 'technology', label: 'Technology' },
    { value: 'hospitality', label: 'Hospitality' },
    { value: 'professional_services', label: 'Professional Services' },
    { value: 'real_estate', label: 'Real Estate' },
    { value: 'transportation', label: 'Transportation' },
    { value: 'other', label: 'Other' },
  ];

  const limitOptions = [
    { value: '500000', label: '$500,000 / $1,000,000' },
    { value: '1000000', label: '$1,000,000 / $2,000,000' },
    { value: '2000000', label: '$2,000,000 / $4,000,000' },
    { value: '5000000', label: '$5,000,000 / $10,000,000' },
  ];

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
    const newErrors: FormErrors = {};

    if (!formData.companyName.trim()) {
      newErrors.companyName = 'Company name is required';
    }

    if (!formData.contactName.trim()) {
      newErrors.contactName = 'Contact name is required';
    }

    if (!formData.contactEmail.trim()) {
      newErrors.contactEmail = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contactEmail)) {
      newErrors.contactEmail = 'Please enter a valid email address';
    }

    if (!formData.industry) {
      newErrors.industry = 'Please select an industry';
    }

    if (formData.priorClaims && !formData.priorClaimsDetails.trim()) {
      newErrors.priorClaimsDetails = 'Please provide details about prior claims';
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
      const response = await fetch('/api/intake/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit form');
      }

      router.push('/dashboard?success=true');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <PageHeader
        title="Commercial General Liability"
        subtitle="Complete this form to request a quote for commercial general liability insurance."
      />

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {sections.map((section, idx) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeSection === section.id
                ? 'bg-white shadow-sm border border-slate-200'
                : 'hover:bg-white/50'
            }`}
            style={{ 
              color: activeSection === section.id ? 'var(--brand-primary)' : 'var(--brand-text-muted)'
            }}
          >
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{
              backgroundColor: activeSection === section.id ? 'var(--brand-primary)' : 'rgba(11, 60, 93, 0.1)',
              color: activeSection === section.id ? 'white' : 'var(--brand-primary)'
            }}>
              {idx + 1}
            </span>
            {section.label}
          </button>
        ))}
      </div>

      {submitError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl" data-testid="alert-error">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6" data-testid="form-intake">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
              <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>Business Information</h3>
          </div>
          <div className="space-y-5">
            <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-slate-700 mb-2">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="companyName"
                name="companyName"
                value={formData.companyName}
                onChange={handleChange}
                className={`w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] ${errors.companyName ? 'border-red-500' : 'border-slate-200'}`}
                placeholder="Enter company name"
                data-testid="input-company-name"
              />
              {errors.companyName && <p className="text-sm text-red-600 mt-1" data-testid="error-company-name">{errors.companyName}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="industry" className="block text-sm font-medium text-slate-700 mb-2">
                  Industry <span className="text-red-500">*</span>
                </label>
                <select
                  id="industry"
                  name="industry"
                  value={formData.industry}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] ${errors.industry ? 'border-red-500' : 'border-slate-200'}`}
                  data-testid="select-industry"
                >
                  {industries.map(ind => (
                    <option key={ind.value} value={ind.value}>{ind.label}</option>
                  ))}
                </select>
                {errors.industry && <p className="text-sm text-red-600 mt-1">{errors.industry}</p>}
              </div>

              <div>
                <label htmlFor="yearsInBusiness" className="block text-sm font-medium text-slate-700 mb-2">
                  Years in Business
                </label>
                <input
                  type="number"
                  id="yearsInBusiness"
                  name="yearsInBusiness"
                  value={formData.yearsInBusiness}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  placeholder="e.g., 5"
                  min="0"
                  data-testid="input-years-in-business"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="annualRevenue" className="block text-sm font-medium text-slate-700 mb-2">
                  Annual Revenue
                </label>
                <input
                  type="text"
                  id="annualRevenue"
                  name="annualRevenue"
                  value={formData.annualRevenue}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  placeholder="e.g., $1,000,000"
                  data-testid="input-annual-revenue"
                />
              </div>

              <div>
                <label htmlFor="numberOfEmployees" className="block text-sm font-medium text-slate-700 mb-2">
                  Number of Employees
                </label>
                <input
                  type="number"
                  id="numberOfEmployees"
                  name="numberOfEmployees"
                  value={formData.numberOfEmployees}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  placeholder="e.g., 25"
                  min="1"
                  data-testid="input-employees"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(22, 179, 174, 0.1)' }}>
              <svg className="w-5 h-5" style={{ color: 'var(--brand-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>Coverage Details</h3>
          </div>
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="requestedLimits" className="block text-sm font-medium text-slate-700 mb-2">
                  Requested Limits
                </label>
                <select
                  id="requestedLimits"
                  name="requestedLimits"
                  value={formData.requestedLimits}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="select-limits"
                >
                  {limitOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs mt-2 text-slate-500">Per occurrence / Aggregate</p>
              </div>

              <div>
                <label htmlFor="effectiveDate" className="block text-sm font-medium text-slate-700 mb-2">
                  Desired Effective Date
                </label>
                <input
                  type="date"
                  id="effectiveDate"
                  name="effectiveDate"
                  value={formData.effectiveDate}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  data-testid="input-effective-date"
                />
              </div>
            </div>

            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--brand-background)' }}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="priorClaims"
                  name="priorClaims"
                  checked={formData.priorClaims}
                  onChange={handleChange}
                  className="h-5 w-5 rounded border-slate-300 text-[#00E6A7] focus:ring-[#00E6A7]"
                  data-testid="checkbox-prior-claims"
                />
                <label htmlFor="priorClaims" className="text-sm font-medium text-slate-900">
                  Business has prior claims in the last 5 years
                </label>
              </div>
            </div>

            {formData.priorClaims && (
              <div>
                <label htmlFor="priorClaimsDetails" className="block text-sm font-medium text-slate-700 mb-2">
                  Prior Claims Details <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="priorClaimsDetails"
                  name="priorClaimsDetails"
                  value={formData.priorClaimsDetails}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] min-h-24 ${errors.priorClaimsDetails ? 'border-red-500' : 'border-slate-200'}`}
                  placeholder="Please describe the nature and outcome of prior claims..."
                  data-testid="textarea-prior-claims-details"
                />
                {errors.priorClaimsDetails && <p className="text-sm text-red-600 mt-1">{errors.priorClaimsDetails}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
              <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>Contact Information</h3>
          </div>
          <div className="space-y-5">
            <div>
              <label htmlFor="contactName" className="block text-sm font-medium text-slate-700 mb-2">
                Contact Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="contactName"
                name="contactName"
                value={formData.contactName}
                onChange={handleChange}
                className={`w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] ${errors.contactName ? 'border-red-500' : 'border-slate-200'}`}
                placeholder="Full name"
                data-testid="input-contact-name"
              />
              {errors.contactName && <p className="text-sm text-red-600 mt-1">{errors.contactName}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="contactEmail" className="block text-sm font-medium text-slate-700 mb-2">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="contactEmail"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] ${errors.contactEmail ? 'border-red-500' : 'border-slate-200'}`}
                  placeholder="email@company.com"
                  data-testid="input-contact-email"
                />
                {errors.contactEmail && <p className="text-sm text-red-600 mt-1">{errors.contactEmail}</p>}
              </div>

              <div>
                <label htmlFor="contactPhone" className="block text-sm font-medium text-slate-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  id="contactPhone"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7]"
                  placeholder="(555) 123-4567"
                  data-testid="input-contact-phone"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(11, 60, 93, 0.05)' }}>
              <svg className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--brand-primary)' }}>Additional Information</h3>
          </div>
          <div>
            <label htmlFor="additionalNotes" className="block text-sm font-medium text-slate-700 mb-2">
              Special Requests or Notes
            </label>
            <textarea
              id="additionalNotes"
              name="additionalNotes"
              value={formData.additionalNotes}
              onChange={handleChange}
              className="w-full px-4 py-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00E6A7] min-h-24"
              placeholder="Any additional information you'd like to provide..."
              data-testid="textarea-additional-notes"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4">
          <Button
            variant="secondary"
            onClick={() => router.push('/dashboard')}
            testId="button-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={isSubmitting}
            testId="button-submit"
          >
            Submit Application
          </Button>
        </div>
      </form>
    </AppLayout>
  );
}
