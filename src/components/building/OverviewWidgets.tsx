import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, FileText, Wrench, ArrowRight, Clock, CheckCircle } from 'lucide-react';
import { format, differenceInDays, isPast, isSameDay } from 'date-fns';

interface OverviewWidgetsProps {
  buildingId: string;
  onTabChange?: (tab: string) => void;
}

interface ExpiringDocument {
  id: string;
  name: string;
  document_type: string;
  expiry_date: string;
}

interface OverdueAsset {
  id: string;
  name: string;
  category: string;
  next_service_date: string;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  compliance_certificate: 'Compliance Certificate',
  fire_certificate: 'Fire Certificate',
  electrical_coc: 'Electrical COC',
  occupancy_certificate: 'Occupancy Certificate',
  insurance: 'Insurance Policy',
  floor_plan: 'Floor Plan',
  building_plan: 'Building Plan',
  municipal_rates: 'Municipal Rates',
  water_certificate: 'Water Certificate',
  gas_certificate: 'Gas Certificate',
  lift_certificate: 'Lift Certificate',
  other: 'Other',
};

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  fire_safety: 'Fire Safety',
  elevator: 'Elevator',
  generator: 'Generator',
  security: 'Security',
  other: 'Other',
};

export default function OverviewWidgets({ buildingId, onTabChange }: OverviewWidgetsProps) {
  const [expiringDocs, setExpiringDocs] = useState<ExpiringDocument[]>([]);
  const [expiredDocs, setExpiredDocs] = useState<ExpiringDocument[]>([]);
  const [overdueAssets, setOverdueAssets] = useState<OverdueAsset[]>([]);
  const [upcomingAssets, setUpcomingAssets] = useState<OverdueAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [buildingId]);

  const fetchData = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const in30Days = new Date(today);
      in30Days.setDate(in30Days.getDate() + 30);

      // Fetch documents with expiry dates
      const { data: docs, error: docsError } = await supabase
        .from('building_documents')
        .select('id, name, document_type, expiry_date')
        .eq('building_id', buildingId)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', format(in30Days, 'yyyy-MM-dd'))
        .order('expiry_date');

      if (docsError) throw docsError;

      // Separate expired and expiring soon
      const expired: ExpiringDocument[] = [];
      const expiring: ExpiringDocument[] = [];
      
      (docs || []).forEach((doc) => {
        const expiryDate = new Date(doc.expiry_date);
        if (isPast(expiryDate) && !isSameDay(expiryDate, today)) {
          expired.push(doc);
        } else {
          expiring.push(doc);
        }
      });

      setExpiredDocs(expired);
      setExpiringDocs(expiring);

      // Fetch assets with service dates
      const { data: assets, error: assetsError } = await supabase
        .from('building_assets')
        .select('id, name, category, next_service_date')
        .eq('building_id', buildingId)
        .not('next_service_date', 'is', null)
        .lte('next_service_date', format(in30Days, 'yyyy-MM-dd'))
        .order('next_service_date');

      if (assetsError) throw assetsError;

      // Separate overdue and upcoming
      const overdue: OverdueAsset[] = [];
      const upcoming: OverdueAsset[] = [];
      
      (assets || []).forEach((asset) => {
        const serviceDate = new Date(asset.next_service_date);
        if (isPast(serviceDate) && !isSameDay(serviceDate, today)) {
          overdue.push(asset);
        } else {
          upcoming.push(asset);
        }
      });

      setOverdueAssets(overdue);
      setUpcomingAssets(upcoming);
    } catch (error) {
      console.error('Error fetching overview data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getExpiryBadge = (expiryDate: string) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const days = differenceInDays(expiry, today);

    if (days < 0) {
      return (
        <Badge variant="destructive" className="text-xs">
          {Math.abs(days)}d overdue
        </Badge>
      );
    } else if (days === 0) {
      return (
        <Badge variant="destructive" className="text-xs">
          Today
        </Badge>
      );
    } else if (days <= 7) {
      return (
        <Badge variant="outline" className="text-xs border-destructive text-destructive">
          {days}d left
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="text-xs">
          {days}d left
        </Badge>
      );
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="animate-pulse">
          <CardHeader className="pb-3">
            <div className="h-5 w-32 bg-muted rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-20 bg-muted rounded" />
          </CardContent>
        </Card>
        <Card className="animate-pulse">
          <CardHeader className="pb-3">
            <div className="h-5 w-32 bg-muted rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-20 bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalDocAlerts = expiredDocs.length + expiringDocs.length;
  const totalAssetAlerts = overdueAssets.length + upcomingAssets.length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Documents Widget */}
      <Card className={expiredDocs.length > 0 ? 'border-destructive' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Document Expiry Alerts
              {totalDocAlerts > 0 && (
                <Badge variant={expiredDocs.length > 0 ? 'destructive' : 'secondary'}>
                  {totalDocAlerts}
                </Badge>
              )}
            </CardTitle>
            {totalDocAlerts > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onTabChange?.('documents')}>
                View All
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {totalDocAlerts === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium text-sm">All documents current</p>
                <p className="text-xs text-muted-foreground">No expiring documents in the next 30 days</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[200px] overflow-y-auto">
              {/* Expired documents first */}
              {expiredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </p>
                  </div>
                  {getExpiryBadge(doc.expiry_date)}
                </div>
              ))}
              {/* Expiring soon */}
              {expiringDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </p>
                  </div>
                  {getExpiryBadge(doc.expiry_date)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Maintenance Widget */}
      <Card className={overdueAssets.length > 0 ? 'border-destructive' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Maintenance Alerts
              {totalAssetAlerts > 0 && (
                <Badge variant={overdueAssets.length > 0 ? 'destructive' : 'secondary'}>
                  {totalAssetAlerts}
                </Badge>
              )}
            </CardTitle>
            {totalAssetAlerts > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onTabChange?.('maintenance')}>
                View All
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {totalAssetAlerts === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium text-sm">All maintenance current</p>
                <p className="text-xs text-muted-foreground">No overdue or upcoming service in the next 30 days</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[200px] overflow-y-auto">
              {/* Overdue assets first */}
              {overdueAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                    </p>
                  </div>
                  {getExpiryBadge(asset.next_service_date)}
                </div>
              ))}
              {/* Upcoming maintenance */}
              {upcomingAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                    </p>
                  </div>
                  {getExpiryBadge(asset.next_service_date)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
