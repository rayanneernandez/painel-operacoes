import supabase from '../lib/supabase';
import { VisitorSession, AnalyticsResponse } from '../types';

export const analyticsService = {
  // Fetch real data from Supabase
  fetchVisitorData: async (): Promise<AnalyticsResponse> => {
    try {
      const { data, error, count } = await supabase
        .from('visitor_sessions')
        .select('*', { count: 'exact' });

      if (error) {
        console.error('Error fetching visitor data:', error);
        return {
          pagination: { limit: 100, offset: 0, total: 0 },
          payload: []
        };
      }

      // If no data in DB, return empty array (or mock data if you prefer for testing)
      return {
        pagination: { limit: 100, offset: 0, total: count || 0 },
        payload: (data as any[]) || [] 
      };
    } catch (err) {
      console.error('Unexpected error:', err);
      return {
        pagination: { limit: 100, offset: 0, total: 0 },
        payload: []
      };
    }
  },

  // The Core Calculation Logic requested by the User
  calculateDashboardStats: (sessions: VisitorSession[]) => {
    const totalVisitors = sessions.length;
    
    // Average Dwell Time
    const totalDuration = sessions.reduce((acc, curr) => acc + curr.tracks_duration, 0);
    const avgDwellTime = totalVisitors > 0 ? Math.round(totalDuration / totalVisitors) : 0;

    // Gender Distribution
    const males = sessions.filter(s => s.sex === 1).length;
    const females = sessions.filter(s => s.sex === 2).length;

    // Age Distribution (Simplified buckets)
    const ageGroups: Record<string, number> = {
      '18-24': 0, '25-34': 0, '35-44': 0, '45-54': 0, '55+': 0
    };
    
    sessions.forEach(s => {
      if (s.age >= 18 && s.age <= 24) ageGroups['18-24']++;
      else if (s.age >= 25 && s.age <= 34) ageGroups['25-34']++;
      else if (s.age >= 35 && s.age <= 44) ageGroups['35-44']++;
      else if (s.age >= 45 && s.age <= 54) ageGroups['45-54']++;
      else if (s.age >= 55) ageGroups['55+']++;
    });

    // Hourly Traffic (Simplified based on start time)
    const hourlyTraffic = new Array(24).fill(0);
    sessions.forEach(s => {
      const hour = new Date(s.start).getHours();
      if (hour >= 0 && hour < 24) hourlyTraffic[hour]++;
    });

    return {
      totalVisitors,
      avgDwellTime, // in seconds
      gender: { male: males, female: females },
      ageGroups,
      hourlyTraffic
    };
  }
};