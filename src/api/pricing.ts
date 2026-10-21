/**
 * Price estimates in the browser.
 *
 * For display in the menu and the cart only: place_order recomputes every price from the products
 * table and ignores what the phone sends. The rule for choices (a missing or unknown one falls
 * back to the group's first choice) mirrors the SQL, so the estimate matches the bill.
 */

import type { OptionChoice, Product } from './types';

export function defaultChoices(product: Product): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of product.options) if (g.choices[0]) out[g.id] = g.choices[0].id;
  return out;
}

/** The choice that will actually be used for a group — falls back to the group's first choice, like the server. */
export function resolveChoice(product: Product, groupId: string, choiceId: string | undefined): OptionChoice | undefined {
  const g = product.options.find((x) => x.id === groupId);
  if (!g) return undefined;
  return g.choices.find((c) => c.id === choiceId) ?? g.choices[0];
}

/** Display estimate only. The server recomputes every price when the order is placed. */
export function unitPrice(product: Product, choices: Record<string, string>): number {
  let price = product.price;
  for (const g of product.options) price += resolveChoice(product, g.id, choices[g.id])?.price ?? 0;
  return price;
}
