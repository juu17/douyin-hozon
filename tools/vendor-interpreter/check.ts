// Vendor Interpreter — W1.4 drift comparator: `pnpm vendor:check`.
// Extracts fresh signatures from the resolved vendor, builds a fresh tally,
// and diffs it (by digest) against the committed vendor-api/tally.json.
//
// Exit codes (CI gate semantics):
//   0  MATCH    — no changed/removed consumed symbols; ports may proceed
//   1  DRIFTED  — a consumed symbol changed/removed; block + escalate
//   2  TOOLING  — vendor missing / python error / buildTally threw / no tally
//
// `--accept` re-baselines (writes the fresh tally) after printing the drift —
// the committed JSON diff is the audit trail. DEV-ONLY.

import { extractSignatures } from "./extract.js";
import { buildTally, readTally, writeTally, type CanonicalSymbol, type Tally } from "./tally.js";

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Human-readable field diff over the known CanonicalSymbol shape. Digests
// already decided "changed"; this only explains how. Params compared by
// index (order is canonical).
function diffSymbol(a: CanonicalSymbol, b: CanonicalSymbol): string[] {
  const out: string[] = [];
  const scalar = (field: keyof CanonicalSymbol) => {
    if (a[field] !== b[field]) out.push(`${field}: ${String(a[field])} → ${String(b[field])}`);
  };
  scalar("kind");
  scalar("async");
  scalar("returns");
  scalar("vararg");
  scalar("kwarg");
  if (JSON.stringify(a.decorators) !== JSON.stringify(b.decorators)) {
    out.push(`decorators: [${a.decorators.join(",")}] → [${b.decorators.join(",")}]`);
  }
  if (JSON.stringify(a.bases) !== JSON.stringify(b.bases)) {
    out.push(`bases: [${a.bases.join(",")}] → [${b.bases.join(",")}]`);
  }
  const n = Math.max(a.params.length, b.params.length);
  for (let i = 0; i < n; i++) {
    const pa = a.params[i];
    const pb = b.params[i];
    if (!pa) { out.push(`params[${i}]: + ${pb!.name}`); continue; }
    if (!pb) { out.push(`params[${i}]: - ${pa.name}`); continue; }
    if (pa.name !== pb.name) out.push(`params[${i}].name: ${pa.name} → ${pb.name}`);
    if (pa.annotation !== pb.annotation) out.push(`params[${i}].annotation: ${pa.annotation} → ${pb.annotation}`);
    if (pa.default !== pb.default) out.push(`params[${i}].default: ${pa.default} → ${pb.default}`);
    if (pa.kind !== pb.kind) out.push(`params[${i}].kind: ${pa.kind} → ${pb.kind}`);
  }
  return out;
}

async function main(): Promise<number> {
  const accept = process.argv.includes("--accept");

  let fresh: Tally;
  try {
    fresh = buildTally(await extractSignatures());
  } catch (err) {
    process.stderr.write(`vendor:check tooling error (extract/build): ${msg(err)}\n`);
    return 2;
  }

  let committed: Tally;
  try {
    committed = await readTally();
  } catch (err) {
    process.stderr.write(`vendor:check: cannot read committed tally — run vendor:baseline first (${msg(err)})\n`);
    return 2;
  }

  const added: string[] = [];
  const removed: string[] = [];
  const changed: { symbol: string; fields: string[] }[] = [];

  for (const k of Object.keys(fresh.symbols)) {
    if (!committed.symbols[k]) added.push(k);
  }
  for (const k of Object.keys(committed.symbols)) {
    const c = committed.symbols[k]!;
    const f = fresh.symbols[k];
    if (!f) { removed.push(k); continue; }
    if (c.digest !== f.digest) changed.push({ symbol: k, fields: diffSymbol(c, f) });
  }

  const drifted = changed.length > 0 || removed.length > 0;

  if (!drifted && added.length === 0) {
    process.stdout.write(`vendor:check MATCH — ${Object.keys(committed.symbols).length} consumed symbols unchanged @ ${committed.vendorCommit.slice(0, 8)}\n`);
    return 0;
  }

  process.stdout.write(`vendor:check ${drifted ? "DRIFTED" : "MATCH (+additions)"}\n`);
  for (const k of removed) process.stdout.write(`  REMOVED  ${k}\n`);
  for (const { symbol, fields } of changed) {
    process.stdout.write(`  CHANGED  ${symbol}\n`);
    for (const f of fields) process.stdout.write(`             ${f}\n`);
  }
  for (const k of added) process.stdout.write(`  added (non-blocking) ${k}\n`);

  if (accept) {
    await writeTally(fresh);
    process.stdout.write(`\nRe-baselined vendor-api/tally.json @ ${fresh.vendorCommit.slice(0, 8)} — commit the diff as the audit trail.\n`);
    return 0;
  }

  return drifted ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`vendor:check crashed: ${msg(err)}\n`);
    process.exit(2);
  });
