/**
 * Shared Framer Motion vocabulary.
 *
 * One easing curve and three durations, used everywhere. Motion that varies per
 * component reads as jitter; motion that is consistent reads as a physical
 * system. These are the Linear/Vercel numbers: short, slightly-overshooting-free,
 * ease-out dominant.
 *
 * REDUCED MOTION: <MotionConfig reducedMotion="user"> in providers.tsx makes
 * Framer drop transforms/opacity animation for users who ask for it — the
 * variants below still "run", they just arrive instantly. That is why every
 * variant animates to a *resting* state that is correct on its own; nothing here
 * depends on the animation having played.
 */

import type { Transition, Variants } from "framer-motion";

export const EASE = [0.16, 1, 0.3, 1] as const; // easeOutExpo-ish

export const DURATION = {
  fast: 0.12,
  base: 0.18,
  slow: 0.28,
} as const;

export const transition: Transition = { duration: DURATION.base, ease: EASE };
export const fastTransition: Transition = { duration: DURATION.fast, ease: EASE };

/** Overlay scrim. */
export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: fastTransition },
  exit: { opacity: 0, transition: fastTransition },
};

/** Centred dialog: a small rise + scale, never a bounce. */
export const dialogVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: fastTransition },
};

/** Popover/menu/tooltip: originates from its trigger edge. */
export const popoverVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: fastTransition },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: { duration: 0.1, ease: EASE } },
};

export const sheetVariants = {
  left: {
    hidden: { x: "-100%" },
    visible: { x: 0, transition: { duration: DURATION.slow, ease: EASE } },
    exit: { x: "-100%", transition: { duration: DURATION.base, ease: EASE } },
  },
  right: {
    hidden: { x: "100%" },
    visible: { x: 0, transition: { duration: DURATION.slow, ease: EASE } },
    exit: { x: "100%", transition: { duration: DURATION.base, ease: EASE } },
  },
  bottom: {
    hidden: { y: "100%" },
    visible: { y: 0, transition: { duration: DURATION.slow, ease: EASE } },
    exit: { y: "100%", transition: { duration: DURATION.base, ease: EASE } },
  },
} satisfies Record<string, Variants>;

/** Page/section entrance. */
export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } },
};

/** Parent of a list of fadeUp children. */
export const staggerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};
