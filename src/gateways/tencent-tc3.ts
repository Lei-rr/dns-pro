import crypto from 'node:crypto'

interface TencentTc3Options {
  secretId: string
  secretKey: string
  service: string
  endpoint: string
  action: string
  body: string
  timestamp?: number
}

const ALGORITHM = 'TC3-HMAC-SHA256'
const CONTENT_TYPE = 'application/json; charset=utf-8'

export function signTencentTc3(options: TencentTc3Options): Record<string, string> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalHeaders = [
    `content-type:${CONTENT_TYPE}`,
    `host:${options.endpoint}`,
    `x-tc-action:${options.action.toLowerCase()}`,
    '',
  ].join('\n')
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(options.body)].join('\n')
  const credentialScope = `${date}/${options.service}/tc3_request`
  const stringToSign = [ALGORITHM, String(timestamp), credentialScope, sha256(canonicalRequest)].join('\n')
  const signature = calculateSignature(options.secretKey, options.service, stringToSign, date)

  return {
    'Content-Type': CONTENT_TYPE,
    Host: options.endpoint,
    'X-TC-Action': options.action,
    'X-TC-Timestamp': String(timestamp),
    Authorization: `${ALGORITHM} Credential=${options.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

export { CONTENT_TYPE as TENCENT_CONTENT_TYPE }

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function calculateSignature(secretKey: string, service: string, stringToSign: string, date: string): string {
  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest()
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest()
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest()
  return crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
}
