"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportVital } from "@/lib/rum";

// Feeds Core Web Vitals (LCP, FCP, CLS, INP, TTFB) into the RUM reporter. Next collects
// them with its bundled web-vitals library, so this adds no dependency. Rendered once,
// high in the tree (see layout.tsx); it paints nothing.
export function WebVitals() {
  useReportWebVitals((metric) => {
    reportVital({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
    });
  });
  return null;
}
