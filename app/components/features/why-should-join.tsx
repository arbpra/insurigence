"use client";
import Image from 'next/image';
import Link from 'next/link';
import { motion } from "framer-motion";
import Icon1 from '@/attached_assets/independent-retail-agencies.webp';
import Icon2 from '@/attached_assets/wholesale-brokers-mfa.webp';
import Icon3 from '@/attached_assets/program-administrators-2.webp';
import Icon4 from '@/attached_assets/commercial-insurance.webp';
import ServiceCardShape from '@/attached_assets/service_card_shape.svg';
import React from 'react';


const fadeUp = {
  hidden: { opacity: 0, y: 50 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1,
      ease: [0.25, 1, 0.5, 1]
    }
  }
};

const fadeDown = {
  hidden: { opacity: 0, y: -50 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1,
      ease: [0.25, 1, 0.5, 1]
    }
  }
};

const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.3
    }
  }
};


const WhyShouldJoin = () => {

  const chooseContent = [
    { img: Icon1, title: 'Independent Retail Agencies' },
    { img: Icon2, title: 'Wholesale Brokers & MGAs' },
    { img: Icon3, title: 'Program Administrators' },
    { img: Icon4, title: 'Commercial Insurance Teams Expanding Their Operations' },
  ];

  return (
    <section className="cs_gray_bg_2 features-panel">
      <div className="cs_height_60 cs_height_lg_80"></div>

      <div className="container">

        {/* Heading Section */}
        <div className="cs_section_heading cs_style_1 text-center max-w-3xl mx-auto">

          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight mb-3">
            Who Should Join
          </h2>

          <p className="text-sm sm:text-base md:text-lg text-gray-600 leading-relaxed mb-2">
            Early access is intended for organizations involved in evaluating and placing commercial insurance risks, including:
          </p>

        </div>

        <div className="cs_height_60 cs_height_lg_50"></div>

        {/* Cards Section */}
        <div className="row cs_row_gap_30 cs_gap_y_30 why-should-panel">
          {chooseContent.map((item, i) => (
            <div
              key={i}
              className="col-xl-3 col-md-6"
            >
              <div className="cs_card cs_style_2 cs_radius_10 position-relative overflow-hidden">

                <span className="cs_card_icon cs_white_bg cs_center cs_radius_50 cs_mb_25 ">
                  <Image src={item.img} alt="img" width={35} height={40} />
                </span>

                <div className="cs_card_content">
                  <h3 className="cs_card_title text-lg sm:text-xl font-medium mb-2 text-center">                   
                      {item.title}
                  </h3>

                </div>

                <div className="cs_card_shape position-absolute start-0 top-0 z-0">
                  <Image src={ServiceCardShape} alt="img" width={264} height={286} />
                </div>

                <div className="cs_card_shape_2 position-absolute z-0"></div>

              </div>
            </div>
          ))}
        </div>

      </div>

      <div className="cs_height_60 cs_height_lg_80"></div>
    </section>


  );
};

export default WhyShouldJoin;
