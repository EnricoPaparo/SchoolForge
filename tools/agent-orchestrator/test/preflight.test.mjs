import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runPreflight } from '../src/preflight.mjs';
import { createFakePorts, createFakeSpawn, windowsClaudeBinaryPath } from './fakePorts.mjs';

function withClaudeBinary(ports, files, statusJson, { exitCode = 0 } = {}) {
  files.set(windowsClaudeBinaryPath('C:/Users/dev'), 'stub');
  ports.exec.spawn = createFakeSpawn({
    async run({ args, emitStdout, emitClose }) {
      assert.deepEqual(args, ['auth', 'status']);
      emitStdout(JSON.stringify(statusJson));
      emitClose(exitCode, null);
    },
  });
}

test('preflight rejects when ANTHROPIC_API_KEY is present, without spawning claude', async () => {
  const { ports } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev', ANTHROPIC_API_KEY: 'sk-something' },
    platform: 'win32',
  });
  ports.exec.spawn = () => {
    throw new Error('must not spawn when API credentials are present');
  };

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'api_credentials_present');
  assert.ok(!('detail' in result) || !result.detail.includes('sk-something'));
});

test('preflight rejects when ANTHROPIC_AUTH_TOKEN is present', async () => {
  const { ports } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev', ANTHROPIC_AUTH_TOKEN: 'tok' },
    platform: 'win32',
  });
  ports.exec.spawn = () => {
    throw new Error('must not spawn when API credentials are present');
  };

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'api_credentials_present');
});

test('preflight accepts claude.ai auth with an eligible subscription', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  withClaudeBinary(ports, files, {
    loggedIn: true,
    authMethod: 'claude.ai',
    subscriptionType: 'max',
  });

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, true);
  assert.equal(result.authMethod, 'claude.ai');
  assert.equal(result.subscriptionType, 'max');
});

test('preflight rejects Console/API auth even with exit code 0', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  withClaudeBinary(ports, files, {
    loggedIn: true,
    authMethod: 'console',
    subscriptionType: null,
  });

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth_not_eligible');
});

test('preflight rejects a subscriptionType outside pro/max/team/enterprise', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  withClaudeBinary(ports, files, {
    loggedIn: true,
    authMethod: 'claude.ai',
    subscriptionType: 'free',
  });

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth_not_eligible');
});

test('preflight never surfaces email, orgId or token fields even if present', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  withClaudeBinary(ports, files, {
    loggedIn: true,
    authMethod: 'claude.ai',
    subscriptionType: 'pro',
    email: 'someone@example.com',
    orgId: 'org_secret',
    token: 'shhh',
  });

  const result = await runPreflight(ports, {});
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('someone@example.com'));
  assert.ok(!serialized.includes('org_secret'));
  assert.ok(!serialized.includes('shhh'));
});

test('preflight rejects a logged-out status even if stale auth fields remain', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  withClaudeBinary(ports, files, {
    loggedIn: false,
    authMethod: 'claude.ai',
    subscriptionType: 'pro',
  });

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'auth_not_eligible');
});

test('preflight reports invalid_status_output on unparsable JSON', async () => {
  const { ports, files } = createFakePorts({
    env: { USERPROFILE: 'C:/Users/dev' },
    platform: 'win32',
  });
  files.set(windowsClaudeBinaryPath('C:/Users/dev'), 'stub');
  ports.exec.spawn = createFakeSpawn({
    async run({ emitStdout, emitClose }) {
      emitStdout('not json');
      emitClose(0, null);
    },
  });

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_status_output');
});

test('preflight reports binary_not_found when claude is not installed', async () => {
  const { ports } = createFakePorts({ env: { USERPROFILE: 'C:/Users/dev' }, platform: 'win32' });

  const result = await runPreflight(ports, {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'binary_not_found');
});
