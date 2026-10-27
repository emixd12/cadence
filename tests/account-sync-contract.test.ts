import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SYNC_CONTRACT } from "@cadence/core/resolvers/account-sync.resolver";

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
});
