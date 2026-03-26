"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from 'next/link';
import homeBanner from '@/attached_assets/what-to-expect.webp';
import React from 'react';
import { Check } from "lucide-react";

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

const items = [
  "Access to the platform as features become available",
  "Opportunities to share feedback with the Insurigence team",
  "Ongoing product updates and improvements",
  "Communication about new features and future capabilities",
];

const WhatToExpect = () => {
  return (
    <section
      className="w-full relative overflow-hidden flex flex-col justify-center"
      style={{
        backgroundImage: `linear-gradient(rgba(5,49,76,0.6), rgba(5,49,76,0.6)), url(${homeBanner.src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="cs_height_60 cs_height_lg_80"></div>

      <div className="container">
        {/* Heading */}
        <div className="text-center max-w-2xl mx-auto px-6">
          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-2xl sm:text-3xl md:text-4xl font-semibold text-white mb-3"
          >
            What to Expect
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="sm:text-base md:text-lg text-white/80"
          >
            Early access will roll out in phases as we prepare for broader
            availability. Participants can expect:
          </motion.p>
        </div>

        {/* Cards */}
        <div className="mt-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((item, index) => (
              <motion.div
                key={index}
                transition={{ delay: index * 0.2 }}
                className="flex items-start gap-2 p-4 rounded-xl 
              bg-white/10 border border-white/20
              text-white shadow-lg hover:scale-[1.02] transition"
              >
                {/* Icon */}
                <div className="text-white rounded-md p-1 mt-1" style={{ background: "#00e6a7" }}>
                  <Check size={18} />
                </div>

                {/* Text */}
                <p className="md:text-base leading-relaxed">
                  {item}
                </p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="text-center max-w-4xl mx-auto mt-6 px-6">

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="sm:text-base md:text-lg text-white/80"
          >
            Our goal is to build the platform in close collaboration with the teams who will ultimately use it.
          </motion.p>
        </div>

        {/* Button */}
        <div className="mt-10 flex justify-center">
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="hover:bg-green-500 text-white px-6 py-2 rounded-md shadow-md transition"
            style={{ background: "#00e6a7" }}
          >
            Request Access
          </motion.button>
        </div>
      </div>
      <div className="cs_height_60 cs_height_lg_80"></div>
    </section>
  );
};

export default WhatToExpect;
