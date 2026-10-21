/**
 * Menu — categories, products, availability and missing translations.
 *
 * Products without a category are invisible to guests, so they get a group of their own with a
 * warning instead of disappearing from the list.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { backend, CATEGORY_ICONS, type Category, type CategoryIcon, type Localized, type Product, type StaffSession } from '../../api';
import { useI18n } from '../../i18n';
import { useLive } from '../../lib/hooks';
import { describeError } from '../../lib/errors';
import { Button, Dialog, IconButton, ProductTile, Spinner, Switch } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, ErrorNote, LocalizedInput, MissingBadge, PageHeader, productMissingLangs, useAdminTitle } from './parts';
import { ProductEditor } from './ProductEditor';

const normalize = (s: string) => s.toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
const NONE = '__none';

export function MenuPage({ session }: { session: StaffSession }) {
  const { t, tp, loc, money, languages } = useI18n();
  const toast = useToast();
  const cafeId = session.cafe.id;
  useAdminTitle(t('admin.nav.menu'), session.cafe.name);

  const menu = useLive(() => backend.adminMenu(cafeId), () => () => {}, [cafeId], 60_000);
  const [selected, setSelected] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<Category | 'new' | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data]);
  const products = useMemo(() => menu.data?.products ?? [], [menu.data]);
  const orphans = products.filter((p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId));

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return products.filter((p) => {
      if (selected === NONE && p.categoryId && categories.some((c) => c.id === p.categoryId)) return false;
      if (selected !== 'all' && selected !== NONE && p.categoryId !== selected) return false;
      return !q || normalize([...Object.values(p.name), ...Object.values(p.description)].join(' ')).includes(q);
    });
  }, [products, categories, selected, query]);

  async function act(fn: () => Promise<unknown>, success?: string) {
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      toast(describeError(t, e), 'error');
      return false;
    } finally {
      void menu.refresh();
    }
  }

  function move(index: number, delta: number) {
    const ids = categories.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    void act(() => backend.reorderCategories(cafeId, ids));
  }

  if (!menu.data) return menu.error ? <ErrorNote text={describeError(t, menu.error)} /> : <Spinner label={t('common.loading')} />;

  const iconOf = (p: Product): CategoryIcon => categories.find((c) => c.id === p.categoryId)?.icon ?? 'coffee';
  const selectedCategory = categories.find((c) => c.id === selected);

  return (
    <div className="flex animate-rise flex-col gap-7">
      <PageHeader
        title={t('admin.menu.title')}
        subtitle={t('admin.menu.subtitle')}
        actions={
          <Button variant="accent" size="sm" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden />
            {t('admin.menu.newProduct')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[272px_minmax(0,1fr)]">
        {/* Categories */}
        <section className="card flex flex-col gap-1 p-3" aria-labelledby="cats">
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <h2 id="cats" className="label">{t('admin.menu.categories')}</h2>
            <IconButton label={t('admin.menu.newCategory')} onClick={() => setCategoryDialog('new')} className="size-9">
              <Plus size={18} />
            </IconButton>
          </div>
          <CategoryRow label={t('admin.menu.allProducts')} count={products.length} active={selected === 'all'} onSelect={() => setSelected('all')} />
          {categories.map((c, i) => (
            <CategoryRow
              key={c.id}
              label={loc(c.name)}
              icon={c.icon}
              count={products.filter((p) => p.categoryId === c.id).length}
              missing={productMissingLangs({ name: c.name, description: {}, options: [] }, languages)}
              active={selected === c.id}
              onSelect={() => setSelected(c.id)}
              actions={
                <>
                  <IconButton label={t('admin.moveUp')} disabled={i === 0} onClick={() => move(i, -1)} className="size-8 rounded-[10px]">
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton label={t('admin.moveDown')} disabled={i === categories.length - 1} onClick={() => move(i, 1)} className="size-8 rounded-[10px]">
                    <ArrowDown size={15} />
                  </IconButton>
                  <IconButton label={t('admin.menu.editCategoryNamed', { name: loc(c.name) })} onClick={() => setCategoryDialog(c)} className="size-8 rounded-[10px]">
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton label={t('admin.menu.deleteCategory')} onClick={() => setDeletingCategory(c)} className="size-8 rounded-[10px] text-danger hover:bg-[#fbf0ee]">
                    <Trash2 size={15} />
                  </IconButton>
                </>
              }
            />
          ))}
          {orphans.length ? (
            <CategoryRow label={t('admin.menu.uncategorized')} count={orphans.length} warn active={selected === NONE} onSelect={() => setSelected(NONE)} />
          ) : null}
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCategoryDialog('new')}>
            <Plus size={15} aria-hidden />
            {t('admin.menu.newCategory')}
          </Button>
        </section>

        {/* Products */}
        <section className="flex min-w-0 flex-col gap-3" aria-label={t('admin.menu.products')}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-3.5 left-3.5 size-[18px] text-stone" aria-hidden />
              <input type="search" className="field bg-paper pl-10" placeholder={t('admin.menu.searchPlaceholder')} aria-label={t('admin.menu.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          {selected === NONE ? (
            <p className="flex items-center gap-2 rounded-xl bg-[#f6ecd1] px-3.5 py-2.5 text-[13px] font-semibold text-[#76540a]">
              <CircleAlert size={15} aria-hidden />
              {t('admin.menu.uncategorizedHint')}
            </p>
          ) : null}

          {visible.length ? (
            <ul className="card divide-y divide-hair overflow-hidden">
              {visible.map((p) => {
                const missing = productMissingLangs(p, languages);
                return (
                  <li key={p.id} className={`flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4 ${p.available ? '' : 'bg-[#faf6f0]'}`}>
                    <button type="button" onClick={() => setEditing(p)} className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl text-left sm:gap-4" aria-label={t('admin.menu.editProductNamed', { name: loc(p.name) })}>
                      <ProductTile icon={iconOf(p)} imageUrl={p.imageUrl} size={56} className={`rounded-[12px] ${p.available ? '' : 'opacity-55'}`} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`text-[15px] font-semibold ${p.available ? '' : 'text-stone-dark'}`}>{loc(p.name)}</span>
                          {!p.available ? <span className="rounded-full bg-[#ece6de] px-2 py-0.5 text-[11px] font-semibold text-[#584f47]">{t('admin.menu.unavailable')}</span> : null}
                          <MissingBadge langs={missing} />
                        </span>
                        <span className="truncate text-[13px] text-stone">
                          {selected === 'all' ? `${loc(categories.find((c) => c.id === p.categoryId)?.name) || t('admin.menu.uncategorized')} · ` : ''}
                          {p.options.length ? tp('admin.menu.optionsCount', p.options.length) : loc(p.description)}
                        </span>
                      </span>
                      <span className="tabular hidden shrink-0 text-[15px] font-semibold sm:block">{money(p.price)}</span>
                    </button>
                    <Switch
                      checked={p.available}
                      label={t('admin.menu.availableFor', { name: loc(p.name) })}
                      onChange={(next) =>
                        act(() => backend.setProductAvailable(p.id, next), t(next ? 'admin.menu.availableOn' : 'admin.menu.availableOff', { name: loc(p.name) }))
                      }
                    />
                    <IconButton label={t('admin.menu.editProductNamed', { name: loc(p.name) })} onClick={() => setEditing(p)} className="hidden size-10 sm:inline-flex">
                      <Pencil size={17} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="font-serif text-xl font-medium">{query ? t('admin.menu.noMatches', { q: query }) : t('admin.menu.noProducts')}</p>
              {!query ? (
                <Button variant="ghost" size="sm" onClick={() => setEditing('new')}>
                  <Plus size={15} aria-hidden />
                  {t('admin.menu.newProduct')}
                </Button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {editing ? (
        <ProductEditor
          cafeId={cafeId}
          product={editing === 'new' ? null : editing}
          defaultCategory={selectedCategory?.id ?? categories[0]?.id ?? null}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void menu.refresh();
          }}
        />
      ) : null}

      <CategoryDialog
        key={categoryDialog === null ? 'closed' : categoryDialog === 'new' ? 'new' : categoryDialog.id}
        category={categoryDialog}
        onClose={() => setCategoryDialog(null)}
        onSave={async (name, icon) => {
          const id = categoryDialog !== 'new' && categoryDialog ? categoryDialog.id : undefined;
          const ok = await act(async () => {
            const saved = await backend.saveCategory(cafeId, { id, name, icon });
            setSelected(saved);
          }, t('admin.menu.categorySaved'));
          if (ok) setCategoryDialog(null);
        }}
      />

      <ConfirmDialog
        open={!!deletingCategory}
        title={t('admin.menu.deleteCategoryTitle', { name: loc(deletingCategory?.name) })}
        body={t('admin.menu.deleteCategoryBody')}
        confirmLabel={t('admin.delete')}
        danger
        onClose={() => setDeletingCategory(null)}
        onConfirm={async () => {
          const c = deletingCategory!;
          const ok = await act(() => backend.deleteCategory(c.id), t('admin.menu.categoryDeleted', { name: loc(c.name) }));
          if (ok) setSelected('all');
          setDeletingCategory(null);
        }}
      />
    </div>
  );
}

function CategoryRow({ label, icon, count, active, onSelect, actions, missing = [], warn = false }: {
  label: string;
  icon?: CategoryIcon;
  count: number;
  active: boolean;
  onSelect: () => void;
  actions?: ReactNode;
  missing?: string[];
  warn?: boolean;
}) {
  return (
    <div className={`flex flex-col rounded-xl transition ${active ? 'bg-sand' : 'hover:bg-[#f6f0e7]'}`}>
      <button type="button" aria-pressed={active} onClick={onSelect} className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left">
        {icon ? <ProductTile icon={icon} size={30} className="rounded-[9px]" /> : null}
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? 'font-semibold' : 'font-medium'} ${warn ? 'text-[#76540a]' : ''}`}>{label}</span>
        {missing.length ? <span className="size-2 shrink-0 rounded-full bg-[#d9a520]" aria-hidden /> : null}
        <span className="tabular text-xs text-stone">{count}</span>
      </button>
      {actions && active ? <div className="flex items-center justify-end gap-0.5 px-1 pb-1">{actions}</div> : null}
    </div>
  );
}

function CategoryDialog({ category, onClose, onSave }: {
  category: Category | 'new' | null;
  onClose: () => void;
  onSave: (name: Localized, icon: CategoryIcon) => Promise<void>;
}) {
  const { t } = useI18n();
  const existing = category && category !== 'new' ? category : null;
  const [name, setName] = useState<Localized>(existing?.name ?? {});
  const [icon, setIcon] = useState<CategoryIcon>(existing?.icon ?? 'coffee');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = existing ? t('admin.menu.editCategory') : t('admin.menu.newCategory');

  return (
    <Dialog open={!!category} onClose={onClose} title={title} wide>
      <form
        className="flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.sr?.trim()) return setError(t('errors.name_required'));
          setBusy(true);
          setError(null);
          try {
            await onSave(name, icon);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-serif text-2xl font-medium">{title}</h2>
        <LocalizedInput label={t('admin.menu.categoryName')} value={name} onChange={setName} maxLength={60} required autoFocus />
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-2">{t('admin.menu.icon')}</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                aria-pressed={icon === ic}
                aria-label={t(`admin.menu.icons.${ic}`)}
                title={t(`admin.menu.icons.${ic}`)}
                onClick={() => setIcon(ic)}
                className={`rounded-[14px] p-1 transition ${icon === ic ? 'ring-2 ring-espresso ring-offset-2 ring-offset-paper' : 'opacity-80 hover:opacity-100'}`}
              >
                <ProductTile icon={ic} size={48} className="rounded-[11px]" />
              </button>
            ))}
          </div>
        </fieldset>
        <ErrorNote text={error} />
        <div className="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" busy={busy}>{t('admin.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
