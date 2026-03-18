"use client";
import Image from "next/image";
import Link from "next/link";
import {
  motion
} from "framer-motion";

import Aim1 from "@/attached_assets/aim-1.webp";
import Aim2 from "@/attached_assets/aim-2.webp";
import Aim3 from "@/attached_assets/aim-3.webp";
import Aim4 from "@/attached_assets/aim-4.webp";
import AimImage from "@/attached_assets/aim-image.webp";

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

const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.2
    }
  }
};

const OurAim = () => {
  return (
    <section className="relative overflow-hidden">
      <div className="container">

        <div className="cs_height_60 cs_height_lg_50"></div>

        <div className="row cs_gap_y_40 align-items-stretch">

          {/* LEFT SIDE */}
          <div className="col-lg-6 flex flex-col justify-center">
            <div className="cs_section_heading_left">

              <motion.h2
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                viewport={{ once: false, amount: 0.2 }}
                className="text-3xl sm:text-3xl md:text-4xl lg:text-4xl mb-2 font-medium"
              >
                What We Aim For
              </motion.h2>

              <motion.p
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                viewport={{ once: false, amount: 0.2 }}
                className="cs_section_heading_text mb-4 text-gray-600 leading-relaxed"
              >
                The Insurigence platform is designed to go beyond workflow management. Future capabilities aim to introduce deeper intelligence into the placement process.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                viewport={{ once: false, amount: 0.2 }}
                className="w-full mt-6"
              >
                <Image
                  src={AimImage}
                  alt="img"
                  className="w-full h-auto object-cover rounded-lg"
                />
              </motion.div>

            </div>
          </div>

          {/* RIGHT SIDE */}
          <div
            className="col-lg-6 p-[20px] sm:p-[40px] lg:p-[40px]"
            style={{ background: "#07496c" }}
          >
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              variants={container}
              className="space-y-6"
            >
              <motion.h4
                variants={fadeUp}
                className="text-2xl sm:text-3xl md:text-4xl lg:text-2xl mb-2 font-medium text-white"
              >
                Planned capabilities include:
              </motion.h4>

              {/* Item 1 */}
              <motion.div variants={fadeLeft} className="flex items-start gap-4">
                <span className="flex-shrink-0">
                  <Image src={Aim1} alt="img" width={50} height={50} />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg md:text-xl font-medium mb-1 text-green-400">
                    Carrier Appetite Intelligence
                  </h3>
                  <p className="text-sm sm:text-base text-white/80 leading-relaxed mb-0">
                    Identify potential carrier fit based on risk characteristics before submitting.
                  </p>
                </div>
              </motion.div>

              {/* Item 2 */}
              <motion.div variants={fadeLeft} className="flex items-start gap-4">
                <span className="flex-shrink-0">
                  <Image src={Aim2} alt="img" width={50} height={50} />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg md:text-xl font-medium mb-1 text-green-400">
                    Submission Quality Scoring
                  </h3>
                  <p className="text-sm sm:text-base text-white/80 leading-relaxed mb-0">
                    Evaluate the strength and completeness of a submission to improve quoting outcomes.
                  </p>
                </div>
              </motion.div>

              {/* Item 3 */}
              <motion.div variants={fadeLeft} className="flex items-start gap-4">
                <span className="flex-shrink-0">
                  <Image src={Aim3} alt="img" width={50} height={50} />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg md:text-xl font-medium mb-1 text-green-400">
                    Exposure Gap Detection
                  </h3>
                  <p className="text-sm sm:text-base text-white/80 leading-relaxed mb-0">
                    Highlight uncovered exposures and potential coverage opportunities.
                  </p>
                </div>
              </motion.div>

              {/* Item 4 */}
              <motion.div variants={fadeLeft} className="flex items-start gap-4">
                <span className="flex-shrink-0">
                  <Image src={Aim4} alt="img" width={50} height={50} />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg md:text-xl font-medium mb-1 text-green-400">
                    Predictive Underwriting Assistance
                  </h3>
                  <p className="text-sm sm:text-base text-white/80 leading-relaxed mb-0">
                    Surface potential underwriting questions or documentation needs earlier in the process.
                  </p>
                </div>
              </motion.div>

            </motion.div>
          </div>

        </div>

      </div>

      <div className="cs_height_60 cs_height_lg_80"></div>
    </section>
  );
};

export default OurAim;