import type { ReactElement } from "react";

import { Button } from "./ui/primitives.js";

const logoUrl = "/Anecites_logo.png";

interface LandingPageProps {
  loading: boolean;
  onHostInterview: () => void;
  onJoinInterview: () => void;
}

interface IconProps {
  className?: string;
}

const features = [
  {
    icon: ClockIcon,
    title: "Session-scoped",
    body: "Active only for your scheduled interview, gone the moment it ends.",
  },
  {
    icon: EyeIcon,
    title: "Fully disclosed",
    body: "Every check it performs is visible to you before you begin.",
  },
  {
    icon: FeatherIcon,
    title: "Lightweight",
    body: "A small native app with no background bloat and no persistent tracking.",
  },
  {
    icon: ShieldIcon,
    title: "Built for trust",
    body: "Runs in user mode only. No system-level access, no kernel drivers.",
  },
] as const;

const steps = [
  {
    title: "Host interview",
    body: "Create a local demo meeting and share the generated code and password.",
  },
  {
    title: "Join interview",
    body: "Candidates enter only the meeting code and password.",
  },
  {
    title: "Start using",
    body: "Connect camera, collaborate, and run the local checks through Anecites.",
  },
] as const;

const faqs = [
  {
    question: "What does Anecites monitor in this demo?",
    answer:
      "The demo can connect video, run native monitoring checks from the desktop shell, and route code execution through the backend. The candidate does not enter internal session IDs or tokens.",
  },
  {
    question: "Does the frontend call code execution or video services directly?",
    answer:
      "No. The client talks to the Anecites backend. The backend issues scoped tokens or calls backend-only services.",
  },
  {
    question: "Is anything recorded after the interview ends?",
    answer:
      "The local demo does not enable recording by default. Production recording should remain explicit, scoped, and disclosed.",
  },
  {
    question: "Do I need paid Judge0 or RapidAPI credentials?",
    answer:
      "No. The current development direction uses self-hosted Piston for code execution and keeps paid APIs out of the default flow.",
  },
] as const;

export function LandingPage({
  loading,
  onHostInterview,
  onJoinInterview,
}: LandingPageProps): ReactElement {
  return (
    <div className="landing-page" data-anecites-desktop="landing-page">
      <header className="landing-header">
        <a href="#top" className="landing-logo" aria-label="Anecites Agent home">
          <Logo size={30} />
          <span>Anecites Agent</span>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#features">Features</a>
          <a href="#setup">Setup</a>
          <a href="#faq">FAQ</a>
        </nav>
      </header>

      <main id="top">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">Local demo</p>
            <h1 id="landing-title">A fair interview for everyone in it.</h1>
            <p className="landing-lede">
              Anecites Agent runs quietly during your scheduled interview, so interviewers can trust what they see and
              candidates always know exactly what it is checking.
            </p>
            <p className="landing-support">Start a local interview now. No paid code-execution API is required.</p>

            <div className="landing-actions">
              <Button loading={loading} onClick={onHostInterview}>
                Host interview
              </Button>
              <Button variant="secondary" disabled={loading} onClick={onJoinInterview}>
                Join interview
              </Button>
            </div>
          </div>

          <AppMockup />
        </section>

        <section className="landing-section" id="features" aria-labelledby="features-title">
          <div className="landing-section-heading">
            <h2 id="features-title">Built to be minimal, by design.</h2>
            <p>Every decision favors transparency and restraint over convenience for us.</p>
          </div>

          <div className="landing-feature-grid">
            {features.map(({ icon: Icon, title, body }) => (
              <article className="landing-feature-card" key={title}>
                <Icon className="landing-card-icon" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-setup" id="setup" aria-labelledby="setup-title">
          <div className="landing-section-heading">
            <h2 id="setup-title">Up and running in under a minute.</h2>
          </div>

          <div className="landing-step-grid">
            {steps.map(({ title, body }, index) => (
              <article className="landing-step-card" key={title}>
                <span aria-hidden="true">{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-faq" id="faq" aria-labelledby="faq-title">
          <div className="landing-section-heading">
            <h2 id="faq-title">Questions, answered plainly.</h2>
          </div>

          <div className="landing-faq-list">
            {faqs.map(({ question, answer }) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div>
          <Logo size={22} />
          <span>Anecites Agent</span>
          <span>2026</span>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#features">Features</a>
          <a href="#setup">Setup</a>
          <a href="#faq">FAQ</a>
        </nav>
      </footer>
    </div>
  );
}

function Logo({ size }: { size: number }): ReactElement {
  return (
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      className="landing-logo-image"
      style={{ width: size, height: size }}
    />
  );
}

function AppMockup(): ReactElement {
  const items = ["Environment verified", "Screen sharing active", "Session ends with interview"];

  return (
    <div className="landing-mockup" aria-label="Anecites Agent session preview">
      <div className="landing-mockup-window">
        <div className="landing-mockup-bar">
          <span />
          <span />
          <span />
          <strong>Anecites Agent - Session Active</strong>
        </div>
        <div className="landing-mockup-body">
          <div className="landing-session-status">
            <span aria-hidden="true" />
            <div>
              <strong>Interview session in progress</strong>
              <p>00:24:18 - ends automatically at 15:00</p>
            </div>
          </div>

          <div className="landing-check-list">
            {items.map((item) => (
              <div key={item}>
                <span>{item}</span>
                <CheckIcon className="landing-check-icon" />
              </div>
            ))}
          </div>

          <p className="landing-mockup-note">
            This window closes automatically when your interview ends. No background process remains on your system.
          </p>
        </div>
      </div>
    </div>
  );
}

function ClockIcon({ className }: IconProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Clock">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </svg>
  );
}

function EyeIcon({ className }: IconProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Eye">
      <path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function FeatherIcon({ className }: IconProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Feather">
      <path d="M20 4c-6.5.4-11.2 3.7-14 10l4 4c6.3-2.8 9.6-7.5 10-14Z" />
      <path d="M6 18 4 20" />
      <path d="m10 14 4-4" />
    </svg>
  );
}

function ShieldIcon({ className }: IconProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Shield">
      <path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps): ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Complete">
      <path d="m5 12 4 4 10-10" />
    </svg>
  );
}
