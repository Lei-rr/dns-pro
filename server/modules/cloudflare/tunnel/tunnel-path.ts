/** 隧道账户下的资源路径（accountId 来自 CloudflareAccess.forTunnel） */
export function tunnelPath(accountId: string, tunnelId = ''): string {
  const base = `accounts/${encodeURIComponent(accountId)}/cfd_tunnel`
  return tunnelId ? `${base}/${encodeURIComponent(tunnelId)}` : base
}
