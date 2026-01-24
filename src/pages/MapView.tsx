import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Building2 } from 'lucide-react';

export default function MapView() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Map View</h1>
          <p className="text-muted-foreground">
            View your buildings on a map
          </p>
        </div>
      </div>

      {/* Map Placeholder */}
      <Card className="min-h-[600px]">
        <CardContent className="flex flex-col items-center justify-center h-full py-24">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
            <MapPin className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Map Integration Coming Soon</h3>
          <p className="text-muted-foreground text-center max-w-md mb-6">
            Mapbox integration will allow you to view all your buildings on an interactive map,
            with pin drops for each location.
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span>8 buildings in portfolio</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span>City of Tshwane region</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
