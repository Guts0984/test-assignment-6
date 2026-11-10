import { fail, ok, type Db, type Result } from '@/server/core/db';
import type { EventDto } from '../dto';
import { loadEventDtos } from '../repository';

export async function getEvent(db: Db, id: string): Promise<Result<EventDto>> {
  const [dto] = await loadEventDtos(db, [id]);
  return dto ? ok(dto) : fail(404, 'NOT_FOUND');
}
