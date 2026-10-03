/** Hairline icons, drawn to sit with Fell/Alegreya type (stroke = currentColor). */
import type { JSX } from "preact";

type P = { size?: number; class?: string; title?: string };

function Svg(props: P & { children: JSX.Element | JSX.Element[]; fill?: boolean }): JSX.Element {
  const s = props.size ?? 16;
  return (
    <svg
      class={`icon ${props.class ?? ""}`}
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill={props.fill ? "currentColor" : "none"}
      stroke={props.fill ? "none" : "currentColor"}
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={props.title ? undefined : "true"}
      role={props.title ? "img" : undefined}
    >
      {props.title ? <title>{props.title}</title> : null}
      {props.children}
    </svg>
  );
}

export const IconPlay = (p: P) => (
  <Svg {...p} fill>
    <path d="M5 3.2v9.6c0 .4.4.6.7.4l7.2-4.8c.3-.2.3-.6 0-.8L5.7 2.8c-.3-.2-.7 0-.7.4z" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p} fill>
    <rect x="4" y="3" width="2.6" height="10" rx=".6" />
    <rect x="9.4" y="3" width="2.6" height="10" rx=".6" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Svg>
);
export const IconForward = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Svg>
);
export const IconStepBack = (p: P) => (
  <Svg {...p}>
    <path d="M9 4 5 8l4 4M13 4 9 8l4 4" />
  </Svg>
);
export const IconStepFwd = (p: P) => (
  <Svg {...p}>
    <path d="M7 4l4 4-4 4M3 4l4 4-4 4" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const IconExpand = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </Svg>
);
export const IconCollapse = (p: P) => (
  <Svg {...p}>
    <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14" />
  </Svg>
);
export const IconPaneRight = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M10 3v10" />
  </Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M12.8 10.2A5.4 5.4 0 0 1 5.8 3.2a5.4 5.4 0 1 0 7 7z" />
  </Svg>
);
export const IconDice = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <circle cx="5.6" cy="5.6" r=".7" fill="currentColor" />
    <circle cx="10.4" cy="10.4" r=".7" fill="currentColor" />
    <circle cx="8" cy="8" r=".7" fill="currentColor" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5 14 5.6 8 8.7 2 5.6z" />
    <path d="M2 8.3 8 11.4l6-3.1M2 10.9 8 14l6-3.1" />
  </Svg>
);
export const IconGlobe = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M2.2 8h11.6M8 2.2c1.8 1.6 2.6 3.6 2.6 5.8S9.8 12.2 8 13.8M8 2.2C6.2 3.8 5.4 5.8 5.4 8s.8 4.2 2.6 5.8" />
  </Svg>
);
export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M8 4.2C6.6 3 4.6 2.6 2.5 2.8v9.4c2.1-.2 4.1.2 5.5 1.4 1.4-1.2 3.4-1.6 5.5-1.4V2.8c-2.1-.2-4.1.2-5.5 1.4zM8 4.2v9.4" />
  </Svg>
);
export const IconMap = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4 6 2.6l4 1.6 3.5-1.4v9.4L10 13.6l-4-1.6-3.5 1.4zM6 2.6V12M10 4.2v9.4" />
  </Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
  </Svg>
);
