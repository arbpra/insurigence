'use client';

import { useState } from 'react';
import Link from 'next/link';

interface PlanFeature {
  text: string;
  included: boolean;
}

interface Plan {
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  features: PlanFeature[];
  isPopular?: boolean;
}

const plans: Plan[] = [
  {
    name: 'Solo',
    description: 'Core placement intelligence for small teams',
    monthlyPrice: 199,
    annualPrice: 1999,
    features: [
      { text: 'Structured intake + lead dashboard', included: true },
      { text: 'Market classification: Standard vs E&S vs Borderline', included: true },
      { text: 'Carrier recommendations with exclusions + reasons', included: true },
      { text: 'Coverage guidance and explainable summaries', included: true },
      { text: 'Client-ready proposal builder (multi-option)', included: true },
    ],
  },
  {
    name: 'Growth',
    description: 'Everything in Solo, plus team features',
    monthlyPrice: 299,
    annualPrice: 2999,
    isPopular: true,
    features: [
      { text: 'Everything in Solo, plus:', included: true },
      { text: 'Agency templates for intake + proposals', included: true },
      { text: 'Team workflow: assignments and activity tracking', included: true },
      { text: 'Priority rule tuning support (appetite engine)', included: true },
      { text: 'Enhanced proposal sections: The Answer / The Why / The Options', included: true },
    ],
  },
  {
    name: 'Multi-Location',
    description: 'Everything in Growth, plus enterprise controls',
    monthlyPrice: 499,
    annualPrice: 4999,
    features: [
      { text: 'Everything in Growth, plus:', included: true },
      { text: 'Multi-location agency controls', included: true },
      { text: 'Advanced admin controls + permissions', included: true },
      { text: 'Centralized carrier + appetite management across offices', included: true },
      { text: 'Analytics and adoption insights', included: true },
    ],
  },
];

export default function PricingTable() {
  const [isAnnual, setIsAnnual] = useState(false);

  return (
    <div className="w-full">
      {/* Toggle */}
      <div className="flex flex-col items-center mb-12">
        <div className="inline-flex items-center p-1 rounded-xl bg-white border border-slate-200 shadow-sm">
          <button
            onClick={() => setIsAnnual(false)}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              !isAnnual
                ? 'text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            style={{ backgroundColor: !isAnnual ? '#0D2137' : 'transparent' }}
            data-testid="toggle-monthly"
          >
            Monthly
          </button>
          <button
            onClick={() => setIsAnnual(true)}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 flex items-center gap-2 ${
              isAnnual
                ? 'text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            style={{ backgroundColor: isAnnual ? '#0D2137' : 'transparent' }}
            data-testid="toggle-annual"
          >
            Annual
            <span
              className="px-2 py-0.5 text-xs font-semibold rounded-full"
              style={{ backgroundColor: '#00E6A7', color: 'white' }}
            >
              16% Savings
            </span>
          </button>
        </div>
        <p className="text-sm mt-4" style={{ color: '#64748B' }}>
          Monthly or annual. Pick what fits your agency.
        </p>
      </div>

      {/* Plan Cards */}
      <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-2xl bg-white border p-8 transition-all duration-200 hover:shadow-lg ${
              plan.isPopular ? 'border-2 shadow-md' : 'border-slate-200'
            }`}
            style={{ borderColor: plan.isPopular ? '#00E6A7' : undefined }}
            data-testid={`plan-card-${plan.name.toLowerCase()}`}
          >
            {plan.isPopular && (
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-semibold rounded-full text-white"
                style={{ backgroundColor: '#00E6A7' }}
              >
                Most popular
              </div>
            )}

            <div className="text-center mb-6">
              <h3 className="text-xl font-bold mb-2" style={{ color: '#0D2137' }}>
                {plan.name}
              </h3>
              <p className="text-sm" style={{ color: '#64748B' }}>
                {plan.description}
              </p>
            </div>

            <div className="text-center mb-8">
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold" style={{ color: '#0D2137' }}>
                  ${isAnnual ? plan.annualPrice.toLocaleString() : plan.monthlyPrice}
                </span>
                <span className="text-base" style={{ color: '#64748B' }}>
                  /{isAnnual ? 'year' : 'month'}
                </span>
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              {plan.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: '#00E6A7' }}
                  >
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <span className="text-sm" style={{ color: '#64748B' }}>
                    {feature.text}
                  </span>
                </li>
              ))}
            </ul>

            <a
              href="https://meetings-na2.hubspot.com/logan-kutz"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
              style={{
                backgroundColor: plan.isPopular ? '#00E6A7' : '#0D2137',
                color: 'white',
              }}
              data-testid={`cta-${plan.name.toLowerCase()}`}
            >
              Request a Demo
            </a>
          </div>
        ))}
      </div>

      {/* Add-ons Strip */}
      <div className="max-w-2xl mx-auto mt-12">
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <h4 className="text-lg font-bold mb-2" style={{ color: '#0D2137' }}>
            Proposals Only
          </h4>
          <p className="text-sm mb-4" style={{ color: '#64748B' }}>
            Just want agency-branded proposals without placement intelligence?
          </p>
          <div className="flex items-baseline justify-center gap-1 mb-6">
            <span className="text-3xl font-bold" style={{ color: '#0D2137' }}>
              $29
            </span>
            <span className="text-base" style={{ color: '#64748B' }}>
              /month
            </span>
          </div>
          <a
            href="https://meetings-na2.hubspot.com/logan-kutz"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold rounded-xl transition-all duration-200 hover:opacity-90 border-2"
            style={{ borderColor: '#0D2137', color: '#0D2137' }}
            data-testid="cta-proposals-only"
          >
            Request a Demo
          </a>
        </div>
      </div>
    </div>
  );
}
