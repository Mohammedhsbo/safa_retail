import type { NextFunction, Request, Response } from 'express'
import type { AuthPrincipal, AuthenticationService } from './auth.service.js'
import { HttpError } from '../errors.js'

declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal
    }
  }
}

export function requireAuthentication(service: AuthenticationService) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const header = request.header('authorization')
      const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
      if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'A valid access token is required')
      request.principal = await service.authenticate(token)
      next()
    } catch (error) {
      next(error)
    }
  }
}
