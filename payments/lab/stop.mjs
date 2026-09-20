import { NODE_IDS } from "./config.mjs";
import { stopNode } from "./lifecycle.mjs";
try {
  for (const id of [...NODE_IDS].reverse()) await stopNode(id);
  console.log(
    "All selected lab nodes stopped; wallets and chain data are preserved.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
