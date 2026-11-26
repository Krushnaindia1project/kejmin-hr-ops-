import React from 'react';

export const StrataArt: React.FC = () => (
  <div className="art" aria-hidden="true">
    <svg
      viewBox="0 0 800 400"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        className="b"
        style={{ ['--i' as string]: 0 }}
        d="M0 170C130 140 270 205 410 172S680 138 800 168V400H0Z"
        fill="#2a5fb0"
      />
      <path
        className="b"
        style={{ ['--i' as string]: 1 }}
        d="M0 225C140 195 290 255 430 224S690 192 800 222V400H0Z"
        fill="#21539d"
      />
      <path
        className="b"
        style={{ ['--i' as string]: 2 }}
        d="M0 275C150 250 300 305 450 277S700 248 800 274V400H0Z"
        fill="#1a4688"
      />
      <path
        className="b"
        style={{ ['--i' as string]: 3 }}
        d="M0 325C160 305 310 350 460 328S710 305 800 326V400H0Z"
        fill="#143a74"
      />
      <path
        className="vein"
        d="M-10 238C130 208 280 268 430 236S690 204 810 232"
        fill="none"
        stroke="#ffa94d"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        className="vein v2"
        d="M-10 252C140 224 290 282 440 250S700 220 810 246"
        fill="none"
        stroke="#ffa94d"
        strokeOpacity=".5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  </div>
);
