import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileWarning,
  Wrench,
  AlertTriangle,
  Building2,
  Calendar,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { format, differenceInDays, isPast, addDays } from 'date-fns';

interface ExpiringDocument {
  id: string;
  name: string;
  document_type: string;
  expiry_date: string;
  building_id: string;
  building_name: string;
}

interface OverdueMaintenance {
  id: string;
  name: string;
  category: string;
  next_service_date: string;
  building_id: string;
  building_name: string;
  days_overdue: number;
}

export default function GlobalAlertsWidget() {
  const [loading, setLoading] = useState(true);
  const [expiringDocuments, setExpiringDocuments] = useState<ExpiringDocument[]>([]);
  const [overdueMaintenance, setOverdueMaintenance] = useState<OverdueMaintenance[]>([]);

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const thirtyDaysFromNow = addDays(today, 30);

      // Fetch expiring documents (within 30 days or expired)
      const { data: documentsData } = await supabase
        .from('building_documents')
        .select(`
          id,
          name,
          document_type,
          expiry_date,
          building_id,
          buildings (name)
        `)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', format(thirtyDaysFromNow, 'yyyy-MM-dd'))
        .order('expiry_date');

      if (documentsData) {
        setExpiringDocuments(documentsData.map(doc => ({
          id: doc.id,
          name: doc.name,
          document_type: doc.document_type,
          expiry_date: doc.expiry_date!,
          building_id: doc.building_id,
          building_name: (doc.buildings as any)?.name || 'Unknown',
        })));
      }

      // Fetch overdue maintenance (past next_service_date)
      const { data: assetsData } = await supabase
        .from('building_assets')
        .select(`
          id,
          name,
          category,
          next_service_date,
          building_id,
          buildings (name)
        `)
        .not('next_service_date', 'is', null)
        .lt('next_service_date', format(today, 'yyyy-MM-dd'))
        .order('next_service_date');

      if (assetsData) {
        setOverdueMaintenance(assetsData.map(asset => ({
          id: asset.id,
          name: asset.name,
          category: asset.category,
          next_service_date: asset.next_service_date!,
          building_id: asset.building_id,
          building_name: (asset.buildings as any)?.name || 'Unknown',
          days_overdue: differenceInDays(today, new Date(asset.next_service_date!)),
        })));
      }
    } catch (error) {
      console.error('Error fetching global alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getExpiryBadge = (expiryDate: string) => {
    const days = differenceInDays(new Date(expiryDate), new Date());
    if (days < 0) {
      return <Badge variant="destructive">Expired</Badge>;
    } else if (days <= 7) {
      return <Badge className="bg-destructive/80 text-destructive-foreground">Expires in {days}d</Badge>;
    } else if (days <= 14) {
      return <Badge className="bg-warning text-warning-foreground">Expires in {days}d</Badge>;
    } else {
      return <Badge variant="secondary">Expires in {days}d</Badge>;
    }
  };

  const getOverdueBadge = (daysOverdue: number) => {
    if (daysOverdue > 30) {
      return <Badge variant="destructive">{daysOverdue}d overdue</Badge>;
    } else if (daysOverdue > 14) {
      return <Badge className="bg-destructive/80 text-destructive-foreground">{daysOverdue}d overdue</Badge>;
    } else {
      return <Badge className="bg-warning text-warning-foreground">{daysOverdue}d overdue</Badge>;
    }
  };

  const totalAlerts = expiringDocuments.length + overdueMaintenance.length;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (totalAlerts === 0) {
    return null;
  }

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <CardTitle>Global Alerts</CardTitle>
            <CardDescription>
              {totalAlerts} alert{totalAlerts !== 1 ? 's' : ''} across all buildings requiring attention
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="documents" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="documents" className="gap-2">
              <FileWarning className="h-4 w-4" />
              Documents ({expiringDocuments.length})
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="gap-2">
              <Wrench className="h-4 w-4" />
              Maintenance ({overdueMaintenance.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="space-y-3">
            {expiringDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No expiring documents
              </p>
            ) : (
              <>
                {expiringDocuments.slice(0, 5).map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-card border"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <FileWarning className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{doc.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" />
                          <span className="truncate">{doc.building_name}</span>
                          <span>•</span>
                          <span>{doc.document_type}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getExpiryBadge(doc.expiry_date)}
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/buildings/${doc.building_id}?tab=documents`}>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
                {expiringDocuments.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{expiringDocuments.length - 5} more documents
                  </p>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-3">
            {overdueMaintenance.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No overdue maintenance
              </p>
            ) : (
              <>
                {overdueMaintenance.slice(0, 5).map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-card border"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Wrench className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{asset.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Building2 className="h-3 w-3" />
                          <span className="truncate">{asset.building_name}</span>
                          <span>•</span>
                          <span>{asset.category}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getOverdueBadge(asset.days_overdue)}
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/buildings/${asset.building_id}?tab=maintenance`}>
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
                {overdueMaintenance.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{overdueMaintenance.length - 5} more assets
                  </p>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
