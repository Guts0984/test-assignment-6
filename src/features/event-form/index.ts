/** The panel is heavy (React Hook Form, Zod, the recurrence editor): load it only when it is opened. */
export const loadEventPanel = () => import('./EventPanel');
export type { NewEventInput, PanelMode } from './EventPanel';
export type { FormValues } from './form-model';
export { buildBody, valuesFor } from './form-model';
