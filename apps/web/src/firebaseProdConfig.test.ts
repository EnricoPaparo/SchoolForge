import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type FirebaseDeployConfig = {
  hosting: {
    public: string;
    predeploy: string[];
    headers: unknown[];
    rewrites: Array<{
      source: string;
      function?: { functionId: string; region: string };
      destination?: string;
    }>;
  };
  firestore: { rules: string; indexes: string };
  storage: { rules: string };
  functions: { source: string; runtime: string; predeploy: string[] };
};

function readConfig(name: string): FirebaseDeployConfig {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../../${name}`), 'utf8'),
  ) as FirebaseDeployConfig;
}

const dev = readConfig('firebase.json');
const prod = readConfig('firebase.prod.json');

describe('configurazione deploy PROD', () => {
  it('usa build PROD e rewrite europeo', () => {
    expect(prod.hosting.predeploy).toEqual(['pnpm --dir apps/web build:prod']);
    expect(prod.hosting.rewrites[0]).toEqual({
      source: '/api/repository/**',
      function: { functionId: 'repositoryGateway', region: 'europe-west8' },
    });
  });

  it('mantiene invariati superfici, security header e configurazioni dati', () => {
    expect(prod.hosting.public).toBe(dev.hosting.public);
    expect(prod.hosting.headers).toEqual(dev.hosting.headers);
    expect(prod.hosting.rewrites[1]).toEqual(dev.hosting.rewrites[1]);
    expect(prod.firestore).toEqual(dev.firestore);
    expect(prod.storage).toEqual(dev.storage);
    expect(prod.functions).toEqual(dev.functions);
  });
});
