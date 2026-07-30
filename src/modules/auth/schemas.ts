import { objectSchema, requestSchema, text } from '../../lib/http/request-schema.js'

export const sessionStoreSchema = requestSchema({
  body: objectSchema({ username: text(255), password: text(1024) }, ['username', 'password']),
})
