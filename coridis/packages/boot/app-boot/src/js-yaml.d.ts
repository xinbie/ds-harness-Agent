/**
 * Minimal ambient surface for js-yaml 4, which ships no type declarations for
 * its legacy entry point. app-boot only ever calls `load` and validates the
 * result itself.
 */
declare module 'js-yaml' {
  export function load(input: string, options?: Record<string, unknown>): unknown
}
