import Link from 'next/link';
import Image from 'next/image';
import TheDeskContact from '../../components/the-desk/TheDeskContact';

import banner from '@/attached_assets/the-desk-banner.webp';
import renewalsImg from '@/attached_assets/renewals.webp';
import endorsementsImg from '@/attached_assets/endorsments.webp';
import neverStopsImg from '@/attached_assets/never-stops.webp';
import growthImg from '@/attached_assets/growth.webp';
import considerItDone from '@/attached_assets/consider-it-done.webp';
import upAndRunning from '@/attached_assets/up-and-running-in-days.webp';
import agencyOwner from '@/attached_assets/agency-owner.webp';
import whyInsurigence from '@/attached_assets/why-insurigence.webp';

const Check = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const MINT = '#00E6A7';
const NAVY = '#07496c';

/* Shared type scale — one size per role across the whole page, matching the other inner pages. */
const H2 = 'text-2xl sm:text-3xl md:text-4xl lg:text-4xl font-medium tracking-tight mb-3';
const H3 = 'text-lg sm:text-xl font-medium mb-2';
const LEAD = 'text-sm sm:text-base md:text-lg leading-relaxed';
const BODY = 'text-sm sm:text-base leading-relaxed';

/* Colour per background, so every heading/paragraph keeps the same contrast on light and dark. */
const HEAD_LIGHT = { color: NAVY };
const BODY_LIGHT = 'text-gray-600';
const BODY_DARK = 'text-white/80';

const ForYouCard = ({ text }: { text: string }) => (
  <div className="flex items-start gap-2.5 rounded-xl bg-white px-5 py-4 shadow-[0_8px_28px_rgba(13,33,55,0.09)]">
    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
    <p className={`${BODY} ${BODY_LIGHT}`}>{text}</p>
  </div>
);

const AgencyPhoto = () => (
  <div className="relative mx-auto w-full max-w-[300px]">
    <div className="absolute inset-x-0 top-10 bottom-2 rounded-[38px]" style={{ backgroundColor: MINT }} />
    <Image
      src={agencyOwner}
      alt="Independent agency owner"
      placeholder="blur"
      className="relative z-10 w-full h-auto"
    />
  </div>
);

/* Hero copy — shared by the overlaid desktop hero and the stacked mobile one. */
const HeroCopy = () => (
  <>
    <p className={`${LEAD} font-medium mb-3 mt-12 text-white`}>Introducing The Desk by Insurigence</p>
    <h1 className="text-3xl sm:text-4xl lg:text-5xl font-medium leading-tight text-white mb-3">
      Your Agency&apos;s Back Office.<br />
      <span style={{ color: MINT }}>Fully Handled.</span>
    </h1>
    <p className={`${LEAD} ${BODY_DARK} max-w-md mb-8`}>
      Renewals, endorsements, COIs and new business support -all taken care of.
    </p>
    <Link
      href="#get-in-touch"
      className="inline-flex items-center gap-2 px-8 py-2 text-base font-medium rounded-md border-2"
      style={{ borderColor: '#fff', color: '#0D2137', backgroundColor: '#fff' }}
    >
      Request Early Access
    </Link>
  </>
);

const problems = [
  { title: 'Renewals Pile Up', text: 'Dozens of renewals hitting at once with no bandwidth to handle them all before expiry.', img: renewalsImg },
  { title: 'Endorsements Get Delayed', text: 'Small policy changes take too long and fall through the cracks when you’re stretched thin.', img: endorsementsImg },
  { title: 'COIs Never Stop', text: 'Clients need certificates on demand and chasing them eats hours you don’t have.', img: neverStopsImg },
  { title: 'Growth Stalls', text: 'Every time your book grows you need more staff. You can’t scale without adding overhead.', img: growthImg },
];

const solutions = [
  { title: 'Renewal Management', text: 'We track upcoming renewals, gather updated information, re-market where needed and prepare everything for your review -before the expiry date, every time.' },
  { title: 'Endorsement Processing', text: 'Policy changes, additions and removals handled accurately and quickly so your clients get updated coverage without the wait.' },
  { title: 'COI Requests', text: 'Certificates of insurance issued on demand. We handle the request, verify the details and deliver the certificate -same day.' },
  { title: 'New Business Support', text: 'From intake to submission we support your new business flow -gathering information, completing applications and preparing submissions for carrier review.' },
];

const steps = [
  { n: 1, title: 'You Get Onboarded', text: 'Tell us about your agency, your systems and your needs. We handle the setup and get familiar with your workflow.' },
  { n: 2, title: 'We Initiate Your Project', text: 'Your Desk VA works inside your existing systems -handling tasks as they come in, on your behalf, the right way.' },
  { n: 3, title: 'Your Growth Starts', text: 'With the back office handled your time goes where it matters: writing new business, building relationships and growing your book.' },
];

const forYou = [
  'You own an independent commercial lines agency',
  'You’re spending too much time on renewals, endorsements & COIs',
  'You’re writing more business than your current team can handle',
  'You want a back-office team that understands insurance -not just admin',
  'You want to scale without hiring full-time staff',
  'You are tired of being the bottleneck in your own agency',
];

const whyPoints = [
  'VAs trained specifically in commercial insurance operations',
  'Works inside your existing AMS and carrier portals',
  'Powered by Insurigence -built for commercial lines agencies',
  'No long-term contracts -start when you are ready',
  'Dedicated point of contact for your agency',
  'Up and running in days, not months',
];

export default function TheDeskPage() {
  return (
    <main className="w-full">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* lg+: copy sits on the left of the full-bleed photo, so the desk stays in frame */}
        <div
          className="hidden lg:block bg-cover bg-center"
          style={{ backgroundImage: `url(${banner.src})` }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
            <HeroCopy />
          </div>
        </div>

        {/* below lg: stacked, so the man isn't cropped out of a tall centre-cover crop */}
        <div className="lg:hidden">
          <div className="px-4 sm:px-6 pt-28 pb-14 sm:pt-32 sm:pb-16" style={{ background: `linear-gradient(160deg, ${NAVY}, #0a3f5c)` }}>
            <div className="max-w-6xl mx-auto">
              <HeroCopy />
            </div>
          </div>
          <Image
            src={banner}
            alt="A back-office specialist at work"
            priority
            sizes="100vw"
            className="w-full h-[220px] sm:h-[300px] md:h-[360px] object-cover object-[78%_center]"
          />
        </div>
      </section>

      {/* ── Problems ── */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className={`${H2} text-center`} style={HEAD_LIGHT}>
            Running An Independent Agency Is Harder <span style={{ color: MINT }}>Than It Should Be.</span>
          </h2>
          <p className={`${LEAD} ${BODY_LIGHT} text-center mb-12`}>
            You built your agency to write business. Not to spend your days buried in admin work that never ends.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {problems.map((p) => (
              <div key={p.title} className="rounded-xl border border-slate-200 p-6 flex gap-4 hover:shadow-md transition-shadow">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden" >
                  <Image src={p.img} alt={p.title} width={75} height={75} className="w-12 h-12 object-contain" />
                </div>
                <div>
                  <h3 className={H3} style={HEAD_LIGHT}>{p.title}</h3>
                  <p className={`${BODY} ${BODY_LIGHT}`}>{p.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Solutions (dark, with photo) ── */}
      <section
        className="bg-cover bg-center"
        style={{ backgroundImage: `linear-gradient(120deg, rgba(5,49,76,0.1) 0%, rgba(10,70,102,0.10) 100%), url(${considerItDone.src})` }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className={`${H2} text-center text-white`}>
            Consider It <span style={{ color: MINT }}>Done.</span>
          </h2>
          <p className={`${LEAD} ${BODY_DARK} text-center mb-12`}>
            Four core back-office functions we take completely off your plate so you can run a leaner, faster, more profitable agency.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {solutions.map((s) => (
              <div key={s.title} className="rounded-xl p-6 border border-white/15" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: MINT, color: NAVY }}>
                    <Check />
                  </span>
                  <h3 className={`${H3} text-white mb-0`}>{s.title}</h3>
                </div>
                <p className={`${BODY} ${BODY_DARK}`}>{s.text}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link href="#get-in-touch" className="inline-flex items-center px-7 py-3 rounded-md font-semibold transition-all hover:-translate-y-0.5" style={{ backgroundColor: MINT, color: NAVY }}>
              Request Access
            </Link>
          </div>
        </div>
      </section>

      {/* ── Onboarding steps ── */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <Image src={upAndRunning} alt="Up and running in days" className="rounded-2xl w-full h-auto shadow-sm" placeholder="blur" />
          <div>
            <h2 className={H2} style={HEAD_LIGHT}>
              Up And Running In Days.<br /><span style={{ color: MINT }}>Not Months.</span>
            </h2>
            <p className={`${LEAD} ${BODY_LIGHT} mb-8`}>Three steps and your back office is handled.</p>
            <div className="space-y-6">
              {steps.map((s) => (
                <div key={s.n} className="flex gap-4">
                  <span className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-sm" style={{ backgroundColor: MINT, color: '#ffffff' }}>{s.n}</span>
                  <div>
                    <h3 className={H3} style={HEAD_LIGHT}>{s.title}</h3>
                    <p className={`${BODY} ${BODY_LIGHT}`}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Built for ── */}
      <section id="agencyOwner" style={{ backgroundColor: '#F0FBF8' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className={`${H2} text-center`} style={HEAD_LIGHT}>
            Built For Independent <span style={{ color: MINT }}>Agency Owners.</span>
          </h2>
          <p className={`${LEAD} ${BODY_LIGHT} text-center max-w-2xl mx-auto mb-10`}>
            Not for captive agents. Not for personal lines. This is for owners of independent commercial lines agencies who are ready to scale without adding headcount. This is for you if:
          </p>
          {/* Desktop: cards flanking the photo */}
          <div className="hidden lg:grid grid-cols-[1fr_300px_1fr] items-stretch">
            <div className="relative z-20 -mr-14 flex flex-col justify-between py-4">
              {forYou.filter((_, i) => i % 2 === 0).map((t) => (
                <ForYouCard key={t} text={t} />
              ))}
            </div>
            <AgencyPhoto />
            <div className="relative z-20 -ml-14 flex translate-y-6 flex-col justify-between py-4">
              {forYou.filter((_, i) => i % 2 === 1).map((t) => (
                <ForYouCard key={t} text={t} />
              ))}
            </div>
          </div>

          {/* Tablet / mobile: photo above a simple grid */}
          <div className="lg:hidden">
            <AgencyPhoto />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-10">
              {forYou.map((t) => (
                <ForYouCard key={t} text={t} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Why Insurigence ── */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className={H2}>
              <span className="text-slate-400">WHY</span> <span style={{ color: MINT }}>INSURIGENCE</span>
            </h2>
            <p className={`${LEAD} ${BODY_LIGHT} mb-6`}>
              We are not a generic VA service. We are built specifically for the commercial insurance workflow.
            </p>
            <ul className="space-y-3 mb-8">
              {whyPoints.map((p) => (
                <li key={p} className="flex items-start gap-3">
                  <span className="mt-0.5 flex-shrink-0" style={{ color: '#0F9E78' }}><Check /></span>
                  <span className={`${BODY} ${BODY_LIGHT}`}>{p}</span>
                </li>
              ))}
            </ul>
            <Link href="#get-in-touch" className="inline-flex items-center px-6 py-2.5 rounded-md font-semibold transition-all hover:-translate-y-0.5" style={{ backgroundColor: MINT, color: NAVY }}>
              Learn More
            </Link>
          </div>
          <Image src={whyInsurigence} alt="Why Insurigence" className="rounded-2xl w-full h-auto shadow-sm" placeholder="blur" />
        </div>
      </section>

      {/* ── Contact ── */}
      <section id="get-in-touch" style={{ backgroundColor: '#EAF3F8' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className={`${H2} text-center`} style={HEAD_LIGHT}>
            Ready to Hand Off the <span style={{ color: MINT }}>Back Office?</span>
          </h2>
          <p className={`${LEAD} ${BODY_LIGHT} text-center mb-12`}>
            Tell us about your agency and we&apos;ll be in touch within one business day.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Get in touch card */}
            <div className="rounded-2xl p-7 text-white lg:col-span-1" style={{ background: `linear-gradient(160deg, ${NAVY}, #0a3f5c)` }}>
              <h3 className={`${H3} text-white`}>Get in Touch</h3>
              <p className={`${BODY} ${BODY_DARK} mb-6`}>We typically respond within one business day.</p>
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0" style={{ color: MINT }}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  </span>
                  <div>
                    <p className={`${BODY} font-medium text-white`}>(502) 501-6288</p>
                    <p className={`${BODY} ${BODY_DARK}`}>Call us anytime during business hours</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0" style={{ color: MINT }}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </span>
                  <div>
                    <p className={`${BODY} font-medium text-white`}>contact@insurigence.ai</p>
                    <p className={`${BODY} ${BODY_DARK}`}>Email us anytime</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0" style={{ color: MINT }}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </span>
                  <div>
                    <p className={`${BODY} font-medium text-white`}>insurigence.ai</p>
                    <p className={`${BODY} ${BODY_DARK}`}>Learn more about The Desk</p>
                  </div>
                </div>
                <div className="pt-4 border-t border-white/15">
                  <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Business Hours</p>
                  <p className={`${BODY} font-medium text-white`}>Monday – Friday</p>
                  <p className={`${BODY} ${BODY_DARK}`}>9:00 AM – 5:00 PM EST</p>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="lg:col-span-2">
              <TheDeskContact />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
