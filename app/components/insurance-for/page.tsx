"use client";
import Image from 'next/image';
import Link from 'next/link';
import { motion } from "framer-motion";
import Icon1 from '@/attached_assets/wholesale-brokers.webp';
import Icon2 from '@/attached_assets/retail-agencies.webp';
import Icon3 from '@/attached_assets/program-administrators-1.webp';
import Icon4 from '@/attached_assets/growing-teams.webp';
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


const InsuranceFor = () => { 

  return (
    <section className="cs_gray_bg_2">


      {/* Heading Section */}

      {/* Cards Section */}
      <motion.div
        className="row"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={container}
      >

        <motion.div
          className="col-xl-6 col-md-6"
          variants={fadeDown}
        >
          <div className="cs_card_new cs_style_2 cs_radius_10 position-relative overflow-hidden ">

            <span className="cs_card_icon cs_center cs_radius_50 cs_mb_25" style={{ margin: '20 auto' }}>
              <Image src={Icon1} alt="img" width={70} height={80} />
            </span>

            <div className="cs_card_content text-center">
              <h3 className="cs_card_title text-lg sm:text-xl font-medium mb-2">
                <Link href="/service/service-details">
                  Wholesale brokers and MGAs
                </Link>
              </h3>
              <p className="cs_card_subtitle cs_mb_22">
                Wholesale brokers and MGAs use Insurigence to sort and evaluate incoming submissions more efficiently. By identifying which risks align with their programs and filtering out those that do not, teams can focus their time on viable opportunities and work more effectively with retail partners.
              </p>
            </div>

            <div className="cs_card_shape position-absolute start-0 top-0 z-0">
              <Image src={ServiceCardShape} alt="img" width={264} height={286} />
            </div>
          </div>
        </motion.div>


        <motion.div
          className="col-xl-6 col-md-6"
          variants={fadeDown}
          style={{ background: 'rgb(220, 250, 241)' }}
        >
          <div className="cs_card_new cs_style_2 cs_radius_10 position-relative overflow-hidden ">

            <span className="cs_card_icon cs_center cs_mb_25" style={{ margin: '20 auto' }}>
              <Image src={Icon2} alt="img" width={70} height={80} />
            </span>

            <div className="cs_card_content text-center">
              <h3 className="cs_card_title text-lg sm:text-xl font-medium mb-2">
                <Link href="/service/service-details">
                  Independent Retail Agencies
                </Link>
              </h3>
              <p className="cs_card_subtitle cs_mb_22">
                Retail agencies use Insurigence to review risks more confidently before sending them to the market. The platform helps teams identify potential issues early, decide when specialty markets may be appropriate, and maintain consistent placement decisions across producers, account managers, and offices.
              </p>
            </div>

            <div className="cs_card_shape position-absolute start-0 top-0 z-0">
              <Image src={ServiceCardShape} alt="img" width={264} height={286} />
            </div>
          </div>
        </motion.div>


        <motion.div
          className="col-xl-6 col-md-6 order-2 order-md-1"
          variants={fadeDown}
          style={{ background: 'rgb(220, 250, 241)' }}
        >
          <div className="cs_card_new cs_style_2 cs_radius_10 position-relative overflow-hidden ">

            <span className="cs_card_icon cs_center cs_radius_50 cs_mb_25" style={{ margin: '20 auto' }}>
              <Image src={Icon3} alt="img" width={70} height={80} />
            </span>

            <div className="cs_card_content text-center">
              <h3 className="cs_card_title text-lg sm:text-xl font-medium mb-2">
                <Link href="/service/service-details">
                  Program administrators
                </Link>
              </h3>
              <p className="cs_card_subtitle cs_mb_22">
                Program administrators use Insurigence to maintain discipline in how risks are evaluated and submitted into their programs. The platform helps standardize intake and support consistent underwriting decisions as submission volume and program growth increase.
              </p>
            </div>

            <div className="cs_card_shape position-absolute start-0 top-0 z-0">
              <Image src={ServiceCardShape} alt="img" width={264} height={286} />
            </div>

          </div>
        </motion.div>


        <motion.div
          className="col-xl-6 col-md-6 order-1 order-md-2"
          variants={fadeDown}
        >
          <div className="cs_card_new cs_style_2 cs_radius_10 position-relative overflow-hidden ">

            <span className="cs_card_icon cs_center cs_radius_50 cs_mb_25" style={{ margin: '20 auto' }}>
              <Image src={Icon4} alt="img" width={70} height={80} />
            </span>

            <div className="cs_card_content text-center">
              <h3 className="cs_card_title text-lg sm:text-xl font-medium mb-2">
                <Link href="/service/service-details">
                  Growing teams and new hires
                </Link>
              </h3>
              <p className="cs_card_subtitle cs_mb_22">
                Insurigence helps growing agencies support new producers and account managers by providing clearer guidance during the risk evaluation process. This helps teams ramp up faster, make more confident placement decisions, and reduce dependence on a small number of senior staff.
              </p>
            </div>

            <div className="cs_card_shape position-absolute start-0 top-0 z-0">
              <Image src={ServiceCardShape} alt="img" width={264} height={286} />
            </div>

          </div>
        </motion.div>
      </motion.div>
    </section>


  );
};

export default InsuranceFor;
