import { mineBlocks } from "./lifecycle.mjs";
import { getLabStatus } from "./status.mjs";
try {
  const hashes = await mineBlocks(Number(process.argv[2] || "1"));
  console.log(
    JSON.stringify(
      { generated: hashes.length, ...(await getLabStatus()) },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
