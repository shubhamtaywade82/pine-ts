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

## Known divergences

- **Call-site identity is explicit.** Identical calls share one node unless
  wrapped in distinct `ctx.scope(id, fn)` scopes (see `docs/SEMANTICS.md`,
  "Local scopes and call-site identity").
- **Windowed built-ins in conditional scopes.** Built-ins read the argument
  series' bar history. Pine uses the call's own parameter buffer, which only
  holds values from bars where the call ran. Results match whenever the call
  executes on every bar, which is what Pine's compiler warning asks for.
- **`simple int` violations are not detected.** Passing a changing length to
  a `simple int` parameter (`ta.ema`, `ta.rsi`, ...) is a Pine compile error;
  pine-ts starts a fresh node instead.
- **`weekofyear`** uses ISO-8601 week numbering; the Reference Manual does not
  state its convention.

## DhanHQ provider limitations

- **Timeframes:** minute timeframes up to one session and `1D`. Seconds,
  ticks, weekly, and monthly timeframes raise `ProviderCapabilityError`.
- **Sessions:** NSE/BSE cash, F&O, and indices default to 09:15-15:30 IST.
  MCX has no default session and must be configured. Holidays need no
  calendar: days without data produce no bars.
- **Ticks outside the session** (pre-open auction, post-close) are discarded
  and reported through `onDiscardedTick`, like TradingView's regular-session
  bars. A bucket without trades produces no bar.
- **Volume** is the difference of the feed's cumulative day volume (`quote`
  and `full` modes). `ticker` packets and indices carry no volume. A stream
  that joins mid-bar without a seeding historical request cannot see volume
  traded before its first tick.
- **Unverified against a live account:**
  - the epoch base of the feed's `ltt` field (UNIX vs IST wall-clock);
    `tradeTimeBase: "auto"` calibrates against the clock and fails loudly;
  - whether the charts API's `toDate` is inclusive (requests cover the end
    date and filter locally);
  - the time of day Dhan uses for daily candles (bars are re-stamped with the
    session open of their IST date either way).

## Binance limitation

Binance is a crypto market-data/execution provider. TradingView requests for fundamentals, corporate actions, or other datasets not exposed by Binance are provider-limited.
