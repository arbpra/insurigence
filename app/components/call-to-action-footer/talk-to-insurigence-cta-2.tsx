"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from "framer-motion";
import homeBanner from '@/attached_assets/talk-to-insurigence-cta-2.webp';
import Image from 'next/image';
import LogoMarker from '@/attached_assets/logo-marker-right-2.webp';


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

const EarlyAccessCTA2 = () => {

  return (
    <section className="w-full relative overflow-hidden" style={{ background: "#07496c" }}>
      <div className="cs_height_60 cs_height_lg_80"></div>
      <div className="container">
        <div className="row cs_gap_y_40 align-items-center">

          {/* LEFT IMAGE */}
          <div className="col-lg-6">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={fadeLeft}
              transition={{ duration: 0.6 }}
            >
              <Image src={homeBanner} alt="img" className="w-full h-auto rounded-lg" />
            </motion.div>
          </div>

          {/* RIGHT CONTENT */}
          <div className="col-lg-6">
            <div className="cs_about_content">

              <motion.div
                className="relative max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: false, amount: 0.4 }}
                variants={container}
              >

                <motion.h1
                  variants={fadeUp}
                  className="text-3xl sm:text-4xl md:text-5xl lg:text-4xl font-normal tracking-tight mb-6 leading-tight text-left [letter-spacing:-0.03em] font-[Helvetica]"
                  style={{
                    fontFamily: "Helvetica",
                    letterSpacing: "-0.03em",
                  }}
                >
                  <span className="text-white">
                    Building
                  </span>{" "}
                  <span className="text-[#00e6a7]">
                    Insurigence
                  </span>{" "}
                  <span className="text-white">
                    with
                  </span>{" "}
                  <span className="text-[#00e6a7]">
                    Industry Input
                  </span>
                </motion.h1>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4 text-white"
                >
                  We're working closely with commercial insurance professionals to shape the platform as it evolves.
                </motion.p>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4 text-white"
                >
                  If you're interested in contributing feedback or learning more, we encourage you to get in touch.

                </motion.p>

                <motion.a
                  href="https://meetings-na2.hubspot.com/logan-kutz"
                  whileHover={{ y: -5, scale: 1.05 }}
                  transition={{ duration: 0.3 }}
                  className="inline-flex items-center gap-2 px-8 py-2 text-base font-medium rounded-md border-2"
                  style={{
                    borderColor: "#fff",
                    color: "#0D2137",
                    backgroundColor: "#fff"
                  }}
                >
                  Request A Demo
                </motion.a>


              </motion.div>
            </div>
          </div>



        </div>
        <span className="cs_wheel_shape absolute left-0 bottom-2/5 -translate-y-1/2">
        <Image src={LogoMarker} alt="img" width={121} height={116} />
      </span>
      </div>
      

      <div className="cs_height_60 cs_height_lg_80"></div>
      
    </section>
  );
};

export default EarlyAccessCTA2;