/** The guest's cart, one per QR code. */

import { useMemo } from 'react';
import type { CartLineInput, Product } from '../../api/types';
import { unitPrice } from '../../api/pricing';
import { useStoredState } from '../../lib/hooks';

export interface CartLine extends CartLineInput {
  key: string;
}

export interface PricedLine extends CartLine {
  product: Product;
  unit: number;
  total: number;
}

/** Cart for one table, kept in sessionStorage so a refresh or a language switch never empties it. */
export function useCart(token: string, products: Product[]) {
  const [lines, setLines] = useStoredState<CartLine[]>(`stolic.cart.${token}`, [], 'session');

  const priced = useMemo(() => {
    const out: PricedLine[] = [];
    for (const l of lines) {
      const product = products.find((p) => p.id === l.productId);
      if (!product) continue;
      const unit = unitPrice(product, l.choices);
      out.push({ ...l, product, unit, total: unit * l.qty });
    }
    return out;
  }, [lines, products]);

  const unavailable = priced.filter((l) => !l.product.available);
  const valid = priced.filter((l) => l.product.available);

  return {
    lines: valid,
    hasDropped: unavailable.length > 0 || priced.length !== lines.length,
    count: valid.reduce((a, l) => a + l.qty, 0),
    total: valid.reduce((a, l) => a + l.total, 0),
    qtyOf: (productId: string) => valid.filter((l) => l.productId === productId).reduce((a, l) => a + l.qty, 0),
    add(productId: string, qty: number, choices: Record<string, string>, note: string) {
      const key = `${productId}|${JSON.stringify(choices)}|${note}`;
      setLines((cur) => {
        const i = cur.findIndex((l) => l.key === key);
        if (i < 0) return [...cur, { key, productId, qty, choices, note }];
        const next = [...cur];
        next[i] = { ...next[i], qty: Math.min(50, next[i].qty + qty) };
        return next;
      });
    },
    setQty(key: string, qty: number) {
      setLines((cur) => (qty <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, qty: Math.min(50, qty) } : l))));
    },
    remove(key: string) {
      setLines((cur) => cur.filter((l) => l.key !== key));
    },
    prune() {
      setLines((cur) => cur.filter((l) => products.some((p) => p.id === l.productId && p.available)));
    },
    clear() {
      setLines([]);
    },
  };
}

export type Cart = ReturnType<typeof useCart>;
