/**
 * Quick stats summary cards for form submissions
 */

import { Card, CardContent } from '@/components/ui/card';
import { Clock, CheckCircle, XCircle, Eye, FileText } from 'lucide-react';

interface SubmissionStatsProps {
  total: number;
  pending: number;
  reviewed: number;
  approved: number;
  rejected: number;
}

export function SubmissionStats({
  total,
  pending,
  reviewed,
  approved,
  rejected,
}: SubmissionStatsProps) {
  const stats = [
    {
      label: 'Total',
      value: total,
      icon: FileText,
      className: 'text-muted-foreground',
      bgClass: 'bg-muted/50',
    },
    {
      label: 'Pending',
      value: pending,
      icon: Clock,
      className: 'text-amber-600',
      bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    },
    {
      label: 'Reviewed',
      value: reviewed,
      icon: Eye,
      className: 'text-blue-600',
      bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    },
    {
      label: 'Approved',
      value: approved,
      icon: CheckCircle,
      className: 'text-green-600',
      bgClass: 'bg-green-50 dark:bg-green-950/30',
    },
    {
      label: 'Rejected',
      value: rejected,
      icon: XCircle,
      className: 'text-red-600',
      bgClass: 'bg-red-50 dark:bg-red-950/30',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {stats.map((stat) => (
        <Card key={stat.label} className={`${stat.bgClass} border-0`}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <stat.icon className={`h-4 w-4 ${stat.className}`} />
              <span className={`text-2xl font-bold ${stat.className}`}>
                {stat.value}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
