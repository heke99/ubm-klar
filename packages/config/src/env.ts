export interface EnvVarSpec {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
}

export class MissingEnvVarError extends Error {
  constructor(public readonly names: string[]) {
    super(`Missing required environment variables: ${names.join(', ')}`);
    this.name = 'MissingEnvVarError';
  }
}

export function readEnv(
  specs: EnvVarSpec[],
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const missing = specs.filter((s) => s.required && !source[s.name]).map((s) => s.name);
  if (missing.length > 0) {
    throw new MissingEnvVarError(missing);
  }
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const value = source[spec.name];
    if (value !== undefined) out[spec.name] = value;
  }
  return out;
}

/** Redacts secret values for safe diagnostics output. */
export function redactEnv(
  values: Record<string, string>,
  specs: EnvVarSpec[],
): Record<string, string> {
  const secretNames = new Set(specs.filter((s) => s.secret).map((s) => s.name));
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, secretNames.has(k) ? '***redacted***' : v]),
  );
}
