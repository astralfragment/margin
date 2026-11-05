import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * A titled card that groups related settings.
 * @param props.title The heading.
 * @param props.description One sentence under the heading.
 * @param props.action A control beside the heading, such as an Optional badge.
 * @param props.children The settings.
 */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-5 py-5 [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <h2>{title}</h2>
          {action}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
