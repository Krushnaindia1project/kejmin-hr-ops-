import React, { useState } from 'react';

const KMPL_LETTER_STYLE: React.CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontWeight: 700,
  fontSize: '46px',
  fill: '#1e3a8a',
};

export const KmplLogo: React.FC = () => {
  const [replayKey, setReplayKey] = useState(0);

  return (
    <div
      id="kl"
      onClick={() => setReplayKey((k) => k + 1)}
      title="KMPL – KEJ Minerals Private Limited"
    >
      <svg
        key={replayKey}
        className="kmpl-svg"
        viewBox="0 0 400 370"
        width="400"
        height="370"
        role="img"
        aria-label="KMPL – KEJ Minerals Private Limited"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="kmplRimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="50%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          <linearGradient id="kmplSurfaceGrad" x1="15%" y1="5%" x2="85%" y2="95%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e4e2dc" />
          </linearGradient>
          <linearGradient id="kmplGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
          <clipPath id="kmplInnerClip">
            <polygon points="200,46 316,258 84,258" />
          </clipPath>
          <clipPath id="kmplShClip">
            <path d="M 200 22 L 365 323 Q 377 346 351 346 L 49 346 Q 23 346 35 323 Z" />
          </clipPath>
          <linearGradient id="kmplShn" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fbbf24" stopOpacity="0" />
            <stop offset=".5" stopColor="#fbbf24" stopOpacity=".6" />
            <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="kmpl-shield">
          <path
            d="M 200 14 L 372 325 Q 387 354 354 354 L 46 354 Q 13 354 28 325 Z"
            fill="url(#kmplRimGrad)"
          />
          <path
            d="M 200 22 L 365 323 Q 377 346 351 346 L 49 346 Q 23 346 35 323 Z"
            fill="url(#kmplSurfaceGrad)"
          />
        </g>
        <g clipPath="url(#kmplInnerClip)">
          <polygon points="200,46 316,258 84,258" fill="url(#kmplSurfaceGrad)" />
          <path
            className="kmpl-roof-cutout"
            d="M 155 127 L 84 258 L 106 258 L 154 202 L 200 248 L 246 202 L 294 258 L 316 258 L 245 127 L 223 149 L 200 126 L 177 149 Z"
            fill="#0f172a"
          />
          <polygon className="kmpl-diamond d1" points="200,66 212,78 200,90 188,78" fill="url(#kmplGoldGrad)" />
          <polygon className="kmpl-diamond d2" points="181,85 193,97 181,109 169,97" fill="url(#kmplGoldGrad)" />
          <polygon className="kmpl-diamond d3" points="219,85 231,97 219,109 207,97" fill="url(#kmplGoldGrad)" />
          <polygon className="kmpl-diamond d4" points="200,104 212,116 200,128 188,116" fill="url(#kmplGoldGrad)" />
          <polygon className="kmpl-diamond d5" points="154,142 173,161 154,180 135,161" fill="url(#kmplGoldGrad)" />
          <polygon className="kmpl-diamond d6" points="246,142 265,161 246,180 227,161" fill="url(#kmplGoldGrad)" />
        </g>
        <line x1="82" y1="260" x2="318" y2="260" stroke="#0f172a" strokeWidth="3.2" />
        <g
          className="kmpl-text"
          fontFamily="Georgia,'Times New Roman',serif"
          fontWeight="700"
          fontSize="46"
          fill="#1e3a8a"
          textAnchor="middle"
        >
          <text x="98" y="317" style={KMPL_LETTER_STYLE}>K</text>
          <text x="166" y="317" style={KMPL_LETTER_STYLE}>M</text>
          <text x="236" y="317" style={KMPL_LETTER_STYLE}>P</text>
          <text x="302" y="317" style={KMPL_LETTER_STYLE}>L</text>
        </g>
        <path
          className="kl-run"
          pathLength={1}
          d="M 200 14 L 372 325 Q 387 354 354 354 L 46 354 Q 13 354 28 325 Z"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <g clipPath="url(#kmplShClip)">
          <rect className="kl-shine" x="0" y="0" width="90" height="400" fill="url(#kmplShn)" />
        </g>
        <path
          className="kl-sp"
          style={{ animationDelay: '1.6s' }}
          fill="#fbbf24"
          d="M 212 21 L 214.5 27.5 L 221 30 L 214.5 32.5 L 212 39 L 209.5 32.5 L 203 30 L 209.5 27.5 Z"
        />
        <path
          className="kl-sp"
          style={{ animationDelay: '2.4s' }}
          fill="#fbbf24"
          d="M 44 309 L 46.5 315.5 L 53 318 L 46.5 320.5 L 44 327 L 41.5 320.5 L 35 318 L 41.5 315.5 Z"
        />
        <path
          className="kl-sp"
          style={{ animationDelay: '3.1s' }}
          fill="#fbbf24"
          d="M 358 309 L 360.5 315.5 L 367 318 L 360.5 320.5 L 358 327 L 355.5 320.5 L 349 318 L 355.5 315.5 Z"
        />
      </svg>
    </div>
  );
};
