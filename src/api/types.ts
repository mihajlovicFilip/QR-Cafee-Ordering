/**
 * The contract — domain types and the Backend interface.
 *
 * Everything the screens know about data is declared here. supabase.ts and demo.ts each implement
 * Backend in full: a new method goes into this file and into both of them. Timestamps are epoch
 * milliseconds; prices are whole dinars (RSD).
 */

/** Text in several languages: {"sr": "...", "en": "..."}. Adding a language = adding a key. */
export type Localized = Record<string, string>;

/**
 * The product edition of an establishment. Both share all code; the edition only decides
 * whether rooms exist: Stočić Café has tables, Stočić Hotel has tables and rooms (room service).
 * The database enforces it (20261021120000_editions.sql); the interface follows it.
 */
export type Edition = 'cafe' | 'hotel';

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
  edition: Edition;
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
  /** When this sign-in ends on its own: the end of the working day (epoch ms). */
  until: number;
}

/** A waiter or barista still signed in on this device: one tap on the sign-in page brings them back. */
export interface ShiftMember {
  staffId: string;
  name: string;
  role: string;
  until: number;
}

/** A demo account as the sign-in page lists it: the demo shows usernames and PINs on purpose. */
export interface DemoStaff {
  id: string;
  name: string;
  role: string;
  username: string;
  pin: string;
}

// === Admin =============================================

export type StaffRole = 'owner' | 'manager' | 'waiter' | 'barista';
export const STAFF_ROLES: StaffRole[] = ['owner', 'manager', 'waiter', 'barista'];
/** Roles that may open /admin. The database enforces the same rule in public.is_manager(). */
export const MANAGER_ROLES: string[] = ['owner', 'manager'];
/** Staff PINs are digits only, this short or this long. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

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
  /** "HH:MM": every staff sign-in ends at this time (see lib/workday.ts). */
  workdayEnd: string;
}

/** What the settings page may change. The edition is set by the operator, not by the café. */
export type CafeSettingsInput = Omit<CafeSettings, 'id' | 'slug' | 'edition'>;

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

/** Order statistics for a period (today, the last 7 or 30 days, one chosen day), grouped in the café's time zone. */
export interface OrderStats {
  /** Orders that were not rejected (pending ones included). */
  orders: number;
  rejected: number;
  /** Total of accepted orders (not pending, not rejected), in RSD. */
  revenue: number;
  roomOrders: number;
  /** Average minutes from "accept" to "ready", one decimal; null without such orders. */
  prepMinutes: number | null;
  prepCount: number;
  /** Every calendar day of the period, oldest first, including days without orders. */
  byDay: { day: string; orders: number; revenue: number }[];
  /** Hours (0–23) that had orders, rejected ones included. */
  byHour: { hour: number; orders: number }[];
  /** Best sellers by quantity, at most five. */
  top: { key: string; name: Localized; qty: number; revenue: number }[];
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
  /** How staff sign in: username and PIN, or email and password (Supabase until PINs reach the database). */
  staffSignIn: 'pin' | 'email';
  staffSession(): Promise<StaffSession | null>;
  signIn(email: string, password: string): Promise<StaffSession>;
  /** Too many wrong PINs in a row lock the username for a while (login_locked). */
  signInWithPin(username: string, pin: string): Promise<StaffSession>;
  /** Waiters and baristas signed in on this device until the end of the working day (PIN sign-in only). */
  shiftStaff(): Promise<ShiftMember[]>;
  /** Continues as someone from shiftStaff(), without a PIN. Owners and managers always type theirs. */
  resumeShift(staffId: string): Promise<StaffSession>;
  /** The person using this screen steps away but stays signed in, so the next one can take over. */
  stepAway(): void;
  /** Takes a waiter off this device's list before the working day ends (they went home early). */
  endShift(staffId: string): Promise<void>;
  /** Ends the sign-in before the working day does. */
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
  /** Orders created in [since, until) (epoch ms; no `until` = up to now), newest first. */
  adminOrders(cafeId: string, since: number, until?: number): Promise<Order[]>;
  /** Totals for [since, until) (no `until` = up to now), with days counted in `timeZone` (IANA name, e.g. Europe/Belgrade). */
  orderStats(cafeId: string, since: number, until: number | null, timeZone: string): Promise<OrderStats>;
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
  /** Demo only: the demo establishment's edition, and switching it to try the other one. */
  demoEdition(): Edition;
  setDemoEdition(edition: Edition): void;
}
