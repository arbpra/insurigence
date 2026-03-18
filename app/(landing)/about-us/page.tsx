"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from 'next/link';
import AboutUsImage from '@/attached_assets/about-us.webp';
import ProblemImage from '@/attached_assets/problem.webp';
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


const AboutUs = () => {
  return (
    <section className="cs_about cs_style_1 cs_type_1 position-relative">

      <div className="cs_height_60 cs_height_lg_80"></div>

      <div className="container">
        <div className="row cs_gap_y_40 align-items-center">

          {/* LEFT IMAGE */}
          <div className="col-lg-5">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={fadeLeft}
              transition={{ duration: 0.6 }}
            >
              <Image src={AboutUsImage} alt="img" className="w-full h-auto rounded-lg" />
            </motion.div>
          </div>

          {/* RIGHT CONTENT */}
          <div className="col-lg-7">
            <div className="cs_about_content">

              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: false, amount: 0.2 }}
                transition={{ staggerChildren: 0.2 }}
              >

                <motion.h2
                  variants={fadeUp}
                  className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight mb-4"
                >
                  Your Commercial Command Center Solution
                </motion.h2>

                <motion.p variants={fadeUp} className="cs_section_heading_text mb-2">
                  Insurigence brings together structured intake, coverage intelligence, proposal automation, and workflow management into one platform built specifically for independent agencies.
                </motion.p>

                <motion.p variants={fadeUp} className="cs_section_heading_text mb-4">
                  Instead of juggling spreadsheets, forms, and manual processes, producers gain a centralized system designed to help them move commercial opportunities forward with greater confidence and efficiency.
                </motion.p>

                <motion.a
                  variants={fadeUp}
                  href="#contact"
                  className="inline-flex items-center gap-2 px-8 py-2 text-base font-medium rounded-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2"
                  style={{ borderColor: '#00e6a7', color: '#05314C', backgroundColor: '#00e6a7' }}
                >
                  Learn More
                </motion.a>

              </motion.div>
            </div>
          </div>

        </div>
      </div>

      <div className="cs_height_60 cs_height_lg_80"></div>

      {/* SECOND SECTION */}
      <div className="container">
        <div className="row cs_gap_y_40 align-items-center">

          {/* LEFT CONTENT */}
          <div className="col-lg-7">
            <div className="cs_about_content">

              <motion.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: false, amount: 0.2 }}
                transition={{ staggerChildren: 0.2 }}
              >

                <motion.h2
                  variants={fadeUp}
                  className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight mb-4"
                >
                  What People Struggle With
                </motion.h2>

                <motion.p
                  variants={fadeUp}
                  className="text-sm sm:text-base md:text-lg text-gray-600 leading-relaxed mb-4"
                >
                  Independent producers spend too much time navigating inefficient workflows.
                </motion.p>

                <motion.ol
                  variants={fadeUp}
                  className="blue-num-list list-decimal pl-5 space-y-2 text-sm sm:text-base text-gray-700"
                >
                  <li>Incomplete submissions slow down quoting.</li>
                  <li>Class codes require guesswork.</li>
                  <li>Coverage gaps are easy to miss.</li>
                  <li>Proposals are difficult for clients to understand.</li>
                  <li>And valuable opportunities often get lost in the process.</li>
                </motion.ol>

                <motion.p
                  variants={fadeUp}
                  className="text-sm sm:text-base md:text-lg text-gray-600 leading-relaxed mt-4"
                >
                  Commercial insurance shouldn’t require this much friction. Insurigence is designed to simplify the entire workflow — from intake to proposal.
                </motion.p>

              </motion.div>
            </div>
          </div>

          {/* RIGHT IMAGE */}
          <div className="col-lg-5">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={fadeRight}
              transition={{ duration: 0.6 }}
            >
              <Image src={ProblemImage} alt="img" className="w-full h-auto rounded-lg" />
            </motion.div>
          </div>

        </div>
      </div>

    </section>
  );
};

export default AboutUs;
