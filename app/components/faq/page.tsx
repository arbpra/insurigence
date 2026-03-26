"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from 'next/link';
import EarlyAccessImage from '@/attached_assets/early-access-about.webp';
import LogoMarker from '@/attached_assets/logo-marker-right.webp';
import ProblemImage from '@/attached_assets/why-early-join.webp';
import React from 'react';

const fadeUp = {
  hidden: { opacity: 0, y: 50 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1,
      ease: "easeOut"
    }
  }
};

const fadeLeft = {
  hidden: { opacity: 0, x: -60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 1,
      ease: "easeOut"
    }
  }
};

const fadeRight = {
  hidden: { opacity: 0, x: 60 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 1,
      ease: "easeOut"
    }
  }
};


const FAQ = () => {
  return (
      <section className="w-full py-16" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="max-w-4xl mx-auto px-6 space-y-8">
          
          {/* Question 1 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              What does Insurigence do?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence is commercial insurance appetite and placement intelligence software.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              It helps agencies evaluate risk, determine standard versus E&S market direction, identify realistic carrier profiles, and communicate placement decisions clearly before submission.
            </p>
          </div>

          {/* Question 2 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Does Insurigence quote insurance?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              No.
            </p>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence does not quote pricing, provide bindable terms, or replace carrier underwriting.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              All pricing, underwriting, and binding decisions remain with carriers and licensed insurance professionals.
            </p>
          </div>

          {/* Question 3 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Is Insurigence an AMS or CRM?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              No.
            </p>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence is not an agency management system or CRM, and it is not designed to replace either.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              It complements existing systems by sitting between intake and carrier quoting.
            </p>
          </div>

          {/* Question 4 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Who is Insurigence built for?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence is built for:
            </p>
            <ul className="space-y-2">
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Independent commercial insurance agencies</span>
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Wholesale brokers and MGAs</span>
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Program administrators</span>
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: '#00E6A7' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-lg" style={{ color: '#0D2137' }}>Growing teams that need consistent placement guidance</span>
              </li>
            </ul>
          </div>

          {/* Question 5 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How does Insurigence help reduce declinations?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Insurigence helps teams evaluate risk earlier, identify misalignment before submission, and focus on markets that are more realistic for the risk profile.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              This reduces wasted submissions and improves overall placement efficiency.
            </p>
          </div>

          {/* Question 6 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Does Insurigence replace professional judgment?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              No.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Insurigence supports licensed professionals by providing structure and insight. Final decisions always remain with the agency and carrier.
            </p>
          </div>

          {/* Question 7 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Is Insurigence compliant with insurance regulations?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              Yes.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Insurigence is designed as decision support software. It does not perform regulated activities such as quoting, underwriting authority, or binding coverage.
            </p>
          </div>

          {/* Question 8 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How long does implementation take?
            </h2>
            <p className="text-lg leading-relaxed mb-4" style={{ color: '#64748B' }}>
              Most agencies can begin using Insurigence quickly, with minimal disruption to existing workflows.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Exact timelines depend on agency size and configuration.
            </p>
          </div>

          {/* Question 9 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              Can Insurigence be customized?
            </h2>
            <p className="text-lg leading-relaxed mb-4 font-medium" style={{ color: '#0D2137' }}>
              Yes.
            </p>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              Insurigence is designed to adapt to different agency workflows, risk types, and internal processes.
            </p>
          </div>

          {/* Question 10 */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200/60">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: '#0D2137' }}>
              How do we get started?
            </h2>
            <p className="text-lg leading-relaxed" style={{ color: '#64748B' }}>
              The best way to get started is to request a demo.
            </p>
          </div>
        </div>
      </section>
  );
};

export default FAQ;
