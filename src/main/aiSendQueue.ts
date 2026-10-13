/** Start each capture now; serialize only delivery, retaining the input/result pair. */
export class AiSendQueue<Input, Capture> {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;
  constructor(private readonly actions: {
    capture(input: Input): Promise<Capture>;
    send(input: Input, capture: Capture): Promise<void>;
    failed(input: Input, error: unknown, capture?: Capture): void;
  }) {}

  enqueue(input: Input): number {
    this.count++;
    // Attach rejection handling immediately, even while earlier deliveries wait.
    const capture = Promise.resolve().then(() => this.actions.capture(input)).then(
      value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
    );
    this.tail = this.tail.then(async () => {
      const result = await capture;
      if (!result.ok) { this.actions.failed(input, result.error); return; }
      try { await this.actions.send(input, result.value); }
      catch (error) { this.actions.failed(input, error, result.value); }
    }).finally(() => { this.count--; });
    return this.count;
  }

  whenIdle(): Promise<void> { return this.tail; }
  get pending(): number { return this.count; }
}
