/**
 * Demo data — the menu, tables, rooms and staff of Kafeterija Lipa.
 *
 * Mirrors supabase/seed.sql, so the demo and a freshly seeded database show the same
 * establishment.
 */

import type { CafeSettings, Category, DiningTable, OptionGroup, Product, StaffMember } from './types';

export const DEMO_CAFE: CafeSettings = {
  id: 'demo-lipa',
  slug: 'lipa',
  name: 'Kafeterija Lipa',
  accent: '#A45A2E',
  defaultLang: 'sr',
  allowRepeat: true,
  callButton: true,
  // Stočić Hotel: the demo has rooms. The home page switches the demo to Stočić Café.
  edition: 'hotel',
  phone: '+381 11 405 2210',
  email: 'zdravo@kafeterijalipa.rs',
  address: 'Cara Dušana 42, Beograd',
  openingHours: { weekdays: '07:00–23:00', saturday: '08:00–24:00', sunday: '09:00–22:00' },
};

const SEATS = [2, 4, 4, 2, 4, 6, 2, 4, 2, 4, 2, 2];
export const DEMO_TABLES: DiningTable[] = SEATS.map((seats, i) => {
  const n = i + 1;
  return { id: `demo-t${n}`, kind: 'table', number: n, seats, zone: n <= 4 ? 'garden' : n <= 10 ? 'hall' : 'bar', token: `demo-sto-${n}`, floor: null };
});

/** Room service: 90 rooms, 30 per floor (101–130, 201–230, 301–330). */
export const DEMO_ROOMS: DiningTable[] = [1, 2, 3].flatMap((floor) =>
  Array.from({ length: 30 }, (_, i) => {
    const n = floor * 100 + i + 1;
    return { id: `demo-r${n}`, kind: 'room' as const, number: n, seats: 2, zone: 'room', token: `demo-soba-${n}`, floor };
  }),
);

export const DEMO_STAFF: StaffMember[] = [
  { id: 'jelena', name: 'Jelena Marković', role: 'owner', active: true, email: 'jelena@kafeterijalipa.rs' },
  { id: 'nikola', name: 'Nikola Jovanović', role: 'manager', active: true, email: 'nikola@kafeterijalipa.rs' },
  { id: 'ana', name: 'Ana Petrović', role: 'waiter', active: true, email: 'ana@kafeterijalipa.rs' },
  { id: 'marko', name: 'Marko Ilić', role: 'waiter', active: true, email: 'marko@kafeterijalipa.rs' },
  { id: 'stefan', name: 'Stefan Ristić', role: 'barista', active: false, email: 'stefan@kafeterijalipa.rs' },
];

export const DEMO_CATEGORIES: Category[] = [
  { id: 'coffee', name: { sr: 'Kafa', en: 'Coffee' }, icon: 'coffee', sort: 1 },
  { id: 'tea', name: { sr: 'Čajevi', en: 'Tea' }, icon: 'tea', sort: 2 },
  { id: 'juice', name: { sr: 'Sokovi i limunade', en: 'Juices & lemonades' }, icon: 'juice', sort: 3 },
  { id: 'breakfast', name: { sr: 'Doručak', en: 'Breakfast' }, icon: 'breakfast', sort: 4 },
  { id: 'dessert', name: { sr: 'Deserti', en: 'Desserts' }, icon: 'dessert', sort: 5 },
  { id: 'bar', name: { sr: 'Bar', en: 'Bar' }, icon: 'bar', sort: 6 },
];

const SIZE: OptionGroup = {
  id: 'size', name: { sr: 'Veličina', en: 'Size' },
  choices: [
    { id: 's', name: { sr: 'Standardna', en: 'Regular' }, price: 0, quiet: true },
    { id: 'l', name: { sr: 'Velika', en: 'Large' }, price: 60 },
  ],
};
const MILK: OptionGroup = {
  id: 'milk', name: { sr: 'Mleko', en: 'Milk' },
  choices: [
    { id: 'cow', name: { sr: 'Kravlje', en: 'Dairy' }, price: 0, quiet: true },
    { id: 'oat', name: { sr: 'Ovseno', en: 'Oat' }, price: 50 },
    { id: 'almond', name: { sr: 'Bademovo', en: 'Almond' }, price: 50 },
  ],
};
const SHOT: OptionGroup = {
  id: 'shot', name: { sr: 'Jačina', en: 'Strength' },
  choices: [
    { id: 'single', name: { sr: 'Jednostruki', en: 'Single' }, price: 0, quiet: true },
    { id: 'double', name: { sr: 'Dupli', en: 'Double' }, price: 80 },
  ],
};
const SUGAR: OptionGroup = {
  id: 'sugar', name: { sr: 'Šećer', en: 'Sugar' },
  choices: [
    { id: 'none', name: { sr: 'Bez šećera', en: 'No sugar' }, price: 0 },
    { id: 'some', name: { sr: 'Srednje slatka', en: 'Medium sweet' }, price: 0 },
    { id: 'sweet', name: { sr: 'Slatka', en: 'Sweet' }, price: 0 },
  ],
};
const EGG: OptionGroup = {
  id: 'egg', name: { sr: 'Jaje', en: 'Egg' },
  choices: [
    { id: 'poached', name: { sr: 'Poširano', en: 'Poached' }, price: 0 },
    { id: 'scrambled', name: { sr: 'Kajgana', en: 'Scrambled' }, price: 0 },
  ],
};
const ICE: OptionGroup = {
  id: 'ice', name: { sr: 'Led', en: 'Ice' },
  choices: [
    { id: 'yes', name: { sr: 'Sa ledom', en: 'With ice' }, price: 0, quiet: true },
    { id: 'no', name: { sr: 'Bez leda', en: 'No ice' }, price: 0 },
  ],
};

type P = [id: string, cat: string, price: number, opts: OptionGroup[], srName: string, srDesc: string, enName: string, enDesc: string, available?: boolean];
const ROWS: P[] = [
  ['p1', 'coffee', 180, [SHOT], 'Espresso', 'Etiopija Guji, sveže pržena u Beogradu. Note bergamota i tamne čokolade.', 'Espresso', 'Ethiopia Guji, freshly roasted in Belgrade. Notes of bergamot and dark chocolate.'],
  ['p2', 'coffee', 260, [SIZE, MILK], 'Kapućino', 'Dupli espresso i svilenkasta mlečna pena.', 'Cappuccino', 'Double espresso with silky steamed milk foam.'],
  ['p3', 'coffee', 290, [MILK], 'Flet vajt', 'Ristreto i tanak sloj mikropene — jak i kremast.', 'Flat white', 'Ristretto with a thin layer of microfoam — strong and creamy.'],
  ['p4', 'coffee', 170, [SUGAR], 'Domaća kafa', 'Kuvana u džezvi, služi se uz ratluk i čašu vode.', 'Serbian coffee', 'Brewed in a traditional džezva, served with Turkish delight and water.'],
  ['p5', 'coffee', 320, [MILK], 'Ledeni latte', 'Espresso preko leda, hladno mleko i nota vanile.', 'Iced latte', 'Espresso over ice with cold milk and a hint of vanilla.'],
  ['p6', 'tea', 220, [], 'Čaj od đumbira', 'Sveži đumbir, limun i med od lipe.', 'Ginger tea', 'Fresh ginger, lemon and linden honey.'],
  ['p7', 'tea', 200, [], 'Kamilica sa medom', 'Kamilica sa Fruške gore i domaći bagremov med.', 'Chamomile & honey', 'Chamomile from Fruška Gora with local acacia honey.'],
  ['p8', 'juice', 340, [ICE], 'Ceđena pomorandža', 'Sveže ceđeno od tri pomorandže, 0,3 l.', 'Fresh orange juice', 'Squeezed to order from three oranges, 0.3 l.'],
  ['p9', 'juice', 290, [ICE], 'Domaća limunada', 'Limun, sveža nana i sirup od zove.', 'House lemonade', 'Lemon, fresh mint and elderflower syrup.'],
  ['p10', 'breakfast', 690, [EGG], 'Tost sa avokadom', 'Hleb od kiselog testa, avokado, jaje i čili pahuljice.', 'Avocado toast', 'Sourdough, smashed avocado, egg and chilli flakes.'],
  ['p11', 'breakfast', 520, [], 'Proja sa kajmakom', 'Topla proja, mladi kajmak i domaći ajvar.', 'Cornbread with kajmak', 'Warm cornbread with young kajmak and homemade ajvar.'],
  ['p12', 'breakfast', 310, [], 'Kroasan sa bademom', 'Lisnato testo na maslacu, punjeno kremom od badema.', 'Almond croissant', 'All-butter pastry filled with almond cream.'],
  ['p13', 'dessert', 450, [], 'Čokoladni sufle', 'Topao, tečnog srca, uz kuglu sladoleda od vanile.', 'Chocolate soufflé', 'Warm with a molten centre, served with vanilla ice cream.', false],
  ['p14', 'dessert', 380, [], 'Baklava sa pistaćima', 'Tanke kore, pistaći i sirup od narandžinog cveta.', 'Pistachio baklava', 'Thin filo, pistachios and orange-blossom syrup.'],
  ['p15', 'bar', 690, [ICE], 'Aperol špric', 'Aperol, prosecco, soda i kriška pomorandže.', 'Aperol spritz', 'Aperol, prosecco, soda and an orange slice.'],
  ['p16', 'bar', 280, [], 'Rakija od dunje', 'Domaća, iz male destilerije kod Šapca, 0,03 l.', 'Quince rakija', 'From a small distillery near Šabac, 0.03 l.'],
];

export const DEMO_PRODUCTS: Product[] = ROWS.map(([id, cat, price, options, srN, srD, enN, enD, available], i) => ({
  id,
  categoryId: cat,
  price,
  options,
  name: { sr: srN, en: enN },
  description: { sr: srD, en: enD },
  available: available ?? true,
  imageUrl: null,
  sort: i + 1,
}));
