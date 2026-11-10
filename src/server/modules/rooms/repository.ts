import { asc } from 'drizzle-orm';
import type { Exec } from '@/server/core/db';
import type { RoomDto } from '@/shared/contracts';
import { rooms } from './schema';

export type { RoomDto };
export const listRooms = (db: Exec): Promise<RoomDto[]> =>
  db.select().from(rooms).orderBy(asc(rooms.floor), asc(rooms.name));
