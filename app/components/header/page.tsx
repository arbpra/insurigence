"use client"
import { useEffect, useState } from 'react';
import Nav from './Nav';
import Link from 'next/link';
import Logo from '@/app/components/Logo';
export default function Header3({ variant }: any) {
  const [mobileToggle, setMobileToggle] = useState(false);
  const [isSticky, setIsSticky] = useState('');

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        setIsSticky('cs-gescout_sticky');
      } else {
        setIsSticky('');
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div>
      <header
        className={`cs_site_header header_style_2 header_style_2_2 cs_style_1 header_sticky_style1 ${variant ? variant : ''
          } cs_sticky_header cs_site_header_full_width ${mobileToggle ? 'cs_mobile_toggle_active' : ''
          } ${isSticky ? isSticky : ''}`}
      >

        <div className="cs_top_header">
          <div className="container">
            <div className="cs_top_header_in">
              <div className="cs_top_header_left header-info">
                <ul className="cs_header_contact_list cs_mp_0 cs_white_color">
                  <li>
                    <i className="bi bi-envelope-fill"></i>
                    <a href="mailto:abc@insurigence.com" aria-label="Email link">abc@insurigence.com</a>
                  </li>
                  <li>
                    <i className="bi bi-telephone-fill"></i>
                    <a href="tel:012-345-6789" aria-label="Phone call link">012-345-6789</a>
                  </li>
                </ul>
              </div>

              <div className="cs_top_header_left2 header-info">
                <ul className="cs_header_contact_list cs_mp_0 cs_white_color">
                  <li>
                    <i className="bi bi-envelope-fill"></i>
                    <a href="mailto:abc@insurigence.com" aria-label="Email link">abc@insurigence.com</a>
                  </li>
                  <li>
                    <i className="bi bi-telephone-fill"></i>
                    <a href="tel:012-345-6789" aria-label="Phone call link">012-345-6789</a>
                  </li>
                </ul>
              </div>


              <div className="cs_top_header_right">
                <div className="cs_header_social_links_wrap">
                  <div className="cs_header_social_links top-header-social-icon">
                    <div className="cs_social_btns cs_style_1">

                      <a href="#" aria-label="Social link" className="cs_center">
                        <i className="bi bi-facebook"></i>
                      </a>
                      <a href="#" aria-label="Social link" className="cs_center">
                        <i className="bi bi-youtube"></i>
                      </a>
                      {/* <a href="#" aria-label="Social link" className="cs_center">
                        <i className="bi bi-linkedin"></i>
                      </a>
                      <a href="#" aria-label="Social link" className="cs_center">
                        <i className="bi bi-instagram"></i>
                      </a> */}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="cs_top_header2">
          <div className="container">
            <div className="cs_top_header_in">


              <div className="cs_top_header_left2 header-info">
                <ul className="cs_header_contact_list cs_mp_0 cs_white_color">
                  <li>
                    <i className="bi bi-envelope-fill"></i>
                    <a href="mailto:abc@insurigence.com" aria-label="Email link">Email Us</a>
                  </li>
                  <li>
                    <i className="bi bi-telephone-fill"></i>
                    <a href="tel:012-345-6789" aria-label="Phone call link">Call Us</a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="cs_main_header">
          <div className="container">
            <div className="cs_main_header_in">
              <div className="cs_main_header_left">

                <Logo size="md" />
              </div>
                            
              <div className="cs_main_header_center">
                <div className="cs_nav cs_primary_font fw-medium">
                  <span
                    className={
                      mobileToggle
                        ? 'cs-munu_toggle cs_teggle_active'
                        : 'cs-munu_toggle'
                    }
                    onClick={() => setMobileToggle(!mobileToggle)}
                  >
                    <span></span>
                  </span>
                  <Nav setMobileToggle={setMobileToggle} />
                </div>
              </div>
              <div className="cs_main_header_right hidden md:block">
                <div className="header-btn d-flex align-items-center">
                  <ul className="cs_header_contact_list cs_mp_0 cs_white_color">
                    <li>
                      <Link href="https://insurigence.ai/login" aria-label="Contact button" className="cs_btn cs_style_1 cs_fs_14 cs_bold text-uppercase wow fadeInLeft"><span>Log In</span></Link>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}
