import React from "react";
import { createRoot } from "react-dom/client";
import Boomin from "@boomin/connect";
import "./styles.css";

const PUBLIC_KEY = import.meta.env.VITE_BOOMIN_PUBLIC_KEY || "pk_live_atlantium_creator_program";
const PROGRAM_ID = import.meta.env.VITE_BOOMIN_PROGRAM_ID || "e297fee5-84be-40d3-876f-51ec554bdf69";
const API_BASE = import.meta.env.VITE_BOOMIN_API_BASE || "https://api.boomin.ai/v1/connect";
const SESSION_STORAGE_KEY = `boomin_demo_session:${PUBLIC_KEY}`;
const CLEAN_REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;

Boomin.init({
  publicKey: PUBLIC_KEY,
  programId: PROGRAM_ID,
  apiBase: API_BASE,
  redirectUri: CLEAN_REDIRECT_URI,
});

function statusStep(status) {
  if (status === "pending_approval") return "pending";
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  return null;
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const referralCode = params.get("ref");
  const redirectResult = React.useMemo(() => Boomin.consumeRedirectResult(), []);
  const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY) || "";
  const initialSessionId = redirectResult?.sessionId || storedSessionId;
  const initialStep = statusStep(redirectResult?.status) || (initialSessionId ? "pending" : "details");

  const [step, setStep] = React.useState(initialStep);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [sessionId, setSessionId] = React.useState(initialSessionId);
  const [creator, setCreator] = React.useState(null);
  const [message, setMessage] = React.useState(() => {
    if (redirectResult?.error) return redirectResult.errorDetail || redirectResult.error;
    if (redirectResult?.status === "pending_approval") return "Instagram connected. You are pending approval.";
    if (redirectResult?.status === "approved") return "You are approved and active.";
    if (redirectResult?.status === "rejected") return "Your application was not approved.";
    return "";
  });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (sessionId) window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }, [sessionId]);

  React.useEffect(() => {
    let cancelled = false;
    async function restoreCreator() {
      try {
        const current = await Boomin.getCurrentCreator();
        if (cancelled) return;
        setCreator(current);
        const restoredStep = statusStep(current.status || current.member?.approval_status);
        if (restoredStep) setStep(restoredStep);
        if (!message && current.member?.instagram_username) {
          setMessage(`@${current.member.instagram_username} is connected.`);
        }
      } catch {
        // Anonymous visitors start at the details step.
      }
    }
    restoreCreator();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestOtp(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await Boomin.requestOtp({ email, name, referralCode, metadata: { demo: true } });
      setStep("otp");
      setMessage("Check your email for the verification code.");
    } catch (error) {
      setMessage(error.message || "Could not send code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await Boomin.verifyOtp({ email, name, code, referralCode, metadata: { demo: true } });
      setCreator(result);
      setStep("instagram");
      setMessage("Email verified. Connect Instagram to finish your application.");
    } catch (error) {
      setMessage(error.message || "Could not verify code.");
    } finally {
      setBusy(false);
    }
  }

  async function connectInstagram() {
    setBusy(true);
    setMessage("");
    try {
      const session = await Boomin.connectInstagram({
        referralCode,
        metadata: { demo: true },
        mode: "manual",
        requireCreator: true,
      });
      setSessionId(session.sessionId);
      window.location.assign(session.authUrl);
    } catch (error) {
      setStep("failed");
      setMessage(error.message || "Could not start Instagram OAuth.");
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!sessionId) return;
    setBusy(true);
    setMessage("");
    try {
      const status = await Boomin.getConnectStatus(sessionId);
      const nextStep = statusStep(status.status);
      if (nextStep) setStep(nextStep);
      setMessage(status.username ? `@${status.username}: ${status.status}` : `Current status: ${status.status}`);
    } catch (error) {
      setMessage(error.message || "Could not refresh status.");
    } finally {
      setBusy(false);
    }
  }

  function resetFlow() {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    Boomin.clearStoredToken?.();
    setSessionId("");
    setCreator(null);
    setStep("details");
    setMessage("");
    setCode("");
  }

  return (
    <main className="page">
      <section className="panel">
        <p className="eyebrow">Boomin Creator Connect</p>
        <h1>Account-first creator signup</h1>

        {step === "details" && (
          <form onSubmit={requestOtp} className="stack">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
            <button disabled={busy}>{busy ? "Sending..." : "Send code"}</button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={verifyOtp} className="stack">
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Verification code" inputMode="numeric" required />
            <button disabled={busy}>{busy ? "Verifying..." : "Verify email"}</button>
          </form>
        )}

        {step === "instagram" && (
          <div className="stack">
            <button disabled={busy} onClick={connectInstagram}>{busy ? "Opening Instagram..." : "Connect Instagram"}</button>
          </div>
        )}

        {step === "pending" && (
          <div className="stack">
            <strong>Pending approval</strong>
            <span>{creator?.member?.email || email || "Your creator profile"} is waiting for review.</span>
            <button disabled={busy || !sessionId} onClick={refreshStatus}>Refresh status</button>
          </div>
        )}

        {step === "approved" && (
          <div className="stack">
            <strong>Approved. You are active in the program.</strong>
            <button disabled={busy || !sessionId} onClick={refreshStatus}>Refresh status</button>
          </div>
        )}

        {step === "rejected" && (
          <div className="stack">
            <strong>Your application was not approved.</strong>
            <button onClick={resetFlow}>Start over</button>
          </div>
        )}

        {step === "failed" && (
          <div className="stack">
            <strong>Connection failed</strong>
            <button disabled={busy} onClick={sessionId ? refreshStatus : resetFlow}>{sessionId ? "Check status" : "Start over"}</button>
            <button disabled={busy} onClick={() => setStep("instagram")}>Try Instagram again</button>
          </div>
        )}

        {message && <p className="message">{message}</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
