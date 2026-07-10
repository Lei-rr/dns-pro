import type { FastifyInstance } from 'fastify'
import {
  cloudflareZoneListQuerySchema,
  cloudflareZoneStoreSchema,
  cloudflareRecordListQuerySchema,
  cloudflareRecordStoreSchema,
  cloudflareRecordUpdateSchema,
} from '../schemas/cloudflare.js'
import { zoneIndex, zoneStore, zoneDelete } from '../controllers/cloudflare/cloudflare-zone-controller.js'
import {
  recordIndex,
  recordStore,
  recordUpdate,
  recordDelete,
} from '../controllers/cloudflare/cloudflare-dns-record-controller.js'

export async function cloudflareRoutes(app: FastifyInstance) {
  app.get(
    `/cloudflare/providers/:providerId/zones`,
    {
      schema: { querystring: cloudflareZoneListQuerySchema },
    },
    zoneIndex
  )

  app.post(
    `/cloudflare/providers/:providerId/zones`,
    {
      schema: { body: cloudflareZoneStoreSchema },
    },
    zoneStore
  )

  app.delete('/cloudflare/providers/:providerId/zones/:zone', zoneDelete)

  app.get(
    '/cloudflare/providers/:providerId/zones/:zone/records',
    {
      schema: { querystring: cloudflareRecordListQuerySchema },
    },
    recordIndex
  )

  app.post(
    '/cloudflare/providers/:providerId/zones/:zone/records',
    {
      schema: { body: cloudflareRecordStoreSchema },
    },
    recordStore
  )

  app.put(
    '/cloudflare/providers/:providerId/zones/:zone/records/:recordId',
    {
      schema: { body: cloudflareRecordUpdateSchema },
    },
    recordUpdate
  )

  app.delete('/cloudflare/providers/:providerId/zones/:zone/records/:recordId', recordDelete)
}
