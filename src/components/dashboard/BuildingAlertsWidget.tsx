/**
 * Dashboard widget showing buildings with expiring documents or overdue maintenance
 * Groups alerts by building for a quick overview
 */

import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileWarning,
  Wrench,
  Building2,
  ArrowRight,
  Loader2,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, differenceInDays, addDays } from 'date-fns';
import { BuildingAvatar } from '@/components/building/BuildingAvatar';

interface BuildingAlert {
  building_id: string;
  building_name: string;
  logo_url: string | null;
  expiring_documents: number;
  expired_documents: number;
  overdue_maintenance: number;
  upcoming_maintenance: number;
  most_urgent_date: string | null;
  urgency: 'critical' | 'warning' | 'info';
}

export default function BuildingAlertsWidget() {
  const [loading, setLoading] = useState(true);
  const [buildingAlerts, setBuildingAlerts] = useState<BuildingAlert[]>([]);

  useEffect(() => {
    fetchBuildingAlerts();
  }, []);

  const fetchBuildingAlerts = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const thirtyDaysFromNow = format(addDays(today, 30), 'yyyy-MM-dd');
      const sevenDaysFromNow = format(addDays(today, 7), 'yyyy-MM-dd');

      // Fetch buildings with their alerts
      const { data: buildings } = await supabase
        .from('buildings')
        .select('id, name, logo_url');

      if (!buildings) {
        setBuildingAlerts([]);
        return;
      }

      // Fetch all relevant documents
      const { data: documentsData } = await supabase
        .from('building_documents')
        .select('building_id, expiry_date')
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thirtyDaysFromNow);

      // Fetch all overdue/upcoming maintenance
      const { data: assetsData } = await supabase
        .from('building_assets')
        .select('building_id, next_service_date')
        .not('next_service_date', 'is', null)
        .lte('next_service_date', sevenDaysFromNow);

      // Aggregate alerts by building
      const alertsMap = new Map<string, BuildingAlert>();

      buildings.forEach(building => {
        alertsMap.set(building.id, {
          building_id: building.id,
          building_name: building.name,
          logo_url: building.logo_url,
          expiring_documents: 0,
          expired_documents: 0,
          overdue_maintenance: 0,
          upcoming_maintenance: 0,
          most_urgent_date: null,
          urgency: 'info',
        });
      });

      // Count document alerts
      documentsData?.forEach(doc => {
        const alert = alertsMap.get(doc.building_id);
        if (alert && doc.expiry_date) {
          const isExpired = doc.expiry_date < todayStr;
          if (isExpired) {
            alert.expired_documents++;
          } else {
            alert.expiring_documents++;
          }
          // Track most urgent
          if (!alert.most_urgent_date || doc.expiry_date < alert.most_urgent_date) {
            alert.most_urgent_date = doc.expiry_date;
          }
        }
      });

      // Count maintenance alerts
      assetsData?.forEach(asset => {
        const alert = alertsMap.get(asset.building_id);
        if (alert && asset.next_service_date) {
          const isOverdue = asset.next_service_date < todayStr;
          if (isOverdue) {
            alert.overdue_maintenance++;
          } else {
            alert.upcoming_maintenance++;
          }
          // Track most urgent
          if (!alert.most_urgent_date || asset.next_service_date < alert.most_urgent_date) {
            alert.most_urgent_date = asset.next_service_date;
          }
        }
      });

      // Calculate urgency and filter buildings with alerts
      const buildingsWithAlerts = Array.from(alertsMap.values())
        .filter(alert => 
          alert.expired_documents > 0 || 
          alert.expiring_documents > 0 || 
          alert.overdue_maintenance > 0 ||
          alert.upcoming_maintenance > 0
        )
        .map(alert => {
          // Determine urgency level
          if (alert.expired_documents > 0 || alert.overdue_maintenance > 0) {
            alert.urgency = 'critical';
          } else if (alert.most_urgent_date) {
            const days = differenceInDays(new Date(alert.most_urgent_date), today);
            alert.urgency = days <= 7 ? 'warning' : 'info';
          }
          return alert;
        })
        .sort((a, b) => {
          // Sort by urgency first, then by date
          const urgencyOrder = { critical: 0, warning: 1, info: 2 };
          if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
            return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
          }
          if (a.most_urgent_date && b.most_urgent_date) {
            return a.most_urgent_date.localeCompare(b.most_urgent_date);
          }
          return 0;
        });

      setBuildingAlerts(buildingsWithAlerts);
    } catch (error) {
      console.error('Error fetching building alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUrgencyStyles = (urgency: string) => {
    switch (urgency) {
      case 'critical':
        return 'border-destructive/50 bg-destructive/5';
      case 'warning':
        return 'border-warning/50 bg-warning/5';
      default:
        return 'border-border';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (buildingAlerts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Building Health</CardTitle>
              <CardDescription>Document & maintenance status by building</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-success mb-2" />
            <p className="text-sm font-medium">All buildings healthy</p>
            <p className="text-xs text-muted-foreground">No expiring documents or overdue maintenance</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const criticalCount = buildingAlerts.filter(b => b.urgency === 'critical').length;
  const warningCount = buildingAlerts.filter(b => b.urgency === 'warning').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-warning" />
            <div>
              <CardTitle>Building Health</CardTitle>
              <CardDescription>
                {buildingAlerts.length} building{buildingAlerts.length !== 1 ? 's' : ''} need attention
                {criticalCount > 0 && (
                  <Badge variant="destructive" className="ml-2">{criticalCount} critical</Badge>
                )}
                {warningCount > 0 && (
                  <Badge className="ml-2 bg-warning text-warning-foreground">{warningCount} warning</Badge>
                )}
              </CardDescription>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/buildings">
              View all
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[280px] pr-4">
          <div className="space-y-3">
            {buildingAlerts.map((alert) => (
              <div
                key={alert.building_id}
                className={`flex items-center justify-between p-3 rounded-lg border ${getUrgencyStyles(alert.urgency)}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <BuildingAvatar 
                    name={alert.building_name} 
                    logoUrl={alert.logo_url} 
                    size="sm" 
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{formatBuildingName(alert.building_name)}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {(alert.expired_documents > 0 || alert.expiring_documents > 0) && (
                        <div className="flex items-center gap-1 text-xs">
                          <FileWarning className={`h-3 w-3 ${alert.expired_documents > 0 ? 'text-destructive' : 'text-warning'}`} />
                          <span className="text-muted-foreground">
                            {alert.expired_documents > 0 && (
                              <span className="text-destructive font-medium">{alert.expired_documents} expired</span>
                            )}
                            {alert.expired_documents > 0 && alert.expiring_documents > 0 && ', '}
                            {alert.expiring_documents > 0 && (
                              <span>{alert.expiring_documents} expiring</span>
                            )}
                          </span>
                        </div>
                      )}
                      {(alert.overdue_maintenance > 0 || alert.upcoming_maintenance > 0) && (
                        <div className="flex items-center gap-1 text-xs">
                          <Wrench className={`h-3 w-3 ${alert.overdue_maintenance > 0 ? 'text-destructive' : 'text-warning'}`} />
                          <span className="text-muted-foreground">
                            {alert.overdue_maintenance > 0 && (
                              <span className="text-destructive font-medium">{alert.overdue_maintenance} overdue</span>
                            )}
                            {alert.overdue_maintenance > 0 && alert.upcoming_maintenance > 0 && ', '}
                            {alert.upcoming_maintenance > 0 && (
                              <span>{alert.upcoming_maintenance} due soon</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/buildings/${alert.building_id}`}>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
