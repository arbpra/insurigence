"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from "framer-motion";
import homeBanner from '@/attached_assets/talk-to-insurigence-cta.webp';
import Image from 'next/image';
import CTAImage from '@/attached_assets/map.webp';


const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.25
    }
  }
};

const fadeUp = {
  hidden: { opacity: 0, y: 60 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1,
      ease: [0.25, 1, 0.5, 1]
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

const EarlyAccessCTA = () => {
  const [form, setForm] = useState({ fullName: '', email: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.fullName.trim() || !form.email.trim() || !form.message.trim()) {
      setError('Please fill in your name, email, and message.');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.fullName, email: form.email, message: form.message }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not send your message. Please try again.');
        setStatus('idle');
        return;
      }
      setStatus('sent');
      setForm({ fullName: '', email: '', message: '' });
    } catch {
      setError('Network error. Please try again.');
      setStatus('idle');
    }
  };

  return (
    <section
      className="w-full relative overflow-hidden flex items-end sm:items-center min-h-[450px] sm:min-h-[450px] lg:min-h-[500px]"
      style={{
        backgroundImage: `linear-gradient(rgba(5,49,76,0.8), rgba(5,49,76,0.8)), url(${homeBanner.src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      

      <div className="container">
        <div className="cs_height_60 cs_height_lg_80"></div>
        <div className="row cs_gap_y_40 align-items-center">

          {/* LEFT IMAGE */}
          <div className="col-lg-6">
            <div className="cs_about_content">

              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: false, amount: 0.2 }}
                transition={{ staggerChildren: 0.2 }}
              >

                <motion.h2
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6 }}
                  className="text-3xl sm:text-3xl md:text-4xl font-medium text-white mb-4"
                >
                  Let's Start the Conversation
                </motion.h2>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4 text-white"
                >
                  If you're interested in learning more or exploring early access, we'd be glad to hear from you. When you reach out, you'll be connecting directly with the Insurigence team involved in building and refining the platform.
                </motion.p>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4 text-white"
                >
                  ill out the form, and a member of our team will follow up with you. You can also reach out to us directly via email for any inquiries. <br></br>
                </motion.p>

                <motion.a
                  href="mailto:contact@insurigence.ai"
                  whileHover={{ y: -5, scale: 1.05 }}
                  transition={{ duration: 0.3 }}
                  className='sm:text-base md:text-lg text-white leading-relaxed mb-4'

                >
                  contact@insurigence.ai
                </motion.a>

              </motion.div>
            </div>
          </div>

          {/* RIGHT CONTENT */}


          <div className="col-lg-6">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={fadeLeft}
              transition={{ duration: 0.6 }}
            >

              {status === 'sent' ? (
                <div className="rounded-2xl bg-white/95 p-8 text-center" data-testid="contact-success">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#DCFCE7' }}>
                    <svg className="w-7 h-7" style={{ color: '#16A34A' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold mb-2" style={{ color: '#07496c' }}>Message sent!</h3>
                  <p className="text-sm text-slate-500 mb-4">
                    Thanks for reaching out — a confirmation has been sent to your email, and our team will follow up shortly.
                  </p>
                  <button onClick={() => setStatus('idle')} className="text-sm font-medium" style={{ color: '#00B383' }}>
                    Send another message
                  </button>
                </div>
              ) : (
                <form className="rounded-2xl pt-5" data-testid="contact-form" onSubmit={handleSubmit}>
                  <div className="space-y-5">

                    {error && (
                      <div className="rounded-md px-4 py-2 text-sm" style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}>
                        {error}
                      </div>
                    )}

                    <div>
                      <input
                        type="text"
                        name="fullName"
                        value={form.fullName}
                        onChange={set('fullName')}
                        className="w-full px-4 py-2 rounded-md border border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2"
                        placeholder="John"
                        data-testid="input-fullName"
                      />
                    </div>

                    <div>
                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={set('email')}
                        className="w-full px-4 py-2 rounded-md border border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2"
                        placeholder="john@company.com"
                        data-testid="input-email"
                      />
                    </div>

                    <div>
                      <textarea
                        name="message"
                        rows={4}
                        value={form.message}
                        onChange={set('message')}
                        className="w-full px-4 py-2 rounded-md border border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2"
                        placeholder="Tell us about your needs..."
                        data-testid="textarea-message"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={status === 'sending'}
                      className="py-2 px-4 rounded-md font-semibold transition-all duration-200 hover:opacity-90 disabled:opacity-60"
                      style={{ backgroundColor: '#00E6A7', color: '#07496c' }}
                      data-testid="button-submit-contact"
                    >
                      {status === 'sending' ? 'SENDING…' : 'SUBMIT'}
                    </button>
                  </div>
                </form>
              )}

            </motion.div>
          </div>

        </div>
        <div className="cs_height_60 cs_height_lg_80"></div>
      </div>
      

    </section>
  );
};

export default EarlyAccessCTA;