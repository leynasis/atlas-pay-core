import { startLab } from "./lifecycle.mjs";
import { getLabStatus } from "./status.mjs";
try {
  await startLab();
  console.log(JSON.stringify(await getLabStatus(), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
