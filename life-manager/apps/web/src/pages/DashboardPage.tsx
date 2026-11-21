import React from 'react';
import { RoomMonitorView } from '../components/monitor/RoomMonitorView';

export interface DashboardPageProps {
  kioskMode?: boolean;
  slug?: string;
  onNavigate: (to: string) => void;
}

export function DashboardPage({ kioskMode = false, slug, onNavigate }: DashboardPageProps) {
  return <RoomMonitorView kioskMode={kioskMode} initialSlug={slug} onNavigate={onNavigate} />;
}
