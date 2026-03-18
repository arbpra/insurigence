import Link from 'next/link';
import DropDown from './DropDown';

interface NavProps {
  setMobileToggle: (value: boolean) => void;
}

export default function Nav({ setMobileToggle }: NavProps) {
  return (
    <ul className="cs_nav_list fw-medium">
      <li>
        <Link href="/">Platform</Link>
      </li>
      {/* <li className="menu-item-has-children">
        <Link href="#">Services</Link>
        <DropDown>
          <ul>
            <li>
              <Link href="/sydney-airport-transfer" onClick={() => setMobileToggle(false)}>
                Sydney Airport Transfer
              </Link>
            </li>
            <li>
              <Link href="/wheelchair-taxi-sydney" onClick={() => setMobileToggle(false)}>
                Wheelchair Taxi Sydney
              </Link>
            </li>
            <li>
              <Link href="/baby-seat-taxi-sydney" onClick={() => setMobileToggle(false)}>
                Baby Seat Taxi Sydney
              </Link>
            </li>
            <li>
              <Link href="/group-wedding-transfer" onClick={() => setMobileToggle(false)}>
                Group/Wedding Transfer
              </Link>
            </li>
            <li>
              <Link href="/interstate-transfer" onClick={() => setMobileToggle(false)}>
                Interstate Transfer
              </Link>
            </li>
             <li>
              <Link href="/11-seater-taxi-sydney" onClick={() => setMobileToggle(false)}>
                11 Seater Taxi Sydney
              </Link>
            </li>
            <li>
              <Link href="/maxi-suv-sydney" onClick={() => setMobileToggle(false)}>
                Maxi SUV Sydney
              </Link>
            </li>
            <li>
              <Link href="/sedan-cab-sydney" onClick={() => setMobileToggle(false)}>
                Sedan Cab Sydney
              </Link>
            </li>

            
          </ul>
        </DropDown>
      </li> */}

       <li>
        <Link href="#">How It Woks</Link>
      </li>

      <li>
        <Link href="#">Who It's For</Link>
      </li>

      <li>
        <Link href="#">Early Access</Link>
      </li>


      

      {/* <li className="menu-item-has-children">
        <Link href="#">About</Link>
        <DropDown>
          <ul>
            <li>
              <Link href="/about-us" onClick={() => setMobileToggle(false)}>
                About Us
              </Link>
            </li>
            <li>
              <Link href="/team" onClick={() => setMobileToggle(false)}>
                Our Team
              </Link>
            </li>
            <li>
              <Link href="/team/team-details" onClick={() => setMobileToggle(false)}>
                Team Details
              </Link>
            </li>
            <li>
              <Link href="/pricing" onClick={() => setMobileToggle(false)}>
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/faq" onClick={() => setMobileToggle(false)}>
                Faq
              </Link>
            </li>
            <li>
              <Link href="/contact-us" onClick={() => setMobileToggle(false)}>
                Contact
              </Link>
            </li>
          </ul>
        </DropDown>
      </li> */}



      {/* <li className="menu-item-has-children">
        <Link href="/project" onClick={() => setMobileToggle(false)}>
        Project
        </Link>
        <DropDown>
          <ul>
            <li>
              <Link href="/project" onClick={() => setMobileToggle(false)}>
              Project
              </Link>
            </li>          
            <li>
              <Link href="/project/project-details" onClick={() => setMobileToggle(false)}>
              Project Details
              </Link>
            </li>
          </ul>
        </DropDown>
      </li> 
      
      <li className="menu-item-has-children">
        <Link href="/blog" onClick={() => setMobileToggle(false)}>
          Blog
        </Link>
        <DropDown>
          <ul>
            <li>
              <Link href="/blog" onClick={() => setMobileToggle(false)}>
                Blog
              </Link>
            </li>
            <li>
              <Link href="/blog-sidebar" onClick={() => setMobileToggle(false)}>
                Blog With Sidebar
              </Link>
            </li>                         
            <li>
              <Link
                href="/blog/blog-details"
                onClick={() => setMobileToggle(false)}
              >
                Blog Details
              </Link>
            </li>
          </ul>
        </DropDown>
      </li> */}
      <li>
        <Link href="/contact-us" onClick={() => setMobileToggle(false)}>
          Contact Us
        </Link>
      </li>
    </ul>
  );
}
