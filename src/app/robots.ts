import type { MetadataRoute } from "next";

/** Keeps the admin panel out of search engine crawls — belt-and-suspenders alongside the auth gate and the /admin X-Robots-Tag header (next.config.mjs). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/admin"],
    },
  };
}
