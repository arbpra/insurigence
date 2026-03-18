"use client";
import Image from 'next/image';
import Link from 'next/link';
import { motion } from "framer-motion";
import LogoWhite from '@/attached_assets/logo-white.webp';
import React from 'react';

const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15
    }
  }
};

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.8,
      ease: "easeOut"
    }
  }
};

const Footer = () => {
  return (
    <footer className="cs_footer cs_style_1 cs_bg_filed cs_heading_bg position-relative">

      <div className="container">

        <motion.div
          className="cs_main_footer cs_white_color_2 position-relative z-1 custom-footer"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: false, amount: 0.2 }}
          variants={container}
        >
          <div className="container-fluid">
            <div className="cs_footer_content cs_footer_row">

              {/* Left Info */}
              <motion.div className="cs_footer_widget cs_footer_text" variants={fadeUp}>
                <div className="cs_text_widget mb-5">

                  <motion.div variants={fadeUp}>
                    <Image src={LogoWhite} alt="img" height={32} className="cs_mb_30" />
                  </motion.div>

                  <motion.div variants={fadeUp} className="d-flex align-items-start gap-2 mb-3">
                    <i className="bi bi-envelope icon-circle"></i>
                    <p className="mb-0">info@insurigence.com</p>
                  </motion.div>

                  <motion.div variants={fadeUp} className="d-flex align-items-start gap-2 mb-3">
                    <i className="bi bi-telephone icon-circle"></i>
                    <p className="mb-0">+123 456 789 10</p>
                  </motion.div>

                  <motion.div variants={fadeUp} className="d-flex align-items-start gap-2">
                    <i className="bi bi-geo-alt icon-circle"></i>
                    <p className="mb-0">
                      abc road, abc area, abc state, Country.
                    </p>
                  </motion.div>
                </div>

                {/* Social Icons */}
                <motion.div variants={fadeUp} className="cs_social_btns cs_style_1">
                  {["facebook", "twitter-x", "linkedin", "instagram"].map((icon, i) => (
                    <motion.a
                      key={i}
                      href="#"
                      className="cs_center cs_radius_50"
                      whileHover={{ y: -4, scale: 1.1 }}
                      transition={{ duration: 0.3 }}
                    >
                      <i className={`bi bi-${icon}`}></i>
                    </motion.a>
                  ))}
                </motion.div>
              </motion.div>

              {/* Links Section */}
              <motion.div className="cs_footer_links_wrapper" variants={container}>

                {[
                  {
                    title: "Services",
                    links: ["Platform", "How It Works", "Who It's For", "Early Access"]
                  },
                  {
                    title: "Company",
                    links: ["About", "Careers", "Contact"]
                  },
                  {
                    title: "Resources",
                    links: ["Portfolio", "Community", "Guides", "Docs", "Blog", "Press"]
                  },
                  {
                    title: "Legal",
                    links: ["Privacy", "Terms", "Security", "FAQ"]
                  }
                ].map((section, i) => (
                  <motion.div key={i} className="cs_footer_widget" variants={fadeUp}>
                    <h2 className="cs_footer_widget_title cs_fs_20 cs_medium cs_white_color cs_mb_27">
                      {section.title}
                    </h2>
                    <ul className="cs_footer_menu cs_mp_0">
                      {section.links.map((link, idx) => (
                        <motion.li
                          key={idx}
                          whileHover={{ x: 5 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Link href="#">{link}</Link>
                        </motion.li>
                      ))}
                    </ul>
                  </motion.div>
                ))}

              </motion.div>

            </div>
          </div>
        </motion.div>

        {/* Bottom */}
        <motion.div
          className="cs_footer_bottom cs_white_color_2 position-relative z-1"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: false }}
          transition={{ duration: 1 }}
        >
          <div className="container-fluid">
            <div className="cs_footer_bottom_in cs_footer_content text-center">
              <div className="cs_footer_copyright">
                &copy; Copyright 2026 - Insurigence - All Right Reserved.
              </div>
            </div>
          </div>
        </motion.div>

      </div>
    </footer>
  );
};

export default Footer;
