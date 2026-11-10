export const SEED_USERS = [
  { email: 'ana@example.com', name: 'Ana Kovalenko', timezone: 'Europe/Kyiv', locale: 'uk' },
  { email: 'bob@example.com', name: 'Bob Miller', timezone: 'America/New_York', locale: 'en' },
  { email: 'kenji@example.com', name: 'Kenji Sato', timezone: 'Asia/Tokyo', locale: 'en' },
] as const;

export const ROOM_COUNT = 50;
export const FLOORS = 5;
export const TARGET_OCCURRENCES = 2000;

export const TITLES = [
  'Standup',
  'Sprint planning',
  'Retro',
  'Design review',
  '1:1',
  'Architecture sync',
  'Customer call',
  'Interview',
  'Roadmap',
  'Demo',
  'Onboarding',
  'Incident review',
  'Budget',
  'Hiring sync',
  'Product sync',
  'Workshop',
  'Training',
  'Planning',
  'QA triage',
  'Release check',
  'Brainstorm',
  'Town hall',
  'Support sync',
  'Legal review',
] as const;

export const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR'] as const;
