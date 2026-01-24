import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MAPBOX_ACCESS_TOKEN } from '@/lib/mapbox';

interface SearchResult {
  id: string;
  place_name: string;
  center: [number, number]; // [longitude, latitude]
  place_type: string[];
}

interface MapSearchBoxProps {
  onLocationSelect: (location: { lng: number; lat: number; name: string }) => void;
  placeholder?: string;
  className?: string;
}

export function MapSearchBox({
  onLocationSelect,
  placeholder = 'Search locations...',
  className,
}: MapSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Search for locations using Mapbox Geocoding API
  const searchLocations = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);

    try {
      // Focus on South Africa region with proximity to Pretoria
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?` +
          new URLSearchParams({
            access_token: MAPBOX_ACCESS_TOKEN,
            country: 'ZA',
            proximity: '28.1881,-25.7461', // Pretoria
            types: 'address,poi,neighborhood,locality,place,district,region',
            limit: '5',
          })
      );

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      setResults(data.features || []);
      setIsOpen(true);
    } catch (error) {
      console.error('Geocoding error:', error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim()) {
      debounceRef.current = setTimeout(() => {
        searchLocations(query);
      }, 300);
    } else {
      setResults([]);
      setIsOpen(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectResult = (result: SearchResult) => {
    onLocationSelect({
      lng: result.center[0],
      lat: result.center[1],
      name: result.place_name,
    });
    setQuery(result.place_name.split(',')[0]);
    setIsOpen(false);
    setResults([]);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const getPlaceTypeIcon = (types: string[]) => {
    if (types.includes('poi')) return '📍';
    if (types.includes('address')) return '🏠';
    if (types.includes('neighborhood') || types.includes('locality')) return '🏘️';
    if (types.includes('place') || types.includes('district')) return '🌆';
    if (types.includes('region')) return '🗺️';
    return '📍';
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          className="pl-8 sm:pl-9 pr-8 sm:pr-9 h-9 sm:h-10 text-sm"
        />
        {isLoading ? (
          <Loader2 className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        ) : query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 sm:right-1 top-1/2 -translate-y-1/2 h-7 w-7 sm:h-6 sm:w-6"
            onClick={clearSearch}
          >
            <X className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
          </Button>
        ) : null}
      </div>

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg overflow-hidden">
          <ul className="py-1">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => handleSelectResult(result)}
                  className="w-full px-3 py-2 text-left hover:bg-accent flex items-start gap-2 transition-colors"
                >
                  <span className="mt-0.5">{getPlaceTypeIcon(result.place_type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {result.place_name.split(',')[0]}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {result.place_name.split(',').slice(1).join(',')}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No results message */}
      {isOpen && query && !isLoading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg p-3">
          <p className="text-sm text-muted-foreground text-center">
            No locations found for "{query}"
          </p>
        </div>
      )}
    </div>
  );
}
