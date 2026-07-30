/**
 * Table / list loading helpers.
 *
 * - First load: no artificial delay (faster open).
 * - Explicit refresh: short min paint so RefreshCw spin is visible.
 * - Soft dim is delayed inside TableLoading when rows already exist (no flash).
 */

export async function withMinLoading(
  flag: { value: boolean },
  task: () => Promise<void>,
  minMs = 0,
) {
  flag.value = true
  // one frame so Vue paints loading=true before await
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const started = Date.now()
  try {
    await task()
  } finally {
    const wait = Math.max(0, minMs - (Date.now() - started))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    flag.value = false
  }
}

/**
 * Explicit refresh: table soft-loading + single 「已刷新」 toast.
 * Explicit user refresh calls load({ refresh:true }); mutation follow-up loads remain ordinary cache-first reads.
 */
export async function handleRefresh(
  flag: { value: boolean },
  load: (options?: { refresh?: boolean }) => Promise<void>,
  toastSuccess: (title: string) => void,
) {
  await withMinLoading(
    flag,
    async () => {
      await load({ refresh: true })
    },
    // slightly shorter than before: RefreshCw already signals work
    120,
  )
  toastSuccess('已刷新')
}
