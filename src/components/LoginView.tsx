import React, { useRef, useState } from 'react';
import { KmplLogo } from './KmplLogo';
import { StrataArt } from './StrataArt';

interface LoginViewProps {
  signedOutMessage: boolean;
  busy: boolean;
  onSignIn: (empId: string, password: string) => Promise<string | null>;
  onGoogleQuickSignIn: () => Promise<string | null>;
}

export const LoginView: React.FC<LoginViewProps> = ({
  signedOutMessage,
  busy,
  onSignIn,
  onGoogleQuickSignIn,
}) => {
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [hideBye, setHideBye] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);

  const shakeCard = () => {
    cardRef.current?.animate(
      [
        { transform: 'translateX(-8px)' },
        { transform: 'translateX(8px)' },
        { transform: 'none' },
      ],
      { duration: 250 }
    );
  };

  const handleSignIn = async () => {
    setErr('');
    setHideBye(true);
    const errorMsg = await onSignIn(empId, password);
    if (errorMsg) {
      setErr(errorMsg);
      shakeCard();
    }
  };

  const handleGoogleSignIn = async () => {
    setErr('');
    setHideBye(true);
    const errorMsg = await onGoogleQuickSignIn();
    if (errorMsg) {
      setErr(errorMsg);
      shakeCard();
    }
  };

  return (
    <section
      id="login"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !busy) {
          handleSignIn();
        }
      }}
    >
      <div className="lw">
        <div className="lb2">
          <KmplLogo />
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <b style={{ fontSize: 18, letterSpacing: '.5px' }}>KEJMIN OPS</b>
            <div style={{ opacity: 0.8, fontSize: 13 }}>KEJ Minerals Private Limited</div>
          </div>
          <div className="lhd">
            <h2>From plant floor to final sign-off</h2>
            <p>
              Tasks, approvals, attendance and scores for the Bengaluru office, Plant 1 and
              Plant 2, kept in one place.
            </p>
          </div>
          <StrataArt />
        </div>

        <div className="lc glass" ref={cardRef}>
          <div className="logo">
            <div className="lg">KM</div>
            <div>
              <h1>
                KEJMIN <b>OPS</b>
              </h1>
            </div>
          </div>

          {signedOutMessage && !hideBye && (
            <div id="bye" style={{ display: 'block' }}>
              You’ve been signed out securely. See you soon!
            </div>
          )}

          <div id="lerr">{err && <div className="er">{err}</div>}</div>

          <div id="fs">
            <label htmlFor="em">User ID</label>
            <input
              id="em"
              placeholder="Enter your user ID"
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              autoComplete="username"
            />
            <label htmlFor="pw">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="pw"
                type={showPw ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <span className="eye" id="eye" onClick={() => setShowPw((v) => !v)}>
                {showPw ? 'Hide' : 'Show'}
              </span>
            </div>

            <button
              className="btn full"
              id="go"
              type="button"
              style={{ marginTop: 16 }}
              disabled={busy}
              onClick={handleSignIn}
            >
              {busy ? 'Signing in...' : 'Sign in'}
            </button>

            <button
              className="btn g full"
              type="button"
              style={{ marginTop: 10 }}
              disabled={busy}
              onClick={handleGoogleSignIn}
            >
              Continue with Google (Firebase Auth)
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
