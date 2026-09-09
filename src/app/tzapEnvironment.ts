export type TzapEnvironment = "prod" | "staging";

export function parseTzapBuildEnvironment(value: unknown): TzapEnvironment | null {
  return value === "staging" || value === "prod" ? value : null;
}

const configuredBuildEnvironment = parseTzapBuildEnvironment(import.meta.env.VITE_TZAP_BUILD_ENV);

// Development mode keeps the existing selector so developers can exercise
// both hosted environments. Every production Vite build is fixed to prod
// unless the build script explicitly supplies staging.
export const FIXED_TZAP_BUILD_ENVIRONMENT: TzapEnvironment | null =
  configuredBuildEnvironment ?? (import.meta.env.DEV ? null : "prod");

export function resolveTzapEnvironment(
  storedValue: unknown,
  fixedEnvironment: TzapEnvironment | null = FIXED_TZAP_BUILD_ENVIRONMENT,
): TzapEnvironment {
  if (fixedEnvironment) {
    return fixedEnvironment;
  }
  return parseTzapBuildEnvironment(storedValue) ?? "prod";
}
