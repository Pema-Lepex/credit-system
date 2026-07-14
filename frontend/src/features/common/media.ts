/**
 * Re-export only. The implementation moved to `@/lib/media` so that UI primitives
 * (Avatar) can absolutise a URL themselves without a components/ui -> features/
 * import, which would be backwards layering.
 *
 * Kept so existing imports keep working; prefer importing from `@/lib/media`.
 */

export { assetUrl, assetUrls } from "@/lib/media";
