import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ClipboardList,
  Database,
  FileBarChart2,
  FlaskConical,
  LineChart,
  LockKeyhole,
  Menu,
  ShieldCheck,
  Sigma,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import { pageMeta } from "@/lib/meta";
import "../styles/public-home.css";

export const Route = createFileRoute("/")({
  head: () =>
    pageMeta(
      "Make better decisions with your data",
      "Prepare, analyse, understand and report your data in one dependable analytical workspace.",
    ),
  component: PublicHome,
});

const capabilities = [
  {
    icon: Table2,
    title: "Prepare with confidence",
    description:
      "Inspect missing values, clean columns and keep a clear record of transformations.",
  },
  {
    icon: BarChart3,
    title: "Describe your data",
    description:
      "Summarise distributions with transparent descriptive statistics and visual checks.",
  },
  {
    icon: Sigma,
    title: "Test a question",
    description: "Run established statistical tests with their assumptions and parameters in view.",
  },
  {
    icon: LineChart,
    title: "Explore relationships",
    description:
      "Examine correlations and regression results without losing sight of the evidence.",
  },
  {
    icon: FlaskConical,
    title: "Understand results",
    description: "Translate numerical output into careful, contextual interpretation.",
  },
  {
    icon: FileBarChart2,
    title: "Report your work",
    description: "Bring methods, results and charts together in a report you can revisit.",
  },
];

const useCases = [
  ["Research & Academia", "Reproducible workflows for coursework, theses and research."],
  ["Students", "Build confidence with clear steps from dataset to result."],
  ["Data Analysts", "Explore, validate and communicate findings with transparent methods."],
  ["Software Engineering", "Understand service metrics, experiments and product telemetry."],
  ["Economics & Finance", "Explore trends, distributions and relationships in economic data."],
  ["Business Analytics", "Turn operational and customer data into clearer decisions."],
  ["Clinical Research", "Review study data with explicit methods and careful interpretation."],
];

function ProductPreview() {
  return (
    <div
      className="home-preview"
      aria-label="Preview of the Lumetra analytical workspace"
      role="img"
    >
      <div className="preview-topbar">
        <div className="preview-brand">
          <img src="/brand/lumetra-logo.png" alt="" />
        </div>
        <span className="preview-project">Customer study · Spring cohort</span>
        <span className="preview-save">
          <Check size={13} aria-hidden="true" /> All changes saved
        </span>
      </div>
      <div className="preview-layout">
        <aside className="preview-sidebar" aria-hidden="true">
          <span className="preview-sidebar-label">WORKSPACE</span>
          <span className="preview-nav active">
            <Table2 size={14} /> Data
          </span>
          <span className="preview-nav">
            <LineChart size={14} /> Analyses
          </span>
          <span className="preview-nav">
            <FileBarChart2 size={14} /> Reports
          </span>
          <div className="preview-file">
            <Database size={14} />
            <span>survey_responses.csv</span>
          </div>
        </aside>
        <div className="preview-content">
          <div className="preview-heading">
            <div>
              <span className="preview-kicker">DATASET OVERVIEW</span>
              <h3>Survey responses</h3>
            </div>
            <span className="preview-tag">Version 4</span>
          </div>
          <div className="preview-stats">
            <div>
              <span>Observations</span>
              <strong>1,248</strong>
            </div>
            <div>
              <span>Variables</span>
              <strong>12</strong>
            </div>
            <div>
              <span>Missing values</span>
              <strong>2.4%</strong>
            </div>
          </div>
          <div className="preview-chart-panel">
            <div className="preview-chart-title">
              <div>
                <strong>Weekly satisfaction</strong>
                <span>Mean score · 95% CI</span>
              </div>
              <span className="preview-chart-legend">
                <i /> Satisfaction
              </span>
            </div>
            <svg viewBox="0 0 640 170" preserveAspectRatio="none" aria-hidden="true">
              <path className="chart-grid" d="M0 25H640 M0 65H640 M0 105H640 M0 145H640" />
              <path
                className="chart-area"
                d="M0 129 C50 120 52 98 105 107 S175 83 215 91 S284 73 325 80 S390 55 430 68 S490 44 535 57 S596 35 640 39 V170 H0Z"
              />
              <path
                className="chart-line"
                d="M0 129 C50 120 52 98 105 107 S175 83 215 91 S284 73 325 80 S390 55 430 68 S490 44 535 57 S596 35 640 39"
              />
              <circle cx="430" cy="68" r="4" />
              <circle cx="535" cy="57" r="4" />
            </svg>
            <div className="preview-axis">
              <span>Week 1</span>
              <span>Week 3</span>
              <span>Week 5</span>
              <span>Week 7</span>
              <span>Week 9</span>
            </div>
          </div>
          <div className="preview-result">
            <span className="result-icon">
              <Sigma size={15} />
            </span>
            <div>
              <strong>Correlation analysis</strong>
              <span>r = 0.68&nbsp; · &nbsp;p &lt; .001&nbsp; · &nbsp;n = 1,216</span>
            </div>
            <span className="result-complete">
              <Check size={13} /> Complete
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublicHome() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="public-home">
      <header className="home-header">
        <div className="home-header-inner">
          <Link className="home-logo" to="/" aria-label="Lumetra home">
            <img src="/brand/lumetra-logo.png" alt="" />
          </Link>
          <button
            type="button"
            className="home-menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <nav className={`home-nav ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation">
            <a href="#product" onClick={() => setMenuOpen(false)}>
              Product
            </a>
            <a href="#features" onClick={() => setMenuOpen(false)}>
              Features
            </a>
            <a href="#use-cases" onClick={() => setMenuOpen(false)}>
              Use cases
            </a>
            <a href="#why-lumetra" onClick={() => setMenuOpen(false)}>
              Resources
            </a>
            <Link className="home-signin" to="/login">
              Sign in
            </Link>
            <Link className="home-nav-cta" to="/signup">
              Get started <ArrowRight size={15} />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="home-hero" id="product">
          <div className="home-hero-copy">
            <span className="home-overline">
              <span /> A thoughtful workspace for real data
            </span>
            <h1>
              Make better decisions
              <br />
              with your data.
            </h1>
            <p>
              Prepare, analyse, understand and report your data in one clear workspace. Built for
              careful work, from the first import to the final finding.
            </p>
            <div className="home-hero-actions">
              <Link className="home-button primary" to="/signup">
                Start analysing <ArrowRight size={16} />
              </Link>
              <a className="home-button secondary" href="#features">
                Explore features
              </a>
            </div>
            <div className="home-hero-note">
              <ShieldCheck size={15} /> Your analysis runs in your browser.
            </div>
          </div>
          <ProductPreview />
        </section>

        <section className="home-section home-capabilities" id="features">
          <div className="home-section-heading">
            <span className="home-eyebrow">A complete analytical workflow</span>
            <h2>From raw data to a result you can explain.</h2>
            <p>
              Keep the important details close: what you changed, what you tested and what the
              results mean.
            </p>
          </div>
          <div className="capability-grid">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <article className="capability-item" key={title}>
                <span className="capability-icon">
                  <Icon size={19} strokeWidth={1.8} />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-usecases" id="use-cases">
          <div className="home-section home-usecases-inner">
            <div className="home-section-heading">
              <span className="home-eyebrow">Made for people who work with data</span>
              <h2>
                One considered toolkit.
                <br />
                Many kinds of questions.
              </h2>
              <p>
                Use established methods and inspectable results in the context of your own work.
              </p>
            </div>
            <div className="usecase-list">
              {useCases.map(([title, description], index) => (
                <article key={title} className="usecase-row">
                  <span className="usecase-index">0{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <ArrowRight size={17} aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-workflow" id="workflow">
          <div className="home-section-heading">
            <span className="home-eyebrow">A clear path through the work</span>
            <h2>Good analysis is a process.</h2>
          </div>
          <ol className="workflow-steps">
            {[
              ["Import", "Bring in a CSV and inspect its structure."],
              ["Prepare", "Review and transform your data deliberately."],
              ["Analyse", "Choose a suitable method and set its parameters."],
              ["Interpret", "Read the numerical result and its context."],
              ["Report", "Share a clear account of your approach and findings."],
            ].map(([title, description], index) => (
              <li key={title}>
                <span className="workflow-number">0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
                {index < 4 && (
                  <ArrowRight className="workflow-arrow" size={16} aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="home-why" id="why-lumetra">
          <div className="home-why-inner">
            <div className="home-section-heading">
              <span className="home-eyebrow">Why Lumetra</span>
              <h2>Analysis you can follow and revisit.</h2>
              <p>
                A useful result is one you can understand, check and return to when the next
                question comes up.
              </p>
            </div>
            <div className="why-principles">
              <article>
                <span>01</span>
                <h3>Transparent methods</h3>
                <p>See the method, assumptions and parameters behind your results.</p>
              </article>
              <article>
                <span>02</span>
                <h3>Reproducible work</h3>
                <p>Keep datasets, transformations and saved analyses connected.</p>
              </article>
              <article>
                <span>03</span>
                <h3>Thoughtful data handling</h3>
                <p>Calculations run in your browser, with account access for saved work.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="home-privacy">
          <div className="home-privacy-inner">
            <div className="privacy-symbol">
              <LockKeyhole size={23} strokeWidth={1.7} />
            </div>
            <div className="privacy-copy">
              <span className="home-eyebrow">Built with care for your work</span>
              <h2>Your data stays yours.</h2>
              <p>
                Lumetra parses datasets and calculates statistical results in your browser. When you
                sign in, your projects are saved to your account so you can continue on another
                device. Access is protected by account-level security; don’t upload data unless your
                organisation permits its use in an online service.
              </p>
              <div className="privacy-points">
                <span>
                  <Check size={15} /> Calculations run locally
                </span>
                <span>
                  <Check size={15} /> Account-scoped project access
                </span>
                <span>
                  <Check size={15} /> Offline work is retained on this device
                </span>
              </div>
            </div>
            <BookOpen
              className="privacy-decoration"
              size={100}
              strokeWidth={0.75}
              aria-hidden="true"
            />
          </div>
        </section>

        <section className="home-final-cta">
          <ClipboardList size={23} strokeWidth={1.6} aria-hidden="true" />
          <h2>
            Start with a question.
            <br />
            Leave with a clearer answer.
          </h2>
          <p>Bring your data into a workspace designed to make every step easier to follow.</p>
          <Link className="home-button primary" to="/signup">
            Get started with Lumetra <ArrowRight size={16} />
          </Link>
        </section>
      </main>

      <footer className="home-footer">
        <Link className="home-logo" to="/">
          <img src="/brand/lumetra-logo.png" alt="" />
        </Link>
        <span>Analytical work, made clearer.</span>
        <div>
          <a href="#features">Features</a>
          <a href="#why-lumetra">Why Lumetra</a>
          <Link to="/login">Sign in</Link>
          <Link to="/signup">Get started</Link>
        </div>
        <small>© {new Date().getFullYear()} Lumetra</small>
      </footer>
    </div>
  );
}
