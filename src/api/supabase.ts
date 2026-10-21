import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  type Backend,
  type Cafe,
  type CafeSettings,
  type Category,
  type ClaimResult,
  type DiningTable,
  type Order,
  type OrderItem,
  type Product,
  type StaffMember,
  type StaffSession,
  type TableMenu,
  type WaiterCall,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const KNOWN_ERRORS = [
  'not_authenticated', 'invalid_table', 'empty_order', 'too_many_items', 'too_fast', 'order_in_progress',
  'unknown_product', 'product_unavailable', 'invalid_quantity', 'invalid_minutes', 'invalid_status', 'forbidden', 'not_found',
  // admin
  'name_required', 'invalid_price', 'invalid_number', 'duplicate_number', 'category_not_empty', 'invalid_color',
  'cannot_change_self', 'owner_required', 'already_staff', 'invalid_input', 'invalid_range', 'invalid_floor', 'gone',
];

export function toApiError(error: { message?: string; code?: string } | null): ApiError {
  const msg = error?.message ?? '';
  const code = KNOWN_ERRORS.find((c) => msg.includes(c));
  if (code) return new ApiError(code, msg);
  // The request ran without a valid session (expired token, or signed out in another tab).
  if (/permission denied for function|JWT expired|invalid JWT/i.test(msg)) return new ApiError('not_authenticated', msg);
  if (/anonymous sign-ins are disabled/i.test(msg)) return new ApiError('anonymous_disabled', msg);
  if (/invalid login credentials/i.test(msg)) return new ApiError('invalid_login', msg);
  if (/fetch|network/i.test(msg)) return new ApiError('network', msg);
  return new ApiError('generic', msg);
}

const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);

function toItem(r: Row): OrderItem {
  return { id: r.id, productId: r.product_id, name: r.name ?? {}, qty: r.qty, unitPrice: r.unit_price, choices: r.choices ?? [], note: r.note ?? '' };
}

function toOrder(r: Row): Order {
  return {
    id: r.id,
    number: r.number,
    tableId: r.table_id,
    tableNumber: r.table_number,
    tableKind: r.table_kind ?? 'table',
    status: r.status,
    note: r.note ?? '',
    total: r.total,
    createdAt: ts(r.created_at)!,
    acceptedAt: ts(r.accepted_at),
    deadline: ts(r.deadline),
    prepMinutes: r.prep_minutes,
    estimateUpdatedAt: ts(r.estimate_updated_at),
    readyAt: ts(r.ready_at),
    servedAt: ts(r.served_at),
    rejectedAt: ts(r.rejected_at),
    rejectReason: r.reject_reason,
    waiterId: r.waiter_id,
    waiterName: r.waiter_name,
    items: (r.order_items ?? []).map(toItem),
  };
}

function toCafe(r: Row): Cafe {
  return {
    id: r.id, slug: r.slug, name: r.name, accent: r.accent, defaultLang: r.default_lang,
    allowRepeat: r.allow_repeat, callButton: r.call_button,
  };
}

function toCafeSettings(r: Row): CafeSettings {
  const h = (r.opening_hours ?? {}) as Row;
  return {
    ...toCafe(r),
    phone: r.phone ?? '',
    email: r.email ?? '',
    address: r.address ?? '',
    openingHours: { weekdays: h.weekdays ?? '', saturday: h.saturday ?? '', sunday: h.sunday ?? '' },
  };
}

const toCategory = (r: Row): Category => ({ id: r.id, name: r.name ?? {}, icon: r.icon, sort: r.sort });

const toProduct = (r: Row): Product => ({
  id: r.id, categoryId: r.category_id, name: r.name ?? {}, description: r.description ?? {}, price: r.price,
  available: r.available, options: r.options ?? [], imageUrl: r.image_url, sort: r.sort,
});

const IMAGE_EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

function listen(client: SupabaseClient, name: string, tables: string[], filter: string, onChange: () => void) {
  let channel = client.channel(`${name}-${Math.random().toString(36).slice(2)}`);
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => onChange());
  }
  channel.subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export function createSupabaseBackend(url: string, key: string): Backend {
  // Separate auth storage, so a waiter and a guest can be signed in side by side in one browser.
  const guest = createClient(url, key, { auth: { storageKey: 'stolic-guest', persistSession: true, autoRefreshToken: true } });
  const staff = createClient(url, key, { auth: { storageKey: 'stolic-staff', persistSession: true, autoRefreshToken: true } });

  let offset = 0;
  const started = Date.now();
  void guest.rpc('server_now').then(({ data }) => {
    if (typeof data === 'string') offset = new Date(data).getTime() - (started + Date.now()) / 2;
  });

  const tableIds = new Map<string, string>();

  async function guestUid(): Promise<string> {
    const { data } = await guest.auth.getSession();
    if (data.session) return data.session.user.id;
    const res = await guest.auth.signInAnonymously();
    if (res.error || !res.data.user) throw toApiError(res.error);
    return res.data.user.id;
  }

  async function rpc<T>(client: SupabaseClient, fn: string, args: Row): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw toApiError(error);
    return data as T;
  }

  async function loadStaffSession(): Promise<StaffSession | null> {
    const { data: auth } = await staff.auth.getSession();
    if (!auth.session) return null;
    const { data, error } = await staff
      .from('staff')
      .select('id, display_name, role, cafes(*)')
      .eq('user_id', auth.session.user.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (error) throw toApiError(error);
    if (!data || !data.cafes) return null;
    const cafe = Array.isArray(data.cafes) ? data.cafes[0] : data.cafes;
    return { staffId: data.id, name: data.display_name, role: data.role, cafe: toCafe(cafe as Row) };
  }

  return {
    mode: 'supabase',
    serverOffset: () => offset,

    async loadTable(token) {
      const data = await rpc<TableMenu | null>(guest, 'guest_table', { p_token: token });
      if (data) {
        data.table.kind ??= 'table';
        tableIds.set(token, data.table.id);
      }
      return data;
    },

    async placeOrder(token, lines, note) {
      await guestUid();
      return rpc<string>(guest, 'place_order', { p_token: token, p_items: lines, p_note: note });
    },

    async myOrders(token) {
      const uid = await guestUid();
      let q = guest
        .from('orders')
        .select('*, order_items(*)')
        .eq('guest_id', uid)
        .gte('created_at', new Date(Date.now() - 12 * 3_600_000).toISOString())
        .order('created_at', { ascending: false });
      const tableId = tableIds.get(token);
      if (tableId) q = q.eq('table_id', tableId);
      const { data, error } = await q;
      if (error) throw toApiError(error);
      return (data ?? []).map(toOrder);
    },

    subscribeMyOrders(_token, onChange) {
      let stop: (() => void) | null = null;
      let cancelled = false;
      void guestUid().then((uid) => {
        if (!cancelled) stop = listen(guest, 'guest', ['orders'], `guest_id=eq.${uid}`, onChange);
      });
      return () => {
        cancelled = true;
        stop?.();
      };
    },

    async callWaiter(token) {
      await guestUid();
      await rpc(guest, 'call_waiter', { p_token: token });
    },

    staffSession: loadStaffSession,

    async signIn(email, password) {
      const { error } = await staff.auth.signInWithPassword({ email, password });
      if (error) throw toApiError(error);
      const session = await loadStaffSession();
      if (!session) {
        await staff.auth.signOut();
        throw new ApiError('not_staff');
      }
      return session;
    },

    async signOut() {
      await staff.auth.signOut();
    },

    demoStaff: () => [],
    async demoSignIn() {
      throw new ApiError('forbidden');
    },

    async cafeOrders(cafeId) {
      const { data, error } = await staff
        .from('orders')
        .select('*, order_items(*)')
        .eq('cafe_id', cafeId)
        .gte('created_at', new Date(Date.now() - 12 * 3_600_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw toApiError(error);
      return (data ?? []).map(toOrder);
    },

    async cafeCalls(cafeId): Promise<WaiterCall[]> {
      const { data, error } = await staff
        .from('waiter_calls')
        .select('id, table_number, created_at')
        .eq('cafe_id', cafeId)
        .is('resolved_at', null)
        .order('created_at');
      if (error) throw toApiError(error);
      return (data ?? []).map((r: Row) => ({ id: r.id, tableNumber: r.table_number, createdAt: ts(r.created_at)! }));
    },

    async cafeTables(cafeId): Promise<DiningTable[]> {
      const { data, error } = await staff
        .from('dining_tables')
        .select('id, kind, number, seats, zone, floor, qr_token')
        .eq('cafe_id', cafeId)
        .eq('active', true)
        .order('kind', { ascending: false }) // 'table' before 'room'
        .order('number');
      if (error) throw toApiError(error);
      return (data ?? []).map((r: Row) => ({ id: r.id, kind: r.kind ?? 'table', number: r.number, seats: r.seats, zone: r.zone, token: r.qr_token, floor: r.floor ?? null }));
    },

    subscribeCafe(cafeId, onChange) {
      return listen(staff, 'cafe', ['orders', 'waiter_calls'], `cafe_id=eq.${cafeId}`, onChange);
    },

    acceptOrder: (orderId, minutes) => rpc<ClaimResult>(staff, 'accept_order', { p_order: orderId, p_minutes: minutes }),
    rejectOrder: (orderId, reason) => rpc<ClaimResult>(staff, 'reject_order', { p_order: orderId, p_reason: reason }),
    extendOrder: (orderId, minutes) => rpc<void>(staff, 'extend_order', { p_order: orderId, p_minutes: minutes }),
    markReady: (orderId) => rpc<void>(staff, 'mark_order_ready', { p_order: orderId }),
    markServed: (orderId) => rpc<void>(staff, 'mark_order_served', { p_order: orderId }),
    resolveCall: (callId) => rpc<void>(staff, 'resolve_call', { p_call: callId }),

    // ─────────────────────────────── admin (owner / manager; enforced by the admin_* functions and RLS)

    async adminOrders(cafeId, since) {
      const { data, error } = await staff
        .from('orders')
        .select('*, order_items(*)')
        .eq('cafe_id', cafeId)
        .gte('created_at', new Date(since).toISOString())
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw toApiError(error);
      return (data ?? []).map(toOrder);
    },

    async cafeSettings(cafeId) {
      const { data, error } = await staff.from('cafes').select('*').eq('id', cafeId).single();
      if (error) throw toApiError(error);
      return toCafeSettings(data);
    },

    updateCafe: (cafeId, input) => rpc<void>(staff, 'admin_update_cafe', { p_cafe: cafeId, p_settings: input }),

    async adminMenu(cafeId) {
      const [cats, prods] = await Promise.all([
        staff.from('categories').select('*').eq('cafe_id', cafeId).order('sort'),
        staff.from('products').select('*').eq('cafe_id', cafeId).order('sort'),
      ]);
      if (cats.error) throw toApiError(cats.error);
      if (prods.error) throw toApiError(prods.error);
      return { categories: (cats.data ?? []).map(toCategory), products: (prods.data ?? []).map(toProduct) };
    },

    saveCategory: (cafeId, input) => rpc<string>(staff, 'admin_save_category', { p_cafe: cafeId, p_category: input }),
    deleteCategory: (categoryId) => rpc<void>(staff, 'admin_delete_category', { p_category: categoryId }),
    reorderCategories: (cafeId, ids) => rpc<void>(staff, 'admin_reorder_categories', { p_cafe: cafeId, p_ids: ids }),
    saveProduct: (cafeId, input) => rpc<string>(staff, 'admin_save_product', { p_cafe: cafeId, p_product: input }),
    setProductAvailable: (productId, available) => rpc<void>(staff, 'admin_set_product_available', { p_product: productId, p_available: available }),
    deleteProduct: (productId) => rpc<void>(staff, 'admin_delete_product', { p_product: productId }),

    async uploadProductImage(cafeId, image) {
      // The Storage policy only lets managers write into their own café's folder.
      const path = `${cafeId}/${crypto.randomUUID()}.${IMAGE_EXT[image.type] ?? 'jpg'}`;
      const bucket = staff.storage.from('product-images');
      const { error } = await bucket.upload(path, image, { contentType: image.type, cacheControl: '31536000', upsert: false });
      if (error) throw new ApiError('upload_failed', error.message);
      return bucket.getPublicUrl(path).data.publicUrl;
    },

    saveTable: (cafeId, input) => rpc<string>(staff, 'admin_save_table', { p_cafe: cafeId, p_table: input }),
    deleteTable: (tableId) => rpc<void>(staff, 'admin_delete_table', { p_table: tableId }),
    regenerateTableToken: (tableId) => rpc<string>(staff, 'admin_regenerate_table_token', { p_table: tableId }),
    addRooms: (cafeId, from, to, floor) => rpc<number>(staff, 'admin_add_rooms', { p_cafe: cafeId, p_from: from, p_to: to, p_floor: floor }),

    async cafeStaff(cafeId): Promise<StaffMember[]> {
      const data = await rpc<Row[]>(staff, 'admin_staff', { p_cafe: cafeId });
      return (data ?? []).map((r) => ({ id: r.id, name: r.name, role: r.role, active: r.active, email: r.email ?? null }));
    },

    updateStaff: (staffId, role, active) => rpc<void>(staff, 'admin_update_staff', { p_staff: staffId, p_role: role, p_active: active }),

    async inviteStaff(cafeId, input) {
      // Needs the service_role key, so it runs in the invite-staff Edge Function (supabase/functions).
      const { data, error } = await staff.functions.invoke('invite-staff', { body: { cafeId, ...input } });
      if (error) {
        let code = 'invite_unavailable';
        const res = (error as { context?: unknown }).context;
        if (res instanceof Response) {
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) code = body.error;
          } catch {
            /* not our JSON — most likely the function is not deployed */
          }
        }
        throw new ApiError(code, error.message);
      }
      return { created: !!(data as Row | null)?.created };
    },

    resetDemo() {
      /* not available against a real database */
    },
  };
}
