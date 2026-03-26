"use client";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from 'next/link';
import ReachOutImage from '@/attached_assets/reach-out.webp';
import LogoMarker from '@/attached_assets/logo-marker-right.webp';
import LaptopImage from '@/attached_assets/laptop.webp';
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
                  What You Can Reach Out About
                </motion.h2>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-2"
                >
                  You can contact us if you'd like to:
                </motion.p>

                <motion.ul
                  variants={fadeUp}
                  className="num-ullist list-decimal pl-5 space-y-2 cs_section_heading_text mb-2"
                >
                  <li>Learn more about the Insurigence platform</li>
                  <li>Request early access or join the waitlist</li>
                  <li>Understand how Insurigence fits your agency workflow</li>
                  <li>Share feedback or ideas</li>
                  <li>Discuss potential partnerships</li>
                </motion.ul>



                <motion.p 
                  variants={fadeUp} 
                  className="cs_section_heading_text mb-4">
                  We aim to respond promptly and provide clear, relevant information based on your needs.
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

          {/* LEFT IMAGE */}
          <div className="col-lg-5">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={fadeLeft}
              transition={{ duration: 0.6 }}
            >
              <Image src={ReachOutImage} alt="img" className="w-full h-auto rounded-lg" />
            </motion.div>
          </div>

          <div className="cs_height_60 cs_height_lg_80"></div>


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
                  Who You'll Be Speaking With
                </motion.h2>

                <motion.p
                  variants={fadeUp}
                  className="cs_section_heading_text mb-2"
                >
                  We work closely with agencies to understand real workflows, gather feedback, and ensure the platform is aligned with how commercial insurance teams operate.
                </motion.p>

                <motion.p 
                variants={fadeUp} 
                className="cs_section_heading_text mb-2">
                  When you reach out, you'll be connecting directly with the Insurigence team involved in building and refining the platform.
                </motion.p>

              </motion.div>
            </div>
          </div>


          {/* LEFT IMAGE */}
          <div className="col-lg-5">
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={fadeLeft}
              transition={{ duration: 0.6 }}
            >
              <Image src={LaptopImage} alt="img" className="w-full h-auto rounded-lg" />
            </motion.div>
          </div>



        </div>
      </div>

      <span className="cs_wheel_shape absolute right-0 top-2/5 -translate-y-1/2">
        <Image src={LogoMarker} alt="img" width={121} height={116} />
      </span>


      <div className="h-10 sm:h-10 lg:h-40"></div>
    </section>
  );
};

export default AboutUs;
