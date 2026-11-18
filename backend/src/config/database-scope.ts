import { AsyncLocalStorage } from 'async_hooks';
export interface DatabaseScope { tenantId?: string; userId?: string; portal?: string; identifier?: string; service?: boolean }
export const databaseScope = new AsyncLocalStorage<DatabaseScope>();
