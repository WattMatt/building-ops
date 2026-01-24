import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Calendar, AlertTriangle, Clock, CheckCircle, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  differenceInDays,
  isPast,
} from 'date-fns';

interface Asset {
  id: string;
  name: string;
  category: string;
  next_service_date: string | null;
  last_service_date: string | null;
  status: string;
}

interface MaintenanceCalendarTabProps {
  buildingId: string;
}

const ASSET_CATEGORIES: Record<string, string> = {
  hvac: 'HVAC System',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  fire_safety: 'Fire Safety',
  elevator: 'Elevator/Lift',
  generator: 'Generator',
  security: 'Security System',
  other: 'Other',
};

export default function MaintenanceCalendarTab({ buildingId }: MaintenanceCalendarTabProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    fetchAssets();
  }, [buildingId]);

  const fetchAssets = async () => {
    try {
      const { data, error } = await supabase
        .from('building_assets')
        .select('id, name, category, next_service_date, last_service_date, status')
        .eq('building_id', buildingId)
        .order('next_service_date');

      if (error) throw error;
      setAssets(data || []);
    } catch (error) {
      console.error('Error fetching assets:', error);
      toast.error('Failed to load maintenance schedule');
    } finally {
      setLoading(false);
    }
  };

  const { overdueAssets, upcomingAssets, assetsByDate } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdue: Asset[] = [];
    const upcoming: Asset[] = [];
    const byDate: Record<string, Asset[]> = {};

    assets.forEach((asset) => {
      if (!asset.next_service_date) return;

      const serviceDate = new Date(asset.next_service_date);
      serviceDate.setHours(0, 0, 0, 0);
      const dateKey = format(serviceDate, 'yyyy-MM-dd');

      if (!byDate[dateKey]) {
        byDate[dateKey] = [];
      }
      byDate[dateKey].push(asset);

      if (isPast(serviceDate) && !isSameDay(serviceDate, today)) {
        overdue.push(asset);
      } else {
        const daysUntil = differenceInDays(serviceDate, today);
        if (daysUntil <= 30) {
          upcoming.push(asset);
        }
      }
    });

    return { overdueAssets: overdue, upcomingAssets: upcoming, assetsByDate: byDate };
  }, [assets]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const getAssetsForDate = (date: Date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return assetsByDate[dateKey] || [];
  };

  const getCategoryLabel = (category: string) => ASSET_CATEGORIES[category] || category;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className={overdueAssets.length > 0 ? 'border-destructive' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${overdueAssets.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overdueAssets.length}</div>
            <p className="text-xs text-muted-foreground">assets need immediate attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              Due in 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{upcomingAssets.length}</div>
            <p className="text-xs text-muted-foreground">upcoming maintenance tasks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" />
              Total Assets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assets.length}</div>
            <p className="text-xs text-muted-foreground">
              {assets.filter((a) => a.next_service_date).length} with scheduled maintenance
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Maintenance Calendar
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium min-w-[140px] text-center">
                {format(currentMonth, 'MMMM yyyy')}
              </span>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const dayAssets = getAssetsForDate(day);
                const hasOverdue = dayAssets.some(
                  (a) => isPast(new Date(a.next_service_date!)) && !isToday(new Date(a.next_service_date!))
                );
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isCurrentMonth = isSameMonth(day, currentMonth);

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDate(isSameDay(day, selectedDate!) ? null : day)}
                    className={`
                      relative min-h-[60px] p-1 rounded-lg border text-left transition-colors
                      ${!isCurrentMonth ? 'text-muted-foreground/50 bg-muted/30' : 'bg-background'}
                      ${isToday(day) ? 'border-primary' : 'border-border'}
                      ${isSelected ? 'ring-2 ring-primary' : ''}
                      ${dayAssets.length > 0 ? 'hover:bg-accent cursor-pointer' : 'cursor-default'}
                    `}
                  >
                    <span
                      className={`
                        text-sm font-medium
                        ${isToday(day) ? 'bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center' : ''}
                      `}
                    >
                      {format(day, 'd')}
                    </span>
                    {dayAssets.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {dayAssets.slice(0, 2).map((asset) => (
                          <div
                            key={asset.id}
                            className={`
                              text-[10px] px-1 py-0.5 rounded truncate
                              ${hasOverdue ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'}
                            `}
                          >
                            {asset.name}
                          </div>
                        ))}
                        {dayAssets.length > 2 && (
                          <div className="text-[10px] text-muted-foreground px-1">
                            +{dayAssets.length - 2} more
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Side panel - Selected date or overdue list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {selectedDate
                ? format(selectedDate, 'EEEE, MMM d')
                : overdueAssets.length > 0
                ? 'Overdue Maintenance'
                : 'Upcoming Maintenance'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedDate ? (
              <SelectedDateAssets assets={getAssetsForDate(selectedDate)} getCategoryLabel={getCategoryLabel} />
            ) : overdueAssets.length > 0 ? (
              <AssetList assets={overdueAssets} getCategoryLabel={getCategoryLabel} showOverdue />
            ) : upcomingAssets.length > 0 ? (
              <AssetList assets={upcomingAssets} getCategoryLabel={getCategoryLabel} />
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Wrench className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No upcoming maintenance scheduled</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SelectedDateAssets({
  assets,
  getCategoryLabel,
}: {
  assets: Asset[];
  getCategoryLabel: (cat: string) => string;
}) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Calendar className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No maintenance scheduled for this date</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assets.map((asset) => (
        <div key={asset.id} className="p-3 rounded-lg border bg-accent/50">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-sm">{asset.name}</p>
              <p className="text-xs text-muted-foreground">{getCategoryLabel(asset.category)}</p>
            </div>
            <Badge variant="outline" className="text-xs">
              {asset.status.replace('_', ' ')}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssetList({
  assets,
  getCategoryLabel,
  showOverdue = false,
}: {
  assets: Asset[];
  getCategoryLabel: (cat: string) => string;
  showOverdue?: boolean;
}) {
  const today = new Date();

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      {assets.map((asset) => {
        const serviceDate = new Date(asset.next_service_date!);
        const daysUntil = differenceInDays(serviceDate, today);

        return (
          <div key={asset.id} className="p-3 rounded-lg border">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="font-medium text-sm">{asset.name}</p>
              {showOverdue ? (
                <Badge variant="destructive" className="text-xs">
                  {Math.abs(daysUntil)}d overdue
                </Badge>
              ) : (
                <Badge variant={daysUntil <= 7 ? 'outline' : 'secondary'} className="text-xs">
                  {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `${daysUntil}d`}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{getCategoryLabel(asset.category)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {format(serviceDate, 'EEE, MMM d, yyyy')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
