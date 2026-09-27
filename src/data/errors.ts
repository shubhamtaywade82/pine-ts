/** A timeframe, dataset, or instrument a market-data provider cannot supply. */
export class ProviderCapabilityError extends Error {
  public override readonly name = "ProviderCapabilityError";
}
