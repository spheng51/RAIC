import { Database, ShieldCheck, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { requireRole } from '@/lib/auth/authorize';
import { getPersistenceMode } from '@/lib/db/client';

export default async function AdminPage() {
  const auth = await requireRole(['org_admin']);
  const persistenceMode = await getPersistenceMode();

  const cards = [
    {
      icon: ShieldCheck,
      title: 'Access model',
      description: 'Teacher and admin routes now resolve through first-party sessions and server-side role checks.',
      value: auth.session.role.replace('_', ' '),
    },
    {
      icon: Database,
      title: 'Server truth',
      description: 'Identity, sessions, join tokens, and audit events now flow through a shared repository layer.',
      value: persistenceMode === 'postgres' ? 'Postgres adapter active' : 'JSON fallback active',
    },
    {
      icon: Users,
      title: 'Workspace',
      description: 'Each teacher signs into an owned workspace now, which is the base for future roster and policy controls.',
      value: auth.organization?.name || 'Personal workspace',
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <Badge variant="secondary">Admin foundation</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">RAIC admin surface</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          This first slice focuses on secure identity, route protection, and audit-ready foundations.
          Policy editing, domain rules, and organization analytics can now build on a consistent access model.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <card.icon className="size-5" />
              </div>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium text-foreground">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
