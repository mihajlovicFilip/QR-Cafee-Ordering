/**
 * Editions — what Stočić Café and Stočić Hotel show.
 *
 * Both editions run the same screens. Rooms, and everything that exists only because of them
 * (room service, floors, the tables / rooms switches), appear for Stočić Hotel alone. Hiding is
 * a convenience: the database refuses room operations for a café anyway
 * (20261021120000_editions.sql), so a hidden button is never the only guard.
 */
import type { Edition } from '../api/types';

export const isHotel = (cafe: { edition?: Edition }) => cafe.edition === 'hotel';

/** Product names stay the same in every language. */
export const editionName = (edition: Edition) => (edition === 'hotel' ? 'Stočić Hotel' : 'Stočić Café');
