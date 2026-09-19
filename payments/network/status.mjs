import { rpc, assertRegtest } from "./rpc.mjs";
import { RPC_URL, WALLETS } from "./config.mjs";

try {
  const chain = await assertRegtest();
  const [network, merchantBalance, payerBalance] = await Promise.all([
    rpc("getnetworkinfo"),
    rpc("getbalance", [], WALLETS.merchant),
    rpc("getbalance", [], WALLETS.payer),
  ]);
  console.log(
    JSON.stringify(
      {
        status: "running",
        chain: chain.chain,
        blocks: chain.blocks,
        rpc: RPC_URL,
        networkActive: network.networkactive,
        connections: network.connections,
        version: network.subversion,
        wallets: { merchantBalance, payerBalance },
        instantSend: "unavailable: no masternode quorums",
        chainLocks: "unavailable: no masternode quorums",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`Local regtest is unavailable: ${error.message}`);
  process.exitCode = 1;
}
