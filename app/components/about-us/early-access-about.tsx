"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from 'next/link';
import EarlyAccessImage from '@/attached_assets/early-access-about.webp';
import LogoMarker from '@/attached_assets/logo-marker-right.webp';
import ProblemImage from '@/attached_assets/why-early-join.webp';
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
              <Image src={EarlyAccessImage} alt="img" className="w-full h-auto rounded-lg" />
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
                  Joining the Community
                </motion.h2>

                <motion.p variants={fadeUp} className="cs_section_heading_text mb-2">
                  Insurigence is preparing for its initial launch, and we're inviting a limited number of agencies and commercial insurance teams to join our early access group. Early participants will be among the first to explore the platform and help shape its development as we move toward full release.
                </motion.p>

                <motion.p variants={fadeUp} className="cs_section_heading_text mb-4">
                  By joining early access, your team will gain insight into upcoming capabilities and have the opportunity to provide feedback that influences how the platform evolves.
                </motion.p>

                <motion.a
                  variants={fadeUp}
                  href="/talk-to-insurigence"
                  className="inline-flex items-center gap-2 px-8 py-2 text-base font-medium rounded-md transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2"
                  style={{ borderColor: '#00e6a7', color: '#05314C', backgroundColor: '#00e6a7' }}
                >
                  Request Early Access
                </motion.a>

              </motion.div>
            </div>
          </div>

        </div>
      </div>

      <span className="cs_wheel_shape absolute right-0 top-2/5 -translate-y-1/2">
        <Image src={LogoMarker} alt="img" width={121} height={116} />
      </span>

      <div className="cs_height_60 cs_height_lg_80"></div>

      {/* SECOND SECTION */}
      <div className="container">

        <div className="cs_height_60 cs_height_lg_80"></div>
        
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
                  Why Join Early
                </motion.h2>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4"
                >
                  Agencies participating in early access will be able to explore how Insurigence supports the commercial placement process while contributing feedback that helps refine the platform. Early access participants will have the opportunity to:
                </motion.p>

                <motion.ul
                  variants={fadeUp}
                  className="blue-num-ullist list-decimal pl-5 space-y-2 sm:text-base text-gray-700"
                >
                  <li>Experience the platform before public launch</li>
                  <li>Provide feedback that helps shape product development</li>
                  <li>Explore tools designed to improve commercial submission workflows</li>
                  <li>Stay informed as new capabilities are introduced</li>
                </motion.ul>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-4"
                >
                  This stage is focused on learning from real agency workflows and ensuring the platform supports how commercial teams actually operate.
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

      <div className="h-10 sm:h-10 lg:h-40"></div>
    </section>
  );
};

export default AboutUs;
