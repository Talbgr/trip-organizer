import type { CategoryId, HandledState } from './types.ts';

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  attractions: 'אטרקציות',
  shopping: 'קניות',
  rest_adi: 'מסעדות עדי',
  rest_tal: 'מסעדות טל',
  rest_both: 'מסעדות משותפות',
  uncategorized: 'לא מסווג',
};

export const STATE_LABELS: Record<HandledState, string> = {
  booked: 'הוזמן',
  paid: 'שולם',
};
