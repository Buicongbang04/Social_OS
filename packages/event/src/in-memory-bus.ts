import type { RuntimeEventType } from "./catalog";
import type {
  EventHandler,
  EventPublisher,
  EventSubscriber,
  RuntimeEvent,
} from "./envelope";

/**
 * In-process event bus.
 *
 * Used by the runtime engine itself and by tests. Handler failures are
 * isolated: one broken consumer must not stop the others from seeing the event,
 * nor fail the Execution that emitted it — an event is a notification, not a
 * transaction (docs/kernel/11_EVENT_BUS.md decouples producers from consumers).
 */
export class InMemoryEventBus implements EventPublisher, EventSubscriber {
  private readonly handlers = new Map<RuntimeEventType, EventHandler[]>();
  private readonly published: RuntimeEvent<unknown>[] = [];

  constructor(
    private readonly onHandlerError: (
      error: unknown,
      event: RuntimeEvent<unknown>,
    ) => void = () => {},
  ) {}

  subscribe(type: RuntimeEventType, handler: EventHandler): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }

  async publish<TPayload>(event: RuntimeEvent<TPayload>): Promise<void> {
    this.published.push(event as RuntimeEvent<unknown>);
    await this.dispatch(event as RuntimeEvent<unknown>);
  }

  async publishAll(events: readonly RuntimeEvent<unknown>[]): Promise<void> {
    // Sequential on purpose: ordering within one Execution is guaranteed
    // (ExecutionStarted → TaskStarted → …), and Promise.all would lose it.
    for (const event of events) {
      await this.publish(event);
    }
  }

  async dispatch(event: RuntimeEvent<unknown>): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      try {
        await handler(event);
      } catch (error) {
        this.onHandlerError(error, event);
      }
    }
  }

  /** Everything published so far — for assertions in tests. */
  history(): readonly RuntimeEvent<unknown>[] {
    return [...this.published];
  }

  clear(): void {
    this.published.length = 0;
  }
}
