"use client";

import type { ReactNode } from "react";
import type { useCarousel } from "@/lib/use-carousel";

// The arrows and the scrolling track. Dumb markup around whatever tiles the caller puts in it, so
// the inventory carousel and the boss-clears picker cannot drift apart visually.
export function CarouselFrame({
  carousel,
  className,
  trackRole,
  trackLabel,
  children,
}: {
  carousel: ReturnType<typeof useCarousel>;
  className?: string;
  // Set when the tiles inside carry a role that needs a container to belong to (the picker's
  // radios). Left off, the track is the plain scrolling box it looks like.
  trackRole?: string;
  trackLabel?: string;
  children: ReactNode;
}) {
  const { trackRef, atStart, atEnd, page } = carousel;
  return (
    <div className={`carousel${className ? ` ${className}` : ""}`}>
      <button
        className="carousel-arrow"
        onClick={() => page(-1)}
        disabled={atStart}
        aria-label="Previous characters"
      >
        ‹
      </button>

      <div className="carousel-track" ref={trackRef} role={trackRole} aria-label={trackLabel}>
        {children}
      </div>

      <button
        className="carousel-arrow"
        onClick={() => page(1)}
        disabled={atEnd}
        aria-label="Next characters"
      >
        ›
      </button>
    </div>
  );
}
