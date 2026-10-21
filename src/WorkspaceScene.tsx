import { useState } from "react";
import { Pause, Play } from "lucide-react";

/** A self-contained vector scene: no third-party media or animation runtime. */
export function WorkspaceScene() {
  const [paused, setPaused] = useState(false);
  return (
    <div className={`lp-scene${paused ? " lp-scene-paused" : ""}`}>
      <svg
        className="lp-desk"
        viewBox="0 0 600 390"
        role="img"
        aria-labelledby="desk-title desk-description"
      >
        <title id="desk-title">A little space for your next chapter</title>
        <desc id="desk-description">
          An animated green desk with a job application board, a coffee, and a
          plant. Application cards gently move forward while steam rises from
          the cup.
        </desc>
        <defs>
          <pattern
            id="desk-grid"
            width="18"
            height="18"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#bccdb7" />
          </pattern>
          <clipPath id="desk-screen">
            <rect x="168" y="105" width="250" height="147" rx="6" />
          </clipPath>
        </defs>
        <path d="M61 307V155a150 150 0 0 1 300 0v152" fill="#e4ecd9" />
        <path
          d="M86 304V160a126 126 0 0 1 252 0v144"
          fill="url(#desk-grid)"
          opacity=".7"
        />
        <circle
          cx="466"
          cy="78"
          r="32"
          fill="#fafbf4"
          stroke="#cedcc4"
          strokeWidth="2"
        />
        <path
          d="M466 54v5m0 38v5m-24-24h5m38 0h5"
          stroke="#a7b99d"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M466 78v-14"
          stroke="#607f55"
          strokeWidth="3"
          strokeLinecap="round"
          className="lp-clock-hand"
        />
        <path
          d="m466 78 10 7"
          stroke="#173e34"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="466" cy="78" r="3" fill="#173e34" />
        <g className="lp-desk-spark">
          <path
            d="M115 70v14m-7-7h14m-12-5 10 10m0-10-10 10"
            stroke="#8ca576"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
        <g className="lp-desk-spark lp-desk-spark-two">
          <path
            d="M532 163v12m-6-6h12"
            stroke="#8ca576"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M288 264v37m-37 4h75"
          stroke="#497357"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <rect x="156" y="92" width="274" height="174" rx="13" fill="#204b3b" />
        <rect x="163" y="99" width="260" height="160" rx="9" fill="#fffef8" />
        <g clipPath="url(#desk-screen)">
          <rect x="168" y="105" width="250" height="24" fill="#f5f6ec" />
          <circle cx="179" cy="117" r="2" fill="#9bad8e" />
          <circle cx="187" cy="117" r="2" fill="#c6d0b6" />
          <circle cx="195" cy="117" r="2" fill="#d9dfcb" />
          <path
            d="M319 117h85"
            stroke="#e1e7d8"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect x="168" y="129" width="33" height="123" fill="#28513e" />
          <path
            d="M180 146c0-7 9-7 9-7s0 9-9 7m0 0 5-4"
            stroke="#bcd7ab"
            strokeWidth="1.5"
            fill="none"
          />
          <rect x="177" y="159" width="15" height="13" rx="3" fill="#48734f" />
          <path
            d="M180 163h3v4h-3zm5 0h3v4h-3zm-5 17h8m-8 8h8"
            stroke="#adc2a0"
            strokeWidth="1.4"
          />
          <rect x="213" y="140" width="79" height="6" rx="3" fill="#42674a" />
          <rect
            x="213"
            y="151"
            width="117"
            height="3"
            rx="1.5"
            fill="#d7dfcd"
          />
          <rect x="213" y="165" width="57" height="76" rx="4" fill="#f3f2e8" />
          <rect x="278" y="165" width="57" height="76" rx="4" fill="#edf2e9" />
          <rect x="343" y="165" width="62" height="76" rx="4" fill="#e6efdf" />
          <circle cx="220" cy="172" r="1.5" fill="#b89d6b" />
          <path
            d="M225 172h22"
            stroke="#b9b49a"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="285" cy="172" r="1.5" fill="#82a38b" />
          <path
            d="M290 172h22"
            stroke="#acc0a6"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="350" cy="172" r="1.5" fill="#6b955e" />
          <path
            d="M355 172h22"
            stroke="#9db28a"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <g className="lp-moving-application">
            <rect
              x="217"
              y="180"
              width="49"
              height="40"
              rx="4"
              fill="#fffefb"
              stroke="#d6dfcc"
            />
            <rect
              x="222"
              y="185"
              width="10"
              height="10"
              rx="3"
              fill="#d4e1c5"
            />
            <path
              d="M237 188h22m-22 5h16m-31 10h34m-34 5h19"
              stroke="#aebfa3"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="258" cy="212" r="3" fill="#b1ca9f" />
          </g>
          <g className="lp-application-static">
            <rect
              x="282"
              y="183"
              width="49"
              height="40"
              rx="4"
              fill="#fffefb"
              stroke="#d6dfcc"
            />
            <rect
              x="287"
              y="188"
              width="10"
              height="10"
              rx="3"
              fill="#e8dec7"
            />
            <path
              d="M302 191h20m-20 5h14m-34 10h33m-33 5h19"
              stroke="#c4c9b7"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
          <g className="lp-offer-check">
            <circle cx="374" cy="201" r="13" fill="#c2daaa" />
            <path
              d="m368 201 4 4 8-9"
              stroke="#365e39"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
        <circle cx="294" cy="262" r="1.5" fill="#b0c19f" />
        <path
          d="M74 309h458"
          stroke="#618358"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="m100 314-12 57m420-57 12 57"
          stroke="#96af82"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <ellipse
          cx="295"
          cy="374"
          rx="225"
          ry="7"
          fill="#d7e2c9"
          opacity=".6"
        />
        <g className="lp-desk-plant">
          <path
            d="M104 277v-67"
            stroke="#6a925b"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M104 251c-27 0-32-26-32-26s30 0 32 26"
            fill="#92b37c"
            className="lp-plant-leaf-left"
          />
          <path
            d="M104 236c0-29 28-36 28-36s-1 31-28 36"
            fill="#6f975d"
            className="lp-plant-leaf-right"
          />
          <path d="M104 219c-20-8-17-31-17-31s22 10 17 31" fill="#aec78c" />
          <path d="M82 272h44l-6 33H88z" fill="#ddccad" />
          <path d="M80 272h48v7H80z" fill="#c2ab86" />
          <path
            d="m95 285 2 13m15-13-2 13"
            stroke="#c6b28e"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M450 275h31v23a8 8 0 0 1-8 8h-15a8 8 0 0 1-8-8z"
          fill="#aec496"
        />
        <path
          d="M481 280h5a8 8 0 0 1 0 16h-5"
          stroke="#8da97c"
          strokeWidth="4"
          fill="none"
        />
        <ellipse cx="465" cy="275" rx="15" ry="3" fill="#749364" />
        <ellipse cx="465" cy="275" rx="11" ry="2" fill="#685b43" />
        <path
          className="lp-coffee-steam"
          d="M460 260c-9-12 9-15 0-27"
          stroke="#91a77f"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          className="lp-coffee-steam lp-coffee-steam-two"
          d="M472 262c-9-12 9-15 0-27"
          stroke="#b1c39f"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <g className="lp-desk-note">
          <rect
            x="469"
            y="152"
            width="48"
            height="49"
            rx="2"
            fill="#e4e8bb"
            transform="rotate(8 493 176)"
          />
          <path
            d="m481 166 7 7 13-13"
            stroke="#819b63"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m480 184 22 3m-23 3 15 2"
            stroke="#c0ca93"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <rect x="215" y="299" width="127" height="6" rx="3" fill="#c4d3b5" />
        <path
          d="M225 299h106"
          stroke="#e2e9d7"
          strokeWidth="2"
          strokeDasharray="3 3"
        />
        <rect
          x="360"
          y="295"
          width="18"
          height="10"
          rx="5"
          fill="#e0e8d6"
          stroke="#afc39b"
        />
        <path d="M369 297v3" stroke="#91a880" />
      </svg>
      <button
        className="lp-animation-control"
        type="button"
        aria-pressed={paused}
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? <Play size={12} /> : <Pause size={12} />}
        {paused ? "Play animation" : "Pause animation"}
      </button>
    </div>
  );
}
