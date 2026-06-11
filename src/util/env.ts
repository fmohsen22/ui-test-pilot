/** ${VAR} interpolation over scenario string values. */

const VAR_RE = /\$\{([A-Z0-9_]+)\}/g;

export function findEnvRefs(value: string): string[] {
  return [...value.matchAll(VAR_RE)].map((m) => m[1]);
}

export class MissingEnvError extends Error {
  constructor(public readonly vars: string[]) {
    super(`Missing required environment variable(s): ${vars.join(', ')}`);
    this.name = 'MissingEnvError';
  }
}

export function interpolate(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const missing: string[] = [];
  const out = value.replace(VAR_RE, (_, name: string) => {
    const v = env[name];
    if (v === undefined) {
      missing.push(name);
      return '';
    }
    return v;
  });
  if (missing.length > 0) throw new MissingEnvError(missing);
  return out;
}

/** A ${VAR} whose name suggests a credential should default to secret. */
export function looksSecret(value: string): boolean {
  return findEnvRefs(value).some((name) => /PASS|SECRET|TOKEN|KEY|CREDENTIAL/i.test(name));
}
