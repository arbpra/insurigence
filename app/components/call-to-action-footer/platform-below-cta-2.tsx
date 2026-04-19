"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from "framer-motion";
import Image from 'next/image';

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

const CallToActionFooter = () => {

  return (
    <section className="w-full relative overflow-hidden" style={{ background: "#00e6a7" }}>

      {/* Background Pattern */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #0D2137 1px, transparent 0)`,
          backgroundSize: "24px 24px"
        }}
      ></div>

      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-[#0D2137]/10"></div>

      {/* Floating Blobs (Animated) */}
      <motion.div
        animate={{ y: [0, -20, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-20 left-10 w-72 h-72 bg-white/20 rounded-full blur-3xl"
      />

      <motion.div
        animate={{ y: [0, 20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-10 right-10 w-96 h-96 bg-[#0D2137]/10 rounded-full blur-3xl"
      />

      {/* Content */}
      <motion.div
        className="relative max-w-5xl mx-auto px-6 py-24 md:py-24 text-center"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        variants={container}
      >

        <motion.h1
          variants={fadeUp}
          className="text-3xl sm:text-4xl md:text-5xl lg:text-4xl font-normal tracking-tight mb-6 leading-tight text-center [letter-spacing:-0.03em] font-[Helvetica]"
        >
          Have Some Questions?
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10 text-center font-normal"
          style={{ fontFamily: "Helvetica" }}
        >
          Reach us at <Link href="mailto:contact@insurigence.ai" className="text-blue-600 hover:!text-white transition-colors duration-200">contact@insurigence.ai</Link>
        </motion.p>

        

      </motion.div>

    </section>
  );
};

export default CallToActionFooter;