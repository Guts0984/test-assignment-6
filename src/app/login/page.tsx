import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/auth';
import { getPageUser } from '@/server/modules/auth/http';

export default async function LoginPage() {
  if (await getPageUser()) redirect('/calendar');
  return (
    <main>
      <LoginForm />
    </main>
  );
}
