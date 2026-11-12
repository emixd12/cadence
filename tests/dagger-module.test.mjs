// The Dagger `test` check mounts the Git data of one pinned commit, because
// tests/mcp-hosted-fixtures.test.mjs archives FIXTURE_SOURCE from Git. This
// keeps the module's pin equal to that constant. The Dagger container
// excludes .dagger, so the test runs natively and in GitHub Actions.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MODULE = '.dagger/modules/cadence/main.dang';
const BUILD_SCRIPT = 'scripts/build-mcp-hosted-fixtures.mjs';

describe.skipIf(!existsSync(MODULE))('Dagger module', () => {
  it('pins the commit the hosted fixture test archives', () => {
    const source = /FIXTURE_SOURCE = "([0-9a-f]{40})"/.exec(readFileSync(BUILD_SCRIPT, 'utf8'))?.[1];
    expect(source).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(MODULE, 'utf8')).toContain(`fixtureCommit: String! = "${source}"`);
  });
});
