import { useState, useEffect } from 'react';
import { Search, Plus, LayoutDashboard, Link as LinkIcon, Edit, Trash2, X, Building, Mail, Phone, Key, Server, Settings, Upload, FileText, Lock, Shield, Eye, BarChart2, Download, ChevronDown, ChevronUp, MapPin, Building2, CheckCircle2, Activity, Camera, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logService } from '../services/logService';
import supabase from '../lib/supabase';

// Componente Toggle
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <button 
    onClick={onChange}
    className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-emerald-500' : 'bg-gray-700'}`}
  >
    <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
  </button>
);

type Client = {
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
  logo_url?: string;
  entry_date?: string;
};

type Device = {
  id: string;
  name: string;
  type: 'camera' | 'sensor' | 'gateway';
  macAddress: string;
  status: 'online' | 'offline';
};

type Store = {
  id: string;
  name: string;
  city: string;
  devices: Device[];
};

export function Clients() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'permissions' | 'api' | 'stores'>('details');
  const [_loading, setLoading] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    status: 'active' as 'active' | 'inactive' | 'pending',
    plan: 'basic' as 'enterprise' | 'pro' | 'basic',
    notes: '',
    logo_url: '',
    entryDate: ''
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // ✅ CORREÇÃO 1: customHeaderKey e customHeaderValue começam VAZIOS
  // O token vai apenas em api_key (X-API-Token). Nunca preencher Authorization aqui.
  const emptyApiConfig = () => ({
    environment: 'production',
    authMethod: 'token',
    endpoint: 'https://api.displayforce.ai',
    folderEndpoint: '/public/v1/device-folder/list',
    deviceEndpoint: '/public/v1/device/list',
    analyticsEndpoint: '/public/v1/stats/visitor/list',
    token: '',
    customHeaderKey: '',   // ← VAZIO, não 'Authorization'
    customHeaderValue: '', // ← VAZIO, não 'Bearer TOKEN'
    docUrl: '',
    collectionStart: '',
    collectionEnd: '',
    collectTracks: true,
    collectFaceQuality: true,
    collectGlasses: true,
    collectBeard: true,
    collectHairColor: true,
    collectHairType: true,
    collectHeadwear: true
  });

  const [apiConfig, setApiConfig] = useState(emptyApiConfig());
  const [connectionSuccess, setConnectionSuccess] = useState(false);
  const [fetchedAnalytics, setFetchedAnalytics] = useState<any[]>([]);
  const [editingStores, setEditingStores] = useState<Store[]>([]);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const getClientStores = (clientId: string): Store[] => {
    const client = clients.find(c => c.id === clientId);
    return client?.stores || [];
  };

  const fetchClients = async () => {
    try {
      setLoading(true);
      const { data: clientsData, error: clientsError } = await supabase
        .from('clients')
        .select('*');

      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('id, name, city, client_id')
        .range(0, 9999);

      if (storesData) {
        console.log(`DEBUG: Total de lojas carregadas do banco: ${storesData.length}`);
      }
      
      const { data: devicesData, error: devicesError } = await supabase
        .from('devices')
        .select('id, name, type, mac_address, status, store_id')
        .range(0, 9999);
      
      if (clientsError) throw clientsError;
      if (storesError) console.error('Error fetching stores:', storesError);
      if (devicesError) console.error('Error fetching devices:', devicesError);

      if (clientsData) {
        const devicesByStore: Record<string, any[]> = {};
        (devicesData || []).forEach((d: any) => {
          const sid = d.store_id;
          if (!devicesByStore[sid]) devicesByStore[sid] = [];
          const exists = devicesByStore[sid].some(
             (existing: any) => existing.macAddress === d.mac_address
          );
          if (!exists) {
              devicesByStore[sid].push({ 
                  id: d.id, 
                  name: d.name, 
                  type: d.type, 
                  macAddress: d.mac_address, 
                  status: d.status 
              });
          }
        });

        const storesByClient: Record<string, any[]> = {};
        (storesData || []).forEach((s: any) => {
          const cid = s.client_id;
          if (!storesByClient[cid]) storesByClient[cid] = [];
          storesByClient[cid].push({ id: s.id, name: s.name, city: s.city, devices: devicesByStore[s.id] || [] });
        });

        const formattedClients: Client[] = clientsData.map(client => ({
          ...client,
          initials: client.name.substring(0, 1).toUpperCase(),
          color: 'bg-indigo-600',
          stores: storesByClient[client.id] || []
        }));
        setClients(formattedClients);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const [perms, setPerms] = useState({
    view_dashboard: true,
    view_reports: false,
    view_analytics: false,
    export_data: false,
    manage_settings: false
  });

  const togglePerm = (key: keyof typeof perms) => {
    setPerms(p => ({ ...p, [key]: !p[key] }));
  };

  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleTestConnection = async () => {
    setApiStatus('testing');
    setConnectionSuccess(false);

    try {
      if (!apiConfig.token) {
        throw new Error('Token de API é obrigatório');
      }

      const tokenTrim = apiConfig.token.trim();
      const endpoint  = (apiConfig.endpoint || 'https://api.displayforce.ai').trim();

      /**
       * callProxy — envia a requisição através do /api/proxy server-side,
       * evitando erros de CORS ao chamar api.displayforce.ai diretamente
       * do browser.
       */
      const callProxy = async (path: string, method: 'GET' | 'POST', body?: object): Promise<any> => {
        const resp = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint, path, method, token: tokenTrim, body }),
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(`${resp.status} — ${txt.slice(0, 300)}`);
        }
        return resp.json();
      };

      // 1. Pastas (stores)
      let foldersData: any;
      try {
        foldersData = await callProxy(apiConfig.folderEndpoint, 'GET');
      } catch {
        foldersData = await callProxy(
          apiConfig.folderEndpoint, 'POST',
          { id: [], name: [], parent_ids: [], recursive: true, limit: 100, offset: 0 }
        );
      }
      const folders = foldersData?.data || foldersData?.items || foldersData?.results || (Array.isArray(foldersData) ? foldersData : []);
      if (folders.length === 0) throw new Error('Nenhuma pasta/loja encontrada. Verifique o token.');

      // 2. Dispositivos
      let devicesData: any;
      try {
        devicesData = await callProxy(apiConfig.deviceEndpoint, 'GET');
      } catch {
        devicesData = await callProxy(
          apiConfig.deviceEndpoint, 'POST',
          { id: [], name: [], parent_ids: [], recursive: true, params: ['id', 'name', 'parent_id', 'parent_ids', 'tags'], limit: 100, offset: 0 }
        );
      }
      const devices = devicesData?.data || devicesData?.items || devicesData?.results || (Array.isArray(devicesData) ? devicesData : []);

      // 3. Analytics (amostra — não lança erro se falhar)
      try {
        const now = new Date();
        const analyticsData = await callProxy(apiConfig.analyticsEndpoint, 'POST', {
          start: '2024-01-01T00:00:00Z',
          end: now.toISOString(),
          tracks: true, face_quality: true, glasses: true, facial_hair: true,
          hair_color: true, hair_type: true, headwear: true,
          additional_attributes: ['smile', 'pitch', 'yaw', 'x', 'y', 'height'],
        });
        const rows = analyticsData?.payload || analyticsData?.data || [];
        setFetchedAnalytics(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.warn('Analytics sample failed (non-fatal):', err);
        setFetchedAnalytics([]);
      }

      const newStores: Store[] = folders.map((folder: any) => {
        const storeDevices = devices
          .filter((device: any) => {
             const fId = String(folder.id);
             const dParentId = device.parent_id ? String(device.parent_id) : 'undefined';
             return dParentId === fId;
          })
          .map((device: any) => ({
            id: String(device.id),
            name: device.name,
            type: 'camera' as const,
            macAddress: String(device.id),
            status: (device.connection_state === 'online' ? 'online' : 'offline') as 'online' | 'offline'
          }));

        const existingStore = editingStores.find(s => s.name.trim().toLowerCase() === folder.name.trim().toLowerCase());
        let storeId = `new-store-${folder.id}`;
        if (existingStore && existingStore.id && !existingStore.id.startsWith('new-store') && existingStore.id.length > 10) {
          storeId = existingStore.id;
        }

        return { id: storeId, name: folder.name, city: 'Não informada', devices: storeDevices };
      });

      if (newStores.length === 0) {
        throw new Error('Nenhuma loja encontrada na API. Verifique se as pastas existem.');
      }

      setEditingStores(newStores);
      setApiStatus('success');
      setConnectionSuccess(true);
      setActiveTab('stores');
      setTimeout(() => setConnectionSuccess(false), 5000);

    } catch (error: any) {
      console.error('API Error:', error);
      setApiStatus('error');
      showToast(`Erro ao conectar com a API: ${error.message}`, 'error');
    }
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 11) {
      return numbers
        .replace(/^(\d{2})(\d)/g, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2');
    }
    return numbers.substring(0, 11)
      .replace(/^(\d{2})(\d)/g, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  };

  const handleEdit = async (client: Client, initialTab: 'details' | 'permissions' | 'api' | 'stores' = 'details') => {
    setSelectedClient(client);
    setFormData({
      name: client.name,
      email: client.email,
      phone: client.phone,
      company: client.company,
      status: client.status,
      plan: client.plan,
      notes: '',
      logo_url: client.logo_url || '',
      entryDate: client.entry_date ? new Date(client.entry_date).toISOString().split('T')[0] : (client.createdAt ? new Date(client.createdAt).toISOString().split('T')[0] : '')
    });
    setLogoPreview(client.logo_url || null);
    setLogoFile(null);
    setPerms({ view_dashboard: true, view_reports: false, view_analytics: false, export_data: false, manage_settings: false });
    setApiConfig(emptyApiConfig());
    setApiStatus('idle');
    setConnectionSuccess(false);
    setFetchedAnalytics([]);

    const { data: latestStores, error: storesError } = await supabase
      .from('stores')
      .select('id, name, city')
      .eq('client_id', client.id);

    if (storesError) {
      console.error('Erro ao buscar lojas atualizadas:', storesError);
      showToast('Aviso: Não foi possível carregar as lojas atuais.', 'error');
    }

    const stores = latestStores || [];
    const devicesByStore: Record<string, any[]> = {};

    if (stores.length > 0) {
        const storeIds = stores.map((s: any) => s.id);
        const { data: devicesData, error: devicesError } = await supabase
            .from('devices')
            .select('id, name, type, mac_address, status, store_id')
            .in('store_id', storeIds);
            
        if (devicesError) {
            console.error('Erro ao buscar dispositivos:', devicesError);
        } else if (devicesData) {
            devicesData.forEach((d: any) => {
                if (!devicesByStore[d.store_id]) devicesByStore[d.store_id] = [];
                devicesByStore[d.store_id].push(d);
            });
        }
    }

    const formattedStores: Store[] = stores.map((s: any) => ({
      id: s.id,
      name: s.name,
      city: s.city,
      devices: (devicesByStore[s.id] || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        macAddress: d.mac_address,
        status: d.status
      }))
    }));

    setEditingStores(formattedStores);
    
    const { data: permData } = await supabase
      .from('client_permissions')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle();
    
    if (permData) {
      setPerms({
        view_dashboard: permData.view_dashboard,
        view_reports: permData.view_reports,
        view_analytics: permData.view_analytics,
        export_data: permData.export_data,
        manage_settings: permData.manage_settings
      });
    }

    // ✅ CORREÇÃO 2: Ao carregar do banco, NÃO preencher customHeaderKey/Value
    // com fallback para Authorization/Bearer — carrega exatamente o que está no banco
    const { data: apiData } = await supabase
      .from('client_api_configs')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle();

    if (apiData) {
      setApiConfig({
        environment: apiData.environment || 'production',
        authMethod: apiData.auth_method || 'token',
        endpoint: apiData.api_endpoint || 'https://api.displayforce.ai',
        folderEndpoint: apiData.folder_endpoint || '/public/v1/device-folder/list',
        deviceEndpoint: apiData.device_endpoint || '/public/v1/device/list',
        analyticsEndpoint: apiData.analytics_endpoint || '/public/v1/stats/visitor/list',
        token: apiData.api_key || '',
        customHeaderKey: apiData.custom_header_key || '',   // ← Sem fallback para 'Authorization'
        customHeaderValue: apiData.custom_header_value || '', // ← Sem fallback para Bearer
        docUrl: apiData.documentation_url || '',
        collectionStart: apiData.collection_start || '',
        collectionEnd: apiData.collection_end || '',
        collectTracks: apiData.collect_tracks ?? true,
        collectFaceQuality: apiData.collect_face_quality ?? true,
        collectGlasses: apiData.collect_glasses ?? true,
        collectBeard: apiData.collect_beard ?? true,
        collectHairColor: apiData.collect_hair_color ?? true,
        collectHairType: apiData.collect_hair_type ?? true,
        collectHeadwear: apiData.collect_headwear ?? true
      });
    }

    setActiveTab(initialTab);
    setIsEditModalOpen(true);
    setActiveMenu(null);
  };

  const handleNewClient = () => {
    setSelectedClient(null);
    setFormData({
      name: '', email: '', phone: '', company: '',
      status: 'active', plan: 'basic', notes: '', logo_url: '',
      entryDate: new Date().toISOString().split('T')[0]
    });
    setLogoFile(null);
    setLogoPreview(null);
    setPerms({ view_dashboard: true, view_reports: false, view_analytics: false, export_data: false, manage_settings: false });
    setApiConfig(emptyApiConfig()); // ✅ Sempre vazio para novo cliente
    setEditingStores([]);
    setIsEditModalOpen(true);
    setConnectionSuccess(false);
    setFetchedAnalytics([]);
  };

  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    clientId: string | null;
    clientName: string;
  }>({ isOpen: false, clientId: null, clientName: '' });

  const handleDeleteClient = (client: Client) => {
    setDeleteConfirmation({ isOpen: true, clientId: client.id, clientName: client.name });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation.clientId) return;
    const clientId = deleteConfirmation.clientId;
    try {
      await supabase.from('client_api_configs').delete().eq('client_id', clientId);
      await supabase.from('client_permissions').delete().eq('client_id', clientId);
      const { error } = await supabase.from('clients').delete().eq('id', clientId);
      if (error) throw error;
      setClients(clients.filter(c => c.id !== clientId));
      if (selectedClient?.id === clientId) { setIsEditModalOpen(false); setSelectedClient(null); }
      if (expandedClient === clientId) setExpandedClient(null);
      setDeleteConfirmation({ isOpen: false, clientId: null, clientName: '' });
      showToast('Cliente excluído com sucesso!');
    } catch (error: any) {
      console.error('Error deleting client:', error);
      showToast(`Erro ao excluir cliente: ${error.message}`, 'error');
    }
  };

  const handleSave = async () => {
    try {
      let logoUrl = formData.logo_url;

      if (logoFile) {
        try {
          const fileExt = logoFile.name.split('.').pop();
          const fileName = `${Math.random()}.${fileExt}`;
          const { error: uploadError } = await supabase.storage.from('logos').upload(fileName, logoFile);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName);
          logoUrl = publicUrl;
        } catch (uploadError: any) {
          console.error('Erro ao enviar logo:', uploadError);
          const msg = String(uploadError?.message || '');
          if (msg.includes('Bucket not found')) {
            const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            try { logoUrl = await toDataUrl(logoFile); } catch { logoUrl = formData.logo_url; }
          } else { throw uploadError; }
        }
      }

      const newClientId = selectedClient?.id || crypto.randomUUID();
      const newClientPayload: any = {
        id: newClientId,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        company: formData.company,
        status: formData.status,
        notes: formData.notes,
        logo_url: logoUrl,
        entry_date: formData.entryDate ? new Date(formData.entryDate + 'T12:00:00').toISOString() : new Date().toISOString()
      };

      let clientData: any = null;
      let clientError: any = null;

      if (selectedClient?.id) {
        const { data, error } = await supabase.from('clients').update({
          name: formData.name, email: formData.email || selectedClient.email,
          phone: formData.phone, company: formData.company, status: formData.status,
          notes: formData.notes, logo_url: logoUrl,
          entry_date: formData.entryDate ? new Date(formData.entryDate + 'T12:00:00').toISOString() : undefined
        }).eq('id', selectedClient.id).select().single();
        clientData = data; clientError = error;
        if (!clientError && user?.email) {
          await logService.logAction(user.email, 'UPDATE', `Atualizou cliente: ${formData.name}`, 'network', formData.name, { clientId: selectedClient.id, changes: formData });
        }
      } else {
        const { data, error } = await supabase.from('clients').insert(newClientPayload).select().single();
        clientData = data; clientError = error;
        if (!clientError && user?.email) {
          await logService.logAction(user.email, 'CREATE', `Criou novo cliente: ${formData.name}`, 'network', formData.name, { clientId: data.id });
        }
      }

      if (clientError) throw clientError;
      const clientId = clientData.id;

      // Permissions
      const { data: permUpd, error: permUpdErr } = await supabase.from('client_permissions').update({
        view_dashboard: perms.view_dashboard, view_reports: perms.view_reports,
        view_analytics: perms.view_analytics, export_data: perms.export_data,
        manage_settings: perms.manage_settings
      }).eq('client_id', clientId).select();
      if (permUpdErr) throw permUpdErr;
      if (!permUpd || permUpd.length === 0) {
        const { error: permInsErr } = await supabase.from('client_permissions').insert({ client_id: clientId, ...perms });
        if (permInsErr) throw permInsErr;
      }

      // ✅ CORREÇÃO 3: Salva customHeaderKey/Value exatamente como está (vazio = vazio)
      // Nunca preenche automaticamente com Authorization/Bearer
      const apiPayload = {
        client_id: clientId,
        environment: apiConfig.environment,
        auth_method: apiConfig.authMethod,
        api_endpoint: (apiConfig.endpoint || 'https://api.displayforce.ai').trim(),
        folder_endpoint: (apiConfig.folderEndpoint || '/public/v1/device-folder/list').trim(),
        device_endpoint: (apiConfig.deviceEndpoint || '/public/v1/device/list').trim(),
        analytics_endpoint: (apiConfig.analyticsEndpoint || '/public/v1/stats/visitor/list').trim(),
        api_key: (apiConfig.token || '').trim(),
        custom_header_key: (apiConfig.customHeaderKey || '').trim(),
        custom_header_value: (apiConfig.customHeaderValue || '').trim(),
        documentation_url: (apiConfig.docUrl || '').trim(),
        collection_start: apiConfig.collectionStart || null,
        collection_end: apiConfig.collectionEnd || null,
        collect_tracks: !!apiConfig.collectTracks,
        collect_face_quality: !!apiConfig.collectFaceQuality,
        collect_glasses: !!apiConfig.collectGlasses,
        collect_beard: !!apiConfig.collectBeard,
        collect_hair_color: !!apiConfig.collectHairColor,
        collect_hair_type: !!apiConfig.collectHairType,
        collect_headwear: !!apiConfig.collectHeadwear
      };

      const { data: apiUpd, error: apiUpdErr } = await supabase.from('client_api_configs').update(apiPayload).eq('client_id', clientId).select();
      if (apiUpdErr) throw apiUpdErr;
      if (!apiUpd || apiUpd.length === 0) {
        const { error: apiInsErr } = await supabase.from('client_api_configs').insert(apiPayload);
        if (apiInsErr) throw apiInsErr;
      }

      // Sync analytics via backend
      try {
        const syncBody = { client_id: clientId, start: apiConfig.collectionStart || undefined, end: apiConfig.collectionEnd || undefined };
        const syncResp = await fetch('/api/sync-analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(syncBody)
        });
        if (syncResp.ok) {
          const syncJson = await syncResp.json();
          console.log('Sync Analytics Result:', syncJson);
          showToast(`Analytics sincronizados: ${syncJson.inserted || 0}`, 'success');
        } else {
          console.warn('Falha na sincronização de analytics:', await syncResp.text());
        }
      } catch (e) {
        console.warn('Erro ao acionar sync-analytics:', e);
      }

      // Stores & Devices
      console.log('Iniciando salvamento de lojas. Total para salvar:', editingStores.length);
      
      const { data: dbStoresData, error: dbStoresErr } = await supabase.from('stores').select('id, name').eq('client_id', clientId);
      if (dbStoresErr) throw new Error(`Falha ao verificar lojas existentes: ${dbStoresErr.message}`);

      const dbStores = dbStoresData || [];
      const uniqueDbStoresMap = new Map<string, string>();
      const duplicateDbIds = new Set<string>();

      dbStores.forEach(s => {
          const normName = s.name.trim().toLowerCase();
          if (uniqueDbStoresMap.has(normName)) { duplicateDbIds.add(s.id); }
          else { uniqueDbStoresMap.set(normName, s.id); }
      });

      if (duplicateDbIds.size > 0) {
          const dupIds = Array.from(duplicateDbIds);
          await supabase.from('devices').delete().in('store_id', dupIds);
          await supabase.from('stores').delete().in('id', dupIds);
          for (let i = dbStores.length - 1; i >= 0; i--) {
              if (duplicateDbIds.has(dbStores[i].id)) dbStores.splice(i, 1);
          }
      }

      const validStoreIds = new Set<string>();
      
      for (const store of editingStores) {
          let storeIdToUse = store.id;
          const storeNameNorm = store.name.trim().toLowerCase();

          if (storeIdToUse.startsWith('new-store') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeIdToUse)) {
             const existingId = uniqueDbStoresMap.get(storeNameNorm);
             if (existingId) { storeIdToUse = existingId; }
             else { storeIdToUse = crypto.randomUUID(); console.log(`Nova Loja: "${store.name}" terá novo ID ${storeIdToUse}`); }
          } else {
             const exists = dbStores.some(s => s.id === storeIdToUse);
             if (!exists) {
                 const recoveredId = uniqueDbStoresMap.get(storeNameNorm);
                 if (recoveredId) storeIdToUse = recoveredId;
             }
          }

          validStoreIds.add(storeIdToUse);

          const { error: storeUpsertError } = await supabase.from('stores').upsert({ id: storeIdToUse, client_id: clientId, name: store.name, city: store.city });
          if (storeUpsertError) { console.error(`Erro ao salvar loja ${store.name}:`, storeUpsertError); continue; }

          if (store.devices && store.devices.length > 0) {
             const { data: existingDevs } = await supabase.from('devices').select('id, mac_address').eq('store_id', storeIdToUse);
             const devMap = new Map<string, string>();
             if (existingDevs) existingDevs.forEach((d: any) => { if (d.mac_address) devMap.set(d.mac_address, d.id); });

             const devicesToUpsert = store.devices.map(d => {
               const existingId = devMap.get(d.macAddress);
               const idToUse = (d.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.id)) 
                   ? d.id : (existingId || crypto.randomUUID());
               return { id: idToUse, store_id: storeIdToUse, name: d.name, type: d.type, mac_address: d.macAddress, status: d.status };
             });

             const uniquePayload: any[] = [];
             const seenMacs = new Set();
             for (const dev of devicesToUpsert) {
                 if (!seenMacs.has(dev.mac_address)) { seenMacs.add(dev.mac_address); uniquePayload.push(dev); }
             }

             const { error: devError } = await supabase.from('devices').upsert(uniquePayload);
             if (devError) console.error(`Erro ao salvar dispositivos da loja ${store.name}:`, devError);
          }
      }

      if (validStoreIds.size > 0) {
         const idsToDelete = dbStores.filter(s => !validStoreIds.has(s.id)).map(s => s.id);
         if (idsToDelete.length > 0) {
             await supabase.from('devices').delete().in('store_id', idsToDelete);
             await supabase.from('stores').delete().in('id', idsToDelete);
         }
      }

      // ✅ CORREÇÃO 4: Analytics com upsert em vez de insert (evita erro 23505)
      if (fetchedAnalytics.length > 0) {
        try {
          console.log(`Salvando ${fetchedAnalytics.length} registros de analytics...`);
          
          const analyticsToInsert = fetchedAnalytics.map((visit: any) => {
            let mainDeviceId: number | null = null;
            for (const f of ['device', 'device_id', 'source_id', 'camera_id']) {
              if (visit[f] != null) { const v = Number(visit[f]); if (!isNaN(v)) { mainDeviceId = v; break; } }
            }
            if (mainDeviceId == null && Array.isArray(visit.devices) && visit.devices.length > 0) {
              const v = Number(visit.devices[0]); if (!isNaN(v)) mainDeviceId = v;
            }
            const attrs: any = {
              face_quality: visit.face_quality ?? null, facial_hair: visit.facial_hair ?? null,
              hair_color: visit.hair_color ?? null, hair_type: visit.hair_type ?? null,
              headwear: visit.headwear ?? null, glasses: visit.glasses ?? null,
            };
            if (Array.isArray(visit.additional_atributes)) attrs.additional_attributes = visit.additional_atributes;

            return {
              client_id: clientId,
              device_id: mainDeviceId,
              timestamp: visit.start,
              age: typeof visit.age === 'number' ? Math.round(visit.age) : null,
              gender: typeof visit.sex === 'number' ? visit.sex : 0,
              attributes: attrs,
              raw_data: visit
            };
          });

          const chunkSize = 500;
          for (let i = 0; i < analyticsToInsert.length; i += chunkSize) {
            const chunk = analyticsToInsert.slice(i, i + chunkSize);
            // ✅ upsert com ignoreDuplicates evita o erro 23505
            const { error: analyticsError } = await supabase
              .from('visitor_analytics')
              .upsert(chunk, { onConflict: 'visit_uid', ignoreDuplicates: true });
            if (analyticsError) console.error(`Erro ao upsert chunk ${i}–${i + chunkSize}:`, analyticsError);
          }
        } catch (analyticsErr) {
          console.error('Erro ao processar salvamento de analytics:', analyticsErr);
        }
      }

      const { count: storeCount, error: countError } = await supabase
        .from('stores').select('*', { count: 'exact', head: true }).eq('client_id', clientId);
      
      if (countError) {
         showToast(`Dados salvos, mas erro ao verificar: ${countError.message}`, 'error');
      } else {
         console.log(`Verificação pós-save: ${storeCount} lojas encontradas no banco.`);
      }

      setIsEditModalOpen(false);
      await fetchClients();
      showToast('Alterações salvas com sucesso!');
    } catch (error: any) {
      console.error('Error saving client:', error);
      let msg = error.message || 'Erro desconhecido ao salvar.';
      if (msg.includes('row-level security policy')) msg = 'Permissão negada (RLS). Execute o script SQL no seu painel Supabase.';
      else if (msg.includes('duplicate key')) msg = 'Já existe um registro com estes dados (Email ou ID duplicado).';
      else if (msg.includes('invalid input syntax for type uuid')) msg = 'ERRO DE ID: ID antigo incompatível. Exclua e recrie o cliente.';
      showToast(msg, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building className="text-emerald-500" /> Clientes
          </h1>
          <p className="text-gray-400">Gerencie seus clientes e APIs</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <input 
              type="text" 
              placeholder="Buscar clientes..." 
              className="bg-gray-900 border border-gray-800 text-white pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-64 placeholder-gray-600"
            />
          </div>
          <button onClick={fetchClients} title="Atualizar Lista" className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors border border-gray-700">
            <Activity size={18} />
          </button>
          <button onClick={handleNewClient} className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-emerald-900/20">
            <Plus size={18} /> Novo Cliente
          </button>
        </div>
      </div>

      {/* Client List */}
      <div className="space-y-4">
        {clients.length === 0 ? (
          <div className="text-center py-12 bg-gray-900/50 rounded-xl border border-gray-800 border-dashed">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-500">
              <Building size={32} />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">Nenhum cliente encontrado</h3>
            <p className="text-gray-500 max-w-sm mx-auto mb-6">Comece adicionando seu primeiro cliente para gerenciar lojas e câmeras.</p>
            <button onClick={handleNewClient} className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg inline-flex items-center gap-2 transition-colors">
              <Plus size={18} /> Adicionar Primeiro Cliente
            </button>
          </div>
        ) : (
          clients.map((client) => (
          <div key={client.id} className="bg-gray-900 border border-gray-800 rounded-xl p-6 hover:border-gray-700 transition-all group relative flex flex-col gap-4">
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gray-900 flex items-center justify-center text-white font-bold text-2xl shadow-inner overflow-hidden">
                  {client.logo_url ? (
                    <img src={client.logo_url} alt={client.name} className="w-full h-full object-contain" />
                  ) : (
                    <Building size={24} />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-white text-lg">{client.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{client.company}</p>
                  <div className="flex items-center gap-4 mt-3 text-sm text-gray-400">
                    <span className="flex items-center gap-1.5"><Mail size={14} /> {client.email}</span>
                    <span className="flex items-center gap-1.5"><Phone size={14} /> {client.phone}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-4 h-full">
                 <button 
                  onClick={() => setExpandedClient(expandedClient === client.id ? null : client.id)}
                  className={`p-2 rounded-lg border transition-colors ${expandedClient === client.id ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'border-gray-700 hover:bg-gray-800 text-gray-300'}`}
                 >
                   {expandedClient === client.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                 </button>
                 <button 
                  onClick={() => navigate(`/clientes/${client.id}/dashboard`)}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 text-gray-300 text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
                 >
                   <LayoutDashboard size={16} className="text-emerald-500" /> Dashboard
                </button>
                 <div className="relative">
                  <button onClick={() => setActiveMenu(activeMenu === client.id ? null : client.id)} className="p-2 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                      <Settings size={20} />
                  </button>
                  {activeMenu === client.id && (
                      <div className="absolute right-0 top-12 w-48 bg-gray-900 border border-gray-800 rounded-lg shadow-xl z-10 overflow-hidden">
                      <div className="p-1">
                          <button onClick={() => handleEdit(client, 'details')} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md flex items-center gap-2">
                          <Edit size={16} /> Editar Cliente
                          </button>
                          <button onClick={() => handleEdit(client, 'api')} className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-md flex items-center gap-2">
                          <LinkIcon size={16} /> Configurar APIs
                          </button>
                          <div className="h-px bg-gray-800 my-1"></div>
                          <button onClick={() => handleDeleteClient(client)} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/20 rounded-md flex items-center gap-2">
                          <Trash2 size={16} /> Excluir
                          </button>
                      </div>
                      </div>
                  )}
                 </div>
              </div>
            </div>

            {expandedClient === client.id && (
              <div className="pt-4 border-t border-gray-800 animate-in slide-in-from-top-2 duration-200 w-full">
                <h4 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
                  <Building2 size={14} /> Lojas da Rede
                </h4>
                <div className="flex flex-col gap-2">
                  {getClientStores(client.id).length === 0 && (
                    <div className="text-center py-4 bg-gray-900/50 rounded-lg border border-gray-800 border-dashed">
                      <p className="text-gray-500 text-sm">Nenhuma loja vinculada a este cliente.</p>
                      <p className="text-xs text-gray-600 mt-1">Configure a API ou adicione lojas manualmente.</p>
                    </div>
                  )}
                  {getClientStores(client.id).map(store => (
                    <div key={store.id} className="bg-gray-950 rounded-lg border border-gray-800 overflow-hidden transition-all">
                      <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-900 transition-colors" onClick={() => setExpandedStore(expandedStore === store.id ? null : store.id)}>
                        <div className="flex items-center gap-4">
                           <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-gray-500">
                             <Building2 size={16} />
                           </div>
                           <div>
                            <p className="text-sm font-medium text-white">{store.name}</p>
                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <MapPin size={10} /> {store.city}
                            </p>
                           </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${client.id}/dashboard`, { state: { initialView: 'store', storeId: store.id } }); }}
                            className="p-1.5 text-gray-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
                          >
                            <LayoutDashboard size={16} />
                          </button>
                          {expandedStore === store.id ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                        </div>
                      </div>

                      {expandedStore === store.id && (
                        <div className="bg-gray-900/50 border-t border-gray-800 p-3 animate-in slide-in-from-top-2 duration-200">
                          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2 px-1">
                            <Camera size={12} /> Dispositivos Conectados
                          </h5>
                          {store.devices.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {store.devices.map(device => (
                                <div key={device.id} className="flex items-center justify-between bg-gray-950 p-2 rounded border border-gray-800 group/device hover:border-gray-700 transition-all">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                    <div>
                                      <p className="text-xs font-medium text-gray-300">{device.name}</p>
                                      <p className="text-[10px] text-gray-600 font-mono">{device.macAddress}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] bg-gray-900 text-gray-500 px-1.5 py-0.5 rounded border border-gray-800 uppercase">
                                        {device.status === 'online' ? 'Capturando' : 'Offline'}
                                    </span>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); navigate(`/clientes/${client.id}/dashboard`, { state: { initialView: 'device', storeId: store.id, deviceId: device.id } }); }}
                                        className="p-1.5 text-gray-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors opacity-0 group-hover/device:opacity-100"
                                    >
                                        <LayoutDashboard size={14} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600 italic px-1">Nenhum dispositivo vinculado a esta loja.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          ))
        )}
      </div>

      {/* MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-800 z-10">
              <div className="p-6 flex items-center justify-between pb-4">
                <h2 className="text-xl font-bold text-white">{selectedClient ? 'Editar Cliente' : 'Novo Cliente'}</h2>
                <button onClick={() => setIsEditModalOpen(false)} className="text-gray-500 hover:text-white transition-colors"><X size={24} /></button>
              </div>
              <div className="flex px-6 gap-6">
                {(['details', 'permissions', 'api'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === tab ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' : 'text-gray-400 hover:text-gray-300'}`}>
                    {tab === 'details' ? 'Dados Gerais' : tab === 'permissions' ? 'Permissões' : 'Configuração API'}
                  </button>
                ))}
                {editingStores.length > 0 && (
                  <button onClick={() => setActiveTab('stores')} className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'stores' ? 'text-emerald-500 after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-emerald-500' : 'text-gray-400 hover:text-gray-300'}`}>
                    Lojas Encontradas ({editingStores.length})
                  </button>
                )}
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {activeTab === 'details' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Empresa *</label>
                      <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Email *</label>
                      <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Telefone</label>
                      <input type="text" value={formData.phone} onChange={(e) => setFormData({...formData, phone: formatPhone(e.target.value)})} placeholder="(11) 99999-9999" maxLength={15} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Nome</label>
                      <input type="text" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Status</label>
                      <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value as any})} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none">
                        <option value="active">Ativo</option>
                        <option value="inactive">Inativo</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-400">Data de Entrada</label>
                      <input type="date" value={formData.entryDate} onChange={(e) => setFormData({...formData, entryDate: e.target.value})} className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Logo da Empresa</label>
                    <div className="w-full h-32 bg-gray-950 border border-gray-800 rounded-lg flex items-center justify-center overflow-hidden relative cursor-pointer hover:border-emerald-500 transition-colors">
                      {logoPreview ? <img src={logoPreview} alt="Preview" className="h-full object-contain p-2" /> : (
                        <div className="flex flex-col items-center text-gray-600"><Upload size={24} className="mb-2" /><span className="text-xs">Clique para fazer upload</span></div>
                      )}
                      <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) { setLogoFile(file); setLogoPreview(URL.createObjectURL(file)); } }} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                    <p className="text-xs text-gray-500">Formatos aceitos: PNG, JPG, SVG (Máx. 2MB)</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-400">Observações</label>
                    <textarea rows={3} value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} placeholder="Notas adicionais sobre o cliente..." className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-2.5 text-white focus:ring-1 focus:ring-emerald-500 outline-none resize-none" />
                  </div>
                </>
              )}

              {activeTab === 'permissions' && (
                <div className="border border-gray-800 rounded-xl bg-gray-950/50 overflow-hidden">
                  <div className="p-4 bg-gray-900/50 border-b border-gray-800">
                    <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2"><Shield size={16} /> Permissões de Acesso</h3>
                  </div>
                  <div className="p-2">
                    {[
                      { key: 'view_dashboard', icon: Eye, label: 'Visualizar Dashboard', desc: 'Acesso aos gráficos e métricas' },
                      { key: 'view_reports', icon: FileText, label: 'Visualizar Relatórios', desc: 'Acesso aos relatórios detalhados' },
                      { key: 'view_analytics', icon: BarChart2, label: 'Visualizar Analytics', desc: 'Acesso às análises avançadas' },
                      { key: 'export_data', icon: Download, label: 'Exportar Dados', desc: 'Permissão para baixar dados' },
                      { key: 'manage_settings', icon: Settings, label: 'Gerenciar Configurações', desc: 'Alterar configurações do cliente' },
                    ].map(({ key, icon: Icon, label, desc }) => (
                      <div key={key} className="flex items-center justify-between p-4 hover:bg-gray-900/50 rounded-lg transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400"><Icon size={20} /></div>
                          <div><p className="font-medium text-white text-sm">{label}</p><p className="text-xs text-gray-500">{desc}</p></div>
                        </div>
                        <Toggle checked={perms[key as keyof typeof perms]} onChange={() => togglePerm(key as keyof typeof perms)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'api' && (
                <div className="border border-gray-800 rounded-xl p-5 bg-gray-950/50">
                  <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-4"><Key size={16} /> Configuração da API (DisplayForce.ai)</h3>
                  <div className="space-y-6">
                    {connectionSuccess && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex items-start gap-3">
                        <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                        <div>
                          <h4 className="font-bold text-emerald-400 text-sm">Conexão Estabelecida com Sucesso!</h4>
                          <p className="text-emerald-500/70 text-xs mt-1">API respondendo. Salve as configurações para confirmar.</p>
                        </div>
                        <button onClick={() => setConnectionSuccess(false)} className="ml-auto text-emerald-500/50 hover:text-emerald-400"><X size={16} /></button>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Endereço da API (Base URL)</label>
                        <div className="relative">
                          <input type="text" value={apiConfig.endpoint} onChange={(e) => setApiConfig({...apiConfig, endpoint: e.target.value})} placeholder="https://api.displayforce.ai" className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none" />
                          <Server className="absolute right-3 top-2.5 text-gray-600" size={16} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Caminho das Pastas (Lojas)</label>
                          <input type="text" value={apiConfig.folderEndpoint} onChange={(e) => setApiConfig({...apiConfig, folderEndpoint: e.target.value})} placeholder="/public/v1/device-folder/list" className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 font-mono text-xs focus:ring-1 focus:ring-emerald-500 outline-none" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Caminho dos Dispositivos</label>
                          <input type="text" value={apiConfig.deviceEndpoint} onChange={(e) => setApiConfig({...apiConfig, deviceEndpoint: e.target.value})} placeholder="/public/v1/device/list" className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 font-mono text-xs focus:ring-1 focus:ring-emerald-500 outline-none" />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Caminho dos Dados (Analytics)</label>
                          <input type="text" value={apiConfig.analyticsEndpoint} onChange={(e) => setApiConfig({...apiConfig, analyticsEndpoint: e.target.value})} placeholder="/public/v1/stats/visitor/list" className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-gray-300 font-mono text-xs focus:ring-1 focus:ring-emerald-500 outline-none" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">X-API-Token</label>
                        <div className="relative">
                          <input type="text" value={apiConfig.token} onChange={(e) => setApiConfig({...apiConfig, token: e.target.value})} placeholder="Insira o token do cliente aqui" className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-4 pr-10 py-2.5 text-gray-300 font-mono text-sm focus:ring-1 focus:ring-emerald-500 outline-none" />
                          <Lock className="absolute right-3 top-2.5 text-gray-600" size={16} />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-800 pt-4">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2"><FileText size={14} /> Parâmetros do Body (Coleta de Dados)</h4>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                        <div className="space-y-3">
                          {[
                            { key: 'collectTracks', label: 'Rastreamento (Tracks)' },
                            { key: 'collectFaceQuality', label: 'Qualidade Facial' },
                            { key: 'collectGlasses', label: 'Óculos' },
                            { key: 'collectBeard', label: 'Barba/Bigode' },
                          ].map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between">
                              <span className="text-sm text-gray-300">{label}</span>
                              <Toggle checked={apiConfig[key as keyof typeof apiConfig] as boolean} onChange={() => setApiConfig({...apiConfig, [key]: !apiConfig[key as keyof typeof apiConfig]})} />
                            </div>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {[
                            { key: 'collectHairColor', label: 'Cor do Cabelo' },
                            { key: 'collectHairType', label: 'Tipo de Cabelo' },
                            { key: 'collectHeadwear', label: 'Chapéu/Boné' },
                          ].map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between">
                              <span className="text-sm text-gray-300">{label}</span>
                              <Toggle checked={apiConfig[key as keyof typeof apiConfig] as boolean} onChange={() => setApiConfig({...apiConfig, [key]: !apiConfig[key as keyof typeof apiConfig]})} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className="text-[10px] text-gray-500 uppercase mb-2 block">Atributos Adicionais</label>
                        <div className="flex flex-wrap gap-2">
                          {['smile', 'pitch', 'yaw', 'x', 'y', 'height'].map(attr => (
                            <span key={attr} className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">{attr}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <button 
                      onClick={handleTestConnection}
                      disabled={apiStatus === 'testing'}
                      className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${apiStatus === 'success' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-gray-800 hover:bg-gray-700 text-white'}`}
                    >
                      {apiStatus === 'testing' ? (
                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Conectando à DisplayForce.ai...</>
                      ) : apiStatus === 'success' ? (
                        <><CheckCircle2 size={18} /> Conexão Estabelecida</>
                      ) : (
                        <><Activity size={18} /> Testar Conexão e Sincronizar</>
                      )}
                    </button>

                    {editingStores.length > 0 && apiStatus === 'success' && (
                      <div className="p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-lg">
                        <h4 className="text-emerald-400 font-bold text-sm mb-2 flex items-center gap-2"><CheckCircle2 size={16} /> Sincronização Concluída</h4>
                        <div className="flex gap-4">
                           <div className="bg-gray-900 px-3 py-2 rounded border border-gray-800 flex items-center gap-2">
                             <Building2 size={14} className="text-gray-500" />
                             <span className="text-white text-sm font-bold">{editingStores.length}</span>
                             <span className="text-xs text-gray-500">Lojas</span>
                           </div>
                           <div className="bg-gray-900 px-3 py-2 rounded border border-gray-800 flex items-center gap-2">
                             <Camera size={14} className="text-gray-500" />
                             <span className="text-white text-sm font-bold">{editingStores.reduce((acc, s) => acc + s.devices.length, 0)}</span>
                             <span className="text-xs text-gray-500">Dispositivos</span>
                           </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'stores' && (
                <div className="space-y-4">
                   <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-4 mb-6">
                      <h4 className="text-emerald-400 font-bold text-sm mb-2 flex items-center gap-2"><CheckCircle2 size={16} /> Dados Sincronizados</h4>
                      <p className="text-sm text-gray-300">Abaixo estão as lojas e dispositivos encontrados na sua conta DisplayForce. Clique em <b>Salvar Alterações</b> para confirmar.</p>
                   </div>
                   <div className="grid grid-cols-1 gap-3">
                     {editingStores.map((store, idx) => (
                       <div key={store.id || idx} className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                         <div className="flex items-center justify-between mb-3">
                           <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded bg-gray-900 flex items-center justify-center text-gray-500"><Building2 size={16} /></div>
                             <div>
                               <h4 className="font-bold text-white text-sm">{store.name}</h4>
                               <p className="text-xs text-gray-500">ID: {store.id.startsWith('new-store') ? 'Novo (Será gerado)' : store.id}</p>
                             </div>
                           </div>
                           <span className="text-xs bg-gray-900 text-gray-400 px-2 py-1 rounded border border-gray-800">{store.devices.length} Dispositivos</span>
                         </div>
                         {store.devices.length > 0 ? (
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pl-11">
                             {store.devices.map((device, dIdx) => (
                               <div key={dIdx} className="bg-gray-900/50 p-2 rounded border border-gray-800/50 flex items-center justify-between">
                                 <div className="flex items-center gap-2">
                                   <div className={`w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                   <span className="text-xs text-gray-300">{device.name}</span>
                                 </div>
                                 <span className="text-[10px] text-gray-600 font-mono">{device.status === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
                               </div>
                             ))}
                           </div>
                         ) : (
                           <p className="text-xs text-gray-500 pl-11 italic">Nenhum dispositivo nesta loja.</p>
                         )}
                       </div>
                     ))}
                   </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-800 flex justify-end gap-3 bg-gray-900 sticky bottom-0 z-10">
              <button onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors">Cancelar</button>
              <button onClick={handleSave} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium shadow-lg shadow-emerald-900/20 transition-colors">Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {activeMenu && <div className="fixed inset-0 z-0" onClick={() => setActiveMenu(null)} />}

      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-right-10 duration-300">
          <div className={`flex items-center gap-4 px-5 py-4 rounded-2xl shadow-2xl border ${toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500'} backdrop-blur-xl bg-gray-900/95`}>
            <div className={`p-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
              {toast.type === 'success' ? <CheckCircle2 size={24} /> : <ShieldAlert size={24} />}
            </div>
            <div>
              <h4 className="font-bold text-base">{toast.type === 'success' ? 'Sucesso' : 'Erro'}</h4>
              <p className="text-sm opacity-90 text-gray-300">{toast.message}</p>
            </div>
            <button onClick={() => setToast(null)} className="ml-2 p-1 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"><X size={18} /></button>
          </div>
        </div>
      )}

      {deleteConfirmation.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert className="text-red-500" size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Excluir Cliente</h3>
                  <p className="text-sm text-gray-400">Esta ação é irreversível.</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm mb-6 bg-gray-800/50 p-3 rounded-lg border border-gray-800">
                Tem certeza que deseja excluir o cliente <span className="font-bold text-white">{deleteConfirmation.clientName}</span> e todos os seus dados associados?
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirmation({ isOpen: false, clientId: null, clientName: '' })} className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">Cancelar</button>
                <button onClick={confirmDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-lg shadow-red-900/20 transition-all flex items-center gap-2">
                  <Trash2 size={16} /> Confirmar Exclusão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
