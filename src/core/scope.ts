/**
 * Call-site scope path for runtime-owned state.
 *
 * Pine gives every written call its own local scope: two calls to the same
 * user function keep independent `var` cells and independent `ta.*` state.
 * TypeScript has no call-site identity, so scripts name the call site
 * explicitly with `ctx.scope(id, fn)`. Node keys and `var`/`varip` cell names
 * created inside `fn` are prefixed with the active scope path, so the same
 * helper invoked under two ids never shares state, while re-entering the same
 * id on later bars (or repeatedly within one bar, like a Pine call inside a
 * loop) resolves to the same state.
 */
export class ScopeStack {
  private readonly frames: string[] = [];
  private currentPrefix = "";

  public get prefix(): string {
    return this.currentPrefix;
  }

  public run<T>(id: string, body: () => T): T {
    const normalized = id.trim();
    if (normalized.length === 0) throw new RangeError("Scope id must not be empty");
    if (normalized.includes("/")) throw new RangeError('Scope id must not contain "/"');

    this.frames.push(normalized);
    this.currentPrefix = `${this.frames.join("/")}::`;
    try {
      return body();
    } finally {
      this.frames.pop();
      this.currentPrefix = this.frames.length === 0 ? "" : `${this.frames.join("/")}::`;
    }
  }

  public qualify(name: string): string {
    return `${this.currentPrefix}${name}`;
  }
}
