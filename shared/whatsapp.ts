import { digitsOnly, toE164Digits } from './phone';
import type { Language } from './constants';

export type WhatsAppIntent = 'product_enquiry' | 'demo_booking' | 'sales_support' | 'customer_support' | 'pricing';

/** Prefilled messages. The visitor always presses "send" themselves (click-to-chat). */
const MESSAGES: Record<WhatsAppIntent, Record<Language, string>> = {
  product_enquiry: {
    en: 'Hi, I would like to know more about {{brand}}.',
    ta: 'வணக்கம், {{brand}} பற்றி மேலும் அறிய விரும்புகிறேன்.',
  },
  demo_booking: {
    en: 'Hi, I would like to book a free demo of {{brand}}.',
    ta: 'வணக்கம், {{brand}} இலவச டெமோவை முன்பதிவு செய்ய விரும்புகிறேன்.',
  },
  sales_support: {
    en: 'Hi, I have a question about {{brand}} plans and pricing.',
    ta: 'வணக்கம், {{brand}} திட்டங்கள் மற்றும் விலை பற்றி ஒரு கேள்வி உள்ளது.',
  },
  customer_support: {
    en: 'Hi, I need help with my {{brand}} account. Company: {{company}}',
    ta: 'வணக்கம், எனது {{brand}} கணக்கில் உதவி தேவை. நிறுவனம்: {{company}}',
  },
  pricing: {
    en: 'Hi, I am interested in the {{plan}} plan of {{brand}}.',
    ta: 'வணக்கம், {{brand}}-இன் {{plan}} திட்டத்தில் ஆர்வமாக உள்ளேன்.',
  },
};

export function whatsAppMessage(
  intent: WhatsAppIntent,
  language: Language,
  vars: Record<string, string | undefined> = {},
): string {
  const template = MESSAGES[intent][language] ?? MESSAGES[intent].en;
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
    // Drop a trailing "Label:" left behind when its variable was not supplied.
    .replace(/\s*(Company|நிறுவனம்):\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Builds an official click-to-chat link (https://wa.me/<number>?text=<message>).
 * Returns null when the number is not usable, so callers can hide the button.
 */
export function buildWhatsAppLink(number: string | null | undefined, message?: string): string | null {
  if (!number) return null;
  const digits = toE164Digits(number) ?? (digitsOnly(number).length >= 8 ? digitsOnly(number) : null);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  const text = message?.trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
