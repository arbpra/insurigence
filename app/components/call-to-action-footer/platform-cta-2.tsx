"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from "framer-motion";
import homeBanner from '@/attached_assets/platform-2.webp';
import Image from 'next/image';
import LogoMarker from '@/attached_assets/logo-marker.webp';


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
      <div className="cs_height_40 cs_height_lg_80"></div>
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
                    Be One Of The
                  </span>{" "}
                  <span className="text-[#00e6a7]">
                    First Agents
                  </span>{" "}
                  <span className="text-white">
                    On The Platform
                  </span>
                </motion.h1>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4 text-white"
                >
                  We're onboarding a small group of commercial agents before public launch. If you're working with contractors, restaurants, or technology businesses - we'd love to show you what we've built so far.
                </motion.p>

                

                <motion.a
                  href="https://meetings-na2.hubspot.com/logan-kutz"
                  whileHover={{ y: -5, scale: 1.05 }}
                  transition={{ duration: 0.3 }}
                  className="inline-flex mb-3 items-center gap-2 px-8 py-2 text-base font-medium rounded-md border-2"
                  style={{
                    borderColor: "#fff",
                    color: "#0D2137",
                    backgroundColor: "#fff"
                  }}
                >
                  Request A Demo
                </motion.a>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4 text-white"
                >
                  No commitment. No credit card. Just a conversation.

                </motion.p>


              </motion.div>
            </div>
          </div>



        </div>
        <span className="cs_wheel_shape absolute left-0 bottom-2/5 -translate-y-1/2" style={{ marginTop: '-44px' }}>
          <Image src={LogoMarker} alt="img" width={150} height={120} />
        </span>
      </div>
      

      <div className="cs_height_40 cs_height_lg_40"></div>
      
    </section>
  );
};

export default EarlyAccessCTA2;