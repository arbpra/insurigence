"use client";
import Image from 'next/image';
import { motion } from "framer-motion";
import Link from 'next/link';
import CTAImage from '@/attached_assets/call-to-action.webp';
import React from 'react';

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
  hidden: { opacity: 0, x: -80 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 1,
      ease: [0.25, 1, 0.5, 1]
    }
  }
};

const fadeRight = {
  hidden: { opacity: 0, x: 80 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 1,
      ease: [0.25, 1, 0.5, 1]
    }
  }
};


const CallToAction = () => {
  return (
    <section className="cs_about cs_style_1 cs_type_1 position-relative">

      <motion.div
        className="row items-center"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        variants={container}
      >

        {/* Content Section */}
        <motion.div
          className="col-lg-6 flex items-center bg-[#07496c] p-[40px] sm:p-[40px] lg:px-[80px] lg:py-[110px]"
          variants={fadeRight}
        >
          <div className="cs_about_content">

            <motion.h1
              variants={fadeUp}
              className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-normal tracking-tight text-left mb-4"
              style={{ fontFamily: "Helvetica" }}
            >
              <span className="text-[#00E6A7]">Stop guessing</span>{" "}
              <span className="text-white">class codes &</span>{" "}
              <span className="text-[#00E6A7]">Explain the coverage</span>{" "}
              <span className="text-white">
                without sounding like a policy form.
              </span>
            </motion.h1>

            <motion.div
              variants={fadeUp}
              className="flex flex-col sm:flex-row items-center justify-start gap-4"
            >
              <motion.a
                href="#contact"
                whileHover={{ y: -4, scale: 1.03 }}
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
        </motion.div>

        {/* Image Section */}
        <motion.div
          className="col-lg-6"
          variants={fadeLeft}
        >
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.4 }}
          >
            <Image
              src={CTAImage}
              alt="img"
              className="w-full h-auto object-cover"
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
};

export default CallToAction;
