import React from 'react';

interface LoadingScreenProps {
  message?: string;
}

const SHIELD_LETTER_STYLE: React.CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontWeight: 700,
  fontSize: '46px',
  fill: '#1e3a8a',
};

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Loading your workspace...',
}) => {
  return (
    <div className="km-loader" role="status" aria-live="polite" aria-label={message}>
      {/* Layered mineral strata background along the bottom */}
      <div className="km-loader-strata" aria-hidden="true">
        <svg
          viewBox="0 0 1440 360"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            className="km-wave w1"
            d="M0 150 C240 95, 480 215, 740 155 C1000 95, 1220 185, 1440 135 L1440 360 L0 360 Z"
            fill="rgba(42, 95, 176, 0.38)"
          />
          <path
            className="km-wave w2"
            d="M0 210 C260 165, 520 260, 780 205 C1040 150, 1240 235, 1440 190 L1440 360 L0 360 Z"
            fill="rgba(26, 70, 136, 0.55)"
          />
          <path
            className="km-wave w3"
            d="M0 268 C280 235, 540 305, 820 265 C1080 225, 1260 288, 1440 255 L1440 360 L0 360 Z"
            fill="rgba(12, 37, 82, 0.72)"
          />
          <path
            className="km-vein-line"
            d="M-20 218 C250 172, 515 268, 780 212 C1045 156, 1245 242, 1460 196"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            className="km-vein-line v2"
            d="M-20 232 C250 188, 515 282, 780 226 C1045 170, 1245 256, 1460 210"
            fill="none"
            stroke="rgba(251, 191, 36, 0.42)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Main centered splash stage */}
      <div className="km-loader-stage">
        <div className="km-loader-emblem" aria-hidden="true">
          <div className="km-loader-aura" />

          {/* Orbital animated rings */}
          <svg className="km-loader-orbit" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="kmOrbitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="1" />
                <stop offset="55%" stopColor="#fde68a" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <circle
              cx="90"
              cy="90"
              r="84"
              fill="none"
              stroke="rgba(255, 255, 255, 0.14)"
              strokeWidth="1.5"
            />
            <circle
              className="km-orbit-arc"
              cx="90"
              cy="90"
              r="84"
              fill="none"
              stroke="url(#kmOrbitGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="138 390"
            />
            <circle
              className="km-orbit-inner"
              cx="90"
              cy="90"
              r="72"
              fill="none"
              stroke="rgba(255, 255, 255, 0.16)"
              strokeWidth="1"
              strokeDasharray="4 10"
            />
          </svg>

          {/* Animated KMPL Shield Mark */}
          <svg
            className="km-loader-shield-svg"
            viewBox="0 0 400 370"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="kmLoadRim" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#475569" />
              </linearGradient>
              <linearGradient id="kmLoadSurface" x1="15%" y1="5%" x2="85%" y2="95%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#e4e2dc" />
              </linearGradient>
              <linearGradient id="kmLoadGold" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#b45309" />
              </linearGradient>
              <clipPath id="kmLoadInnerClip">
                <polygon points="200,46 316,258 84,258" />
              </clipPath>
              <clipPath id="kmLoadShClip">
                <path d="M 200 22 L 365 323 Q 377 346 351 346 L 49 346 Q 23 346 35 323 Z" />
              </clipPath>
              <linearGradient id="kmLoadSheen" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fbbf24" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fbbf24" stopOpacity="0.65" />
                <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
              </linearGradient>
            </defs>

            <g className="km-load-shield">
              <path
                d="M 200 14 L 372 325 Q 387 354 354 354 L 46 354 Q 13 354 28 325 Z"
                fill="url(#kmLoadRim)"
              />
              <path
                d="M 200 22 L 365 323 Q 377 346 351 346 L 49 346 Q 23 346 35 323 Z"
                fill="url(#kmLoadSurface)"
              />
            </g>

            <g clipPath="url(#kmLoadInnerClip)">
              <polygon points="200,46 316,258 84,258" fill="url(#kmLoadSurface)" />
              <path
                d="M 155 127 L 84 258 L 106 258 L 154 202 L 200 248 L 246 202 L 294 258 L 316 258 L 245 127 L 223 149 L 200 126 L 177 149 Z"
                fill="#0f172a"
              />
              <polygon className="km-load-dia d1" points="200,66 212,78 200,90 188,78" fill="url(#kmLoadGold)" />
              <polygon className="km-load-dia d2" points="181,85 193,97 181,109 169,97" fill="url(#kmLoadGold)" />
              <polygon className="km-load-dia d3" points="219,85 231,97 219,109 207,97" fill="url(#kmLoadGold)" />
              <polygon className="km-load-dia d4" points="200,104 212,116 200,128 188,116" fill="url(#kmLoadGold)" />
              <polygon className="km-load-dia d5" points="154,142 173,161 154,180 135,161" fill="url(#kmLoadGold)" />
              <polygon className="km-load-dia d6" points="246,142 265,161 246,180 227,161" fill="url(#kmLoadGold)" />
            </g>

            <line x1="82" y1="260" x2="318" y2="260" stroke="#0f172a" strokeWidth="3.2" />

            <g textAnchor="middle">
              <text x="98" y="317" style={SHIELD_LETTER_STYLE}>K</text>
              <text x="166" y="317" style={SHIELD_LETTER_STYLE}>M</text>
              <text x="236" y="317" style={SHIELD_LETTER_STYLE}>P</text>
              <text x="302" y="317" style={SHIELD_LETTER_STYLE}>L</text>
            </g>

            <path
              className="km-load-runner"
              pathLength={1}
              d="M 200 14 L 372 325 Q 387 354 354 354 L 46 354 Q 13 354 28 325 Z"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="4.5"
              strokeLinecap="round"
            />

            <g clipPath="url(#kmLoadShClip)">
              <rect
                className="km-load-sheen"
                x="0"
                y="0"
                width="95"
                height="400"
                fill="url(#kmLoadSheen)"
              />
            </g>
          </svg>
        </div>

        <div className="km-loader-brand">
          <h1 className="km-loader-title">
            KEJMIN <span>OPS</span>
          </h1>
          <div className="km-loader-org">KEJ Minerals Private Limited</div>
        </div>

        <div className="km-loader-progress-wrap">
          <div className="km-loader-track" aria-hidden="true">
            <div className="km-loader-bar" />
          </div>
          <div className="km-loader-msg">{message}</div>
        </div>
      </div>
    </div>
  );
};
