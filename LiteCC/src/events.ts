export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(value: never) => void>>();

  on<Key extends keyof Events>(event: Key, listener: (value: Events[Key]) => void): () => void {
    let group = this.listeners.get(event);
    if (!group) {
      group = new Set();
      this.listeners.set(event, group);
    }
    group.add(listener as (value: never) => void);
    return () => group?.delete(listener as (value: never) => void);
  }

  emit<Key extends keyof Events>(event: Key, value: Events[Key]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }

  clear(): void {
    this.listeners.clear();
  }
}
