export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export class RpcError extends Error {
  constructor(message, { code, definitive = false } = {}) {
    super(message);
    this.name = "RpcError";
    this.rpcCode = code;
    this.definitive = definitive;
  }
}

export function publicError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof RpcError) {
    if (error.rpcCode === -6)
      return new AppError(
        "INSUFFICIENT_FUNDS",
        "The local test wallet needs more confirmed test coins, including the transaction fee.",
        409,
      );
    return new AppError(
      "CHAIN_UNAVAILABLE",
      "The local Dash regtest node or wallet is unavailable. Start the local chain and try again.",
      503,
    );
  }
  return new AppError(
    "INTERNAL_ERROR",
    "The request could not be completed.",
    500,
  );
}
