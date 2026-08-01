/** Serializes the few cross-file provider/SaaS reference mutations in this process. */
export class ProviderIntegrity {
  private queue: Promise<void> = Promise.resolve()

  async run<T>(task: () => Promise<T>): Promise<T> {
    const current = this.queue.catch(() => undefined).then(task)
    this.queue = current.then(
      () => undefined,
      () => undefined
    )
    return current
  }
}
