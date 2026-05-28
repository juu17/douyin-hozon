// Vendor Interpreter — W1.3 baseline writer: `pnpm vendor:baseline`.
// Extracts the vendor signatures and (re)writes vendor-api/tally.json. The
// committed JSON diff is the audit trail when re-baselining after accepted
// upstream drift. DEV-ONLY.

import { extractSignatures } from "./extract.js";
import { buildTally, writeTally, TALLY_PATH } from "./tally.js";

extractSignatures()
  .then(async (records) => {
    const tally = buildTally(records);
    await writeTally(tally);
    process.stdout.write(
      `Baseline: ${Object.keys(tally.symbols).length} consumed symbols @ ${tally.vendorCommit.slice(0, 8)} → ${TALLY_PATH}\n`,
    );
  })
  .catch((err: unknown) => {
    process.stderr.write(`vendor:baseline failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
