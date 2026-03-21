"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from "framer-motion";
import Image from 'next/image';
import CTAImage from '@/attached_assets/cta-2.webp';


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

const WhoIsItForCTA = () => {

  return (
    <section className="w-full relative overflow-hidden" style={{ background: "#00e6a7" }}>
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
              <Image src={CTAImage} alt="img" className="w-full h-auto rounded-lg" />
            </motion.div>
          </div>

          {/* RIGHT CONTENT */}
          <div className="col-lg-6">
            <div className="cs_about_content">

              <motion.div
                className="relative max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: false, amount: 0.4 }}
                variants={container}
              >

                <motion.h1
                  variants={fadeUp}
                  className="text-3xl sm:text-3xl md:text-4xl lg:text-5xl font-normal tracking-tight leading-tight mb-6"
                  style={{
                    fontFamily: "Helvetica",
                    letterSpacing: "-0.03em",
                  }}
                >
                  <span className="text-white">
                    See How
                  </span>{" "}
                  <span className="text-[#07496c]">
                    Insurigence
                  </span>{" "}
                  <span className="text-white">
                    Can
                  </span>{" "}
                  <span className="text-[#07496c]">
                    Support Your Team
                  </span>
                </motion.h1>

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
      </div>   
      <div className="cs_height_60 cs_height_lg_80"></div>   

    </section>
  );
};

export default WhoIsItForCTA;