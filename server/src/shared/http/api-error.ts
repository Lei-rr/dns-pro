export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details: unknown = undefined
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
