import { objectSchema, requestSchema, text } from '../../shared/http/request-schema.js'

export const sessionStoreSchema = requestSchema({
  body: objectSchema({ username: text(255), password: text(1024) }, ['username', 'password']),
})

export const passwordUpdateSchema = requestSchema({
  body: objectSchema({ current_password: text(1024), new_password: text(1024) }, ['current_password', 'new_password']),
})
