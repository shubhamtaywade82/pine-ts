# Pine v6 compatibility

TradingView's Pine Script v6 Reference Manual is the authoritative API specification. The Concepts documentation defines execution and subsystem semantics.

## Compatibility levels

- **Exact:** names, signatures, history behavior, and edge cases match Pine where the provider/data model permits it.
- **Pine-like:** TypeScript-native syntax differs, but observable semantics and API concepts are intentionally equivalent.
- **Provider-limited:** the API exists but a provider cannot supply the underlying dataset. The runtime emits a typed capability error rather than fabricating values.

## Areas under compatibility testing

- series/history references
- `na` behavior
- evaluation order and execution state
- realtime rollback/commit
- `barstate.*`
- MTF alignment, gaps, and lookahead
- collection identity/mutation
- strategy broker-emulator semantics
- plot/drawing object lifecycle

## Binance limitation

Binance is a crypto market-data/execution provider. TradingView requests for fundamentals, corporate actions, or other datasets not exposed by Binance are provider-limited.
