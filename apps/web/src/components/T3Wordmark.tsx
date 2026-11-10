import type { SVGProps } from "react";

// Ensemble's mark. The component keeps the upstream name so its other uses still apply cleanly.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="6" r="4" fill="currentColor" />
      <circle cx="5.5" cy="17.5" r="4" fill="currentColor" />
      <circle cx="18.5" cy="17.5" r="4" fill="currentColor" />
    </svg>
  );
}
