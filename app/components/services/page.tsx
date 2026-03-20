"use client"
import Image from 'next/image';
import Link from 'next/link';
import { motion } from "framer-motion";
import React, { useRef } from 'react';
import Slider from "react-slick";
import ServiceImage1 from '@/attached_assets/independent-commercial-agencies.webp';
import ServiceImage2 from '@/attached_assets/wholesale-brokers-and-mgas.webp';
import ServiceImage3 from '@/attached_assets/program-administrators.webp';
import ServiceImage4 from '@/attached_assets/growing-teams-and-new-hires.webp';
import ArrowRight from '@/attached_assets/arrow_right.svg';
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";


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

const fadeRight = {
  hidden: { opacity: 0, x: 60 },
  visible: {
    opacity: 1,
    x: 0,
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
      staggerChildren: 0.25
    }
  }
};

const Services = () => {

  const chooseContent = [
    { url: '#', img: ServiceImage1, title: 'Independent Commercial Agencies', content: '' },
    { url: '#', img: ServiceImage2, title: 'Wholesale Brokers And MGAs', content: '' },
    { url: '#', img: ServiceImage3, title: 'Program Administrators', content: '' },
    { url: '#', img: ServiceImage4, title: 'Growing Teams And New Hires', content: '' },
  ];


  const settings = {
  dots: false,
  infinite: true,
  speed: 2000,
  slidesToShow: 4,
  slidesToScroll: 1,
  arrows: false,
  swipeToSlide: true,
  autoplay: true,
  autoplaySpeed: 4000,

  responsive: [
  {
    breakpoint: 480,
    settings: { slidesToShow: 1 }
  },
  {
    breakpoint: 768,
    settings: { slidesToShow: 2 }
  },
  {
    breakpoint: 1024,
    settings: { slidesToShow: 3 }
  },
  {
    breakpoint: 1400,
    settings: { slidesToShow: 4 }
  }
]
};

  const sliderRef = useRef<Slider | null>(null);

  const next = () => {
    sliderRef.current?.slickNext();
  };

  const previous = () => {
    sliderRef.current?.slickPrev();
  };


  return (
    <section
      className="cs_slider cs_style_1 cs_slider_gap_30 cs_bg_filed"
      style={{ background: "#dcfaf1" }}
    >
      <div className="cs_height_60 cs_height_sm_20 cs_height_md_20 cs_height_lg_80"></div>

      <div className="container">

        {/* Heading + Arrows */}
        <motion.div
          className="cs_section_heading cs_style_1 cs_type_1"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: false, amount: 0.3 }}
          variants={container}
        >
          <div className="cs_section_heading cs_style_1 text-center">
            <motion.h2
              variants={fadeUp}
              className="text-3xl sm:text-3xl md:text-4xl lg:text-4xl mb-2 font-medium"
            >
              Who Insurigence Is Built For
            </motion.h2>
          </div>

          <motion.div
            variants={fadeRight}
            className="cs_section_heading_right"
          >
            <div className="cs_slider_arrows cs_style_1">
              <div
                onClick={previous}
                className="cs_left_arrow cs_center cs_radius_50 slick-arrow"
              >
                <Image src={ArrowRight} alt="img" width={23} height={23} />
              </div>
              <div
                onClick={next}
                className="cs_right_arrow cs_center cs_radius_50 slick-arrow"
              >
                <Image src={ArrowRight} alt="img" width={23} height={23} />
              </div>
            </div>
          </motion.div>
        </motion.div>

        <div className="cs_height_60 cs_height_lg_50"></div>

        {/* Slider */}
        <div className="cs_slider_container">
          <div className="cs_slider_wrapper">
            <Slider ref={sliderRef} {...settings}>
              {chooseContent.map((item, i) => (
                <div key={i} className="cs_slide">

                  <motion.article
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: false, amount: 0.2 }}
                    transition={{ duration: 0.8 }}
                    whileHover={{ y: -6, scale: 1.02 }}
                    className="cs_post cs_style_1 cs_type_1"
                  >
                    <motion.div
                      whileHover={{ scale: 1.03 }}
                      transition={{ duration: 0.4 }}
                    >
                      <Image
                        src={item.img}
                        alt="img"
                        width={362}
                        height={235}
                      />
                    </motion.div>

                    <div className="cs_post_content cs_white_bg text-center">
                      <h3 className="text-lg sm:text-xl md:text-xl font-medium mb-2">
                        {item.title}
                      </h3>
                    </div>
                  </motion.article>

                </div>
              ))}
            </Slider>
          </div>
        </div>

      </div>

      <div className="cs_height_40 cs_height_lg_80"></div>
    </section>
  );
};

export default Services;