import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { isSupabaseConfigured } from "@/integrations/supabase/client";
import "../styles/auth-page.css";

type AuthPageProps = { mode: "login" | "signup" };

function ProductIllustration() {
  return (
    <aside className="auth-visual" aria-label="Lumetra analytical workspace preview">
      <Link to="/" className="auth-visual-back">
        <ArrowLeft size={15} /> Back to Lumetra
      </Link>
      <div className="auth-visual-content">
        <span className="auth-visual-kicker">A clearer way to work with data</span>
        <h2>
          Bring your analysis
          <br />
          into focus.
        </h2>
        <p>Prepare, analyse and report from one dependable workspace.</p>
        <div className="auth-mini-dashboard">
          <div className="auth-mini-title">
            <div>
              <span>PROJECT OVERVIEW</span>
              <strong>Spring field study</strong>
            </div>
            <span className="auth-mini-status">
              <i /> Saved
            </span>
          </div>
          <div className="auth-mini-metrics">
            <div>
              <span>Observations</span>
              <strong>1,248</strong>
            </div>
            <div>
              <span>Variables</span>
              <strong>12</strong>
            </div>
          </div>
          <div className="auth-mini-chart">
            <div>
              <strong>Response trend</strong>
              <span>Mean score by week</span>
            </div>
            <svg viewBox="0 0 420 125" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 22H420M0 62H420M0 102H420" />
              <path d="M0 95C35 91 45 68 78 76S130 59 164 65 211 44 245 54 286 36 320 45 367 25 420 29" />
              <circle cx="320" cy="45" r="3" />
              <circle cx="420" cy="29" r="3" />
            </svg>
          </div>
          <div className="auth-mini-analysis">
            <span>
              <Check size={14} />
            </span>
            <div>
              <strong>Correlation analysis</strong>
              <small>r = 0.68 · p &lt; .001</small>
            </div>
          </div>
        </div>
        <div className="auth-visual-promise">
          <ShieldCheck size={16} /> Calculations run in your browser
        </div>
      </div>
    </aside>
  );
}

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate();
  const { login, register, resetPassword } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const title = isReset
    ? "Reset your password"
    : mode === "signup"
      ? "Create your account"
      : "Welcome back";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!isSupabaseConfigured()) {
      setError("Account sign-in is not available right now. Please try again later.");
      return;
    }

    setLoading(true);
    try {
      if (isReset) {
        const result = await resetPassword(email);
        if (result.success) {
          setNotice("If an account exists for that email, a password reset link is on its way.");
        } else {
          setError("We couldn't send a reset link. Check the email address and try again.");
        }
      } else if (mode === "signup") {
        const result = await register(email, password, name, "scientist");
        if (result.error) {
          setError("We couldn't create your account. Check your details and try again.");
        } else if (result.emailConfirmationRequired) {
          setNotice("Check your inbox for a verification link to finish creating your account.");
        } else if (result.user) {
          await navigate({ to: "/app" });
        }
      } else {
        const result = await login(email, password);
        if (result.error || !result.user) {
          setError("Those sign-in details could not be verified. Check them and try again.");
        } else {
          await navigate({ to: "/app" });
        }
      }
    } catch {
      setError("Something went wrong while contacting the sign-in service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-form-side">
          <Link className="auth-logo" to="/" aria-label="Lumetra home">
            <span className="auth-logo-mark">L</span>
            Lumetra
          </Link>
          <div className="auth-form-wrap">
            <div className="auth-mobile-title">
              <span className="auth-eyebrow">YOUR ANALYTICAL WORKSPACE</span>
              <h1>{title}</h1>
              <p>
                {isReset
                  ? "We’ll email you a secure link to choose a new password."
                  : mode === "signup"
                    ? "Create an account to keep your work available across devices."
                    : "Sign in to pick up where you left off."}
              </p>
            </div>
            <form className="auth-form" onSubmit={onSubmit}>
              <div className="auth-desktop-title">
                <span className="auth-eyebrow">
                  {isReset
                    ? "ACCOUNT RECOVERY"
                    : mode === "signup"
                      ? "GET STARTED"
                      : "WELCOME BACK"}
                </span>
                <h1>{title}</h1>
                <p>
                  {isReset
                    ? "Enter the email address linked to your account."
                    : mode === "signup"
                      ? "A considered workspace for your analytical work."
                      : "Sign in to continue to your workspace."}
                </p>
              </div>

              {mode === "signup" && !isReset && (
                <div className="auth-field">
                  <Label htmlFor="auth-name">Name</Label>
                  <Input
                    id="auth-name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    placeholder="Your name"
                    className="auth-input"
                  />
                </div>
              )}
              <div className="auth-field">
                <Label htmlFor="auth-email">Email address</Label>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="auth-input"
                />
              </div>
              {!isReset && (
                <div className="auth-field">
                  <div className="auth-label-row">
                    <Label htmlFor="auth-password">Password</Label>
                    {mode === "login" && (
                      <button
                        className="auth-text-button"
                        type="button"
                        onClick={() => {
                          setIsReset(true);
                          setError("");
                          setNotice("");
                        }}
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="auth-password">
                    <Input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      placeholder={
                        mode === "signup" ? "At least 8 characters" : "Enter your password"
                      }
                      className="auth-input"
                    />
                    <button
                      type="button"
                      className="auth-password-toggle"
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p className="auth-message error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="auth-message success" role="status">
                  {notice}
                </p>
              )}

              <Button className="auth-submit" type="submit" disabled={loading}>
                {loading
                  ? "Please wait…"
                  : isReset
                    ? "Send reset link"
                    : mode === "signup"
                      ? "Create account"
                      : "Sign in"}
                {!loading && !isReset && <ArrowRight size={16} />}
              </Button>

              {isReset ? (
                <button
                  className="auth-back-link"
                  type="button"
                  onClick={() => {
                    setIsReset(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  <ArrowLeft size={14} /> Back to sign in
                </button>
              ) : (
                <p className="auth-switch">
                  {mode === "signup" ? "Already have an account?" : "New to Lumetra?"}{" "}
                  <Link to={mode === "signup" ? "/login" : "/signup"}>
                    {mode === "signup" ? "Sign in" : "Create an account"}
                  </Link>
                </p>
              )}

              {!isSupabaseConfigured() && (
                <p className="auth-unavailable" role="status">
                  Account access is temporarily unavailable. You can still explore Lumetra locally.
                </p>
              )}
              <p className="auth-privacy">
                <LockKeyhole size={13} /> Your account is protected with secure sign-in.
              </p>
            </form>
          </div>
        </div>
        <ProductIllustration />
      </section>
    </main>
  );
}
