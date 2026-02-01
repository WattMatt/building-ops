import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Plus,
  Search,
  MapPin,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BuildingAvatar } from '@/components/building/BuildingAvatar';

interface Building {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  logo_position: string | null;
  created_at: string;
}

export default function Buildings() {
  const { isAdminOrManager } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchBuildings();
  }, []);

  const fetchBuildings = async () => {
    try {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, name, address, city, latitude, longitude, logo_url, logo_position, created_at')
        .order('name');

      if (error) throw error;
      setBuildings(data || []);
    } catch (error) {
      console.error('Error fetching buildings:', error);
      toast.error('Failed to load buildings');
    } finally {
      setLoading(false);
    }
  };

  const filteredBuildings = buildings.filter(
    (building) =>
      building.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      building.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      building.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this building?')) return;

    try {
      const { error } = await supabase.from('buildings').delete().eq('id', id);
      if (error) throw error;
      
      setBuildings(buildings.filter((b) => b.id !== id));
      toast.success('Building deleted successfully');
    } catch (error) {
      console.error('Error deleting building:', error);
      toast.error('Failed to delete building');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Buildings</h1>
          <p className="text-muted-foreground">
            Manage your building portfolio
          </p>
        </div>
        {isAdminOrManager && (
          <Button asChild>
            <Link to="/buildings/new">
              <Plus className="w-4 h-4 mr-2" />
              Add Building
            </Link>
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search buildings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Buildings Grid */}
      {filteredBuildings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No buildings found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery
                ? 'Try adjusting your search terms'
                : 'Get started by adding your first building'}
            </p>
            {isAdminOrManager && !searchQuery && (
              <Button asChild>
                <Link to="/buildings/new">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Building
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBuildings.map((building) => {
            const position = building.logo_position || 'top-left';

            return (
              <Card key={building.id} className="group hover:shadow-md transition-shadow relative overflow-hidden">
                {/* Top-center logo banner */}
                {position === 'top-center' && (
                  <div className="flex justify-center pt-4 pb-2">
                    <BuildingAvatar name={building.name} logoUrl={building.logo_url} size="lg" />
                  </div>
                )}
                
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  {/* Left side: avatar (if top-left) + text */}
                  <div className="flex items-start gap-3">
                    {position === 'top-left' && (
                      <BuildingAvatar name={building.name} logoUrl={building.logo_url} size="md" />
                    )}
                    <div>
                      <CardTitle className="text-base">{building.name}</CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {building.city}
                      </CardDescription>
                    </div>
                  </div>
                  
                  {/* Right side: avatar (if top-right) + menu */}
                  <div className="flex items-start gap-2">
                    {position === 'top-right' && (
                      <BuildingAvatar name={building.name} logoUrl={building.logo_url} size="md" />
                    )}
                    {isAdminOrManager && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/buildings/${building.id}`}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/buildings/${building.id}/edit`}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(building.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {building.address}
                  </p>
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">
                      {building.latitude && building.longitude
                        ? 'Location set'
                        : 'No location'}
                    </Badge>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/buildings/${building.id}`}>
                        View
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
