"use client";
import { motion } from "framer-motion";
import React from "react";

const steps = [
  { label: "Intake Form", status: "Complete", state: "done" },
  { label: "Agent Dashboard", status: "Complete", state: "done" },
  { label: "Risk Engine", status: "In Progress", state: "active" },
  { label: "Quote Builder", status: "Coming Soon", state: "upcoming" },
  { label: "Proposal Generator", status: "Coming Soon", state: "upcoming" },
];

const circleVariants = {
  hidden: { scale: 0, opacity: 0 },
  visible: (i: number) => ({
    scale: 1,
    opacity: 1,
    transition: { delay: 0.4 + i * 0.2, duration: 0.5, type: "spring", stiffness: 200 },
  }),
};

const labelVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.6 + i * 0.2, duration: 0.4 },
  }),
};

const labelDesktopVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.7 + i * 0.2, duration: 0.4 },
  }),
};

const lineHorizontalVariants = {
  hidden: { scaleX: 0 },
  visible: {
    scaleX: 1,
    transition: { duration: 1.2, ease: "easeInOut", delay: 0.3 },
  },
};

const lineVerticalVariants = {
  hidden: { scaleY: 0 },
  visible: {
    scaleY: 1,
    transition: { duration: 1.2, ease: "easeInOut", delay: 0.3 },
  },
};

const circleStyle = (state: string) => ({
  width: 56,
  height: 56,
  flexShrink: 0,
  ...(state === "done"
    ? { backgroundColor: "#2ec4a9", border: "none" }
    : state === "active"
    ? { backgroundColor: "#f0f0f0", border: "3px solid #1a3a5c" }
    : { backgroundColor: "#f0f0f0", border: "2px solid #7dd9cc" }),
});

const PlatformAbout = () => {
  return (
    <section className="w-full py-14 md:py-20 px-4" style={{ backgroundColor: "#f0f0f0" }}>
      <div className="max-w-5xl mx-auto">

        {/* Heading */}
        <motion.h2
          initial={{ opacity: 0, y: -30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="text-center text-3xl sm:text-4xl md:text-5xl font-semibold mb-5"
          style={{ color: "#1a4a5a" }}
        >
          We&apos;re Moving Fast.
        </motion.h2>

        {/* Description */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
          className="text-center text-sm sm:text-base md:text-lg leading-relaxed mb-12 md:mb-16 max-w-3xl mx-auto"
          style={{ color: "#4a5568" }}
        >
          We started with the intake — the part agents dread most. That&apos;s done. The agent dashboard is
          built and running. Right now we&apos;re deep in the risk engine, the piece that actually thinks through a
          submission before you ever touch it. Quote builder and proposal generator are next. We&apos;re not
          building this in a boardroom — we&apos;re building it with agents, in the field, one problem at a time.
        </motion.p>

        {/* ── DESKTOP: horizontal timeline ── */}
        <div className="hidden md:block relative">
          {/* Horizontal connecting line */}
          <div
            className="absolute top-[28px] h-[2px] z-0"
            style={{ left: "10%", right: "10%", backgroundColor: "#cde8e2" }}
          >
            <motion.div
              className="h-full origin-left"
              style={{ backgroundColor: "#2ec4a9" }}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.3 }}
              variants={lineHorizontalVariants}
            />
          </div>

          <div className="flex items-start justify-between">
            {steps.map((step, i) => (
              <div key={step.label} className="relative z-10 flex flex-col items-center" style={{ flex: 1 }}>
                <motion.div
                  custom={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={circleVariants}
                  className="flex items-center justify-center rounded-full"
                  style={circleStyle(step.state)}
                >
                  {step.state === "done" && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </motion.div>

                <motion.div
                  custom={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={labelDesktopVariants}
                  className="text-center mt-4 px-1"
                >
                  <p className="text-sm md:text-base font-medium leading-tight" style={{ color: "#1a3a5c", marginBottom: '0px' }}>
                    {step.label}
                  </p>
                  <p className="text-xs md:text-sm mt-1" style={{ color: "#4a5568" }}>
                    ({step.status})
                  </p>
                </motion.div>
              </div>
            ))}
          </div>
        </div>

        {/* ── MOBILE: vertical timeline ── */}
        <div className="md:hidden relative">
          {/* Vertical connecting line */}
          <div
            className="absolute left-[27px] w-[2px] z-0"
            style={{ top: 28, bottom: 28, backgroundColor: "#cde8e2" }}
          >
            <motion.div
              className="w-full origin-top"
              style={{ height: "100%", backgroundColor: "#2ec4a9" }}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              variants={lineVerticalVariants}
            />
          </div>

          <div className="flex flex-col gap-8">
            {steps.map((step, i) => (
              <div key={step.label} className="relative z-10 flex items-center gap-5">
                {/* Circle */}
                <motion.div
                  custom={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={circleVariants}
                  className="flex items-center justify-center rounded-full"
                  style={circleStyle(step.state)}
                >
                  {step.state === "done" && (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </motion.div>

                {/* Label */}
                <motion.div
                  custom={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={labelVariants}
                >
                  <p className="text-base font-medium leading-tight" style={{ color: "#1a3a5c" }}>
                    {step.label}
                  </p>
                  <p className="text-sm mt-0.5" style={{ color: "#4a5568" }}>
                    ({step.status})
                  </p>
                </motion.div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
};

export default PlatformAbout;
