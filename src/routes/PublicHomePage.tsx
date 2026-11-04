import {
  ArrowRightOutlined,
  ArrowUpOutlined,
  CheckCircleFilled,
  FileSearchOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { routes } from './paths';

const { Paragraph, Text, Title } = Typography;
const hasDemoAccount = Boolean(__DEMO_LOGIN__);

const steps = [
  {
    number: '01',
    icon: <FileSearchOutlined />,
    title: 'Set the role criteria',
    description:
      'Add the job description and define the skills and requirements your team wants to review.',
  },
  {
    number: '02',
    icon: <UploadOutlined />,
    title: 'Add candidate resumes',
    description:
      'Upload resumes to one screening and follow parsing and evaluation progress as it runs.',
  },
  {
    number: '03',
    icon: <TeamOutlined />,
    title: 'Review the evidence',
    description:
      'Explore requirement signals and resume excerpts, then make the decision with your team.',
  },
];

const reviewPrinciples = [
  'See the resume evidence behind candidate signals.',
  'Keep required criteria visible during review.',
  'Leave final decisions with the hiring team.',
];

export default function PublicHomePage() {
  const [previewMode, setPreviewMode] = useState<'overview' | 'evidence'>('overview');

  return (
    <div className="public-home">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link className="brand landing-brand" to={routes.publicHome} aria-label="RecruitAI home">
            <span className="brand-mark">R</span>
            <span>
              Recruit<span className="brand-accent">AI</span>
            </span>
          </Link>

          <nav className="landing-nav-links" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#review-principles">Our approach</a>
          </nav>

          <div className="landing-nav-actions">
            <Link className="landing-signin" to={routes.signIn}>
              Sign in
            </Link>
            <Link className="landing-nav-cta" to={routes.register}>
              Create account
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <Text className="landing-eyebrow">
                <span className="landing-eyebrow-dot" />
                AI-assisted resume screening
              </Text>
              <Title id="landing-title" level={1}>
                AI matches resumes to <span>your role criteria.</span>
              </Title>
              <Paragraph className="landing-hero-description">
                AI extracts job requirements, matches them with resume evidence, and brings
                supporting excerpts into view. Recruiters review the context and make the final
                decision.
              </Paragraph>
              <div className="landing-hero-actions">
                <Link className="landing-primary-cta" to={routes.signIn}>
                  {hasDemoAccount ? 'Try the demo' : 'Sign in'} <ArrowRightOutlined />
                </Link>
                <a className="landing-secondary-cta" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <div className="landing-proof-points" aria-label="How RecruitAI helps">
                <span>
                  <CheckCircleFilled /> AI-assisted matching
                </span>
                <span>
                  <CheckCircleFilled /> Evidence visible
                </span>
                <span>
                  <CheckCircleFilled /> Recruiter decides
                </span>
              </div>
            </div>

            <div
              className="landing-preview-wrap"
              role="group"
              aria-label="Example screening preview"
            >
              <div className="landing-preview-glow" />
              <svg
                className="landing-network-art"
                viewBox="0 0 620 470"
                fill="none"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  className="landing-network-path"
                  d="M0 138 78 83l67 29 71-80 70 36 74-40 70 52 76-56 114 70"
                />
                <path
                  className="landing-network-path landing-network-path-secondary"
                  d="m0 360 82-48 76 106 80-74 78 98 81-80 89 68 134-80"
                />
                <path
                  className="landing-network-path landing-network-path-secondary"
                  d="m12 140-12 220m216-308 22 292m268-348-20 406"
                />
                <g className="landing-network-nodes">
                  <circle cx="0" cy="138" r="4" />
                  <circle cx="78" cy="83" r="5" />
                  <circle cx="145" cy="112" r="4" />
                  <circle cx="216" cy="32" r="5" />
                  <circle cx="286" cy="68" r="4" />
                  <circle cx="360" cy="28" r="5" />
                  <circle cx="430" cy="80" r="4" />
                  <circle cx="506" cy="24" r="5" />
                  <circle cx="620" cy="94" r="4" />
                  <circle cx="0" cy="360" r="4" />
                  <circle cx="82" cy="312" r="5" />
                  <circle cx="158" cy="418" r="4" />
                  <circle cx="238" cy="344" r="5" />
                  <circle cx="316" cy="442" r="4" />
                  <circle cx="397" cy="362" r="5" />
                  <circle cx="486" cy="430" r="4" />
                  <circle cx="620" cy="350" r="4" />
                </g>
              </svg>
              <div className="landing-preview-card">
                <div className="landing-preview-heading">
                  <div>
                    <Text className="landing-preview-kicker">SCREENING OVERVIEW</Text>
                    <Title level={4}>Senior product designer</Title>
                    <Text type="secondary">Example review workspace</Text>
                  </div>
                  <span className="landing-preview-status">
                    <span /> In review
                  </span>
                </div>

                <div
                  className="landing-preview-switcher"
                  role="group"
                  aria-label="Example preview"
                >
                  <button
                    type="button"
                    aria-pressed={previewMode === 'overview'}
                    onClick={() => setPreviewMode('overview')}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    aria-pressed={previewMode === 'evidence'}
                    onClick={() => setPreviewMode('evidence')}
                  >
                    Candidate evidence
                  </button>
                </div>

                <div className="landing-preview-panel" key={previewMode}>
                  {previewMode === 'overview' ? (
                    <>
                      <div className="landing-preview-summary">
                        <div>
                          <strong>12</strong>
                          <span>resumes added</span>
                        </div>
                        <div>
                          <strong>4</strong>
                          <span>need review</span>
                        </div>
                        <div>
                          <strong>3</strong>
                          <span>role criteria</span>
                        </div>
                      </div>

                      <div className="landing-preview-list-heading">
                        <Text strong>Requirement evidence</Text>
                        <Text type="secondary">Example</Text>
                      </div>
                      <div className="landing-evidence-row">
                        <span className="landing-evidence-icon">
                          <CheckCircleFilled />
                        </span>
                        <div>
                          <Text strong>Product strategy</Text>
                          <Text type="secondary">Evidence excerpt available</Text>
                        </div>
                        <span className="landing-evidence-tag">Supported</span>
                      </div>
                      <div className="landing-evidence-row">
                        <span className="landing-evidence-icon landing-evidence-icon-review">
                          <FileSearchOutlined />
                        </span>
                        <div>
                          <Text strong>Team leadership</Text>
                          <Text type="secondary">Recruiter review suggested</Text>
                        </div>
                        <span className="landing-evidence-tag landing-evidence-tag-review">
                          Review
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="landing-candidate-heading">
                        <span className="landing-candidate-avatar">01</span>
                        <span className="landing-candidate-copy">
                          <Text className="landing-preview-kicker">EXAMPLE CANDIDATE</Text>
                          <Text strong>Product designer</Text>
                        </span>
                        <span className="landing-candidate-status">
                          <FileSearchOutlined /> Review suggested
                        </span>
                      </div>
                      <div className="landing-evidence-quote">
                        <Text className="landing-preview-kicker">PRODUCT STRATEGY</Text>
                        <blockquote>
                          Led product discovery for a multi-team redesign and partnered with
                          engineering to ship a new onboarding flow.
                        </blockquote>
                        <Text type="secondary">Resume excerpt - Example text</Text>
                      </div>
                      <div className="landing-evidence-guidance">
                        <SafetyCertificateOutlined />
                        <span>Compare the excerpt with the full resume and role criteria.</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="landing-preview-note">
                  <SafetyCertificateOutlined />
                  <span>Signals support review. They do not make hiring decisions.</span>
                </div>
              </div>
              <div className="landing-floating-note">
                <span className="landing-floating-note-icon">
                  <TeamOutlined />
                </span>
                <span>
                  <strong>Team led</strong>
                  <small>Recruiters make the call</small>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="landing-section landing-how" aria-labelledby="how-title">
          <div className="landing-section-heading">
            <Text className="landing-eyebrow">A SIMPLE WORKFLOW</Text>
            <Title id="how-title" level={2}>
              From job description to informed review
            </Title>
            <Paragraph>
              Keep role criteria, candidate documents, and reviewer context together in one place.
            </Paragraph>
          </div>
          <div className="landing-step-grid">
            {steps.map((step) => (
              <article className="landing-step-card" key={step.number}>
                <div className="landing-step-topline">
                  <span className="landing-step-icon">{step.icon}</span>
                  <span className="landing-step-number">{step.number}</span>
                </div>
                <Title level={4}>{step.title}</Title>
                <Paragraph>{step.description}</Paragraph>
              </article>
            ))}
          </div>
        </section>

        <section
          id="review-principles"
          className="landing-principles"
          aria-labelledby="principles-title"
        >
          <div className="landing-principles-inner">
            <div className="landing-principles-copy">
              <Text className="landing-eyebrow">AI-ASSISTED. EVIDENCE-LED.</Text>
              <Title id="principles-title" level={2}>
                Keep the reasoning close to the resume.
              </Title>
              <Paragraph>
                RecruitAI extracts job requirements, compares them with resume experience, and
                surfaces relevant excerpts for a closer look. Your team reviews the context and
                makes the decision.
              </Paragraph>
              <ul className="landing-principles-list">
                {reviewPrinciples.map((principle) => (
                  <li key={principle}>
                    <CheckCircleFilled />
                    <span>{principle}</span>
                  </li>
                ))}
              </ul>
              <Paragraph className="landing-workspace-note">
                Screenings are scoped to the selected company workspace. Follow your company
                policies when handling candidate documents.
              </Paragraph>
            </div>

            <div
              className="landing-ai-evidence-card"
              role="group"
              aria-label="Example AI matching role criteria to resume evidence"
            >
              <div className="landing-ai-card-heading">
                <span className="landing-ai-icon">
                  <RobotOutlined />
                </span>
                <span>
                  <Text className="landing-preview-kicker">AI MATCHING PREVIEW</Text>
                  <strong>Role criteria to resume evidence</strong>
                </span>
                <span className="landing-ai-example-badge">Example</span>
              </div>

              <div className="landing-ai-criterion">
                <span className="landing-ai-label">ROLE CRITERION</span>
                <strong>Product strategy</strong>
                <CheckCircleFilled />
              </div>
              <div className="landing-ai-connector" aria-hidden="true">
                <span />
              </div>
              <div className="landing-ai-evidence">
                <div className="landing-ai-evidence-heading">
                  <span>
                    <FileSearchOutlined /> Resume excerpt
                  </span>
                  <Text type="secondary">Example</Text>
                </div>
                <blockquote>
                  Led product discovery for a multi-team redesign and partnered with engineering to
                  ship a new onboarding flow.
                </blockquote>
                <span className="landing-ai-evidence-match">
                  <CheckCircleFilled /> Relevant evidence surfaced
                </span>
              </div>

              <div className="landing-ai-human-note">
                <SafetyCertificateOutlined />
                <span>AI surfaces evidence. Recruiters make the call.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-final-cta" aria-labelledby="final-cta-title">
          <div>
            <Text className="landing-eyebrow">START WITH ONE ROLE</Text>
            <Title id="final-cta-title" level={2}>
              Make your next candidate review easier to follow.
            </Title>
          </div>
          <Link className="landing-primary-cta" to={routes.register}>
            Create your workspace <ArrowRightOutlined />
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-main">
            <div className="landing-footer-brand-block">
              <Link className="brand landing-brand" to={routes.publicHome}>
                <span className="brand-mark">R</span>
                <span>
                  Recruit<span className="brand-accent">AI</span>
                </span>
              </Link>
              <p className="landing-footer-tagline">
                Make every candidate review easier to understand and discuss.
              </p>
              <div className="landing-footer-principle">
                <SafetyCertificateOutlined />
                <span>AI-assisted review. Human-led decisions.</span>
              </div>
            </div>

            <nav className="landing-footer-nav" aria-label="Footer navigation">
              <div className="landing-footer-nav-group">
                <Text className="landing-footer-label">Explore</Text>
                <a href="#how-it-works">How it works</a>
                <a href="#review-principles">Our approach</a>
              </div>
              <div className="landing-footer-nav-group">
                <Text className="landing-footer-label">Your account</Text>
                <Link to={routes.signIn}>Sign in</Link>
                <Link to={routes.register}>Create account</Link>
              </div>
            </nav>

            <div className="landing-footer-cta-card">
              <Text className="landing-footer-label">START WITH ONE ROLE</Text>
              <strong>Bring your next review into focus.</strong>
              <Link className="landing-footer-action" to={routes.register}>
                Create your workspace <ArrowRightOutlined />
              </Link>
            </div>
          </div>

          <div className="landing-footer-bottom">
            <span>Copyright {new Date().getFullYear()} RecruitAI</span>
            <a className="landing-footer-top-link" href="#landing-title">
              Back to top <ArrowUpOutlined />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
