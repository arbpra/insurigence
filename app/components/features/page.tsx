"use client";
import Image from 'next/image';
import Link from 'next/link';
import { motion } from "framer-motion";
import Icon1 from '@/attached_assets/icon-1.webp';
import Icon2 from '@/attached_assets/icon-2.webp';
import Icon3 from '@/attached_assets/icon-3.webp';
import Icon4 from '@/attached_assets/icon-4.webp';
import Icon5 from '@/attached_assets/icon-5.webp';
import Icon6 from '@/attached_assets/icon-6.webp';
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


const Features = () => {

  const chooseContent = [
    { img: Icon1, title: 'Smart Commercial Intake', content: 'Guided intake flows adapt to each business type, helping agencies collect cleaner, more complete information from the start. Reduce back-and-forth and submit stronger risks to carriers.' },
    { img: Icon2, title: 'Business Classification Assistance', content: "AI-assisted NAICS and class code suggestions help reduce guesswork and identify potential mismatches early in the process." },
    { img: Icon3, title: 'Coverage Recommendation Engine', content: "Identify common industry exposures and recommended coverages before the quoting stage. Producers gain clarity on what protections a business may need." },
    { img: Icon4, title: 'Proposal Generation Engine', content: 'Generate clear, professional proposals with side-by-side carrier comparisons and plain-language coverage explanations clients can actually understand.' },
    { img: Icon5, title: "Proposals Clients Actually Understand", content: "Simplify complex policy language with built-in descriptions designed to help clients understand their coverage decisions." },
    { img: Icon6, title: "Producer Workflow Dashboard", content: 'Track submissions, monitor intake status, and manage proposal readiness through a centralized dashboard built for commercial producers.' },
  ];

  return (
    <section className="cs_gray_bg_2 features-panel">
  <div className="cs_height_60 cs_height_lg_80"></div>

  <div className="container">

    {/* Heading Section */}
    <div className="cs_section_heading cs_style_1 text-center max-w-3xl mx-auto">

      <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight mb-3">
        Easier Intakes. Cleaner Data. Faster Submissions.
      </h2>

      <p className="text-sm sm:text-base md:text-lg text-gray-600 leading-relaxed mb-2">
        Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua...
      </p>

    </div>

    <div className="cs_height_60 cs_height_lg_50"></div>

    {/* Cards Section */}
    <div className="row cs_row_gap_30 cs_gap_y_30 features-panel">
      {chooseContent.map((item, i) => (
        <div
          key={i}
          className="col-xl-4 col-md-6"
        >
          <div className="cs_card cs_style_2 cs_radius_10 position-relative overflow-hidden">

            <span className="cs_card_icon cs_white_bg cs_center cs_radius_50 cs_mb_25">
              <Image src={item.img} alt="img" width={35} height={40} />
            </span>

            <div className="cs_card_content">
              <h3 className="cs_card_title text-lg sm:text-xl font-medium mb-2">
                <Link href="/service/service-details">
                  {item.title}
                </Link>
              </h3>
              <p className="cs_card_subtitle cs_mb_22">{item.content}</p>
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

export default Features;
