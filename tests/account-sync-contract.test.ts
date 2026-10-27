import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SYNC_CONTRACT, resolveAccountSync, resolveFirstLinkReplacement, resolveReviewedAccountSync, type AccountSyncSnapshot } from "@cadence/core/resolvers/account-sync.resolver";
import { sha256 } from "@cadence/core/hash";

const migrations = join(process.cwd(), "supabase/migrations");

function registeredContracts(): number[] {
  const contracts: number[] = [];
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrations, file), "utf8");
    for (const insert of sql.matchAll(/insert into cadence_private\.account_sync_contract_additions[^;]*;/g)) {
      for (const row of insert[0].matchAll(/\(\s*(\d+)\s*,\s*'[a-z_]+'/g)) contracts.push(Number(row[1]));
    }
  }
  return contracts;
}

describe("account sync contract", () => {
  it("matches the newest contract registered in hosted migrations", () => {
    const contracts = registeredContracts();
    expect(contracts.length).toBeGreaterThan(0);
    expect(ACCOUNT_SYNC_CONTRACT).toBe(Math.max(...contracts));
  });

  it("is sent with every hosted read and apply from desktop", () => {
    const adapter = readFileSync(join(process.cwd(), "apps/desktop/src/account/account-sync.ts"), "utf8");
    expect(adapter).toContain('client.rpc("read_account_sync_snapshot", { contract: ACCOUNT_SYNC_CONTRACT })');
    expect(adapter).toContain("schemaVersion: 1, contract: ACCOUNT_SYNC_CONTRACT,");
  });

  it("does not reuse another contract's receipt when the projected data is identical", () => {
    const snapshot: AccountSyncSnapshot = { entities: [{ kind: "profile", id: "profile", value: { timezone: "UTC" } }] };
    const input = { accountLinkId: "contract-upgrade", baseline: snapshot, local: snapshot, hosted: snapshot };
    const standard = resolveAccountSync(input);
    const reviewed = resolveReviewedAccountSync({ ...input, reviewedFingerprints: standard.fingerprints, decisions: [] });
    const replacement = resolveFirstLinkReplacement(input);
    for (const [plan, suffix] of [[standard, ""], [reviewed, ""], [replacement, ":first-link-replacement"]] as const) {
      const { baseline, local, hosted, merged } = plan.fingerprints;
      const legacyKeyMaterial = `${input.accountLinkId}:${baseline}:${local}:${hosted}:${merged}${suffix}`;
      expect(plan.idempotencyKey).not.toBe(sha256(legacyKeyMaterial));
      expect(plan.idempotencyKey).not.toBe(sha256(`contract:${ACCOUNT_SYNC_CONTRACT - 1}:${legacyKeyMaterial}`));
      expect(plan.idempotencyKey).toBe(sha256(`contract:${ACCOUNT_SYNC_CONTRACT}:${legacyKeyMaterial}`));
    }
  });
});
