-- Demo tenant: Kafeterija Lipa (Dorćol, Beograd) with a bilingual menu, 12 tables and 90 rooms.
-- Run once after all migrations (Supabase → SQL Editor → paste → Run).
--
-- The QR tokens below (demo-sto-1 … demo-sto-12, demo-soba-101 … demo-soba-330) are readable on purpose so the demo links
-- are easy to type. Before real guests use the system, replace them with random ones:
--   update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '');

do $$
declare
  cafe uuid := '00000000-0000-4000-8000-000000000001';
  c_coffee uuid := '00000000-0000-4000-8000-000000000011';
  c_tea uuid := '00000000-0000-4000-8000-000000000012';
  c_juice uuid := '00000000-0000-4000-8000-000000000013';
  c_breakfast uuid := '00000000-0000-4000-8000-000000000014';
  c_dessert uuid := '00000000-0000-4000-8000-000000000015';
  c_bar uuid := '00000000-0000-4000-8000-000000000016';
  g_size jsonb := '{"id":"size","name":{"sr":"Veličina","en":"Size"},"choices":[{"id":"s","name":{"sr":"Standardna","en":"Regular"},"price":0,"quiet":true},{"id":"l","name":{"sr":"Velika","en":"Large"},"price":60}]}';
  g_milk jsonb := '{"id":"milk","name":{"sr":"Mleko","en":"Milk"},"choices":[{"id":"cow","name":{"sr":"Kravlje","en":"Dairy"},"price":0,"quiet":true},{"id":"oat","name":{"sr":"Ovseno","en":"Oat"},"price":50},{"id":"almond","name":{"sr":"Bademovo","en":"Almond"},"price":50}]}';
  g_shot jsonb := '{"id":"shot","name":{"sr":"Jačina","en":"Strength"},"choices":[{"id":"single","name":{"sr":"Jednostruki","en":"Single"},"price":0,"quiet":true},{"id":"double","name":{"sr":"Dupli","en":"Double"},"price":80}]}';
  g_sugar jsonb := '{"id":"sugar","name":{"sr":"Šećer","en":"Sugar"},"choices":[{"id":"none","name":{"sr":"Bez šećera","en":"No sugar"},"price":0},{"id":"some","name":{"sr":"Srednje slatka","en":"Medium sweet"},"price":0},{"id":"sweet","name":{"sr":"Slatka","en":"Sweet"},"price":0}]}';
  g_egg jsonb := '{"id":"egg","name":{"sr":"Jaje","en":"Egg"},"choices":[{"id":"poached","name":{"sr":"Poširano","en":"Poached"},"price":0},{"id":"scrambled","name":{"sr":"Kajgana","en":"Scrambled"},"price":0}]}';
  g_ice jsonb := '{"id":"ice","name":{"sr":"Led","en":"Ice"},"choices":[{"id":"yes","name":{"sr":"Sa ledom","en":"With ice"},"price":0,"quiet":true},{"id":"no","name":{"sr":"Bez leda","en":"No ice"},"price":0}]}';
begin
  insert into public.cafes (id, slug, name, accent, default_lang, phone, email, address, opening_hours)
  values (cafe, 'lipa', 'Kafeterija Lipa', '#A45A2E', 'sr', '+381 11 405 2210', 'zdravo@kafeterijalipa.rs',
          'Cara Dušana 42, Beograd', '{"weekdays":"07:00–23:00","saturday":"08:00–24:00","sunday":"09:00–22:00"}');

  insert into public.dining_tables (cafe_id, number, seats, zone, qr_token)
  select cafe, n,
         (array[2,4,4,2,4,6,2,4,2,4,2,2])[n],
         case when n <= 4 then 'garden' when n <= 10 then 'hall' else 'bar' end,
         'demo-sto-' || n
  from generate_series(1, 12) as n;

  -- Room service: 90 rooms, 30 per floor (101–130, 201–230, 301–330).
  insert into public.dining_tables (cafe_id, kind, number, seats, zone, floor, qr_token)
  select cafe, 'room', f * 100 + r, 2, 'room', f, 'demo-soba-' || (f * 100 + r)
  from generate_series(1, 3) as f, generate_series(1, 30) as r;

  insert into public.categories (id, cafe_id, name, icon, sort) values
    (c_coffee,    cafe, '{"sr":"Kafa","en":"Coffee"}', 'coffee', 1),
    (c_tea,       cafe, '{"sr":"Čajevi","en":"Tea"}', 'tea', 2),
    (c_juice,     cafe, '{"sr":"Sokovi i limunade","en":"Juices & lemonades"}', 'juice', 3),
    (c_breakfast, cafe, '{"sr":"Doručak","en":"Breakfast"}', 'breakfast', 4),
    (c_dessert,   cafe, '{"sr":"Deserti","en":"Desserts"}', 'dessert', 5),
    (c_bar,       cafe, '{"sr":"Bar","en":"Bar"}', 'bar', 6);

  insert into public.products (id, cafe_id, category_id, name, description, price, available, options, sort) values
    ('00000000-0000-4000-8000-000000000101', cafe, c_coffee, '{"sr":"Espresso","en":"Espresso"}',
     '{"sr":"Etiopija Guji, sveže pržena u Beogradu. Note bergamota i tamne čokolade.","en":"Ethiopia Guji, freshly roasted in Belgrade. Notes of bergamot and dark chocolate."}',
     180, true, jsonb_build_array(g_shot), 1),
    ('00000000-0000-4000-8000-000000000102', cafe, c_coffee, '{"sr":"Kapućino","en":"Cappuccino"}',
     '{"sr":"Dupli espresso i svilenkasta mlečna pena.","en":"Double espresso with silky steamed milk foam."}',
     260, true, jsonb_build_array(g_size, g_milk), 2),
    ('00000000-0000-4000-8000-000000000103', cafe, c_coffee, '{"sr":"Flet vajt","en":"Flat white"}',
     '{"sr":"Ristreto i tanak sloj mikropene — jak i kremast.","en":"Ristretto with a thin layer of microfoam — strong and creamy."}',
     290, true, jsonb_build_array(g_milk), 3),
    ('00000000-0000-4000-8000-000000000104', cafe, c_coffee, '{"sr":"Domaća kafa","en":"Serbian coffee"}',
     '{"sr":"Kuvana u džezvi, služi se uz ratluk i čašu vode.","en":"Brewed in a traditional džezva, served with Turkish delight and water."}',
     170, true, jsonb_build_array(g_sugar), 4),
    ('00000000-0000-4000-8000-000000000105', cafe, c_coffee, '{"sr":"Ledeni latte","en":"Iced latte"}',
     '{"sr":"Espresso preko leda, hladno mleko i nota vanile.","en":"Espresso over ice with cold milk and a hint of vanilla."}',
     320, true, jsonb_build_array(g_milk), 5),
    ('00000000-0000-4000-8000-000000000106', cafe, c_tea, '{"sr":"Čaj od đumbira","en":"Ginger tea"}',
     '{"sr":"Sveži đumbir, limun i med od lipe.","en":"Fresh ginger, lemon and linden honey."}',
     220, true, '[]', 6),
    ('00000000-0000-4000-8000-000000000107', cafe, c_tea, '{"sr":"Kamilica sa medom","en":"Chamomile & honey"}',
     '{"sr":"Kamilica sa Fruške gore i domaći bagremov med.","en":"Chamomile from Fruška Gora with local acacia honey."}',
     200, true, '[]', 7),
    ('00000000-0000-4000-8000-000000000108', cafe, c_juice, '{"sr":"Ceđena pomorandža","en":"Fresh orange juice"}',
     '{"sr":"Sveže ceđeno od tri pomorandže, 0,3 l.","en":"Squeezed to order from three oranges, 0.3 l."}',
     340, true, jsonb_build_array(g_ice), 8),
    ('00000000-0000-4000-8000-000000000109', cafe, c_juice, '{"sr":"Domaća limunada","en":"House lemonade"}',
     '{"sr":"Limun, sveža nana i sirup od zove.","en":"Lemon, fresh mint and elderflower syrup."}',
     290, true, jsonb_build_array(g_ice), 9),
    ('00000000-0000-4000-8000-000000000110', cafe, c_breakfast, '{"sr":"Tost sa avokadom","en":"Avocado toast"}',
     '{"sr":"Hleb od kiselog testa, avokado, jaje i čili pahuljice.","en":"Sourdough, smashed avocado, egg and chilli flakes."}',
     690, true, jsonb_build_array(g_egg), 10),
    ('00000000-0000-4000-8000-000000000111', cafe, c_breakfast, '{"sr":"Proja sa kajmakom","en":"Cornbread with kajmak"}',
     '{"sr":"Topla proja, mladi kajmak i domaći ajvar.","en":"Warm cornbread with young kajmak and homemade ajvar."}',
     520, true, '[]', 11),
    ('00000000-0000-4000-8000-000000000112', cafe, c_breakfast, '{"sr":"Kroasan sa bademom","en":"Almond croissant"}',
     '{"sr":"Lisnato testo na maslacu, punjeno kremom od badema.","en":"All-butter pastry filled with almond cream."}',
     310, true, '[]', 12),
    ('00000000-0000-4000-8000-000000000113', cafe, c_dessert, '{"sr":"Čokoladni sufle","en":"Chocolate soufflé"}',
     '{"sr":"Topao, tečnog srca, uz kuglu sladoleda od vanile.","en":"Warm with a molten centre, served with vanilla ice cream."}',
     450, false, '[]', 13),
    ('00000000-0000-4000-8000-000000000114', cafe, c_dessert, '{"sr":"Baklava sa pistaćima","en":"Pistachio baklava"}',
     '{"sr":"Tanke kore, pistaći i sirup od narandžinog cveta.","en":"Thin filo, pistachios and orange-blossom syrup."}',
     380, true, '[]', 14),
    ('00000000-0000-4000-8000-000000000115', cafe, c_bar, '{"sr":"Aperol špric","en":"Aperol spritz"}',
     '{"sr":"Aperol, prosecco, soda i kriška pomorandže.","en":"Aperol, prosecco, soda and an orange slice."}',
     690, true, jsonb_build_array(g_ice), 15),
    ('00000000-0000-4000-8000-000000000116', cafe, c_bar, '{"sr":"Rakija od dunje","en":"Quince rakija"}',
     '{"sr":"Domaća, iz male destilerije kod Šapca, 0,03 l.","en":"From a small distillery near Šabac, 0.03 l."}',
     280, true, '[]', 16);
end;
$$;
