import { redirect } from 'next/navigation';
import { getPageUser } from '@/server/modules/auth/http';

export default async function HomePage() {
  redirect((await getPageUser()) ? '/calendar' : '/login');
}
