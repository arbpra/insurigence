"use client"
import React, { useEffect, useState } from 'react';
import homeBanner from '@/attached_assets/early-access.webp';
import Link from 'next/link';
import { motion } from "framer-motion";
import Image from 'next/image';

const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.3
    }
  }
};

const fadeUp = {
  hidden: { opacity: 0, y: 70 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1.1,
      ease: [0.25, 1, 0.5, 1]
    }
  }
};


const WhoIsItForBanner = () => {

  return (
    <section
      className="w-full relative overflow-hidden flex items-end sm:items-center min-h-[450px] sm:min-h-[450px] lg:min-h-[500px]"
      style={{
        backgroundImage: `linear-gradient(rgba(5,49,76,0.8), rgba(5,49,76,0.8)), url(${homeBanner.src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >

      {/* Pattern Overlay */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #0D2137 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}
      ></div>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-[#0D2137]/10"></div>

      {/* Animated Blur Shapes */}
      <motion.div
        animate={{ y: [0, -30, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-20 left-10 w-48 sm:w-72 h-48 sm:h-72 bg-white/20 rounded-full blur-3xl"
      />

      <motion.div
        animate={{ y: [0, 30, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-10 right-10 w-64 sm:w-96 h-64 sm:h-96 bg-[#0D2137]/10 rounded-full blur-3xl"
      />

      {/* Content */}
      <motion.div
        className="relative max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.4 }}
        variants={container}
      >

        {/* Heading */}
        <motion.h1
          variants={fadeUp}
          className="text-3xl sm:text-3xl md:text-4xl lg:text-6xl font-normal tracking-tight leading-tight pt-20 mb-6"
          style={{
            fontFamily: "Helvetica",
            letterSpacing: "-0.03em",
          }}
        >
          <span className="text-white">
            Insurance
          </span>
          <span className="text-[#00E6A7]">
            , Finally Done Right
          </span>
        </motion.h1>

        {/* Paragraph */}
        <motion.p
          variants={fadeUp}
          className="text-sm sm:text-base md:text-lg lg:text-xl max-w-3xl mx-auto leading-relaxed text-white/90"
          style={{ fontFamily: "Helvetica" }}
        >
          Insurigence is a new kind of commercial insurance platform - purpose-built for agents who want to move faster, quote smarter, and win more business.
        </motion.p>


        <motion.a
          href="https://meetings-na2.hubspot.com/logan-kutz"
          whileHover={{ y: -4, scale: 1.03 }}
          transition={{ duration: 0.3 }}
          className="inline-flex items-center gap-2 px-8 py-2 text-base font-medium rounded-md border-2"
          style={{
            borderColor: "#fff",
            color: "#0D2137",
            backgroundColor: "#fff",
            margin: "20px 0px",
          }}
        >
          Request A Demo
        </motion.a>


        {/* Paragraph */}
        <motion.p
          variants={fadeUp}
          className="text-sm sm:text-base md:text-lg lg:text-xl max-w-3xl mx-auto leading-relaxed text-white/90"
          style={{ fontFamily: "Helvetica" }}
        >
          No commitment. No credit card. Just a conversation.
        </motion.p>


      </motion.div>


    </section>
  );
};

export default WhoIsItForBanner;