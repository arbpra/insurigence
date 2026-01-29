'use client';

import { useState } from 'react';

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: 'Do you replace our AMS?',
    answer: 'No, we complement it. Insurigence sits alongside your existing agency management system and enhances your placement workflow without replacing any of your core tools.',
  },
  {
    question: 'Do you quote or bind insurance?',
    answer: 'No, decision-support only. Insurigence provides placement intelligence to help licensed agents make better decisions. We never quote, bind, or make automated underwriting decisions.',
  },
  {
    question: 'Can multiple agents use it?',
    answer: 'Yes, role-based users per agency. Each agency can have multiple users with different permission levels including Super Admin, Admin, and Agent roles.',
  },
  {
    question: 'Can insureds fill out intake forms?',
    answer: 'Yes, via link or embedded form. You can send insureds a secure link to complete structured intake forms, or embed forms directly on your website.',
  },
  {
    question: 'Can we cancel anytime?',
    answer: 'Yes. There are no long-term contracts or lock-ins. You can cancel your subscription at any time.',
  },
];

export default function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="w-full max-w-3xl mx-auto">
      <h3 className="text-2xl md:text-3xl font-bold text-center mb-10" style={{ color: '#0D2137' }}>
        Frequently Asked Questions
      </h3>
      <div className="space-y-4">
        {faqItems.map((item, index) => (
          <div
            key={index}
            className="rounded-xl bg-white border border-slate-200 overflow-hidden transition-all duration-200"
          >
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full flex items-center justify-between p-5 text-left transition-colors hover:bg-slate-50"
              data-testid={`faq-question-${index}`}
            >
              <span className="text-base font-medium pr-4" style={{ color: '#0D2137' }}>
                {item.question}
              </span>
              <svg
                className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${
                  openIndex === index ? 'rotate-180' : ''
                }`}
                style={{ color: '#64748B' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {openIndex === index && (
              <div className="px-5 pb-5">
                <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                  {item.answer}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
