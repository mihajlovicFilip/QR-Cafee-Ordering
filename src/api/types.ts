/** Text in several languages: {"sr": "...", "en": "..."}. Adding a language = adding a key. */
export type Localized = Record<string, string>;

/** Where the guest sits: a table in the venue, or a hotel room (room service). */
export type PlaceKind = 'table' | 'room';

export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'rejected';
export type CategoryIcon = 'coffee' | 'tea' | 'juice' | 'breakfast' | 'dessert' | 'bar';

export interface Cafe {
  id: string;
  slug: string;
  name: string;
  accent: string;
  defaultLang: string;
  allowRepeat: boolean;
  callButton: boolean;
}

export interface TableRef {
  id: string;
  number: number;
  kind: PlaceKind;
}

export interface DiningTable extends TableRef {
  seats: number;
  zone: string;
  token: string;
  /** Rooms only: 0 = ground floor, null = not set. */
  floor: number | null;
}

export interface Category {
  id: string;
  name: Localized;
  icon: CategoryIcon;
  sort: number;
}

export interface OptionChoice {
  id: string;
  name: Localized;
  price: number;
  /** Default choices that are not worth printing on the ticket (e.g. "regular size"). */
  quiet?: boolean;
}

export interface OptionGroup {
  id: string;
  name: Localized;
  choices: OptionChoice[];
}

export interface Product {
  id: string;
  categoryId: string | null;
  name: Localized;
  description: Localized;
  price: number;
  available: boolean;
  options: OptionGroup[];
  imageUrl: string | null;
  sort: number;
}

export interface TableMenu {
  cafe: Cafe;
  table: TableRef;
  categories: Category[];
  products: Product[];
}

export interface OrderItemChoice {
  group: string;
  groupName: Localized;
  choice: string;
  choiceName: Localized;
  quiet: boolean;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  name: Localized;
  qty: number;
  unitPrice: number;
  choices: OrderItemChoice[];
  note: string;
}

/** All timestamps are epoch milliseconds. */
export interface Order {
  id: string;
  number: number;
  tableId: string;
  tableNumber: number;
  tableKind: PlaceKind;
  status: OrderStatus;
  note: string;
  total: number;
  createdAt: number;
  acceptedAt: number | null;
  deadline: number | null;
  prepMinutes: number | null;
  estimateUpdatedAt: number | null;
  readyAt: number | null;
  servedAt: number | null;
  rejectedAt: number | null;
  rejectReason: string | null;
  waiterId: string | null;
  waiterName: string | null;
  items: OrderItem[];
}

export interface WaiterCall {
  id: string;
  tableNumber: number;
  createdAt: number;
}

export interface StaffSession {
  staffId: string;
  name: string;
  role: string;
  cafe: Cafe;
}

export interface DemoStaff {
  id: string;
  name: string;
  role: string;
}

// ───────────────────────────────────────────── Admin

export type StaffRole = 'owner' | 'manager' | 'waiter' | 'barista';
export const STAFF_ROLES: StaffRole[] = ['owner', 'manager', 'waiter', 'barista'];
/** Roles that may open /admin. The database enforces the same rule in public.is_manager(). */
export const MANAGER_ROLES: string[] = ['owner', 'manager'];

export const TABLE_ZONES = ['hall', 'garden', 'terrace', 'bar'] as const;
export const CATEGORY_ICONS: CategoryIcon[] = ['coffee', 'tea', 'juice', 'breakfast', 'dessert', 'bar'];

/** Free text per day group, e.g. "07:00–23:00"; an empty string means closed. */
export interface OpeningHours {
  weekdays: string;
  saturday: string;
  sunday: string;
}

export interface CafeSettings extends Cafe {
  phone: string;
  email: string;
  address: string;
  openingHours: OpeningHours;
}

export type CafeSettingsInput = Omit<CafeSettings, 'id' | 'slug'>;

export interface AdminMenu {
  categories: Category[];
  products: Product[];
}

export interface CategoryInput {
  id?: string;
  name: Localized;
  icon: CategoryIcon;
}

export interface ProductInput {
  id?: string;
  categoryId: string | null;
  name: Localized;
  description: Localized;
  price: number;
  available: boolean;
  options: OptionGroup[];
  imageUrl: string | null;
}

export interface TableInput {
  id?: string;
  kind: PlaceKind;
  number: number;
  seats: number;
  zone: string;
  /** Rooms only: 0 = ground floor, null = not set. Ignored for tables. */
  floor: number | null;
}

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  email: string | null;
}

export interface StaffInvite {
  name: string;
  email: string;
  role: StaffRole;
  /** Used only when a new login has to be created. */
  password: string;
}

export interface CartLineInput {
  productId: string;
  qty: number;
  choices: Record<string, string>;
  note: string;
}

export type ClaimResult = 'ok' | 'taken';

/** Error with a stable code; the UI translates it via `errors.<code>`. */
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface Backend {
  mode: 'demo' | 'supabase';
  /** Milliseconds to add to Date.now() to get server time. */
  serverOffset(): number;

  // Guest
  loadTable(token: string): Promise<TableMenu | null>;
  placeOrder(token: string, lines: CartLineInput[], note: string): Promise<string>;
  myOrders(token: string): Promise<Order[]>;
  subscribeMyOrders(token: string, onChange: () => void): () => void;
  callWaiter(token: string): Promise<void>;

  // Staff
  staffSession(): Promise<StaffSession | null>;
  signIn(email: string, password: string): Promise<StaffSession>;
  signOut(): Promise<void>;
  demoStaff(): DemoStaff[];
  demoSignIn(staffId: string): Promise<StaffSession>;
  cafeOrders(cafeId: string): Promise<Order[]>;
  cafeCalls(cafeId: string): Promise<WaiterCall[]>;
  cafeTables(cafeId: string): Promise<DiningTable[]>;
  subscribeCafe(cafeId: string, onChange: () => void): () => void;
  acceptOrder(orderId: string, minutes: number): Promise<ClaimResult>;
  rejectOrder(orderId: string, reason: string): Promise<ClaimResult>;
  extendOrder(orderId: string, minutes: number): Promise<void>;
  markReady(orderId: string): Promise<void>;
  markServed(orderId: string): Promise<void>;
  resolveCall(callId: string): Promise<void>;

  // Admin (owner / manager only — every call is re-checked on the server)
  /** Orders created at or after `since` (epoch ms), newest first. */
  adminOrders(cafeId: string, since: number): Promise<Order[]>;
  cafeSettings(cafeId: string): Promise<CafeSettings>;
  updateCafe(cafeId: string, input: CafeSettingsInput): Promise<void>;
  adminMenu(cafeId: string): Promise<AdminMenu>;
  saveCategory(cafeId: string, input: CategoryInput): Promise<string>;
  deleteCategory(categoryId: string): Promise<void>;
  reorderCategories(cafeId: string, ids: string[]): Promise<void>;
  saveProduct(cafeId: string, input: ProductInput): Promise<string>;
  setProductAvailable(productId: string, available: boolean): Promise<void>;
  deleteProduct(productId: string): Promise<void>;
  /** Stores an already resized image and returns its public URL. */
  uploadProductImage(cafeId: string, image: Blob): Promise<string>;
  saveTable(cafeId: string, input: TableInput): Promise<string>;
  /** Hard delete when the table has no history, otherwise hidden (its QR code stops working). */
  deleteTable(tableId: string): Promise<void>;
  regenerateTableToken(tableId: string): Promise<string>;
  /** Adds rooms numbered from..to (inclusive) on `floor`, skipping numbers that already exist. Returns how many were added. */
  addRooms(cafeId: string, from: number, to: number, floor: number | null): Promise<number>;
  cafeStaff(cafeId: string): Promise<StaffMember[]>;
  updateStaff(staffId: string, role: StaffRole, active: boolean): Promise<void>;
  /** Creates the login if the email is new, then links it to the café. */
  inviteStaff(cafeId: string, input: StaffInvite): Promise<{ created: boolean }>;

  /** Demo only: wipe local data back to the seeded state. */
  resetDemo(): void;
}
