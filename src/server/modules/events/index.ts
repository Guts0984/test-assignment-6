/** Domain API of the events module. HTTP adapters live in `./http`. */
export type { EventDto, OccurrenceDto } from './dto';
export { isOpenEnded, occurrencesOf, occurrenceRanges } from './materialize';
export { eventAttendees, eventOccurrences, events } from './schema';
export { listOccurrences } from './repository';
export { extendOpenSeries } from './service/extend-series';
