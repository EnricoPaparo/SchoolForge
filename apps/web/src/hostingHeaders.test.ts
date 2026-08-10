import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// HARD-01B — guardrail statico sulla configurazione dei security header e della
// cache di Firebase Hosting in firebase.json. Non fa rete e non dipende da un
// deploy: verifica solo che la configurazione dichiarata non regredisca.
// I test vitest girano con cwd = apps/web, quindi firebase.json (root repo) è a ../../.
const firebaseJsonPath = resolve(process.cwd(), '../../firebase.json');
const firebaseConfig = JSON.parse(readFileSync(firebaseJsonPath, 'utf-8')) as {
  hosting: {
    public: string;
    predeploy: string[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
};

const headerBlocks = firebaseConfig.hosting.headers;

describe('Firebase Hosting build predeploy', () => {
  it('costruisce esplicitamente apps/web prima di pubblicarne dist', () => {
    expect(firebaseConfig.hosting.public).toBe('apps/web/dist');
    expect(firebaseConfig.hosting.predeploy).toEqual(['pnpm --dir apps/web build']);
  });
});

function blockFor(source: string) {
  const block = headerBlocks.find((b) => b.source === source);
  if (!block) throw new Error(`Nessun blocco headers per source "${source}"`);
  return block.headers;
}

function valueOf(source: string, key: string): string | undefined {
  return blockFor(source).find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe('Firebase Hosting security headers', () => {
  it('imposta i security header globali su "**"', () => {
    expect(valueOf('**', 'X-Content-Type-Options')).toBe('nosniff');
    expect(valueOf('**', 'X-Frame-Options')).toBe('DENY');
    expect(valueOf('**', 'Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(valueOf('**', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy disabilita camera/microfono/geoloc/payment/usb ma non fullscreen', () => {
    const pp = valueOf('**', 'Permissions-Policy') ?? '';
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('payment=()');
    expect(pp).toContain('usb=()');
    // Fullscreen deve restare consentito al same-origin (modalità verifica).
    expect(pp).toContain('fullscreen=(self)');
    expect(pp).not.toContain('fullscreen=()');
  });

  it('la CSP è enforced e contiene le direttive di base attese', () => {
    const csp = valueOf('**', 'Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("script-src 'self'");
  });

  it('la CSP non usa unsafe-eval né wildcard globali', () => {
    const csp = valueOf('**', 'Content-Security-Policy') ?? '';
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('default-src *');
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });

  it('consente le origini necessarie a Firebase Auth, Firestore, Storage, Functions e foto profilo', () => {
    const csp = valueOf('**', 'Content-Security-Policy') ?? '';
    expect(csp).toMatch(/script-src[^;]*https:\/\/apis\.google\.com/);
    expect(csp).toContain('https://identitytoolkit.googleapis.com');
    expect(csp).toContain('https://securetoken.googleapis.com');
    expect(csp).toContain('https://firestore.googleapis.com');
    expect(csp).toContain('https://firebasestorage.googleapis.com');
    expect(csp).toContain('https://*.cloudfunctions.net');
    expect(csp).toContain('https://*.firebaseapp.com');
    expect(csp).toContain('https://*.googleusercontent.com');
  });
});

describe('Firebase Hosting cache policy', () => {
  it('index.html / shell SPA forza la rivalidazione (no-cache)', () => {
    expect(valueOf('**', 'Cache-Control')).toBe('no-cache');
  });

  it('/assets/** (bundle Vite con hash) è immutabile a lungo termine', () => {
    expect(valueOf('/assets/**', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('il gateway /api/repository/** ha un blocco dedicato con Cache-Control: no-store', () => {
    // Non ci si affida all'interazione tra il no-cache globale di Hosting e il
    // no-store restituito dalla Cloud Function: Hosting stesso impone no-store.
    const block = headerBlocks.find((b) => b.source === '/api/repository/**');
    expect(block, 'atteso un blocco headers per "/api/repository/**"').toBeDefined();
    expect(valueOf('/api/repository/**', 'Cache-Control')).toBe('no-store');
  });

  it('nessuna regola applica una cache pubblica aggressiva al gateway /api/repository/**', () => {
    for (const block of headerBlocks) {
      const cache = block.headers.find((h) => h.key.toLowerCase() === 'cache-control')?.value ?? '';
      const matchesApi = block.source === '**' || block.source.includes('/api/');
      if (matchesApi) {
        expect(cache).not.toContain('immutable');
        expect(cache).not.toMatch(/max-age=\d{4,}/);
      }
    }
  });
});
