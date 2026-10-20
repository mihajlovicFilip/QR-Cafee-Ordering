import { useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { backend, type Category, type Localized, type OptionGroup, type Product } from '../../api';
import { useI18n } from '../../i18n';
import { describeError } from '../../lib/errors';
import { resizeImage } from '../../lib/image';
import { Button, IconButton, ProductTile, Switch } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, Drawer, ErrorNote, Field, LocalizedInput, MissingBadge, missingLangs } from './parts';

interface DraftChoice {
  id: string;
  name: Localized;
  price: string;
  quiet: boolean;
}
interface DraftGroup {
  id: string;
  name: Localized;
  choices: DraftChoice[];
}

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;
const blankChoice = (): DraftChoice => ({ id: newId('c'), name: {}, price: '0', quiet: false });

function toDraft(groups: OptionGroup[]): DraftGroup[] {
  return groups.map((g) => ({ id: g.id, name: { ...g.name }, choices: g.choices.map((c) => ({ id: c.id, name: { ...c.name }, price: String(c.price), quiet: !!c.quiet })) }));
}

/** Whole dinars only: "260", "1.040" and "1 040" are fine, "2,5" is not. */
function parsePrice(raw: string): number | null {
  let clean = raw.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) clean = clean.replace(/\./g, '');
  if (!/^\d{1,7}$/.test(clean)) return null;
  const n = Number(clean);
  return n <= 1_000_000 ? n : null;
}

export function ProductEditor({ cafeId, product, categories, defaultCategory, onClose, onSaved }: {
  cafeId: string;
  product: Product | null;
  categories: Category[];
  defaultCategory: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, loc, languages } = useI18n();
  const toast = useToast();
  const [name, setName] = useState<Localized>(product?.name ?? {});
  const [description, setDescription] = useState<Localized>(product?.description ?? {});
  const [categoryId, setCategoryId] = useState<string>(product ? product.categoryId ?? '' : defaultCategory ?? '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const [available, setAvailable] = useState(product?.available ?? true);
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [groups, setGroups] = useState<DraftGroup[]>(() => toDraft(product?.options ?? []));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const icon = categories.find((c) => c.id === categoryId)?.icon ?? 'coffee';
  const title = product ? t('admin.menu.editProduct') : t('admin.menu.newProduct');

  const updateGroup = (gi: number, patch: Partial<DraftGroup>) => setGroups((cur) => cur.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const updateChoice = (gi: number, ci: number, patch: Partial<DraftChoice>) =>
    setGroups((cur) => cur.map((g, i) => (i === gi ? { ...g, choices: g.choices.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : g)));

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const blob = await resizeImage(file);
      setImageUrl(await backend.uploadProductImage(cafeId, blob));
    } catch (e) {
      setError(describeError(t, e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    setError(null);
    if (!name.sr?.trim()) return setError(t('admin.menu.nameRequired'));
    const priceValue = parsePrice(price);
    if (priceValue === null) return setError(t('admin.menu.invalidPrice'));
    const options: OptionGroup[] = [];
    for (const g of groups) {
      const choices = g.choices.filter((c) => Object.values(c.name).some((v) => v.trim()));
      if (!g.name.sr?.trim() || !choices.length || choices.some((c) => !c.name.sr?.trim())) return setError(t('admin.menu.groupIncomplete'));
      const parsed = choices.map((c) => ({ ...c, price: parsePrice(c.price || '0') }));
      if (parsed.some((c) => c.price === null)) return setError(t('admin.menu.invalidPrice'));
      options.push({ id: g.id, name: g.name, choices: parsed.map((c) => ({ id: c.id, name: c.name, price: c.price!, quiet: c.quiet })) });
    }
    setSaving(true);
    try {
      await backend.saveProduct(cafeId, {
        id: product?.id,
        categoryId: categoryId || null,
        name,
        description,
        price: priceValue,
        available,
        options,
        imageUrl,
      });
      toast(t('admin.menu.productSaved'));
      onSaved();
    } catch (e) {
      setError(describeError(t, e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          {product ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} aria-hidden />
              {t('admin.delete')}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={saving} disabled={uploading} onClick={save}>{t('admin.save')}</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <ProductTile icon={icon} imageUrl={imageUrl} size={96} className="rounded-[18px] border border-line" />
          <div className="flex flex-col gap-2">
            <span className="label">{t('admin.menu.photo')}</span>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" busy={uploading} onClick={() => fileRef.current?.click()}>
                <ImagePlus size={15} aria-hidden />
                {uploading ? t('admin.menu.uploading') : imageUrl ? t('admin.menu.replacePhoto') : t('admin.menu.uploadPhoto')}
              </Button>
              {imageUrl ? (
                <Button variant="ghost" size="sm" onClick={() => setImageUrl(null)}>
                  <X size={15} aria-hidden />
                  {t('admin.menu.removePhoto')}
                </Button>
              ) : null}
            </div>
            <span className="text-xs text-stone">{t('admin.menu.photoHint')}</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-label={t('admin.menu.uploadPhoto')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </div>
        </div>

        <LocalizedInput label={t('admin.menu.name')} value={name} onChange={setName} maxLength={80} required autoFocus />
        <LocalizedInput label={t('admin.menu.description')} value={description} onChange={setDescription} maxLength={400} multiline />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('admin.menu.category')}>
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('admin.menu.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{loc(c.name)}</option>
              ))}
            </select>
          </Field>
          <Field label={t('admin.menu.price')} hint={t('admin.menu.priceHint')}>
            <span className="relative block">
              <input className="field tabular pr-14" inputMode="numeric" aria-label={t('admin.menu.price')} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" required />
              <span className="pointer-events-none absolute top-[13px] right-3.5 text-sm font-semibold text-stone" aria-hidden>RSD</span>
            </span>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{t('admin.menu.availability')}</span>
            <span className="text-[13px] text-stone">{t('admin.menu.availabilityHint')}</span>
          </div>
          <Switch checked={available} onChange={setAvailable} label={t('admin.menu.availability')} />
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="opts">
          <div className="flex flex-col gap-1">
            <h3 id="opts" className="label">{t('admin.menu.options')}</h3>
            <p className="text-[13px] leading-snug text-stone">{t('admin.menu.optionsHint')}</p>
          </div>
          {groups.map((g, gi) => (
            <fieldset key={g.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
              <legend className="sr-only">{loc(g.name) || t('admin.menu.groupName')}</legend>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <LocalizedInput label={t('admin.menu.groupName')} value={g.name} onChange={(v) => updateGroup(gi, { name: v })} maxLength={60} required />
                </div>
                <IconButton label={t('admin.menu.removeGroup')} onClick={() => setGroups((cur) => cur.filter((_, i) => i !== gi))} className="mt-7 size-10 text-danger">
                  <Trash2 size={16} />
                </IconButton>
              </div>
              <div className="flex flex-col gap-2">
                <span className="label">{t('admin.menu.choices')}</span>
                {g.choices.map((c, ci) => (
                  <div key={c.id} className="flex flex-col gap-2 rounded-xl bg-ivory p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {languages.map((l) => (
                        <input
                          key={l}
                          lang={l}
                          className={`field h-10 min-w-[120px] flex-1 text-sm ${missingLangs(c.name, languages).includes(l) ? 'border-[#e0c48a] bg-[#fffaf0]' : ''}`}
                          placeholder={`${t('admin.menu.choiceName')} (${l.toUpperCase()})`}
                          aria-label={`${t('admin.menu.choiceName')} ${ci + 1} (${l.toUpperCase()})`}
                          maxLength={60}
                          value={c.name[l] ?? ''}
                          onChange={(e) => updateChoice(gi, ci, { name: { ...c.name, [l]: e.target.value } })}
                        />
                      ))}
                      <span className="relative w-[118px]">
                        <span className="pointer-events-none absolute top-[10px] left-3 text-sm text-stone" aria-hidden>+</span>
                        <input
                          className="field tabular h-10 pr-11 pl-6 text-sm"
                          inputMode="numeric"
                          aria-label={`${t('admin.menu.surcharge')} ${ci + 1}`}
                          value={c.price}
                          onChange={(e) => updateChoice(gi, ci, { price: e.target.value })}
                        />
                        <span className="pointer-events-none absolute top-[11px] right-3 text-xs font-semibold text-stone" aria-hidden>RSD</span>
                      </span>
                      <IconButton label={t('admin.menu.removeChoice')} disabled={g.choices.length === 1} onClick={() => updateGroup(gi, { choices: g.choices.filter((_, j) => j !== ci) })} className="size-10">
                        <X size={16} />
                      </IconButton>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[13px] text-stone">
                      {ci === 0 ? <span className="font-semibold text-copper-ink">{t('admin.menu.defaultChoice')}</span> : null}
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" className="size-4 accent-(--ac)" checked={c.quiet} onChange={(e) => updateChoice(gi, ci, { quiet: e.target.checked })} />
                        {t('admin.menu.quiet')}
                      </label>
                    </div>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="self-start" onClick={() => updateGroup(gi, { choices: [...g.choices, blankChoice()] })}>
                  <Plus size={14} aria-hidden />
                  {t('admin.menu.addChoice')}
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={groups.length >= 10}
            onClick={() => setGroups((cur) => [...cur, { id: newId('g'), name: {}, choices: [{ ...blankChoice(), quiet: true }, blankChoice()] }])}
          >
            <Plus size={14} aria-hidden />
            {t('admin.menu.addGroup')}
          </Button>
        </section>

        {(() => {
          const missing = new Set<string>();
          [name, description, ...groups.flatMap((g) => [g.name, ...g.choices.map((c) => c.name)])].forEach((f) => missingLangs(f, languages).forEach((l) => missing.add(l)));
          return missing.size ? (
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-stone">
              <MissingBadge langs={languages.filter((l) => missing.has(l))} />
              {t('admin.menu.missingHint')}
            </p>
          ) : null;
        })()}

        <ErrorNote text={error} />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title={t('admin.menu.deleteProductTitle', { name: loc(name) })}
        body={t('admin.menu.deleteProductBody')}
        confirmLabel={t('admin.delete')}
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await backend.deleteProduct(product!.id);
            toast(t('admin.menu.productDeleted', { name: loc(name) }));
            setConfirmDelete(false);
            onSaved();
          } catch (e) {
            setConfirmDelete(false);
            setError(describeError(t, e));
          }
        }}
      />
    </Drawer>
  );
}
