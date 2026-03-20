"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from 'next/link';
import LogoMarker from '@/attached_assets/logo-marker-right.webp';
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


const WhoIsItForAbout = () => {
  return (
    <section className="cs_about cs_style_1 cs_type_1 position-relative">
      <span className="cs_wheel_shape absolute right-0 top-1/2 -translate-y-1/2">
        <Image src={LogoMarker} alt="img" width={121} height={116} />
      </span>

      <div className="cs_height_60 cs_height_lg_80"></div>

      <div className="container">
        <div className="row cs_gap_y_40 align-items-center">

          {/* RIGHT CONTENT */}
          <div className="col-lg-12">
            <div className="cs_about_content">

              <motion.div
                className="cs_section_heading cs_style_1 text-center max-w-3xl mx-auto"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: false, amount: 0.2 }}
                transition={{ staggerChildren: 0.2 }}
              >
                <motion.p variants={fadeUp} className="text-sm sm:text-base md:text-lg text-gray-600 leading-relaxed mb-2">
                  Insurigence is designed for commercial insurance teams that want clearer placement decisions, fewer declinations, and less reliance on informal or inconsistent processes. The platform helps agencies and underwriting teams evaluate risks more confidently and bring greater consistency to the commercial placement workflow.
                </motion.p>

              </motion.div>

            </div>
          </div>
        </div>
      </div>

      <div className="cs_height_60 cs_height_lg_80"></div>
      
    </section>
  );
};

export default WhoIsItForAbout;
