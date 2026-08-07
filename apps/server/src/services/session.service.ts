import type { Session } from '@vab/types';
import type { Repositories } from '../repositories/types.js';

export class SessionService {
  constructor(private readonly repositories: Repositories) {}

  /** Unscoped for the same reason as EventService.list. */
  list(limit: number): Promise<Session[]> {
    return this.repositories.sessions.list(null, limit);
  }
}
