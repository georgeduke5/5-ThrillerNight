import Link from "next/link";
import type { ReactNode } from "react";

interface CtaButtonProps {
  href: string;
  children: ReactNode;
  variant?: "primary" | "accent";
}

/**
 * Every actionable call-to-action must be impossible to miss: big, bold,
 * high-contrast, Arial-style sans-serif (font-heading, config-driven).
 */
export function CtaButton({ href, children, variant = "primary" }: CtaButtonProps) {
  const bg = variant === "primary" ? "bg-primary" : "bg-accent";
  return (
    <Link
      href={href}
      className={`inline-block rounded-md ${bg} px-8 py-4 text-center font-heading text-xl font-bold uppercase tracking-wide text-bg shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-4 focus-visible:outline-white sm:text-2xl`}
    >
      {children}
    </Link>
  );
}
