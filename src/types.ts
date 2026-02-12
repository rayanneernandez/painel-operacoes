export type Device = {
  id: string;
  name: string;
  type: 'camera' | 'sensor' | 'gateway';
  macAddress: string;
  status: 'online' | 'offline';
};

export type Store = {
  id: string;
  name: string;
  city: string;
  devices: Device[];
};

export type Client = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: 'active' | 'inactive' | 'pending';
  plan: 'enterprise' | 'pro' | 'basic';
  apisConnected: number;
  createdAt: string;
  initials: string;
  color: string;
  stores?: Store[];
};

// New Types for Analytics Data
export type AnalyticsAttribute = {
  smile: 'yes' | 'no';
  pitch: number;
  yaw: number;
  x: number;
  y: number;
  height: number;
  start_time: string;
  end_time: string;
  duration: number;
};

export type VisitorSession = {
  session_id: string;
  visitor_id: string;
  start: string;
  end: string;
  face_quality: number;
  facial_hair: string;
  hair_color: string;
  hair_type: string;
  headwear: string;
  glasses?: string;
  additional_atributes: AnalyticsAttribute[];
  tracks_count: number;
  tracks_duration: number;
  content_view_duration: number;
  age: number;
  age_deviation: number;
  sex: number; // 1 = Male, 2 = Female
  devices: number[];
  campaigns: number[];
  tracks: any[];
};

export type AnalyticsResponse = {
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  payload: VisitorSession[];
};