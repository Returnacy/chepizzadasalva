import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ComparisonTab } from '../features/location-insights/components/ComparisonTab';
import { AcquisitionTab } from '../features/location-insights/components/AcquisitionTab';
import { CrossLocationTab } from '../features/location-insights/components/CrossLocationTab';
import { RetentionTab } from '../features/location-insights/components/RetentionTab';
import { RewardFunnelTab } from '../features/location-insights/components/RewardFunnelTab';
import { HeatmapTab } from '../features/location-insights/components/HeatmapTab';

// Group B — dedicated per-location analytics, kept off the main owner dashboard
// so each can be a focused, deep view. A single period selector drives them all.
export default function LocationInsightsPage() {
  const [days, setDays] = useState('30');
  const d = parseInt(days, 10) || 30;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center">
            <MapPin className="w-7 h-7 mr-2 text-brand-blue" />Analisi Sedi
          </h1>
          <p className="text-gray-600">Analisi approfondite per pizzeria — Che Pizza</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40" aria-label="Periodo"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 giorni</SelectItem>
            <SelectItem value="14">14 giorni</SelectItem>
            <SelectItem value="30">30 giorni</SelectItem>
            <SelectItem value="90">90 giorni</SelectItem>
            <SelectItem value="365">365 giorni</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="comparison" className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="comparison">Confronto</TabsTrigger>
          <TabsTrigger value="acquisition">Acquisizione</TabsTrigger>
          <TabsTrigger value="cross">Wallet condiviso</TabsTrigger>
          <TabsTrigger value="retention">Fidelizzazione</TabsTrigger>
          <TabsTrigger value="rewards">Premi</TabsTrigger>
          <TabsTrigger value="hours">Orari</TabsTrigger>
        </TabsList>

        <TabsContent value="comparison" className="mt-6"><ComparisonTab days={d} /></TabsContent>
        <TabsContent value="acquisition" className="mt-6"><AcquisitionTab days={d} /></TabsContent>
        <TabsContent value="cross" className="mt-6"><CrossLocationTab days={d} /></TabsContent>
        <TabsContent value="retention" className="mt-6"><RetentionTab days={d} /></TabsContent>
        <TabsContent value="rewards" className="mt-6"><RewardFunnelTab days={d} /></TabsContent>
        <TabsContent value="hours" className="mt-6"><HeatmapTab days={d} /></TabsContent>
      </Tabs>
    </div>
  );
}
